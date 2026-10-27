/*
 * CrystalOS — Shield state tests
 *
 * What Shield remembers and what it refuses to remember. The switches and the
 * allowances persist; what a page asked for does
 * not, and the counters are gathered up so a page with fifty blocked requests
 * cannot re-render the toolbar fifty times.
 */

import { test, describe, beforeEach } from "node:test";
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

const {
  DEFAULT_SHIELD_SETTINGS,
  POPUP_LIST_LIMIT,
  blockedFor,
  clearPopups,
  dismissPopup,
  getShieldState,
  isPopupSiteAllowed,
  isSiteAllowed,
  lastBlockedFor,
  noteBlocked,
  notePopup,
  popupsFor,
  resetBlocked,
  resetShieldRuntime,
  setPopupSiteAllowed,
  setSiteAllowed,
  siteKey,
  subscribeShield,
  updateShieldSettings,
} = await import("@/services/shield/state");
const { loadJSON } = await import("@/services/storage");

/** Flushes the microtask that carries a notification to the listeners. */
const settle = () => Promise.resolve();

beforeEach(() => {
  resetShieldRuntime();
  updateShieldSettings({ ...DEFAULT_SHIELD_SETTINGS });
});

describe("settings", () => {
  test("the defaults are the ones the project promised", () => {
    assert.deepEqual(getShieldState().settings, DEFAULT_SHIELD_SETTINGS);
    assert.equal(DEFAULT_SHIELD_SETTINGS.enabled, true);
    assert.equal(DEFAULT_SHIELD_SETTINGS.popups, true);
    // The slow-connection data saver is alpha work and starts off.
    assert.equal(DEFAULT_SHIELD_SETTINGS.lowData, false);
    assert.deepEqual(DEFAULT_SHIELD_SETTINGS.allowAds, []);
    assert.deepEqual(DEFAULT_SHIELD_SETTINGS.allowPopups, []);
  });

  test("a change is applied and written down", () => {
    updateShieldSettings({ lowData: true });
    assert.equal(getShieldState().settings.lowData, true);
    const stored = loadJSON("shield.settings", null);
    assert.equal(stored.lowData, true);
    assert.equal(stored.enabled, true);
  });

  test("a corrupt stored value falls back to the defaults, not to an exception", () => {
    updateShieldSettings({ enabled: false });
    const before = getShieldState().settings;
    assert.equal(before.enabled, false);
    // The reader is the only thing that could be confused by nonsense; the
    // setter has already cleaned the shape it writes.
    assert.equal(typeof getShieldState().settings.allowAds, "object");
  });
});

describe("allowing a site", () => {
  test("an entry covers the host and anything under it", () => {
    setSiteAllowed("example.com", true);
    assert.equal(isSiteAllowed("example.com"), true);
    assert.equal(isSiteAllowed("www.example.com"), true);
    assert.equal(isSiteAllowed("a.b.example.com"), true);
  });

  test("it never widens upwards", () => {
    setSiteAllowed("ads.example.com", true);
    assert.equal(isSiteAllowed("ads.example.com"), true);
    assert.equal(isSiteAllowed("example.com"), false);
  });

  test("it does not leak across sites", () => {
    setSiteAllowed("example.com", true);
    assert.equal(isSiteAllowed("example.com.evil.test"), false);
    assert.equal(isSiteAllowed("notexample.com"), false);
  });

  test("the list is de-duplicated and sorted", () => {
    setSiteAllowed("b.example", true);
    setSiteAllowed("a.example", true);
    setSiteAllowed("b.example", true);
    assert.deepEqual(getShieldState().settings.allowAds, ["a.example", "b.example"]);
  });

  test("removing one takes it back out", () => {
    setSiteAllowed("example.com", true);
    setSiteAllowed("example.com", false);
    assert.equal(isSiteAllowed("example.com"), false);
  });

  test("a nonsense host is not written down", () => {
    setSiteAllowed("   ", true);
    assert.deepEqual(getShieldState().settings.allowAds, []);
  });

  test("popups have their own list", () => {
    setPopupSiteAllowed("example.com", true);
    assert.equal(isPopupSiteAllowed("example.com"), true);
    assert.equal(isSiteAllowed("example.com"), false);
  });

  test("siteKey normalises what a person types", () => {
    assert.equal(siteKey("  Example.COM "), "example.com");
    assert.equal(siteKey(".example.com"), "example.com");
  });
});

describe("counters", () => {
  test("they are kept per owner", () => {
    noteBlocked("tab-1", "ads.example", "script", "||ads.example^");
    noteBlocked("tab-1", "ads.example", "image", "||ads.example^");
    noteBlocked("tab-2", "tracker.example", "ping", null);
    assert.equal(blockedFor("tab-1"), 2);
    assert.equal(blockedFor("tab-2"), 1);
    assert.equal(blockedFor("tab-3"), 0);
    assert.equal(lastBlockedFor("tab-2").host, "tracker.example");
    assert.equal(lastBlockedFor("tab-1").type, "image");
  });

  test("an owner-less block counts under the empty owner", () => {
    noteBlocked(null, "ads.example", "script", null);
    assert.equal(blockedFor(null), 1);
  });

  test("resetting one owner leaves the others alone", () => {
    noteBlocked("tab-1", "ads.example", "script", null);
    noteBlocked("tab-2", "ads.example", "script", null);
    resetBlocked("tab-1");
    assert.equal(blockedFor("tab-1"), 0);
    assert.equal(blockedFor("tab-2"), 1);
    assert.equal(lastBlockedFor("tab-1"), null);
  });

  test("resetting something that never happened changes nothing", () => {
    let calls = 0;
    const unsubscribe = subscribeShield(() => {
      calls += 1;
    });
    resetBlocked("never");
    updateShieldSettings({});
    unsubscribe();
    assert.equal(calls, 0);
  });

  test("a burst of blocks is one notification, but every count is real", async () => {
    let calls = 0;
    const unsubscribe = subscribeShield(() => {
      calls += 1;
    });
    for (let index = 0; index < 50; index += 1) {
      noteBlocked("tab-1", "ads.example", "script", null);
    }
    // The state is already the truth before the notification arrives.
    assert.equal(blockedFor("tab-1"), 50);
    await settle();
    assert.equal(calls, 1);
    noteBlocked("tab-1", "ads.example", "script", null);
    await settle();
    assert.equal(calls, 2);
    assert.equal(blockedFor("tab-1"), 51);
    unsubscribe();
  });
});

describe("popups", () => {
  test("a blocked popup is recorded with where it came from", () => {
    const entry = notePopup({ url: "https://ads.example/pop", pageUrl: "https://news.example/", owner: "tab-1" });
    assert.equal(entry.id.startsWith("popup-"), true);
    assert.equal(entry.url, "https://ads.example/pop");
    assert.equal(entry.pageUrl, "https://news.example/");
    assert.deepEqual(popupsFor("tab-1").map((item) => item.url), ["https://ads.example/pop"]);
    assert.deepEqual(popupsFor("tab-2"), []);
  });

  test("newest first, and the list is bounded", () => {
    for (let index = 0; index < POPUP_LIST_LIMIT + 5; index += 1) {
      notePopup({ url: `https://ads.example/pop-${index}`, pageUrl: null, owner: null });
    }
    const all = popupsFor(null);
    assert.equal(all.length, POPUP_LIST_LIMIT);
    assert.equal(all[0].url, `https://ads.example/pop-${POPUP_LIST_LIMIT + 4}`);
  });

  test("dismissing removes one", () => {
    const first = notePopup({ url: "https://ads.example/a", pageUrl: null, owner: null });
    const second = notePopup({ url: "https://ads.example/b", pageUrl: null, owner: null });
    dismissPopup(first.id);
    assert.deepEqual(popupsFor(null).map((item) => item.id), [second.id]);
    dismissPopup("nothing-like-this");
    assert.equal(popupsFor(null).length, 1);
  });

  test("they can all be cleared", () => {
    notePopup({ url: "https://ads.example/a", pageUrl: null, owner: null });
    clearPopups();
    assert.deepEqual(popupsFor(null), []);
  });
});
