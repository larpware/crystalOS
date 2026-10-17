import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";

export interface DockConfig {
  /** Artwork size of each taskbar tile. */
  iconSize: number;
  gap: number;
  padding: number;
  /** Fractional opacity of the taskbar surface. */
  opacity: number;
  /** "dock" is the floating pill; "taskbar" is a full-width strip. */
  mode: "dock" | "taskbar";
  /** Extra strip height in pixels, added on top of the icons. */
  height: number;
  /** Where the All Apps button sits along the strip. */
  allAppsPosition: "left" | "center" | "right";
  /** Horizontal anchor of the floating dock: left, center, or right. */
  align: "left" | "center" | "right";
  /** Corner radius of the floating dock strip, in pixels. */
  borderRadius: number;
  /** When on, the taskbar names each icon tile and the All Apps box. */
  showAppNames: boolean;
  /** Horizontal spacing between dock icon tiles. */
  dockGap: number;
  /** Horizontal spacing between taskbar icon tiles. */
  taskbarGap: number;
}

export interface PanelConfig {
  showActivities: boolean;
  showClock: boolean;
  clock12h: boolean;
  clockSeconds: boolean;
  showDate: boolean;
  showNetwork: boolean;
  showVolume: boolean;
  showBattery: boolean;
  showStatusTray: boolean;
  panelScale: number;
  /** Fractional opacity of the top bar surface. */
  opacity: number;
  /** "dock" floats the bar free of the screen edges; "full" spans them. */
  style: "dock" | "full";
  /** Corner radius of the bar, in pixels. Dock style only. */
  radius: number;
  /** Which panel group the clock is drawn in. */
  clockPosition: "left" | "center" | "right";
}

export interface LauncherConfig {
  layout: "grid" | "list";
  showCategories: boolean;
  showRecents: boolean;
}

export interface DesktopConfig {
  showIcons: boolean;
  iconSize: number;
  alignToGrid: boolean;
  /** Traffic-light controls on the left (macOS-like) or right (GNOME-like). */
  windowControls: "left" | "right";
}

export type LockPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface LockConfig {
  showDate: boolean;
  showTime: boolean;
  clockStyle: "large" | "compact";
  showSeconds: boolean;
  showAvatar: boolean;
  showUsername: boolean;
  showPowerButtons: boolean;
  blurWallpaper: boolean;
  /** Where the clock and date block sits on the lock screen. */
  clockPosition: LockPosition;
  /** Size multiplier for the lock clock text. */
  clockScale: number;
  /** Font key (see themes/fonts) used for the lock clock. */
  fontId: string;
  /** Extra darkening of the lock background, 0–0.7. */
  dim: number;
  /** Treatment of the lock background behind the clock. */
  backgroundStyle: "wallpaper" | "blur" | "dark" | "solid";
  /** Optional line under the clock, e.g. a reminder. */
  message: string;
}

export type PowerState = "on" | "locked" | "sleep" | "off";

export interface ContextMenuRequest {
  x: number;
  y: number;
  /** "app" is an application icon in the launcher, "dock" one in the taskbar. */
  target: "desktop" | "dock" | "app" | "widget" | "file" | "window";
  payload?: Record<string, unknown>;
}

interface ShellState {
  dock: DockConfig;
  panel: PanelConfig;
  launcher: LauncherConfig;
  desktop: DesktopConfig;
  lock: LockConfig;

  /* runtime overlay state — not persisted */
  launcherOpen: boolean;
  quickSettingsOpen: boolean;
  /** CrystalOS Quick Search (command palette). */
  commandPaletteOpen: boolean;
  /** The window/workspace overview. */
  workspaceOverviewOpen: boolean;
  contextMenu: ContextMenuRequest | null;
  powerState: PowerState;
  notificationCenterOpen: boolean;
  /** A desktop icon the shell has asked to rename (F2, context menu). */
  renameRequest: string | null;

  /** Desktop area excluded by the taskbar, recomputed by the shell layout. */
  safeArea: { top: number; bottom: number; left: number; right: number };
  /** Measured size of the rendered taskbar surface, used for the safe area. */
  dockSize: { width: number; height: number };

  setDock: (patch: Partial<DockConfig>) => void;
  setPanel: (patch: Partial<PanelConfig>) => void;
  setLauncher: (patch: Partial<LauncherConfig>) => void;
  setDesktop: (patch: Partial<DesktopConfig>) => void;
  setLock: (patch: Partial<LockConfig>) => void;

  setLauncherOpen: (open: boolean) => void;
  setQuickSettingsOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setWorkspaceOverviewOpen: (open: boolean) => void;
  setNotificationCenterOpen: (open: boolean) => void;
  openContextMenu: (request: ContextMenuRequest) => void;
  closeContextMenu: () => void;
  setPowerState: (state: PowerState) => void;
  setSafeArea: (area: ShellState["safeArea"]) => void;
  setDockSize: (size: ShellState["dockSize"]) => void;
  requestRename: (nodeId: string) => void;
  clearRenameRequest: () => void;
}

/* Chrome defaults: a thin glass strip along the bottom edge and a matching
   translucent top bar, both at 50% surface opacity — the point where the
   wallpaper still reads through the material without costing legibility. The
   sliders in Settings → Shell move either one. */
/** Height of the top bar before `panelScale`; published as --panel-height. */
export const PANEL_BASE_HEIGHT = 38;
/** How far the dock-style top bar floats from the top and side edges. */
export const PANEL_DOCK_GAP = 10;

/**
 * The strip the top bar reserves at the top of the screen, in viewport pixels:
 * the bar's own height, plus the gap it floats above and below in the dock
 * layout.
 *
 * Derived from the panel settings rather than read back from the shell's
 * layout pass, so an icon, a widget or a window can never be placed under the
 * bar because that pass is one commit behind the panel it describes.
 */
export function panelReservedTop(
  panelScale: number,
  style: PanelConfig["style"],
): number {
  const gap = style === "dock" ? PANEL_DOCK_GAP : 0;
  return gap + Math.round(PANEL_BASE_HEIGHT * panelScale) + gap;
}
export const defaultDock: DockConfig = {
  /* 40px tiles. The strip's height is derived from this value (the tile plus a
     12px band for the running dot in shell.css), so the bar always hugs its
     artwork; only the gaps and padding tighten in a smaller window. */
  iconSize: 40,
  gap: 6,
  padding: 10,
  opacity: 0.5,
  mode: "dock",
  height: 0,
  allAppsPosition: "left",
  align: "center",
  borderRadius: 14,
  showAppNames: false,
  dockGap: 10,
  taskbarGap: 10,
};

export const defaultPanel: PanelConfig = {
  showActivities: true,
  showClock: true,
  clock12h: true,
  clockSeconds: false,
  showDate: true,
  showNetwork: true,
  showVolume: true,
  showBattery: true,
  showStatusTray: true,
  panelScale: 1,
  opacity: 0.5,
  style: "dock",
  radius: 14,
  clockPosition: "center",
};

export const defaultLock: LockConfig = {
  showDate: true,
  showTime: true,
  clockStyle: "large",
  showSeconds: false,
  showAvatar: true,
  showUsername: true,
  showPowerButtons: true,
  blurWallpaper: true,
  clockPosition: "center",
  clockScale: 1,
  fontId: "display",
  dim: 0,
  backgroundStyle: "wallpaper",
  message: "",
};

export const useShellStore = create<ShellState>()(
  persist(
    (set, get) => ({
      dock: defaultDock,
      panel: defaultPanel,
      launcher: { layout: "grid", showCategories: true, showRecents: true },
      desktop: { showIcons: true, iconSize: 56, alignToGrid: true, windowControls: "left" },
      lock: defaultLock,

      launcherOpen: false,
      quickSettingsOpen: false,
      commandPaletteOpen: false,
      workspaceOverviewOpen: false,
      contextMenu: null,
      powerState: "on",
      notificationCenterOpen: false,
      renameRequest: null,
      safeArea: { top: 30, bottom: 66, left: 0, right: 0 },
      dockSize: { width: 0, height: 0 },

      setDock: (patch) => set({ dock: { ...get().dock, ...patch } }),
      setPanel: (patch) => set({ panel: { ...get().panel, ...patch } }),
      setLauncher: (patch) => set({ launcher: { ...get().launcher, ...patch } }),
      setDesktop: (patch) => set({ desktop: { ...get().desktop, ...patch } }),
      setLock: (patch) => set({ lock: { ...get().lock, ...patch } }),

      setLauncherOpen: (launcherOpen) => set({ launcherOpen }),
      setQuickSettingsOpen: (quickSettingsOpen) => set({ quickSettingsOpen }),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      setWorkspaceOverviewOpen: (workspaceOverviewOpen) => set({ workspaceOverviewOpen }),
      setNotificationCenterOpen: (notificationCenterOpen) => set({ notificationCenterOpen }),
      openContextMenu: (contextMenu) =>
        set({ contextMenu, launcherOpen: false, quickSettingsOpen: false }),
      closeContextMenu: () => set({ contextMenu: null }),
      setPowerState: (powerState) => set({ powerState }),
      setDockSize: (dockSize) => {
        const current = get().dockSize;
        if (current.width === dockSize.width && current.height === dockSize.height) return;
        set({ dockSize });
      },
      requestRename: (renameRequest) => set({ renameRequest }),
      clearRenameRequest: () => set({ renameRequest: null }),

      setSafeArea: (safeArea) => {
        const current = get().safeArea;
        if (
          current.top === safeArea.top &&
          current.bottom === safeArea.bottom &&
          current.left === safeArea.left &&
          current.right === safeArea.right
        ) {
          return;
        }
        set({ safeArea });
      },
    }),
    {
      name: "shell",
      version: 13,
      storage: jsonStorageFor<ShellState>(),
      /**
       * v3 replaces the configurable floating dock with the fixed bottom
       * taskbar: the persisted dock config is rebuilt from the new shape,
       * carrying over only the values the taskbar still honours.
       *
       * v4 moves both chrome surfaces to 50% opacity by default and adds the
       * top-bar opacity setting. A profile saved before it therefore adopts
       * the new surface defaults rather than keeping the old 74% strip —
       * everything else in the config is preserved.
       */
      migrate: (persisted, version) => {
        const state = persisted as Partial<ShellState> | undefined;
        if (version < 3 && state?.dock) {
          const legacy = state.dock as Partial<DockConfig> & Record<string, unknown>;
          state.dock = {
            ...defaultDock,
            iconSize:
              typeof legacy.iconSize === "number" && legacy.iconSize >= 16 && legacy.iconSize <= 40
                ? legacy.iconSize
                : defaultDock.iconSize,
            opacity:
              typeof legacy.opacity === "number" && legacy.opacity >= 0.3 && legacy.opacity <= 1
                ? legacy.opacity
                : defaultDock.opacity,
          };
        }
        if (version < 4 && state) {
          state.panel = { ...defaultPanel, ...state.panel };
          state.dock = { ...defaultDock, ...state.dock, opacity: defaultDock.opacity };
        }
        // v5 turns the top bar into a floating dock by default: the panel config
        // gains its style and corner radius, so an older profile picks up both.
        if (version < 5 && state) {
          state.panel = { ...defaultPanel, ...state.panel };
        }
        // v6 adds the dock/taskbar shape (mode, extra height, All-App's
        // position), the movable panel clock and the extended lock-screen
        // styling. Merging the defaults keeps every earlier choice.
        if (version < 6 && state) {
          state.dock = { ...defaultDock, ...state.dock };
          state.panel = { ...defaultPanel, ...state.panel };
          state.lock = { ...defaultLock, ...state.lock };
        }
        // v7 adds dock alignment and border radius settings.
        // Also ensures the default shape is the floating dock (not taskbar).
        if (version < 7 && state) {
          state.dock = { ...defaultDock, ...state.dock, mode: "dock" };
        }
        // v8 forces dock mode as default (hides labels, compact pill).
        if (version < 8 && state) {
          state.dock = { ...defaultDock, ...state.dock, mode: "dock" };
        }
        // v9 adds the per-tile taskbar label toggle and preserves unknown values.
        if (version < 9 && state && typeof state.dock?.showAppNames !== "boolean") {
          state.dock = { ...defaultDock, ...state.dock, showAppNames: defaultDock.showAppNames };
        }
        /* v10 tightens the dock: smaller tiles, a slimmer strip, and the gap,
           padding and corner radius brought down with it. A profile that never
           moved those sliders is still holding the old geometry, so the old
           defaults are lifted to the new ones; anything the user actually chose
           is left exactly as it was. */
        if (version < 10 && state) {
          state.dock = { ...defaultDock, ...state.dock };
          if (state.dock.iconSize === 22) state.dock.iconSize = defaultDock.iconSize;
          if (state.dock.padding === 12) state.dock.padding = defaultDock.padding;
          if (state.dock.borderRadius === 16) state.dock.borderRadius = defaultDock.borderRadius;
          if (state.dock.dockGap === 6) state.dock.dockGap = defaultDock.dockGap;
        }
        // v11 shaves the dock down one more step.
        if (version < 11 && state) {
          state.dock = { ...defaultDock, ...state.dock };
          if (state.dock.iconSize === 18) state.dock.iconSize = defaultDock.iconSize;
        }
        /* v12 raised the artwork to 40px tiles. v13 returns the strip to its
           slim glass bar — the height, padding and corner radius it had before
           the pill experiment — while keeping those larger tiles, so the bar is
           rebuilt around them. Values still at the pill defaults are lifted
           back; anything the user actually chose is left alone. */
        if (version < 12 && state) {
          state.dock = { ...defaultDock, ...state.dock };
          if (state.dock.iconSize === 16) state.dock.iconSize = defaultDock.iconSize;
          if (state.dock.dockGap === 5) state.dock.dockGap = defaultDock.dockGap;
        }
        if (version < 13 && state) {
          state.dock = { ...defaultDock, ...state.dock };
          if (state.dock.padding === 14) state.dock.padding = defaultDock.padding;
          if (state.dock.borderRadius === 22) state.dock.borderRadius = defaultDock.borderRadius;
        }
        return state as ShellState;
      },
      partialize: (state) =>
        ({
          dock: state.dock,
          panel: state.panel,
          launcher: state.launcher,
          desktop: state.desktop,
          lock: state.lock,
        }) as ShellState,
    },
  ),
);
