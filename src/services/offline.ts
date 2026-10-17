import type { OfflineMode } from "@/state/system";
import { useSystemStore } from "@/state/system";

/* ==========================================================================
   Offline mode

   Two different things can put CrystalOS out of touch, and they are not the
   same thing:

     - the browser reports no connection at all, or
     - the user has asked the OS to work offline on purpose.

   Both mean the same behaviour — nothing is attempted, and the answer is known
   before the request is made — but they are different sentences to a person,
   and only one of them is something they can act on. So the reason is carried
   through to every surface rather than collapsed into a single "offline" flag.

   The rule is a pure function so it can be tested without a browser, and the
   wording lives beside it so the panel, the notice and the settings page cannot
   end up describing the same state three different ways.
   ========================================================================== */

export type OfflineReason = "forced" | "browser";

export interface OfflineReport {
  /** True when CrystalOS should behave as though there is no network. */
  offline: boolean;
  /**
   * Why, or null when it is not offline at all:
   *   `forced`  the user turned offline mode on
   *   `browser` the browser reports no connection
   */
  reason: OfflineReason | null;
  /** What the browser itself reports, whichever mode is set. */
  browserOnline: boolean;
}

/** The whole rule: forced offline wins, otherwise the browser is believed. */
export function deriveOffline(mode: OfflineMode, browserOnline: boolean): OfflineReport {
  if (mode === "forced") {
    return { offline: true, reason: "forced", browserOnline };
  }
  return browserOnline
    ? { offline: false, reason: null, browserOnline }
    : { offline: true, reason: "browser", browserOnline };
}

/**
 * What a reader is told stops working, and what is unaffected. Listed once, in
 * the same words, wherever the OS explains its state.
 */
export const OFFLINE_UNAVAILABLE: readonly string[] = [
  "Proxied pages, and any site the Browser has not already loaded",
  "Signing in, messaging and sync",
  "The VPN tunnel",
  "Live widgets that fetch, such as the weather",
];

export const OFFLINE_AVAILABLE: readonly string[] = [
  "Files and the Trash",
  "Notes, the Terminal and the Calculator",
  "Settings, wallpapers and the whole desktop",
];

/**
 * What the browser reports about the connection.
 *
 * Only an explicit `false` counts as "no connection". `navigator.onLine` is
 * `undefined` in hosts that have a `navigator` but no connection information —
 * Node's global `navigator` is one — and "cannot tell" has to mean "try it"
 * rather than "give up". Reading an absent value as offline would have made the
 * whole OS claim to be offline everywhere it is not a browser.
 */
export function browserReportsOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/** The report as it stands right now, for code that is not a component. */
export function currentOffline(): OfflineReport {
  return deriveOffline(useSystemStore.getState().offlineMode, browserReportsOnline());
}

/** True when a request should not be attempted at all. */
export function isOfflineNow(): boolean {
  return currentOffline().offline;
}

/** One short line naming the state. */
export function offlineHeadline(report: OfflineReport): string {
  if (!report.offline) return "Connected";
  return report.reason === "forced" ? "Working offline" : "No network connection";
}

/** One sentence saying why, and who can do something about it. */
export function offlineExplanation(report: OfflineReport): string {
  if (!report.offline) return "CrystalOS can reach the network.";
  if (report.reason === "forced") {
    return "Offline mode is on, so CrystalOS is not attempting any network requests. Turn it off in Settings \u2192 Network.";
  }
  return "This device reports no network connection, so CrystalOS is not attempting any network requests.";
}
