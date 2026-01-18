import React, { useEffect, useState } from "react";
import Keycloak from "keycloak-js";

const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL ?? "http://keycloak.edge.local:8080",
  realm: import.meta.env.VITE_KEYCLOAK_REALM ?? "edge",
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? "edge-portal"
});

const API_BASE = import.meta.env.VITE_API_BASE ?? "https://api.edge.local:8443";

export function App() {
  const [token, setToken] = useState("");
  const [devices, setDevices] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    keycloak.init({ onLoad: "login-required", pkceMethod: "S256" }).then(() => {
      setToken(keycloak.token ?? "");
      setInterval(() => keycloak.updateToken(30).then(() => setToken(keycloak.token ?? "")), 10000);
    }).catch(e => setErr(String(e)));
  }, []);

  async function refresh() {
    setErr("");
    const r = await fetch(`${API_BASE}/api/devices`, { headers: { Authorization: `Bearer ${token}` } });
    const t = await r.text();
    if (!r.ok) return setErr(`${r.status} ${t}`);
    setDevices(JSON.parse(t).devices ?? []);
  }

  async function claim(deviceId) {
    const pairingCode = prompt(`Pairing code for ${deviceId}`);
    if (!pairingCode) return;
    setErr("");
    const r = await fetch(`${API_BASE}/api/admin/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId, pairingCode })
    });
    if (!r.ok) return setErr(`${r.status} ${await r.text()}`);
    refresh();
  }

  async function task(deviceId, type) {
    const payload = type === "SET_PROXY" ? { httpProxy: "http://proxy.local:3128", httpsProxy: "http://proxy.local:3128" } : {};
    const r = await fetch(`${API_BASE}/api/admin/devices/${deviceId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, payload })
    });
    if (!r.ok) return setErr(`${r.status} ${await r.text()}`);
    alert("queued");
  }

  return (
    <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1>Edge Portal</h1>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={refresh}>Refresh devices</button>
        <button onClick={() => keycloak.logout({ redirectUri: window.location.origin })}>Logout</button>
      </div>
      {err && <pre style={{ background: "#fee", padding: 12, marginTop: 12, whiteSpace: "pre-wrap" }}>{err}</pre>}
      <h2>Devices</h2>
      {devices.length === 0 ? <div>No devices. Start agent, then Refresh.</div> : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={{ textAlign: "left" }}>deviceId</th><th style={{ textAlign: "left" }}>state</th><th>actions</th></tr></thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.deviceId}>
                <td style={{ fontFamily: "monospace" }}>{d.deviceId}</td>
                <td>{d.state}</td>
                <td>
                  {d.state === "PENDING"
                    ? <button onClick={() => claim(d.deviceId)}>Claim</button>
                    : <>
                        <button onClick={() => task(d.deviceId, "SET_PROXY")}>SET_PROXY</button>{" "}
                        <button onClick={() => task(d.deviceId, "CHECK_MICROK8S")}>CHECK_MICROK8S</button>{" "}
                        <button onClick={() => task(d.deviceId, "LIST_LXD_VMS")}>LIST_LXD_VMS</button>
                      </>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
