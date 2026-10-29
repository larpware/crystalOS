import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Modal, Switch } from "@/components/ui";
import { Icon, type IconName } from "@/icons/Icon";
import { notify, openApp } from "@/services/os";
import { bundledManifests } from "@/services/plugins/bundled";
import { permissionLabel, type PluginManifest } from "@/services/plugins/manifest";
import { usePluginStore } from "@/services/plugins/store";
import { useAppearanceStore } from "@/state/appearance";
import { accentOptions, themePresets } from "@/themes/presets";
import type { AppProps, ThemePreset } from "@/types";

/* ==========================================================================
   Crystal Workshop

   The one place to change how CrystalOS looks and to manage what extends it.

   Everything here operates on the same stores Settings uses — the theme
   picker, the accent row and the plugin registry are not copies, so a change
   made here is reflected in Settings and vice versa. Where a capability has a
   deeper home (the wallpaper library, the widget page, the manifest editor in
   Settings), Workshop links to it rather than growing a second, shallower
   version of it.

   Plugins keep their consent step: nothing installs before the permissions
   have been shown, and a removal asks first.
   ========================================================================== */

type Section = "themes" | "plugins" | "wallpapers" | "discover";

const SECTIONS: { id: Section; label: string; icon: IconName }[] = [
  { id: "themes", label: "Themes", icon: "palette" },
  { id: "plugins", label: "Plugins", icon: "layers" },
  { id: "wallpapers", label: "Wallpapers", icon: "image" },
  { id: "discover", label: "Discover", icon: "search" },
];

function isSection(value: unknown): value is Section {
  return typeof value === "string" && SECTIONS.some((section) => section.id === value);
}

/* ---- themes ------------------------------------------------------------ */

function ThemeGrid() {
  const themeId = useAppearanceStore((state) => state.themeId);
  const customThemes = useAppearanceStore((state) => state.customThemes);
  const setTheme = useAppearanceStore((state) => state.setTheme);
  const accentId = useAppearanceStore((state) => state.accentId);
  const setAccent = useAppearanceStore((state) => state.setAccent);

  /* Curated themes first, deprecated ones last and labelled as such; the
     user's own saved themes ride along in the same grid. */
  const presets = useMemo(() => {
    const current = themePresets.filter((theme) => !theme.deprecated);
    const retired = themePresets.filter((theme) => theme.deprecated);
    const custom: ThemePreset[] = customThemes.map((theme) => ({ ...theme }));
    return [...current, ...custom, ...retired];
  }, [customThemes]);

  return (
    <>
      <p className="cr-row__desc">
        A theme is a full set of surfaces, text and borders. Applying one restyles the whole OS
        immediately — the same picker Settings uses, so both always agree.
      </p>

      <div className="cr-workshop__themes">
        {presets.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className="cr-workshop__theme"
            data-active={theme.id === themeId}
            onClick={() => setTheme(theme.id)}
          >
            <span className="cr-workshop__theme-preview" aria-hidden="true">
              <span style={{ background: theme.tokens.bgDesktop }} />
              <span style={{ background: theme.tokens.surface1, borderColor: theme.tokens.borderDefault }} />
              <span style={{ background: theme.tokens.accent }} />
            </span>
            <span className="cr-workshop__theme-name">
              {theme.name}
              {theme.deprecated && <Badge tone="warning">Legacy</Badge>}
              {customThemes.some((entry) => entry.id === theme.id) && <Badge tone="accent">Yours</Badge>}
            </span>
            <span className="cr-row__desc">
              {theme.appearance === "dark" ? "Dark" : "Light"}
              {theme.recommended ? " · recommended" : ""}
            </span>
            {theme.id === themeId && (
              <span className="cr-workshop__theme-active">
                <Icon name="check" size={12} /> Active
              </span>
            )}
          </button>
        ))}
      </div>

      <section className="cr-workshop__block">
        <header>
          <h3>Accent</h3>
          <span className="cr-row__desc">The one colour that runs through buttons, links and focus.</span>
        </header>
        <div className="cr-workshop__accents">
          {accentOptions.map((accent) => (
            <button
              key={accent.id}
              type="button"
              className="cr-workshop__accent"
              data-active={accent.id === accentId}
              title={accent.name}
              aria-label={`Accent ${accent.name}`}
              onClick={() => setAccent(accent.id)}
            >
              <span style={{ background: accent.value }} />
            </button>
          ))}
        </div>
      </section>

      <div className="cr-workshop__actions">
        <Button icon="sliders" onClick={() => openApp("settings", { args: { page: "appearance" } })}>
          Fine-tune in Settings
        </Button>
        <Button icon="layout" onClick={() => openApp("settings", { args: { page: "icons" } })}>
          Icon packs
        </Button>
        <Button icon="grid" onClick={() => openApp("settings", { args: { page: "widgets" } })}>
          Widgets
        </Button>
      </div>
    </>
  );
}

/* ---- plugins ----------------------------------------------------------- */

function PermissionBadges({ permissions }: { permissions: PluginManifest["permissions"] }) {
  if (permissions.length === 0) {
    return <span className="cr-row__desc">Asks for nothing, so it can do nothing.</span>;
  }
  return (
    <div className="cr-workshop__permissions">
      {permissions.map((permission) => (
        <Badge key={permission}>{permissionLabel(permission)}</Badge>
      ))}
    </div>
  );
}

function PluginsSection() {
  const plugins = usePluginStore((state) => state.plugins);
  const setEnabled = usePluginStore((state) => state.setEnabled);
  const remove = usePluginStore((state) => state.remove);
  const install = usePluginStore((state) => state.install);

  const [staged, setStaged] = useState<PluginManifest | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const available = bundledManifests.filter(
    (manifest) => !plugins.some((installed) => installed.id === manifest.id),
  );

  const doInstall = () => {
    if (!staged) return;
    const result = install(staged);
    if (result.ok) {
      notify({ title: "Crystal Workshop", body: `${staged.name} installed and enabled.` });
      setStaged(null);
    } else {
      notify({ title: "Crystal Workshop", body: result.message });
    }
  };

  return (
    <>
      <p className="cr-row__desc">
        Plugins are manifests, not code: each one declares the commands it adds and the permissions
        it needs, and the runtime refuses anything outside that declaration.
      </p>

      <section className="cr-workshop__block">
        <header>
          <h3>Installed ({plugins.length})</h3>
        </header>
        {plugins.length === 0 ? (
          <EmptyState
            icon="layers"
            title="No plugins installed"
            hint="The two bundled plugins are listed below — install one after reading its permissions."
          />
        ) : (
          <ul className="cr-workshop__plugin-list">
            {plugins.map((plugin) => (
              <li key={plugin.id} className="cr-workshop__plugin" data-disabled={!plugin.enabled}>
                <div className="cr-workshop__plugin-head">
                  <strong>{plugin.name}</strong>
                  <span className="cr-row__desc">
                    v{plugin.version}
                    {plugin.author ? ` · ${plugin.author}` : ""}
                  </span>
                  <span className="cr-workshop__plugin-spacer" />
                  <Switch
                    label={`Enable ${plugin.name}`}
                    checked={plugin.enabled}
                    onChange={(checked) => setEnabled(plugin.id, checked)}
                  />
                  {confirming === plugin.id ? (
                    <>
                      <Button size="sm" variant="danger" onClick={() => {
                        remove(plugin.id);
                        setConfirming(null);
                        notify({ title: "Crystal Workshop", body: `${plugin.name} removed.` });
                      }}>
                        Confirm removal
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" icon="trash" onClick={() => setConfirming(plugin.id)}>
                      Remove
                    </Button>
                  )}
                </div>
                {plugin.description && <p className="cr-row__desc">{plugin.description}</p>}
                <PermissionBadges permissions={plugin.permissions} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cr-workshop__block">
        <header>
          <h3>Available</h3>
          <span className="cr-row__desc">Bundled with CrystalOS — no download, no account.</span>
        </header>
        {available.length === 0 ? (
          <p className="cr-row__desc">Everything bundled is already installed.</p>
        ) : (
          <ul className="cr-workshop__plugin-list">
            {available.map((manifest) => (
              <li key={manifest.id} className="cr-workshop__plugin">
                <div className="cr-workshop__plugin-head">
                  <strong>{manifest.name}</strong>
                  <span className="cr-row__desc">
                    v{manifest.version}
                    {manifest.author ? ` · ${manifest.author}` : ""}
                  </span>
                  <span className="cr-workshop__plugin-spacer" />
                  <Button size="sm" variant="primary" icon="download" onClick={() => setStaged(manifest)}>
                    Review &amp; install
                  </Button>
                </div>
                {manifest.description && <p className="cr-row__desc">{manifest.description}</p>}
                <PermissionBadges permissions={manifest.permissions} />
              </li>
            ))}
          </ul>
        )}
        <div className="cr-workshop__actions">
          <Button icon="code" onClick={() => openApp("settings", { args: { page: "plugins" } })}>
            Edit a manifest in Settings
          </Button>
        </div>
      </section>

      <Modal open={Boolean(staged)} title="Install plugin" onClose={() => setStaged(null)}>
        {staged && (
          <>
            <div className="cr-workshop__consent">
              <strong>{staged.name}</strong>
              <span className="cr-row__desc">
                v{staged.version}
                {staged.author ? ` · ${staged.author}` : ""}
              </span>
              {staged.description && <p className="cr-row__desc">{staged.description}</p>}
              <p className="cr-row__desc">
                Installing adds {staged.commands.length} command
                {staged.commands.length === 1 ? "" : "s"} to the palette. It is asking to be allowed
                to:
              </p>
              <PermissionBadges permissions={staged.permissions} />
              <ul className="cr-workshop__commands">
                {staged.commands.map((command) => (
                  <li key={command.id}>
                    <strong>{command.name}</strong>
                    {command.description ? ` — ${command.description}` : ""}
                  </li>
                ))}
              </ul>
            </div>
            <div className="cr-button-row">
              <Button variant="primary" icon="download" onClick={doInstall}>
                Install
              </Button>
              <Button variant="ghost" onClick={() => setStaged(null)}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

/* ---- wallpapers -------------------------------------------------------- */

function WallpapersSection() {
  const wallpaper = useAppearanceStore((state) => state.wallpaper);
  const live = useAppearanceStore((state) => state.live);

  return (
    <>
      <p className="cr-row__desc">
        The wallpaper library holds the built-in sets, your imported images and the live scenes.
        Workshop shows what is active; the library is where you browse and change it.
      </p>

      <section className="cr-workshop__block">
        <header>
          <h3>Active</h3>
        </header>
        <dl className="cr-workshop__facts">
          <div>
            <dt>Desktop</dt>
            <dd className="cr-code">{wallpaper.desktopId || "(theme default)"}</dd>
          </div>
          <div>
            <dt>Lock screen</dt>
            <dd className="cr-code">{wallpaper.lockId || "(same as desktop)"}</dd>
          </div>
          <div>
            <dt>Dim</dt>
            <dd>{Math.round(wallpaper.dim * 100)}%</dd>
          </div>
          <div>
            <dt>Blur</dt>
            <dd>{Math.round(wallpaper.blur * 100)}%</dd>
          </div>
          <div>
            <dt>Live scene</dt>
            <dd>{live.enabled ? live.scene : "off"}</dd>
          </div>
        </dl>
        <div className="cr-workshop__actions">
          <Button variant="primary" icon="image" onClick={() => openApp("wallpaper")}>
            Open Wallpaper Library
          </Button>
        </div>
      </section>
    </>
  );
}

/* ---- discover ---------------------------------------------------------- */

function DiscoverSection() {
  return (
    <>
      <p className="cr-row__desc">
        Creations travel through the community: someone publishes a theme or a plugin, it is listed
        in the Store, and its discussion lives with the rest of Crystal Community.
      </p>

      <ul className="cr-workshop__links">
        <li>
          <button type="button" onClick={() => openApp("store")}>
            <Icon name="store" size={16} />
            <span>
              <strong>CrystalOS Store</strong>
              <span className="cr-row__desc">Browse and install optional apps and extensions</span>
            </span>
          </button>
        </li>
        <li>
          <button type="button" onClick={() => openApp("social")}>
            <Icon name="users" size={16} />
            <span>
              <strong>Crystal Community</strong>
              <span className="cr-row__desc">Show off setups, follow creators, ask for help</span>
            </span>
          </button>
        </li>
        <li>
          <button type="button" onClick={() => openApp("social", { args: { compose: "questions" } })}>
            <Icon name="question" size={16} />
            <span>
              <strong>Ask about a mod</strong>
              <span className="cr-row__desc">Opens the composer with the Questions topic selected</span>
            </span>
          </button>
        </li>
        <li>
          <button type="button" onClick={() => openApp("settings", { args: { page: "appearance" } })}>
            <Icon name="palette" size={16} />
            <span>
              <strong>Advanced appearance</strong>
              <span className="cr-row__desc">Custom themes, fonts, density and per-region theming</span>
            </span>
          </button>
        </li>
      </ul>
    </>
  );
}

/* ---- shell ------------------------------------------------------------- */

export function Workshop({ args }: AppProps) {
  const [section, setSection] = useState<Section>(isSection(args?.section) ? args.section : "themes");

  const titles: Record<Section, string> = {
    themes: "Themes",
    plugins: "Plugins",
    wallpapers: "Wallpapers",
    discover: "Discover",
  };

  return (
    <div className="cr-workshop">
      <nav className="cr-workshop__rail" aria-label="Workshop sections">
        <div className="cr-workshop__brand">
          <Icon name="palette" size={15} />
          <span>Workshop</span>
        </div>
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="cr-workshop__rail-item"
            data-active={entry.id === section}
            onClick={() => setSection(entry.id)}
          >
            <Icon name={entry.icon} size={15} />
            <span>{entry.label}</span>
          </button>
        ))}
      </nav>

      <main className="cr-workshop__main">
        <header className="cr-workshop__head">
          <h2>{titles[section]}</h2>
        </header>
        <div className="cr-workshop__content">
          {section === "themes" && <ThemeGrid />}
          {section === "plugins" && <PluginsSection />}
          {section === "wallpapers" && <WallpapersSection />}
          {section === "discover" && <DiscoverSection />}
        </div>
      </main>
    </div>
  );
}

export default Workshop;
