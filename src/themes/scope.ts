import { useMemo, type CSSProperties } from "react";
import type { ThemePreset } from "@/types";
import { useAppearanceStore, type UiElementRegion } from "@/state/appearance";
import { themeFontsFor, themeIsLight, themeVariableMap } from "./apply";
import { fontStack } from "./fonts";
import { accentVariants, findTheme, themePresets } from "./presets";

/* ==========================================================================
   Scoped themes

   The theme engine writes one token set on :root. A shell region that has been
   given a theme of its own receives that theme's tokens as custom properties on
   its own element instead, so the subtree recomputes against the other palette
   while everything outside it keeps the root theme. The mapping is the same one
   applyTheme uses, which is what keeps a scoped window as complete as the desk
   it sits on: surfaces, text, borders, materials, elevation and type.
   ========================================================================== */

export interface ScopedTheme {
  /** The theme actually applied, or null when the region follows the root. */
  themeId: string | null;
  style: CSSProperties | undefined;
}

/** Everything one theme publishes as inline custom properties. */
export function themeScopeStyle(
  theme: ThemePreset,
  userFonts?: { ui: string; mono: string; display: string },
): CSSProperties {
  const style: Record<string, string> = {};

  for (const [token, variable] of Object.entries(themeVariableMap) as [
    keyof typeof themeVariableMap,
    string,
  ][]) {
    const value = theme.tokens[token];
    if (typeof value === "string" && value.length > 0) style[variable] = value;
  }

  const light = themeIsLight(theme);
  const accent = accentVariants(theme.tokens.accent, light ? "light" : "dark");
  style["--accent-primary"] = accent.value;
  style["--accent-primary-hover"] = accent.hover;
  style["--accent-primary-active"] = accent.active;
  style["--accent-primary-muted"] = accent.muted;
  style["--accent-primary-muted-strong"] = accent.mutedStrong;
  style["--accent-on-muted"] = accent.onMuted;
  style["--text-on-accent"] = accent.onAccent;

  const fonts = themeFontsFor(theme, userFonts) ?? userFonts;
  if (fonts) {
    style["--font-ui"] = fontStack(fonts.ui);
    style["--font-mono"] = fontStack(fonts.mono);
    style["--font-display"] = fontStack(fonts.display);
  }

  style.colorScheme = light ? "light" : "dark";
  return style as CSSProperties;
}

/**
 * The scoped theme for one shell region, or nothing when it follows the root.
 *
 * Custom themes are resolved the same way App.tsx resolves the active one: the
 * saved token set layers on top of its preset so fields that predate this build
 * still resolve.
 */
export function useElementTheme(region: UiElementRegion): ScopedTheme {
  const pick = useAppearanceStore((state) => state.elementThemes[region]);
  const activeId = useAppearanceStore((state) => state.themeId);
  const customThemes = useAppearanceStore((state) => state.customThemes);
  const fonts = useAppearanceStore((state) => state.fonts);

  return useMemo(() => {
    if (!pick || pick === activeId) return { themeId: null, style: undefined };

    const custom = customThemes.find((theme) => theme.id === pick);
    const preset = findTheme(pick);
    // A pick that no longer resolves (a deleted custom theme, say) must follow
    // the active theme rather than quietly impersonate the first preset.
    if (!preset && !custom) return { themeId: null, style: undefined };
    const base = preset ?? themePresets[0];
    const theme: ThemePreset = custom
      ? { ...base, ...custom, tokens: { ...base.tokens, ...custom.tokens } }
      : base;

    return { themeId: theme.id, style: themeScopeStyle(theme, fonts) };
  }, [activeId, customThemes, fonts, pick]);
}
