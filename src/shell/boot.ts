/* ==========================================================================
   Boot timing

   Two different things decide how long the boot screen stays up, and keeping
   them separate is the point.

   MIN_VISIBLE_MS is the honest floor. A warm profile can finish every real
   startup step in a single frame, and a boot screen that flashes for 20ms reads
   as a glitch rather than as a start, so it is held briefly even when there is
   nothing left to wait for.

   The hold above that floor is presentational. It is chosen once per boot from
   a randomised window so a start reads as a start, and it is the only part of
   boot that is not work — which is why Settings → Power can switch it off
   ("Remove extra boot animation time"), and why reduced motion or performance
   mode skips it without being asked. When it is skipped the screen falls back
   to the honest floor and nothing else changes.

   The maths lives here, apart from React, so it can be tested directly.
   ========================================================================== */

/** The honest floor: enough that a warm profile never flashes. */
export const MIN_VISIBLE_MS = 900;

/** The shortest and longest presentational hold, in milliseconds. */
export const BOOT_HOLD_MIN_MS = 3000;
export const BOOT_HOLD_MAX_MS = 7000;

/** Everything that decides whether the presentational hold applies. */
export interface BootTargetInput {
  /** True when Settings → Power asked for the extra time to be removed. */
  removeExtraBootAnimation: boolean;
  performanceMode: boolean;
  motionOverride: "system" | "full" | "subtle" | "reduced";
  /** The live result of the operating system's own reduced-motion query. */
  prefersReducedMotion: boolean;
}

/** True when motion is reduced by the machine, the OS or performance mode. */
export function bootHoldSuppressed(input: BootTargetInput): boolean {
  if (input.removeExtraBootAnimation || input.performanceMode) return true;
  if (input.motionOverride === "reduced") return true;
  return input.motionOverride === "system" && input.prefersReducedMotion;
}

/**
 * How long this boot will hold the screen, in milliseconds, chosen once.
 *
 * `random` is injectable so a test can pin the value instead of sampling it.
 * Elapsed real work still counts against the result: the caller subtracts the
 * time already spent and only waits out the remainder, so a slow session check
 * is never pushed past the hold by a second timer.
 */
export function resolveBootTargetMs(
  input: BootTargetInput,
  random: () => number = Math.random,
): number {
  if (bootHoldSuppressed(input)) return MIN_VISIBLE_MS;
  const span = BOOT_HOLD_MAX_MS - BOOT_HOLD_MIN_MS;
  // `random()` is contractually in [0, 1); the clamp is belt-and-braces for a
  // stub that returns 1 or a little over and would otherwise overshoot.
  const sample = Math.min(Math.max(random(), 0), 0.999999);
  return BOOT_HOLD_MIN_MS + Math.round(sample * span);
}

/**
 * Fisher–Yates on a copy, with an injectable source of randomness so the order
 * is reproducible under test. The input array is never reordered.
 */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.min(Math.max(random(), 0), 0.999999) * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}
