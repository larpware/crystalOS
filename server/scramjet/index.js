#!/usr/bin/env node
/*
 * CrystalOS — Scramjet backend
 *
 * This is the server half of the CrystalOS Browser / Drive / Spotify / Audiomack
 * proxying stack. It does three things:
 *
 *   1. Serves the real Scramjet client bundle, rewriter wasm, Scramjet
 *      controller scripts, Scramjet utils and the transport client from disk —
 *      see server/scramjet/assets.mjs, which prefers the vendored
 *      `scramjet-assets/` folder over node_modules. No registry, no download.
 *   2. Runs the Wisp WebSocket transport (`@mercuryworkshop/wisp-js`) that the
 *      client transport dials at /wisp/.
 *   3. Serves the built CrystalOS shell from ./dist when it exists, so the
 *      production build is one process.
 *
 * Run it with `npm run scramjet` (dev: alongside `npm run dev`) or
 * `npm run start` (production build).
 *
 * Configuration (environment variables):
 *   CRESCENT_PORT               port to listen on (default 8787)
 *   CRESCENT_HOST               interface to bind (default 127.0.0.1)
 *   CRESCENT_TRANSPORT          `epoxy` on hosted deployments, `libcurl` locally, or explicit
 *                               `libcurl`/`epoxy`
 *   CRESCENT_ALLOW_PRIVATE_IPS  `1` lets Wisp reach loopback/private addresses.
 *                               Needed to proxy sites on your own machine;
 *                               leave it off on a public deployment.
 *   CRESCENT_ACCOUNTS_DB        SQLite file for accounts (default
 *                               server/accounts/data/accounts.db)
 *   CRESCENT_SESSION_DAYS       session lifetime in days (default 30)
 *   CRESCENT_TRUST_PROXY        `1`/`0` force trusting (or not) X-Forwarded-For
 *                               for rate limiting; unset means auto — trusted
 *                               only from loopback/private proxy peers
 *   CRESCENT_PUBLIC_ORIGINS     comma-separated origins (or bare hosts) allowed
 *                               to call this backend from a different host —
 *                               enables CORS, cross-site session cookies and
 *                               proxied writes, e.g.
 *                               https://crystalos.netlify.app
 *   CRESCENT_PUBLIC_WISP_URL    public ws(s):// endpoint for the Wisp transport
 *                               when the shell lives on another origin (the
 *                               browser dials it directly)
 *   CRESCENT_SECURE_COOKIES    `1` forces the Secure attribute on cookies
 *
 * Scramjet itself is untouched: the client half of the bootstrap (registering
 * the service worker, loading the scripts above, wiring the transport) is still
 * the official `bootstrap-client.js` bundle, served verbatim by assets.mjs.
 * What used to be `bootstrap()` here is now this file plus assets.mjs, because
 * the upstream entry point re-queries npm and downloads tarballs on every
 * start — assets that this project vendors instead.
 */

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The Wisp transport server. This is the only piece of the proxying stack that
// still comes from the official packages at runtime: it terminates the client's
// WebSocket and dials the real sockets. Its options are set below.
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
// CrystalOS accounts, friend codes, friend requests and direct messages. Same
// process, same port, plain node:http + node:sqlite — no extra dependency and
// no second thing to deploy. See server/accounts/README in api.mjs.
import { createAccountsApi } from "../accounts/api.mjs";
import { createVpnApi } from "../vpn/api.mjs";
import { createRoutedTCPSocket } from "../vpn/tunnel.mjs";
import { handleDuckDuckGoRelay } from "./duckduckgo-relay.mjs";
import { createAssets, TRANSPORTS, VENDORED_DIR } from "./assets.mjs";
import { corsHeadersFor, parsePublicOrigins } from "../origins.mjs";

const PORT = Number(
  // A hosting platform's own PORT (Render, Railway, Koyeb, Northflank all
  // inject one, and some assign it at runtime) is honoured when CRESCENT_PORT
  // is not set; the local default is last. Setting CRESCENT_PORT always wins,
  // which is how `CRESCENT_PORT=8788 npm run scramjet` keeps working.
  process.env.CRESCENT_PORT ?? process.env.PORT ?? 8787,
);
// Hosted platforms expose the service through the assigned PORT and require
// the process to listen on every interface. Keep localhost for local runs,
// but make Render/other PaaS deployments work without a manual host variable.
const HOST = process.env.CRESCENT_HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const ALLOW_PRIVATE = process.env.CRESCENT_ALLOW_PRIVATE_IPS === "1";

// Epoxy uses the browser/runtime transport path that works reliably on hosted
// services. Keep libcurl for local development, but do not make Render's
// default depend on its WASM TLS stack (which produces SSL error 35 for some
// modern sites such as DuckDuckGo).
const requestedTransport = process.env.PORT
  ? "epoxy"
  : (process.env.CRESCENT_TRANSPORT ?? "libcurl");
if (!TRANSPORTS.includes(requestedTransport)) {
  process.stderr.write(
    [
      "",
      `Unknown CRESCENT_TRANSPORT: ${requestedTransport}.`,
      `Supported transports: ${TRANSPORTS.join(", ")}.`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}
const TRANSPORT = requestedTransport;

/* Render supports WebSockets on the service's public URL, but a CDN Worker
 * is not a reliable long-lived WebSocket tunnel for every client/runtime.
 * When Render provides its public URL, advertise a direct Wisp endpoint to
 * the browser automatically. An explicit value still wins for other hosts. */
const PUBLIC_WISP_URL =
  process.env.CRESCENT_PUBLIC_WISP_URL ??
  (process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "").replace(/^http:/, "ws:").replace(/^https:/, "wss:")}/wisp/`
    : undefined);

const here = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(here, "../..");
const distDir = join(projectRoot, "dist");

if (ALLOW_PRIVATE) {
  wisp.options.allow_private_ips = true;
  wisp.options.allow_loopback_ips = true;
}

/* The proxy assets — Scramjet, the controller, the utils and the transport
   client — plus the generated /bootstrap-init.js. The service worker is the
   shell's own public/sw.js, which imports the controller served here. */
const assets = createAssets({ projectRoot, transport: TRANSPORT, wispUrl: PUBLIC_WISP_URL });
const WISP_PATH = assets.config.wispPath;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
};

async function readDistFile(pathname) {
  // Resolve inside dist only; a traversal attempt falls through to the SPA
  // fallback instead of escaping the build directory.
  const target = resolve(join(distDir, normalize(pathname).replace(/^([/\\])+/, "")));
  if (!target.startsWith(distDir)) return null;
  try {
    const info = await stat(target);
    if (!info.isFile()) return null;
    return { body: await readFile(target), path: target };
  } catch {
    return null;
  }
}

async function indexHtml() {
  try {
    return await readFile(join(distDir, "index.html"));
  } catch {
    return null;
  }
}

/* Accounts live in their own SQLite file next to the server. The API is
   mounted first: it only ever claims /api/accounts/*, so the proxy and the
   built shell below are untouched. */
const accounts = createAccountsApi();

/* Proton VPN. The controller owns the connection state and the routing
   decision; this file only gives it a place to live and hands the Wisp
   transport the socket class it dials through.

   Why here and not in the browser: a proxied page never leaves from the
   browser's own connection. The service worker forwards it over the Wisp
   WebSocket to this process, which dials the real socket — so this process is
   where a proxy has to be applied for proxied browsing to be protected at all.
   A browser-side proxy setting would protect nothing. */
const vpn = createVpnApi();

/* Wisp accepts a replacement socket through the documented `conn_options` of
   `routeRequest`. The decision is made per stream, at connect time, so a
   settings change applies to the next request and never to one already in
   flight. When the user has asked for protection and the VPN is not up, the
   socket refuses to connect rather than falling back to a direct dial. */
const VpnTCPSocket = createRoutedTCPSocket({
  decide: (hostname, port) => vpn.controller.decideRoute(hostname, port),
  // A stream that had to move to another exit, or that no exit could carry, is
  // the difference between a page that loaded and one that did not — so it is
  // reported rather than silently handled.
  log: (message) => process.stderr.write(`[crescent] ${message}\n`),
});

/* Wisp reads `options.allow_udp_streams` per stream (server/filter.mjs), so a
   datagram stream is refused for as long as the VPN is enforcing. Without this
   a WebRTC or QUIC datagram could leave the machine outside the tunnel while
   the UI reported a protected connection. */
function syncWispVpnOptions() {
  const snapshot = vpn.controller.snapshot();
  const enforcing = snapshot.enabled && snapshot.enforce;
  wisp.options.allow_udp_streams = !enforcing;
}

syncWispVpnOptions();
vpn.controller.subscribe(() => {
  try {
    syncWispVpnOptions();
  } catch (error) {
    process.stderr.write(`[crescent] could not apply the VPN UDP policy: ${error?.message ?? error}\n`);
  }
});

/* Public origins (CRESCENT_PUBLIC_ORIGINS) allowed to call this backend from
   another host. CORS is applied here, once, in front of every surface —
   accounts, VPN, proxy status and the proxy assets — so no individual route
   has to know about it, and an unlisted origin receives no CORS headers at all
   (the browser then refuses its response, exactly as if the layer were absent). */
const PUBLIC_ORIGINS = parsePublicOrigins();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${HOST}:${PORT}`}`);

  const cors = corsHeadersFor(req, PUBLIC_ORIGINS);
  if (cors) {
    for (const [name, value] of Object.entries(cors)) res.setHeader(name, value);
    // Preflights are answered before any route sees them: only a configured
    // origin ever gets this far, and only for the methods and headers the
    // shell actually uses (JSON bodies, session cookies via credentials).
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-methods": "GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "600",
        "cache-control": "no-store",
      });
      res.end();
      return;
    }
  }

  if (url.pathname === "/api/proxy/duckduckgo") {
    await handleDuckDuckGoRelay(req, res, url);
    return;
  }

  if (await accounts.handle(req, res, url)) return;

  // /api/vpn/* — status, connect, disconnect, verify, servers, session.
  if (await vpn.handle(req, res, url)) return;

  // A machine-readable health check the shell uses to show an honest proxy
  // state instead of guessing why a proxied page is blank. It reports which
  // package/version each asset resolved to, so "the proxy is broken" can be
  // answered with "because scramjet.wasm is not vendored".
  if (url.pathname === "/api/proxy-status") {
    const report = await assets.report();
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(
      JSON.stringify({
        ok: true,
        scramjet: true,
        transport: TRANSPORT,
        wispPath: WISP_PATH,
        privateAddresses: ALLOW_PRIVATE,
        assets: report,
      }),
    );
    return;
  }

  // Scramjet client assets and the generated /bootstrap-init.js.
  if (await assets.serve(req, res, url.pathname)) return;

  // A plain HTTP request to the Wisp path is not something the transport can
  // answer — it only speaks WebSocket upgrades.
  if (url.pathname.startsWith(WISP_PATH)) {
    res.writeHead(426, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end(`The Wisp transport is a WebSocket endpoint: use ws:// instead of http:// on ${WISP_PATH}.\n`);
    return;
  }

  // Built shell (production). In dev, Vite serves the app and only the paths
  // above are proxied to this server.
  //
  // Never the Scramjet scope prefix: those URLs are answered by the service
  // worker. Serving the shell for one would boot a second CrystalOS inside a
  // proxied frame whenever a navigation outran the worker's activation, so
  // they are refused outright — an honest failure the client can retry.
  const underProxyScope = url.pathname.startsWith("/~");
  if ((req.method === "GET" || req.method === "HEAD") && !underProxyScope) {
    const file = await readDistFile(decodeURIComponent(url.pathname));
    if (file) {
      res.writeHead(200, {
        "content-type": CONTENT_TYPES[extname(file.path).toLowerCase()] ?? "application/octet-stream",
        // Hashed build assets are immutable; everything else revalidates.
        "cache-control": file.path.includes("assets") ? "public, max-age=31536000, immutable" : "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : file.body);
      return;
    }

    // Single-page fallback for shell routes such as /settings.
    const html = await indexHtml();
    if (html && !extname(url.pathname)) {
      res.writeHead(200, { "content-type": CONTENT_TYPES[".html"], "cache-control": "no-cache" });
      res.end(req.method === "HEAD" ? undefined : html);
      return;
    }
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end("Not found.");
});

server.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith(WISP_PATH)) {
    socket.destroy();
    return;
  }
  // wisp-js takes the raw socket here: the HTTP handler above never sees the
  // connection once it has been upgraded. `conn_options.TCPSocket` is wisp's
  // own injection point — ServerConnection resolves
  // `options.TCPSocket || NodeTCPSocket` — and it is how each stream is routed
  // through the Proton tunnel (or refused) instead of dialled directly.
  wisp.routeRequest(req, socket, head, { TCPSocket: VpnTCPSocket });
});

const hasDist = await stat(distDir)
  .then((info) => info.isDirectory())
  .catch(() => false);

/* A raw crash here is what made the dev environment so confusing: Vite kept
   serving the shell while every /api/* and /wisp/ request in its proxy log was
   refused. Say plainly what is wrong and stop. */
server.on("error", (error) => {
  const lines = [];
  if (error?.code === "EADDRINUSE") {
    lines.push(
      `CrystalOS backend could not start: ${HOST}:${PORT} is already in use.`,
      "Another copy of the backend (or another program) owns that port.",
      "",
      "  • If CrystalOS is already running, use it: `npm run dev` reuses a healthy",
      "    backend instead of starting a second one.",
      "  • To run a second, isolated backend, pick another port:",
      `      CRESCENT_PORT=8788 npm run scramjet`,
      "    and point the shell at it with CRESCENT_BACKEND_URL.",
    );
  } else if (error?.code === "EACCES") {
    lines.push(
      `CrystalOS backend could not bind ${HOST}:${PORT}: permission denied.`,
      "Ports below 1024 need privileges; use CRESCENT_PORT to pick a higher one.",
    );
  } else {
    lines.push(
      `CrystalOS backend failed to start on ${HOST}:${PORT}: ${error?.message ?? String(error)}`,
    );
  }
  process.stderr.write(`\n${lines.join("\n")}\n`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`CrystalOS Scramjet backend listening on http://${HOST}:${PORT}/\n`);
  process.stdout.write(`  transport: ${TRANSPORT}\n`);
  process.stdout.write(`  wisp:      ws://${HOST}:${PORT}${WISP_PATH}\n`);
  process.stdout.write(
    `  shell:     ${hasDist ? "serving ./dist" : "not built yet (run npm run build)"}\n`,
  );
  process.stdout.write(
    `  accounts:  /api/accounts/* \u00b7 ${accounts.store.countUsers()} registered\n`,
  );
  process.stdout.write(`  vpn:       /api/vpn/* \u00b7 ${vpn.controller.snapshot().status}\n`);
  process.stdout.write(`  database:  ${accounts.store.file}\n`);
  void reportAssets();
});

/* Which files the proxy is actually serving, and from where. A missing asset is
   reported here and in /api/proxy-status rather than failing the request later:
   the shell keeps booting, and the Browser app can say why the proxy is down. */
async function reportAssets() {
  const report = await assets.report();
  const lines = Object.entries(report.packages).map(
    ([name, entry]) => `             ${name} ${entry.version} \u2014 ${entry.source}`,
  );
  process.stdout.write(`  assets:    ${VENDORED_DIR}/, node_modules, proxy-bootstrap cache\n`);
  if (lines.length) process.stdout.write(`${lines.join("\n")}\n`);
  if (report.missing.length) {
    process.stderr.write(
      [
        "",
        "CrystalOS is missing proxy assets, so proxied pages will not load:",
        ...report.missing.map((entry) => `  \u00b7 ${entry.package}/${entry.file} (${entry.url})`),
        "",
        `  \u2022 vendor them in ${VENDORED_DIR}/<name>-<version>/package/\u2026, or`,
        "  \u2022 install the project's dependencies with \`npm install\`.",
        "",
      ].join("\n"),
    );
  }
}

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
