import { useAppearanceStore } from "@/state/appearance";
import { useBrowserStore } from "@/state/browser";
import { useChatStore } from "@/state/chat";
import { useFsStore } from "@/state/fs";
import { useNotificationStore } from "@/state/notifications";
import { usePlaybackStore } from "@/state/playback";
import { useShellStore } from "@/state/shell";
import { useSystemStore } from "@/state/system";
import { useWidgetStore } from "@/state/widgets";
import { useWindowStore } from "@/state/windows";
import { mesh } from "./messaging";
import { byteSize, isPersistenceAvailable, listKeys } from "./storage";
import { readNetwork } from "./system";

/* ==========================================================================
   Developer diagnostics

   Enabled only by Settings → Advanced → Developer mode. Exposes the live
   stores and a compact report on `window.crystal` so a developer can inspect
   the running OS from the browser console. Nothing is exposed by default.
   ========================================================================== */

export interface DiagnosticsReport {
  version: string;
  windows: { id: string; appId: string; title: string; state: string; focused: boolean }[];
  focusedWindow: string | null;
  notifications: { active: number; history: number; dnd: boolean; hidden: boolean };
  persistence: { available: boolean; keys: number; bytes: number };
  transport: { mesh: string; transport: string; peers: number };
  filesystem: { entries: number; trashed: number };
  appearance: { theme: string; accent: string; liveWallpapers: boolean };
  system: { performanceMode: boolean; motion: string; deviceType: string };
  network: ReturnType<typeof readNetwork>;
}

function report(): DiagnosticsReport {
  const windows = useWindowStore.getState();
  const notifications = useNotificationStore.getState();
  const fs = useFsStore.getState();
  const appearance = useAppearanceStore.getState();
  const system = useSystemStore.getState();
  const chat = useChatStore.getState();

  return {
    version: "1.0.0",
    windows: windows.windows.map((window) => ({
      id: window.id,
      appId: window.appId,
      title: window.title,
      state: window.minimized ? "minimized" : window.state,
      focused: window.focused,
    })),
    focusedWindow: windows.focusedId,
    notifications: {
      active: notifications.active.length,
      history: notifications.history.length,
      dnd: notifications.prefs.doNotDisturb,
      hidden: notifications.prefs.hidden,
    },
    persistence: {
      available: isPersistenceAvailable(),
      keys: listKeys().length,
      bytes: byteSize(),
    },
    transport: {
      mesh: mesh.available ? "BroadcastChannel" : "unavailable",
      transport: chat.transport,
      peers: chat.peers.length,
    },
    filesystem: {
      entries: fs.nodes.filter((node) => !node.trashed).length,
      trashed: fs.nodes.filter((node) => node.trashed).length,
    },
    appearance: {
      theme: appearance.themeId,
      accent: appearance.accentId,
      liveWallpapers: appearance.live.enabled,
    },
    system: {
      performanceMode: system.performanceMode,
      motion: system.motionOverride,
      deviceType: system.deviceType,
    },
    network: readNetwork(),
  };
}

interface CrystalOSDebugApi {
  report: () => DiagnosticsReport;
  stores: {
    windows: typeof useWindowStore;
    shell: typeof useShellStore;
    notifications: typeof useNotificationStore;
    fs: typeof useFsStore;
    appearance: typeof useAppearanceStore;
    system: typeof useSystemStore;
    widgets: typeof useWidgetStore;
    browser: typeof useBrowserStore;
    chat: typeof useChatStore;
    playback: typeof usePlaybackStore;
  };
}

declare global {
  interface Window {
    crystal?: CrystalOSDebugApi;
  }
}

export function syncDeveloperMode(enabled: boolean): void {
  if (typeof window === "undefined") return;
  if (!enabled) {
    delete window.crystal;
    return;
  }
  window.crystal = {
    report,
    stores: {
      windows: useWindowStore,
      shell: useShellStore,
      notifications: useNotificationStore,
      fs: useFsStore,
      appearance: useAppearanceStore,
      system: useSystemStore,
      widgets: useWidgetStore,
      browser: useBrowserStore,
      chat: useChatStore,
      playback: usePlaybackStore,
    },
  };
  // eslint-disable-next-line no-console
  console.info("[crystal] developer mode enabled — window.crystal is available");
}
