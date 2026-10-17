/*
 * CrystalOS — boot timing tests
 *
 * Run with `npm test` (or `node --test src/shell/boot.test.mjs`).
 *
 * boot.ts holds no React and imports nothing at runtime, so the Node test
 * runner loads it directly and the timing decisions can be pinned instead of
 * sampled.
 *
 * Two properties matter here. First, the presentational hold must stay inside
 * the window it advertises, whatever the random source does — a bar that fills
 * in five seconds while the screen waits for four is a lie about the boot.
 * Second, and the reason the setting exists: when the extra time is removed, or
 * when motion is reduced, or when performance mode is on, the result must be
 * the honest floor and nothing else.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BOOT_HOLD_MAX_MS,
  BOOT_HOLD_MIN_MS,
  MIN_VISIBLE_MS,
  bootHoldSuppressed,
  resolveBootTargetMs,
  shuffled,
} from "./boot.ts";

/** The "nothing special is going on" input the tests vary one field at a time. */
const baseline = {
  removeExtraBootAnimation: false,
  performanceMode: false,
  motionOverride: "system",
  prefersReducedMotion: false,
};

describe("resolveBootTargetMs", () => {
  test("stays inside the advertised hold window at both extremes", () => {
    assert.equal(resolveBootTargetMs(baseline, () => 0), BOOT_HOLD_MIN_MS);
    assert.equal(resolveBootTargetMs(baseline, () => 0.5), (BOOT_HOLD_MIN_MS + BOOT_HOLD_MAX_MS) / 2);
    // A source that returns 1 would overshoot without the clamp.
    assert.equal(resolveBootTargetMs(baseline, () => 1), BOOT_HOLD_MAX_MS);
  });

  test("never returns less than the honest floor", () => {
    for (const sample of [0, 0.25, 0.5, 0.75, 1]) {
      assert.ok(resolveBootTargetMs(baseline, () => sample) >= MIN_VISIBLE_MS);
    }
  });

  test("the floor is what a removed hold resolves to, whatever the sample", () => {
    const removed = { ...baseline, removeExtraBootAnimation: true };
    assert.equal(resolveBootTargetMs(removed, () => 0), MIN_VISIBLE_MS);
    assert.equal(resolveBootTargetMs(removed, () => 1), MIN_VISIBLE_MS);
  });

  test("reduced motion and performance mode each drop the hold", () => {
    assert.equal(
      resolveBootTargetMs({ ...baseline, motionOverride: "reduced" }, () => 1),
      MIN_VISIBLE_MS,
    );
    assert.equal(
      resolveBootTargetMs({ ...baseline, performanceMode: true }, () => 1),
      MIN_VISIBLE_MS,
    );
    // "system" only matters when the machine itself asks for reduced motion.
    assert.equal(
      resolveBootTargetMs({ ...baseline, prefersReducedMotion: true }, () => 1),
      MIN_VISIBLE_MS,
    );
    // An explicit "full" overrides the machine's preference.
    assert.equal(
      resolveBootTargetMs(
        { ...baseline, motionOverride: "full", prefersReducedMotion: true },
        () => 0,
      ),
      BOOT_HOLD_MIN_MS,
    );
  });
});

describe("bootHoldSuppressed", () => {
  test("agrees with the resolver about which inputs suppress the hold", () => {
    const cases = [
      baseline,
      { ...baseline, removeExtraBootAnimation: true },
      { ...baseline, performanceMode: true },
      { ...baseline, motionOverride: "reduced" },
      { ...baseline, prefersReducedMotion: true },
      { ...baseline, motionOverride: "full", prefersReducedMotion: true },
      { ...baseline, motionOverride: "subtle" },
    ];
    for (const input of cases) {
      const suppressed = bootHoldSuppressed(input);
      assert.equal(
        resolveBootTargetMs(input, () => 1) === MIN_VISIBLE_MS,
        suppressed,
        JSON.stringify(input),
      );
    }
  });
});

describe("shuffled", () => {
  test("keeps every item and does not touch the input", () => {
    const input = ["a", "b", "c", "d", "e"];
    const copy = input.slice();
    const out = shuffled(input, () => 0.5);
    assert.deepEqual([...out].sort(), [...copy].sort());
    assert.deepEqual(input, copy, "the source array must not be reordered");
  });

  test("is driven by the supplied source, so its order is reproducible", () => {
    const input = [1, 2, 3, 4];
    const first = shuffled(input, () => 0);
    const second = shuffled(input, () => 0);
    assert.deepEqual(first, second);
    // A constant-zero source pins every j to 0, which is a rotation, not a
    // no-op — proof the function really consumes the source.
    assert.notDeepEqual(first, input);
  });
});
