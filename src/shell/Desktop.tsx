import {
  useCallback,
  useLayoutEffect,
  useMemo,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Menu, type MenuItem } from "@/components/ui";
import { WallpaperLayer } from "@/wallpapers/Wallpaper";
import { WindowManager } from "@/window-manager/WindowManager";
import { Taskbar } from "./Taskbar";
import { TopPanel } from "./TopPanel";
import { Launcher } from "./Launcher";
import { CommandPalette } from "./CommandPalette";
import { WorkspaceOverview } from "./WorkspaceOverview";
import { QuickSettings } from "./QuickSettings";
import { NotificationCenter, ToastStack } from "./Notifications";
import { WidgetLayer } from "./WidgetLayer";
import { DesktopIcons } from "./DesktopIcons";
import { HzReadout } from "./HzReadout";
import { Standby } from "./Standby";
import { OFFLINE_BANNER_HEIGHT, OfflineBanner } from "./OfflineBanner";
import { panelReservedTop, useShellStore } from "@/state/shell";
import { useSystemStore } from "@/state/system";
import { usePlaybackStore } from "@/state/playback";
import { useWindowStore } from "@/state/windows";
import { desktopFolderId, useFsStore } from "@/state/fs";
import { builtInWallpapers, gradientWallpapers } from "@/wallpapers/library";
import { useAppearanceStore } from "@/state/appearance";
import { useElementTheme } from "@/themes/scope";
import { listCustomWallpapers } from "@/wallpapers/custom";
import { desktopSlot } from "./desktopGrid";
import {
  APP_DRAG_TYPE,
  activateApp,
  addDesktopShortcut,
  hasDesktopShortcut,
  openApp,
  openNode,
} from "@/services/os";
import { metaFor } from "@/apps/catalog";
import { useFullScreenChrome, useViewport } from "@/hooks/useUi";
import { useOffline } from "@/hooks/useOffline";

/* ==========================================================================
   Desktop shell

   Owns the layout contract: the panel reserves the top edge, the dock reserves
   the edge it is docked to, and windows are confined to what remains. Every
   overlay sits in its own layer above the window layer.
   ========================================================================== */

export function Desktop() {
  const dock = useShellStore((state) => state.dock);
  const contextMenu = useShellStore((state) => state.contextMenu);
  const closeContextMenu = useShellStore((state) => state.closeContextMenu);
  const overlayTheme = useElementTheme("overlays");
  const setSafeArea = useShellStore((state) => state.setSafeArea);
  const desktop = useShellStore((state) => state.desktop);
  const dockSize = useShellStore((state) => state.dockSize);
  const panelScale = useShellStore((state) => state.panel.panelScale);
  const panelStyle = useShellStore((state) => state.panel.style);
  const hzDisplay = useSystemStore((state) => state.hzDisplay);
  const dim = usePlaybackStore((state) => state.dim);
  const viewport = useViewport();
  const setWorkArea = useWindowStore((state) => state.setWorkArea);
  const offline = useOffline();
  /* The panel and the dock belong to the same chrome layer this component
     lays out, so the mode that takes them off the screen in full screen is
     driven from here: see useFullScreenChrome. */
  useFullScreenChrome();

  /* ---- layout contract -------------------------------------------------
     Laid out before paint: the reserved strip has to be in the store in the
     same commit that draws the panel, or a window opened or maximized in
     between lands under the bar. */
  useLayoutEffect(() => {
    // The top edge is reserved by the panel itself: its own height, plus the
    // gap it floats above and below when it is a dock.
    const panelTop = panelReservedTop(panelScale, panelStyle);
    // While the offline notice is up it is chrome too, so it reserves as well.
    // Reserving rather than floating is what keeps it from covering a window
    // that is already maximized; the store re-fits tiled windows on change.
    const top = panelTop + (offline.offline ? OFFLINE_BANNER_HEIGHT : 0);
    // The taskbar is a bottom strip and reports the box it occupies, so the
    // work area is inset by exactly the height it covers on that edge.
    const thickness = dockSize.height > 0 ? dockSize.height : dock.iconSize + 12;

    const safeArea = {
      top,
      bottom: Math.round(thickness),
      left: 0,
      right: 0,
    };
    setSafeArea(safeArea);

    setWorkArea({
      x: safeArea.left,
      y: safeArea.top,
      width: Math.max(320, viewport.width - safeArea.left - safeArea.right),
      height: Math.max(240, viewport.height - safeArea.top - safeArea.bottom),
    });
  }, [
    dock.iconSize,
    dockSize.height,
    offline.offline,
    panelScale,
    panelStyle,
    setSafeArea,
    setWorkArea,
    viewport.height,
    viewport.width,
  ]);


  /* ---- desktop context menu ------------------------------------------- */
  const contextItems: MenuItem[] = useMemo(() => {
    if (!contextMenu) return [];
    const nodes = useFsStore.getState().nodes;
    const desktopId = desktopFolderId(nodes);


    /* An application icon, right-clicked in the dock or in the launcher. */
    if (contextMenu.target === "dock" || contextMenu.target === "app") {
      const appId = contextMenu.payload?.appId as string | undefined;
      const meta = appId ? metaFor(appId) : undefined;
      if (!appId || !meta) return [];
      const onDesktop = hasDesktopShortcut(appId);
      return [
        {
          id: "open",
          label: `Open ${meta.name}`,
          icon: "external",
          run: () => activateApp(appId),
        },
        {
          id: "add-to-desktop",
          label: onDesktop ? "Already on the desktop" : "Add to desktop",
          icon: "plus",
          disabled: onDesktop,
          separatorBefore: true,
          run: () => addDesktopShortcut(appId),
        },
      ];
    }

    if (contextMenu.target === "file") {
      const nodeId = contextMenu.payload?.nodeId as string | undefined;
      const node = nodes.find((entry) => entry.id === nodeId);
      return [
        {
          id: "open",
          label: node?.kind === "folder" ? "List in Terminal" : "Open",
          icon: node?.kind === "folder" ? "terminal" : "external",
          run: () => {
            if (nodeId) openNode(nodeId);
          },
        },
        {
          id: "rename",
          label: "Rename",
          icon: "pencil",
          run: () => {
            if (nodeId) useShellStore.getState().requestRename(nodeId);
          },
        },
        {
          id: "trash",
          label: "Move to Trash",
          icon: "trash",
          danger: true,
          separatorBefore: true,
          run: () => nodeId && useFsStore.getState().trashMany([nodeId]),
        },
      ];
    }

    return [
      {
        id: "new-folder",
        label: "New folder",
        icon: "folder-plus",
        run: () => {
          const id = useFsStore.getState().createFolder(desktopId, "New folder");
          useFsStore.getState().setSelection([id]);
        },
      },
      {
        id: "new-file",
        label: "New text file",
        icon: "file-text",
        run: () => {
          const id = useFsStore.getState().createFile(desktopId, "Untitled.txt", "");
          useFsStore.getState().setSelection([id]);
        },
      },
      {
        id: "terminal",
        label: "Open Terminal",
        icon: "terminal",
        run: () => openApp("terminal"),
      },
      {
        id: "wallpaper",
        label: "Change wallpaper",
        icon: "wallpaper",
        separatorBefore: true,
        run: () => openApp("wallpaper"),
      },
      {
        id: "next-wallpaper",
        label: "Next wallpaper",
        icon: "refresh",
        run: () => applyNextWallpaper(),
      },
      {
        id: "add-widget",
        label: "Add a widget",
        icon: "plus",
        run: () => openApp("settings", { args: { section: "widgets" } }),
      },
      {
        id: "display",
        label: "Display settings",
        icon: "monitor",
        separatorBefore: true,
        run: () => openApp("settings", { args: { section: "appearance" } }),
      },
      {
        id: "personalize",
        label: "Personalize",
        icon: "palette",
        run: () => openApp("settings", { args: { section: "appearance" } }),
      },
      {
        id: "toggle-icons",
        label: desktop.showIcons ? "Hide desktop icons" : "Show desktop icons",
        icon: desktop.showIcons ? "eye-off" : "eye",
        run: () => useShellStore.getState().setDesktop({ showIcons: !desktop.showIcons }),
      },
      {
        id: "refresh",
        label: "Refresh desktop",
        icon: "refresh",
        separatorBefore: true,
        run: () => {
          // Clears the selection and pulls any off-screen window back into view.
          useFsStore.getState().setSelection([]);
          useWindowStore.getState().refit();
        },
      },
    ];
  }, [contextMenu, desktop.showIcons]);

  /* ---- dropping an application onto the desktop -------------------------
     Dragging an icon out of the dock or the launcher and releasing it on the
     desktop places a shortcut on the nearest grid slot. */
  const onDesktopDragOver = useCallback((event: ReactDragEvent) => {
    // Only our own application payload is a target; a file dragged in from the
    // host or a link keeps whatever the browser would do with it.
    if (!event.dataTransfer.types.includes(APP_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDesktopDrop = useCallback((event: ReactDragEvent) => {
    const appId = event.dataTransfer.getData(APP_DRAG_TYPE);
    if (!appId) return;
    event.preventDefault();
    // The chrome bars are not desktop space.
    if ((event.target as HTMLElement).closest(".cr-panel, .cr-taskbar")) return;

    const shell = useShellStore.getState();
    const iconSize = shell.desktop.iconSize;
    const slot = desktopSlot(
      event.clientX - iconSize / 2,
      event.clientY - iconSize / 2,
      iconSize,
      shell.safeArea.top,
    );
    addDesktopShortcut(appId, slot);
    // A drop out of the launcher also ends that visit.
    shell.setLauncherOpen(false);
  }, []);

  const onDesktopContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.target as HTMLElement;
      // Windows and widgets own their own context menus.
      if (target.closest(".cr-window") || target.closest(".cr-widget") || target.closest(".cr-panel")) {
        return;
      }
      event.preventDefault();
      useShellStore.getState().openContextMenu({
        x: event.clientX,
        y: event.clientY,
        target: "desktop",
      });
    },
    [],
  );

  return (
    <div
      className="cr-desktop"
      onContextMenu={onDesktopContextMenu}
      onDragOver={onDesktopDragOver}
      onDrop={onDesktopDrop}
    >
      <div className="cr-desktop__wallpaper">
        <WallpaperLayer target="desktop" />
      </div>

      <WidgetLayer />
      <DesktopIcons />
      <WindowManager />

      {hzDisplay === "corner" && (
        <div className="cr-hz-corner">
          <HzReadout variant="corner" />
        </div>
      )}

      <TopPanel />
      <OfflineBanner offset={panelReservedTop(panelScale, panelStyle)} />
      <Taskbar />

      <Launcher />
      <QuickSettings />
      <NotificationCenter />
      <CommandPalette />
      <WorkspaceOverview />
      <ToastStack />
      <Standby />

      {contextMenu && (
        <div
          data-element-theme={overlayTheme.themeId ?? undefined}
          style={overlayTheme.style}
        >
          <Menu x={contextMenu.x} y={contextMenu.y} items={contextItems} onClose={closeContextMenu} />
        </div>
      )}

      {dim > 0 && (
        <div className="cr-dim-layer" style={{ opacity: dim }} aria-hidden="true" />
      )}
    </div>
  );
}

/** Applies the next wallpaper in the built-in rotation. */
function applyNextWallpaper(): void {
  const appearance = useAppearanceStore.getState();
  const all = [
    ...builtInWallpapers,
    ...gradientWallpapers,
    ...listCustomWallpapers().map((record) => ({ id: record.id })),
  ];
  const index = all.findIndex((wallpaper) => wallpaper.id === appearance.wallpaper.desktopId);
  const next = all[(index + 1) % all.length];
  if (!next) return;
  appearance.setWallpaper(
    appearance.wallpaper.syncLock
      ? { desktopId: next.id, lockId: next.id }
      : { desktopId: next.id },
  );
}
