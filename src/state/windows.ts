import { create } from "zustand";
import type {
  IconName,
  Rect,
  SnapZone,
  WindowInstance,
  WindowSnapshot,
  WindowState,
} from "@/types";
import { clamp, createId } from "@/utils/format";
import { fractionOf, rectFromFraction, separateRects, zoneRect } from "@/window-manager/geometry";
import { activeWorkspaceId, useWorkspaceStore } from "./workspaces";

export interface OpenWindowInput {
  appId: string;
  title: string;
  icon: IconName;
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  args?: Record<string, unknown>;
  /** Reuse an existing window for this app instead of opening a second one. */
  singleton?: boolean;
  /** Workspace to open on; the active workspace by default. */
  workspaceId?: string;
  /** Sticky windows stay visible on every workspace. */
  sticky?: boolean;
}

interface WindowStore {
  windows: WindowInstance[];
  /** Highest z value currently handed out. */
  topZ: number;
  focusedId: string | null;
  /** Bounds available to windows (viewport minus panel and dock). */
  workArea: Rect;
  /** Cascade counter so new windows do not stack exactly. */
  cascade: number;

  setWorkArea: (area: Rect) => void;
  open: (input: OpenWindowInput) => string;
  close: (id: string) => void;
  closeApp: (appId: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  toggleMinimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  /**
   * Full screen: the window takes the whole viewport, panel and dock included.
   * The bars themselves are not hidden by this — they simply stay on top, so the
   * desk keeps the chrome it always had while the application reaches every edge.
   */
  toggleFullScreen: (id: string) => void;
  setRect: (id: string, rect: Rect) => void;
  snap: (id: string, zone: SnapZone) => void;
  unmaximize: (id: string) => void;
  setTitle: (id: string, title: string) => void;
  /** Re-clamps every window into the current work area. */
  refit: () => void;
  minimizeAll: () => void;
  restoreAll: () => void;
  closeAll: () => void;
  /** Brings the next window in z-order to the front (Alt+Tab). */
  cycleFocus: (direction: 1 | -1) => string | null;

  /** Moves a window to another workspace, optionally following it there. */
  moveToWorkspace: (id: string, workspaceId: string, options?: { follow?: boolean }) => void;
  /** Pins a window to every workspace, or releases it back to its own. */
  setSticky: (id: string, sticky: boolean) => void;
  /** Assigns geometry to several windows in one update (snap layouts). */
  applyRects: (entries: { id: string; rect: Rect }[]) => void;
  /** Serializable description of every window, used by session restore. */
  snapshot: () => WindowSnapshot[];
  /** Rebuilds windows from a snapshot; returns how many were restored. */
  restoreWindows: (entries: WindowSnapshot[]) => number;
}

function rectEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/*
 * The windows a person can actually see at once, in front-to-back order.
 *
 * Desktop placement works on this list: a maximized window is the desk, and a
 * minimized one is not on it, so neither should push the others around.
 */
function deskWindows(windows: WindowInstance[], workspaceId?: string): WindowInstance[] {
  return windows
    .filter(
      (window) =>
        !window.minimized &&
        window.state !== "maximized" &&
        (workspaceId === undefined ||
          window.sticky === true ||
          !window.workspaceId ||
          window.workspaceId === workspaceId),
    )
    .sort((a, b) => b.z - a.z);
}

function clampToWorkArea(rect: Rect, workArea: Rect, minSize: { width: number; height: number }): Rect {
  const width = clamp(rect.width, Math.min(minSize.width, workArea.width), workArea.width);
  const height = clamp(rect.height, Math.min(minSize.height, workArea.height), workArea.height);
  // Keep the titlebar reachable: never allow the window to leave the work area.
  const maxX = workArea.x + workArea.width - Math.min(width, 120);
  const maxY = workArea.y + workArea.height - 44;
  return {
    x: clamp(rect.x, workArea.x, Math.max(workArea.x, maxX)),
    y: clamp(rect.y, workArea.y, Math.max(workArea.y, maxY)),
    width,
    height,
  };
}

/*
 * Snap geometry lives in window-manager/geometry (zoneRect): the drag preview
 * and the committed snap have to agree to the pixel, so there is one
 * implementation of it, not one per caller.
 *
 * A tiled window also remembers its tile as a fraction of the work area. That
 * is what makes the same window still half the screen after the browser is
 * resized, instead of keeping the pixel size of a desk that no longer exists.
 */
function tiledRect(window: WindowInstance, workArea: Rect): Rect {
  if (window.state === "maximized") return { ...workArea };
  if (window.snapBox) return rectFromFraction(window.snapBox, workArea);
  return clampToWorkArea(window.rect, workArea, { width: 280, height: 200 });
}

/** Geometry to return to after un-maximizing a window. */
function restingRect(window: WindowInstance, workArea: Rect): {
  state: WindowState;
  rect: Rect;
} {
  if (window.snapBox) {
    return { state: "snapped", rect: rectFromFraction(window.snapBox, workArea) };
  }
  return {
    state: "normal",
    rect: clampToWorkArea(window.restoreRect, workArea, { width: 320, height: 220 }),
  };
}

export const useWindowStore = create<WindowStore>()((set, get) => ({
  windows: [],
  topZ: 100,
  focusedId: null,
  workArea: { x: 0, y: 30, width: 1440, height: 840 },
  cascade: 0,

  setWorkArea: (workArea) => {
    const { workArea: previous, windows } = get();
    if (rectEqual(previous, workArea)) {
      return;
    }
    // Re-fit windows that are now off-screen or larger than the viewport, and
    // re-derive tiled ones so a snapped window is still half of the desk.
    // A window whose geometry did not actually move keeps its identity, so the
    // scale slider — which re-fits on every tick — does not force a re-render
    // of every window when the new work area asks nothing new of it.
    const fitted = windows.map((window) => tiledRect(window, workArea));
    // A narrower desk clamps windows towards the same corner; spreading the
    // ones that landed on top of each other is what stops a resize from
    // turning the desk into a pile. The window in front keeps its place.
    const desk = deskWindows(windows);
    const spread = separateRects(
      desk.map((window) => tiledRect(window, workArea)),
      workArea,
    );
    const placed = new Map(desk.map((window, position) => [window.id, spread[position]]));

    let changed = false;
    const next = windows.map((window, index) => {
      const rect = placed.get(window.id) ?? fitted[index];
      if (rectEqual(window.rect, rect)) return window;
      changed = true;
      return { ...window, rect };
    });
    set(changed ? { workArea, windows: next } : { workArea });
  },

  open: (input) => {
    const { windows, workArea } = get();

    if (input.singleton) {
      const existing = windows.find((window) => window.appId === input.appId);
      if (existing) {
        get().restore(existing.id);
        get().focus(existing.id);
        return existing.id;
      }
    }

    const id = createId("win");
    const maxWidth = Math.max(320, workArea.width - 24);
    const maxHeight = Math.max(240, workArea.height - 24);
    const width = Math.round(Math.min(input.defaultSize.width, maxWidth));
    const height = Math.round(Math.min(input.defaultSize.height, maxHeight));

    const cascadeStep = (get().cascade % 7) * 26;
    const x = Math.round(workArea.x + (workArea.width - width) / 2 + cascadeStep - 78);
    const y = Math.round(workArea.y + (workArea.height - height) / 2 + cascadeStep - 78);

    const workspaceId = input.workspaceId ?? activeWorkspaceId();
    // The centre of a desk that is barely wider than the window is the same for
    // every window, so the desk — not the arithmetic — decides whether this one
    // can have the spot.
    const placed = separateRects(
      [
        ...deskWindows(windows, workspaceId).map((window) => window.rect),
        clampToWorkArea({ x, y, width, height }, workArea, input.minSize),
      ],
      workArea,
    );
    const rect = placed[placed.length - 1];
    const z = get().topZ + 1;

    const instance: WindowInstance = {
      id,
      appId: input.appId,
      title: input.title,
      icon: input.icon,
      z,
      state: "normal",
      rect,
      restoreRect: rect,
      minimized: false,
      focused: true,
      args: input.args,
      workspaceId,
      sticky: input.sticky,
    };

    set({
      windows: [...windows.map((window) => ({ ...window, focused: false })), instance],
      topZ: z,
      focusedId: id,
      cascade: get().cascade + 1,
    });
    return id;
  },

  close: (id) => {
    const remaining = get().windows.filter((window) => window.id !== id);
    const wasFocused = get().focusedId === id;
    let focusedId = get().focusedId;
    if (wasFocused) {
      const activeId = activeWorkspaceId();
      const visible = (window: WindowInstance) =>
        window.sticky === true || !window.workspaceId || window.workspaceId === activeId;
      const next = remaining
        .filter((window) => !window.minimized && visible(window))
        .sort((a, b) => b.z - a.z)[0];
      focusedId = next?.id ?? null;
      if (next) {
        const z = get().topZ + 1;
        set({
          topZ: z,
          /* Focus moves with the window: leaving `focusedId` pointing at the
             window that was just closed makes the desk disagree with itself —
             the panel keeps showing the closed app as the active one, and the
             next click that asks "is this already focused?" gets an answer
             about a window that no longer exists. */
          focusedId: next.id,
          windows: remaining
            .map((window) =>
              window.id === next.id
                ? { ...window, z, focused: true }
                : { ...window, focused: false },
            )
            .sort((a, b) => a.z - b.z),
        });
        return;
      }
    }
    set({ windows: remaining, focusedId });
  },

  closeApp: (appId) => {
    for (const window of get().windows.filter((w) => w.appId === appId)) {
      get().close(window.id);
    }
  },

  focus: (id) => {
    const target = get().windows.find((window) => window.id === id);
    if (!target) return;
    // Focusing a window that lives elsewhere brings its workspace forward,
    // rather than putting focus on something the user cannot see.
    if (target.workspaceId && !target.sticky) {
      const spaces = useWorkspaceStore.getState();
      if (spaces.activeId !== target.workspaceId) spaces.activate(target.workspaceId);
    }
    if (get().focusedId === id && !target.minimized) return;
    const z = get().topZ + 1;
    set({
      topZ: z,
      focusedId: id,
      windows: get()
        .windows.map((window) =>
          window.id === id
            ? { ...window, z, focused: true, minimized: false }
            : { ...window, focused: false },
        )
        .sort((a, b) => a.z - b.z),
    });
  },

  minimize: (id) => {
    const windows = get().windows.map((window) =>
      window.id === id ? { ...window, minimized: true, focused: false } : window,
    );
    // Focus is handed to the next window the user can actually see. Windows on
    // other workspaces are already off the desk, so they are not candidates.
    const activeId = activeWorkspaceId();
    const next = windows
      .filter(
        (window) =>
          !window.minimized &&
          (window.sticky === true || !window.workspaceId || window.workspaceId === activeId),
      )
      .sort((a, b) => b.z - a.z)[0];
    set({
      windows: windows.map((window) => ({ ...window, focused: next?.id === window.id })),
      focusedId: next?.id ?? null,
    });
  },

  restore: (id) => {
    set({
      windows: get().windows.map((window) =>
        window.id === id ? { ...window, minimized: false } : window,
      ),
    });
  },

  toggleMinimize: (id) => {
    const target = get().windows.find((window) => window.id === id);
    if (!target) return;
    if (target.minimized) {
      get().focus(id);
    } else if (get().focusedId === id) {
      get().minimize(id);
    } else {
      get().focus(id);
    }
  },

  toggleMaximize: (id) => {
    const { workArea, windows } = get();
    const target = windows.find((window) => window.id === id);
    if (!target) return;
    const z = get().topZ + 1;

    if (target.state === "maximized") {
      set({
        topZ: z,
        windows: windows.map((window) =>
          window.id === id
            ? { ...window, ...restingRect(window, workArea), z, focused: true, minimized: false }
            : { ...window, focused: false },
        ),
      });
      return;
    }

    set({
      topZ: z,
      windows: windows.map((window) =>
        window.id === id
          ? {
              ...window,
              state: "maximized" as WindowState,
              // A tiled window keeps its tile, so restoring returns it there.
              restoreRect: window.rect,
              rect: { ...workArea },
              z,
              focused: true,
              minimized: false,
            }
          : { ...window, focused: false },
      ),
    });
  },

  toggleFullScreen: (id) => {
    const { windows } = get();
    const target = windows.find((window) => window.id === id);
    if (!target) return;
    const z = get().topZ + 1;
    const entering = target.full !== true;

    set({
      topZ: z,
      windows: windows.map((window) =>
        window.id === id
          ? {
              ...window,
              // Entering sets the flag; leaving clears it outright, so a window
              // carries `full` only while it is actually on the screen.
              full: entering ? true : undefined,
              z,
              // Full screen is a presentation of the window in front: it takes
              // focus the way maximising does, and never leaves a window
              // minimised underneath it.
              focused: true,
              minimized: false,
            }
          : // Only one window can own the screen at a time.
            { ...window, full: undefined, focused: false },
      ),
    });
  },

  unmaximize: (id) => {
    const target = get().windows.find((window) => window.id === id);
    if (!target || target.state === "normal") return;
    const workArea = get().workArea;
    set({
      windows: get().windows.map((window) =>
        window.id === id ? { ...window, ...restingRect(window, workArea) } : window,
      ),
    });
  },

  setRect: (id, rect) => {
    set({
      windows: get().windows.map((window) =>
        window.id === id
          ? {
              ...window,
              rect,
              // Moving or resizing a window takes it out of its tile — both the
              // maximized state and the tile fraction stop describing it.
              state: "normal" as WindowState,
              snapBox: undefined,
            }
          : window,
      ),
    });
  },

  snap: (id, zone) => {
    const { workArea, windows } = get();
    const target = windows.find((window) => window.id === id);
    if (!target) return;
    const rect = zoneRect(zone, workArea);
    const z = get().topZ + 1;
    set({
      topZ: z,
      windows: windows.map((window) =>
        window.id === id
          ? {
              ...window,
              state: "snapped" as WindowState,
              restoreRect:
                window.state === "normal" || window.state === "snapped"
                  ? window.rect
                  : window.restoreRect,
              rect,
              snapBox: fractionOf(rect, workArea),
              z,
              focused: true,
              minimized: false,
            }
          : { ...window, focused: false },
      ),
    });
  },

  setTitle: (id, title) => {
    set({
      windows: get().windows.map((window) =>
        window.id === id && window.title !== title ? { ...window, title } : window,
      ),
    });
  },

  refit: () => {
    const { windows, workArea } = get();
    set({
      windows: windows.map((window) => ({ ...window, rect: tiledRect(window, workArea) })),
    });
  },

  // "Show desktop" and "restore everything" act on the workspace in front of
  // the user: windows on other workspaces are already out of sight.
  minimizeAll: () => {
    const activeId = activeWorkspaceId();
    const windows = get().windows.map((window) =>
      window.sticky === true || !window.workspaceId || window.workspaceId === activeId
        ? { ...window, minimized: true, focused: false }
        : window,
    );
    const focusedId = windows.some((window) => window.focused) ? null : get().focusedId;
    set({ windows, focusedId });
  },

  restoreAll: () => {
    const activeId = activeWorkspaceId();
    const windows = get().windows.map((window) =>
      window.sticky === true || !window.workspaceId || window.workspaceId === activeId
        ? { ...window, minimized: false }
        : window,
    );
    set({ windows });
    const top = windows
      .filter((window) => !window.minimized)
      .sort((a, b) => b.z - a.z)[0];
    if (top) get().focus(top.id);
  },

  closeAll: () => set({ windows: [], focusedId: null }),

  cycleFocus: (direction) => {
    const activeId = activeWorkspaceId();
    const candidates = get()
      .windows.filter(
        (window) =>
          !window.minimized &&
          (window.sticky === true || !window.workspaceId || window.workspaceId === activeId),
      )
      .sort((a, b) => b.z - a.z);
    if (candidates.length < 2) {
      if (candidates.length === 1) get().focus(candidates[0].id);
      return candidates[0]?.id ?? null;
    }
    const index = candidates.findIndex((window) => window.id === get().focusedId);
    const nextIndex =
      index === -1
        ? 0
        : (index + direction + candidates.length) % candidates.length;
    const next = candidates[nextIndex];
    get().focus(next.id);
    return next.id;
  },

  moveToWorkspace: (id, workspaceId, options = {}) => {
    const target = get().windows.find((window) => window.id === id);
    if (!target || target.workspaceId === workspaceId) return;
    set({
      windows: get().windows.map((window) =>
        window.id === id ? { ...window, workspaceId, focused: false } : window,
      ),
      focusedId: get().focusedId === id ? null : get().focusedId,
    });
    if (options.follow) {
      useWorkspaceStore.getState().activate(workspaceId);
      get().focus(id);
    }
  },

  setSticky: (id, sticky) =>
    set({
      windows: get().windows.map((window) =>
        window.id === id ? { ...window, sticky } : window,
      ),
    }),

  applyRects: (entries) => {
    if (entries.length === 0) return;
    const rects = new Map(entries.map((entry) => [entry.id, entry.rect]));
    const { workArea } = get();
    set({
      windows: get().windows.map((window) => {
        const rect = rects.get(window.id);
        if (!rect) return window;
        return {
          ...window,
          rect,
          state: "snapped" as WindowState,
          // Snapping keeps one way back to the geometry the window had before
          // it joined a layout.
          restoreRect:
            window.state === "normal" || window.state === "snapped"
              ? window.rect
              : window.restoreRect,
          snapBox: fractionOf(rect, workArea),
          minimized: false,
        };
      }),
    });
  },

  snapshot: () =>
    get().windows.map((window) => ({
      appId: window.appId,
      title: window.title,
      icon: window.icon,
      rect: { ...window.rect },
      restoreRect: { ...window.restoreRect },
      snapBox: window.snapBox,
      state: window.state,
      minimized: window.minimized,
      workspaceId: window.workspaceId,
      sticky: window.sticky,
      args: window.args,
    })),

  restoreWindows: (entries) => {
    if (entries.length === 0) return 0;
    const state = get();
    const known = useWorkspaceStore.getState().workspaces;
    const fallbackWorkspace = useWorkspaceStore.getState().activeId;
    let topZ = state.topZ;

    /*
     * Geometry first. A snapshot is taken from a desk that was clamped to the
     * size of the viewport at the time, so it can hold several windows sitting
     * on the same coordinates — restore that verbatim and the pile comes back
     * with the session. The window that was in front (last in the snapshot,
     * which is stacked back-to-front) keeps the place it had.
     */
    const drafts = entries.map((entry) => {
      // A snapshot can outlive the workspace it was taken on.
      const workspaceId =
        entry.sticky || known.some((workspace) => workspace.id === entry.workspaceId)
          ? entry.workspaceId
          : fallbackWorkspace;
      const snapBox = entry.snapBox;
      const rect =
        entry.state === "maximized"
          ? { ...state.workArea }
          : snapBox
            ? rectFromFraction(snapBox, state.workArea)
            : clampToWorkArea(entry.rect, state.workArea, { width: 280, height: 200 });
      return {
        entry,
        workspaceId,
        snapBox,
        rect,
        restoreRect: clampToWorkArea(entry.restoreRect, state.workArea, {
          width: 280,
          height: 200,
        }),
      };
    });

    const onDesk = drafts.filter(
      (draft) => !draft.entry.minimized && draft.entry.state !== "maximized",
    );
    const priority = [...onDesk].reverse();
    const spread = separateRects(priority.map((draft) => draft.rect), state.workArea);
    priority.forEach((draft, position) => {
      draft.rect = spread[position];
    });

    const restored: WindowInstance[] = [];
    for (const draft of drafts) {
      topZ += 1;
      restored.push({
        id: createId("win"),
        appId: draft.entry.appId,
        title: draft.entry.title,
        icon: draft.entry.icon,
        z: topZ,
        state: draft.entry.state,
        snapBox: draft.snapBox,
        rect: draft.rect,
        restoreRect: draft.restoreRect,
        minimized: draft.entry.minimized,
        focused: false,
        args: draft.entry.args,
        workspaceId: draft.workspaceId,
        sticky: draft.entry.sticky,
      });
    }

    const focused = restored.filter((window) => !window.minimized).sort((a, b) => b.z - a.z)[0];
    if (focused) focused.focused = true;
    set({
      windows: [...state.windows, ...restored],
      topZ,
      focusedId: focused?.id ?? state.focusedId,
    });
    return restored.length;
  },
}));
