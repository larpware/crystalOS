import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getAppComponent } from "@/apps/registry";
import { metaFor } from "@/apps/catalog";
import { useAppsStore } from "@/state/apps";
import { useWindowStore } from "@/state/windows";
import { useWorkspaceStore } from "@/state/workspaces";
import type { WindowSnapshot, WindowState } from "@/types";
import { listKeys, loadJSON, removeKey, saveJSON } from "./storage";

/* ==========================================================================
   CrystalOS session restore

   Captures the desktop — windows, their geometry, their workspace and which one
   was in front — as plain data, and puts it back on the next start.

   Two rules shape everything here:

   1. A session restores a *desktop*, not an application's insides. Applications
      own their own state (the browser persists its tabs, Notes its notes), so a
      window is restored with the arguments it accepts, never with a frozen
      copy of its memory.
   2. Saved data is untrusted input. Every field is validated on load, invalid
      windows are dropped instead of throwing, and one bad record can never stop
      the desktop from starting.
   ========================================================================== */

export const SESSION_VERSION = 1;
const SESSION_KEY = "session";
const MAX_WINDOWS = 40;
const MAX_TITLE = 120;
const MAX_ARGS = 12;

export interface SessionSnapshot {
  version: number;
  savedAt: number;
  activeWorkspaceId: string | null;
  /** Index into `windows` of the window that had focus. */
  focusedIndex: number;
  windows: WindowSnapshot[];
}

export interface SessionProblem {
  kind: "corrupt" | "version" | "partial";
  message: string;
}

const WINDOW_STATES: WindowState[] = ["normal", "minimized", "maximized", "snapped"];

/**
 * Applications that can describe their window arguments themselves. An app with
 * richer state (a document id, a selected tab) registers an extractor here; the
 * default keeps only primitive argument values.
 */
export interface RestorableApp {
  appId: string;
  extract?: (args: Record<string, unknown> | undefined) => Record<string, unknown> | undefined;
}

const restorableApps = new Map<string, RestorableApp>();

export function registerRestorableApp(entry: RestorableApp): void {
  restorableApps.set(entry.appId, entry);
}

function sanitiseArgs(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_ARGS);
  const result: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    if (typeof entry === "string") result[key] = entry.slice(0, 400);
    else if (typeof entry === "number" && Number.isFinite(entry)) result[key] = entry;
    else if (typeof entry === "boolean") result[key] = entry;
    else if (entry === null || entry === undefined) continue;
    // Anything else is deliberately dropped: no nested objects, no functions,
    // no DOM handles, no unbounded blobs.
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 100_000;
}

function validRect(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const rect = value as Record<string, unknown>;
  return finite(rect.x) && finite(rect.y) && finite(rect.width) && finite(rect.height);
}

export interface ValidationResult {
  snapshot: SessionSnapshot | null;
  problem: SessionProblem | null;
  /** Entries that were dropped, for the diagnostics panel. */
  dropped: number;
}

/** Validates a stored session. Never throws, never trusts the input. */
export function parseSession(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { snapshot: null, problem: { kind: "corrupt", message: "No usable session data was found." }, dropped: 0 };
  }
  const data = raw as Partial<SessionSnapshot> & { windows?: unknown };
  const version = typeof data.version === "number" ? data.version : 0;

  if (version > SESSION_VERSION) {
    return {
      snapshot: null,
      problem: {
        kind: "version",
        message: `The saved session comes from a newer build (v${version}) and was left untouched.`,
      },
      dropped: 0,
    };
  }

  const list = Array.isArray(data.windows) ? data.windows.slice(0, MAX_WINDOWS) : [];
  if (!Array.isArray(data.windows)) {
    return { snapshot: null, problem: { kind: "corrupt", message: "The saved session had no window list." }, dropped: 0 };
  }

  const windows: WindowSnapshot[] = [];
  let dropped = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== "object") {
      dropped += 1;
      continue;
    }
    const window = entry as Partial<WindowSnapshot>;
    if (
      typeof window.appId !== "string" ||
      !window.appId ||
      typeof window.title !== "string" ||
      typeof window.icon !== "string" ||
      !validRect(window.rect) ||
      !validRect(window.restoreRect)
    ) {
      dropped += 1;
      continue;
    }
    const state = WINDOW_STATES.includes(window.state as WindowState)
      ? (window.state as WindowState)
      : "normal";
    windows.push({
      appId: window.appId.slice(0, 64),
      title: window.title.slice(0, MAX_TITLE),
      icon: window.icon as WindowSnapshot["icon"],
      rect: window.rect as WindowSnapshot["rect"],
      restoreRect: window.restoreRect as WindowSnapshot["restoreRect"],
      state,
      minimized: window.minimized === true,
      workspaceId: typeof window.workspaceId === "string" ? window.workspaceId : undefined,
      sticky: window.sticky === true,
      args: sanitiseArgs(window.args),
    });
  }

  const snapshot: SessionSnapshot = {
    version: SESSION_VERSION,
    savedAt: typeof data.savedAt === "number" ? data.savedAt : Date.now(),
    activeWorkspaceId: typeof data.activeWorkspaceId === "string" ? data.activeWorkspaceId : null,
    focusedIndex:
      typeof data.focusedIndex === "number" && data.focusedIndex >= 0 && data.focusedIndex < windows.length
        ? data.focusedIndex
        : -1,
    windows,
  };

  return {
    snapshot,
    problem: dropped > 0 ? { kind: "partial", message: `${dropped} saved window(s) could not be read and were skipped.` } : null,
    dropped,
  };
}

/* ---- capture ------------------------------------------------------------- */

export function captureSession(): SessionSnapshot {
  const windows = useWindowStore.getState().snapshot();
  const focusedIndex = useWindowStore
    .getState()
    .windows.findIndex((window) => window.focused);
  return {
    version: SESSION_VERSION,
    savedAt: Date.now(),
    activeWorkspaceId: useWorkspaceStore.getState().activeId ?? null,
    focusedIndex: focusedIndex >= 0 && focusedIndex < windows.length ? focusedIndex : -1,
    windows,
  };
}

export function saveSession(): SessionSnapshot {
  const snapshot = captureSession();
  saveJSON(SESSION_KEY, snapshot);
  useSessionStore.setState({ lastSavedAt: snapshot.savedAt, windowCount: snapshot.windows.length });
  return snapshot;
}

export function readStoredSession(): ValidationResult {
  /* Nothing saved is not a fault. A new profile simply has no desktop to put
     back, and reporting that as corruption would greet every first boot with a
     warning about its own emptiness. Only data that exists and cannot be read
     counts as a problem. */
  if (!listKeys().includes(SESSION_KEY)) {
    return { snapshot: null, problem: null, dropped: 0 };
  }
  const raw = loadJSON<unknown>(SESSION_KEY, null);
  return parseSession(raw);
}

export function clearSession(): void {
  removeKey(SESSION_KEY);
  useSessionStore.setState({ lastSavedAt: null, windowCount: 0, problems: [] });
}

/* ---- restore ------------------------------------------------------------- */

export interface RestoreReport {
  restored: number;
  skipped: { appId: string; reason: string }[];
  problem: SessionProblem | null;
  /** False when the user has restoration switched off. */
  enabled: boolean;
}

function restoreAllowed(appId: string, excluded: string[]): { ok: boolean; reason?: string } {
  if (excluded.includes(appId)) return { ok: false, reason: "Excluded in Settings → Session." };
  if (useAppsStore.getState().removed.includes(appId)) return { ok: false, reason: "Removed from this profile." };
  if (!metaFor(appId)) return { ok: false, reason: "No longer installed." };
  if (!getAppComponent(appId)) return { ok: false, reason: "Its bundle is missing from this build." };
  return { ok: true };
}

export function restoreSession(): RestoreReport {
  const settings = useSessionStore.getState();
  if (!settings.restoreOnStart) {
    return { restored: 0, skipped: [], problem: null, enabled: false };
  }

  const { snapshot, problem } = readStoredSession();
  if (!snapshot || snapshot.windows.length === 0) {
    return { restored: 0, skipped: [], problem, enabled: true };
  }

  const skipped: { appId: string; reason: string }[] = [];
  const accepted: WindowSnapshot[] = [];
  /* A singleton application is one window by catalogue rule. The rule is
     enforced when a window is opened, but a session written before it existed
     (or by a build that did not enforce it) can hold two of them — restoring
     both hands the desk two Stores that both believe they are the only one.
     The first copy is restored; the extra copies are reported, like every
     other window that cannot come back. */
  const singletonsSeen = new Set<string>();
  for (const window of snapshot.windows) {
    const verdict = restoreAllowed(window.appId, settings.excludedApps);
    if (!verdict.ok) {
      skipped.push({ appId: window.appId, reason: verdict.reason ?? "Unavailable." });
      continue;
    }
    const meta = metaFor(window.appId);
    if (meta?.singleton) {
      if (singletonsSeen.has(window.appId)) {
        skipped.push({
          appId: window.appId,
          reason: "This application keeps a single window, and one was already restored.",
        });
        continue;
      }
      singletonsSeen.add(window.appId);
    }
    accepted.push(window);
  }
  if (accepted.length === 0) {
    return { restored: 0, skipped, problem, enabled: true };
  }

  // The workspace has to exist before its windows do.
  const spaces = useWorkspaceStore.getState();
  const workspace = snapshot.activeWorkspaceId;
  if (workspace && spaces.workspaces.some((entry) => entry.id === workspace)) {
    spaces.activate(workspace);
  }

  const restored = useWindowStore.getState().restoreWindows(accepted);

  // Restore focus to the window that had it, when it survived validation.
  const focused = snapshot.focusedIndex >= 0 ? accepted[snapshot.focusedIndex] : undefined;
  if (focused) {
    const live = useWindowStore
      .getState()
      .windows.filter((window) => window.appId === focused.appId && !window.minimized)
      .sort((a, b) => b.z - a.z)[0];
    if (live) useWindowStore.getState().focus(live.id);
  }

  useSessionStore.setState({
    lastRestoredAt: Date.now(),
    lastRestoreCount: restored,
    problems: problem ? [problem] : [],
  });

  return { restored, skipped, problem, enabled: true };
}

/* ---- autosave ------------------------------------------------------------ */

let pending: number | null = null;

/** Debounced write: window drags and tab switches coalesce into one save. */
export function scheduleSessionSave(delayMs = 700): void {
  if (typeof window === "undefined") return;
  if (!useSessionStore.getState().autosave || !useSessionStore.getState().restoreOnStart) return;
  if (pending !== null) window.clearTimeout(pending);
  pending = window.setTimeout(() => {
    pending = null;
    saveSession();
  }, delayMs);
}

/** Writes immediately — used when leaving the desktop deliberately. */
export function flushSessionSave(): void {
  if (pending !== null && typeof window !== "undefined") {
    window.clearTimeout(pending);
    pending = null;
  }
  if (useSessionStore.getState().autosave) saveSession();
}

export interface SessionSummary {
  savedAt: number | null;
  windowCount: number;
}

export function sessionSummary(): SessionSummary {
  return {
    savedAt: useSessionStore.getState().lastSavedAt,
    windowCount: useSessionStore.getState().windowCount,
  };
}

/* ---- settings ------------------------------------------------------------ */

interface SessionSettings {
  restoreOnStart: boolean;
  autosave: boolean;
  excludedApps: string[];
  lastSavedAt: number | null;
  lastRestoredAt: number | null;
  lastRestoreCount: number;
  windowCount: number;
  problems: SessionProblem[];

  setRestoreOnStart: (value: boolean) => void;
  setAutosave: (value: boolean) => void;
  setExcluded: (appId: string, excluded: boolean) => void;
  clearProblems: () => void;
}

export const useSessionStore = create<SessionSettings>()(
  persist(
    (set, get) => ({
      restoreOnStart: true,
      autosave: true,
      excludedApps: [],
      lastSavedAt: null,
      lastRestoredAt: null,
      lastRestoreCount: 0,
      windowCount: 0,
      problems: [],

      setRestoreOnStart: (restoreOnStart) => {
        set({ restoreOnStart });
        if (restoreOnStart) saveSession();
      },
      setAutosave: (autosave) => set({ autosave }),
      setExcluded: (appId, excluded) =>
        set({
          excludedApps: excluded
            ? [...new Set([...get().excludedApps, appId])]
            : get().excludedApps.filter((id) => id !== appId),
        }),
      clearProblems: () => set({ problems: [] }),
    }),
    {
      name: "session-settings",
      version: 1,
      partialize: (state) =>
        ({
          restoreOnStart: state.restoreOnStart,
          autosave: state.autosave,
          excludedApps: state.excludedApps,
        }) as SessionSettings,
    },
  ),
);
