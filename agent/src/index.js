import express from "express";
import { collectInventory } from "./collectors/inventory.js";
import { verifyKeycloakJwtFromReq, requireRealmRole } from "./security/auth.js";
import { applyProxy, validateProxyInput } from "./apply/proxy.js";
import { applyNetplan, validateNetplanInput } from "./apply/netplan.js";
import { applyLxdNetwork } from "./apply/lxd.js";
import { applyMicrok8sAddons } from "./apply/microk8s.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.AGENT_PORT || 4100);
const BIND = process.env.AGENT_BIND || "127.0.0.1";
const ISSUER = process.env.KEYCLOAK_ISSUER || "http://localhost:8081/realms/edge";
const ADMIN_ROLE = process.env.ADMIN_ROLE || "edge-admin";

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/inventory", async (req, res) => {
  try {
    await verifyKeycloakJwtFromReq(req, ISSUER);
    res.json(await collectInventory());
  } catch (e) {
    res.status(401).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/validate/proxy", async (req, res) => {
  const v = validateProxyInput(req.body);
  res.json(v);
});

app.post("/apply/proxy", async (req, res) => {
  try {
    const { payload } = await verifyKeycloakJwtFromReq(req, ISSUER);
    requireRealmRole(payload, ADMIN_ROLE);
    const result = await applyProxy(req.body);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/validate/netplan", async (req, res) => {
  const v = validateNetplanInput(req.body);
  res.json(v);
});

app.post("/apply/netplan", async (req, res) => {
  try {
    const { payload } = await verifyKeycloakJwtFromReq(req, ISSUER);
    requireRealmRole(payload, ADMIN_ROLE);
    const result = await applyNetplan(req.body);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/apply/lxd/network", async (req, res) => {
  try {
    const { payload } = await verifyKeycloakJwtFromReq(req, ISSUER);
    requireRealmRole(payload, ADMIN_ROLE);
    const result = await applyLxdNetwork(req.body);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/apply/microk8s/addons", async (req, res) => {
  try {
    const { payload } = await verifyKeycloakJwtFromReq(req, ISSUER);
    requireRealmRole(payload, ADMIN_ROLE);
    const result = await applyMicrok8sAddons(req.body);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(PORT, BIND, () => {
  console.log(`edge-agent listening on http://${BIND}:${PORT}`);
});
