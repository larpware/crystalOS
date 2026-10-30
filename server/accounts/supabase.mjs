/* ==========================================================================
   Supabase token verification (server side)

   The backend never trusts an id the client names. When a request carries a
   Supabase access token — register and login through Supabase Auth do — the
   token itself is verified HERE, against the project's own /auth/v1/user
   endpoint, and the authenticated user id comes from the verification
   result, never from the body.

   Verification uses the publishable key: /auth/v1/user validates exactly the
   credential it was given and reveals nothing beyond the user the token
   belongs to. Service-role credentials are not used and not wanted here.

   Env:
     SUPABASE_URL                    project URL (preferred server-side name)
     VITE_SUPABASE_URL                also accepted (same value everywhere)
     SUPABASE_PUBLISHABLE_KEY         publishable key
     VITE_SUPABASE_PUBLISHABLE_KEY    also accepted
     SUPABASE_ANON_KEY                older name, also accepted
   ========================================================================== */

const URL_KEYS = ["SUPABASE_URL", "VITE_SUPABASE_URL", "CRESCENT_SUPABASE_URL"];
const KEY_KEYS = [
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "CRESCENT_SUPABASE_KEY",
];

/** Explicit "" or null clears the cache, which tests use. */
let configCache;

export function supabaseConfig(env = process.env) {
  if (configCache !== undefined) return configCache;
  let url, key;
  for (const name of URL_KEYS) {
    if (typeof env[name] === "string" && env[name].trim()) { url = env[name].trim(); break; }
  }
  for (const name of KEY_KEYS) {
    if (typeof env[name] === "string" && env[name].trim()) { key = env[name].trim(); break; }
  }
  const ok = /^https?:\/\/.+/.test(url ?? "") && (key ?? "").length > 20;
  configCache = ok ? { url, publishableKey: key } : null;
  return configCache;
}

export function resetSupabaseConfigForTests(value) {
  configCache = value ?? undefined;
}

/** A decoded-look JWT carries three base64 parts; this never reads claims
    — the only source of truth is the project endpoint's answer. */
export function looksLikeJwt(token) {
  return typeof token === "string" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}

/**
 * Verifies an access token against the project. Returns
 *   { ok: true, id, email, emailConfirmed }
 * or { ok: false, code: <"MISSING"|"FORMAT"|"UNREACHABLE"|"UNAUTHORIZED">, ... }
 * Network failures are distinct from auth failures so callers can answer
 * 503 rather than 401 for an outage.
 */
export async function verifySupabaseToken(token, { env = process.env, fetchImpl = fetch } = {}) {
  const config = supabaseConfig(env);
  if (!config) return { ok: false, code: "NOT_CONFIGURED" };
  if (!looksLikeJwt(token)) return { ok: false, code: "FORMAT" };

  try {
    const endpoint = `${config.url.replace(/\/+$/, "")}/auth/v1/user`;
    const response = await fetchImpl(endpoint, {
      headers: {
        authorization: `Bearer ${token}`,
        apikey: config.publishableKey,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: "UNAUTHORIZED" };
    }
    if (response.status === 429) {
      return { ok: false, code: "RATE_LIMITED" };
    }
    if (!response.ok) {
      return { ok: false, code: "UNAVAILABLE", status: response.status };
    }

    const user = await response.json();
    if (typeof user?.id !== "string" || !user.id) {
      return { ok: false, code: "UNAVAILABLE" };
    }
    return {
      ok: true,
      id: user.id,
      email: typeof user.email === "string" ? user.email : undefined,
      emailConfirmed: user.email_confirmed_at != null || user.confirmed_at != null,
    };
  } catch (error) {
    return { ok: false, code: "UNREACHABLE", message: error?.message };
  }
}
