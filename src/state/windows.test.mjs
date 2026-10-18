/*
 * CrystalOS — window store tests
 *
 * Run with `npm test` (or `node --test src/state/windows.test.mjs`).
 *
 * The desktop must never end up with two windows on the same coordinates. It
 * is not a cosmetic rule: two windows at one spot are one window as far as the
 * pointer is concerned, so clicking the visible close button closes whichever
 * of the two is in front, and when that one goes the one underneath appears in
 * the same place. From the desk that reads as "the window came back instead of
 * closing", which is exactly the report these tests were written for.
 *
 * The pile is reachable three ways — opening, restoring a session, and
 * resizing the viewport — so all three are covered here, against a work area
 * narrow enough to clamp everything to the same corner.
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

/** `src/`, so `@/state/windows` resolves the same way Vite resolves it. */
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

const { useWindowStore } = await import("@/state/windows");

/* A desk barely wider than the windows under test: the case that piles, and the
   case a Chromebook or a laptop in a narrowed window actually has. */
const NARROW = { x: 0, y: 58, width: 800, height: 516 };
const WORK = { x: 0, y: 48, width: 1440, height: 806 };

const RESET = { windows: [], topZ: 100, focusedId: null, cascade: 0, workArea: WORK };

const app = (appId, defaultSize, extra = {}) => ({
  appId,
  title: appId,
  icon: "grid",
  defaultSize,
  minSize: { width: 280, height: 200 },
  ...extra,
});

const snapshotFor = (appId, rect, extra = {}) => ({
  appId,
  title: appId,
  icon: "grid",
  rect,
  restoreRect: rect,
  snapBox: undefined,
  state: "normal",
  minimized: false,
  workspaceId: undefined,
  sticky: undefined,
  args: undefined,
  ...extra,
});

/** Every pair of windows, with the distance between their top-left corners. */
function positions() {
  return useWindowStore.getState().windows.map((window) => ({
    id: window.id,
    appId: window.appId,
    x: window.rect.x,
    y: window.rect.y,
  }));
}

function assertNoPile() {
  const windows = positions();
  for (let i = 0; i < windows.length; i += 1) {
    for (let j = i + 1; j < windows.length; j += 1) {
      const apart =
        Math.abs(windows[i].x - windows[j].x) >= 26 || Math.abs(windows[i].y - windows[j].y) >= 26;
      assert.ok(
        apart,
        `${windows[i].appId} and ${windows[j].appId} share a spot ` +
          `(${windows[i].x},${windows[i].y}) vs (${windows[j].x},${windows[j].y})`,
      );
    }
  }
}

describe("opening windows on a narrow desk", () => {
  beforeEach(() => {
    useWindowStore.setState({ ...RESET });
    useWindowStore.getState().setWorkArea(NARROW);
  });

  test("six windows in a row each get their own spot", () => {
    const size = { width: 776, height: 440 };
    for (let i = 0; i < 6; i += 1) {
      useWindowStore.getState().open(app(`app-${i}`, size));
    }
    assert.equal(useWindowStore.getState().windows.length, 6);
    assertNoPile();
  });

  test("a window is still placed inside the work area and keeps its size", () => {
    useWindowStore.getState().open(app("wide", { width: 776, height: 440 }));
    useWindowStore.getState().open(app("also-wide", { width: 776, height: 440 }));
    for (const window of useWindowStore.getState().windows) {
      assert.equal(window.rect.width, 776);
      assert.equal(window.rect.height, 440);
      assert.ok(window.rect.x >= NARROW.x);
      assert.ok(window.rect.y >= NARROW.y);
      assert.ok(window.rect.y + 44 <= NARROW.y + NARROW.height, "the titlebar stays reachable");
    }
  });

  test("a window opened next to one that is minimized may take the free spot", () => {
    const first = useWindowStore.getState().open(app("small", { width: 300, height: 300 }));
    const second = useWindowStore.getState().open(app("small-2", { width: 300, height: 300 }));
    assert.notEqual(
      useWindowStore.getState().windows.find((window) => window.id === first).rect.x,
      useWindowStore.getState().windows.find((window) => window.id === second).rect.x,
    );
  });
});

describe("restoring a session that was saved as a pile", () => {
  beforeEach(() => {
    useWindowStore.setState({ ...RESET });
    useWindowStore.getState().setWorkArea(NARROW);
  });

  test("two windows saved at the same coordinates are restored apart", () => {
    const rect = { x: 0, y: 58, width: 760, height: 440 };
    const restored = useWindowStore
      .getState()
      .restoreWindows([
        snapshotFor("crystalvpn", rect),
        snapshotFor("browser", { ...rect, width: 776 }),
      ]);
    assert.equal(restored, 2);
    assertNoPile();
  });

  test("the window that was in front keeps the place it had", () => {
    const rect = { x: 0, y: 58, width: 760, height: 440 };
    useWindowStore
      .getState()
      .restoreWindows([snapshotFor("crystalvpn", rect), snapshotFor("settings", { ...rect })]);
    const windows = useWindowStore.getState().windows;
    const front = windows.find((window) => window.focused);
    assert.equal(front.appId, "settings", "the last window in the snapshot is the one in front");
    assert.deepEqual(
      { x: front.rect.x, y: front.rect.y },
      { x: rect.x, y: rect.y },
      "the window in front should not be the one that moves",
    );
  });

  test("a maximized window does not shove the others around on restore", () => {
    useWindowStore.getState().restoreWindows([
      snapshotFor("browser", { x: 40, y: 70, width: 500, height: 400 }),
      snapshotFor("terminal", { x: 80, y: 90, width: 500, height: 400 }, { state: "maximized" }),
    ]);
    const windows = useWindowStore.getState().windows;
    const normal = windows.find((window) => window.appId === "browser");
    assert.deepEqual({ x: normal.rect.x, y: normal.rect.y }, { x: 40, y: 70 });
  });

  test("a pile of four is fully separated", () => {
    const rect = { x: 0, y: 58, width: 776, height: 440 };
    useWindowStore
      .getState()
      .restoreWindows(["a", "b", "c", "d"].map((appId) => snapshotFor(appId, rect)));
    assert.equal(useWindowStore.getState().windows.length, 4);
    assertNoPile();
  });
});

describe("shrinking the desk", () => {
  beforeEach(() => {
    useWindowStore.setState({ ...RESET });
    useWindowStore.getState().setWorkArea(WORK);
  });

  test("windows that a smaller work area clamps together are pulled apart", () => {
    useWindowStore.getState().open(app("one", { width: 700, height: 500 }));
    useWindowStore.getState().open(app("two", { width: 700, height: 500 }));
    useWindowStore.getState().open(app("three", { width: 700, height: 500 }));
    assertNoPile();

    // The same desk in a much narrower window: every one of them clamps.
    useWindowStore.getState().setWorkArea({ x: 0, y: 58, width: 760, height: 500 });
    assertNoPile();
    for (const window of useWindowStore.getState().windows) {
      assert.ok(window.rect.width <= 760, "a window never ends up wider than the desk");
    }
  });

  test("a window with room of its own is left alone when the desk changes", () => {
    useWindowStore.getState().open(app("small", { width: 300, height: 300 }));
    const before = useWindowStore.getState().windows[0].rect;
    useWindowStore.getState().setWorkArea({ x: 0, y: 58, width: 1200, height: 700 });
    assert.deepEqual(useWindowStore.getState().windows[0].rect, before);
  });
});

describe("closing a window", () => {
  beforeEach(() => {
    useWindowStore.setState({ ...RESET });
    useWindowStore.getState().setWorkArea(NARROW);
  });

  test("closing removes that window and hands focus to the next one down", () => {
    const size = { width: 500, height: 400 };
    const first = useWindowStore.getState().open(app("first", size));
    const second = useWindowStore.getState().open(app("second", size));
    useWindowStore.getState().focus(first);
    useWindowStore.getState().close(first);

    const { windows, focusedId } = useWindowStore.getState();
    assert.deepEqual(windows.map((window) => window.id), [second]);
    assert.equal(focusedId, second);
  });

  test("a closed window does not come back when the desk is resized", () => {
    const size = { width: 700, height: 440 };
    const first = useWindowStore.getState().open(app("first", size));
    useWindowStore.getState().open(app("second", size));
    useWindowStore.getState().close(first);
    useWindowStore.getState().setWorkArea({ x: 0, y: 58, width: 640, height: 480 });
    assert.equal(useWindowStore.getState().windows.length, 1);
  });
});
