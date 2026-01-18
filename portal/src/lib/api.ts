import { keycloak } from "./keycloak";

async function ensureToken() {
  if (!keycloak.authenticated) throw new Error("Not authenticated");
  await keycloak.updateToken(30);
  return keycloak.token;
}

export async function apiGet(path: string) {
  const token = await ensureToken();
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

export async function apiPost(path: string, body: any) {
  const token = await ensureToken();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}
