import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";
import type { CustomTheme, IconPack, LiveSceneId, WallpaperScale } from "@/types";
import { defaultThemeId, customAccentId, findTheme, themeAliases } from "@/themes/presets";

export type LiveQuality = "low" | "medium" | "high";

/**
 * A region of the shell that can carry a theme of its own.
 *
 * The theme engine writes one token set at the root; a region picking another
 * theme receives that theme's tokens scoped to its own subtree instead. Empty
 * string means "follow the active theme".
 */
export type UiElementRegion = "windows" | "taskbar" | "panel" | "overlays" | "lock" | "standby";

export const elementThemeRegions: {
  id: UiElementRegion;
  label: string;
  description: string;
}[] = [
  {
    id: "windows",
    label: "Windows",
    description: "Window frames, titlebars and everything an application draws inside one.",
  },
  { id: "taskbar", label: "Dock", description: "The bottom dock and its window previews." },
  { id: "panel", label: "Top panel", description: "The bar with the clock, tray and activities." },
  {
    id: "overlays",
    label: "Launcher & menus",
    description: "The all-apps launcher, quick settings, notifications and context menus.",
  },
  { id: "lock", label: "Lock screen", description: "The sign-in screen." },
  { id: "standby", label: "Standby", description: "The always-on display and its sleep state." },
];

export type ElementThemes = Record<UiElementRegion, string>;

export const defaultElementThemes: ElementThemes = {
  windows: "",
  taskbar: "",
  panel: "",
  overlays: "",
  lock: "",
  standby: "",
};

export interface WallpaperConfig {
  /** Wallpaper Library id applied to the desktop. */
  desktopId: string;
  lockId: string;
  scale: WallpaperScale;
  /**
   * User zoom on top of `scale`, where 1 is "as fitted".
   *
   * Below 1 shrinks the artwork so a tight crop can be pulled back into view;
   * above 1 pushes in past the fit. Always applied about the picture's centre,
   * then shifted by `offsetX` / `offsetY`, so the two controls compose in a way
   * people already expect from a photo cropper.
   */
  zoom: number;
  /** Horizontal push in percent of the viewport. Negative moves the art left. */
  offsetX: number;
  /** Vertical push in percent of the viewport. Negative moves the art up. */
  offsetY: number;
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
  /**
   * TV interface (alpha): a 10-foot profile. Turning it on raises the OS
   * scale to something readable from a sofa and marks the document so the
   * shell can paint remote-grade focus rings; arrow keys drive the launcher
   * and every control stays reachable from a keyboard alone.
   */
  tvMode: boolean;
  /** Chosen font families for the interface, monospace and display roles. */
  fonts: FontConfig;
  /**
   * The window titlebar fades into the application underneath instead of
   * sitting on it as a solid strip. Off by default: a crisp bar reads as a
   * window edge in every theme, and blending is a taste, not a default.
   */
  titlebarBlend: boolean;
  /** Per-region theme picks; empty means follow the active theme. */
  elementThemes: ElementThemes;

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
  setTvMode: (tvMode: boolean) => void;
  setDensity: (density: "comfortable" | "compact") => void;
  setFonts: (patch: Partial<FontConfig>) => void;
  setTitlebarBlend: (titlebarBlend: boolean) => void;
  setElementTheme: (region: UiElementRegion, themeId: string) => void;
  resetElementThemes: () => void;
}

export const defaultAccentId = "default";
/** Seeds the picker with the CrystalOS system blue rather than an arbitrary hue. */
export const defaultCustomAccent = "#4d8dff";

export const defaultWallpaperConfig: WallpaperConfig = {
  desktopId: "gradient-ember",
  lockId: "gradient-ember",
  scale: "cover",
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  dim: 0.28,
  blur: 0,
  syncLock: true,
  shuffleMinutes: 0,
};

export const defaultFonts: FontConfig = {
  ui: "dm",
  mono: "mono",
  display: "instrument",
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
      tvMode: false,
      fonts: defaultFonts,
      titlebarBlend: false,
      elementThemes: defaultElementThemes,

      setTheme: (themeId) => {
        // Changing theme should not change the user's wallpaper choice —
        // unless the desk still shows another theme's un-touched default, in
        // which case it rides to the new theme's own backdrop. Each theme is
        // a complete persona; a cream window glass edge over an ember gradient
        // reads as an accident, not a choice.
        const theme = findTheme(themeId);
        const next = theme?.tokens.wallpaperDefault;
        const current = get().wallpaper;
        const previousDefault = findTheme(get().themeId)?.tokens.wallpaperDefault;
        if (
          next &&
          (current.desktopId === previousDefault ||
            current.desktopId === defaultWallpaperConfig.desktopId)
        ) {
          set({ themeId, wallpaper: { ...current, desktopId: next, lockId: next } });
          return;
        }
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
      setTvMode: (tvMode) => {
        // A sofa needs magnification the moment the profile switches on; the
        // slider keeps control afterwards, in either direction.
        if (tvMode && get().osScale < 1.4) set({ tvMode, osScale: 1.4 });
        else set({ tvMode });
      },
      setDensity: (density) => set({ density }),
      setFonts: (patch) => set({ fonts: { ...get().fonts, ...patch } }),
      setTitlebarBlend: (titlebarBlend) => set({ titlebarBlend }),
      setElementTheme: (region, themeId) =>
        set({ elementThemes: { ...get().elementThemes, [region]: themeId } }),
      resetElementThemes: () => set({ elementThemes: defaultElementThemes }),
    }),
    {
      name: "appearance",
      version: 4,
      storage: jsonStorageFor<AppearanceState>(),
      /**
       * v1 shipped no wallpaper framing. Rejecting the saved profile would throw
       * away the user's theme, their imported wallpapers and every custom theme,
       * so the new fields are filled with the "as fitted" values and an upgrade
       * stays invisible.
       */
      migrate: (persisted, version) => {
        const state = persisted as Partial<AppearanceState>;
        if (version < 2 && state?.wallpaper) {
          state.wallpaper = { ...defaultWallpaperConfig, ...state.wallpaper };
        }
        /* v3: the bundled-fonts + Cinema re-skin. Profiles fitted before it carry
           the old defaults — system fonts, light glass, the ridge photo — rather
           than deliberate choices, so those ride to the new default look. Any
           genuine pick (another theme, accent, or font) is left alone. */
        /* v4: Deep Sea ships as Solarized Dark, the old black-variant
           Solarized Dark ships as Dim, and Deep Sea 2 was removed as a
           duplicate of the same board. The stored id is rewritten once through
           the same alias table `findTheme` resolves, so the profile keeps the
           palette it had and the picker can still match it against a preset id. */
        if (version < 4 && state.themeId) {
          state.themeId = themeAliases[state.themeId] ?? state.themeId;
        }
        if (version < 3) {
          const fonts = state.fonts;
          if (fonts && fonts.ui === "system" && fonts.display === "system" && fonts.mono === "mono") {
            state.fonts = { ...defaultFonts };
          }
          if (state.themeId === "frosted_glass") state.themeId = defaultThemeId;
          const wallpaper = state.wallpaper as WallpaperConfig | undefined;
          if (wallpaper?.desktopId === "ridge-dusk" && wallpaper?.lockId === "ridge-dusk") {
            state.wallpaper = {
              ...wallpaper,
              desktopId: defaultWallpaperConfig.desktopId,
              lockId: defaultWallpaperConfig.lockId,
            };
          }
        }
        return state as AppearanceState;
      },
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
          tvMode: state.tvMode,
          fonts: state.fonts,
          titlebarBlend: state.titlebarBlend,
          elementThemes: state.elementThemes,
        }) as AppearanceState,
    },
  ),
);
