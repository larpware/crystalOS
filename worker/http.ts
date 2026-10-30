/* ==========================================================================
   Shared HTTP helpers for the CrystalOS Worker

   Small enough to be boring, which is the point: every route answers the
   same way (JSON envelope, no-store, one error shape), so the shell's
   `src/services/api.ts` never has to special-case a route.
   ========================================================================== */

import { SupabaseError } from "./supabase";

/** The success/failure envelope the desktop already understands. */
export function json(body: unknown, init: { status?: number; setCookies?: string[] } = {}): Response {
  const response = Response.json(body, { status: init.status ?? 200 });
  for (const cookie of init.setCookies ?? []) response.headers.append("set-cookie", cookie);
  response.headers.set("cache-control", "no-store");
  return response;
}

/** `{ ok: false, error: { code, message } }` with an HTTP status. */
export function fail(status: number, code: string, message: string): Response {
  return json({ ok: false, error: { code, message } }, { status });
}

/** Strips control characters from anything that came from a request body. */
export function cleanText(value: unknown): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

/** Parses a JSON body, tolerating an empty or malformed one as `{}`. */
export async function bodyAsJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** An ISO timestamp (or anything date-ish) as epoch milliseconds. */
export function ms(iso: string | null | undefined): number {
  return iso ? Date.parse(iso) || 0 : 0;
}

/** PostgREST's `or=(a,b)` filter value — clauses must be parenthesised. */
export function orFilter(clauses: string[]): string {
  return `(${clauses.join(",")})`;
}

/** True when PostgREST reported a violation of the named constraint. */
export function constraintError(error: unknown, name: string): boolean {
  return (
    error instanceof SupabaseError &&
    /violates unique constraint/i.test(error.message) &&
    error.message.includes(name)
  );
}

/** `before` (epoch ms, as the shell paginates) → a PostgREST `lt.` instant. */
export function isoFromMs(value: unknown): string | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(numeric).toISOString();
}

/** A bounded integer query parameter. */
export function intParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = Number(url.searchParams.get(name) ?? "");
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}
