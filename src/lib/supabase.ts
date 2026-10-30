import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* ==========================================================================
   Supabase — the one client

   Every Supabase conversation in the OS goes through this module. One client,
   one bundle of env resolution, and a `hasSupabaseConfig` probe so the shell
   can degrade honestly when the project has not been wired up yet.

   The publishable key is safe in the browser: what it can do is defined by
   Row Level Security on the server, not by secrecy (see docs/SUPABASE.md).
   No service-role key belongs anywhere in src/.
   ========================================================================== */

/** Variables that may carry the project URL, most specific first. */
const URL_VARS = ["VITE_SUPABASE_URL"] as const;
/** Variables that may carry the publishable (anon) key. */
const KEY_VARS = [
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_ANON_KEY",
] as const;

function readEnv(name: string): string {
  const value = (import.meta.env as Record<string, unknown>)?.[name];
  return typeof value === "string" ? value.trim() : "";
}

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

let cachedConfig: SupabaseConfig | null | undefined;

function resolveConfig(): SupabaseConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const url = URL_VARS.map(readEnv).find(Boolean) ?? "";
  const publishableKey = KEY_VARS.map(readEnv).find(Boolean) ?? "";
  // A URL without a key (or with a placeholder) would only produce opaque
  // auth errors later; report "not configured" in that case so the shell
  // uses the local account server instead.
  const usable =
    /^https?:\/\/.+/.test(url) && publishableKey.length > 20 && !/^(PASTE|YOUR|EXAM)/i.test(publishableKey);
  cachedConfig = usable ? { url, publishableKey } : null;
  return cachedConfig;
}

/** True when the shell has the two values needed to reach the project. */
export function hasSupabaseConfig(): boolean {
  return resolveConfig() !== null;
}

export function supabaseConfig(): SupabaseConfig | null {
  return resolveConfig();
}

let client: SupabaseClient | undefined;

/** The shared client; created at most once, lazily, on first use. */
export function getSupabase(): SupabaseClient {
  const config = resolveConfig();
  if (!config) throw new Error("Supabase is not configured (missing VITE_SUPABASE_URL / key).");
  client ??= createClient(config.url, config.publishableKey, {
    auth: {
      // The OS mints its own cookie session on the account server; the
      // browser-held Supabase session lives in localStorage for the
      // evidence it carries, not as the OS login.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    // Requests go to the project domain directly; nothing here assumes the
    // Supabase URL is same-origin.
  });
  return client;
}

/** Signs into the id, awaiting the session — the call sites want the token. */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string; accessToken?: string; userId?: string }> {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error ?? !data.session) {
    return { ok: false, error: error?.message ?? "Could not sign in with Supabase." };
  }
  return { ok: true, accessToken: data.session.access_token, userId: data.user.id };
}
