/* ==========================================================================
   Worker sessions

   The OS talks to this origin with an HttpOnly cookie, exactly as it did
   with the Node backend — `src/services/api.ts` needs `credentials:
   "same-origin"` and nothing else. The cookie carries a Supabase session
   (access + refresh token) instead of a SQLite-backed token hash; every
   request is verified against the project, and an expired access token is
   refreshed transparently so the desktop stays signed in for the token
   lifetime, not just one hour.
   ========================================================================== */

import type { Env } from "./env";
import { refreshSession, supabaseConfig, verifyAccessToken, type AuthUser } from "./supabase";

export const SESSION_COOKIE = "crescent_session";
export const REFRESH_COOKIE = "crescent_refresh";

const VERIFICATION_CACHE_TTL_MS = 30_000;
/** Cache the "this exact token is valid" answer briefly; it is a signature
    check, not a data source, so a short TTL changes nothing about trust. */
const verifiedTokens = new Map<string, number>();

interface CookiePair {
  accessToken: string;
  refreshToken?: string;
}

/** Parses the two cookies out of the header; returns null when absent. */
export function readSession(request: Request): CookiePair | null {
  const header = request.headers.get("cookie") ?? "";
  let accessToken: string | undefined;
  let refreshToken: string | undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name === SESSION_COOKIE) accessToken = value;
    if (name === REFRESH_COOKIE) refreshToken = value;
  }
  if (!accessToken || accessToken.length < 10) return null;
  return { accessToken, refreshToken };
}

function tokenCacheKey(token: string): string {
  // The token itself is what was verified; the digest is for the cache key.
  return token.split(".")[2] ?? token;
}

/** True when a token was verified recently enough that the answer can be reused. */
function recentlyVerified(token: string): boolean {
  const seen = verifiedTokens.get(tokenCacheKey(token));
  return seen !== undefined && Date.now() - seen < VERIFICATION_CACHE_TTL_MS;
}

function markVerified(token: string): void {
  verifiedTokens.set(tokenCacheKey(token), Date.now());
  if (verifiedTokens.size > 256) {
    const oldest = [...verifiedTokens.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) verifiedTokens.delete(oldest[0]);
  }
}

export type SessionAuthResult =
  | {
      ok: true;
      user: AuthUser;
      /** The verified access token (the same one the cookie carried). */
      accessToken: string;
      /** Set-Cookie values to refresh the pair on the response, if any. */
      setCookies: string[];
    }
  | { ok: false; status: "missing" | "expired" | "invalid" | "unreachable" };

/**
 * Authenticates the request from its cookies. The project itself is the only
 * authority: "the user id" here comes from a verification answer, never from
 * anything the client may write.
 */
export async function authenticate(
  request: Request,
  env: Env,
): Promise<SessionAuthResult> {
  const config = supabaseConfig(env);
  if (!config) return { ok: false, status: "unreachable" };
  const session = readSession(request);
  if (!session) return { ok: false, status: "missing" };

  if (recentlyVerified(session.accessToken)) {
    const known = userIds.get(tokenCacheKey(session.accessToken));
    if (known) {
      return { ok: true, user: { id: known, emailConfirmed: true }, accessToken: session.accessToken, setCookies: [] };
    }
  }

  const verified = await verifyAccessToken(config, session.accessToken);
  if (verified.ok) {
    markVerified(session.accessToken);
    userIds.set(tokenCacheKey(session.accessToken), verified.user.id);
    return { ok: true, user: verified.user, accessToken: session.accessToken, setCookies: [] };
  }

  if (verified.status === "unreachable") return { ok: false, status: "unreachable" };

  // Expired (or the project had a hiccup): try the refresh token once.
  if (session.refreshToken) {
    const refreshed = await refreshSession(config, session.refreshToken);
    if (refreshed.ok) {
      const recheck = await verifyAccessToken(config, refreshed.access);
      if (recheck.ok) {
        markVerified(refreshed.access);
        userIds.set(tokenCacheKey(refreshed.access), recheck.user.id);
        return {
          ok: true,
          user: recheck.user,
          accessToken: refreshed.access,
          setCookies: [
            sessionCookie(SESSION_COOKIE, refreshed.access),
            sessionCookie(REFRESH_COOKIE, refreshed.refresh),
          ],
        };
      }
    }
    return { ok: false, status: "expired" };
  }
  return { ok: false, status: verified.status === "expired" ? "expired" : "invalid" };
}

/** The verification cache also remembers the id, so cached answers stay exact. */
const userIds = new Map<string, string>();

/* ---- cookies -------------------------------------------------------------- */

export function sessionCookie(name: string, value: string): string {
  return serializeCookie(name, value, { maxAge: 60 * 60 * 24 * 30 });
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function serializeCookie(
  name: string,
  value: string,
  { maxAge }: { maxAge?: number } = {},
): string {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax"];
  if (maxAge) parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

/** Appends every Set-Cookie to a mutable Response's headers. */
export function applySetCookies(response: Response, setCookies: string[]): Response {
  for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
  return response;
}
