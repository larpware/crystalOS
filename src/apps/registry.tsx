import type { ComponentType } from "react";
import type { AppDefinition, AppProps } from "@/types";
import { appCatalog, metaFor, type AppMeta } from "./catalog";
import { Drive } from "./drive/Drive";
import { Spotify } from "./spotify/Spotify";
import { Audiomack } from "./audiomack/Audiomack";
import { Dev } from "./dev/Dev";
import { Workshop } from "./workshop/Workshop";
import { Notes } from "./notes/Notes";
import { Calculator } from "./calculator/Calculator";
import { Trash } from "./trash/Trash";
import { Settings } from "./settings/Settings";
import { WallpaperLibrary } from "./wallpaper/WallpaperLibrary";
import { Browser } from "./browser/Browser";
import { CrystalVpn } from "./crystalvpn/CrystalVpn";
import { Games } from "./games/Games";
import { GameLibrary } from "./games/Library";
import { Music } from "./music/Music";
import { Media } from "./media/Media";
import { Store } from "./store/Store";
import { UpdateLog } from "./updates/UpdateLog";
import { Messages } from "./messages/Messages";
import { CrystalAi } from "./ai/CrystalAi";
import { Social } from "./social/Social";
import { Discord } from "./discord/Discord";
import { QMovies } from "./qmovies/QMovies";

/* ==========================================================================
   Application registry

   Applications register themselves here. The window manager resolves
   components through this map and never contains app-specific logic, and the
   shell only needs catalogue metadata to draw the launcher and dock.
   ========================================================================== */

/** Rendered when a catalogue entry has no component attached yet. */
function Unavailable({ appId }: AppProps & { appId?: string }) {
  return (
    <div className="cr-crash">
      <div className="cr-crash__title">Application not installed</div>
      <p className="cr-empty__hint">
        {appId ?? "This application"} is listed in the catalogue but its bundle is missing from this
        build. Reinstall it from the CrystalOS Store.
      </p>
    </div>
  );
}

const components: Record<string, ComponentType<AppProps>> = {
  drive: Drive,
  spotify: Spotify,
  audiomack: Audiomack,
  /* Crystal Dev is the shell; the terminal itself is one of its panes, so the
     `terminal` id keeps resolving — saved windows, dock pins and the shell's
     own `open terminal` command all still work. */
  terminal: Dev,
  workshop: Workshop,
  notes: Notes,
  calculator: Calculator,
  trash: Trash,
  settings: Settings,
  wallpaper: WallpaperLibrary,
  browser: Browser,
  crystalvpn: CrystalVpn,
  games: Games,
  library: GameLibrary,
  music: Music,
  media: Media,
  store: Store,
  updates: UpdateLog,
  messages: Messages,
  ai: CrystalAi,
  social: Social,
  discord: Discord,
  qmovies: QMovies,
};

export function getAppComponent(appId: string): ComponentType<AppProps> | null {
  return components[appId] ?? null;
}

/** Component IDs present in this build but absent from the application catalogue,
    i.e. not shown on the homepage/launcher or in the Store. */
export function unlistedComponentIds(): string[] {
  const catalogIds = new Set(appCatalog.map((meta) => meta.id));
  return Object.keys(components).filter((id) => !catalogIds.has(id));
}

/** True when a catalogue entry actually has an implementation in this build. */
export function isImplemented(appId: string): boolean {
  return appId in components;
}

/** Applications that currently have a real component in this build. */
export function implementedApps(): AppMeta[] {
  return appCatalog.filter((meta) => isImplemented(meta.id));
}

export const appRegistry: AppDefinition[] = appCatalog.map((meta: AppMeta): AppDefinition => {
  const component = components[meta.id];
  return {
    id: meta.id,
    name: meta.name,
    summary: meta.summary,
    icon: meta.icon,
    category: meta.category,
    defaultSize: meta.defaultSize,
    minSize: meta.minSize,
    resizable: meta.resizable,
    system: meta.system,
    capabilities: meta.capabilities,
    component:
      component ??
      ((props: AppProps) => <Unavailable {...props} appId={metaFor(meta.id)?.name ?? meta.id} />),
  };
});

export function getApp(appId: string): AppDefinition | undefined {
  return appRegistry.find((app) => app.id === appId);
}

export function appsByCategory(): Map<string, AppDefinition[]> {
  const map = new Map<string, AppDefinition[]>();
  for (const app of appRegistry) {
    const list = map.get(app.category) ?? [];
    list.push(app);
    map.set(app.category, list);
  }
  return map;
}
