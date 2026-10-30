/* ==========================================================================
   Supabase REST helpers for the Worker

   Plain `fetch` against the project's REST surface — no SDK, so the Worker
   bundle stays tiny and every call is explicit. Two credentials classes:

   * publishable key + verified user access token → queries that Row Level
     Security scopes to the user. This is the default for the OS API: the
     database, not this module, decides what a row means.
   * publishable key alone → the auth endpoints (/auth/v1/*), which accept it.

   There is no service-role key in this Worker. Privileged tables and the
   notification triggers run inside Postgres, as SECURITY DEFINER functions
   created by the migrations.
   ========================================================================== */

import type { Env } from "./env";

export interface SupabaseConfig {
  url: string;
  key: string;
}

export function supabaseConfig(env: Env): SupabaseConfig | null {
  const url = String(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "")
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2")
    .replace(/\/+$/, "");
  // Env files are frequently written with the value quoted, and a key that
  // arrives with its quotes attached is a key the project will reject. Trim
  // the wrapper the same way every other dotenv loader does before deciding
  // the configuration is broken.
  const strip = (value: unknown) =>
    String(value ?? "")
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");
  const key =
    strip(env.SUPABASE_PUBLISHABLE_KEY) ||
    strip(env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
    strip(env.SUPABASE_ANON_KEY) ||
    strip(env.VITE_SUPABASE_ANON_KEY);
  if (!/^https?:\/\/.+/.test(url) || key.length < 20) return null;
  return { url, key };
}

/** Every key-shaped binding this Worker can see, by variable NAME only. */
export function keyCandidates(env: Env): { name: string; present: boolean }[] {
  const present = (value: unknown) => String(value ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").length >= 20;
  return [
    { name: "SUPABASE_PUBLISHABLE_KEY", present: present(env.SUPABASE_PUBLISHABLE_KEY) },
    { name: "VITE_SUPABASE_PUBLISHABLE_KEY", present: present(env.VITE_SUPABASE_PUBLISHABLE_KEY) },
    { name: "SUPABASE_ANON_KEY", present: present(env.SUPABASE_ANON_KEY) },
    { name: "VITE_SUPABASE_ANON_KEY", present: present(env.VITE_SUPABASE_ANON_KEY) },
  ];
}

const REST_TIMEOUT_MS = 8_000;

export class SupabaseError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "SupabaseError";
    this.code = code;
    this.status = status;
  }
}

export interface PostgrestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** PostgREST search params, e.g. `{ id: "eq." + id }` (values spec'd as strings). */
  params?: Record<string, string>;
  body?: unknown;
  /** The user's verified access token; the [""] default calls unauthenticated RLS space. */
  token?: string;
  /** `return=representation` (default) or `minimal`. */
  representation?: boolean;
  /** Ask PostgREST for a total count (`Prefer: count=exact`). */
  count?: boolean;
}

/**
 * One PostgREST call on the shared schema. Fails with `SupabaseError` so the
 * route layer can shape the HTTP answer without re-parsing PostgREST bodies.
 */
export async function postgrest(
  config: SupabaseConfig,
  path: string,
  { method = "GET", params, body, token, representation = true, count = false }: PostgrestOptions = {},
): Promise<{ data: unknown; status: number; total: number | null }> {
  const headers: Record<string, string> = {
    apikey: config.key,
    "content-type": "application/json",
    accept: "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const prefer: string[] = [];
  if (representation) prefer.push("return=representation");
  if (count) prefer.push("count=exact");
  if (prefer.length) headers.prefer = prefer.join(", ");

  const search = new URLSearchParams(params);
  const target = `${config.url}/rest/v1/${path}${search.size ? `?${search.toString()}` : ""}`;

  let response: Response;
  try {
    response = await fetch(target, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SupabaseError("DB_UNREACHABLE", 503, `The database did not answer: ${String(error)}`);
  }

  let total: number | null = null;
  if (count) {
    const range = response.headers.get("content-range") ?? "";
    const match = /\/(\*|\d+)$/.exec(range)?.[1];
    if (match !== undefined && match !== "*") total = Number(match);
  }

  let data: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "message" in data
        ? String((data as Record<string, unknown>).message)
        : `PostgREST ${response.status}`;
    // PostgREST signals uniqueness/foreign-key failures as 4xx with a Postgres
    // code in the details; the route layer matches on constraint names.
    throw new SupabaseError("DB_ERROR", response.status, message);
  }
  return { data, status: response.status, total };
}

/* ---- auth surface -------------------------------------------------------- */

export interface AuthUser {
  id: string;
  email?: string;
  emailConfirmed: boolean;
}

/**
 * Verifies an access token by asking the project who it belongs to. This is
 * the one credential check the Worker trusts; nothing else may name a user id.
 */
export async function verifyAccessToken(
  config: SupabaseConfig,
  token: string,
): Promise<{ ok: true; user: AuthUser } | { ok: false; status: "expired" | "invalid" | "unreachable"; message?: string }> {
  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.key, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });
    if (response.ok) {
      const user = (await response.json()) as {
        id?: string;
        email?: string;
        email_confirmed_at?: string | null;
        confirmed_at?: string | null;
      };
      if (!user.id) return { ok: false, status: "invalid" };
      return {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          emailConfirmed: Boolean(user.email_confirmed_at ?? user.confirmed_at),
        },
      };
    }
    if (response.status === 401) {
      // Distinguish an expired-but-well-formed token from garbage: the
      // session layer refreshes the former and drops the latter.
      const expired = /^eyJ/.test(token) && decodeJwtClaim(token, "exp") !== undefined
        ? decodeJwtClaim(token, "exp")! < Math.floor(Date.now() / 1000)
        : false;
      return { ok: false, status: expired ? "expired" : "invalid" };
    }
    return { ok: false, status: "invalid" };
  } catch (error) {
    return { ok: false, status: "unreachable", message: String(error) };
  }
}

/** Refreshes a session; returns the new token pair (no verify — trust the 200). */
export async function refreshSession(
  config: SupabaseConfig,
  refreshToken: string,
): Promise<{ ok: true; access: string; refresh: string } | { ok: false }> {
  try {
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: config.key, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false };
    const body = (await response.json()) as { access_token?: string; refresh_token?: string };
    if (!body.access_token || !body.refresh_token) return { ok: false };
    return { ok: true, access: body.access_token, refresh: body.refresh_token };
  } catch {
    return { ok: false };
  }
}

/** Unverified decode of one numeric-ish claim; used only for expiry hints. */
function decodeJwtClaim(token: string, claim: string): number | undefined {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const value = payload?.[claim];
    return typeof value === "number" ? value : undefined;
  } catch {
    return undefined;
  }
}
