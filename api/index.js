import express from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.API_PORT || 8080);
const BIND = process.env.API_BIND || "127.0.0.1";

const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER || "http://localhost:8081/realms/edge";
const AGENT_URL = process.env.AGENT_URL || "http://127.0.0.1:4100";
const ADMIN_ROLE = process.env.ADMIN_ROLE || "edge-admin";

const JWKS = createRemoteJWKSet(new URL(`${KEYCLOAK_ISSUER}/protocol/openid-connect/certs`));

async function verifyToken(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new Error("Missing Bearer token");
  const { payload } = await jwtVerify(token, JWKS, { issuer: KEYCLOAK_ISSUER });
  return { token, payload };
}

function requireRole(payload, role) {
  const roles = payload?.realm_access?.roles || [];
  if (!roles.includes(role)) throw new Error(`Missing required role: ${role}`);
}

async function forwardToAgent(req, res, path, { requireAdmin = false } = {}) {
  try {
    const { token, payload } = await verifyToken(req);
    if (requireAdmin) requireRole(payload, ADMIN_ROLE);

    const url = `${AGENT_URL}${path}`;
    const agentRes = await fetch(url, {
      method: req.method,
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${token}`
      },
      body: req.method === "GET" ? undefined : JSON.stringify(req.body || {})
    });

    const text = await agentRes.text();
    res.status(agentRes.status);
    res.setHeader("content-type", agentRes.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (e) {
    res.status(401).json({ ok: false, error: String(e.message || e) });
  }
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/api/inventory", (req, res) => forwardToAgent(req, res, "/inventory"));
app.post("/api/validate/proxy", (req, res) => forwardToAgent(req, res, "/validate/proxy"));
app.post("/api/validate/netplan", (req, res) => forwardToAgent(req, res, "/validate/netplan"));

app.post("/api/apply/proxy", (req, res) => forwardToAgent(req, res, "/apply/proxy", { requireAdmin: true }));
app.post("/api/apply/netplan", (req, res) => forwardToAgent(req, res, "/apply/netplan", { requireAdmin: true }));
app.post("/api/apply/lxd/network", (req, res) => forwardToAgent(req, res, "/apply/lxd/network", { requireAdmin: true }));
app.post("/api/apply/microk8s/addons", (req, res) => forwardToAgent(req, res, "/apply/microk8s/addons", { requireAdmin: true }));

app.listen(PORT, BIND, () => {
  console.log(`edge-api listening on http://${BIND}:${PORT}`);
});
