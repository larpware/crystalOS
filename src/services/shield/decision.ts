import {
  classifyDestination,
  hostnameOf,
  matchRequest,
  type FilterList,
  type ResourceType,
} from "./filter";
import type { ShieldSettings } from "./state";

/* ==========================================================================
   CrystalOS Shield — the decisions

   Two questions are asked on every page: may this request go out, and may this
   page open a window. Both are answered here, as pure functions of things that
   can be written down — the URL, the page that asked, the request type, the
   settings — so the answers can be tested without a browser and the plugin
   that enforces them stays a thin layer of wiring.

   Nothing here knows about Scramjet, storage or React.
   ========================================================================== */

export interface RequestFacts {
  url: string;
  /** The page that asked for it, when the transport knows. */
  pageUrl: string | null;
  type: ResourceType;
}

export type RequestOutcome =
  | { action: "allow"; reason: "disabled" | "site-allowed" | "not-a-url" | "no-match" }
  | {
      action: "block";
      reason: "rule" | "low-data";
      type: ResourceType;
      /** The rule line that decided it, when a rule did. */
      rule: string | null;
    }
  /** Low-data mode's answer for a picture: an empty pixel instead of the file. */
  | { action: "placeholder"; reason: "low-data"; type: ResourceType };

/** Types low-data mode refuses outright. See docs/SHIELD.md. */
export const LOW_DATA_BLOCKED_TYPES: readonly ResourceType[] = ["media", "font", "ping"];

/** Types low-data mode answers with a 1×1 transparent image. */
export const LOW_DATA_PLACEHOLDER_TYPES: readonly ResourceType[] = ["image"];

/**
 * True when low-data mode is willing to touch this type at all.
 *
 * Deliberately narrow. Documents, scripts, stylesheets and XHR all carry the
 * page itself; dropping any of them to save bandwidth produces a page that is
 * fast and broken, which is worse than a slow page.
 */
export function lowDataHandles(type: ResourceType): boolean {
  return LOW_DATA_BLOCKED_TYPES.includes(type) || LOW_DATA_PLACEHOLDER_TYPES.includes(type);
}

export interface RequestDecisionInput extends RequestFacts {
  settings: ShieldSettings;
  list: FilterList;
  /** True when the user has allowed this page's site to load everything. */
  siteAllowed: boolean;
}

export function decideRequest(input: RequestDecisionInput): RequestOutcome {
  const host = hostnameOf(input.url);
  if (!host) return { action: "allow", reason: "not-a-url" };

  // The user's escape hatch wins over every rule, including the data saver.
  if (input.siteAllowed) return { action: "allow", reason: "site-allowed" };

  if (input.settings.enabled) {
    const match = matchRequest(input.list, {
      url: input.url,
      pageUrl: input.pageUrl,
      type: input.type,
    });
    if (match.blocked) {
      return { action: "block", reason: "rule", type: input.type, rule: match.rule?.raw ?? null };
    }
  }

  if (input.settings.lowData && lowDataHandles(input.type)) {
    if (LOW_DATA_PLACEHOLDER_TYPES.includes(input.type)) {
      return { action: "placeholder", reason: "low-data", type: input.type };
    }
    return { action: "block", reason: "low-data", type: input.type, rule: null };
  }

  return { action: "allow", reason: input.settings.enabled ? "no-match" : "disabled" };
}

/** Convenience for callers that hold a `destination` string rather than a type. */
export function typeOfDestination(destination: string): ResourceType {
  return classifyDestination(destination);
}

/* ==========================================================================
   Popups

   A popup that a person asked for is a tab, not an annoyance: "open in new
   window" and the sign-in popups some sites use are all real user actions. What
   is worth stopping is the window that opens by itself, which is why the
   question is not "may this site open windows" but "did anything in front of
   the user ask for this".

   The browser already applies a version of that rule (transient activation).
   Measuring it here as well is what lets the request be *recorded and offered*
   instead of silently swallowed, which is the part a user can act on.
   ========================================================================== */

/**
 * How long after a real input a popup is still considered asked for.
 *
 * A click that opens a window fires within a frame or two of the event, so a
 * second is generous for a person and far too small a window for a script that
 * waits for the page to settle.
 */
export const POPUP_GESTURE_WINDOW_MS = 1200;

export interface PopupFacts {
  url: string;
  pageUrl: string | null;
  /** Milliseconds since the last real input on the page, or null if none was seen. */
  gestureAgeMs: number | null;
}

export interface PopupDecisionInput extends PopupFacts {
  settings: ShieldSettings;
  /** True when the user has allowed popups from this page's site. */
  siteAllowed: boolean;
}

export type PopupOutcome =
  | { action: "allow"; reason: "disabled" | "site-allowed" | "user-gesture" | "not-web" }
  | { action: "block"; reason: "no-user-gesture" };

/** True for the schemes a popup blocker has any business judging. */
export function isWebPopup(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function decidePopup(input: PopupDecisionInput): PopupOutcome {
  if (!input.settings.popups) return { action: "allow", reason: "disabled" };
  if (input.siteAllowed) return { action: "allow", reason: "site-allowed" };
  // `about:blank`, `data:` and friends are not what a popup blocker is for, and
  // a window opened empty is frequently filled in by the opener straight after.
  if (!isWebPopup(input.url)) return { action: "allow", reason: "not-web" };

  if (
    input.gestureAgeMs !== null &&
    input.gestureAgeMs >= 0 &&
    input.gestureAgeMs <= POPUP_GESTURE_WINDOW_MS
  ) {
    return { action: "allow", reason: "user-gesture" };
  }
  return { action: "block", reason: "no-user-gesture" };
}
