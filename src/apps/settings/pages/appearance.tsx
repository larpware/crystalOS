import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Field,
  IconButton,
  Modal,
  Row,
  Section,
  Segmented,
  Select,
  Slider,
  Switch,
  TextInput,
} from "@/components/ui";
import { AppIcon, Icon } from "@/icons/Icon";
import { metaFor } from "@/apps/catalog";
import { useAppearanceStore, elementThemeRegions, type LiveQuality } from "@/state/appearance";
import { useShellStore } from "@/state/shell";
import { useSystemStore } from "@/state/system";
import {
  accentOptions,
  customAccentId,
  emptyThemeFrom,
  findTheme,
  normaliseHex,
  parseThemeJSON,
  themePresets,
  themeShadowTokens,
  themeTokenKeys,
  themeTokenLabel,
} from "@/themes/presets";
import type { CustomTheme, IconPack, LiveSceneId, ThemeTokens, WallpaperScale } from "@/types";
import { createId } from "@/utils/format";
import { liveSceneLabels } from "@/wallpapers/liveScenes";
import { useResolvedWallpaper } from "@/wallpapers/Wallpaper";
import {
  displayFontOptions,
  monoFontOptions,
  uiFontOptions,
} from "@/themes/fonts";
import {
  builtInWallpapers,
  gradientWallpapers,
  liveWallpapers,
} from "@/wallpapers/library";
import { listCustomWallpapers } from "@/wallpapers/custom";
import { openApp } from "@/services/os";

/* ==========================================================================
   Settings — appearance group
   ========================================================================== */

export function AppearancePage() {
  const appearance = useAppearanceStore();
  const {
    reduceTransparency,
    setReduceTransparency,
    glassSurfaces,
    setGlassSurfaces,
    motionOverride,
    setMotionOverride,
  } = useSystemStore();
  const theme = findTheme(appearance.themeId);
  const isGlassTheme = /glass/i.test(appearance.themeId);
  const isCustom = appearance.customThemes.find((entry) => entry.id === appearance.themeId);
  const [localScale, setLocalScale] = useState(appearance.osScale);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    setLocalScale(appearance.osScale);
  }, [appearance.osScale]);

  return (
    <>
      <Section
        title="Theme"
        description="Themes set every surface, text and border colour in the OS."
      >
        <Row
          label="Active theme"
          description={theme?.description ?? "Custom theme"}
          control={
            <Select
              aria-label="Active theme"
              value={appearance.themeId}
              onChange={(event) => appearance.setTheme(event.target.value)}
              options={[
                ...themePresets.map((preset) => ({ value: preset.id, label: preset.name })),
                ...appearance.customThemes.map((preset) => ({
                  value: preset.id,
                  label: `${preset.name} (custom)`,
                })),
              ]}
            />
          }
        />
        <div className="cr-swatch-grid">
          {themePresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="cr-swatch"
              aria-pressed={preset.id === appearance.themeId}
              onClick={() => appearance.setTheme(preset.id)}
            >
              <span
                className="cr-swatch__preview"
                style={{
                  background: preset.tokens.bgDesktop,
                  borderColor: preset.tokens.borderDefault,
                }}
              >
                <span
                  className="cr-swatch__panel"
                  style={{ background: preset.tokens.surface1, borderColor: preset.tokens.borderSubtle }}
                >
                  <span style={{ background: preset.tokens.textSecondary }} />
                  <span style={{ background: preset.tokens.textMuted }} />
                </span>
                <span className="cr-swatch__accent" style={{ background: preset.tokens.accent }} />
              </span>
              <span className="cr-swatch__name">{preset.name}</span>
              <span className="cr-swatch__meta">
                {preset.recommended && <em className="cr-swatch__flag">recommended</em>}
                {preset.deprecated && (
                  <em className="cr-swatch__flag cr-swatch__flag--deprecated">deprecated</em>
                )}
                {preset.appearance}
              </span>
            </button>
          ))}
        </div>
        <Row
          label="Accent colour"
          description="Used for focus rings, selection, primary actions and status. Presets cover most of it; the picker accepts any colour."
          control={<AccentPicker themeAccent={theme?.tokens.accent ?? "#4d8dff"} />}
        />
      </Section>

      <Section title="Custom themes" description="Create, edit and share your own themes.">
        <CustomThemeEditor />
      </Section>

      <Section
        title="Interface"
        description="UI scale and motion for the whole desktop. UI scale magnifies everything at once — panel, dock, windows, widgets, desktop icons and text."
      >
        <Row
          label="UI scale"
          description="Magnifies every part of the interface at once, like a display zoom."
          control={
            <Slider
              label="UI scale"
              min={0.75}
              max={2}
              step={0.05}
              value={localScale}
              onChange={(value) => setLocalScale(value)}
              onCommit={(value) => appearance.setOsScale(value)}
              format={(value) => `${Math.round(value * 100)}%`}
            />
          }
        />
        <Row
          label="TV interface (alpha)"
          description="A 10-foot profile for televisions: raises the UI scale to sofa distance, paints remote-grade focus rings, and drives the launcher with arrow keys plus Enter. Every screen stays keyboard-reachable."
          control={
            <Switch
              label="TV interface (alpha)"
              checked={appearance.tvMode}
              onChange={(checked) => appearance.setTvMode(checked)}
            />
          }
        />
        <Row
          label="Density"
          description="Compact reduces padding in lists and settings rows."
          control={
            <Segmented
              label="Density"
              value={appearance.density}
              onChange={appearance.setDensity}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
            />
          }
        />
        <Row
          label="Motion"
          description="Motion level for window and overlay animations."
          control={
            <Select
              aria-label="Motion"
              value={motionOverride}
              onChange={(event) =>
                setMotionOverride(event.target.value as typeof motionOverride)
              }
              options={[
                { value: "system", label: "Follow system preference" },
                { value: "full", label: "Full" },
                { value: "subtle", label: "Subtle" },
                { value: "reduced", label: "Reduced" },
              ]}
            />
          }
        />
        {isGlassTheme && (
          <Row
            label="Frost app surfaces"
            description="Carries the theme's frosted glass into the inside of applications — sidebars, toolbars and dialogs — instead of solid black panels."
            control={
              <Switch
                label="Frost app surfaces"
                checked={glassSurfaces}
                onChange={setGlassSurfaces}
              />
            }
          />
        )}
        <Row
          label="Reduce transparency"
          description="Uses solid surfaces everywhere instead of translucent ones, including the frosted window frame. Small performance gain."
          control={
            <Switch
              label="Reduce transparency"
              checked={reduceTransparency}
              onChange={setReduceTransparency}
            />
          }
        />
      </Section>

      <Section
        title="Window chrome"
        description="How every window's titlebar meets the application underneath it."
      >
        <Row
          label="Blend the titlebar into apps"
          description="The bar thins out into the application instead of stopping at a solid edge, and the top of the app frosts up into it — the gradient under the controls is made from what the site is actually drawing, not from a painted band. Off by default, because a crisp edge is part of what makes a window read as a window; the app name and controls stay legible either way, and Reduce transparency puts the crisp bar back."
          control={
            <Switch
              label="Blend the titlebar into apps"
              checked={appearance.titlebarBlend}
              onChange={appearance.setTitlebarBlend}
            />
          }
        />
      </Section>

      <Section
        title="Advanced · Per-element themes"
        description="Give one part of the shell a theme of its own. A pick here is scoped to that surface only — windows, the dock, the panel, overlays, the lock screen or standby — while everything else keeps the active theme."
      >
        <Row
          label="Per-element themes"
          description="Off by default. Every surface follows the active theme until you choose otherwise."
          control={
            <Button
              variant="ghost"
              icon={advancedOpen ? "chevron-up" : "chevron-down"}
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              {advancedOpen ? "Hide" : "Configure"}
            </Button>
          }
        />
        {advancedOpen &&
          elementThemeRegions.map((region) => (
            <Row key={region.id} label={region.label} description={region.description} control={
              <Select
                aria-label={`Theme for ${region.label}`}
                value={appearance.elementThemes[region.id]}
                onChange={(event) =>
                  appearance.setElementTheme(region.id, event.target.value)
                }
                options={[
                  { value: "", label: "Follow the active theme" },
                  ...themePresets.map((preset) => ({ value: preset.id, label: preset.name })),
                  ...appearance.customThemes.map((preset) => ({
                    value: preset.id,
                    label: `${preset.name} (custom)`,
                  })),
                ]}
              />
            } />
          ))}
        {advancedOpen && (
          <Row
            label="Reset every surface"
            description="Returns each region above to the active theme."
            control={
              <Button variant="ghost" onClick={() => appearance.resetElementThemes()}>
                Follow all
              </Button>
            }
          />
        )}
      </Section>

      <Section
        title="Fonts"
        description="Pick the families used across the interface. Each option is a stack, so a family the machine does not have falls through to the next one instead of breaking."
      >
        <Row
          label="Interface font"
          description="Used for windows, settings, menus and labels."
          control={
            <Select
              aria-label="Interface font"
              value={appearance.fonts.ui}
              onChange={(event) => appearance.setFonts({ ui: event.target.value })}
              options={uiFontOptions.map((font) => ({ value: font.id, label: font.name }))}
            />
          }
        />
        <Row
          label="Monospace font"
          description="Used by the terminal and any fixed-width text."
          control={
            <Select
              aria-label="Monospace font"
              value={appearance.fonts.mono}
              onChange={(event) => appearance.setFonts({ mono: event.target.value })}
              options={monoFontOptions.map((font) => ({ value: font.id, label: font.name }))}
            />
          }
        />
        <Row
          label="Display font"
          description="Used for large display text such as widgets and headings."
          control={
            <Select
              aria-label="Display font"
              value={appearance.fonts.display}
              onChange={(event) => appearance.setFonts({ display: event.target.value })}
              options={displayFontOptions.map((font) => ({ value: font.id, label: font.name }))}
            />
          }
        />
      </Section>

      {isCustom && <CustomThemeQuickEdit theme={isCustom} />}
    </>
  );
}

/* --------------------------------------------------------------------------
   Accent picker

   Six curated swatches, a "theme default" swatch that restores whatever the
   active theme defines, and a colour picker for everything else. The picked
   colour is stored as a hex value and expanded into a full accent set
   (hover, muted fill, on-muted text) so a custom accent behaves exactly like
   a preset one.
   -------------------------------------------------------------------------- */

function AccentPicker({ themeAccent }: { themeAccent: string }) {
  const accentId = useAppearanceStore((state) => state.accentId);
  const customAccent = useAppearanceStore((state) => state.customAccent);
  const setAccent = useAppearanceStore((state) => state.setAccent);
  const setCustomAccent = useAppearanceStore((state) => state.setCustomAccent);
  const [draft, setDraft] = useState(customAccent);

  useEffect(() => {
    setDraft(customAccent);
  }, [customAccent]);

  /* Typing is committed on Enter or when the field loses focus, so a partially
     typed value never repaints the whole OS with a wrong colour. */
  const commitDraft = () => {
    const hex = normaliseHex(draft);
    if (hex) setCustomAccent(hex);
    else setDraft(customAccent);
  };

  return (
    <div className="cr-accent-picker">
      <div className="cr-accent-row" role="group" aria-label="Accent colour">
        <button
          type="button"
          className="cr-accent-dot cr-accent-dot--default"
          style={{ background: themeAccent }}
          aria-label="Accent from the active theme"
          title="Theme default"
          aria-pressed={accentId === "default"}
          onClick={() => setAccent("default")}
        />
        {accentOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className="cr-accent-dot"
            style={{ background: option.value }}
            aria-label={option.name}
            title={option.name}
            aria-pressed={option.id === accentId}
            onClick={() => setAccent(option.id)}
          />
        ))}
        <span className="cr-accent-row__divider" aria-hidden="true" />
        <button
          type="button"
          className="cr-accent-dot cr-accent-dot--custom"
          style={{ background: `conic-gradient(#f0553d, #e8c547, #4ecb71, #3fb8d8, #6f7dff, #c86fe0, #f0553d)` }}
          aria-label="Custom accent colour"
          title="Custom…"
          aria-pressed={accentId === customAccentId}
          onClick={() => setCustomAccent(customAccent)}
        />
      </div>

      <div className="cr-accent-custom">
        <input
          type="color"
          className="cr-color-input"
          aria-label="Pick a custom accent colour"
          value={normaliseHex(draft) ?? customAccent}
          onChange={(event) => setCustomAccent(event.target.value)}
        />
        <TextInput
          className="cr-input--mono"
          aria-label="Custom accent hex value"
          value={draft}
          spellCheck={false}
          maxLength={7}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
            }
          }}
        />
      </div>
    </div>
  );
}

function CustomThemeEditor() {
  const { customThemes, addCustomTheme, removeCustomTheme, themeId, setTheme } = useAppearanceStore();
  const [editorOpen, setEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const base = findTheme(themeId) ?? themePresets[0];

  const importTheme = async (file: File) => {
    const text = await file.text();
    const parsed = parseThemeJSON(text);
    if (!parsed) {
      setImportError("That file is not a CrystalOS theme. Expected a JSON object with tokens.");
      return;
    }
    const theme: CustomTheme = {
      ...parsed,
      id: createId("theme"),
      createdAt: Date.now(),
    };
    addCustomTheme(theme);
    setTheme(theme.id);
    setImportOpen(false);
    setImportError(null);
  };

  const exportTheme = (theme: CustomTheme) => {
    const { createdAt: _createdAt, ...rest } = theme;
    const blob = new Blob([JSON.stringify(rest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${theme.id}.crystal-theme.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="cr-theme-list">
        {customThemes.length === 0 && (
          <p className="cr-row__desc">
            No custom themes yet. Duplicate the active theme to start from a known-good palette.
          </p>
        )}
        {customThemes.map((theme) => (
          <div key={theme.id} className="cr-theme-list__item">
            <span className="cr-theme-list__dot" style={{ background: theme.tokens.accent }} />
            <div className="cr-row__text">
              <div className="cr-row__label">{theme.name}</div>
              <div className="cr-row__desc">
                Based on {theme.description || "a custom palette"} · created{" "}
                {new Date(theme.createdAt).toLocaleDateString()}
              </div>
            </div>
            <div className="cr-theme-list__actions">
              <IconButton
                icon="pencil"
                label={`Edit ${theme.name}`}
                onClick={() => {
                  setTheme(theme.id);
                  openApp("settings", { args: { page: "appearance" } });
                }}
              />
              <IconButton
                icon="download"
                label={`Export ${theme.name}`}
                onClick={() => exportTheme(theme)}
              />
              <IconButton
                icon="trash"
                label={`Delete ${theme.name}`}
                onClick={() => removeCustomTheme(theme.id)}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="cr-button-row">
        <Button
          icon="plus"
          onClick={() =>
            addCustomTheme({
              ...emptyThemeFrom(base, createId("theme"), `${base.name} copy`),
              createdAt: Date.now(),
            })
          }
        >
          Duplicate active theme
        </Button>
        <Button icon="upload" onClick={() => setImportOpen(true)}>
          Import theme
        </Button>
        <Button icon="sliders" onClick={() => setEditorOpen(true)} disabled={customThemes.length === 0}>
          Edit tokens
        </Button>
      </div>

      <Modal open={importOpen} title="Import theme" onClose={() => setImportOpen(false)}>
        <p className="cr-row__desc">
          Choose a theme file exported from CrystalOS. Tokens are validated before the theme is
          added.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="cr-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importTheme(file);
          }}
        />
        {importError && <p className="cr-field__error">{importError}</p>}
      </Modal>

      <Modal
        open={editorOpen}
        title="Edit theme tokens"
        width={640}
        onClose={() => setEditorOpen(false)}
        footer={<Button onClick={() => setEditorOpen(false)}>Done</Button>}
      >
        <TokenEditor />
      </Modal>
    </>
  );
}

function TokenEditor() {
  const { themeId, customThemes, updateCustomTheme } = useAppearanceStore();
  const theme = customThemes.find((entry) => entry.id === themeId);
  if (!theme) {
    return <p className="cr-row__desc">Select a custom theme to edit its tokens.</p>;
  }
  return (
    <div className="cr-token-editor">
      <p className="cr-row__desc">
        Colours drive every surface, material and highlight. Elevation entries take a full CSS
        box-shadow, which is how a theme's depth stays under your control.
      </p>
      {themeTokenKeys.map((key) => {
        // Colours are edited with a swatch; elevation values are CSS shadows and
        // have no single colour a picker could represent.
        const isShadow = themeShadowTokens.includes(key);
        const value = theme.tokens[key] ?? "";
        const set = (next: string) =>
          updateCustomTheme(theme.id, {
            tokens: { ...theme.tokens, [key]: next } as ThemeTokens,
          });
        return (
          <label key={key} className="cr-token-editor__row" data-shadow={isShadow}>
            <span className="cr-token-editor__label">{themeTokenLabel[key]}</span>
            <input
              type="text"
              className="cr-input cr-input--mono"
              value={value}
              spellCheck={false}
              onChange={(event) => set(event.target.value)}
            />
            {!isShadow && (
              <input
                type="color"
                className="cr-color-input"
                aria-label={`${themeTokenLabel[key]} colour`}
                value={toHex(value)}
                onChange={(event) => set(event.target.value)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

function toHex(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed
      .slice(1)
      .split("")
      .map((character) => character + character)
      .join("")}`;
  }
  return "#000000";
}

function CustomThemeQuickEdit({ theme }: { theme: CustomTheme }) {
  const { updateCustomTheme } = useAppearanceStore();
  return (
    <Section title="Editing" description={`Renaming and duplicating ${theme.name}.`}>
      <Field label="Theme name" htmlFor="theme-name">
        <TextInput
          id="theme-name"
          value={theme.name}
          onChange={(event) => updateCustomTheme(theme.id, { name: event.target.value })}
        />
      </Field>
      <Field label="Description" htmlFor="theme-desc">
        <TextInput
          id="theme-desc"
          value={theme.description}
          onChange={(event) => updateCustomTheme(theme.id, { description: event.target.value })}
        />
      </Field>
    </Section>
  );
}

/* ---- wallpaper --------------------------------------------------------- */

export function WallpaperPage() {
  const { wallpaper, setWallpaper, live, setLive } = useAppearanceStore();
  const performanceMode = useSystemStore((state) => state.performanceMode);
  const customCount = listCustomWallpapers().length;

  const desktop = useMemo(
    () =>
      [...builtInWallpapers, ...gradientWallpapers, ...liveWallpapers].find(
        (entry) => entry.id === wallpaper.desktopId,
      ),
    [wallpaper.desktopId],
  );

  // Framing only means something for a picture or video. A generated gradient
  // and a live scene have nothing to zoom into, so those rows stay hidden
  // rather than offering a control that would do nothing.
  const frameable = Boolean(useResolvedWallpaper(wallpaper.desktopId).url);

  const sceneOptions = (Object.keys(liveSceneLabels) as LiveSceneId[]).map((scene) => ({
    value: scene,
    label: liveSceneLabels[scene],
  }));

  return (
    <>
      <Section title="Desktop wallpaper" description="Managed in the Wallpaper Library.">
        <Row
          label="Current wallpaper"
          description={desktop ? `${desktop.name} · ${desktop.kind}` : wallpaper.desktopId}
          control={
            <Button icon="wallpaper" onClick={() => openApp("wallpaper")}>
              Open Wallpaper Library
            </Button>
          }
        />
        <Row
          label="Scaling"
          control={
            <Select
              aria-label="Wallpaper scaling"
              value={wallpaper.scale}
              onChange={(event) => setWallpaper({ scale: event.target.value as WallpaperScale })}
              options={[
                { value: "cover", label: "Fill screen (cover)" },
                { value: "contain", label: "Fit (contain)" },
                { value: "fill", label: "Stretch (fill)" },
                { value: "tile", label: "Tile" },
              ]}
            />
          }
        />
        {frameable && (
          <>
            <Row
              label="Zoom"
              description="Pushes past, or pulls back from, the fitted size. Under 100% reveals more of a picture that is cropped too tight."
              control={
                <Slider
                  label="Wallpaper zoom"
                  min={0.5}
                  max={3}
                  step={0.01}
                  value={wallpaper.zoom}
                  onChange={(zoom) => setWallpaper({ zoom })}
                  format={(value) => `${Math.round(value * 100)}%`}
                />
              }
            />
            <Row
              label="Position"
              description="Slides the wallpaper to choose which part of the picture stays in frame."
              stacked
            >
              <div className="cr-wp-framer__sliders">
                <div className="cr-wp-framer__field">
                  <span>Horizontal</span>
                  <Slider
                    label="Wallpaper horizontal position"
                    min={-50}
                    max={50}
                    step={1}
                    value={wallpaper.offsetX}
                    onChange={(offsetX) => setWallpaper({ offsetX })}
                    format={(value) => `${Math.round(value)}%`}
                  />
                </div>
                <div className="cr-wp-framer__field">
                  <span>Vertical</span>
                  <Slider
                    label="Wallpaper vertical position"
                    min={-50}
                    max={50}
                    step={1}
                    value={wallpaper.offsetY}
                    onChange={(offsetY) => setWallpaper({ offsetY })}
                    format={(value) => `${Math.round(value)}%`}
                  />
                </div>
              </div>
            </Row>
            <Row
              label="Framing"
              description="Reset the zoom and position, or fit the whole picture inside the screen."
              control={
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="refresh"
                    onClick={() => setWallpaper({ zoom: 1, offsetX: 0, offsetY: 0 })}
                  >
                    Reset
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="maximize"
                    onClick={() =>
                      setWallpaper({ scale: "contain", zoom: 1, offsetX: 0, offsetY: 0 })
                    }
                  >
                    Fit whole picture
                  </Button>
                </>
              }
            />
          </>
        )}
        <Row
          label="Dim behind desktop UI"
          description="A dark layer keeps panel and dock labels readable on bright wallpapers."
          control={
            <Slider
              label="Dim"
              min={0}
              max={0.6}
              step={0.02}
              value={wallpaper.dim}
              onChange={(dim) => setWallpaper({ dim })}
              format={(value) => `${Math.round(value * 100)}%`}
            />
          }
        />
        <Row
          label="Background blur"
          description="Blurs the wallpaper layer. Small performance impact."
          control={
            <Slider
              label="Background blur"
              min={0}
              max={16}
              value={wallpaper.blur}
              onChange={(blur) => setWallpaper({ blur })}
              format={(value) => `${value}px`}
            />
          }
        />
        <Row
          label="Shuffle favourites"
          description="Rotates through the wallpaper library on a timer."
          control={
            <Select
              aria-label="Shuffle favourites"
              value={String(wallpaper.shuffleMinutes)}
              onChange={(event) => setWallpaper({ shuffleMinutes: Number(event.target.value) })}
              options={[
                { value: "0", label: "Off" },
                { value: "15", label: "Every 15 minutes" },
                { value: "60", label: "Every hour" },
                { value: "1440", label: "Every day" },
              ]}
            />
          }
        />
        <Row
          label="Imported wallpapers"
          description={`${customCount} file${customCount === 1 ? "" : "s"} stored locally in this browser.`}
        />
      </Section>

      <Section title="Live wallpapers" description="Procedural scenes drawn on the wallpaper layer.">
        <Row
          label="Live wallpaper"
          description={
            performanceMode
              ? "Disabled while performance mode is on."
              : "Renders continuously with requestAnimationFrame."
          }
          control={
            <Switch
              label="Live wallpaper"
              checked={live.enabled}
              disabled={performanceMode}
              onChange={(enabled) => setLive({ enabled })}
            />
          }
        />
        <Row
          label="Scene"
          control={
            <Select
              aria-label="Live scene"
              value={live.scene}
              onChange={(event) => setLive({ scene: event.target.value as LiveSceneId })}
              options={sceneOptions}
            />
          }
        />
        <Row
          label="Quality"
          description="Lower quality reduces particle counts and blur work."
          control={
            <Segmented
              label="Live quality"
              value={live.quality}
              onChange={(quality: LiveQuality) => setLive({ quality })}
              options={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
              ]}
            />
          }
        />
        <Row
          label="Frame cap"
          description="Caps how often the scene repaints."
          control={
            <Select
              aria-label="Frame cap"
              value={String(live.fpsCap)}
              onChange={(event) => setLive({ fpsCap: Number(event.target.value) })}
              options={[
                { value: "15", label: "15 fps" },
                { value: "30", label: "30 fps" },
                { value: "60", label: "60 fps" },
              ]}
            />
          }
        />
        <Row
          label="React to pointer"
          description="Scenes with parallax follow the pointer."
          control={
            <Switch
              label="React to pointer"
              checked={live.interactive}
              onChange={(interactive) => setLive({ interactive })}
            />
          }
        />
      </Section>

      <Section title="Lock screen wallpaper">
        <Row
          label="Sync with desktop"
          description="Keeps the lock screen on the same wallpaper as the desktop."
          control={
            <Switch
              label="Sync lock wallpaper"
              checked={wallpaper.syncLock}
              onChange={(syncLock) =>
                setWallpaper(syncLock ? { syncLock, lockId: wallpaper.desktopId } : { syncLock })
              }
            />
          }
        />
      </Section>
    </>
  );
}

/* ---- lock screen ------------------------------------------------------- */

export function LockScreenPage() {
  const { lock, setLock } = useShellStore();
  const {
    standbyEnabled,
    setStandbyEnabled,
    standbyIdleMinutes,
    setStandbyIdleMinutes,
    standbySleepMinutes,
    setStandbySleepMinutes,
  } = useSystemStore();
  return (
    <>
      <Section title="Lock screen layout">
        <Row
          label="Clock position"
          description="Where the date and time block sits on the lock screen."
          control={
            <Select
              aria-label="Clock position"
              value={lock.clockPosition}
              onChange={(event) => setLock({ clockPosition: event.target.value as typeof lock.clockPosition })}
              options={[
                { value: "top-left", label: "Top left" },
                { value: "top-center", label: "Top centre" },
                { value: "top-right", label: "Top right" },
                { value: "center-left", label: "Middle left" },
                { value: "center", label: "Centre" },
                { value: "center-right", label: "Middle right" },
                { value: "bottom-left", label: "Bottom left" },
                { value: "bottom-center", label: "Bottom centre" },
                { value: "bottom-right", label: "Bottom right" },
              ]}
            />
          }
        />
        <Row
          label="Clock size"
          description="Scales the lock screen date and time."
          control={
            <Slider
              label="Clock size"
              min={0.6}
              max={1.8}
              step={0.05}
              value={lock.clockScale}
              onChange={(clockScale) => setLock({ clockScale })}
              format={(value) => `${Math.round(value * 100)}%`}
            />
          }
        />
        <Row
          label="Clock font"
          description="Family used for the lock screen time and date."
          control={
            <Select
              aria-label="Clock font"
              value={lock.fontId}
              onChange={(event) => setLock({ fontId: event.target.value })}
              options={displayFontOptions.map((font) => ({ value: font.id, label: font.name }))}
            />
          }
        />
        <Row
          label="Background style"
          description="How the wallpaper is treated behind the clock."
          control={
            <Select
              aria-label="Background style"
              value={lock.backgroundStyle}
              onChange={(event) => setLock({ backgroundStyle: event.target.value as typeof lock.backgroundStyle })}
              options={[
                { value: "wallpaper", label: "Wallpaper" },
                { value: "blur", label: "Blurred wallpaper" },
                { value: "dark", label: "Deeply dimmed" },
                { value: "solid", label: "Solid theme colour" },
              ]}
            />
          }
        />
        <Row
          label="Extra dimming"
          description="Darkens the lock background further, on top of any wallpaper setting."
          control={
            <Slider
              label="Extra dimming"
              min={0}
              max={0.7}
              step={0.02}
              value={lock.dim}
              onChange={(dim) => setLock({ dim })}
              format={(value) => `${Math.round(value * 100)}%`}
            />
          }
        />
        <Row
          label="Show time"
          control={
            <Switch label="Show time" checked={lock.showTime} onChange={(showTime) => setLock({ showTime })} />
          }
        />
        <Row
          label="Show date"
          description="Displays the full weekday and date above the clock."
          control={
            <Switch label="Show date" checked={lock.showDate} onChange={(showDate) => setLock({ showDate })} />
          }
        />
        <Row
          label="Clock style"
          control={
            <Segmented
              label="Clock style"
              value={lock.clockStyle}
              onChange={(clockStyle) => setLock({ clockStyle })}
              options={[
                { value: "large", label: "Large" },
                { value: "compact", label: "Compact" },
              ]}
            />
          }
        />
        <Row
          label="Show seconds"
          control={
            <Switch
              label="Show seconds"
              checked={lock.showSeconds}
              onChange={(showSeconds) => setLock({ showSeconds })}
            />
          }
        />
        <Row
          label="Show avatar"
          control={
            <Switch
              label="Show avatar"
              checked={lock.showAvatar}
              onChange={(showAvatar) => setLock({ showAvatar })}
            />
          }
        />
        <Row
          label="Show user name"
          control={
            <Switch
              label="Show user name"
              checked={lock.showUsername}
              onChange={(showUsername) => setLock({ showUsername })}
            />
          }
        />
        <Row
          label="Show power controls"
          description="Sleep, Restart and Shut Down buttons at the bottom of the lock screen."
          control={
            <Switch
              label="Show power controls"
              checked={lock.showPowerButtons}
              onChange={(showPowerButtons) => setLock({ showPowerButtons })}
            />
          }
        />
        <Row
          label="Blur wallpaper"
          description="Applies a depth blur to the lock screen background."
          control={
            <Switch
              label="Blur wallpaper"
              checked={lock.blurWallpaper}
              onChange={(blurWallpaper) => setLock({ blurWallpaper })}
            />
          }
        />
        <Row
          label="Message"
          description="An optional line shown under the clock."
          stacked
        >
          <TextInput
            value={lock.message}
            placeholder="Nothing set"
            onChange={(event) => setLock({ message: event.target.value })}
          />
        </Row>
      </Section>

      <Section
        title="Standby"
        description="An always-on display: after a spell without input the desk fades to a large clock, and after another spell the screen goes dark. Any pointer movement, wheel tick or key wakes it instantly, with every window exactly where it was."
      >
        <Row
          label="Always-on display"
          description="On by default. The clock uses the same face and 12/24-hour choice as the lock screen, and follows the active theme."
          control={
            <Switch
              label="Always-on display"
              checked={standbyEnabled}
              onChange={setStandbyEnabled}
            />
          }
        />
        <Row
          label="Enter standby after"
          description="Minutes without keyboard, pointer or scroll input before the clock appears."
          control={
            <Select
              aria-label="Enter standby after"
              value={String(standbyIdleMinutes)}
              onChange={(event) => setStandbyIdleMinutes(Number(event.target.value))}
              options={[1, 2, 5, 10, 15, 30, 60].map((minutes) => ({
                value: String(minutes),
                label: minutes === 1 ? "1 minute" : `${minutes} minutes`,
              }))}
            />
          }
        />
        <Row
          label="Sleep after"
          description="Minutes on the standby clock before the screen goes dark. Waking is the same gesture, and the desk returns where it was."
          control={
            <Select
              aria-label="Sleep after"
              value={String(standbySleepMinutes)}
              onChange={(event) => setStandbySleepMinutes(Number(event.target.value))}
              options={[
                { value: "0", label: "Never" },
                ...[5, 10, 15, 30, 60].map((minutes) => ({
                  value: String(minutes),
                  label: `${minutes} minutes`,
                })),
              ]}
            />
          }
        />
      </Section>
    </>
  );
}

/* ---- icons ------------------------------------------------------------- */

export function IconsPage() {
  const { iconPackId, setIconPack, customIconPacks, saveIconPack, removeIconPack } =
    useAppearanceStore();
  const [error, setError] = useState<string | null>(null);

  // Real catalogue ids: the preview shows the pack applied to the applications
  // the shell actually ships.
  const sample = ["drive", "browser", "terminal", "library", "music", "settings"];

  const importPack = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<IconPack>;
      if (!parsed || typeof parsed !== "object" || typeof parsed.mapping !== "object") {
        setError("Icon packs need a name and a mapping of application id to image URL.");
        return;
      }
      const pack: IconPack = {
        id: createId("icons"),
        name: parsed.name?.trim() || file.name.replace(/\.json$/i, ""),
        mapping: Object.fromEntries(
          Object.entries(parsed.mapping ?? {}).filter(
            ([, value]) => typeof value === "string" && value.length > 0,
          ),
        ),
        createdAt: Date.now(),
      };
      saveIconPack(pack);
      setIconPack(pack.id);
      setError(null);
    } catch {
      setError("That file could not be read as JSON.");
    }
  };

  return (
    <>
      <Section
        title="Icon pack"
        description="Application icons. Missing entries fall back to the CrystalOS set, so incomplete packs never break the shell."
      >
        <Row
          label="Active pack"
          control={
            <Select
              aria-label="Icon pack"
              value={iconPackId}
              onChange={(event) => setIconPack(event.target.value)}
              options={[
                { value: "crescent", label: "CrystalOS (default)" },
                ...customIconPacks.map((pack) => ({ value: pack.id, label: pack.name })),
              ]}
            />
          }
        />
        <div className="cr-icon-preview">
          {sample.map((appId) => {
            const meta = metaFor(appId);
            return (
              <div key={appId} className="cr-icon-preview__item">
                <span className="cr-icon-preview__tile">
                  <AppIcon appId={appId} name={meta?.icon ?? "question"} size={26} />
                </span>
                <span className="cr-icon-preview__label">{meta?.name ?? appId}</span>
              </div>
            );
          })}
        </div>
        <div className="cr-button-row">
          <label className="cr-btn cr-btn--default">
            <Icon name="upload" size={15} />
            Import icon pack
            <input
              type="file"
              accept="application/json,.json"
              className="cr-visually-hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importPack(file);
                event.target.value = "";
              }}
            />
          </label>
          {customIconPacks.map((pack) => (
            <Badge key={pack.id} tone="accent">
              {pack.name}
              <button
                type="button"
                className="cr-badge__action"
                aria-label={`Remove ${pack.name}`}
                onClick={() => removeIconPack(pack.id)}
              >
                <Icon name="close" size={11} />
              </button>
            </Badge>
          ))}
        </div>
        {error && <p className="cr-field__error">{error}</p>}
        <p className="cr-row__desc">
          Malformed files are rejected before they are stored. Imported packs are kept in this
          browser only.
        </p>
      </Section>

      <Section title="Imported packs">
        {customIconPacks.length === 0 ? (
          <p className="cr-row__desc">
            Nothing imported yet. A pack is a JSON file:{" "}
            <code className="cr-code">{`{ "name": "Pack", "mapping": { "browser": "/icons/browser.svg" } }`}</code>
          </p>
        ) : (
          customIconPacks.map((pack) => (
            <Row
              key={pack.id}
              label={pack.name}
              description={`${Object.keys(pack.mapping).length} mapped applications`}
              control={
                <Button
                  size="sm"
                  variant="danger"
                  icon="trash"
                  onClick={() => removeIconPack(pack.id)}
                >
                  Remove
                </Button>
              }
            />
          ))
        )}
      </Section>
    </>
  );
}
