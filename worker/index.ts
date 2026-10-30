/* ==========================================================================
   CrystalOS Worker entrypoint — crystalos.kiyanxp3.workers.dev

   One fetch handler, two concerns:

     1. `/api/*` is answered here. This is the fix for the broken deployment:
        without `assets.run_worker_first: ["/api/*"]` (wrangler.jsonc) the
        asset pipeline answered every API path with `index.html`, so the shell
        received HTML where it expected JSON and the whole backend read as
        "down". The entrypoint below guarantees that any request under /api
        is JSON — success, failure, or 404 — and never the SPA document.

     2. everything else falls through to the Assets pipeline, which serves
        the built shell with `not_found_handling: single-page-application`,
        so React Router deep links keep working exactly as they did on the
        static host.

   Route namespaces:

     /api/health                liveness + Supabase reachability
     /api/accounts/*            the OS's real API (src/services/api.ts)
     /api/auth/*                alias → /api/accounts/*   (register/login/…)
     /api/users/*               alias → /api/accounts/*
     /api/friends/*             alias → /api/accounts/*
     /api/chat/*                alias → /api/accounts/conversations/*
     /api/servers/*             alias → /api/accounts/*
     /api/notifications/*       alias → /api/accounts/*

   The aliases exist so the documented API structure resolves to the same
   handlers the desktop already speaks; there is one implementation, not two.
   ========================================================================== */

import type { Env } from "./env";
import { fail, handleAccounts, json } from "./accounts";
import { handleSocial } from "./social";
import { handleServers } from "./servers";

/* ==========================================================================
   CORS

   The shell is same-origin by default (`public/config.json` → `apiOrigin`
   empty), which needs no CORS at all. Headers are added only when the request
   carries an `Origin` that is either this host or one explicitly declared in
   `CRESCENT_PUBLIC_ORIGINS` (comma-separated origins/hosts, the same variable
   the Node backend uses). A third-party origin therefore gets no CORS
   headers — the browser blocks it — and mutating requests from anywhere but
   this origin are refused outright by the accounts API's own same-origin
   check (403 CROSS_ORIGIN). CORS is a browser courtesy here, never the
   authorization boundary.
   ========================================================================== */

function allowedCorsOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
  const url = new URL(request.url);
  if (host === url.host.toLowerCase()) return origin;

  const declared = String(env.CRESCENT_PUBLIC_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of declared) {
    const candidate = entry.includes("://") ? entry : `https://${entry}`;
    try {
      if (new URL(candidate).host.toLowerCase() === host) return origin;
    } catch {
      /* a malformed entry allows nothing, not everything */
    }
  }
  return null;
}

function applyCors(response: Response, request: Request, env: Env): Response {
  const allowed = allowedCorsOrigin(request, env);
  if (!allowed) return response;
  // Responses returned by an upstream fetch can have immutable headers in
  // Workers. Clone before adding CORS headers so an API/proxy request never
  // turns into a Cloudflare 1101 just because the caller included Origin.
  const withCors = new Response(response.body, response);
  withCors.headers.set("access-control-allow-origin", allowed);
  withCors.headers.set("access-control-allow-credentials", "true");
  if (!(withCors.headers.get("vary") ?? "").toLowerCase().includes("origin")) {
    withCors.headers.append("vary", "origin");
  }
  return withCors;
}

function preflight(request: Request, env: Env): Response {
  const response = new Response(null, { status: 204 });
  response.headers.set("access-control-allow-methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  response.headers.set(
    "access-control-allow-headers",
    request.headers.get("access-control-request-headers") ?? "content-type, authorization",
  );
  response.headers.set("access-control-max-age", "600");
  return applyCors(response, request, env);
}

/* ==========================================================================
   /api/health

   Answers with JSON always. Three facts, none of them secret:

     service   the Worker itself (it answered, so the runtime is fine);
     api       which route namespaces are mounted;
     supabase  whether the project URL + publishable key are configured, and
               whether the project answered a probe within 3s.

   Status: 200 when the Worker is up (including "no key configured yet", which
   is a deployment step, not an outage), 503 only when the project is
   configured but cannot be reached — a real backend failure.
   ========================================================================== */

const API_NAMESPACES = [
  "/api/health",
  "/api/accounts/*",
  "/api/auth/*",
  "/api/users/*",
  "/api/friends/*",
  "/api/chat/*",
  "/api/servers/*",
  "/api/notifications/*",
  "/api/accounts/verification/*",
];

async function probeSupabase(env: Env): Promise<{
  configured: boolean;
  url: string | null;
  reachable: boolean | null;
  status: number | null;
  message?: string;
  present: { name: string; present: boolean }[];
  acceptedBy: string | null;
  fingerprint?: { length: number; sha256: string };
  schemaReady: boolean | null;
  error?: string;
}> {
  const strip = (value: unknown) =>
    String(value ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
  const url = strip(env.SUPABASE_URL ?? env.VITE_SUPABASE_URL).replace(/\/+$/, "");
  const candidates = [
    { name: "SUPABASE_PUBLISHABLE_KEY", value: strip(env.SUPABASE_PUBLISHABLE_KEY) },
    { name: "VITE_SUPABASE_PUBLISHABLE_KEY", value: strip(env.VITE_SUPABASE_PUBLISHABLE_KEY) },
    { name: "SUPABASE_ANON_KEY", value: strip(env.SUPABASE_ANON_KEY) },
    { name: "VITE_SUPABASE_ANON_KEY", value: strip(env.VITE_SUPABASE_ANON_KEY) },
  ];
  const present = candidates.map((candidate) => ({
    name: candidate.name,
    present: candidate.value.length >= 20,
  }));
  const configured = /^https?:\/\/.+/.test(url) && candidates.some((candidate) => candidate.value.length >= 20);
  if (!configured) {
    return { configured, url: url || null, reachable: null, status: null, present, acceptedBy: null, schemaReady: null };
  }

  /* Readiness probe: `/auth/v1/health` is the endpoint that accepts a
     publishable key. The PostgREST root `/rest/v1/` now answers "Secret API
     key required" even for a perfectly valid publishable key, so probing it
     would report a healthy project as broken. Every configured candidate is
     tried until one is accepted; only variable NAMES and the project's own
     reply are ever reported — never a key. */
  let reachable: boolean | null = null;
  let status: number | null = null;
  let message: string | undefined;
  let acceptedBy: string | null = null;
  let tried: string | null = null;

  for (const candidate of candidates) {
    if (candidate.value.length < 20) continue;
    tried = candidate.value;
    try {
      const response = await fetch(`${url}/auth/v1/health`, {
        headers: { apikey: candidate.value, accept: "application/json" },
        signal: AbortSignal.timeout(3_000),
      });
      reachable = true;
      status = response.status;
      const body = await response.text();
      message = body.slice(0, 200).replace(/\s+/g, " ").trim() || undefined;
      if (response.ok) {
        acceptedBy = candidate.name;
        break;
      }
      // A rejected key means the next binding may be the live one; anything
      // else is worth reporting exactly as the project said it.
      if (/invalid api key/i.test(message ?? "")) continue;
      break;
    } catch (error) {
      console.error("health: supabase probe failed", String(error));
      return {
        configured,
        url,
        reachable: false,
        status: null,
        present,
        acceptedBy: null,
        schemaReady: null,
        error: String(error).slice(0, 300),
      };
    }
  }

  const active = tried ?? candidates.find((candidate) => candidate.name === acceptedBy)?.value ?? "";
  let fingerprint: { length: number; sha256: string } | undefined;
  let schemaReady: boolean | null = null;
  if (active && acceptedBy) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(active));
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    fingerprint = { length: active.length, sha256: hex.slice(0, 16) };

    /* Has the CrystalOS schema actually been created? PGRST205 means
       "no such table" — the migrations have not been run. Any other answer
       (200, 401, 403) means the table exists and privileges decided the
       rest, which is exactly what we want to know. */
    try {
      const check = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
        headers: { apikey: active, authorization: `Bearer ${active}`, accept: "application/json" },
        signal: AbortSignal.timeout(3_000),
      });
      const text = await check.text();
      schemaReady = !(check.status === 404 && text.includes("PGRST205"));
    } catch {
      schemaReady = null;
    }
  }
  return { configured, url, reachable, status, present, acceptedBy, message, fingerprint, schemaReady };
}

async function healthRoute(env: Env): Promise<Response> {
  const supabase = await probeSupabase(env);
  const body = {
    ok: true,
    service: "crystalos-api",
    runtime: "cloudflare-workers",
    status: supabase.reachable === false ? "degraded" : "ok",
    time: new Date().toISOString(),
    api: API_NAMESPACES,
    supabase: {
      configured: supabase.configured,
      url: supabase.url,
      reachable: supabase.reachable,
      httpStatus: supabase.status,
      detail: supabase.error ?? null,
      message: supabase.message ?? null,
      keyPresent: supabase.present,
      acceptedBy: supabase.acceptedBy,
      schemaReady: supabase.schemaReady,
      // Length + a short digest of the binding, so the operator can tell
      // "wrangler handed the Worker a different string than the build got"
      // apart from "the key itself is wrong" — without printing a key.
      fingerprint: supabase.fingerprint,
      note: supabase.configured
        ? "Publishable key is configured; authenticated calls are verified against this project."
        : "Set the SUPABASE_PUBLISHABLE_KEY Worker secret to enable sign-in and the OS API.",
    },
  };
  return json(body, { status: supabase.acceptedBy ? 200 : supabase.reachable === false ? 503 : 200 });
}

/* ==========================================================================
   API dispatch
   ========================================================================== */

/** Documented namespaces that resolve onto the accounts API's handlers. */
const ALIASES: ReadonlyArray<readonly [prefix: string, target: string]> = [
  ["/api/auth", "/api/accounts"],
  ["/api/users", "/api/accounts/users"],
  ["/api/friends", "/api/accounts/friends"],
  ["/api/chat", "/api/accounts/conversations"],
  ["/api/servers", "/api/accounts/servers"],
  ["/api/notifications", "/api/accounts/notifications"],
];

/** Rewrites an alias path to the accounts path it is served by. */
export function resolveApiPath(pathname: string): string {
  for (const [prefix, target] of ALIASES) {
    if (pathname === prefix) return target;
    if (pathname.startsWith(`${prefix}/`)) return target + pathname.slice(prefix.length);
  }
  return pathname;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/* Three handler modules, one namespace: `/api/accounts/*` is split on its
   first segment so each feature family keeps its own file while the client
   sees a single, stable API. The aliases above land in the same split. */
const SOCIAL_HEADS = new Set([
  "feed",
  "posts",
  "comments",
  "bookmarks",
  "users",
  "follow-requests",
  "store",
  "community-apps",
]);
const SERVER_HEADS = new Set(["servers", "channels", "roles", "invites", "server-messages"]);

/** 415 when a declared body content type is not JSON; otherwise null. */
function contentTypeError(request: Request): Response | null {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType) return null;
  if (contentType.toLowerCase().includes("application/json")) return null;
  return fail(415, "UNSUPPORTED_MEDIA_TYPE", "Send this request as application/json.");
}

const SCRAMJET_PATHS = [
  "/api/proxy-status",
  "/bootstrap-init.js",
  "/scram/",
  "/controller/",
  "/clients/",
  "/wisp/",
];

function isScramjetPath(pathname: string): boolean {
  return SCRAMJET_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function scramjetOrigin(env: Env): string | null {
  const raw = String(env.SCRAMJET_ORIGIN ?? "").trim().replace(/\/+$/, "");
  try {
    const origin = new URL(raw);
    return origin.protocol === "https:" ? origin.origin : null;
  } catch {
    return null;
  }
}

async function scramjetRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const origin = scramjetOrigin(env);
  if (!origin) {
    return fail(503, "SCRAMJET_NOT_CONFIGURED", "The Scramjet Node service is not configured yet.");
  }
  const target = `${origin}${url.pathname}${url.search}`;
  try {
    // Passing the original Request preserves WebSocket upgrade requests for
    // /wisp/ while keeping the Node service hidden behind this Worker origin.
    return await fetch(new Request(target, request));
  } catch {
    return fail(503, "SCRAMJET_UNREACHABLE", "The Scramjet Node service is not reachable.");
  }
}

async function apiRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method.toUpperCase() === "OPTIONS") return preflight(request, env);

  const pathname = url.pathname;
  if (pathname === "/api" || pathname === "/api/") {
    return json(
      { ok: true, service: "crystalos-api", api: API_NAMESPACES, health: "/api/health" },
      { status: 200 },
    );
  }

  if (pathname === "/api/health") return healthRoute(env);

  if (isScramjetPath(pathname)) return scramjetRoute(request, env, url);

  if (!SAFE_METHODS.has(request.method.toUpperCase())) {
    const wrongType = contentTypeError(request);
    if (wrongType) return wrongType;
  }

  const resolved = resolveApiPath(pathname);
  if (resolved === "/api/accounts" || resolved.startsWith("/api/accounts/")) {
    const target = new URL(url);
    target.pathname = resolved;
    const rest = resolved.slice("/api/accounts".length).split("/").filter(Boolean);
    const head = rest[0];
    try {
      if (head !== undefined && SOCIAL_HEADS.has(head)) {
        return await handleSocial(request, env, target, rest);
      }
      if (head !== undefined && SERVER_HEADS.has(head)) {
        return await handleServers(request, env, target, rest);
      }
      return await handleAccounts(request, env, target);
    } catch (error) {
      // Anything a route did not anticipate still has to answer as JSON.
      console.error("api error", request.method, resolved, error);
      return fail(500, "INTERNAL_ERROR", "Something went wrong handling that request.");
    }
  }

  return fail(404, "ROUTE_NOT_FOUND", `There is no ${request.method} ${pathname} on this deployment.`);
}

/* ==========================================================================
   fetch handler
   ========================================================================== */

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    let response: Response;
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      response = await apiRoute(request, env, url);
      // API answers are never cached: they carry sessions and per-user data.
      if (!response.headers.has("cache-control")) {
        response = new Response(response.body, response);
        response.headers.set("cache-control", "no-store");
      }
    } else if (isScramjetPath(url.pathname)) {
      response = await scramjetRoute(request, env, url);
    } else if (env.ASSETS) {
      // Static shell + SPA fallback, exactly as configured in wrangler.jsonc.
      response = await env.ASSETS.fetch(request);
    } else {
      response = new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    }

    return applyCors(response, request, env);
  },
};

export default worker;
