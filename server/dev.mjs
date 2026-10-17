#!/usr/bin/env node
/*
 * CrystalOS development runner
 *
 * Starts the Scramjet backend (Wisp transport + proxy assets + accounts API)
 * and the Vite dev server together, because the shell's proxied applications
 * need both:
 *
 *   - Vite serves the shell on http://127.0.0.1:5273, including /sw.js from
 *     public/ — the worker the shell shares between dev and production
 *   - the backend serves /scram/*, /controller/*, /clients/*,
 *     /bootstrap-init.js, the /wisp/ WebSocket and /api/accounts/*, and Vite
 *     proxies those paths to it (see vite.config.ts)
 *
 * Order matters. Vite used to be started immediately, so the shell's very first
 * request — /api/proxy-status, and /api/accounts/me right behind it — reached a
 * backend that was still resolving its Scramjet assets (or was not running at
 * all) and Vite logged `http proxy error: connect ECONNREFUSED 127.0.0.1:8787`.
 * This runner now:
 *
 *   1. reuses a backend that is already answering, so a second `npm run dev`
 *      never collides on the port (EADDRINUSE) and leaves Vite pointing at
 *      something dead;
 *   2. otherwise starts one and waits until /api/proxy-status answers before
 *      Vite exists at all;
 *   3. refuses to start the frontend against a backend it could not reach.
 *
 * Ctrl+C stops both. Any process that dies unexpectedly stops the other one,
 * so a half-running environment is never left behind.
 *
 * Environment:
 *   CRESCENT_HOST / CRESCENT_PORT   backend bind address (default 127.0.0.1:8787)
 *   CRESCENT_BACKEND_URL            reuse/proxy target when the backend runs
 *                                   elsewhere (passed through to Vite)
 *   CRESCENT_VITE_PORT              dev server port (default 5273)
 *   CRESCENT_BACKEND_TIMEOUT_MS     how long to wait for readiness (default 90000)
 */

import { spawn } from "node:child_process";
import process from "node:process";
import { backendOrigin, probeBackend, waitForBackend } from "./health.mjs";

const BACKEND_ORIGIN = backendOrigin();
const VITE_PORT = Number(process.env.CRESCENT_VITE_PORT ?? 5273);
const BACKEND_READY_TIMEOUT_MS = Number(process.env.CRESCENT_BACKEND_TIMEOUT_MS ?? 90_000);

const children = [];
let shuttingDown = false;
let backendChild = null;

function log(message) {
  process.stdout.write(`[crescent] ${message}\n`);
}

function run(label, command, args, env) {
  // No shell: on Windows a shell would split executable paths that contain
  // spaces ("C:\Program Files\nodejs\node.exe") and the process would never
  // start. Both commands here are node executables, so spawning them directly
  // works on every platform.
  const child = spawn(command, args, { stdio: "inherit", env: env ?? process.env });
  children.push(child);
  child.on("error", (error) => {
    log(`could not start ${label}: ${error.message}`);
    shutdown(1);
  });
  child.on("exit", (code) => {
    if (shuttingDown) return;
    log(`${label} exited with code ${code ?? 0}; stopping the other process.`);
    shutdown(code ?? 0);
  });
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function ensureBackend() {
  const existing = await probeBackend(BACKEND_ORIGIN);
  if (existing) {
    log(`reusing the backend already answering on ${BACKEND_ORIGIN} (transport: ${existing.transport ?? "unknown"}).`);
    log("Stop that instance if you want this run to own the port.");
    return true;
  }

  log(`starting the Scramjet backend on ${BACKEND_ORIGIN}…`);
  backendChild = run("scramjet backend", process.execPath, ["server/scramjet/index.js"]);

  // Readiness is quick now that the proxy assets are resolved from disk rather
  // than downloaded, but a dead child still short-circuits the wait.
  const ready = await waitForBackend(BACKEND_ORIGIN, {
    timeoutMs: BACKEND_READY_TIMEOUT_MS,
    isAlive: () => backendChild !== null && backendChild.exitCode === null,
  });

  if (!ready) {
    const exited = backendChild.exitCode !== null;
    process.stderr.write(
      [
        "",
        exited
          ? "[crescent] the Scramjet backend exited before it became ready (see its output above)."
          : `[crescent] the Scramjet backend did not answer on ${BACKEND_ORIGIN}/api/proxy-status within ${Math.round(
              BACKEND_READY_TIMEOUT_MS / 1000,
            )}s.`,
        "Starting the frontend anyway would make every /api/* and /wisp/ request fail",
        "with `connect ECONNREFUSED 127.0.0.1:8787` in the Vite proxy log, so this run stops here.",
        "",
        "  • already running on that port? `npm run dev` reuses a healthy backend automatically",
        "  • port owned by something else?      CRESCENT_PORT=8788 npm run dev",
        "  • backend on another host?           CRESCENT_BACKEND_URL=http://… npm run dev",
        "",
      ].join("\n"),
    );
    shutdown(1);
    return false;
  }

  log(`backend ready — transport ${ready.transport ?? "unknown"}, private addresses ${ready.privateAddresses ? "allowed" : "blocked"}.`);
  return true;
}

async function main() {
  if (!(await ensureBackend())) return;

  log(`starting Vite on http://127.0.0.1:${VITE_PORT}/ …`);
  run(
    "vite",
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(VITE_PORT)],
    // Vite proxies the backend paths from this same origin, so the config never
    // has to guess where the backend is.
    { ...process.env, CRESCENT_BACKEND_URL: BACKEND_ORIGIN },
  );
  log(`CrystalOS is starting: open http://127.0.0.1:${VITE_PORT}/ (backend ${BACKEND_ORIGIN}).`);
}

await main();
