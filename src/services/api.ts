/* ==========================================================================
   CrystalOS accounts API client

   One small wrapper around `fetch` for the account server
   (server/accounts/api.mjs). It exists so every call site gets the same
   handling of the three things that can go wrong:

     1. the request succeeded                     -> { ok: true, data }
     2. the server answered with an error payload -> { ok: false, error: {code,message} }
     3. the server is not there at all            -> { ok: false, error: {offline: true} }

   Case 3 matters: the desktop has to stay usable when the account server is
   down, and in dev it also covers running `npm run dev` without `dev:all`.
   Sessions ride in an HttpOnly cookie, so nothing token-shaped is kept in
   JavaScript and `credentials: "same-origin"` is all the client needs.
   ========================================================================== */

import { currentOffline, offlineExplanation } from "@/services/offline";

export const ACCOUNTS_BASE = "/api/accounts";

/* ==========================================================================
   Backend origin resolution

   By default every request is same-origin: `/api/*` is answered by whatever
   host serves the shell — the Node backend in production, or the Vite proxy in
   development. Same-origin keeps session cookies on `SameSite=Lax`, needs no
   CORS, and is the path all the proxy-friendly static hosts use.

   Sometimes the shell and the account database live on different hosts (a
   static CDN in front, a long-lived Node process holding the SQLite file
   elsewhere). Rather than hardcoding a deployment URL into the build, the
   origin is resolved at runtime from `public/config.json`, which any host can
   publish or override without a rebuild:

       { "apiOrigin": "https://crystalos-api.example.com" }

   An empty or missing `apiOrigin` means "same origin", so the default is
   unchanged. A build-time `VITE_API_ORIGIN` wins over the file when present.
   The result is memoized, so the config is fetched at most once per load.
   ========================================================================== */

/** Normalises a configured value to a bare http(s) origin, or "" for none. */
function normaliseOrigin(raw: unknown): string {
  const value = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return "";
  try {
    const base = typeof window === "undefined" ? "http://localhost/" : window.location.href;
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

let backendOriginPromise: Promise<string> | null = null;

async function loadBackendOrigin(): Promise<string> {
  // A build-time override is authoritative and needs no extra request.
  const fromEnv = normaliseOrigin(import.meta.env?.VITE_API_ORIGIN);
  if (fromEnv) return fromEnv;

  if (typeof window === "undefined") return "";
  try {
    const response = await fetch("/config.json", { cache: "no-store" });
    if (!response.ok) return "";
    // A single-page host answers unknown paths with index.html; only a real
    // JSON body is treated as configuration.
    if (!(response.headers.get("content-type") ?? "").includes("application/json")) return "";
    const data = (await response.json()) as { apiOrigin?: unknown } | null;
    const origin = normaliseOrigin(data?.apiOrigin);
    // An origin identical to the page's own is the same as configuring none.
    if (!origin || origin === window.location.origin) return "";
    return origin;
  } catch {
    // No config (dev server, static host without one) — stay same-origin.
    return "";
  }
}

/**
 * The absolute origin of the CrystalOS backend, or "" when it is same-origin.
 * Memoized so `config.json` is read at most once per page load.
 */
export function backendOrigin(): Promise<string> {
  if (!backendOriginPromise) {
    backendOriginPromise = loadBackendOrigin().catch(() => "");
  }
  return backendOriginPromise;
}

export interface ApiErrorShape {
  /** Machine-readable code from the server, e.g. `FRIEND_CODE_NOT_FOUND`. */
  code: string;
  /** Human-readable message, safe to show in the UI. */
  message: string;
  /** HTTP status, or null when the request never reached the server. */
  status: number | null;
  /** True when the account server could not be reached at all. */
  offline?: boolean;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiErrorShape };

const OFFLINE_ERROR: ApiErrorShape = {
  code: "SERVER_UNREACHABLE",
  message: "The CrystalOS account server is not reachable right now.",
  status: null,
  offline: true,
};

function failure(status: number | null, code: string, message: string, offline = false): ApiResult<never> {
  return { ok: false, error: { code, message, status, offline } };
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Milliseconds before the request is abandoned. Defaults to 12s. */
  timeoutMs?: number;
  /**
   * Base path for the request. Defaults to the accounts API; the VPN client
   * passes its own so both share this error handling instead of duplicating it.
   */
  base?: string;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const { method = "GET", body, signal, timeoutMs = 12_000, base = ACCOUNTS_BASE } = options;

  /* While the OS is offline the answer is already known, so nothing is
     attempted: waiting out a twelve-second timeout only to report the same
     thing is a worse way of saying it. Every caller already handles this error
     shape, so the whole OS reports the state consistently. */
  const offline = currentOffline();
  if (offline.offline) {
    return failure(null, "OFFLINE", offlineExplanation(offline), true);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    // `base` is a path (e.g. `/api/accounts`); when the backend is on another
    // origin the resolved origin is prefixed. `include` sends the session
    // cookie on both same-origin and cross-origin requests.
    const origin = await backendOrigin();
    const response = await fetch(`${origin}${base}${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") ?? "";
    // A dev server without the backend proxies this path to the SPA, which
    // answers with HTML. Treat anything that is not JSON as "no server".
    if (!contentType.includes("application/json")) {
      return failure(
        response.status,
        "SERVER_UNREACHABLE",
        "The CrystalOS server did not answer with data.",
        true,
      );
    }

    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      const shaped = payload as { error?: { code?: string; message?: string } } | null;
      const code = shaped?.error?.code ?? "REQUEST_FAILED";
      const message = shaped?.error?.message ?? "The account server rejected that request.";
      return failure(response.status, code, message);
    }
    return { ok: true, data: payload as T };
  } catch (error) {
    if (signal?.aborted) {
      return failure(null, "REQUEST_CANCELLED", "That request was cancelled.");
    }
    void error;
    // Network failure, DNS failure, connection refused, CORS rejection — from
    // the app's point of view they are all "no account server".
    return { ok: false, error: OFFLINE_ERROR };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** Encodes path segments so ids from the server always form a safe URL. */
export function apiPath(...segments: (string | number)[]): string {
  return segments.map((segment) => `/${encodeURIComponent(String(segment))}`).join("");
}
