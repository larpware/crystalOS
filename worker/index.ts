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

const EPOXY_COMPAT_POSTLUDE = `
;(function () {
  if (typeof window === "undefined" || !window.EpoxyTransport) return;
  const exported = window.EpoxyTransport;
  if (exported.EpoxyClient?.__crystalDuckDuckGoRelay) return;
  const current = exported.EpoxyClient;
  const Transport = current?.__crystalHybridTransport
    ? current
    : (typeof exported === "function" ? exported : exported.default);
  if (typeof Transport !== "function") throw new Error("The Epoxy browser transport export is unavailable.");
  class CrystalEpoxyTransport extends Transport {
    async request(remote, method, body, headers, signal) {
      const hostname = String(remote?.hostname ?? "").toLowerCase();
      const duckDomain = hostname === "duckduckgo.com" || hostname.endsWith(".duckduckgo.com") || hostname === "duck.com" || hostname.endsWith(".duck.com");
      if (!duckDomain || typeof location === "undefined" || !location.origin) {
        return super.request(remote, method, body, headers, signal);
      }

      const relay = new URL("/api/proxy/duckduckgo", location.origin);
      relay.searchParams.set("url", remote.href);
      const relayHeaders = new Headers();
      const cookies = [];
      let userAgent = "";
      for (const [name, value] of headers ?? []) {
        const key = String(name).toLowerCase();
        if (key === "cookie") cookies.push(String(value));
        else if (key === "user-agent") userAgent = String(value);
        else if (!["host", "content-length", "connection", "transfer-encoding", "accept-encoding", "x-crystal-upstream-cookie", "x-crystal-upstream-user-agent"].includes(key)) relayHeaders.append(name, value);
      }
      if (cookies.length) relayHeaders.set("x-crystal-upstream-cookie", cookies.join("; "));
      if (userAgent) relayHeaders.set("x-crystal-upstream-user-agent", userAgent);

      const relayMethod = String(method || "GET").toUpperCase();
      const init = { method: relayMethod, headers: relayHeaders, redirect: "manual", signal };
      if (relayMethod !== "GET" && relayMethod !== "HEAD" && body != null) {
        init.body = body;
        init.duplex = "half";
      }
      const response = await fetch(relay, init);
      const responseHeaders = [];
      response.headers.forEach((value, name) => {
        if (name.toLowerCase() !== "x-crystal-upstream-set-cookie") responseHeaders.push([name, value]);
      });
      try {
        const setCookies = JSON.parse(response.headers.get("x-crystal-upstream-set-cookie") || "[]");
        if (Array.isArray(setCookies)) for (const cookie of setCookies) responseHeaders.push(["set-cookie", String(cookie)]);
      } catch {}
      return { body: response.body, headers: responseHeaders, status: response.status, statusText: response.statusText };
    }
  }
  Object.defineProperty(CrystalEpoxyTransport, "__crystalDuckDuckGoRelay", { value: true });
  exported.EpoxyClient = CrystalEpoxyTransport;
})();
`;

const DUCKDUCKGO_HOSTS = ["duckduckgo.com", "duck.com"];

function isDuckDuckGoHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return DUCKDUCKGO_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** DuckDuckGo closes the TLS handshake from the Render Wisp egress. Fetch it
 * through this Worker instead; the destination is strictly allowlisted so this
 * route cannot become a general-purpose open proxy. */
async function duckDuckGoRelay(request: Request, url: URL): Promise<Response> {
  const method = request.method.toUpperCase();
  if (!["GET", "HEAD", "POST"].includes(method)) {
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, { status: 405 });
  }

  let target: URL;
  try {
    const raw = url.searchParams.get("url") ?? "";
    if (!raw || raw.length > 12_000) throw new Error("invalid URL length");
    target = new URL(raw);
  } catch {
    return json({ ok: false, error: "INVALID_TARGET" }, { status: 400 });
  }
  if (target.protocol !== "https:" || !isDuckDuckGoHost(target.hostname) || target.username || target.password || (target.port && target.port !== "443")) {
    return json({ ok: false, error: "TARGET_NOT_ALLOWED" }, { status: 403 });
  }

  const headers = new Headers(request.headers);
  const upstreamCookie = headers.get("x-crystal-upstream-cookie");
  const upstreamUserAgent = headers.get("x-crystal-upstream-user-agent");
  for (const name of [...headers.keys()]) {
    const key = name.toLowerCase();
    if (key === "host" || key === "content-length" || key === "connection" || key === "transfer-encoding" || key === "accept-encoding" || key === "cookie" || key.startsWith("cf-") || key.startsWith("x-forwarded-") || key === "x-real-ip" || key.startsWith("x-crystal-upstream-")) {
      headers.delete(name);
    }
  }
  if (upstreamCookie) headers.set("cookie", upstreamCookie);
  if (upstreamUserAgent) headers.set("user-agent", upstreamUserAgent);

  try {
    const init: RequestInit = { method, headers, redirect: "manual", signal: request.signal };
    if (method !== "GET" && method !== "HEAD" && request.body) init.body = request.body;
    const upstream = await fetch(target, init);
    const responseHeaders = new Headers(upstream.headers);
    const cloudflareHeaders = upstream.headers as Headers & { getAll?: (name: string) => string[] };
    const setCookies = cloudflareHeaders.getAll?.("set-cookie") ?? [];
    responseHeaders.delete("set-cookie");
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("transfer-encoding");
    if (setCookies.length) responseHeaders.set("x-crystal-upstream-set-cookie", JSON.stringify(setCookies));
    responseHeaders.set("cache-control", "no-store");
    return new Response(method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return json({ ok: false, error: "DUCKDUCKGO_UPSTREAM_FAILED" }, { status: 502 });
  }
}

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
    const response = await fetch(new Request(target, request));
    if (url.pathname !== "/clients/epoxy-client.js" || !response.ok || request.method === "HEAD") {
      return response;
    }
    const source = await response.text();
    const patched = source + EPOXY_COMPAT_POSTLUDE;
    const headers = new Headers(response.headers);
    headers.set("content-length", String(new TextEncoder().encode(patched).length));
    headers.set("cache-control", "no-store");
    return new Response(patched, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return fail(503, "SCRAMJET_UNREACHABLE", "The Scramjet Node service is not reachable.");
  }
}

async function apiRoute(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method.toUpperCase() === "OPTIONS") return preflight(request, env);

  const pathname = url.pathname;
  if (pathname === "/api/proxy/duckduckgo") return duckDuckGoRelay(request, url);
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
