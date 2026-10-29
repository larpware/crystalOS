/* CrystalOS — public origins shared by every backend surface
 *
 * The shell and this backend do not always share a host. Three situations put
 * a different origin in front of a request:
 *
 *   1. a reverse proxy or CDN rewrite (Netlify's `/api/*` proxy) — `Origin` is
 *      the public site, `Host` is whatever the proxy forwards;
 *   2. the shell is served from a static host that cannot proxy at all, so the
 *      browser calls this backend directly (CORS);
 *   3. everything is on one host — no configuration needed at all.
 *
 * Cases 1 and 2 are declared explicitly, once, in `CRESCENT_PUBLIC_ORIGINS`:
 * a comma-separated list of origins (or bare hosts) that may send cross-origin
 * requests and receive CORS headers. Everything not listed is refused exactly
 * as before, so enabling a proxy never opens the API to third-party sites.
 *
 *   CRESCENT_PUBLIC_ORIGINS=https://crystalos.netlify.app,crystalos.example.com
 *
 * Read per instance (not at module load) so tests and reconfiguration behave
 * the same way as the accounts API's other environment inputs.
 */

/**
 * Parses `CRESCENT_PUBLIC_ORIGINS` (or a supplied string) into a set of
 * lowercase `host[:port]` entries. Malformed entries are ignored rather than
 * silently allowing everything.
 * @param {string} [raw]
 * @returns {Set<string>}
 */
export function parsePublicOrigins(raw = process.env.CRESCENT_PUBLIC_ORIGINS) {
  const hosts = new Set();
  for (const entry of String(raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const candidate = entry.includes("://") ? entry : `https://${entry}`;
    try {
      hosts.add(new URL(candidate).host.toLowerCase());
    } catch {
      /* ignored on purpose — a bad entry allows nothing, not everything */
    }
  }
  return hosts;
}

/**
 * The `Origin` of `req` when that origin is on the allow-list, else null.
 * Used both for the cross-site cookie decision (accounts) and for CORS
 * headers (server shell).
 * @param {{ headers: Record<string, string | string[] | undefined> }} req
 * @param {Set<string>} allowed
 * @returns {string | null}
 */
export function allowedOrigin(req, allowed) {
  if (allowed.size === 0) return null;
  const origin = req.headers.origin;
  if (!origin) return null;
  try {
    const host = new URL(origin).host.toLowerCase();
    return allowed.has(host) ? origin : null;
  } catch {
    return null;
  }
}

/**
 * True when the request arrived with an allow-listed origin that differs from
 * the host this server saw — i.e. the browser treats the call as cross-site,
 * so the session cookie has to be `SameSite=None` to survive it.
 * @param {{ headers: Record<string, string | string[] | undefined> }} req
 * @param {Set<string>} allowed
 */
export function isCrossSiteRequest(req, allowed) {
  const origin = allowedOrigin(req, allowed);
  if (!origin) return false;
  const host = forwardedHost(req);
  try {
    return new URL(origin).host.toLowerCase() !== host;
  } catch {
    return false;
  }
}

/**
 * The host the *browser* addressed.
 *
 * A reverse proxy may rewrite `Host` to its own upstream target while recording
 * the original in `x-forwarded-host`; the cookie jar only ever saw the
 * original. A browser cannot set `x-forwarded-host` on a simple request (it
 * would trigger a CORS preflight, which only configured origins pass), so
 * trusting it here does not open a spoofing path.
 * @param {{ headers: Record<string, string | string[] | undefined> }} req
 * @returns {string} lowercase `host[:port]`, "" when unknown
 */
export function forwardedHost(req) {
  const raw = req.headers["x-forwarded-host"] ?? req.headers.host ?? "";
  return String(Array.isArray(raw) ? raw[0] : raw)
    .split(",")[0]
    .trim()
    .toLowerCase();
}

/**
 * CORS response headers for an allow-listed cross-origin request, or null when
 * the request does not need them (no origin, or an origin that is not
 * configured — in which case the browser will refuse the response itself).
 * @param {{ headers: Record<string, string | string[] | undefined> }} req
 * @param {Set<string>} allowed
 */
export function corsHeadersFor(req, allowed) {
  const origin = allowedOrigin(req, allowed);
  if (!origin) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    vary: "Origin",
  };
}
