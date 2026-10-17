/*
 * CrystalOS — window geometry tests
 *
 * Run with `npm test` (or `node --test src/window-manager/geometry.test.mjs`).
 *
 * geometry.ts has no runtime imports on purpose, so the Node test runner can
 * load it directly (type stripping removes the type-only import). These cover
 * the parts of window management that are pure arithmetic and therefore can be
 * checked exactly: snap tiling, the fractional tile that survives a viewport
 * change, the snap-zone bands, and the resize rules.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyResize,
  constrainToWorkArea,
  detectSnapZone,
  fractionOf,
  isMaximizeZone,
  rectFromFraction,
  viewportInOsSpace,
  zoneRect,
} from "./geometry.ts";

/* The work area of a 1440×900 window with the bar and dock reserved, i.e. an
   origin that is not (0, 0) — the case a hardcoded screen size gets wrong. */
const WORK = { x: 0, y: 48, width: 1440, height: 806 };

/** An odd work area on purpose: half-splits must still line up exactly. */
const ODD = { x: 7, y: 46, width: 1203, height: 819 };

const right = (rect) => rect.x + rect.width;
const bottom = (rect) => rect.y + rect.height;

describe("zoneRect", () => {
  for (const [name, work] of [["even", WORK], ["odd", ODD]]) {
    test(`left and right halves tile the work area with no gap or overlap (${name})`, () => {
      const left = zoneRect("left", work);
      const rightHalf = zoneRect("right", work);

      assert.equal(left.x, work.x);
      assert.equal(left.y, work.y);
      assert.equal(left.height, work.height);
      assert.equal(right(left), rightHalf.x, "the halves must meet exactly");
      assert.equal(right(rightHalf), work.x + work.width);
      assert.equal(rightHalf.height, work.height);
      assert.equal(rightHalf.y, work.y);
    });

    test(`quarter zones tile the work area (${name})`, () => {
      const topLeft = zoneRect("top-left", work);
      const topRight = zoneRect("top-right", work);
      const bottomLeft = zoneRect("bottom-left", work);
      const bottomRight = zoneRect("bottom-right", work);

      assert.equal(right(topLeft), topRight.x);
      assert.equal(right(bottomLeft), bottomRight.x);
      assert.equal(bottom(topLeft), bottomLeft.y);
      assert.equal(bottom(topRight), bottomRight.y);
      assert.equal(right(bottomRight), work.x + work.width);
      assert.equal(bottom(bottomRight), work.y + work.height);
      assert.equal(topLeft.x, work.x);
      assert.equal(topLeft.y, work.y);
    });
  }

  test("every zone is whole pixels, so neighbours cannot overlap by a fraction", () => {
    for (const zone of ["left", "right", "top-left", "top-right", "bottom-left", "bottom-right"]) {
      for (const value of Object.values(zoneRect(zone, ODD))) {
        assert.equal(Number.isInteger(value), true, `${zone} produced ${value}`);
      }
    }
  });

  test("a zone never leaves the work area", () => {
    for (const zone of ["left", "right", "top-left", "top-right", "bottom-left", "bottom-right"]) {
      const rect = zoneRect(zone, WORK);
      assert.ok(rect.x >= WORK.x, zone);
      assert.ok(rect.y >= WORK.y, zone);
      assert.ok(right(rect) <= WORK.x + WORK.width, zone);
      assert.ok(bottom(rect) <= WORK.y + WORK.height, zone);
    }
  });
});

describe("fractional tiles (what survives a viewport change)", () => {
  test("a round trip through a fraction returns the same rect", () => {
    const rect = zoneRect("right", WORK);
    assert.deepEqual(rectFromFraction(fractionOf(rect, WORK), WORK), rect);
  });

  test("a left half stays the left half after the viewport grows or shrinks", () => {
    const box = fractionOf(zoneRect("left", WORK), WORK);
    const smaller = { x: 0, y: 40, width: 900, height: 600 };
    const bigger = { x: 0, y: 40, width: 2560, height: 1400 };

    for (const work of [smaller, bigger]) {
      const rect = rectFromFraction(box, work);
      assert.equal(rect.x, work.x);
      assert.equal(rect.width, Math.round(work.width / 2));
      assert.equal(rect.height, work.height);
    }
  });

  test("a quarter tile keeps its share and its corner", () => {
    const box = fractionOf(zoneRect("bottom-right", WORK), WORK);
    const work = { x: 10, y: 60, width: 1000, height: 700 };
    const rect = rectFromFraction(box, work);
    assert.equal(rect.x, 10 + 500);
    assert.equal(rect.y, 60 + 350);
    assert.equal(rect.width, 500);
    assert.equal(rect.height, 350);
  });

  test("a degenerate work area does not produce NaN or Infinity", () => {
    const box = fractionOf({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 0 });
    for (const value of Object.values(box)) assert.equal(Number.isFinite(value), true);
    const rect = rectFromFraction(box, { x: 0, y: 0, width: 0, height: 0 });
    for (const value of Object.values(rect)) assert.equal(Number.isFinite(value), true);
  });
});

describe("detectSnapZone", () => {
  test("the left and right edges snap to halves", () => {
    assert.equal(detectSnapZone({ x: WORK.x + 4, y: WORK.y + WORK.height / 2 }, WORK), "left");
    assert.equal(
      detectSnapZone({ x: WORK.x + WORK.width - 4, y: WORK.y + WORK.height / 2 }, WORK),
      "right",
    );
  });

  test("the corners of the edge band snap to quarters", () => {
    assert.equal(detectSnapZone({ x: WORK.x + 2, y: WORK.y + 2 }, WORK), "top-left");
    assert.equal(
      detectSnapZone({ x: WORK.x + WORK.width - 2, y: WORK.y + WORK.height - 2 }, WORK),
      "bottom-right",
    );
  });

  test("the middle of the desk snaps to nothing", () => {
    assert.equal(detectSnapZone({ x: WORK.x + WORK.width / 2, y: WORK.y + WORK.height / 2 }, WORK), null);
  });

  test("points outside the work area on the top edge do not become snap zones", () => {
    assert.equal(detectSnapZone({ x: WORK.x + WORK.width / 2, y: WORK.y - 20 }, WORK), null);
  });
});

describe("isMaximizeZone", () => {
  test("only the very top edge maximizes", () => {
    assert.equal(isMaximizeZone({ x: 700, y: WORK.y + 3 }, WORK), true);
    assert.equal(isMaximizeZone({ x: 700, y: WORK.y + 40 }, WORK), false);
  });
});

describe("applyResize", () => {
  const minSize = { width: 320, height: 240 };
  const start = { x: 100, y: 100, width: 600, height: 400 };

  test("the east handle grows the width and leaves the left edge alone", () => {
    const rect = applyResize({ handle: "e", startRect: start, dx: 50, dy: 0, minSize, workArea: WORK });
    assert.deepEqual(rect, { x: 100, y: 100, width: 650, height: 400 });
  });

  test("the north handle moves the top edge and compensates the height", () => {
    const rect = applyResize({ handle: "n", startRect: start, dx: 0, dy: -40, minSize, workArea: WORK });
    assert.equal(rect.y, 60);
    assert.equal(rect.height, 440);
    assert.equal(rect.y + rect.height, 500, "the bottom edge must not move");
  });

  test("the north handle stops at the minimum height", () => {
    const rect = applyResize({ handle: "n", startRect: start, dx: 0, dy: 900, minSize, workArea: WORK });
    assert.equal(rect.height, minSize.height);
  });

  test("the west handle stops at the minimum width", () => {
    const rect = applyResize({ handle: "w", startRect: start, dx: 900, minSize, workArea: WORK });
    assert.equal(rect.width, minSize.width);
    assert.equal(rect.x + rect.width, start.x + start.width, "the right edge stays put");
  });

  test("resizing cannot leave the work area", () => {
    const rect = applyResize({
      handle: "se",
      startRect: start,
      dx: 10_000,
      dy: 10_000,
      minSize,
      workArea: WORK,
    });
    assert.equal(rect.x + rect.width, WORK.x + WORK.width);
    assert.equal(rect.y + rect.height, WORK.y + WORK.height);
  });
});

/*
 * The regression this guards: with the shell zoomed to 150%, the work area was
 * still measured from the raw viewport, so a maximized window came out 1.5x the
 * screen and its titlebar left the viewport — an unclosable, unmovable window.
 * A maximized window must fit inside the OS space for the same viewport.
 */
describe("viewportInOsSpace", () => {
  test("100% scale is the identity", () => {
    assert.deepEqual(viewportInOsSpace(1440, 900, 1), { width: 1440, height: 900 });
  });

  test("a 150% scale divides the viewport, so a maximized window still fits", () => {
    const space = viewportInOsSpace(1440, 900, 1.5);
    assert.deepEqual(space, { width: 960, height: 600 });
    // The maximized window is the OS space: it can never be larger than the
    // viewport it is drawn into once the scale is applied back.
    assert.equal(space.width * 1.5, 1440);
    assert.equal(space.height * 1.5, 900);
  });

  test("a shrunken 75% scale grows the desktop", () => {
    assert.deepEqual(viewportInOsSpace(1440, 900, 0.75), { width: 1920, height: 1200 });
  });

  test("a zero or invalid scale falls back to 100% instead of dividing by zero", () => {
    assert.deepEqual(viewportInOsSpace(1440, 900, 0), { width: 1440, height: 900 });
    assert.deepEqual(viewportInOsSpace(1440, 900, Number.NaN), { width: 1440, height: 900 });
  });

  test("the desktop never reports less than a usable minimum", () => {
    const tiny = viewportInOsSpace(320, 200, 1);
    assert.equal(tiny.width, 320);
    assert.equal(tiny.height, 240);
  });
});

describe("constrainToWorkArea", () => {
  test("a window dragged off the right edge keeps 140px to grab", () => {
    const dragged = constrainToWorkArea({ x: 5000, y: 200, width: 600, height: 400 }, WORK);
    assert.equal(dragged.x, WORK.x + WORK.width - 140);
    assert.equal(dragged.width, 600, "the size is never changed");
  });

  test("a window dragged off the bottom keeps its titlebar on the desk", () => {
    const dragged = constrainToWorkArea({ x: 200, y: 5000, width: 600, height: 400 }, WORK);
    assert.equal(dragged.y, WORK.y + WORK.height - 44);
    assert.equal(dragged.height, 400);
  });

  test("a window narrower than the reachable strip stays fully on the desk", () => {
    const dragged = constrainToWorkArea({ x: 5000, y: 200, width: 120, height: 300 }, WORK);
    assert.equal(right(dragged), WORK.x + WORK.width);
  });

  test("a window dragged above or left of the desk is pushed back in", () => {
    const dragged = constrainToWorkArea({ x: -400, y: -400, width: 600, height: 400 }, WORK);
    assert.equal(dragged.x, WORK.x);
    assert.equal(dragged.y, WORK.y);
  });

  test("a window already inside the work area is not moved", () => {
    const inside = { x: 200, y: 200, width: 500, height: 400 };
    assert.deepEqual(constrainToWorkArea(inside, WORK), inside);
  });
});
