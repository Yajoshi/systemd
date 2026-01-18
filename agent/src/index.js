import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fetch from "node-fetch";

const API_BASE = process.env.API_BASE ?? "https://api.edge.local:8443";
const STATE_DIR = process.env.STATE_DIR ?? "/var/lib/edge-agent";
const PKI_DIR = path.join(STATE_DIR, "pki");
const STATE_FILE = path.join(STATE_DIR, "state.json");

fs.mkdirSync(PKI_DIR, { recursive: true });

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    const state = { deviceId: crypto.randomUUID().replace(/-/g, ""), pairingCode: makeCode(8), enrolled: false };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    return state;
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
}

function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

function makeCode(n) {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function insecureAgent() { return new https.Agent({ rejectUnauthorized: false }); }

function mtlsAgent() {
  return new https.Agent({
    key: fs.readFileSync(path.join(PKI_DIR, "device.key")),
    cert: fs.readFileSync(path.join(PKI_DIR, "device.crt")),
    ca: fs.readFileSync(path.join(PKI_DIR, "ca.crt")),
    rejectUnauthorized: true
  });
}

async function postJson(url, body, agent) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), agent });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t}`);
  return t ? JSON.parse(t) : {};
}

async function getJson(url, agent) {
  const r = await fetch(url, { method: "GET", agent });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t}`);
  return t ? JSON.parse(t) : {};
}

function ensureKeyAndCsr(deviceId) {
  const keyPath = path.join(PKI_DIR, "device.key");
  const csrPath = path.join(PKI_DIR, "device.csr");
  if (!fs.existsSync(keyPath)) {
    const r1 = spawnSync("openssl", ["genrsa", "-out", keyPath, "2048"]);
    if (r1.status !== 0) throw new Error((r1.stderr || r1.stdout).toString("utf-8"));
  }
  const r2 = spawnSync("openssl", ["req", "-new", "-key", keyPath, "-out", csrPath, "-subj", `/CN=${deviceId}`]);
  if (r2.status !== 0) throw new Error((r2.stderr || r2.stdout).toString("utf-8"));
  return csrPath;
}

function execTask(t) {
  if (t.type === "SET_PROXY") {
    const httpProxy = String(t.payload?.httpProxy ?? "");
    const httpsProxy = String(t.payload?.httpsProxy ?? "");
    if (!httpProxy || !httpsProxy) throw new Error("missing proxy values");
    fs.writeFileSync("/etc/environment", `HTTP_PROXY=${httpProxy}\nHTTPS_PROXY=${httpsProxy}\nhttp_proxy=${httpProxy}\nhttps_proxy=${httpsProxy}\n`);
    return { wrote: "/etc/environment" };
  }
  if (t.type === "CHECK_MICROK8S") {
    const r = spawnSync("bash", ["-lc", "command -v microk8s >/dev/null 2>&1 && microk8s status || echo microk8s-not-installed"], { encoding: "utf-8" });
    return { output: (r.stdout ?? "") + (r.stderr ?? "") };
  }
  if (t.type === "LIST_LXD_VMS") {
    const r = spawnSync("bash", ["-lc", "command -v lxc >/dev/null 2>&1 && lxc list --format=json || echo lxc-not-installed"], { encoding: "utf-8" });
    return { output: (r.stdout ?? "") + (r.stderr ?? "") };
  }
  throw new Error("unsupported task type");
}

async function bootstrap(state) {
  console.log(`[agent] deviceId=${state.deviceId}`);
  console.log(`[agent] pairingCode=${state.pairingCode}`);

  await postJson(`${API_BASE}/agent/hello`, { deviceId: state.deviceId, pairingCode: state.pairingCode }, insecureAgent());
  console.log("[agent] PENDING. Claim in Portal -> Devices -> Claim.");

  while (!state.enrollmentToken) {
    try {
      const data = await getJson(`${API_BASE}/agent/enroll?deviceId=${encodeURIComponent(state.deviceId)}&pairingCode=${encodeURIComponent(state.pairingCode)}`, insecureAgent());
      state.enrollmentToken = data.enrollmentToken;
      saveState(state);
      console.log("[agent] got enrollmentToken");
    } catch {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  const csrPath = ensureKeyAndCsr(state.deviceId);
  const csrPem = fs.readFileSync(csrPath, "utf-8");
  const signed = await postJson(`${API_BASE}/agent/csr`, { deviceId: state.deviceId, enrollmentToken: state.enrollmentToken, csrPem }, insecureAgent());

  fs.writeFileSync(path.join(PKI_DIR, "device.crt"), signed.deviceCrtPem, "utf-8");
  fs.writeFileSync(path.join(PKI_DIR, "ca.crt"), signed.caCrtPem, "utf-8");

  state.enrolled = true;
  saveState(state);
  console.log("[agent] enrolled, mTLS enabled");
}

async function loop(state) {
  const agent = mtlsAgent();
  await postJson(`${API_BASE}/agent/mtls/heartbeat`, { deviceId: state.deviceId }, agent);
  const polled = await postJson(`${API_BASE}/agent/mtls/tasks/poll`, { deviceId: state.deviceId }, agent);
  const tasks = Array.isArray(polled.tasks) ? polled.tasks : [];
  for (const t of tasks) {
    try {
      const result = execTask(t);
      await postJson(`${API_BASE}/agent/mtls/tasks/report`, { deviceId: state.deviceId, taskId: t.id, status: "DONE", result }, agent);
    } catch (e) {
      await postJson(`${API_BASE}/agent/mtls/tasks/report`, { deviceId: state.deviceId, taskId: t.id, status: "FAILED", result: { error: String(e?.message ?? e) } }, agent);
    }
  }
}

(async () => {
  const state = loadState();
  try {
    if (!state.enrolled) await bootstrap(state);
    while (true) {
      try { await loop(state); } catch (e) { console.error("[agent] loop error", String(e?.message ?? e)); }
      await new Promise(r => setTimeout(r, 5000));
    }
  } catch (e) {
    console.error("[agent] fatal", String(e?.message ?? e));
    process.exit(1);
  }
})();
