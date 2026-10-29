#!/usr/bin/env node
/* CrystalOS — writes the deployment wiring into the build output
 *
 * The shell is a static bundle; where its account backend lives is a property
 * of the deployment, not of the source. This script writes that property into
 * `dist/` from the build environment, so one build works on any static host:
 *
 *   CRESCENT_BACKEND_URL    public origin of the CrystalOS backend — when the
 *                           host CAN reverse-proxy, the origin is kept and
 *                           `/api/*` + the Scramjet asset paths are proxied to
 *                           the backend through `dist/_redirects` (Netlify and
 *                           anything that reads that file). Same-origin
 *                           cookies, no CORS, full feature set.
 *
 *   CRESCENT_API_ORIGIN     public origin of the backend — when the host
 *                           CANNOT proxy (GitHub Pages, S3, …), the browser
 *                           calls the backend directly. The value is written
 *                           to `dist/config.json`, which the shell reads at
 *                           runtime; the backend must then allow the shell's
 *                           origin in CRESCENT_PUBLIC_ORIGINS. Proxied pages
 *                           (the Browser app) still need a proxying host.
 *
 *   CRESCENT_ALLOW_NO_BACKEND=1   permits a deliberate static-only deploy.
 *
 * Precedence: if both are set, CRESCENT_API_ORIGIN wins (the browser bypasses
 * any proxy and talks to the backend directly).
 *
 * Build vs. production validation
 * -------------------------------
 * Two different questions get two different answers:
 *
 *   "Is the shell buildable?"   `npm run build` (this script with no flags).
 *                              On Netlify a NON-PRODUCTION context
 *                              (CONTEXT=deploy-preview / branch-deploy / dev)
 *                              may build with no backend origin: the artifact
 *                              is for looking at, no config file is written,
 *                              and the build log says plainly that /api/* has
 *                              nowhere to go on that preview. Locally the same
 *                              build succeeds and writes only what it was
 *                              given.
 *
 *   "Is this a real production   `npm run deploy:check` (this script with
 *    deployment?"               --production-check), or a Netlify build whose
 *                              context is production (or unknown). Strict on
 *                              every host: no backend origin, a malformed one,
 *                              or one pointing at localhost fails with an
 *                              actionable message. Nothing is written when
 *                              run as a check.
 *
 * A preview that builds is NOT a deployment that is ready: production stays
 * red until a real backend origin exists.
 *
 * Why files instead of hand-written config: Netlify does NOT substitute
 * environment variables inside redirect targets ("Using environment variables
 * directly as values in your netlify.toml isn't supported" —
 * https://docs.netlify.com/build/configure-builds/file-based-configuration/#inject-environment-variable-values),
 * and Vite only bakes variables it is given. Writing both files at build time
 * keeps every deployment variable in one place: the build environment.
 *
 * Exit codes: 0 — written, or nothing to write; 1 — the configuration would
 * publish a site whose account service cannot go anywhere.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Backend paths the shell requests that are not under /api/. */
export const EXTRA_BACKEND_PATHS = [
  { from: "/bootstrap-init.js", to: "/bootstrap-init.js" },
  { from: "/scram/*", to: "/scram/:splat" },
  { from: "/controller/*", to: "/controller/:splat" },
  { from: "/clients/*", to: "/clients/:splat" },
  // Netlify cannot proxy WebSocket upgrades, so the browser dials /wisp/
  // directly (see CRESCENT_PUBLIC_WISP_URL). The rule below only answers
  // ordinary HTTP requests to the path — which the backend responds to with an
  // honest 426 rather than the SPA shell.
  { from: "/wisp/*", to: "/wisp/:splat" },
];

const PRIVATE_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0"];

/**
 * Validates a configured backend origin.
 * @param {unknown} raw
 * @param {{ label?: string, rejectPrivate?: boolean }} [options]
 * @returns {{ ok: true, origin: string } | { ok: false, problem: string }}
 */
export function parseBackendUrl(raw, { label = "CRESCENT_BACKEND_URL", rejectPrivate = false } = {}) {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, problem: `${label} is not set.` };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, problem: `${label} is not a URL: "${value}".` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, problem: `${label} must be http(s), got "${url.protocol}".` };
  }
  if (url.search || url.hash) {
    return { ok: false, problem: `${label} must be an origin without a query or fragment.` };
  }
  const host = url.hostname.toLowerCase();
  if (rejectPrivate && (PRIVATE_HOSTS.includes(host) || host.endsWith(".local"))) {
    return {
      ok: false,
      problem: `${label} points at ${host}: a backend on the build machine is unreachable from the CDN edge.`,
    };
  }
  // No path segment, no trailing slash: every rule below appends its own.
  return { ok: true, origin: url.origin };
}

/** The `_redirects` body for a validated backend origin. */
export function redirectRules(origin) {
  const proxy = (from, to) => `${from} ${origin}${to} 200`;
  return [
    "# Generated by scripts/deploy-config.mjs — do not edit by hand.",
    `# Backend origin: ${origin}`,
    proxy("/api/*", "/api/:splat"),
    ...EXTRA_BACKEND_PATHS.map((entry) => proxy(entry.from, entry.to)),
    "",
  ].join("\n");
}

/** `dist/config.json` body — consumed by src/services/api.ts at runtime. */
export function runtimeConfig(apiOrigin) {
  return `${JSON.stringify({ apiOrigin }, null, 2)}\n`;
}

/** Netlify contexts that are not the production deployment. */
export const PREVIEW_CONTEXTS = new Set(["deploy-preview", "branch-deploy", "dev"]);

function writeFile(target, contents, stdout, label, write = true) {
  if (!write) {
    stdout.write(`[deploy] check: ${label} would be written → ${target}\n`);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
  stdout.write(`[deploy] ${label} → ${target}\n`);
}

/**
 * Writes whatever this deployment's environment asks for (or, with
 * `write: false`, only reports what it would have written).
 *
 * @param {string} [context] Netlify's build context (`process.env.CONTEXT`).
 * @param {boolean} [production] force the strict production path on any host
 *   — used by `--production-check`. Defaults to "Netlify, and not a preview
 *   context", so an unknown context is treated as production.
 * @param {boolean} [write] `false` validates without touching the filesystem.
 * @returns {{ ok: boolean, redirects: boolean, config: boolean, problems: string[], warnings: string[] }}
 */
export function writeDeployConfig({
  backendUrl = process.env.CRESCENT_BACKEND_URL,
  apiOrigin = process.env.CRESCENT_API_ORIGIN,
  outDir = join(projectRoot, "dist"),
  isNetlify = process.env.NETLIFY === "true",
  allowNoBackend = process.env.CRESCENT_ALLOW_NO_BACKEND === "1",
  context = process.env.CONTEXT,
  production,
  write = true,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const problems = [];
  const warnings = [];
  let redirects = false;
  let config = false;

  // Strict = "this build is a real deployment". A known non-production
  // Netlify context builds without a backend origin; everything else (Netlify
  // production, an unknown context, an explicit --production-check) is held to
  // the production standard.
  const isPreview = isNetlify && Boolean(context) && PREVIEW_CONTEXTS.has(String(context));
  const strict = production ?? (isNetlify && !isPreview);

  const hasBackendUrl = String(backendUrl ?? "").trim() !== "";
  const hasApiOrigin = String(apiOrigin ?? "").trim() !== "";

  if (hasBackendUrl) {
    const parsed = parseBackendUrl(backendUrl, { rejectPrivate: isNetlify || strict });
    if (parsed.ok) {
      // A configured direct origin overrides the proxy: the browser will
      // bypass it, so writing proxy rules would only be misleading.
      if (hasApiOrigin) {
        stdout.write("[deploy] CRESCENT_API_ORIGIN takes precedence; proxy rules skipped.\n");
      } else {
        writeFile(join(outDir, "_redirects"), redirectRules(parsed.origin), stdout, "_redirects", write);
        redirects = true;
      }
    } else if (strict && !allowNoBackend && !hasApiOrigin) {
      problems.push(parsed.problem);
    } else {
      stdout.write(`[deploy] ${parsed.problem} Skipping proxy rules.\n`);
    }
  }

  if (hasApiOrigin) {
    const parsed = parseBackendUrl(apiOrigin, {
      label: "CRESCENT_API_ORIGIN",
      rejectPrivate: isNetlify || strict,
    });
    if (parsed.ok) {
      writeFile(join(outDir, "config.json"), runtimeConfig(parsed.origin), stdout, "config.json", write);
      config = true;
    } else {
      problems.push(parsed.problem);
    }
  }

  // With neither a proxy target nor a direct origin, every /api/* call falls
  // through to index.html and the account service dies at the edge.
  //
  // On a production deployment that is fatal — the build stops with an
  // actionable message instead of publishing a shell whose account system
  // cannot go anywhere. On a preview context (or a local build) the same
  // silence is reported loudly but allowed: the artifact is for inspecting the
  // frontend, no config file is written, and production remains red.
  const nowhereToGo = !hasBackendUrl && !hasApiOrigin && !allowNoBackend;
  if (nowhereToGo && strict) {
    const where = isNetlify ? ` (build context: ${String(context || "production")})` : "";
    problems.push(
      "Neither CRESCENT_BACKEND_URL (proxy the backend through Netlify) nor " +
        "CRESCENT_API_ORIGIN (call the backend directly) is set, so /api/* has no destination " +
        `and the account service would be dead on deploy${where}.`,
    );
  } else if (nowhereToGo && isNetlify) {
    warnings.push(
      `Build context "${String(context)}" is not production: building the shell without backend wiring.`,
      "  /api/* will be answered by the SPA shell on this preview, so sign-in and the",
      "  Browser proxy will report that no account server is reachable there. Expected.",
      "  A PRODUCTION build still fails until CRESCENT_BACKEND_URL or CRESCENT_API_ORIGIN",
      "  is set in the site's build environment (docs/DEPLOYMENT.md).",
    );
  }

  if (problems.length > 0) {
    stderr.write(
      [
        "",
        strict ? "[deploy] Refusing to deploy:" : "[deploy] Refusing to build:",
        ...problems.map((problem) => `  • ${problem}`),
        "",
        "  Set one of, in the site's build environment:",
        "      CRESCENT_BACKEND_URL=https://your-crystalos-backend.example   (host can proxy)",
        "      CRESCENT_API_ORIGIN=https://your-crystalos-backend.example    (host cannot proxy)",
        "  Deploy the CrystalOS backend first (docs/DEPLOYMENT.md), then redeploy.",
        "  For a deliberate static-only deploy, set CRESCENT_ALLOW_NO_BACKEND=1.",
        "",
      ].join("\n"),
    );
    return { ok: false, redirects, config, problems, warnings };
  }

  for (const warning of warnings) stdout.write(`[deploy] ${warning}\n`);

  if (!redirects && !config) {
    stdout.write(
      write
        ? "[deploy] no backend origin configured; same-origin defaults kept.\n"
        : "[deploy] check: no backend origin configured — production needs CRESCENT_BACKEND_URL or CRESCENT_API_ORIGIN (or CRESCENT_ALLOW_NO_BACKEND=1).\n",
    );
  }
  return { ok: true, redirects, config, problems: [], warnings };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const checkOnly = process.argv.includes("--production-check");
  const result = writeDeployConfig(
    checkOnly ? { production: true, write: false } : undefined,
  );
  if (checkOnly && result.ok) {
    process.stdout.write("[deploy] production configuration is valid.\n");
  }
  if (!result.ok) process.exit(1);
}
