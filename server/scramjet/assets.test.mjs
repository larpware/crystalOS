/*
 * CrystalOS — Scramjet asset serving tests
 *
 * Run with `node --test server/scramjet/assets.test.mjs` (or `npm test`).
 *
 * What matters here is *where the files come from*. The vendored
 * `scramjet-assets/` folder has to win over anything installed, a package the
 * folder does not vendor has to fall through to node_modules, and a URL the
 * client asks for that nobody has must produce a 503 that names the file rather
 * than a blank proxied frame.
 *
 * Every case runs against fixtures in a temporary directory: no node_modules,
 * no network and no dependency on what happens to be vendored in this checkout.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  ASSETS,
  VENDORED_DIR,
  clientConfig,
  compareVersions,
  createAssets,
  matchVendoredDir,
} from "./assets.mjs";

/* ---- fixture ------------------------------------------------------------ */

/** Writes `files` (relative path → contents) under `root/…/segments`. */
async function writeTree(root, segments, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, ...segments, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

const PACKAGE_FILES = {
  scramjet: { "dist/scramjet.js": "scramjet-js", "dist/scramjet.wasm": "wasm-bytes" },
  "scramjet-utils": { "dist/scramjet-utils.js": "utils-js" },
  "scramjet-controller": {
    "dist/controller.api.js": "controller-api",
    "dist/controller.inject.js": "controller-inject",
    "dist/controller.sw.js": "controller-sw",
  },
  "libcurl-transport": { "dist/index.js": "libcurl-client" },
  "epoxy-transport": { "dist/index.js": "epoxy-client" },
};

/**
 * A complete, self-contained asset world: `vendored` (folder-name → files) as
 * the vendored override, plus either an installed tree or a bootstrap cache.
 */
async function fixture({ vendored = {}, installed = true, cache = false, clientBundle = "official-client", packageOverrides = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), "crescent-assets-"));

  for (const [dirName, files] of Object.entries(vendored)) {
    await writeTree(root, [VENDORED_DIR, dirName, "package"], files);
  }

  if (installed) {
    for (const [name, files] of Object.entries(PACKAGE_FILES)) {
      await writeTree(root, ["node_modules", "@mercuryworkshop", name], {
        ...files,
        ...(packageOverrides[name] ?? {}),
        "package.json": JSON.stringify({ name: `@mercuryworkshop/${name}`, version: `9.9.${name.length}` }),
      });
    }
  }

  if (cache) {
    for (const name of Object.keys(PACKAGE_FILES)) {
      const short = name === "scramjet-controller" ? "controller" : name;
      await writeTree(root, ["bootstrap", ".downloads", short, "package"], {
        ...PACKAGE_FILES[name],
        "package.json": JSON.stringify({ name, version: "1.2.3" }),
      });
    }
  }

  await writeTree(root, ["bootstrap"], { "bootstrap-client.js": clientBundle });

  return {
    root,
    options: {
      projectRoot: root,
      vendoredDir: join(root, VENDORED_DIR),
      nodeModulesDir: join(root, "node_modules"),
      downloadsDir: cache ? join(root, "bootstrap", ".downloads") : null,
      clientBundlePath: join(root, "bootstrap"),
    },
    async read(...segments) {
      return readFile(join(root, ...segments), "utf8");
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** A request/response pair good enough to drive `assets.serve`. */
function fakeExchange({ method = "GET", headers = {} } = {}) {
  const captured = { status: 0, headers: {}, body: null };
  return {
    req: { method, headers },
    res: {
      writeHead(status, responseHeaders) {
        captured.status = status;
        captured.headers = responseHeaders;
        return this;
      },
      end(body) {
        captured.body = body ?? null;
        return this;
      },
    },
    captured,
  };
}

/* ---- directory names ---------------------------------------------------- */

describe("matchVendoredDir", () => {
  it("reads the package and version out of a vendored folder name", () => {
    assert.equal(matchVendoredDir("mercuryworkshop-scramjet-2.0.67-alpha.2", "scramjet"), "2.0.67-alpha.2");
    assert.equal(matchVendoredDir("mercuryworkshop-scramjet-controller-0.0.14", "scramjet-controller"), "0.0.14");
    assert.equal(matchVendoredDir("scramjet-utils-0.0.3", "scramjet-utils"), "0.0.3");
    assert.equal(matchVendoredDir("@mercuryworkshop/scramjet-2.0.0", "scramjet"), "2.0.0");
  });

  it("does not confuse the controller with the bundle it drives", () => {
    assert.equal(matchVendoredDir("mercuryworkshop-scramjet-controller-0.0.14", "scramjet"), null);
    assert.equal(matchVendoredDir("mercuryworkshop-scramjet-2.0.67-alpha.2", "scramjet-controller"), null);
    assert.equal(matchVendoredDir("mercuryworkshop-scramjet-2.0.67-alpha.2", "scramjet-utils"), null);
  });

  it("ignores folders that are not a versioned package", () => {
    assert.equal(matchVendoredDir("scramjet", "scramjet"), null);
    assert.equal(matchVendoredDir("scramjet-latest", "scramjet"), null);
    assert.equal(matchVendoredDir("notes-about-scramjet", "scramjet"), null);
  });
});

describe("compareVersions", () => {
  it("orders newest first, by number and not by string", () => {
    const versions = ["0.0.9", "0.0.14", "2.0.67-alpha.2", "2.0.67-alpha.10"];
    assert.deepEqual([...versions].sort(compareVersions), [
      "2.0.67-alpha.10",
      "2.0.67-alpha.2",
      "0.0.14",
      "0.0.9",
    ]);
  });
});

/* ---- resolution --------------------------------------------------------- */

describe("asset resolution", () => {
  let vendored;
  let installed;

  before(async () => {
    vendored = await fixture({
      vendored: {
        "mercuryworkshop-scramjet-2.0.67-alpha.2": {
          "dist/scramjet.js": "vendored-scramjet-js",
          "dist/scramjet.wasm": "vendored-wasm",
        },
        // Two controller versions: the newer one has to win.
        "mercuryworkshop-scramjet-controller-0.0.9": { "dist/controller.sw.js": "old-controller-sw" },
        "mercuryworkshop-scramjet-controller-0.0.14": { "dist/controller.sw.js": "vendored-controller-sw" },
      },
    });
    installed = await fixture();
  });

  after(async () => {
    await vendored.cleanup();
    await installed.cleanup();
  });

  it("serves the vendored folder in preference to anything installed", async () => {
    const assets = createAssets(vendored.options);
    const resolved = await assets.resolve("/scram/scramjet.js");
    assert.equal(resolved.file, join(vendored.options.vendoredDir, "mercuryworkshop-scramjet-2.0.67-alpha.2", "package", "dist/scramjet.js"));
    assert.equal(resolved.version, "2.0.67-alpha.2");
    assert.match(resolved.source, /^scramjet-assets\//);

    const exchange = fakeExchange();
    assert.equal(await assets.serve(exchange.req, exchange.res, "/scram/scramjet.js"), true);
    assert.equal(String(exchange.captured.body), "vendored-scramjet-js");
  });

  it("picks the newest vendored version of a package", async () => {
    const assets = createAssets(vendored.options);
    const resolved = await assets.resolve("/controller/controller.sw.js");
    assert.equal(resolved.version, "0.0.14");
    const exchange = fakeExchange();
    await assets.serve(exchange.req, exchange.res, "/controller/controller.sw.js");
    assert.equal(String(exchange.captured.body), "vendored-controller-sw");
  });

  it("falls back to node_modules for packages the folder does not vendor", async () => {
    const assets = createAssets(vendored.options);
    const utils = await assets.resolve("/scram/scramjet-utils.js");
    assert.equal(utils.source, "node_modules/@mercuryworkshop");
    assert.equal(utils.version, "9.9.14");

    const exchange = fakeExchange();
    await assets.serve(exchange.req, exchange.res, "/scram/scramjet-utils.js");
    assert.equal(String(exchange.captured.body), "utils-js");
  });

  it("falls back to the proxy-bootstrap cache when nothing is installed", async () => {
    const cached = await fixture({ installed: false, cache: true });
    try {
      const assets = createAssets(cached.options);
      const resolved = await assets.resolve("/controller/controller.api.js");
      assert.equal(resolved.source, "proxy-bootstrap cache");
      assert.equal(resolved.version, "1.2.3");
      const exchange = fakeExchange();
      await assets.serve(exchange.req, exchange.res, "/controller/controller.api.js");
      assert.equal(String(exchange.captured.body), "controller-api");
    } finally {
      await cached.cleanup();
    }
  });

  it("does not own URLs outside the asset table", async () => {
    const assets = createAssets(vendored.options);
    assert.equal(await assets.resolve("/scram/typo.js"), null);
    const exchange = fakeExchange();
    assert.equal(await assets.serve(exchange.req, exchange.res, "/scram/typo.js"), false);
    assert.equal(exchange.captured.status, 0);
  });

  it("answers 503 with the missing file named when no source has it", async () => {
    const empty = await fixture({ installed: false });
    try {
      const assets = createAssets(empty.options);
      const exchange = fakeExchange();
      assert.equal(await assets.serve(exchange.req, exchange.res, "/scram/scramjet.wasm"), true);
      assert.equal(exchange.captured.status, 503);
      assert.match(String(exchange.captured.body), /scramjet dist\/scramjet\.wasm/);
      assert.match(String(exchange.captured.body), /scramjet-assets\//);
    } finally {
      await empty.cleanup();
    }
  });
});

/* ---- what the client is told ------------------------------------------- */

describe("clientConfig", () => {
  it("only names files the asset table serves", () => {
    const known = new Set(ASSETS.map((asset) => asset.url));
    for (const transport of ["libcurl", "epoxy"]) {
      const config = clientConfig({ transport });
      const active = new Set(
        ASSETS.filter((asset) => !asset.transport || asset.transport === transport).map((asset) => asset.url),
      );
      for (const [key, value] of Object.entries(config)) {
        if (!key.endsWith("Path")) continue;
        // These three are generated or owned by the shell, not an asset file.
        if (["swPath", "wispPath", "bootstrapInitPath"].includes(key)) continue;
        assert.ok(known.has(value), `${key} points at ${value}, which nothing serves`);
      }
      // The selected transport is the one the client will actually load.
      assert.ok(active.has(config[`${transport}ClientPath`]));
    }
  });

  it("drops the client of an unused transport from the report", async () => {
    const world = await fixture();
    try {
      const libcurl = await createAssets({ ...world.options, transport: "libcurl" }).report();
      assert.ok(libcurl.packages["libcurl-transport"]);
      assert.equal(libcurl.packages["epoxy-transport"], undefined);
      assert.deepEqual(libcurl.missing, []);
      assert.equal(libcurl.urls.includes("/clients/epoxy-client.js"), false);

      // Epoxy transport includes both clients for hybrid fallback support.
      const epoxy = await createAssets({ ...world.options, transport: "epoxy" }).report();
      assert.ok(epoxy.packages["epoxy-transport"]);
      assert.ok(epoxy.packages["libcurl-transport"], "libcurl is included for hybrid fallback");
      assert.ok(epoxy.urls.includes("/clients/libcurl-client.js"), "libcurl URL is served for hybrid fallback");
    } finally {
      await world.cleanup();
    }
  });

  it("serves both clients with the hybrid wrapper for hosted Epoxy fallback", async () => {
    const world = await fixture();
    try {
      const assets = createAssets({ ...world.options, transport: "epoxy" });
      const exchange = fakeExchange();
      assert.equal(await assets.serve(exchange.req, exchange.res, "/clients/epoxy-client.js"), true);
      const script = String(exchange.captured.body);
      assert.ok(script.includes("libcurl-client"), "libcurl fallback client is bundled first");
      assert.ok(script.includes("epoxy-client"), "Epoxy remains the primary client");
      assert.ok(script.includes("__crystalHybridTransport"), "hybrid fallback wrapper is installed");
      assert.ok(script.includes("__crystalDuckDuckGoRelay"), "DuckDuckGo relay wraps the hybrid client");
      assert.match(script, /exported\.default/, "wrapper supports Epoxy's actual UMD default export");
      assert.equal(exchange.captured.headers["cache-control"], "no-cache");
    } finally {
      await world.cleanup();
    }
  });

  it("falls back on malformed response headers without replaying writes", async () => {
    const world = await fixture({
      packageOverrides: {
        "libcurl-transport": {
          "dist/index.js": `window.LibcurlTransport = { LibcurlClient: class { async init() { calls.push("libcurl:init"); } async request() { calls.push("libcurl:request"); return { status: 200, statusText: "OK", headers: [], body: "fallback" }; } async connect() {} } };`,
        },
        "epoxy-transport": {
          "dist/index.js": `window.EpoxyTransport = { default: class { async init() { calls.push("epoxy:init"); } async request() { calls.push("epoxy:request"); throw new Error("http::Error(InvalidHeaderValue)"); } async connect() {} } };`,
        },
      },
    });
    try {
      const assets = createAssets({ ...world.options, transport: "epoxy" });
      const exchange = fakeExchange();
      await assets.serve(exchange.req, exchange.res, "/clients/epoxy-client.js");
      const calls = [];
      const window = {};
      const context = {
        calls,
        window,
        location: { origin: "https://crystalos.test" },
        URL,
        Headers,
        Response,
        fetch: async () => {
          calls.push("duckduckgo:relay");
          return new Response("relay", { status: 200 });
        },
      };
      runInNewContext(String(exchange.captured.body), context);
      const Client = window.EpoxyTransport.EpoxyClient;
      const client = new Client({ wisp: "wss://crystalos.test/wisp/" });
      await client.init();
      const safeResult = await client.request(new URL("https://example.com"), "GET", null, [], undefined);
      assert.equal(safeResult.body, "fallback");
      assert.deepEqual(calls.slice(0, 4), ["epoxy:init", "epoxy:request", "libcurl:init", "libcurl:request"]);

      // Use a different origin so the origin-sticky routing doesn't bypass Epoxy
      await assert.rejects(
        client.request(new URL("https://other.com/form"), "POST", "payload", [], undefined),
        /InvalidHeaderValue/,
      );
      assert.equal(calls.filter((call) => call === "libcurl:request").length, 1);

      await client.request(new URL("https://duckduckgo.com/"), "GET", null, [], undefined);
      assert.equal(calls.at(-1), "duckduckgo:relay");
    } finally {
      await world.cleanup();
    }
  });

  it("retries on SSL and connection errors, not just header errors", async () => {
    const errorPatterns = [
      "SSL connect error (error:0A000086)",
      "ERR_SSL_PROTOCOL_ERROR",
      "TLS handshake failed",
      "connection reset by peer",
      "ECONNREFUSED",
      "error code 35",
    ];

    for (const errorMsg of errorPatterns) {
      const world = await fixture({
        packageOverrides: {
          "libcurl-transport": {
            "dist/index.js": `window.LibcurlTransport = { LibcurlClient: class { async init() {} async request() { return { status: 200, statusText: "OK", headers: [], body: "libcurl-ok" }; } async connect() {} } };`,
          },
          "epoxy-transport": {
            "dist/index.js": `window.EpoxyTransport = { default: class { async init() {} async request() { throw new Error(${JSON.stringify(errorMsg)}); } async connect() {} } };`,
          },
        },
      });
      try {
        const assets = createAssets({ ...world.options, transport: "epoxy" });
        const exchange = fakeExchange();
        await assets.serve(exchange.req, exchange.res, "/clients/epoxy-client.js");
        const window = {};
        runInNewContext(String(exchange.captured.body), { window, location: { origin: "https://test.local" }, URL, Headers, Response, fetch: async () => new Response("", { status: 200 }) });
        const Client = window.EpoxyTransport.EpoxyClient;
        const client = new Client({ wisp: "wss://test.local/wisp/" });
        await client.init();
        const result = await client.request(new URL("https://example.com/style.css"), "GET", null, [], undefined);
        assert.equal(result.body, "libcurl-ok", `Expected fallback for error: ${errorMsg}`);
      } finally {
        await world.cleanup();
      }
    }
  });

  it("lists what is missing instead of failing later", async () => {
    const empty = await fixture({ installed: false });
    try {
      const report = await createAssets(empty.options).report();
      assert.equal(Object.keys(report.packages).length, 0);
      assert.equal(report.missing.length, 7);
      assert.ok(report.missing.some((entry) => entry.url === "/controller/controller.inject.js"));
    } finally {
      await empty.cleanup();
    }
  });
});

describe("bootstrap-init.js", () => {
  it("serves the official client bundle with this server's config", async () => {
    const world = await fixture({ clientBundle: "the-official-bundle" });
    try {
      const assets = createAssets({ ...world.options, transport: "libcurl" });
      const script = await assets.bootstrapInit();
      assert.match(script, /async function initBootstrap\(\)/);
      assert.ok(
        script.includes(Buffer.from("the-official-bundle").toString("base64")),
        "the client bundle was not embedded verbatim",
      );

      const config = JSON.parse(/return init\((\{.*\})\);/.exec(script)[1]);
      assert.equal(config.transport, "libcurl");
      assert.equal(config.scramjetBundlePath, "/scram/scramjet.js");
      assert.equal(config.wasmPath, undefined);
    } finally {
      await world.cleanup();
    }
  });

  it("is served as a script and never cached", async () => {
    const world = await fixture();
    try {
      const assets = createAssets(world.options);
      const exchange = fakeExchange();
      assert.equal(await assets.serve(exchange.req, exchange.res, "/bootstrap-init.js"), true);
      assert.equal(exchange.captured.status, 200);
      assert.match(exchange.captured.headers["content-type"], /application\/javascript/);
      assert.equal(exchange.captured.headers["cache-control"], "no-store");
    } finally {
      await world.cleanup();
    }
  });
});

/* ---- HTTP behaviour ----------------------------------------------------- */

describe("asset responses over HTTP", () => {
  let world;
  let assets;
  let server;
  let origin;

  before(async () => {
    world = await fixture({
      vendored: {
        "mercuryworkshop-scramjet-2.0.67-alpha.2": {
          "dist/scramjet.js": "vendored-scramjet-js",
          "dist/scramjet.wasm": "⛳ wasm bytes",
        },
      },
    });
    assets = createAssets(world.options);
    server = createServer(async (req, res) => {
      const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (await assets.serve(req, res, pathname)) return;
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found.");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await world.cleanup();
  });

  it("labels each file with the type the browser needs", async () => {
    const script = await fetch(`${origin}/scram/scramjet.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type"), /application\/javascript/);
    assert.equal(await script.text(), "vendored-scramjet-js");

    const wasm = await fetch(`${origin}/scram/scramjet.wasm`);
    assert.equal(wasm.headers.get("content-type"), "application/wasm");
    assert.equal(await wasm.text(), "⛳ wasm bytes");
  });

  it("answers a second load with 304 instead of re-sending the bundle", async () => {
    const first = await fetch(`${origin}/scram/scramjet.js`);
    const etag = first.headers.get("etag");
    assert.ok(etag, "no etag, so every reload would re-download the file");
    await first.arrayBuffer();

    const second = await fetch(`${origin}/scram/scramjet.js`, { headers: { "if-none-match": etag } });
    assert.equal(second.status, 304);
    assert.equal(await second.text(), "");
  });

  it("answers HEAD with headers and no body", async () => {
    const response = await fetch(`${origin}/scram/scramjet.js`, { method: "HEAD" });
    assert.equal(response.status, 200);
    assert.equal(Number(response.headers.get("content-length")), Buffer.byteLength("vendored-scramjet-js"));
    assert.equal(await response.text(), "");
  });

  it("leaves other paths to the rest of the server", async () => {
    const response = await fetch(`${origin}/scram/typo.js`);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "Not found.");
  });
});
