/*
 * CrystalOS — offline mode tests
 *
 * Run with `npm test` (or `node --test src/services/offline.test.mjs`).
 *
 * Two things can make the OS offline and they are not interchangeable: the
 * machine has no connection, or the user asked to work offline. Both refuse
 * requests, but only one of them is something the user can undo, so the reason
 * has to survive the derivation — and the wording has to match the reason, or
 * the panel ends up telling someone to turn off a switch they never touched.
 *
 * deriveOffline() is deliberately pure so these can state exactly that without
 * a browser. The copy is checked for the same reason: it is part of the
 * behaviour, not decoration.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

/** `src/`, so `@/services/offline` resolves the way Vite resolves it. */
const SRC_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

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
    } else if (!/\.[cm]?[jt]sx?$|\.json$/.test(specifier) && specifier.startsWith(".") && context.parentURL) {
      base = fileURLToPath(new URL(specifier, context.parentURL));
    }
    const found = base === null ? null : resolveWithExtensions(base);
    return found ? { url: pathToFileURL(found).href, shortCircuit: true } : nextResolve(specifier, context);
  },
});

const {
  OFFLINE_AVAILABLE,
  OFFLINE_UNAVAILABLE,
  browserReportsOnline,
  deriveOffline,
  offlineExplanation,
  offlineHeadline,
} = await import("@/services/offline");

describe("browserReportsOnline", () => {
  /* The runner is itself a host with a `navigator` that says nothing about the
     connection, which is the case that matters: reading that silence as
     "offline" made every non-browser host claim to be offline, and it took a
     suite full of unrelated failures to notice. */
  test("a host that cannot answer is not read as offline", () => {
    assert.equal(browserReportsOnline(), true);
  });

  test("only an explicit false counts as no connection", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const stub = (value) =>
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: value === undefined ? {} : { onLine: value },
      });
    try {
      stub(undefined);
      assert.equal(browserReportsOnline(), true);
      stub(true);
      assert.equal(browserReportsOnline(), true);
      stub(false);
      assert.equal(browserReportsOnline(), false);
    } finally {
      if (original) Object.defineProperty(globalThis, "navigator", original);
      else delete globalThis.navigator;
    }
  });
});

describe("deriveOffline", () => {
  test("auto with a connection is not offline", () => {
    assert.deepEqual(deriveOffline("auto", true), {
      offline: false,
      reason: null,
      browserOnline: true,
    });
  });

  test("auto without a connection is offline, and blames the browser", () => {
    assert.deepEqual(deriveOffline("auto", false), {
      offline: true,
      reason: "browser",
      browserOnline: false,
    });
  });

  test("forced is offline even when the machine has a connection", () => {
    assert.deepEqual(deriveOffline("forced", true), {
      offline: true,
      reason: "forced",
      browserOnline: true,
    });
  });

  test("forced offline on a connected machine still reports what the browser sees", () => {
    // The two facts are kept apart: the panel can show "working offline" while
    // the settings page still reports that the network itself is fine.
    assert.equal(deriveOffline("forced", true).browserOnline, true);
  });

  test("forced offline with no connection prefers the reason the user can act on", () => {
    assert.equal(deriveOffline("forced", false).reason, "forced");
  });

  test("only the offline states carry a reason", () => {
    assert.equal(deriveOffline("auto", true).reason, null);
    for (const report of [deriveOffline("auto", false), deriveOffline("forced", true)]) {
      assert.ok(report.reason, "an offline report must say why");
    }
  });
});

describe("the wording", () => {
  test("names the state, and never a state it is not in", () => {
    assert.equal(offlineHeadline(deriveOffline("auto", true)), "Connected");
    assert.equal(offlineHeadline(deriveOffline("auto", false)), "No network connection");
    assert.equal(offlineHeadline(deriveOffline("forced", true)), "Working offline");
  });

  test("only points at the offline switch when the switch is the cause", () => {
    const forced = offlineExplanation(deriveOffline("forced", true));
    const browser = offlineExplanation(deriveOffline("auto", false));
    assert.match(forced, /Offline mode is on/);
    assert.doesNotMatch(browser, /Offline mode is on/);
    assert.match(browser, /no network connection/i);
  });

  test("explains a machine with a connection and offline mode on without contradicting itself", () => {
    const report = deriveOffline("forced", true);
    assert.match(offlineExplanation(report), /not attempting any network requests/);
  });

  test("the two lists are non-empty, distinct and do not mention each other", () => {
    assert.ok(OFFLINE_UNAVAILABLE.length >= 3);
    assert.ok(OFFLINE_AVAILABLE.length >= 3);
    const overlap = OFFLINE_AVAILABLE.filter((line) => OFFLINE_UNAVAILABLE.includes(line));
    assert.deepEqual(overlap, []);
  });
});
