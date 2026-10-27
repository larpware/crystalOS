import type { ThemePreset, ThemeTokens } from "@/types";
import { PANEL_BASE_HEIGHT, PANEL_DOCK_GAP } from "@/state/shell";
import { fontStack } from "./fonts";
import { accentVariants, type AccentOption } from "./presets";

/* ==========================================================================
   Theme application

   Themes never touch component styles — they only rewrite custom properties on
   :root. Anything that reads `var(--surface-1)` updates automatically, and the
   same is true of the chrome materials, the inner lighting and the elevation
   set, which is what makes each theme a different atmosphere instead of a
   different accent colour.
   ========================================================================== */

const tokenToVariable: Record<Exclude<keyof ThemeTokens, "wallpaperDefault">, string> = {
  bgRoot: "--bg-root",
  bgDesktop: "--bg-desktop",
  surface0: "--surface-0",
  surface1: "--surface-1",
  surface2: "--surface-2",
  surface3: "--surface-3",
  surfaceHover: "--surface-hover",
  surfaceActive: "--surface-active",
  surfaceSunken: "--surface-sunken",
  panelMaterial: "--panel-bg",
  dockMaterial: "--dock-bg",
  windowMaterial: "--window-bg",
  modalMaterial: "--modal-bg",
  textPrimary: "--text-primary",
  textSecondary: "--text-secondary",
  textTertiary: "--text-tertiary",
  textMuted: "--text-muted",
  borderSubtle: "--border-subtle",
  borderDefault: "--border-default",
  borderStrong: "--border-strong",
  innerHighlight: "--inner-highlight",
  edgeLight: "--edge-light",
  iconSurface: "--icon-surface",
  iconSurfaceStrong: "--icon-surface-strong",
  shadowSoft: "--shadow-soft",
  shadowPopover: "--shadow-popover",
  shadowWindow: "--shadow-window",
  accent: "--accent-primary",
  accentHover: "--accent-primary-hover",
  accentMuted: "--accent-primary-muted",
  accentOnMuted: "--accent-on-muted",
};

/** Token → custom property, for trees that render a theme inside the root theme. */
export const themeVariableMap = tokenToVariable;

/** True when a theme's root background is light. Shared with scoped themes. */
export function themeIsLight(theme: ThemePreset): boolean {
  return isLightRoot(theme.tokens.bgRoot);
}

/** The font stack a theme would publish, honouring explicit user picks. */
export function themeFontsFor(
  theme: ThemePreset,
  fonts?: ApplyThemeOptions["fonts"],
): ApplyThemeOptions["fonts"] | undefined {
  return fontsMatchStock(fonts) && theme.defaultFonts ? theme.defaultFonts : fonts;
}

export interface ApplyThemeOptions {
  accent?: AccentOption | null;
  /** Overall UI scale multiplier. */
  osScale: number;
  panelScale: number;
  /** Top bar layout: a floating dock, or a bar pinned to the screen edges. */
  panelStyle: "dock" | "full";
  /** Top bar corner radius in pixels; ignored in the full-width layout. */
  panelRadius: number;
  motion: "full" | "subtle" | "reduced";
  /** Performance mode: decorative hover and overlay motion is switched off. */
  performance: boolean;
  contrast: boolean;
  /**
   * Settings → Appearance → Reduce transparency. Published as a root flag so
   * the chrome can drop its backdrop filters and composite each theme material
   * into an opaque colour instead.
   */
  reduceTransparency: boolean;
  /**
   * Frost the inside of applications under a glass theme. Independent of
   * `reduceTransparency`, which makes the whole chrome opaque.
   */
  glassSurfaces: boolean;
  /** Wallpaper treatment. */
  wallpaperDim: number;
  wallpaperBlur: number;
  /** Font ids for the interface, monospace and display roles. */
  fonts?: { ui: string; mono: string; display: string };
  /** Dock corner radius in pixels. */
  dockBorderRadius?: number;
}

/** True when the user's font picks are the interface defaults (or unset) —
 *  the condition a theme must meet to impose its own type persona. */
function fontsMatchStock(fonts?: { ui: string; mono: string; display: string }): boolean {
  return !fonts || (fonts.ui === "dm" && fonts.mono === "mono" && fonts.display === "instrument");
}

export function applyTheme(theme: ThemePreset, options: ApplyThemeOptions): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  const isLight = isLightRoot(theme.tokens.bgRoot);

  for (const [token, variable] of Object.entries(tokenToVariable) as [
    keyof typeof tokenToVariable,
    string,
  ][]) {
    const value = theme.tokens[token];
    if (typeof value === "string" && value.length > 0) root.setProperty(variable, value);
  }

  /* The accent is derived from one colour — the user's chosen accent, or the
     theme's own — so hover, active, the selection fills and both text colours
     stay in step. Deriving `onAccent` is what makes an amber or yellow accent
     usable: label text flips to near-black on a light fill instead of staying
     white and unreadable. */
  const accentBase = options.accent?.value ?? theme.tokens.accent;
  const accent = accentVariants(accentBase, isLight ? "light" : "dark");
  root.setProperty("--accent-primary", accent.value);
  root.setProperty("--accent-primary-hover", accent.hover);
  root.setProperty("--accent-primary-active", accent.active);
  root.setProperty("--accent-primary-muted", accent.muted);
  root.setProperty("--accent-primary-muted-strong", accent.mutedStrong);
  root.setProperty("--accent-on-muted", accent.onMuted);
  root.setProperty("--text-on-accent", accent.onAccent);

  // Elevation is derived from the theme's own window shadow so focused and
  // inactive windows stay in the same lighting family.
  root.setProperty(
    "--shadow-window-focused",
    `0 30px 70px -18px color-mix(in srgb, var(--shadow-tint) 70%, transparent), 0 3px 10px color-mix(in srgb, var(--shadow-tint) 45%, transparent)`,
  );

  const panelHeight = Math.round(PANEL_BASE_HEIGHT * options.panelScale);
  root.setProperty("--panel-height", `${panelHeight}px`);
  root.setProperty("--panel-font-size", `${(12.5 * options.panelScale).toFixed(2)}px`);

  // Top bar geometry. The dock layout floats the bar clear of the top and side
  // edges, so the offsets, the rounded corners and the distance to the bar's
  // bottom edge are published here: the panel reads them, and so do the
  // overlays that hang underneath it (quick settings, notifications, toasts).
  const docked = options.panelStyle === "dock";
  const panelGap = docked ? PANEL_DOCK_GAP : 0;
  root.setProperty("--panel-top", `${panelGap}px`);
  root.setProperty("--panel-inset", `${panelGap}px`);
  root.setProperty("--panel-bottom", `${panelGap + panelHeight}px`);
  root.setProperty("--panel-radius", `${docked ? options.panelRadius : 0}px`);
  document.documentElement.dataset.panel = options.panelStyle;

  // Dock geometry (floating taskbar). The strip reads --dock-radius for its
  // border-radius, and --dock-align for its horizontal placement.
  if (options.dockBorderRadius !== undefined) {
    root.setProperty("--dock-radius", `${options.dockBorderRadius}px`);
  }

  // Launcher scrim — derived from the theme's root background so it adapts to
  // both dark and light appearances.
  const scrimBase = isLight ? "rgba(0, 0, 0, 0.32)" : "rgba(4, 5, 8, 0.42)";
  root.setProperty("--launcher-scrim", scrimBase);

  /* The titlebar is a plain 40px token: --os-scale zooms the whole root, so
     multiplying here as well would scale it twice. */

  root.setProperty("--wallpaper-dim", options.wallpaperDim.toFixed(3));
  root.setProperty("--wallpaper-blur", `${options.wallpaperBlur}px`);

  // Fonts are thin stacks resolved from ids; writing them here keeps every
  // surface that reads `--font-ui` / `--font-mono` in step with the choice.
  // The user's picks win — but while they ride the interface defaults, a theme
  // with its own type persona (the Solarized pair) swaps the whole type system,
  // exactly the way the palette swaps: theme as product, not theme as tint.
  const fonts = fontsMatchStock(options.fonts) && theme.defaultFonts
    ? theme.defaultFonts
    : options.fonts;
  if (fonts) {
    root.setProperty("--font-ui", fontStack(fonts.ui));
    root.setProperty("--font-mono", fontStack(fonts.mono));
    root.setProperty("--font-display", fontStack(fonts.display));
  }

  document.documentElement.dataset.appearance = theme.appearance;
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.dataset.motion = options.motion;
  // Performance mode is its own signal: it must still hold when the user has
  // pinned motion to Full, so decorative animation is never the thing that
  // costs frames while the machine is under load.
  document.documentElement.dataset.perf = options.performance ? "on" : "off";
  document.documentElement.dataset.contrast = options.contrast ? "high" : "normal";
  document.documentElement.dataset.transparency = options.reduceTransparency ? "reduced" : "full";

  // Glass themes get a global glass effect on windows and app surfaces.
  // The flag is inferred from theme id and can be overridden by transparency settings.
  const isGlassTheme = /glass/i.test(theme.id);
  if (isGlassTheme) {
    document.documentElement.dataset.glass = "true";
  } else {
    delete document.documentElement.dataset.glass;
  }

  // App-interior frost is a separate switch: a glass theme can keep its frosted
  // frame while painting solid surfaces inside.
  document.documentElement.dataset.glassSurfaces = options.glassSurfaces ? "on" : "off";

  document.documentElement.style.setProperty("--os-scale", String(options.osScale));
  document.documentElement.style.colorScheme = isLightRoot(theme.tokens.bgRoot) ? "light" : "dark";
}

/** Applies a user-authored token set without needing a full preset object. */
export function applyTokenPreview(tokens: ThemeTokens): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  for (const [token, variable] of Object.entries(tokenToVariable) as [
    keyof typeof tokenToVariable,
    string,
  ][]) {
    const value = tokens[token];
    if (typeof value === "string" && value.length > 0) root.setProperty(variable, value);
  }
}

/** Cheap perceptual check: is the root background a light colour? */
function isLightRoot(color: string): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const value = parseInt(hex[1], 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(color);
  if (rgb) {
    const [r, g, b] = rgb[1].split(",").map((part) => Number.parseFloat(part));
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
  }
  return false;
}
