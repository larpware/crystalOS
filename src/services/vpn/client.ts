/* ==========================================================================
   VPN API client

   A thin wrapper over the shared `apiRequest`, which already handles the three
   outcomes every CrystalOS call has to survive: success, a structured server
   error, and the backend not being there at all.

   Two rules this file keeps:

     • No secret is ever logged, stored or echoed. `signIn` sends a token once,
       over the same origin, and the store keeps only the backend's non-secret
       status reply. Nothing token-shaped is written to localStorage.
     • No call invents a result. Every function returns what the controller
       answered, including `{ ok: false, error: { offline: true } }` when the
       backend is down — which the UI must render as "unreachable", never as
       "disconnected".
   ========================================================================== */

import { apiRequest, type ApiResult } from "@/services/api";
import type { RequestOptions } from "@/services/api";
import type {
  VpnCountry,
  VpnEgressVerification,
  VpnEndpointInput,
  VpnEndpointTest,
  VpnPreference,
  VpnProvider,
  VpnServerSummary,
  VpnSnapshot,
} from "./types";

export type { VpnPreference };

export const VPN_BASE = "/api/vpn";

/**
 * The one way this file reaches the backend.
 *
 * `apiRequest` defaults to the accounts base, and passing it per call is how
 * `/api/vpn/session` silently became `/api/accounts/session` — a 404 the
 * store reported as "the server is not reachable", which is the most
 * misleading possible message for a wrong URL. Injecting the base in one place
 * is what makes that mistake unrepeatable, and `client.test.mjs` pins it.
 */
function vpnRequest<T>(path: string, options: Omit<RequestOptions, "base"> = {}): Promise<ApiResult<T>> {
  return apiRequest<T>(path, { ...options, base: VPN_BASE });
}

export interface VpnDiagnostics {
  transport: { kind: string; protocol: string; scheme: string; notes: string[] };
  status: VpnSnapshot["status"];
  enforcement: boolean;
  coverage: VpnSnapshot["coverage"];
  verification: VpnSnapshot["verified"];
  error: VpnSnapshot["error"];
}

/** Long enough for a real proxy round trip, short enough to stay responsive. */
const TIMEOUT_MS = 30_000;

export function fetchStatus(): Promise<ApiResult<VpnSnapshot>> {
  // The empty path keeps the base off the URL, so this is exactly `/api/vpn`.
  return vpnRequest<VpnSnapshot>("", { timeoutMs: 8_000 });
}

export function fetchDiagnostics(): Promise<ApiResult<VpnDiagnostics>> {
  return vpnRequest<VpnDiagnostics>("/diagnostics", { timeoutMs: 8_000 });
}

export function connect(preference?: VpnPreference): Promise<ApiResult<VpnSnapshot>> {
  return vpnRequest<VpnSnapshot>("/connect", {
    method: "POST",
    body: preference ?? {},
    timeoutMs: TIMEOUT_MS,
  });
}

/**
 * One-click connect: the backend finds a working public proxy and dials it.
 *
 * The scan tests many candidates, so this gets a longer budget than a plain
 * connect — it is bounded on the backend regardless, and answered with the same
 * payload as `connect`, so the store needs no second rendering path.
 *
 *   `country` — exit through this ISO-3166 country (the picker's choice). Left
 *   out, the backend scans worldwide.
 *   `canary`  — hosts the exit must be able to reach to be preferred, so the
 *   shell passes its search engine and avoids exits that black-hole it.
 */
export function quickConnect(options: { country?: string; canary?: string[] } = {}): Promise<
  ApiResult<VpnSnapshot>
> {
  const body: { country?: string; canary?: string[] } = {};
  if (options.country) body.country = options.country;
  if (options.canary && options.canary.length > 0) body.canary = options.canary;
  return vpnRequest<VpnSnapshot>("/quick-connect", {
    method: "POST",
    body,
    timeoutMs: 90_000,
  });
}

/** The countries the exit picker offers. Static and offline; see the API note. */
export function fetchCountries(): Promise<ApiResult<{ countries: VpnCountry[]; note?: string }>> {
  return vpnRequest<{ countries: VpnCountry[]; note?: string }>("/countries", { timeoutMs: 8_000 });
}

export function disconnect(): Promise<ApiResult<VpnSnapshot>> {
  return vpnRequest<VpnSnapshot>("/disconnect", { method: "POST", body: {}, timeoutMs: TIMEOUT_MS });
}

export function reconnect(preference?: VpnPreference): Promise<ApiResult<VpnSnapshot>> {
  return vpnRequest<VpnSnapshot>("/reconnect", {
    method: "POST",
    body: preference ?? {},
    timeoutMs: TIMEOUT_MS,
  });
}

export function verifyExit(): Promise<ApiResult<VpnSnapshot & { verification: VpnEgressVerification }>> {
  return vpnRequest<VpnSnapshot & { verification: VpnEgressVerification }>("/verify", {
    method: "POST",
    body: {},
    timeoutMs: TIMEOUT_MS,
  });
}

export function fetchServers(
  refresh = false,
): Promise<ApiResult<{ servers: VpnServerSummary[]; reason?: string }>> {
  return vpnRequest<{ servers: VpnServerSummary[]; reason?: string }>(
    refresh ? "/servers?refresh=1" : "/servers",
    { timeoutMs: TIMEOUT_MS },
  );
}

export function setEnforce(enforce: boolean): Promise<ApiResult<VpnSnapshot>> {
  return vpnRequest<VpnSnapshot>("/settings", { method: "POST", body: { enforce }, timeoutMs: 8_000 });
}

/* ---- the account-free provider (the CrystalVPN app's transport) ---------------
 *
 * These four calls are the whole configuration surface for a user-supplied
 * endpoint. The credentials go one way only: into the request body, to a
 * backend that stores them in an owner-only file and never echoes them back.
 */

/** Chooses which proxy a connect attempt uses. A stored choice. */
export function setProvider(provider: VpnProvider): Promise<ApiResult<VpnSnapshot>> {
  return vpnRequest<VpnSnapshot>("/provider", { method: "POST", body: { provider }, timeoutMs: 8_000 });
}

/** Stores the endpoint the account-free provider dials. */
export function saveEndpoint(endpoint: VpnEndpointInput): Promise<ApiResult<VpnSnapshot>> {
  return vpnRequest<VpnSnapshot>("/endpoint", { method: "POST", body: { ...endpoint }, timeoutMs: 8_000 });
}

/** Removes the stored endpoint and returns the VPN to automatic selection. */
export function clearEndpoint(): Promise<ApiResult<VpnSnapshot>> {
  return vpnRequest<VpnSnapshot>("/endpoint", { method: "DELETE", timeoutMs: 8_000 });
}

/**
 * Proves an endpoint accepts a CONNECT, without touching controller state.
 *
 * This is the real test the app uses instead of loading a server catalogue: a
 * supplied endpoint has no catalogue to fetch, and the honest proof that it
 * works is the proxy's own reply to an actual CONNECT.
 */
export function testEndpoint(endpoint: VpnEndpointInput): Promise<ApiResult<VpnEndpointTest>> {
  return vpnRequest<VpnEndpointTest>("/endpoint/test", {
    method: "POST",
    body: { ...endpoint },
    timeoutMs: TIMEOUT_MS,
  });
}
