/*
 * CrystalOS — Scramjet frame readiness tests
 *
 * Run with `npm test` (or `node --test src/services/scramjet/frameReady.test.mjs`).
 *
 * frameReady.ts imports nothing at runtime, so the Node test runner can load it
 * directly with its types stripped. A minimal fake frame stands in for the
 * iframe: the decision under test is entirely about what the frame's document
 * contains and which events it raises, not about the DOM itself.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { frameHasRenderedDocument, waitForFrameLoad } from "./frameReady.ts";

/* ------------------------------------------------------------- fake pieces */

/** A document stub with only the fields the readiness check reads. */
function doc({ href = "https://site.example/", children = 1, text = "", title = "" } = {}) {
  return {
    location: { href },
    title,
    body: { childElementCount: children, textContent: text },
  };
}

/** An iframe stub: one document, and the listeners the wait attaches. */
function fakeFrame(initial) {
  const listeners = new Map();
  const frame = {
    _doc: initial,
    get contentDocument() {
      return this._doc;
    },
    setDocument(next) {
      this._doc = next;
    },
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type, fn) {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
    /** Raises an event; true when a listener was actually waiting for it. */
    fire(type) {
      const fn = listeners.get(type);
      if (!fn) return false;
      fn();
      return true;
    },
    hasListener: (type) => listeners.has(type),
  };
  return frame;
}

/**
 * A controllable replacement for the page's `window`.
 *
 * `waitForFrameLoad` schedules through `window.setTimeout`, so handing it this
 * makes every wait deterministic: the tests decide when the poll and the timeout
 * fire instead of sleeping through 350 ms ticks.
 */
function clock() {
  let next = 0;
  const timers = new Map();
  return {
    install() {
      globalThis.window = {
        setTimeout(fn, ms = 0) {
          const id = ++next;
          timers.set(id, { fn, ms });
          return id;
        },
        clearTimeout(id) {
          timers.delete(id);
        },
      };
    },
    /** Delays of every timer still waiting, so a test can name what it fires. */
    pendingDelays: () => [...timers.values()].map((timer) => timer.ms),
    /** Fires every pending timer with this exact delay. */
    fireDelay(ms) {
      for (const [id, timer] of [...timers]) {
        if (timer.ms === ms) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

/** Lets any already-resolved promise callbacks run before a test asserts. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Runs `body` with a fake clock installed, restoring `window` afterwards. */
async function withClock(body) {
  const previous = globalThis.window;
  const time = clock();
  time.install();
  try {
    return await body(time);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
}

/* --------------------------------------------------- the readiness predicate */

describe("frameHasRenderedDocument", () => {
  test("a blank frame is not a rendered document", () => {
    assert.equal(frameHasRenderedDocument(fakeFrame(null)), false);
    assert.equal(frameHasRenderedDocument(fakeFrame({})), false);
    assert.equal(
      frameHasRenderedDocument(fakeFrame({ body: null, location: { href: "https://x/" } })),
      false,
    );
    assert.equal(frameHasRenderedDocument(fakeFrame(doc({ href: "about:blank" }))), false);
    assert.equal(frameHasRenderedDocument(fakeFrame(doc({ href: "" }))), false);
  });

  test("the controller's bootstrap page — no elements and no text — is not rendered", () => {
    assert.equal(frameHasRenderedDocument(fakeFrame(doc({ children: 0, text: "   " }))), false);
  });

  test("a page with elements is rendered, with or without a title", () => {
    assert.equal(frameHasRenderedDocument(fakeFrame(doc({ children: 3, title: "Site" }))), true);
    // A page without a title is still a page. Requiring one made these wait out
    // the whole timeout and then report "Nothing loaded".
    assert.equal(frameHasRenderedDocument(fakeFrame(doc({ children: 3, title: "" }))), true);
  });

  test("a page that is only text is rendered", () => {
    assert.equal(frameHasRenderedDocument(fakeFrame(doc({ children: 0, text: "hello" }))), true);
  });

  test("an unreadable (cross-origin) frame is not rendered", () => {
    const frame = {
      get contentDocument() {
        throw new Error("cross-origin");
      },
    };
    assert.equal(frameHasRenderedDocument(frame), false);
  });
});

/* --------------------------------------------------------- the load wait */

describe("waitForFrameLoad", () => {
  test("a load event for a blank page does not resolve the wait", async () => {
    await withClock(async (time) => {
      const frame = fakeFrame(doc({ href: "about:blank" }));
      let settled = false;
      const waiting = waitForFrameLoad(frame, 25_000).then(
        () => (settled = "resolved"),
        () => (settled = "rejected"),
      );

      // The frame raises a load for the blank intermediate document.
      assert.equal(frame.fire("load"), true);
      await settle();
      assert.equal(settled, false, "a blank load must not be read as the page arriving");

      // The real page shows up and fires its own load.
      frame.setDocument(doc({ children: 5, title: "Site" }));
      frame.fire("load");
      await waiting;
      assert.equal(settled, "resolved");
    });
  });

  test("the poll resolves the wait when no later load event arrives", async () => {
    await withClock(async (time) => {
      const frame = fakeFrame(doc({ href: "about:blank" }));
      let settled = false;
      const waiting = waitForFrameLoad(frame, 25_000).then(() => (settled = true));

      // No load event at all; the page is simply there by the next poll tick.
      frame.setDocument(doc({ children: 2 }));
      assert.deepEqual(time.pendingDelays().sort((a, b) => a - b), [350, 25_000]);
      time.fireDelay(350);
      await waiting;
      assert.equal(settled, true);
    });
  });

  test("a frame that is already rendered resolves without waiting", async () => {
    await withClock(async () => {
      const frame = fakeFrame(doc({ children: 1 }));
      let settled = false;
      const waiting = waitForFrameLoad(frame, 25_000).then(() => (settled = true));
      await waiting;
      assert.equal(settled, true);
      // Nothing should still be scheduled once it settles.
      assert.equal(frame.hasListener("load"), false);
    });
  });

  test("nothing rendered before the timeout is a failure, not a blank success", async () => {
    await withClock(async (time) => {
      const frame = fakeFrame(doc({ href: "about:blank" }));
      const waiting = waitForFrameLoad(frame, 25_000);
      frame.fire("load"); // still blank
      time.fireDelay(25_000);
      await assert.rejects(waiting, /Nothing loaded within 25s/);
      assert.equal(frame.hasListener("load"), false);
    });
  });
});
