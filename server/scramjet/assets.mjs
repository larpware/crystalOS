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

const HYBRID_TRANSPORT_POSTLUDE = `
;(function () {
  if (typeof window === "undefined" || !window.EpoxyTransport || !window.LibcurlTransport) return;
  const EpoxyClient = window.EpoxyTransport.EpoxyClient;
  const LibcurlClient = window.LibcurlTransport.LibcurlClient;
  if (typeof EpoxyClient !== "function" || typeof LibcurlClient !== "function") {
    throw new Error("The CrystalOS hybrid transport could not find both clients.");
  }
  if (EpoxyClient.__crystalHybridTransport) return;
  class CrystalHybridTransport {
    constructor(options) {
      this.options = options;
      this.epoxy = new EpoxyClient(options);
      this.libcurl = new LibcurlClient(options);
      this.epoxyReady = false;
      this.libcurlReady = false;
      this.libcurlInit = null;
      this.ready = false;
    }

    async init() {
      try {
        await this.epoxy.init();
        this.epoxyReady = true;
      } catch (epoxyError) {
        try {
          await this.ensureLibcurl();
        } catch {
          throw epoxyError;
        }
      }
      this.ready = this.epoxyReady || this.libcurlReady;
    }

    async ensureLibcurl() {
      if (this.libcurlReady) return;
      this.libcurlInit ??= this.libcurl.init().then(() => {
        this.libcurlReady = true;
      });
      await this.libcurlInit;
    }

    async meta() {
      if (this.epoxyReady && typeof this.epoxy.meta === "function") return this.epoxy.meta();
      if (this.libcurlReady && typeof this.libcurl.meta === "function") return this.libcurl.meta();
    }

    async request(remote, method, body, headers, signal) {
      if (this.epoxyReady) {
        try {
          return await this.epoxy.request(remote, method, body, headers, signal);
        } catch (epoxyError) {
          if (signal?.aborted) throw epoxyError;
          try {
            await this.ensureLibcurl();
            return await this.libcurl.request(remote, method, body, headers, signal);
          } catch {
            throw epoxyError;
          }
        }
      }
      await this.ensureLibcurl();
      return this.libcurl.request(remote, method, body, headers, signal);
    }

    connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
      if (this.epoxyReady) return this.epoxy.connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror);
      return this.libcurl.connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror);
    }
  }
  Object.defineProperty(CrystalHybridTransport, "__crystalHybridTransport", { value: true });
  window.EpoxyTransport.EpoxyClient = CrystalHybridTransport;
})();
`;

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
export function clientConfig({ transport = "libcurl", wispUrl } = {}) {
  return {
    transport,
    // The shell's own worker (public/sw.js): imports the controller below and
    // adds the offline cache on top of the same routing.
    swPath: "/sw.js",
    wispPath: "/wisp/",
    // Absolute wss:// endpoint for the transport, set only when the shell and
    // the backend are on different origins (CRESCENT_PUBLIC_WISP_URL). The
    // official bootstrap always builds `wss://<location.host><wispPath>`, which
    // is right for one-origin deployments and wrong behind a CDN that cannot
    // proxy WebSocket upgrades; when this is present, bootstrap-init.js
    // rewrites that one same-origin path to the backend before the transport
    // is constructed. Absent means "same origin", i.e. no rewriting at all.
    ...(wispUrl ? { wispUrl } : {}),
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

/**
 * Validates the public wisp endpoint. Returns a `wss://…/` URL, or undefined
 * when nothing was configured or the value is unusable — the client then keeps
 * its default same-origin behaviour, which is correct whenever the shell and
 * the backend really do share an origin.
 */
export function normaliseWispUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "wss:" && url.protocol !== "ws:") {
      process.stderr.write(
        `[crescent] CRESCENT_PUBLIC_WISP_URL must be a ws:// or wss:// URL, got "${raw}"; ignoring it.\n`,
      );
      return undefined;
    }
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url.toString();
  } catch {
    process.stderr.write(
      `[crescent] CRESCENT_PUBLIC_WISP_URL is not a URL ("${raw}"); ignoring it.\n`,
    );
    return undefined;
  }
}

/*
 * The prelude injected into /bootstrap-init.js when the transport has to dial a
 * different origin.
 *
 * The official client bundle derives its endpoint as
 * `wss://<location.host><wispPath>`, so behind a CDN that cannot proxy
 * WebSocket upgrades (Netlify cannot — see docs/DEPLOYMENT.md) the transport
 * would aim at the CDN and fail. Rather than patch the upstream bundle, this
 * wraps `window.WebSocket` for the lifetime of the page with a constructor that
 * rewrites exactly one thing: a same-origin URL under the wisp path becomes the
 * configured endpoint. Every other socket — and every socket on any other
 * origin — is passed through untouched.
 */
function wispRewritePrelude(config) {
  return [
    `\tconst __wisp = ${JSON.stringify(config.wispUrl)};`,
    "\tif (typeof window !== \"undefined\" && window.WebSocket && new URL(__wisp).origin !== location.origin) {",
    "\t\tconst __native = window.WebSocket;",
    `\t\tconst __target = new URL(__wisp);`,
    `\t\tconst __path = ${JSON.stringify(config.wispPath)};`,
    "\t\tconst __patched = function (url, protocols) {",
    "\t\t\tlet next = String(url);",
    "\t\t\ttry {",
    "\t\t\t\tconst parsed = new URL(next, location.href);",
    "\t\t\t\tif (parsed.origin === location.origin && parsed.pathname.startsWith(__path)) {",
    "\t\t\t\t\tnext = __target.origin + parsed.pathname + parsed.search;",
    "\t\t\t\t}",
    "\t\t\t} catch { /* not a URL: leave it alone */ }",
    "\t\t\treturn protocols === undefined ? new __native(next) : new __native(next, protocols);",
    "\t\t};",
    "\t\t__patched.prototype = __native.prototype;",
    "\t\tfor (const __key of [\"CONNECTING\", \"OPEN\", \"CLOSING\", \"CLOSED\"]) __patched[__key] = __native[__key];",
    "\t\twindow.WebSocket = __patched;",
    "\t}",
  ].join("\n");
}

/* Keep the native ProxyTransport init() contract and route DuckDuckGo through
 * the same-origin Worker relay when its direct TLS handshake is closed. */
const EPOXY_COMPAT_INSTALLER = `
const exported = window.EpoxyTransport;
const Transport = typeof exported === "function" ? exported : exported.default;
if (typeof Transport !== "function") throw new Error("The Epoxy browser transport export is unavailable.");
if (!exported.EpoxyClient?.__crystalDuckDuckGoRelay) {
  class CrystalEpoxyTransport extends Transport {
    async request(remote, method, body, headers, signal) {
      const hostname = String(remote?.hostname ?? "").toLowerCase();
      const duckDomain = hostname === "duckduckgo.com" || hostname.endsWith(".duckduckgo.com") || hostname === "duck.com" || hostname.endsWith(".duck.com");
      if (!duckDomain || typeof location === "undefined" || !location.origin) return super.request(remote, method, body, headers, signal);
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
      if (relayMethod !== "GET" && relayMethod !== "HEAD" && body != null) { init.body = body; init.duplex = "half"; }
      const response = await fetch(relay, init);
      const responseHeaders = [];
      response.headers.forEach((value, name) => { if (name.toLowerCase() !== "x-crystal-upstream-set-cookie") responseHeaders.push([name, value]); });
      try { const cookies = JSON.parse(response.headers.get("x-crystal-upstream-set-cookie") || "[]"); if (Array.isArray(cookies)) for (const cookie of cookies) responseHeaders.push(["set-cookie", String(cookie)]); } catch {}
      return { body: response.body, headers: responseHeaders, status: response.status, statusText: response.statusText };
    }
  }
  Object.defineProperty(CrystalEpoxyTransport, "__crystalDuckDuckGoRelay", { value: true });
  exported.EpoxyClient = CrystalEpoxyTransport;
}
`;

function epoxyCompatPrelude() {
  return [
    'if (typeof window !== "undefined" && window.EpoxyTransport) {',
    EPOXY_COMPAT_INSTALLER,
    '}',
  ];
}

// The bootstrap loads epoxy-client.js after this initializer runs. Install the
// same shim after its UMD export so the class is ready before construction.
function epoxyCompatPostlude() {
  return `\n;(function () { if (typeof window !== "undefined" && window.EpoxyTransport) { ${EPOXY_COMPAT_INSTALLER} } })();\n`;
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
  wispUrl = process.env.CRESCENT_PUBLIC_WISP_URL,
} = {}) {
  const config = clientConfig({ transport, wispUrl: normaliseWispUrl(wispUrl) });
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
      // Assign explicitly to the global object. The bootstrap is injected as a
      // classic external script, but an explicit export remains reliable when
      // it has crossed the Cloudflare Worker -> Node proxy boundary.
      "globalThis.initBootstrap = async function initBootstrap() {",
      `\tconst { init } = await import("data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}");`,
      ...(config.transport === "epoxy" ? epoxyCompatPrelude() : []),
      ...(config.wispUrl ? [wispRewritePrelude(config)] : []),
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
    const isEpoxyClient = asset.package === "epoxy-transport";
    const hybridLibcurl = isEpoxyClient && transport === "epoxy"
      ? await locate(ASSETS.find((entry) => entry.url === "/clients/libcurl-client.js"))
      : null;
    const body = req.method === "HEAD"
      ? null
      : await readFile(asset.file).then(async (source) => {
          if (!isEpoxyClient) return source;
          if (!hybridLibcurl) return Buffer.concat([source, Buffer.from(epoxyCompatPostlude())]);
          const libcurlSource = await readFile(hybridLibcurl.file);
          return Buffer.concat([
            libcurlSource,
            source,
            Buffer.from(HYBRID_TRANSPORT_POSTLUDE),
          ]);
        });
    const isHybrid = Boolean(hybridLibcurl);
    const etag = `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}${isEpoxyClient ? (isHybrid ? "-hybrid" : "-compat") : ""}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { etag, "cache-control": "no-cache" });
      res.end();
      return true;
    }

    res.writeHead(200, {
      "content-type": asset.type,
      "content-length": body?.length ?? info.size,
      etag,
      "last-modified": info.mtime.toUTCString(),
      // Revalidate: a swapped file in the vendored folder is picked up on the
      // next page load, and an unchanged one costs a 304 instead of 2 MB.
      "cache-control": "no-cache",
    });
    res.end(body ?? undefined);
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
