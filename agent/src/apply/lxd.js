import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function run(cmd, args = [], timeoutMs = 20000) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024
    });
    return { ok: true, out: (stdout || "").trim(), err: (stderr || "").trim() };
  } catch (e) {
    return { ok: false, out: (e.stdout || "").toString().trim(), err: (e.stderr || e.message || "").toString().trim() };
  }
}

function tryJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

const ALLOWED_NETWORK_KEYS = new Set([
  "ipv4.address",
  "ipv4.nat",
  "ipv4.dhcp",
  "ipv6.address",
  "ipv6.nat",
  "ipv6.dhcp",
  "dns.domain",
  "bridge.mtu"
]);

function validateNetworkPatch(config) {
  const errors = [];
  if (!config || typeof config !== "object") return { ok: false, errors: ["config must be an object"] };
  for (const [k, v] of Object.entries(config)) {
    if (!ALLOWED_NETWORK_KEYS.has(k)) errors.push(`Key not allowed: ${k}`);
    if ((k.endsWith(".nat") || k.endsWith(".dhcp")) && !(v === "true" || v === "false")) {
      errors.push(`${k} must be "true" or "false"`);
    }
  }
  return { ok: errors.length === 0, errors };
}

async function lxcQuery(path) {
  const r = await run("lxc", ["query", path]);
  if (!r.ok) throw new Error(r.err || r.out || "lxc query failed");
  return JSON.parse(r.out);
}

async function lxcPut(path, obj) {
  const payload = JSON.stringify(obj);
  const r = await run("lxc", ["query", "-X", "PUT", path, "-d", payload], 30000);
  if (!r.ok) throw new Error(r.err || r.out || "lxc PUT failed");
  return r.out ? tryJson(r.out) : null;
}

export async function applyLxdNetwork(body) {
  const name = body?.name;
  const patch = body?.config;
  if (!name || typeof name !== "string") throw new Error("name is required");

  const v = validateNetworkPatch(patch);
  if (!v.ok) throw new Error(v.errors.join("; "));

  const beforeResp = await lxcQuery(`/1.0/networks/${name}`);
  const before = beforeResp.metadata;

  const updated = structuredClone(before);
  updated.config = { ...(before.config || {}), ...patch };

  await lxcPut(`/1.0/networks/${name}`, updated);

  const afterResp = await lxcQuery(`/1.0/networks/${name}`);
  const after = afterResp.metadata;

  const verify = {};
  for (const k of Object.keys(patch)) {
    verify[k] = { expected: patch[k], actual: after.config?.[k] ?? null, ok: after.config?.[k] === patch[k] };
  }

  return { name, before, after, verify };
}
