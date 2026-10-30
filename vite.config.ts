import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/* Scramjet backend (server/scramjet/index.js). The proxied pages live in the
   shell's origin, so the service worker, the client assets and the Wisp socket
   all have to be reachable from the dev server. The same backend also hosts the
   accounts API (server/accounts/api.mjs), which is why /api/accounts is
   proxied here too.

   `npm run dev` (server/dev.mjs) starts — or reuses — that backend and only
   then starts this server, so the origin below is normally already answering.
   Server/proxy timeouts keep a backend that stops mid-request from leaving the
   shell waiting forever. */
const backend = (
  process.env.CRESCENT_BACKEND_URL ??
  // Same precedence as the backend listener and the health probe: an explicit
  // CRESCENT_PORT, else a platform PORT, else the local default.
  `http://${process.env.CRESCENT_HOST ?? "127.0.0.1"}:${process.env.CRESCENT_PORT ?? process.env.PORT ?? 8787}`
).replace(/\/+$/, "");

/**
 * One clear warning when the frontend is started without a backend.
 *
 * Running Vite on its own is a supported thing to do (`npm run dev:vite`), but
 * without the backend every proxied path fails, and the only trace of it is a
 * stream of `http proxy error: connect ECONNREFUSED` lines from the proxy
 * middleware. This says what is missing and how to start it, once.
 */
function backendWatch(): Plugin {
  return {
    name: "crescent:backend-watch",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", async () => {
        try {
          const response = await fetch(`${backend}/api/proxy-status`, {
            signal: AbortSignal.timeout(1500),
            headers: { accept: "application/json" },
          });
          if (response.ok) return;
        } catch (error) {
          void error;
        }
        server.config.logger.warn(
          [
            "",
            `[crescent] no Crescent backend answered on ${backend}.`,
            "  /api/*, /wisp/, /scram/*, /controller/*, /clients/* and /bootstrap-init.js",
            "  will fail with ECONNREFUSED until it is running.",
            "  Start the whole environment with `npm run dev`, or just the backend with `npm run scramjet`.",
            "",
          ].join("\n"),
        );
      });
    },
  };
}

/**
 * Refuses the Scramjet scope prefix in dev.
 *
 * Proxied pages live under /~/… and are answered by the service worker. When
 * a frame's first navigation outruns the worker's activation, the request
 * reaches this server instead — and the SPA fallback would serve index.html,
 * booting a whole nested CrystalOS inside the frame. Nothing legitimate asks
 * the dev server for these paths, so they are refused outright.
 */
function scramjetScopeGuard(): Plugin {
  return {
    name: "crescent:scramjet-scope-guard",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/~")) return next();
        res.statusCode = 404;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.end(
          "The Scramjet proxy prefix is answered by the service worker, not the dev server.\n",
        );
      });
    },
  };
}

/* ==========================================================================
   Supabase wiring for the shell

   `src/lib/supabase.ts` reads VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
   by name. The project's own environment spells them without the VITE_ prefix
   (SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY — the same names the Worker and the
   Node backend use), and Vite only exposes VITE_* keys to the browser, so a
   build out of this repo shipped a shell that reported "Supabase is not
   configured" no matter what was set.

   This block forwards the two *public* values by name, which is exactly what
   a bundle is allowed to carry: the publishable key is designed to be readable
   by any browser, and authority comes from RLS, not from hiding it.

   `loadEnv` is called with an explicit prefix list, so SUPABASE_SECRET_KEY and
   every other secret in the environment is never read, never defined, and
   never reaches the bundle — plus a belt-and-braces refusal below if a secret
   shaped value ever arrives anyway.
   ========================================================================== */

const PUBLIC_ENV_PREFIXES = [
  "VITE_",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
];

/** A secret-shaped value must never be inlined into a public bundle. */
function publicOnly(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^sb_secret_/i.test(trimmed)) return "";
  return trimmed;
}

function supabaseDefine(mode: string): Record<string, string> {
  const env = loadEnv(mode, ".", PUBLIC_ENV_PREFIXES);
  const url = publicOnly(env.VITE_SUPABASE_URL || env.SUPABASE_URL || "");
  const key = publicOnly(
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      env.SUPABASE_PUBLISHABLE_KEY ||
      env.VITE_SUPABASE_ANON_KEY ||
      env.SUPABASE_ANON_KEY ||
      "",
  );
  const anon = publicOnly(env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "");
  return {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(url),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(key),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(anon),
  };
}

export default defineConfig(({ mode }) => ({
  define: supabaseDefine(mode),
  plugins: [react(), backendWatch(), scramjetScopeGuard()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5273,
    strictPort: false,
    host: "127.0.0.1",
    proxy: {
      // Accounts keep the original Host header on purpose: the API rejects
      // cross-origin writes by comparing Origin with Host, and a rewritten
      // Host would make every dev request look cross-origin. Cookies are
      // unaffected — they are scoped to the host, not the port.
      "/api/accounts": { target: backend, timeout: 30_000, proxyTimeout: 30_000 },
      "/api/proxy-status": { target: backend, changeOrigin: true, timeout: 15_000, proxyTimeout: 15_000 },
      // Proton VPN control surface. Origin is left alone so the API's
      // same-origin write check compares against the host the shell actually
      // used, exactly as the accounts routes above do.
      "/api/vpn": { target: backend, timeout: 60_000, proxyTimeout: 60_000 },
      "/bootstrap-init.js": { target: backend, changeOrigin: true, timeout: 30_000, proxyTimeout: 30_000 },
      "/scram": { target: backend, changeOrigin: true, timeout: 30_000, proxyTimeout: 30_000 },
      "/controller": { target: backend, changeOrigin: true, timeout: 30_000, proxyTimeout: 30_000 },
      "/clients": { target: backend, changeOrigin: true, timeout: 30_000, proxyTimeout: 30_000 },
      // The Wisp transport for proxied pages. Long-lived, so no timeout here.
      "/wisp/": { target: backend, ws: true, changeOrigin: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
}));
