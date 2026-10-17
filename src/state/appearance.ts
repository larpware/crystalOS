import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";
import type { CustomTheme, IconPack, LiveSceneId, WallpaperScale } from "@/types";
import { defaultThemeId, customAccentId } from "@/themes/presets";

export type LiveQuality = "low" | "medium" | "high";

export interface WallpaperConfig {
  /** Wallpaper Library id applied to the desktop. */
  desktopId: string;
  lockId: string;
  scale: WallpaperScale;
  /** 0–0.6 darkening layer behind desktop UI. */
  dim: number;
  blur: number;
  /** Keep the lock screen wallpaper in sync with the desktop. */
  syncLock: boolean;
  /** Weekly/quarterly shuffle across the favourite set. */
  shuffleMinutes: number;
}

export interface LiveWallpaperConfig {
  enabled: boolean;
  scene: LiveSceneId;
  quality: LiveQuality;
  /** Frame cap; performance mode forces this down. */
  fpsCap: number;
  /** Follow the pointer for parallax in reactive scenes. */
  interactive: boolean;
}

export interface FontConfig {
  /** Font id for the interface text. */
  ui: string;
  /** Font id for monospace surfaces (terminal, code). */
  mono: string;
  /** Font id for display text such as the lock-screen clock. */
  display: string;
}

export interface AppearanceState {
  themeId: string;
  /** `default` keeps the accent defined by the active theme. */
  accentId: string;
  /**
   * Colour used when `accentId` is `custom`. Stored separately so switching to
   * another accent and back does not lose the colour the user picked.
   */
  customAccent: string;
  customThemes: CustomTheme[];
  iconPackId: string;
  customIconPacks: IconPack[];
  wallpaper: WallpaperConfig;
  live: LiveWallpaperConfig;
  /** Global UI scale used for window chrome and OS geometry. */
  osScale: number;
  density: "comfortable" | "compact";
  /** Chosen font families for the interface, monospace and display roles. */
  fonts: FontConfig;

  setTheme: (themeId: string) => void;
  setAccent: (accentId: string) => void;
  setCustomAccent: (hex: string) => void;
  addCustomTheme: (theme: CustomTheme) => void;
  updateCustomTheme: (id: string, patch: Partial<CustomTheme>) => void;
  removeCustomTheme: (id: string) => void;
  setIconPack: (iconPackId: string) => void;
  saveIconPack: (pack: IconPack) => void;
  removeIconPack: (id: string) => void;
  setWallpaper: (patch: Partial<WallpaperConfig>) => void;
  setLive: (patch: Partial<LiveWallpaperConfig>) => void;
  setOsScale: (osScale: number) => void;
  setDensity: (density: "comfortable" | "compact") => void;
  setFonts: (patch: Partial<FontConfig>) => void;
}

export const defaultAccentId = "default";
/** Seeds the picker with the CrystalOS system blue rather than an arbitrary hue. */
export const defaultCustomAccent = "#4d8dff";

export const defaultWallpaperConfig: WallpaperConfig = {
  desktopId: "ridge-dusk",
  lockId: "ridge-dusk",
  scale: "cover",
  dim: 0.28,
  blur: 0,
  syncLock: true,
  shuffleMinutes: 0,
};

export const defaultFonts: FontConfig = {
  ui: "system",
  mono: "mono",
  display: "system",
};

export const defaultLiveConfig: LiveWallpaperConfig = {
  enabled: false,
  scene: "aurora",
  quality: "medium",
  fpsCap: 30,
  interactive: true,
};

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set, get) => ({
      themeId: defaultThemeId,
      accentId: defaultAccentId,
      customAccent: defaultCustomAccent,
      customThemes: [],
      iconPackId: "crescent",
      customIconPacks: [],
      wallpaper: defaultWallpaperConfig,
      live: defaultLiveConfig,
      osScale: 1,
      density: "comfortable",
      fonts: defaultFonts,

      setTheme: (themeId) => {
        // Changing theme should not change the user's selected wallpaper.
        // Wallpaper is managed separately by setWallpaper, and remains persistent
        // across theme switches.
        set({
          themeId,
        });
      },
      setAccent: (accentId) => set({ accentId }),
      setCustomAccent: (hex) => set({ customAccent: hex, accentId: customAccentId }),
      addCustomTheme: (theme) =>
        set({ customThemes: [...get().customThemes.filter((t) => t.id !== theme.id), theme] }),
      updateCustomTheme: (id, patch) =>
        set({
          customThemes: get().customThemes.map((theme) =>
            theme.id === id ? { ...theme, ...patch } : theme,
          ),
        }),
      removeCustomTheme: (id) =>
        set({
          customThemes: get().customThemes.filter((theme) => theme.id !== id),
          themeId: get().themeId === id ? defaultThemeId : get().themeId,
        }),
      setIconPack: (iconPackId) => set({ iconPackId }),
      saveIconPack: (pack) =>
        set({ customIconPacks: [...get().customIconPacks.filter((p) => p.id !== pack.id), pack] }),
      removeIconPack: (id) =>
        set({
          customIconPacks: get().customIconPacks.filter((pack) => pack.id !== id),
          iconPackId: get().iconPackId === id ? "crescent" : get().iconPackId,
        }),
      setWallpaper: (patch) => set({ wallpaper: { ...get().wallpaper, ...patch } }),
      setLive: (patch) => set({ live: { ...get().live, ...patch } }),
      setOsScale: (osScale) => set({ osScale }),
      setDensity: (density) => set({ density }),
      setFonts: (patch) => set({ fonts: { ...get().fonts, ...patch } }),
    }),
    {
      name: "appearance",
      version: 1,
      storage: jsonStorageFor<AppearanceState>(),
      partialize: (state) =>
        ({
          themeId: state.themeId,
          accentId: state.accentId,
          customAccent: state.customAccent,
          customThemes: state.customThemes,
          iconPackId: state.iconPackId,
          customIconPacks: state.customIconPacks,
          wallpaper: state.wallpaper,
          live: state.live,
          osScale: state.osScale,
          density: state.density,
          fonts: state.fonts,
        }) as AppearanceState,
    },
  ),
);
