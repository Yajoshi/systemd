import Keycloak from "keycloak-js";

export const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL || "/auth",
  realm: import.meta.env.VITE_KEYCLOAK_REALM || "edge",
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT || "edge-portal"
});
