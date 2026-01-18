import { createRemoteJWKSet, jwtVerify } from "jose";

export async function verifyKeycloakJwtFromReq(req, issuer, { audience } = {}) {
  if (!issuer) throw new Error("KEYCLOAK_ISSUER is not set");

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new Error("Missing Bearer token");

  const jwksUrl = new URL(`${issuer}/protocol/openid-connect/certs`);
  const JWKS = createRemoteJWKSet(jwksUrl);

  const { payload } = await jwtVerify(token, JWKS, {
    issuer,
    audience: audience || undefined
  });

  return { token, payload };
}

export function requireRealmRole(payload, role) {
  const roles = payload?.realm_access?.roles || [];
  if (!roles.includes(role)) {
    throw new Error(`Missing required role: ${role}`);
  }
}
