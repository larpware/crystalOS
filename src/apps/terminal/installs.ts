import { appCatalog, metaFor, type AppMeta } from "@/apps/catalog";
import { APP_CATEGORY_LABEL, type AppCapability } from "@/types";

/* ==========================================================================
   CrystalOS terminal — application resolution

   Honest about what "install" means on this OS. CrystalOS is a web OS: its
   applications are web bundles that ship with the build, and the Store's
   "install" is the record that says an optional application is enabled. There
   is no download, no package archive and no native installer here, so the
   commands built on this module never claim otherwise:

     - a name is resolved against the real catalogue, with a small table of
       obvious synonyms (`calc`, `notepad`, `console`);
     - the name, version, source and declared capabilities are printed before
       anything is enabled, because saying what a package is before installing
       it is the one thing a package manager is genuinely for;
     - names that are native desktop programs are refused, with the reason,
       rather than quietly substituting a web app for the program asked for;
     - and there is no progress bar, because enabling an application is a
       synchronous state write. A progress animation over an instant operation
       is theatre, and a cancel button for something that already finished is
       worse than no button at all.
   ========================================================================== */

/**
 * Synonyms for applications that already exist in the catalogue. Only synonyms
 * for the *same* application belong here: `notepad` is another name for the
 * Notes app, but `vlc` is not another name for anything CrystalOS ships, so it
 * stays in `NATIVE_ONLY`.
 */
export const APP_ALIASES: Record<string, string> = {
  calc: "calculator",
  calculator: "calculator",
  notepad: "notes",
  notes: "notes",
  console: "terminal",
  shell: "terminal",
  terminal: "terminal",
  preferences: "settings",
  settings: "settings",
  appstore: "store",
  "app store": "store",
  store: "store",
  chat: "messages",
  messenger: "messages",
  messages: "messages",
  player: "music",
  music: "music",
  podcasts: "audiomack",
  wallpaper: "wallpaper",
  wallpapers: "wallpaper",
  browser: "browser",
  web: "browser",
  vpn: "crystalvpn",
  movies: "qmovies",
  cinejoy: "qmovies",
  updates: "updates",
  trash: "trash",
  recycle: "trash",
  games: "games",
  library: "library",
  discord: "discord",
  spotify: "spotify",
  drive: "drive",
  audiomack: "audiomack",
};

/**
 * Programs the user may reasonably ask for that are native desktop software.
 * CrystalOS cannot install them — it is a web OS — and the honest answer names
 * the program and says so. `closest` names a CrystalOS application that covers
 * some of the same ground; the message is careful never to imply it *is* the
 * program that was asked for.
 */
export const NATIVE_ONLY: Record<string, { label: string; reason: string; closest?: string }> = {
  firefox: {
    label: "Mozilla Firefox",
    reason: "a native desktop browser",
    closest: "browser",
  },
  chrome: { label: "Google Chrome", reason: "a native desktop browser", closest: "browser" },
  "google chrome": { label: "Google Chrome", reason: "a native desktop browser", closest: "browser" },
  chromium: { label: "Chromium", reason: "a native desktop browser", closest: "browser" },
  edge: { label: "Microsoft Edge", reason: "a native desktop browser", closest: "browser" },
  brave: { label: "Brave", reason: "a native desktop browser", closest: "browser" },
  safari: { label: "Safari", reason: "a native desktop browser shipped with macOS" },
  vscode: { label: "Visual Studio Code", reason: "a native desktop code editor" },
  code: { label: "Visual Studio Code", reason: "a native desktop code editor" },
  "visual studio code": { label: "Visual Studio Code", reason: "a native desktop code editor" },
  vlc: { label: "VLC", reason: "a native media player", closest: "media" },
  git: { label: "Git", reason: "a command-line developer tool, not a GUI application" },
  node: { label: "Node.js", reason: "a runtime that installs as system software, not as an app" },
  nodejs: { label: "Node.js", reason: "a runtime that installs as system software, not as an app" },
  python: { label: "Python", reason: "a runtime that installs as system software, not as an app" },
  steam: { label: "Steam", reason: "a native game launcher and store" },
  winrar: { label: "WinRAR", reason: "native Windows software" },
  "7zip": { label: "7-Zip", reason: "native Windows software" },
  office: { label: "Microsoft Office", reason: "native Windows software" },
  word: { label: "Microsoft Word", reason: "native Windows software" },
  excel: { label: "Microsoft Excel", reason: "native Windows software" },
  photoshop: { label: "Adobe Photoshop", reason: "native Windows software" },
};

export type AppResolution =
  | { kind: "app"; meta: AppMeta; matchedBy: "id" | "name" | "alias"; alias?: string }
  | { kind: "native"; token: string; label: string; reason: string; closest?: AppMeta }
  | { kind: "unknown"; token: string };

function fold(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Turns what someone typed into a catalogue entry, a refusal, or nothing.
 * Ids win over names, names win over synonyms, and native programs are checked
 * last so a catalogue app can never be shadowed by the refusal table.
 */
export function resolveApp(token: string): AppResolution {
  const needle = fold(token);
  if (!needle) return { kind: "unknown", token };

  const byId = appCatalog.find((meta) => meta.id === needle);
  if (byId) return { kind: "app", meta: byId, matchedBy: "id" };

  const byName = appCatalog.find((meta) => fold(meta.name) === needle);
  if (byName) return { kind: "app", meta: byName, matchedBy: "name" };

  const aliasTarget = APP_ALIASES[needle];
  if (aliasTarget) {
    const meta = metaFor(aliasTarget);
    if (meta) return { kind: "app", meta, matchedBy: "alias", alias: needle };
  }

  const native = NATIVE_ONLY[needle];
  if (native) {
    return {
      kind: "native",
      token,
      label: native.label,
      reason: native.reason,
      closest: native.closest ? (metaFor(native.closest) ?? undefined) : undefined,
    };
  }

  return { kind: "unknown", token };
}

/** Name matches first, then summary and category, so `search games` is useful. */
export function searchApps(term: string): AppMeta[] {
  const needle = fold(term);
  if (!needle) return [];
  const scored: { meta: AppMeta; score: number }[] = [];
  for (const meta of appCatalog) {
    const name = fold(meta.name);
    const id = fold(meta.id);
    if (name.startsWith(needle) || id === needle) scored.push({ meta, score: 0 });
    else if (name.includes(needle) || id.includes(needle)) scored.push({ meta, score: 1 });
    else if (fold(meta.summary).includes(needle)) scored.push({ meta, score: 2 });
    else if (fold(APP_CATEGORY_LABEL[meta.category]).includes(needle)) scored.push({ meta, score: 3 });
    else if (meta.capabilities?.some((capability) => fold(capability).includes(needle))) {
      scored.push({ meta, score: 4 });
    }
  }
  return scored
    .sort((a, b) => a.score - b.score || a.meta.name.localeCompare(b.meta.name))
    .map((entry) => entry.meta);
}

const CAPABILITY_LABELS: Record<AppCapability, string> = {
  filesystem: "Your files",
  network: "Network access",
  notifications: "Notifications",
  storage: "Local storage",
  microphone: "Microphone",
  camera: "Camera",
};

export function capabilityLabels(meta: AppMeta): string[] {
  return (meta.capabilities ?? []).map((capability) => CAPABILITY_LABELS[capability] ?? capability);
}

/** Where an application comes from. There is only one answer on this OS. */
export function appSource(meta: AppMeta): string {
  return meta.system
    ? "bundled with CrystalOS — a system application, always present"
    : "bundled with CrystalOS — optional, so the Store can disable it";
}

export function isRemovable(meta: AppMeta): boolean {
  return !meta.system;
}

export interface StaleEntry {
  appId: string;
  name: string;
  from: string;
  to: string;
}

/**
 * Installed records whose stored version no longer matches the catalogue. On a
 * web OS the code itself is replaced by the build, so this is about the record
 * agreeing with reality — which is worth doing, and not worth dressing up as a
 * download.
 */
export function staleInstalled(
  installed: { appId: string; version: string }[],
): StaleEntry[] {
  const stale: StaleEntry[] = [];
  for (const entry of installed) {
    const meta = metaFor(entry.appId);
    if (!meta || meta.version === entry.version) continue;
    stale.push({ appId: meta.id, name: meta.name, from: entry.version, to: meta.version });
  }
  return stale;
}
