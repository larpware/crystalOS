/*
 * CrystalOS — Proton API client
 *
 * A very small, explicit client for the four Proton endpoints this integration
 * needs. Each one was taken from the extension in this repository:
 *
 *   POST auth/refresh                     account/refreshToken.ts
 *   GET  vpn/v1/browser/token?Duration=N  account/credentials/getConnectionCredentials.ts
 *   GET  vpn/v2/logicals                  vpn/fetchLogicalsV2.ts
 *   GET  vpn/v1/location                  account/getLocation.ts
 *
 * Authentication is header-based, exactly as the extension does it
 * (`account/getAuthHeaders.ts`): `x-pm-uid` plus `Authorization: Bearer …`.
 *
 * Two rules hold everywhere in this file:
 *
 *   1. Nothing that identifies a session is ever put in an error message, a
 *      thrown value or a log line. `redact()` exists so a diagnostic can name
 *      what was sent without printing the token.
 *   2. An authentication failure is reported as such rather than being retried
 *      forever. `ProtonError.needsLogout` mirrors the extension's `needsLogout`
 *      codes (2027, 2028); a 401 with code 401 means "refresh and try again",
 *      everything else is the caller's decision.
 */

import { PROTON } from "./config.mjs";

/** Sentinel so a caller can tell "no credentials yet" from "authentication failed". */
export class ProtonError extends Error {
  constructor(message, { code = null, httpStatus = null, needsLogout = false, retryable = false } = {}) {
    super(message);
    this.name = "ProtonError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.needsLogout = needsLogout;
    this.retryable = retryable;
  }
}

/** Never log a raw header object: it carries the bearer token. */
export function redact(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = /authorization|cookie|x-pm-vpn/i.test(key) ? "<redacted>" : value;
  }
  return out;
}

const LOGOUT_CODES = new Set([2027, 2028]);

/** A 401 response body is `{ Code: 401, Error: "Invalid access token" }`. */
function classify(response, body) {
  const code = typeof body?.Code === "number" ? body.Code : null;
  const message =
    typeof body?.Error === "string" && body.Error.trim() ? body.Error : `Proton answered ${response.status}.`;
  return new ProtonError(message, {
    code,
    httpStatus: response.status,
    needsLogout: code !== null && LOGOUT_CODES.has(code),
    retryable: response.status === 429 || response.status === 503,
  });
}

export function createProtonClient({ baseURL = PROTON.apiBase, fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  async function call(path, { session, method = "GET", body, headers = {}, raw = false } = {}) {
    const requestHeaders = {
      accept: "application/json",
      "x-pm-appversion": PROTON.appVersionHeader,
      ...headers,
    };
    if (session?.uid) requestHeaders["x-pm-uid"] = session.uid;
    if (session?.accessToken) requestHeaders.authorization = `Bearer ${session.accessToken}`;

    let response;
    try {
      response = await fetchImpl(new URL(path, baseURL), {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new ProtonError(
        `Could not reach Proton (${error?.name === "TimeoutError" ? "the request timed out" : "the connection failed"}).`,
        { retryable: true },
      );
    }

    if (raw) return response;

    let parsed = null;
    const text = await response.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Proton answers with HTML when a network appliance interferes. That is
        // a diagnostic, not a JSON error, so it is described rather than thrown
        // as a parse failure.
        throw new ProtonError(
          "Proton answered with something that is not JSON. A proxy, VPN or antivirus in front of this machine may be interfering.",
          { httpStatus: response.status },
        );
      }
    }

    if (!response.ok) throw classify(response, parsed);
    return parsed;
  }

  return {
    /**
     * `auth/refresh` — exchanges a refresh token for a fresh pair.
     *
     * The body is the extension's, field for field. The new tokens are returned
     * to the caller; this client never persists anything.
     */
    async refresh(session) {
      if (!session?.uid || !session?.refreshToken) {
        throw new ProtonError("There is no stored Proton session to refresh.", { needsLogout: true });
      }
      const data = await call(PROTON.refreshPath, {
        method: "POST",
        headers: { "content-type": "application/json", "x-pm-uid": session.uid },
        body: {
          UID: session.uid,
          ResponseType: "token",
          GrantType: "refresh_token",
          RefreshToken: session.refreshToken,
          RedirectURI: session.redirectURI || "https://protonvpn.com",
        },
      });
      if (!data?.AccessToken || !data?.RefreshToken) {
        throw new ProtonError("Proton did not return a usable session.", { needsLogout: true });
      }
      return {
        uid: session.uid,
        accessToken: data.AccessToken,
        refreshToken: data.RefreshToken,
        redirectURI: session.redirectURI,
      };
    },

    /**
     * `vpn/v1/browser/token` — the proxy credentials.
     *
     * The response is `{ Code: 1000, Expire, Username, Password }`. `Username` is
     * itself a JWT whose payload carries the expiry, the server groups and a
     * session id; `credentials.username` is opaque to us and is only ever used
     * as a Basic-auth username.
     */
    async browserToken(session, { durationSeconds = PROTON.tokenDurationSeconds } = {}) {
      const data = await call(`${PROTON.browserTokenPath}?Duration=${Math.floor(durationSeconds)}`, { session });
      if (data?.Code !== 1000 || !data?.Username || !data?.Password) {
        throw new ProtonError("Proton did not issue proxy credentials for this session.", {
          code: data?.Code ?? null,
        });
      }
      const expiresAt = Date.now() + Math.max(60, Number(data.Expire) || durationSeconds) * 1000;
      return { username: data.Username, password: data.Password, expiresAt };
    },

    /** `vpn/v2/logicals` — the logical server list, with a V1 fallback. */
    async logicals(session) {
      try {
        const data = await call(PROTON.logicalsPath, {
          session,
          headers: {
            "if-modified-since": "Thu, 01 Jan 1970 00:00:00 GMT",
            "x-pm-response-truncation-permitted": "true",
          },
        });
        if (Array.isArray(data?.LogicalServers)) return data.LogicalServers;
      } catch (error) {
        // A plan that cannot see V2 still has V1. Anything else is real.
        if (!(error instanceof ProtonError) || error.httpStatus === 401) throw error;
      }
      const data = await call(PROTON.logicalsV1Path, {
        session,
        headers: { "if-modified-since": "Thu, 01 Jan 1970 00:00:00 GMT" },
      });
      if (!Array.isArray(data?.LogicalServers)) {
        throw new ProtonError("Proton returned no server list for this account.");
      }
      return data.LogicalServers;
    },

    /**
     * `vpn/v1/location` — the IP, country and ISP Proton sees for this session.
     *
     * Used for the exit-IP check: called directly it reports the machine's real
     * address, called through the tunnel it reports the VPN exit. That makes it
     * a genuine end-to-end test of where the traffic actually left from, using
     * Proton's own service instead of an unrelated third-party echo endpoint.
     */
    async location(session) {
      return call(PROTON.locationPath, { session });
    },

    /** Raw request support, used for the through-tunnel verification. */
    call,
  };
}
