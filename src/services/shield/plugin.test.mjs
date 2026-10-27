/*
 * CrystalOS — Shield plugin tests
 *
 * Run with `npm test` (or `node --test src/services/shield/plugin.test.mjs`).
 *
 * The plugin needs `window.$scramjetUtils.ManagedPlugin`, `window.$scramjet
 * .ScramjetHeaders` and storage, so all three are faked. What is under test is
 * the wiring: which requests get an answer, what that answer is, and — the
 * invariant that matters most — that Shield never breaks a page when it is
 * confused.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const SRC_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");

function resolveWithExtensions(base) {
  if (existsSync(base)) return base;
  for (const suffix of [".ts", ".tsx", ".js", ".mjs", "/index.ts"]) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith("@/")) {
      base = resolvePath(SRC_ROOT, specifier.slice(2));
    } else if (
      !/\.[cm]?[jt]sx?$|\.json$/.test(specifier) &&
      specifier.startsWith(".") &&
      context.parentURL
    ) {
      base = fileURLToPath(new URL(specifier, context.parentURL));
    }
    const found = base === null ? null : resolveWithExtensions(base);
    return found ? { url: pathToFileURL(found).href, shortCircuit: true } : nextResolve(specifier, context);
  },
});

const { createShieldPlugin, shieldAvailable } = await import("@/services/shield/plugin");
const { DEFAULT_SHIELD_SETTINGS, updateShieldSettings } = await import("@/services/shield/state");

/* ------------------------------------------------------------- fake pieces */

const store = new Map();

/** The headers object the controller builds from raw pairs. */
class FakeHeaders {
  constructor(pairs = []) {
    this.pairs = pairs;
  }
  static fromRawHeaders(raw) {
    return new FakeHeaders(raw);
  }
  toRawHeaders() {
    return this.pairs;
  }
  get(key) {
    return this.pairs.find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1] ?? null;
  }
  has(key) {
    return this.get(key) !== null;
  }
}

function fakeManaged() {
  return class FakeManagedPlugin {
    constructor(name, dependencies) {
      this.name = name;
      this.dependencies = dependencies;
      this.frame = null;
      this.taps = [];
    }
    install(frame) {
      this.frame = frame;
    }
    tap(hook, callback) {
      this.taps.push({ hook, callback });
    }
  };
}

function fakeFrame() {
  return { hooks: { fetch: { intercept: {} }, init: { pre: {}, post: {} }, error: { request: {} } } };
}

/** The plugin's intercept tap, installed on a frame whose hooks it taps. */
function installed(settings = {}) {
  /*
   * The settings are changed through the live store rather than storage: the
   * state module reads storage once, so writing localStorage here would leave
   * the plugin looking at whatever the first test set.
   */
  updateShieldSettings({ ...DEFAULT_SHIELD_SETTINGS, ...settings });
  const plugin = createShieldPlugin({ owner: "tab-1" });
  assert.ok(plugin, "the plugin is built when the frame supports it");
  const frame = fakeFrame();
  plugin.install(frame);
  const intercept = plugin.taps.find((entry) => entry.hook === frame.hooks.fetch.intercept);
  const init = plugin.taps.find((entry) => entry.hook === frame.hooks.init.post);
  return { plugin, intercept: intercept.callback, init: init.callback };
}

function request(overrides = {}) {
  return {
    parsed: {
      url: new URL("https://www.example.com/app.js"),
      clientUrl: new URL("https://www.example.com/"),
      destination: "script",
      ...overrides,
    },
  };
}

/* ------------------------------------------------------------------ harness */

const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;

beforeEach(() => {
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  globalThis.window = {
    $scramjetUtils: { ManagedPlugin: fakeManaged() },
    $scramjet: { ScramjetHeaders: FakeHeaders },
  };
});

afterEach(() => {
  store.clear();
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalLocalStorage;
});

/* ------------------------------------------------------------------ tests */

describe("createShieldPlugin", () => {
  test("a frame with no plugin support gets no plugin, never a stub", () => {
    globalThis.window = {};
    assert.equal(createShieldPlugin({}), null);
    assert.equal(shieldAvailable(), false);
  });

  test("the plugin is available when the frame exposes the extension point", () => {
    assert.equal(shieldAvailable(), true);
  });
});

describe("the intercept answer", () => {
  test("an ordinary request is left completely alone", () => {
    const { intercept } = installed();
    const props = {};
    intercept(request({ url: new URL("https://www.example.com/app.js") }), props);
    assert.equal("response" in props, false);
  });

  test("a page's own document is not touched", () => {
    const { intercept } = installed();
    const props = {};
    intercept(request({ url: new URL("https://www.youtube.com/watch"), destination: "document" }), props);
    assert.equal("response" in props, false);
  });

  test("a tracker is answered locally with a 204 and no body", () => {
    const { intercept } = installed();
    const props = {};
    intercept(
      request({
        url: new URL("https://www.googletagmanager.com/gtm.js?id=GTM-1"),
        clientUrl: new URL("https://news.example.com/"),
        destination: "script",
      }),
      props,
    );
    assert.equal(props.response.status, 204);
    assert.equal(props.response.body, "");
    assert.equal(props.response.headers.get("Cache-Control"), "no-store");
  });

  test("a blocked document gets a page that explains itself", () => {
    const { intercept } = installed();
    const props = {};
    intercept(
      request({ url: new URL("https://static.doubleclick.net/"), destination: "document" }),
      props,
    );
    assert.equal(props.response.status, 403);
    assert.match(props.response.body, /Shield/);
    assert.match(props.response.headers.get("Content-Type"), /text\/html/);
  });

  test("turning the blocker off leaves even ads alone", () => {
    const { intercept } = installed({ enabled: false });
    const props = {};
    intercept(
      request({
        url: new URL("https://www.googletagmanager.com/gtm.js"),
        clientUrl: new URL("https://news.example.com/"),
      }),
      props,
    );
    assert.equal("response" in props, false);
  });

  test("the data saver answers images with a transparent placeholder", () => {
    const { intercept } = installed({ lowData: true });
    const props = {};
    intercept(
      request({ url: new URL("https://cdn.example.com/photo.jpg"), destination: "image" }),
      props,
    );
    assert.equal(props.response.status, 200);
    assert.match(props.response.body, /<svg/);
    assert.equal(props.response.headers.get("Content-Type"), "image/svg+xml");
  });

  test("the data saver never stops the page itself", () => {
    const { intercept } = installed({ lowData: true });
    for (const destination of ["document", "iframe", "script", "stylesheet", "xmlhttprequest"]) {
      const props = {};
      intercept(request({ destination }), props);
      assert.equal("response" in props, false, `${destination} must be left alone`);
    }
  });

  /*
   * The invariant: Shield is an optimisation and a filter, never a reason for a
   * page to fail. A decision that throws must let the request through.
   */
  test("a context that throws while being read does not break the request", () => {
    const { intercept } = installed();
    const props = {};
    const hostile = {
      get parsed() {
        throw new Error("hostile context");
      },
    };
    assert.doesNotThrow(() => intercept(hostile, props));
    assert.equal("response" in props, false);
  });

  test("a context with no URL is left alone rather than guessed at", () => {
    const { intercept } = installed();
    for (const parsed of [{}, { url: null }, undefined]) {
      const props = {};
      assert.doesNotThrow(() => intercept({ parsed }, props));
      assert.equal("response" in props, false);
    }
  });
});
