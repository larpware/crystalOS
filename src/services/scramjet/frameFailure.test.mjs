/*
 * CrystalOS — the frame's failure report
 *
 * Run with `npm test` (or `node --test src/services/scramjet/frameFailure.test.mjs`).
 *
 * `frameFailure.ts` imports only types, so the Node test runner loads it with
 * those stripped. The plugin it builds needs `window.$scramjetUtils.ManagedPlugin`
 * and a frame with hooks, so both are faked here: what is under test is *which*
 * hook calls are reported and what the shell is told, not Scramjet itself.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createFailureReporterPlugin,
  failureMessage,
  isDocumentFailure,
} from "./frameFailure.ts";

/* ------------------------------------------------------------- fake pieces */

/** The smallest `ManagedPlugin` the reporter can be built on. */
function fakeManaged() {
  class FakeManagedPlugin {
    constructor(name, dependencies) {
      this.name = name;
      this.dependencies = dependencies;
      this.frame = null;
      this.taps = [];
    }

    install(frame) {
      this.frame = frame;
    }

    tap(hook, callback, order) {
      this.taps.push({ hook, callback, order });
    }
  }
  return FakeManagedPlugin;
}

/** A frame with one hook per surface the reporter reads. */
function fakeFrame() {
  return { hooks: { fetch: { intercept: {} }, init: { pre: {}, post: {} }, error: { request: {} } } };
}

const originalWindow = globalThis.window;

beforeEach(() => {
  globalThis.window = { $scramjetUtils: { ManagedPlugin: fakeManaged() } };
});

afterEach(() => {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

/* ------------------------------------------------------------------ tests */

describe("failureMessage", () => {
  test("reads an Error, a string, and a message-shaped object", () => {
    assert.equal(failureMessage(new Error("No exit could carry www.example.com:443.")), "No exit could carry www.example.com:443.");
    assert.equal(failureMessage("plain"), "plain");
    assert.equal(failureMessage({ message: "shaped" }), "shaped");
  });

  test("anything else is empty rather than invented", () => {
    assert.equal(failureMessage(undefined), "");
    assert.equal(failureMessage(null), "");
    assert.equal(failureMessage(42), "");
    assert.equal(failureMessage({ message: 42 }), "");
  });
});

describe("isDocumentFailure", () => {
  test("only the frame's own document counts", () => {
    assert.equal(isDocumentFailure({ destination: "document" }), true);
    assert.equal(isDocumentFailure({ destination: "image" }), false);
    assert.equal(isDocumentFailure({ destination: "script" }), false);
    assert.equal(isDocumentFailure({ destination: "iframe" }), false);
    assert.equal(isDocumentFailure(null), false);
    assert.equal(isDocumentFailure(undefined), false);
  });
});

describe("createFailureReporterPlugin", () => {
  test("no plugin support means no plugin, never a stub", () => {
    globalThis.window = {};
    assert.equal(createFailureReporterPlugin({ onFailure: () => {} }), null);
  });

  test("no callback means no plugin", () => {
    assert.equal(createFailureReporterPlugin({}), null);
  });

  test("reports a failed document with the transport's own words", () => {
    const reported = [];
    const plugin = createFailureReporterPlugin({ onFailure: (failure) => reported.push(failure) });
    assert.ok(plugin);
    const frame = fakeFrame();
    plugin.install(frame);

    const tap = plugin.taps.find((entry) => entry.hook === frame.hooks.error.request);
    assert.ok(tap, "the reporter taps error.request");
    tap.callback({
      rawrequest: { rawUrl: "https://www.example.com/", destination: "document" },
      error: new Error("No exit could carry www.example.com:443."),
    });

    assert.equal(reported.length, 1);
    assert.equal(reported[0].url, "https://www.example.com/");
    assert.match(reported[0].message, /No exit could carry/);
  });

  test("a failed subresource is not reported as a failed page", () => {
    const reported = [];
    const plugin = createFailureReporterPlugin({ onFailure: (failure) => reported.push(failure) });
    plugin.install(fakeFrame());

    const tap = plugin.taps[0];
    for (const destination of ["image", "script", "stylesheet", "iframe", "font"]) {
      tap.callback({
        rawrequest: { rawUrl: "https://cdn.example.com/a.png", destination },
        error: new Error("boom"),
      });
    }
    assert.deepEqual(reported, []);
  });

  test("the reporter changes nothing about the request", () => {
    const plugin = createFailureReporterPlugin({ onFailure: () => {} });
    plugin.install(fakeFrame());
    const props = {};
    plugin.taps[0].callback({
      rawrequest: { rawUrl: "https://example.com/", destination: "document" },
      error: new Error("boom"),
    }, props);
    // No synthesized response, no suppression: the client keeps behaving exactly
    // as it would without the reporter.
    assert.deepEqual(props, {});
  });

  test("a context without a request is ignored rather than reported", () => {
    const reported = [];
    const plugin = createFailureReporterPlugin({ onFailure: (failure) => reported.push(failure) });
    plugin.install(fakeFrame());
    plugin.taps[0].callback({}, {});
    plugin.taps[0].callback(undefined, undefined);
    assert.deepEqual(reported, []);
  });

  test("a frame with no error hook is left alone", () => {
    const plugin = createFailureReporterPlugin({ onFailure: () => {} });
    assert.doesNotThrow(() => plugin.install({ hooks: { fetch: { intercept: {} }, init: {} } }));
    assert.deepEqual(plugin.taps, []);
  });
});
