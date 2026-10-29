/*
 * CrystalOS — backend reachability helpers
 *
 * The dev runner (server/dev.mjs) and the Scramjet backend have to agree on one
 * question: "is a working CrystalOS backend already answering on this origin?"
 *
 * Getting that wrong is what produced the confusing failure this file exists to
 * prevent — Vite serving the shell while every request it proxied to
 * 127.0.0.1:8787 was answered with ECONNREFUSED. Kept in its own module so the
 * probe can be tested against a controlled local server (server/health.test.mjs)
 * instead of only against a live backend.
 */

/** The origin the shell proxies /api/*, /wisp/ and the Scramjet assets to. */
export function backendOrigin(env = process.env) {
  const explicit = env.CRESCENT_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = env.CRESCENT_HOST ?? "127.0.0.1";
  // Same precedence as the backend's own listener (server/scramjet/index.js):
  // CRESCENT_PORT, then a platform-assigned PORT, then the local default. This
  // probe must address exactly what the server binds, or the dev runner would
  // spawn a second copy against a port the first one already owns.
  const port = env.CRESCENT_PORT ?? env.PORT ?? "8787";
  return `http://${host}:${port}`;
}

/**
 * Asks a backend for its real status.
 *
 * Resolves to the parsed status object when a CrystalOS backend is answering,
 * and to `null` for every other outcome: connection refused, a timeout, a
 * non-JSON answer (e.g. the dev server's SPA fallback), or a JSON body that is
 * not a Crescat status. Never throws, so callers can treat `null` as "not
 * ready yet" without a try/catch.
 */
export async function probeBackend(origin, timeoutMs = 1500) {
  try {
    const response = await fetch(`${origin}/api/proxy-status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;
    const payload = await response.json();
    return payload && payload.scramjet === true ? payload : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until `probeBackend(origin)` succeeds.
 *
 * `isAlive` (optional) is checked on every pass: when it returns false — the
 * child we spawned has exited — the wait stops immediately instead of burning
 * the whole timeout on a backend that is never going to answer.
 *
 * Resolves with the status object, or `null` on timeout.
 */
export async function waitForBackend(
  origin,
  { timeoutMs = 90_000, intervalMs = 400, isAlive, probe = probeBackend } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (isAlive && !isAlive()) return null;
    const status = await probe(origin, Math.min(2000, Math.max(250, deadline - Date.now())));
    if (status) return status;
    if (isAlive && !isAlive()) return null;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}
