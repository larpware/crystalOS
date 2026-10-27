/*
 * CrystalOS — Shield decision tests
 *
 * decideRequest() and decidePopup() are the two questions Shield asks. They are
 * pure, so these tests state exactly what is allowed, what is refused, and —
 * for the data saver especially — what is deliberately never touched.
 */

import { test, describe } from "node:test";
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

const { POPUP_GESTURE_WINDOW_MS, decidePopup, decideRequest, lowDataHandles } = await import(
  "@/services/shield/decision"
);
const { defaultFilterList } = await import("@/services/shield/list");

const list = defaultFilterList();

const allOff = { enabled: false, popups: false, lowData: false, allowAds: [], allowPopups: [] };
const adsOn = { ...allOff, enabled: true };
const lowDataOn = { ...allOff, lowData: true };
const bothOn = { ...allOff, enabled: true, lowData: true };

function request(input) {
  return decideRequest({
    pageUrl: "https://news.example/article",
    type: "script",
    siteAllowed: false,
    list,
    settings: adsOn,
    ...input,
  });
}

describe("decideRequest — advertising and tracking", () => {
  test("a matching host is blocked, and the rule is named", () => {
    const outcome = request({ url: "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js" });
    assert.equal(outcome.action, "block");
    assert.equal(outcome.reason, "rule");
    assert.equal(outcome.rule, "googlesyndication.com");
  });

  test("an ordinary request is let through", () => {
    const outcome = request({ url: "https://cdn.example/app.js" });
    assert.equal(outcome.action, "allow");
    assert.equal(outcome.reason, "no-match");
  });

  test("with the blocker off nothing is matched at all", () => {
    const outcome = request({
      url: "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
      settings: allOff,
    });
    assert.equal(outcome.action, "allow");
    assert.equal(outcome.reason, "disabled");
  });

  test("a request that is not a URL is never judged", () => {
    const outcome = request({ url: "about:blank" });
    assert.equal(outcome.action, "allow");
    assert.equal(outcome.reason, "not-a-url");
  });

  test("allowing a site stops both rules and the data saver", () => {
    for (const settings of [adsOn, lowDataOn, bothOn]) {
      const outcome = request({
        url: "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
        type: "image",
        settings,
        siteAllowed: true,
      });
      assert.equal(outcome.action, "allow");
      assert.equal(outcome.reason, "site-allowed");
    }
  });
});

describe("decideRequest — the low-data alpha", () => {
  test("pictures become an empty pixel rather than a download", () => {
    const outcome = request({ url: "https://news.example/big.jpg", type: "image", settings: lowDataOn });
    assert.equal(outcome.action, "placeholder");
    assert.equal(outcome.type, "image");
  });

  test("audio, video, fonts and beacons are refused", () => {
    for (const type of ["media", "font", "ping"]) {
      const outcome = request({ url: "https://news.example/thing", type, settings: lowDataOn });
      assert.equal(outcome.action, "block", type);
      assert.equal(outcome.reason, "low-data", type);
      assert.equal(outcome.rule, null, type);
    }
  });

  test("it never touches anything that carries the page itself", () => {
    for (const type of ["document", "subdocument", "script", "stylesheet", "xmlhttprequest", "websocket", "other"]) {
      const outcome = request({ url: "https://news.example/thing", type, settings: lowDataOn });
      assert.equal(outcome.action, "allow", type);
      assert.equal(lowDataHandles(type), false, type);
    }
  });

  test("it is an independent switch: ads off, data saver on", () => {
    const outcome = request({ url: "https://news.example/big.jpg", type: "image", settings: lowDataOn });
    assert.equal(outcome.action, "placeholder");
  });

  test("a type the saver handles is one it names", () => {
    for (const type of ["image", "media", "font", "ping"]) {
      assert.equal(lowDataHandles(type), true, type);
    }
  });

  test("with both on, a rule that matches is reported as a rule, not as the saver", () => {
    const outcome = request({
      url: "https://cdn.doubleclick.net/ddm/ad.jpg",
      type: "image",
      settings: bothOn,
    });
    assert.equal(outcome.action, "block");
    assert.equal(outcome.reason, "rule");
  });
});

describe("decidePopup", () => {
  const popupSettings = { ...allOff, popups: true };
  const base = {
    pageUrl: "https://news.example/article",
    settings: popupSettings,
    siteAllowed: false,
  };

  test("a window opened by a click is allowed", () => {
    const outcome = decidePopup({ ...base, url: "https://news.example/a", gestureAgeMs: 40 });
    assert.equal(outcome.action, "allow");
    assert.equal(outcome.reason, "user-gesture");
  });

  test("a window that opens itself is blocked", () => {
    const outcome = decidePopup({ ...base, url: "https://ads.example/popunder", gestureAgeMs: null });
    assert.equal(outcome.action, "block");
    assert.equal(outcome.reason, "no-user-gesture");
  });

  test("a click long before the window opens does not count", () => {
    const outcome = decidePopup({
      ...base,
      url: "https://ads.example/popunder",
      gestureAgeMs: POPUP_GESTURE_WINDOW_MS + 1,
    });
    assert.equal(outcome.action, "block");
  });

  test("the window is inclusive on both ends", () => {
    for (const age of [0, POPUP_GESTURE_WINDOW_MS]) {
      assert.equal(decidePopup({ ...base, url: "https://news.example/a", gestureAgeMs: age }).action, "allow");
    }
  });

  test("switching the blocker off lets everything through", () => {
    const outcome = decidePopup({
      ...base,
      url: "https://ads.example/x",
      gestureAgeMs: null,
      settings: allOff,
    });
    assert.equal(outcome.action, "allow");
    assert.equal(outcome.reason, "disabled");
  });

  test("allowing a site lets its popups through", () => {
    const outcome = decidePopup({
      ...base,
      url: "https://ads.example/x",
      gestureAgeMs: null,
      siteAllowed: true,
    });
    assert.equal(outcome.action, "allow");
    assert.equal(outcome.reason, "site-allowed");
  });

  test("schemes that are not the web are not judged", () => {
    for (const url of ["about:blank", "data:text/html,x", "javascript:void 0", "mailto:a@b.test", "not a url"]) {
      const outcome = decidePopup({ ...base, url, gestureAgeMs: null });
      assert.equal(outcome.action, "allow", url);
      assert.equal(outcome.reason, "not-web", url);
    }
  });
});
