import { defineConfig, type Plugin } from "vite";
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
  `http://${process.env.CRESCENT_HOST ?? "127.0.0.1"}:${process.env.CRESCENT_PORT ?? 8787}`
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

export default defineConfig({
  plugins: [react(), backendWatch()],
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
});
