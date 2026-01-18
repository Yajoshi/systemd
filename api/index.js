import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import Database from "better-sqlite3";
import { createRemoteJWKSet, jwtVerify } from "jose";

const PORT = Number(process.env.PORT ?? 8443);
const HOST = process.env.HOST ?? "0.0.0.0";
const DB_PATH = process.env.DB_PATH ?? "/data/edge.db";
const PKI_DIR = process.env.PKI_DIR ?? "/pki";
const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER ?? "";
const KEYCLOAK_AUDIENCE = process.env.KEYCLOAK_AUDIENCE ?? "edge-portal";

const serverKeyPath = path.join(PKI_DIR, "api.edge.local.key");
const serverCrtPath = path.join(PKI_DIR, "api.edge.local.crt");
const caCrtPath = path.join(PKI_DIR, "ca.crt");
const caKeyPath = path.join(PKI_DIR, "ca.key");

for (const f of [serverKeyPath, serverCrtPath, caCrtPath, caKeyPath]) {
  if (!fs.existsSync(f)) throw new Error(`Missing PKI file: ${f}. Run ./scripts/gen-pki.sh`);
}

const serverKey = fs.readFileSync(serverKeyPath);
const serverCrt = fs.readFileSync(serverCrtPath);
const caCrt = fs.readFileSync(caCrtPath);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    deviceId TEXT PRIMARY KEY,
    pairingCode TEXT NOT NULL,
    state TEXT NOT NULL,
    enrollmentToken TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deviceId TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    result TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);

const jwks = createRemoteJWKSet(new URL(`${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`));

async function verifyBearer(req) {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!token) throw new Error("Missing bearer token");
  const { payload } = await jwtVerify(token, jwks, { issuer: KEYCLOAK_ISSUER, audience: KEYCLOAK_AUDIENCE });
  return payload;
}

function hasRole(payload, role) {
  const roles = payload?.realm_access?.roles ?? [];
  return roles.includes(role);
}

const app = express();
app.use(morgan("tiny"));
app.use(express.json({ limit: "2mb" }));
app.use(cors({ origin: ["http://portal.edge.local:3000"] }));

app.get("/health", (_req, res) => res.json({ ok: true }));

// Agent hello (pending)
app.post("/agent/hello", (req, res) => {
  const deviceId = String(req.body?.deviceId ?? "");
  const pairingCode = String(req.body?.pairingCode ?? "");
  if (!deviceId || !pairingCode) return res.status(400).json({ error: "deviceId and pairingCode required" });

  const now = new Date().toISOString();
  const row = db.prepare("SELECT deviceId FROM devices WHERE deviceId=?").get(deviceId);
  if (!row) {
    db.prepare("INSERT INTO devices(deviceId,pairingCode,state,createdAt,updatedAt) VALUES(?,?,?,?,?)")
      .run(deviceId, pairingCode, "PENDING", now, now);
  }
  res.json({ ok: true, deviceId });
});

// Agent enroll token (after claim)
app.get("/agent/enroll", (req, res) => {
  const deviceId = String(req.query.deviceId ?? "");
  const pairingCode = String(req.query.pairingCode ?? "");
  if (!deviceId || !pairingCode) return res.status(400).json({ error: "deviceId and pairingCode required" });

  const row = db.prepare("SELECT pairingCode,state,enrollmentToken FROM devices WHERE deviceId=?").get(deviceId);
  if (!row) return res.status(404).json({ error: "Unknown device" });
  if (row.pairingCode !== pairingCode) return res.status(403).json({ error: "Pairing code mismatch" });
  if (row.state !== "CLAIMED" || !row.enrollmentToken) return res.status(409).json({ error: "Not claimed yet" });

  res.json({ enrollmentToken: row.enrollmentToken });
});

// Agent CSR -> signed cert
app.post("/agent/csr", (req, res) => {
  const deviceId = String(req.body?.deviceId ?? "");
  const enrollmentToken = String(req.body?.enrollmentToken ?? "");
  const csrPem = String(req.body?.csrPem ?? "");
  if (!deviceId || !enrollmentToken || csrPem.length < 100) return res.status(400).json({ error: "bad request" });

  const row = db.prepare("SELECT state,enrollmentToken AS t FROM devices WHERE deviceId=?").get(deviceId);
  if (!row) return res.status(404).json({ error: "Unknown device" });
  if (row.state !== "CLAIMED") return res.status(409).json({ error: "Device must be CLAIMED first" });
  if (row.t !== enrollmentToken) return res.status(403).json({ error: "Bad enrollment token" });

  // Sign CSR with openssl (clientAuth)
  const tmpDir = fs.mkdtempSync("/tmp/edge-pki-");
  const csrPath = path.join(tmpDir, `${deviceId}.csr`);
  const crtPath = path.join(tmpDir, `${deviceId}.crt`);
  const extPath = path.join(tmpDir, `${deviceId}.ext`);
  fs.writeFileSync(csrPath, csrPem, "utf-8");
  fs.writeFileSync(extPath, [
    "basicConstraints=CA:FALSE",
    "keyUsage=digitalSignature,keyEncipherment",
    "extendedKeyUsage=clientAuth",
    `subjectAltName=DNS:${deviceId}`
  ].join("\n"), "utf-8");

  const { spawnSync } = await import("node:child_process");
  const r = spawnSync("openssl", ["x509","-req","-in",csrPath,"-CA",caCrtPath,"-CAkey",caKeyPath,"-CAcreateserial","-out",crtPath,"-days","90","-sha256","-extfile",extPath]);
  if (r.status !== 0) return res.status(500).json({ error: (r.stderr || r.stdout).toString("utf-8") });

  const deviceCrtPem = fs.readFileSync(crtPath, "utf-8");
  const caCrtPem = fs.readFileSync(caCrtPath, "utf-8");

  const now = new Date().toISOString();
  db.prepare("UPDATE devices SET state=?, updatedAt=? WHERE deviceId=?").run("ENROLLED", now, deviceId);

  res.json({ deviceCrtPem, caCrtPem });
});

// Admin routes (JWT + edge-admin)
app.get("/api/devices", async (req, res) => {
  try {
    const user = await verifyBearer(req);
    if (!hasRole(user, "edge-admin")) return res.status(403).json({ error: "requires edge-admin" });
    const devices = db.prepare("SELECT deviceId,state,createdAt,updatedAt FROM devices ORDER BY createdAt DESC").all();
    res.json({ devices });
  } catch (e) {
    res.status(401).json({ error: String(e?.message ?? e) });
  }
});

app.post("/api/admin/claim", async (req, res) => {
  try {
    const user = await verifyBearer(req);
    if (!hasRole(user, "edge-admin")) return res.status(403).json({ error: "requires edge-admin" });

    const deviceId = String(req.body?.deviceId ?? "");
    const pairingCode = String(req.body?.pairingCode ?? "");
    if (!deviceId || !pairingCode) return res.status(400).json({ error: "deviceId and pairingCode required" });

    const row = db.prepare("SELECT pairingCode,state FROM devices WHERE deviceId=?").get(deviceId);
    if (!row) return res.status(404).json({ error: "Unknown device" });
    if (row.state !== "PENDING") return res.status(409).json({ error: `not PENDING (state=${row.state})` });
    if (row.pairingCode !== pairingCode) return res.status(403).json({ error: "Pairing code mismatch" });

    const token = crypto.randomBytes(24).toString("hex");
    const now = new Date().toISOString();
    db.prepare("UPDATE devices SET state=?, enrollmentToken=?, updatedAt=? WHERE deviceId=?").run("CLAIMED", token, now, deviceId);
    res.json({ ok: true });
  } catch (e) {
    res.status(401).json({ error: String(e?.message ?? e) });
  }
});

app.post("/api/admin/devices/:deviceId/tasks", async (req, res) => {
  try {
    const user = await verifyBearer(req);
    if (!hasRole(user, "edge-admin")) return res.status(403).json({ error: "requires edge-admin" });

    const deviceId = String(req.params.deviceId);
    const type = String(req.body?.type ?? "");
    const payload = req.body?.payload ?? {};
    const allowed = ["SET_PROXY","CHECK_MICROK8S","LIST_LXD_VMS"];
    if (!allowed.includes(type)) return res.status(400).json({ error: "unsupported task type" });

    const now = new Date().toISOString();
    db.prepare("INSERT INTO tasks(deviceId,type,payload,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?)")
      .run(deviceId, type, JSON.stringify(payload), "QUEUED", now, now);
    res.json({ ok: true });
  } catch (e) {
    res.status(401).json({ error: String(e?.message ?? e) });
  }
});

// mTLS routes
function requireMtls(req, res, next) {
  if (!req.socket.authorized) return res.status(401).json({ error: "mTLS required" });
  next();
}

app.post("/agent/mtls/heartbeat", requireMtls, (req, res) => res.json({ ok: true }));

app.post("/agent/mtls/tasks/poll", requireMtls, (req, res) => {
  const deviceId = String(req.body?.deviceId ?? "");
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  const tasks = db.prepare("SELECT id,type,payload FROM tasks WHERE deviceId=? AND status='QUEUED' ORDER BY createdAt ASC LIMIT 5").all(deviceId);
  const now = new Date().toISOString();
  const stmt = db.prepare("UPDATE tasks SET status='RUNNING', updatedAt=? WHERE id=?");
  for (const t of tasks) stmt.run(now, t.id);

  res.json({ tasks: tasks.map(t => ({ id: t.id, type: t.type, payload: JSON.parse(t.payload) })) });
});

app.post("/agent/mtls/tasks/report", requireMtls, (req, res) => {
  const deviceId = String(req.body?.deviceId ?? "");
  const taskId = Number(req.body?.taskId ?? 0);
  const status = String(req.body?.status ?? "");
  const result = req.body?.result ?? null;
  if (!deviceId || !taskId || !["DONE","FAILED"].includes(status)) return res.status(400).json({ error: "bad request" });

  const now = new Date().toISOString();
  db.prepare("UPDATE tasks SET status=?, result=?, updatedAt=? WHERE id=? AND deviceId=?").run(status, JSON.stringify(result), now, taskId, deviceId);
  res.json({ ok: true });
});

https.createServer({ key: serverKey, cert: serverCrt, ca: caCrt, requestCert: true, rejectUnauthorized: false }, app)
  .listen(PORT, HOST, () => console.log(`API: https://${HOST}:${PORT}`));
