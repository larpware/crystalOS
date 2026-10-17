import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";
import type { ProxyMode } from "@/state/browser";

export type MotionOverride = "system" | "full" | "subtle" | "reduced";
export type HzDisplay = "off" | "panel" | "corner";

/** How a proxied application resolves against the OS-wide proxy switch. */
export type { ProxyMode };

export interface SystemState {
  /** False until the first-run wizard is completed. */
  setupComplete: boolean;
  deviceType: "desktop" | "laptop";
  /** Disables live wallpapers, heavy animation and background widget work. */
  performanceMode: boolean;
  developerMode: boolean;
  motionOverride: MotionOverride;
  hzDisplay: HzDisplay;
  reduceTransparency: boolean;
  /**
   * Glass themes frost the inside of applications — sidebars, toolbars and
   * dialogs — as well as the window frame. Turning this off keeps the frame
   * frosted but paints app interiors with the theme's solid surfaces.
   */
  glassSurfaces: boolean;
  /** Lets widgets tick in the background; disabling drops them to a slow clock. */
  backgroundWidgetUpdates: boolean;
  /**
   * Master switch for the Scramjet proxy across the whole OS. When off, every
   * proxied application (Browser, Drive, Spotify, Audiomack, the proxy app)
   * loads its destination directly in its own window instead of through the
   * transport. The Browser keeps its own override on top of this.
   */
  proxyEnabled: boolean;
  /**
   * Each single-destination application's own stance on the proxy, keyed by
   * its destination (which is one entry per application: Drive, Spotify,
   * Audiomack, Discord, QMovies).
   *
   * A missing entry means `inherit`, so an application follows the OS switch
   * until someone changes it — which is what every proxied application does on
   * first launch. An explicit `on` or `off` wins for that application alone,
   * the same way the Browser's own override wins over the OS switch. The
   * Browser keeps its per-tab mode in its own store; this covers the rest.
   */
  proxyModes: Record<string, ProxyMode>;
  /** Epoch ms of the current session start, used by the uptime readout. */
  sessionStartedAt: number;

  completeSetup: (input: {
    deviceType: "desktop" | "laptop";
    performanceMode: boolean;
    motionOverride: MotionOverride;
  }) => void;
  setDeviceType: (deviceType: "desktop" | "laptop") => void;
  setPerformanceMode: (enabled: boolean) => void;
  setDeveloperMode: (enabled: boolean) => void;
  setMotionOverride: (motion: MotionOverride) => void;
  setBackgroundWidgetUpdates: (enabled: boolean) => void;
  setProxyEnabled: (enabled: boolean) => void;
  /** Sets one application's proxy stance. Keyed by its destination. */
  setProxyMode: (key: string, mode: ProxyMode) => void;
  setHzDisplay: (display: HzDisplay) => void;
  setReduceTransparency: (enabled: boolean) => void;
  setGlassSurfaces: (enabled: boolean) => void;
  /** Returns the OS to the first-run wizard without deleting user data. */
  rerunSetup: () => void;
  markSessionStart: () => void;
}

export const useSystemStore = create<SystemState>()(
  persist(
    (set) => ({
      setupComplete: false,
      deviceType: "desktop",
      performanceMode: false,
      developerMode: false,
      motionOverride: "system",
      hzDisplay: "off",
      reduceTransparency: false,
      glassSurfaces: true,
      backgroundWidgetUpdates: true,
      proxyEnabled: true,
      proxyModes: {},
      sessionStartedAt: Date.now(),

      completeSetup: ({ deviceType, performanceMode, motionOverride }) =>
        set({ setupComplete: true, deviceType, performanceMode, motionOverride }),
      setDeviceType: (deviceType) => set({ deviceType }),
      setPerformanceMode: (performanceMode) => set({ performanceMode }),
      setDeveloperMode: (developerMode) => set({ developerMode }),
      setMotionOverride: (motionOverride) => set({ motionOverride }),
      setBackgroundWidgetUpdates: (backgroundWidgetUpdates) => set({ backgroundWidgetUpdates }),
      setProxyEnabled: (proxyEnabled) => set({ proxyEnabled }),
      setProxyMode: (key, mode) =>
        set((state) => ({ proxyModes: { ...state.proxyModes, [key]: mode } })),
      setHzDisplay: (hzDisplay) => set({ hzDisplay }),
      setReduceTransparency: (reduceTransparency) => set({ reduceTransparency }),
      setGlassSurfaces: (glassSurfaces) => set({ glassSurfaces }),
      rerunSetup: () => set({ setupComplete: false }),
      markSessionStart: () => set({ sessionStartedAt: Date.now() }),
    }),
    {
      name: "system",
      version: 1,
      storage: jsonStorageFor<SystemState>(),
      partialize: (state) => ({
        setupComplete: state.setupComplete,
        deviceType: state.deviceType,
        performanceMode: state.performanceMode,
        developerMode: state.developerMode,
        motionOverride: state.motionOverride,
        hzDisplay: state.hzDisplay,
        reduceTransparency: state.reduceTransparency,
        glassSurfaces: state.glassSurfaces,
        backgroundWidgetUpdates: state.backgroundWidgetUpdates,
        proxyEnabled: state.proxyEnabled,
        proxyModes: state.proxyModes,
      }) as SystemState,
    },
  ),
);
