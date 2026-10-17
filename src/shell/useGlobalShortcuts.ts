import { useEffect } from "react";
import { useNotificationStore } from "@/state/notifications";
import { useShellStore } from "@/state/shell";
import { useWindowStore } from "@/state/windows";
import { lockSession, openApp } from "@/services/os";

/* ==========================================================================
   Global shortcuts

   Browsers reserve some combinations (Ctrl+W closes the tab, Ctrl+L focuses the
   address bar). Those are bound as well, because the browser stays in charge
   when it claims a key — Settings → Keyboard documents exactly which ones may
   never reach CrystalOS.
   ========================================================================== */

export interface ShortcutSpec {
  id: string;
  keys: string;
  action: string;
  /** True when the browser may intercept the combination before the OS sees it. */
  browserReserved?: boolean;
}

export const shortcutList: ShortcutSpec[] = [
  { id: "launcher", keys: "Super", action: "Open the application launcher" },
  { id: "launcher-alt", keys: "Ctrl + Space", action: "Open the application launcher" },
  { id: "overview", keys: "Super + Space", action: "Toggle the launcher" },
  { id: "cycle", keys: "Alt + Tab", action: "Cycle between windows", browserReserved: true },
  { id: "terminal", keys: "Ctrl + Alt + T", action: "Open a new terminal" },
  { id: "close", keys: "Ctrl + W", action: "Close the focused window", browserReserved: true },
  {
    id: "close-all",
    keys: "Ctrl + Shift + W",
    action: "Close every window",
    browserReserved: true,
  },
  { id: "lock", keys: "Super + L", action: "Lock the screen" },
  { id: "dnd", keys: "Super + D", action: "Toggle Do Not Disturb" },
  { id: "minimise", keys: "Super + H", action: "Minimise the focused window" },
  { id: "maximise", keys: "Super + Up", action: "Maximise the focused window" },
  { id: "snap-left", keys: "Super + Left", action: "Snap the focused window left" },
  { id: "snap-right", keys: "Super + Right", action: "Snap the focused window right" },
  { id: "escape", keys: "Escape", action: "Dismiss menus, overlays and the launcher" },
  { id: "settings", keys: "Super + I", action: "Open Settings" },
];

export function useGlobalShortcuts(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    let metaDownAlone = false;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;

      const shell = useShellStore.getState();
      const windows = useWindowStore.getState();
      const focused = windows.windows.find((window) => window.focused);

      // Escape always works — including while typing, where it should dismiss.
      if (event.key === "Escape") {
        if (shell.contextMenu) {
          shell.closeContextMenu();
          return;
        }
        if (shell.launcherOpen) {
          shell.setLauncherOpen(false);
          return;
        }
        if (shell.quickSettingsOpen) {
          shell.setQuickSettingsOpen(false);
          return;
        }
        if (shell.notificationCenterOpen) {
          shell.setNotificationCenterOpen(false);
          return;
        }
        return;
      }

      // Super on its own opens the launcher.
      if (event.key === "Meta" && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        metaDownAlone = true;
        return;
      }
      if (metaDownAlone && event.key !== "Meta") {
        metaDownAlone = false;
      }

      if (typing) return;

      const meta = event.metaKey;
      const ctrl = event.ctrlKey;
      const alt = event.altKey;
      const shift = event.shiftKey;
      const key = event.key.toLowerCase();

      // Ctrl+Space and Super+Space toggle the launcher.
      if ((ctrl || meta) && event.key === " ") {
        event.preventDefault();
        shell.setLauncherOpen(!shell.launcherOpen);
        return;
      }

      if (ctrl && alt && key === "t") {
        event.preventDefault();
        openApp("terminal", { newInstance: true });
        return;
      }

      if (meta && key === "l") {
        event.preventDefault();
        lockSession();
        return;
      }

      if (meta && key === "d") {
        event.preventDefault();
        const prefs = useNotificationStore.getState();
        prefs.setPrefs({ doNotDisturb: !prefs.prefs.doNotDisturb });
        return;
      }

      if (meta && key === "i") {
        event.preventDefault();
        openApp("settings");
        return;
      }

      if (meta && key === "arrowup" && focused) {
        event.preventDefault();
        windows.toggleMaximize(focused.id);
        return;
      }

      if (meta && key === "arrowleft" && focused) {
        event.preventDefault();
        windows.snap(focused.id, "left");
        return;
      }

      if (meta && key === "arrowright" && focused) {
        event.preventDefault();
        windows.snap(focused.id, "right");
        return;
      }

      if (meta && key === "h" && focused) {
        event.preventDefault();
        windows.minimize(focused.id);
        return;
      }

      if (alt && event.key === "Tab") {
        event.preventDefault();
        windows.cycleFocus(shift ? -1 : 1);
        return;
      }

      if (ctrl && shift && key === "w") {
        event.preventDefault();
        windows.closeAll();
        return;
      }

      if (ctrl && !shift && key === "w") {
        // The browser may close the tab first; close the window when it does not.
        if (focused) {
          event.preventDefault();
          windows.close(focused.id);
        }
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Meta" && metaDownAlone) {
        metaDownAlone = false;
        const shell = useShellStore.getState();
        shell.setLauncherOpen(!shell.launcherOpen);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [active]);
}
