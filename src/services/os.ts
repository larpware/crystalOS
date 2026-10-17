import { metaFor } from "@/apps/catalog";
import { useAppearanceStore } from "@/state/appearance";
import { useAppsStore } from "@/state/apps";
import { useBrowserStore } from "@/state/browser";
import { useFsStore, desktopFolderId, homeNodeId, resolvePath } from "@/state/fs";
import { useNotificationStore } from "@/state/notifications";
import { useShellStore } from "@/state/shell";
import { useWindowStore } from "@/state/windows";
import type { IconName } from "@/icons/icons";

/* ==========================================================================
   OS service layer

   Applications call these functions instead of touching stores directly for
   cross-app actions. Keeping that indirection here means the app registry can
   import applications without creating an import cycle.
   ========================================================================== */

export interface OpenAppOptions {
  args?: Record<string, unknown>;
  /** Force a second instance even for singleton apps. */
  newInstance?: boolean;
}

/** Drag payload carried when an application icon is dropped on the desktop. */
export const APP_DRAG_TYPE = "application/x-crescent-app";

/**
 * Focuses an application's window if it has one, restores it if it is
 * minimized, and launches it otherwise. This is what clicking a dock tile or
 * choosing Open from an icon's menu does.
 */
export function activateApp(appId: string): void {
  const store = useWindowStore.getState();
  const windows = store.windows.filter((window) => window.appId === appId);
  const visible = windows.find((window) => !window.minimized);
  if (visible) {
    store.focus(visible.id);
    return;
  }
  const minimized = windows.find((window) => window.minimized);
  if (minimized) {
    store.restore(minimized.id);
    store.focus(minimized.id);
    return;
  }
  openApp(appId);
}

/** True when the desktop already holds a shortcut for this application. */
export function hasDesktopShortcut(appId: string): boolean {
  const nodes = useFsStore.getState().nodes;
  const desktopId = desktopFolderId(nodes);
  return nodes.some(
    (node) => !node.trashed && node.appId === appId && node.parentId === desktopId,
  );
}

/**
 * Places an application on the desktop as a shortcut. Dropping an icon passes
 * the point it was dropped at; anywhere else it takes the next free slot.
 * Returns the new node id, or null when the application has no catalogue entry
 * or is already on the desktop.
 */
export function addDesktopShortcut(
  appId: string,
  position?: { x: number; y: number },
): string | null {
  const meta = metaFor(appId);
  if (!meta) return null;
  const fs = useFsStore.getState();
  if (hasDesktopShortcut(appId)) return null;
  return fs.createShortcut(desktopFolderId(fs.nodes), meta.name, appId, position);
}

export function openApp(appId: string, options: OpenAppOptions = {}): string | null {
  const meta = metaFor(appId);
  if (!meta) {
    useNotificationStore.getState().notify({
      appId: "system",
      icon: "warning",
      title: "Application unavailable",
      body: `No application is registered with the id "${appId}".`,
      transient: true,
    });
    return null;
  }
  const windowId = useWindowStore.getState().open({
    appId: meta.id,
    title: meta.name,
    icon: meta.icon,
    defaultSize: meta.defaultSize,
    minSize: meta.minSize,
    args: options.args,
    singleton: options.newInstance ? false : meta.singleton,
  });
  useAppsStore.getState().recordLaunch(meta.id);
  return windowId;
}

/**
 * Opens a virtual filesystem node in the right application.
 *
 * CrystalOS has no file manager: documents open in the application that
 * actually reads them, folders list in the Terminal, and a node nothing can
 * read says so instead of opening an empty window.
 */
export function openNode(nodeId: string): void {
  const nodes = useFsStore.getState().nodes;
  const node = nodes.find((entry) => entry.id === nodeId);
  if (!node) return;

  // Desktop entries that point at an application open that application rather
  // than a file reader.
  if (node.appId) {
    activateApp(node.appId);
    return;
  }

  if (node.kind === "folder") {
    // Folders are listed in the Terminal: the Terminal resolves the node id
    // itself, so paths containing spaces need no quoting.
    openApp("terminal", { args: { cwd: node.id, run: "ls" } });
    return;
  }

  const mime = node.mime ?? "";
  if (mime.startsWith("audio/")) {
    openApp("music");
    return;
  }
  if (mime.startsWith("video/") || mime.startsWith("image/")) {
    openApp("media");
    return;
  }
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml") {
    openApp("notes", { args: { noteId: node.id } });
    return;
  }

  useNotificationStore.getState().notify({
    appId: "system",
    icon: "info",
    title: "No application opens that file",
    body: `${node.name} (${mime || "unknown type"}) has no reader in this build.`,
    transient: true,
  });
}

/** Opens a virtual path, e.g. `/Home/Documents`, in the Terminal. */
export function openPath(path: string): void {
  const nodes = useFsStore.getState().nodes;
  const id = resolvePath(nodes, path) ?? homeNodeId(nodes);
  openApp("terminal", { args: { cwd: id, run: "ls" } });
}

/** Opens a URL in a new browser tab and brings the browser forward. */
export function launchUrl(url: string): void {
  const tabId = useBrowserStore.getState().newTab(url, true);
  useWindowStore.getState().open({
    appId: "browser",
    title: "CrystalOS Browser",
    icon: "browser",
    defaultSize: { width: 1080, height: 720 },
    minSize: { width: 480, height: 380 },
    args: { tabId },
    singleton: true,
  });
}

export function notify(input: {
  title: string;
  body?: string;
  icon?: IconName;
  appId?: string;
  transient?: boolean;
}) {
  return useNotificationStore.getState().notify({
    appId: input.appId ?? "system",
    icon: input.icon ?? "info",
    title: input.title,
    body: input.body,
    transient: input.transient,
  });
}

export function lockSession(): void {
  const shell = useShellStore.getState();
  shell.setPowerState("locked");
  shell.setLauncherOpen(false);
  shell.setQuickSettingsOpen(false);
  shell.setNotificationCenterOpen(false);
  shell.closeContextMenu();
}

export function sleepSession(): void {
  useShellStore.getState().setPowerState("sleep");
}

export function powerOff(): void {
  useShellStore.getState().setPowerState("off");
}

/**
 * A restart clears the window layout and returns to the desktop. Nothing is
 * restored across a restart, matching how a real desktop session behaves.
 */
export function restartSession(): void {
  useWindowStore.getState().closeAll();
  useShellStore.getState().setPowerState("on");
}

/** Applies a wallpaper to the desktop, and to the lock screen when synced. */
export function setWallpaper(id: string): void {
  const { wallpaper, setWallpaper: apply } = useAppearanceStore.getState();
  apply(wallpaper.syncLock ? { desktopId: id, lockId: id } : { desktopId: id });
}

/** File count summary, used by Settings → Advanced. */
export function describeStorage(): string {
  const nodes = useFsStore.getState().nodes;
  return `${nodes.length} filesystem entries`;
}
