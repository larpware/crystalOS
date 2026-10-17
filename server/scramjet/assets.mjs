/*
 * CrystalOS — Scramjet assets
 *
 * Everything the browser needs to run the proxy, resolved locally and served
 * from one place. Three kinds of source, in this order, per package:
 *
 *   1. `scramjet-assets/<name>-<version>/package/…` — the vendored folder in the
 *      project root. This is the operator's pick: it wins over anything
 *      installed, and the highest version inside the folder wins over the rest.
 *      Drop the packages you want here and the proxy runs entirely from them.
 *   2. `node_modules/@mercuryworkshop/<package>/…` — the project's own
 *      dependencies, which is where a package the folder does not vendor comes
 *      from.
 *   3. the proxy-bootstrap download cache (`proxy-bootstrap/dist/.downloads/`),
 *      if an older install still has one. Only a fallback.
 *
 * Nothing here reaches the network: the previous implementation called
 * `bootstrap()` from `@mercuryworkshop/proxy-bootstrap`, which queries the npm
 * registry on every start and downloads tarballs into `.downloads`. That made
 * the proxy depend on the registry being reachable, pinned nothing, and served
 * whatever "latest 0.x" happened to be that day. The three sources above are
 * all on disk.
 *
 * What is *not* rewritten is Scramjet itself. The client half of the bootstrap
 * (`initBootstrap`, which registers the service worker, loads these scripts and
 * wires the transport) is still the official `bootstrap-client.js` bundle, served
 * verbatim as a data: URL — the same bytes the official bootstrap served. Only
 * the routing and the file locations are ours.
 *
 * The URL surface, which the client bundle, the service worker and the shell
 * all share, is declared once in `clientConfig()` and checked against the asset
 * table by a test — a path the client asks for but nothing serves is exactly the
 * kind of bug that shows up as a blank proxied frame.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Vendored package folders live here, as `<name>-<version>/package/…`. */
export const VENDORED_DIR = "scramjet-assets";

/** The scope every Scramjet package is published under. */
export const PACKAGE_SCOPE = "@mercuryworkshop";

const JS = "application/javascript; charset=utf-8";
const WASM = "application/wasm";

/**
 * Every file the browser asks for. `transport` limits an entry to one transport,
 * because only the selected one is ever loaded or reported as missing.
 */
export const ASSETS = [
  { url: "/scram/scramjet.js", package: "scramjet", file: "dist/scramjet.js", type: JS },
  { url: "/scram/scramjet.wasm", package: "scramjet", file: "dist/scramjet.wasm", type: WASM },
  { url: "/scram/scramjet-utils.js", package: "scramjet-utils", file: "dist/scramjet-utils.js", type: JS },
  {
    url: "/controller/controller.api.js",
    package: "scramjet-controller",
    file: "dist/controller.api.js",
    type: JS,
  },
  {
    url: "/controller/controller.inject.js",
    package: "scramjet-controller",
    file: "dist/controller.inject.js",
    type: JS,
  },
  {
    url: "/controller/controller.sw.js",
    package: "scramjet-controller",
    file: "dist/controller.sw.js",
    type: JS,
  },
  {
    url: "/clients/libcurl-client.js",
    package: "libcurl-transport",
    file: "dist/index.js",
    type: JS,
    transport: "libcurl",
  },
  {
    url: "/clients/epoxy-client.js",
    package: "epoxy-transport",
    file: "dist/index.js",
    type: JS,
    transport: "epoxy",
  },
];

/**
 * The config object handed to the official client bootstrap. The key names are
 * the upstream ones (`sb` in proxy-bootstrap) and must stay that way: the client
 * bundle reads them by name. `transport` is the one value that comes from this
 * server, so the client and the server can no longer disagree about it.
 */
export function clientConfig({ transport = "libcurl" } = {}) {
  return {
    transport,
    // The shell's own worker (public/sw.js): imports the controller below and
    // adds the offline cache on top of the same routing.
    swPath: "/sw.js",
    wispPath: "/wisp/",
    bootstrapInitPath: "/bootstrap-init.js",
    scramjetBundlePath: "/scram/scramjet.js",
    scramjetWasmPath: "/scram/scramjet.wasm",
    scramjetUtilsBundlePath: "/scram/scramjet-utils.js",
    scramjetControllerApiPath: "/controller/controller.api.js",
    scramjetControllerInjectPath: "/controller/controller.inject.js",
    scramjetControllerSwPath: "/controller/controller.sw.js",
    libcurlClientPath: "/clients/libcurl-client.js",
    epoxyClientPath: "/clients/epoxy-client.js",
  };
}

/** The transports this server can actually serve. */
export const TRANSPORTS = ["libcurl", "epoxy"];

/** Download-cache folder names, which are the short names, not the package names. */
const DOWNLOAD_DIRS = { "scramjet-controller": "controller" };

/** How long a resolved location is reused before the disk is consulted again. */
const RESOLVE_TTL_MS = 5_000;

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readPackageVersion(dir) {
  try {
    const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * `mercuryworkshop-scramjet-2.0.67-alpha.2` → version `2.0.67-alpha.2` for
 * package `scramjet`, whether or not the folder keeps the scope prefix.
 * Returns null when the folder is not a versioned copy of that package.
 */
export function matchVendoredDir(dirName, pkg) {
  const match = /^(.*?)-(\d[^-/]*.*)$/.exec(dirName);
  if (!match) return null;
  const [, prefix, version] = match;
  const name = prefix.includes("/") ? prefix.slice(prefix.indexOf("/") + 1) : prefix;
  if (name !== pkg && !name.endsWith(`-${pkg}`)) return null;
  return version;
}

/** Highest version first; prerelease text is ignored, as semver precedence is close enough here. */
export function compareVersions(a, b) {
  const parts = (value) => String(value).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Vendored copies of one package, newest first. */
async function vendoredPackages(vendoredDir, pkg) {
  const entries = await readdir(vendoredDir, { withFileTypes: true }).catch(() => []);
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const version = matchVendoredDir(entry.name, pkg);
    if (version) found.push({ dir: join(vendoredDir, entry.name), version });
  }
  found.sort((a, b) => compareVersions(a.version, b.version));
  return found;
}

/** Walks up from `startDir` to the `node_modules` that holds the Scramjet packages. */
async function findNodeModules(startDir) {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, "node_modules");
    if (await isDirectory(join(candidate, PACKAGE_SCOPE, "scramjet"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function defaultBootstrapDist(path) {
  try {
    return dirname(fileURLToPath(import.meta.resolve(`${PACKAGE_SCOPE}/proxy-bootstrap/dist/${path}`)));
  } catch {
    return null;
  }
}

const DIRECTORY_HELP = [
  "",
  "  • vendor the package in a folder named after it:",
  `      ${VENDORED_DIR}/${PACKAGE_SCOPE.replace("@", "")}-scramjet-2.0.67-alpha.2/package/dist/…`,
  "  • or install the project's dependencies with `npm install`.",
  "",
].join("\n");

/**
 * Resolves and serves every proxy asset. Roots are injectable so tests can point
 * at fixtures instead of the real project.
 */
export function createAssets({
  projectRoot = process.cwd(),
  vendoredDir = join(projectRoot, VENDORED_DIR),
  nodeModulesDir,
  downloadsDir,
  transport = "libcurl",
  clientBundlePath,
} = {}) {
  const config = clientConfig({ transport });
  const active = ASSETS.filter((asset) => !asset.transport || asset.transport === transport);
  const cache = new Map();
  let clientBundlePromise = null;

  /* The installed and cached roots are only discovered when something needs
     them: `null` disables one, `undefined` means "find it yourself". */
  const roots = { vendoredDir, nodeModules: null, downloadsDir: null };
  let rootsResolved = false;

  async function initRoots() {
    if (rootsResolved) return;
    rootsResolved = true;
    if (nodeModulesDir === undefined) {
      roots.nodeModules = await findNodeModules(dirname(fileURLToPath(import.meta.url)));
    } else {
      roots.nodeModules = nodeModulesDir;
    }
    if (downloadsDir === undefined) {
      const dist = defaultBootstrapDist("bootstrap-server.js");
      roots.downloadsDir = dist ? join(dist, ".downloads") : null;
    } else {
      roots.downloadsDir = downloadsDir;
    }
  }

  /** Where one asset's file actually sits, or null when it is nowhere to be found. */
  async function locate(asset) {
    for (const vendored of await vendoredPackages(roots.vendoredDir, asset.package)) {
      const file = join(vendored.dir, "package", asset.file);
      if (await isFile(file)) {
        return { file, version: vendored.version, source: `${VENDORED_DIR}/${vendored.dir.split(/[/\\]/).pop()}` };
      }
    }

    if (roots.nodeModules) {
      const installed = join(roots.nodeModules, PACKAGE_SCOPE, asset.package);
      const file = join(installed, asset.file);
      if (await isFile(file)) {
        return { file, version: await readPackageVersion(installed), source: `node_modules/${PACKAGE_SCOPE}` };
      }
    }

    if (roots.downloadsDir) {
      const cached = join(roots.downloadsDir, DOWNLOAD_DIRS[asset.package] ?? asset.package, "package");
      const file = join(cached, asset.file);
      if (await isFile(file)) {
        return { file, version: await readPackageVersion(cached), source: "proxy-bootstrap cache" };
      }
    }

    return null;
  }

  /** Resolved location of one asset URL, cached briefly. */
  async function resolve(urlPath) {
    await initRoots();
    const asset = active.find((entry) => entry.url === urlPath);
    if (!asset) return null;

    const hit = cache.get(urlPath);
    if (hit && hit.expires > Date.now()) return hit.value;

    const location = await locate(asset);
    const value = location ? { ...asset, ...location } : null;
    cache.set(urlPath, { value, expires: Date.now() + RESOLVE_TTL_MS });
    return value;
  }

  function sendScript(res, body, { cacheControl, head = false }) {
    res.writeHead(200, {
      "content-type": JS,
      "content-length": Buffer.byteLength(body),
      "cache-control": cacheControl,
    });
    res.end(head ? undefined : body);
  }

  /* The official client bootstrap, byte for byte, plus this server's config.
     Generated per request so a restart with another transport is picked up. */
  async function bootstrapInit() {
    clientBundlePromise ??= (async () => {
      const path = clientBundlePath ?? defaultBootstrapDist("bootstrap-client.js");
      const file = path ? join(path, "bootstrap-client.js") : null;
      if (!file || !(await isFile(file))) {
        throw new Error(
          [
            `${PACKAGE_SCOPE}/proxy-bootstrap is missing, so the proxy cannot be initialised.`,
            DIRECTORY_HELP,
          ].join("\n"),
        );
      }
      return readFile(file, "utf8");
    })();

    const bundle = await clientBundlePromise;
    return [
      "async function initBootstrap() {",
      `\tconst { init } = await import("data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}");`,
      `\treturn init(${JSON.stringify(config)});`,
      "}",
      "",
    ].join("\n");
  }

  /**
   * Answers a proxy asset request. Returns false for URLs this server does not
   * own, so the caller can keep routing.
   */
  async function serve(req, res, pathname) {
    if (pathname === config.bootstrapInitPath) {
      if (req.method !== "GET" && req.method !== "HEAD") return false;
      sendScript(res, await bootstrapInit(), {
        cacheControl: "no-store",
        head: req.method === "HEAD",
      });
      return true;
    }

    const asset = await resolve(pathname);
    if (!asset) {
      const declared = active.find((entry) => entry.url === pathname);
      if (!declared) return false;
      // The URL is ours but no source has the file: say so instead of leaving
      // the browser with a blank script error.
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end(
        [
          `CrystalOS has no ${declared.package} ${declared.file}.`,
          `Looked in ${VENDORED_DIR}/, node_modules/${PACKAGE_SCOPE}/${declared.package}/ and the proxy-bootstrap cache.`,
          DIRECTORY_HELP,
        ].join("\n"),
      );
      return true;
    }

    if (req.method !== "GET" && req.method !== "HEAD") return false;

    const info = await stat(asset.file);
    const etag = `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { etag, "cache-control": "no-cache" });
      res.end();
      return true;
    }

    res.writeHead(200, {
      "content-type": asset.type,
      "content-length": info.size,
      etag,
      "last-modified": info.mtime.toUTCString(),
      // Revalidate: a swapped file in the vendored folder is picked up on the
      // next page load, and an unchanged one costs a 304 instead of 2 MB.
      "cache-control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : await readFile(asset.file));
    return true;
  }

  /** What is being served from where — for the startup log and /api/proxy-status. */
  async function report() {
    const packages = {};
    const missing = [];
    for (const asset of active) {
      const resolved = await resolve(asset.url);
      if (!resolved) {
        missing.push({ url: asset.url, package: asset.package, file: asset.file });
        continue;
      }
      packages[asset.package] = { version: resolved.version ?? "unknown", source: resolved.source };
    }
    return { dir: VENDORED_DIR, transport, packages, missing, urls: active.map((asset) => asset.url) };
  }

  return { config, assets: active, resolve, serve, bootstrapInit, report };
}
