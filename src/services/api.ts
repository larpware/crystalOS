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
  method?: "GET" | "POST" | "PATCH" | "DELETE";
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
    const response = await fetch(`${base}${path}`, {
      method,
      credentials: "same-origin",
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
