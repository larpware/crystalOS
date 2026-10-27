import { loadJSON, saveJSON } from "../storage";
import type { ResourceType } from "./filter";

/* ==========================================================================
   CrystalOS Shield — state

   One small store for everything the blocker needs to remember, so the plugin
   that enforces it, the browser panel that reports it and Settings all read
   the same values instead of keeping three opinions.

   What persists is only what the user decided: the switches and the sites they
   allowed. What a page requested is not written
   anywhere — the counters and the blocked-popup list live in memory for the
   session, which is also what keeps the panel honest: it can only report what
   happened in front of the user.
   ========================================================================== */

export interface ShieldSettings {
  /** Block advertising and tracking requests. */
  enabled: boolean;
  /** Stop pages opening windows the user did not ask for. */
  popups: boolean;
  /**
   * Alpha, off by default: the slow-connection data saver. See docs/SHIELD.md.
   * It is a *proxy* feature to the user (Settings → Proxy), and it is enforced
   * by this same plugin, so it lives beside the rest of the decisions.
   */
  lowData: boolean;
  /** Sites (registered domains) where nothing is blocked. */
  allowAds: string[];
  /** Sites where popups are allowed. */
  allowPopups: string[];
}

export interface PopupRecord {
  id: string;
  url: string;
  pageUrl: string | null;
  /** The window/tab that asked, when the caller knew. */
  owner: string | null;
  at: number;
}

export interface ShieldState {
  settings: ShieldSettings;
  /** Blocked request counts, keyed by owner (a browser tab id, or an app). */
  blocked: Record<string, number>;
  /** The popups that were stopped, newest first, bounded. */
  popups: PopupRecord[];
  /** Everything the page asked for, for the panel's one-line detail. */
  lastBlocked: Record<string, { host: string; type: ResourceType; rule: string | null } | undefined>;
}

const STORAGE_KEY = "shield.settings";

/** What Shield does before anyone changes anything. */
export const DEFAULT_SHIELD_SETTINGS: ShieldSettings = {
  enabled: true,
  popups: true,
  lowData: false,
  allowAds: [],
  allowPopups: [],
};

export const POPUP_LIST_LIMIT = 25;

function cleanHostList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => siteKey(entry))
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .sort();
}

function readSettings(): ShieldSettings {
  const stored = loadJSON<Partial<ShieldSettings> | null>(STORAGE_KEY, null);
  if (!stored || typeof stored !== "object") return { ...DEFAULT_SHIELD_SETTINGS };
  return {
    enabled: stored.enabled !== false,
    popups: stored.popups !== false,
    lowData: stored.lowData === true,
    allowAds: cleanHostList(stored.allowAds),
    allowPopups: cleanHostList(stored.allowPopups),
  };
}

let state: ShieldState = {
  settings: readSettings(),
  blocked: {},
  popups: [],
  lastBlocked: {},
};

const listeners = new Set<() => void>();
let notifyScheduled = false;

/**
 * Tells the listeners once per microtask.
 *
 * A page can have dozens of requests blocked while it loads, and a blocked
 * request is not a reason to re-render the browser's toolbar dozens of times.
 * The state itself is updated immediately — a reader always sees the truth —
 * only the notification is gathered up.
 */
function publish(next: ShieldState): void {
  state = next;
  if (notifyScheduled) return;
  notifyScheduled = true;
  const flush = () => {
    notifyScheduled = false;
    for (const listener of listeners) listener();
  };
  if (typeof queueMicrotask === "function") queueMicrotask(flush);
  else flush();
}

export function getShieldState(): ShieldState {
  return state;
}

export function subscribeShield(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function persist(settings: ShieldSettings): void {
  saveJSON(STORAGE_KEY, settings);
}

export function updateShieldSettings(patch: Partial<ShieldSettings>): ShieldSettings {
  const settings = { ...state.settings, ...patch };
  persist(settings);
  publish({ ...state, settings });
  return settings;
}

/**
 * True when the user has allowed this host to load everything.
 *
 * An entry covers the host itself and anything under it: allowing
 * `example.com` allows `www.example.com`, which is what a person means by
 * "allow this site". It never works upwards — allowing `ads.example.com` does
 * not allow `example.com` — because an allow that quietly widens is how a
 * blocker ends up blocking nothing.
 */
export function isSiteAllowed(host: string | null, list: string[] = state.settings.allowAds): boolean {
  if (!host) return false;
  const site = siteKey(host);
  return list.some((entry) => site === entry || site.endsWith("." + entry));
}

/** True when popups from this site are permitted. */
export function isPopupSiteAllowed(host: string | null): boolean {
  return isSiteAllowed(host, state.settings.allowPopups);
}

/**
 * The key a site is remembered under: the host itself. `www.example.com` and
 * `example.com` are separate entries on purpose — allowing a site should not
 * quietly allow every subdomain of it, which is how an "allow this site" click
 * turns into an ad blocker that blocks nothing.
 */
export function siteKey(host: string): string {
  return host.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
}

export function setSiteAllowed(host: string, allowed: boolean): void {
  const site = siteKey(host);
  if (!site) return;
  const next = new Set(state.settings.allowAds);
  if (allowed) next.add(site);
  else next.delete(site);
  updateShieldSettings({ allowAds: [...next].sort() });
}

export function setPopupSiteAllowed(host: string, allowed: boolean): void {
  const site = siteKey(host);
  if (!site) return;
  const next = new Set(state.settings.allowPopups);
  if (allowed) next.add(site);
  else next.delete(site);
  updateShieldSettings({ allowPopups: [...next].sort() });
}

/* ---- counters ------------------------------------------------------------ */

export function noteBlocked(
  owner: string | null,
  host: string,
  type: ResourceType,
  rule: string | null,
): void {
  const key = owner ?? "";
  publish({
    ...state,
    blocked: { ...state.blocked, [key]: (state.blocked[key] ?? 0) + 1 },
    lastBlocked: { ...state.lastBlocked, [key]: { host, type, rule } },
  });
}

export function blockedFor(owner: string | null): number {
  return state.blocked[owner ?? ""] ?? 0;
}

/** Called when a page navigates, so the count describes the page in front. */
export function resetBlocked(owner: string | null): void {
  const key = owner ?? "";
  if (!(key in state.blocked) && !(key in state.lastBlocked)) return;
  const blocked = { ...state.blocked };
  const lastBlocked = { ...state.lastBlocked };
  delete blocked[key];
  delete lastBlocked[key];
  publish({ ...state, blocked, lastBlocked });
}

export function lastBlockedFor(owner: string | null): { host: string; type: ResourceType; rule: string | null } | null {
  return state.lastBlocked[owner ?? ""] ?? null;
}

/* ---- popups -------------------------------------------------------------- */

let popupSeq = 0;

export function notePopup(record: Omit<PopupRecord, "id" | "at">): PopupRecord {
  const entry: PopupRecord = { ...record, id: `popup-${(popupSeq += 1)}`, at: Date.now() };
  const popups = [entry, ...state.popups].slice(0, POPUP_LIST_LIMIT);
  publish({ ...state, popups });
  return entry;
}

export function dismissPopup(id: string): void {
  const popups = state.popups.filter((entry) => entry.id !== id);
  if (popups.length === state.popups.length) return;
  publish({ ...state, popups });
}

export function clearPopups(): void {
  if (state.popups.length === 0) return;
  publish({ ...state, popups: [] });
}

export function popupsFor(owner: string | null): PopupRecord[] {
  if (!owner) return state.popups;
  return state.popups.filter((entry) => entry.owner === owner);
}

/** Test seam: forget every runtime counter and popup. */
export function resetShieldRuntime(): void {
  publish({ ...state, blocked: {}, popups: [], lastBlocked: {} });
}
