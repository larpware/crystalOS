/*
 * CrystalOS — browser state tests
 *
 * Run with `npm test` (or `node --test src/state/browser.test.mjs`).
 *
 * These cover the tab lifecycle, and one property in particular: writing the
 * tab that is already active must not publish a new state object. Components in
 * the Browser read the whole store rather than a slice of it, so a write that
 * changes nothing still re-renders every one of them — and an effect that made
 * such a write re-runs on the render it caused. That is not a slow render; it
 * is an infinite loop ("Maximum update depth exceeded") that takes the whole
 * window down, which is what happened the first time a link was opened into a
 * fresh Browser window.
 *
 * Node resolves neither Vite's `@/` alias nor extensionless relative imports,
 * so the hook below maps them the way the bundler does.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

/** `src/`, so `@/state/browser` resolves the same way Vite resolves it. */
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

const { useBrowserStore, blockReason, resolveAddress } = await import("@/state/browser");

beforeEach(() => {
  useBrowserStore.setState({
    tabs: [],
    activeTabId: null,
    history: [],
    bookmarks: [],
    downloads: [],
    proxyMode: "inherit",
  });
});

describe("setActiveTab", () => {
  test("activating the tab that is already active publishes nothing", () => {
    const { newTab } = useBrowserStore.getState();
    const id = newTab("example.com", true);
    const before = useBrowserStore.getState();
    assert.equal(before.activeTabId, id);

    before.setActiveTab(id);

    // Same object, not merely an equal one: no subscriber is notified.
    assert.equal(useBrowserStore.getState(), before);
  });

  test("activating a different tab does publish", () => {
    const { newTab } = useBrowserStore.getState();
    const first = newTab("example.com", true);
    const second = newTab("example.org", true);
    const before = useBrowserStore.getState();
    assert.equal(before.activeTabId, second);

    before.setActiveTab(first);

    const after = useBrowserStore.getState();
    assert.notEqual(after, before);
    assert.equal(after.activeTabId, first);
  });
});

describe("tab lifecycle", () => {
  test("newTab returns an id and activates it by default", () => {
    const id = useBrowserStore.getState().newTab("example.com");
    const state = useBrowserStore.getState();
    assert.equal(state.activeTabId, id);
    assert.equal(state.tabs.length, 1);
    assert.equal(state.tabs[0].id, id);
  });

  test("newTab can be opened in the background", () => {
    const first = useBrowserStore.getState().newTab("example.com", true);
    useBrowserStore.getState().newTab("example.org", false);
    const state = useBrowserStore.getState();
    assert.equal(state.tabs.length, 2);
    assert.equal(state.activeTabId, first);
  });

  test("closing the active tab falls back to the last remaining one", () => {
    const a = useBrowserStore.getState().newTab("a.example", true);
    const b = useBrowserStore.getState().newTab("b.example", true);
    useBrowserStore.getState().closeTab(b);
    const state = useBrowserStore.getState();
    assert.deepEqual(state.tabs.map((tab) => tab.id), [a]);
    assert.equal(state.activeTabId, a);
  });

  test("closing a background tab leaves the active one alone", () => {
    const a = useBrowserStore.getState().newTab("a.example", true);
    const b = useBrowserStore.getState().newTab("b.example", true);
    useBrowserStore.getState().closeTab(a);
    const state = useBrowserStore.getState();
    assert.deepEqual(state.tabs.map((tab) => tab.id), [b]);
    assert.equal(state.activeTabId, b);
  });

  test("closing the last tab leaves no active tab, not a dangling id", () => {
    const id = useBrowserStore.getState().newTab("a.example", true);
    useBrowserStore.getState().closeTab(id);
    const state = useBrowserStore.getState();
    assert.deepEqual(state.tabs, []);
    assert.equal(state.activeTabId, null);
  });

  test("closeOtherTabs keeps exactly the named tab and activates it", () => {
    useBrowserStore.getState().newTab("a.example", true);
    const b = useBrowserStore.getState().newTab("b.example", true);
    useBrowserStore.getState().newTab("c.example", true);
    useBrowserStore.getState().closeOtherTabs(b);
    const state = useBrowserStore.getState();
    assert.deepEqual(state.tabs.map((tab) => tab.id), [b]);
    assert.equal(state.activeTabId, b);
  });
});

describe("navigation", () => {
  test("a typed address goes back through the proxy even if the tab was direct", () => {
    const id = useBrowserStore.getState().newTab("example.com", true);
    useBrowserStore.getState().setDirectMode(id, true);
    assert.equal(useBrowserStore.getState().tabs[0].direct, true);

    const result = useBrowserStore.getState().navigate(id, "example.org");

    assert.equal(result.ok, true);
    const tab = useBrowserStore.getState().tabs[0];
    assert.equal(tab.url, result.url);
    assert.equal(tab.direct, false);
  });

  test("an empty address is refused rather than navigated", () => {
    const id = useBrowserStore.getState().newTab("example.com", true);
    const before = useBrowserStore.getState().tabs[0].url;
    const result = useBrowserStore.getState().navigate(id, "   ");
    assert.equal(result.ok, false);
    assert.equal(useBrowserStore.getState().tabs[0].url, before);
  });

  test("the address resolver and the frame's own rules agree", () => {
    // Anything the resolver refuses is a thing the panes would refuse to load.
    assert.equal(resolveAddress("example.com", "duckduckgo"), "https://example.com");
    assert.equal(resolveAddress("localhost:5173/x", "duckduckgo"), "http://localhost:5173/x");
    assert.equal(resolveAddress("about:crystal", "duckduckgo"), "about:crystal");
    assert.ok(resolveAddress("how do i bake bread", "duckduckgo").includes("duckduckgo"));
    assert.ok(blockReason("javascript:alert(1)"));
    assert.equal(blockReason("https://example.com"), null);
  });
});
