import React, { useEffect, useState } from "react";
import { keycloak } from "./lib/keycloak";
import { apiGet, apiPost } from "./lib/api";
import { JsonView } from "./components/JsonView";

type Tab = "inventory" | "proxy" | "netplan" | "lxd" | "microk8s";

export default function App() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [tab, setTab] = useState<Tab>("inventory");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const [proxy, setProxy] = useState({ httpProxy: "", httpsProxy: "", noProxy: "" });
  const [netplanYaml, setNetplanYaml] = useState(
    "network:\n  version: 2\n  ethernets:\n    enp0s1:\n      dhcp4: true\n"
  );
  const [lxd, setLxd] = useState({ name: "lxdbr0", config: { "ipv4.nat": "true" } as Record<string, string> });
  const [mk8s, setMk8s] = useState({ enable: ["dns"], disable: [] as string[] });

  useEffect(() => {
    keycloak
      .init({ onLoad: "login-required", pkceMethod: "S256" })
      .then((auth) => {
        setAuthenticated(auth);
        setReady(true);
      })
      .catch((e) => {
        console.error(e);
        setReady(true);
      });
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  }

  async function loadInventory() {
    await run(async () => {
      const r = await apiGet("/api/inventory");
      setResult(tryParse(r.body));
    });
  }

  function tryParse(s: string) {
    try { return JSON.parse(s); } catch { return s; }
  }

  if (!ready) return <div style={{ padding: 24 }}>Loading…</div>;
  if (!authenticated) return <div style={{ padding: 24 }}>Not authenticated.</div>;

  return (
    <div style={{ fontFamily: "system-ui", padding: 18, maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Edge Onboarding Portal</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => keycloak.logout()} disabled={busy}>Logout</button>
          <button onClick={loadInventory} disabled={busy}>Refresh Inventory</button>
        </div>
      </header>

      <nav style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {(["inventory","proxy","netplan","lxd","microk8s"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} disabled={busy} style={{ fontWeight: tab === t ? 700 : 400 }}>
            {t.toUpperCase()}
          </button>
        ))}
      </nav>

      <main style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        {tab === "inventory" && (
          <section>
            <p>Load current system settings (proxy, lan, vm, lxd, microk8s).</p>
            <button onClick={loadInventory} disabled={busy}>Load</button>
          </section>
        )}

        {tab === "proxy" && (
          <section style={{ display: "grid", gap: 8 }}>
            <h3 style={{ margin: "8px 0" }}>Proxy</h3>
            <label>HTTP Proxy <input value={proxy.httpProxy} onChange={(e)=>setProxy({ ...proxy, httpProxy: e.target.value })} style={{ width: "100%" }} /></label>
            <label>HTTPS Proxy <input value={proxy.httpsProxy} onChange={(e)=>setProxy({ ...proxy, httpsProxy: e.target.value })} style={{ width: "100%" }} /></label>
            <label>NO_PROXY <input value={proxy.noProxy} onChange={(e)=>setProxy({ ...proxy, noProxy: e.target.value })} style={{ width: "100%" }} /></label>
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={busy} onClick={() => run(async () => {
                const r = await apiPost("/api/validate/proxy", proxy);
                setResult(tryParse(r.body));
              })}>Validate</button>
              <button disabled={busy} onClick={() => run(async () => {
                const r = await apiPost("/api/apply/proxy", proxy);
                setResult(tryParse(r.body));
              })}>Apply</button>
            </div>
          </section>
        )}

        {tab === "netplan" && (
          <section style={{ display: "grid", gap: 8 }}>
            <h3 style={{ margin: "8px 0" }}>Netplan</h3>
            <textarea value={netplanYaml} onChange={(e)=>setNetplanYaml(e.target.value)} rows={12} style={{ width: "100%" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={busy} onClick={() => run(async () => {
                const r = await apiPost("/api/validate/netplan", { yaml: netplanYaml });
                setResult(tryParse(r.body));
              })}>Validate</button>
              <button disabled={busy} onClick={() => run(async () => {
                const r = await apiPost("/api/apply/netplan", { yaml: netplanYaml });
                setResult(tryParse(r.body));
              })}>Apply</button>
            </div>
          </section>
        )}

        {tab === "lxd" && (
          <section style={{ display: "grid", gap: 8 }}>
            <h3 style={{ margin: "8px 0" }}>LXD Network</h3>
            <label>Network name <input value={lxd.name} onChange={(e)=>setLxd({ ...lxd, name: e.target.value })} /></label>
            <label>Config JSON (allowlisted keys only)</label>
            <textarea
              value={JSON.stringify(lxd.config, null, 2)}
              onChange={(e)=>{
                try { setLxd({ ...lxd, config: JSON.parse(e.target.value) }); } catch { /* ignore */ }
              }}
              rows={10}
              style={{ width: "100%" }}
            />
            <button disabled={busy} onClick={() => run(async () => {
              const r = await apiPost("/api/apply/lxd/network", { name: lxd.name, config: lxd.config });
              setResult(tryParse(r.body));
            })}>Apply</button>
          </section>
        )}

        {tab === "microk8s" && (
          <section style={{ display: "grid", gap: 8 }}>
            <h3 style={{ margin: "8px 0" }}>MicroK8s Addons</h3>
            <label>Enable (comma separated)
              <input value={mk8s.enable.join(",")} onChange={(e)=>setMk8s({ ...mk8s, enable: e.target.value.split(",").map(s=>s.trim()).filter(Boolean) })} style={{ width: "100%" }} />
            </label>
            <label>Disable (comma separated)
              <input value={mk8s.disable.join(",")} onChange={(e)=>setMk8s({ ...mk8s, disable: e.target.value.split(",").map(s=>s.trim()).filter(Boolean) })} style={{ width: "100%" }} />
            </label>
            <button disabled={busy} onClick={() => run(async () => {
              const r = await apiPost("/api/apply/microk8s/addons", mk8s);
              setResult(tryParse(r.body));
            })}>Apply</button>
          </section>
        )}

        <section>
          <h3 style={{ margin: "8px 0" }}>Result</h3>
          <JsonView value={result} />
        </section>
      </main>
    </div>
  );
}
