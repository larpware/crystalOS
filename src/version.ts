import type { ReleaseNote, SystemVersion } from "@/types";

/* ==========================================================================
   Version manifest

   A single source of truth for the OS version, the About page and the Update
   Log. Release notes describe what actually shipped in this build.
   ========================================================================== */

export const SYSTEM_VERSION: SystemVersion = {
  version: "1.3.0",
  build: "2026.10.17-crystal.2",
  releaseDate: "2026-10-17",
  codename: "CrystalOS",
};

export const releaseNotes: ReleaseNote[] = [
  {
    version: "1.3.0",
    date: "2026-10-17",
    changed: [
      "The repository no longer carries the two vendored third-party browser extensions — Hoxx VPN Proxy and the Proton VPN extension. Both were reference material for VPN transports CrystalOS speaks directly, neither was imported at runtime, and both were redistributed under licences that do not permit it. What they documented now lives as prose at the top of server/vpn/config.mjs.",
      "The VPN findings documents describe the transports directly instead of quoting request formats recovered from a client that is no longer present. HOXX-VPN-FINDINGS.md now records only why Hoxx is not used and what was removed for licence compliance.",
      "Scratch from that investigation — the .tmp-logs analysis output, the .tmp-undo snapshots and the .tmp-* capture scripts — is deleted and ignored, so analysis output and third-party material cannot be committed again.",
    ],
    fixed: [
      "The VPN findings document still described the account-free provider as the “Hoxx VPN” app and pointed at src/apps/hoxx/HoxxVpn.tsx, which does not exist. Both now name CrystalVPN and src/apps/crystalvpn/CrystalVpn.tsx.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-10-17",
    added: [
      "CrystalVPN — the account-free VPN is now the OS's only VPN, under its own name, with one endpoint model and one set of status surfaces.",
      "Editor's Choice in CrystalOS Games, starting with GTA 5: the full game embedded from playgta5.net and playable in the native player.",
    ],
    changed: [
      "The product is named CrystalOS throughout — boot screen, window chrome, application names, the About page and the installer manifest.",
      "The CrystalOS mark is white on the boot screen and setup rail, so the silhouette reads as cut stone rather than picking up the shell accent.",
    ],
    fixed: [
      "The application registry imported a VPN component under its previous name, which left the shell blank after the rename. The export and every reference now match.",
      "The Pro and Hoxx naming left over from the previous VPN integration is gone from the application catalogue, Settings, Quick Settings and the VPN status copy.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-10-16",
    added: [
      "Frost app surfaces — a setting under Appearance that carries a glass theme's frosted material into the inside of every application, and can be switched off for solid panels.",
      "A depth system shared by every theme: one lit top edge, one shaded bottom edge, one contact shadow and one ambient shadow, published as --lift-1 / --lift-2 and read by controls, cards and chrome alike. Light and dark appearances each get values that suit them rather than one wash used for both.",
      "A concrete radius scale — 4, 7, 11, 15 and 16px plus a pill — so an inner control takes the step below the container it sits in instead of every element rounding on its own.",
      "Window controls that read as physical buttons: a glossy top edge, a shaded base and a contact shadow, with their colour and glyph visible at rest rather than only under the pointer.",
    ],
    changed: [
      "Glass themes now frost the whole window instead of just its frame. Sidebars, rails, toolbars, cards, tables, list items, composers, dialogs, the launcher, quick settings, the notification centre, toasts and widgets all share one material, built from a milky haze over a saturating blur so the frost reads as frost even on a smooth gradient wallpaper, where a blur alone shows nothing.",
      "The top bar, the dock and the window titlebar follow one scale, so the desk moves together instead of a single bar drifting on its own.",
      "The taskbar is smaller — 16px tiles in a 28px strip — and its bar tightens when the browser window holds only part of the screen, while the artwork keeps the size you chose.",
      "Settings section headers are sentence case with a hairline rule rather than a stack of identical uppercase labels, and the active page is marked with an accent pill instead of a bar.",
      "Buttons, fields, switches, segmented controls, chips and cards were re-lit from the same model: the field is the one control pressed into the surface, and the switch thumb now casts onto its track.",
    ],
    fixed: [
      "Five declarations across Games, Messages, Settings and Wallpaper referenced --accent-muted, a token that does not exist. A selected background, a left border and two focus rings were being dropped silently; they all render now.",
      "Window controls could sit dark on dark: their glyphs were painted near-black and hidden until hover, and an unfocused window dropped the dot to a dark surface.",
    ],
    known: [
      "`npm run lint` fails: the project has no eslint configuration file, so ESLint 9 has nothing to read.",
    ],
  },
  {
    version: "1.0.1",
    date: "2026-10-15",
    added: [
      "Ivy theme — a deep forest-green palette with one tonal step between panels and a single restrained green accent.",
      "Accent colour picker: any colour can be the accent, with hover, muted and on-muted variants derived from it.",
      "Boot screen that reports real start-up work (theme, profile, session) instead of an animation on a timer.",
      "QMovies — the movie app, running the local QMovies project (C:\\Projects\\qmovies) in a window of its own.",
      "Credits page: every third-party work, what it does, its licence and where it came from.",
      "Twelve new photographic wallpapers and ten new gradients, and every built-in theme now names its own default wallpaper.",
    ],
    changed: [
      "Every proxied window carries its own proxy on/off button in the toolbar, the same control the Browser already had: one application can be switched independently of the OS-wide switch, and the choice is remembered.",
      "A proxied application can ask to be loaded directly instead, which is how QMovies runs the local project: its router, cookies and playback are untouched by the proxy. The proxy stays one click away in that window's toolbar, and applications without an override of their own keep following the OS-wide switch.",
      "Reduce transparency now does something: it drops the backdrop filters and composites each theme material into an opaque colour.",
      "The lock screen identity block is built from the theme instead of a hard-coded dark card, so it is legible on light themes too.",
      "Taskbar hover is restrained — a small lift, no overshoot and no looping pulse.",
      "The desktop no longer waits indefinitely for the account server: the session check has a four-second deadline.",
    ],
    fixed: [
      "Maximized windows were measured from the raw viewport rather than the zoomed desktop, so above 100% UI scale a maximized window was larger than the screen and its title bar left the viewport.",
      "Proxied applications reported “Nothing loaded” for pages that had in fact loaded, because readiness depended on a single frame load event heavy sites never raise.",
      "The application catalogue and the application registry imported each other, which could evaluate the registry before the catalogue existed and blank the desktop.",
    ],
    known: [
      "`npm run lint` fails: the project has no eslint configuration file, so ESLint 9 has nothing to read.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-08",
    added: [
      "Desktop shell with top panel, dock, launcher and notification centre.",
      "Window manager with dragging, eight resize handles, edge and corner snapping, maximise and minimise.",
      "Wallpaper Library with photographic, gradient and procedural live wallpapers, plus local imports.",
      "Settings with twenty sections and search across every page.",
      "Files, Terminal, Trash, Notes, Calculator, Browser, Games, Game Library, Music, Media, Store, Update Log and Messages applications.",
      "Theme engine with eight built-in themes, six accents and user-authored custom themes.",
      "Widget layer that starts empty — widgets are opt-in from Settings.",
      "First-run setup with device type, performance profile and theme selection.",
      "Google-class icon set authored for CrystalOS on a single 24px grid.",
    ],
    changed: [
      "Refresh-rate reporting replaces frame-rate counters: the OS measures display timing instead of guessing a frame rate.",
      "Notifications distinguish Do Not Disturb from a manual hide.",
      "The Games catalogue was ported from the original sndgames project and re-skinned for CrystalOS.",
    ],
    fixed: [
      "Embedded frames no longer capture the pointer during window drags and resizes.",
      "Window geometry is clamped to the work area so windows cannot be dragged out of reach.",
    ],
    known: [
      "Messaging uses a local transport: sessions in the same browser profile can talk to each other, but reaching another machine needs a relay (Settings → Messaging explains what to deploy).",
      "Proxied browsing requires the bundled proxy server (`npm run proxy`); without it the browser falls back to direct framing.",
      "Calls use public STUN only. Networks that require TURN relay will not connect.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-09-21",
    added: [
      "Theme token architecture and the first five themes.",
      "Filesystem service with virtual paths and trash.",
      "Terminal with a structured command parser.",
    ],
    changed: ["Moved from a single global store to one store per domain."],
    fixed: ["Corrupt or unavailable local storage now degrades to in-memory state instead of failing to boot."],
  },
  {
    version: "0.8.0",
    date: "2026-09-04",
    added: [
      "Initial shell: wallpaper layer, panel, dock and a single resizable window.",
      "Application registry with declarative metadata.",
    ],
    known: ["Windows could be dragged off-screen."],
  },
];

export const aboutBuild = {
  runtime: "Browser (ES2022 build)",
  renderer: "React 19",
  bundler: "Vite",
  state: "Zustand stores, one per domain",
  persistence: "localStorage for settings, IndexedDB for files and wallpapers",
};

/* ==========================================================================
   Credits

   Everything in this build that someone else made, what it is used for, and
   the licence it is used under. Licences were read from the published package
   metadata or the project's own repository at the time of writing; where a
   licence could not be verified it says so instead of guessing.

   `bundled` marks work that ships inside what the browser downloads. The rest
   is used while the project is built or developed and is not redistributed.
   ========================================================================== */

export interface CreditEntry {
  name: string;
  role: string;
  licence: string;
  url?: string;
  bundled?: boolean;
  group: "Interface and runtime" | "Build and tooling" | "Browsing proxy" | "Artwork and content" | "Development guidance";
}

export const credits: CreditEntry[] = [
  {
    name: "React",
    role: "Interface runtime for every window, panel and application.",
    licence: "MIT",
    url: "https://react.dev",
    bundled: true,
    group: "Interface and runtime",
  },
  {
    name: "React DOM",
    role: "Renders the React tree into the document.",
    licence: "MIT",
    url: "https://react.dev",
    bundled: true,
    group: "Interface and runtime",
  },
  {
    name: "Zustand",
    role: "State management — one store per domain (appearance, windows, shell, filesystem…).",
    licence: "MIT",
    url: "https://github.com/pmndrs/zustand",
    bundled: true,
    group: "Interface and runtime",
  },
  {
    name: "Vite",
    role: "Development server and production bundler.",
    licence: "MIT",
    url: "https://vite.dev",
    group: "Build and tooling",
  },
  {
    name: "TypeScript",
    role: "Type checking across the whole project (`npm run typecheck`).",
    licence: "Apache-2.0",
    url: "https://www.typescriptlang.org",
    group: "Build and tooling",
  },
  {
    name: "ESLint",
    role: "Linting (`npm run lint`).",
    licence: "MIT",
    url: "https://eslint.org",
    group: "Build and tooling",
  },
  {
    name: "@vitejs/plugin-react",
    role: "React fast-refresh and JSX transform for Vite.",
    licence: "MIT",
    url: "https://github.com/vitejs/vite-plugin-react",
    group: "Build and tooling",
  },
  {
    name: "Scramjet",
    role: "The proxy engine behind CrystalOS Browser and every proxied application: it rewrites and runs proxied pages inside the shell.",
    licence: "AGPL-3.0-only (v2 alpha, the version in use)",
    url: "https://github.com/MercuryWorkshop/scramjet",
    bundled: true,
    group: "Browsing proxy",
  },
  {
    name: "Wisp protocol",
    role: "The transport the proxy service worker speaks to the backend over, including the WebSocket path used for long-lived connections.",
    licence: "Protocol specification: CC-BY-4.0. Implementations vary — the server in this build uses the Mercury Workshop Wisp server.",
    url: "https://github.com/MercuryWorkshop/wisp-protocol",
    bundled: true,
    group: "Browsing proxy",
  },
  {
    name: "@mercuryworkshop/libcurl-transport",
    role: "Optional libcurl-based transport for the proxy backend.",
    licence: "AGPL-3.0-only",
    url: "https://github.com/MercuryWorkshop/libcurl-transport",
    bundled: true,
    group: "Browsing proxy",
  },
  {
    name: "@mercuryworkshop/proxy-bootstrap",
    role: "Serves the client bootstrap script that initialises the proxy inside a frame.",
    licence: "AGPL-3.0-only",
    url: "https://github.com/MercuryWorkshop/scramjet",
    bundled: true,
    group: "Browsing proxy",
  },
  {
    name: "@mercuryworkshop/scramjet-controller and scramjet-utils",
    role: "Controller and helpers used to drive a proxied frame from the shell.",
    licence: "See the Scramjet repository — the controller and utils packages are part of the same project.",
    url: "https://github.com/MercuryWorkshop/scramjet",
    bundled: true,
    group: "Browsing proxy",
  },
  {
    name: "Unsplash",
    role: "Photographic wallpapers. The Wallpaper Library shows images served from the Unsplash image CDN (images.unsplash.com); photographer names are not stored in the wallpaper manifest, so attribution here is to Unsplash as the source.",
    licence: "Unsplash License",
    url: "https://unsplash.com/license",
    bundled: true,
    group: "Artwork and content",
  },
  {
    name: "sndgames-remastered",
    role: "Original source of the CrystalOS Games catalogue (`integrations/sndgames-remastered/games-data.ts`). The catalogue lists third-party game hosts; each game belongs to its publisher, and the original project is unmodified.",
    licence: "No licence declared by the original repository — the catalogue data is reused with the project's permission and is not relicensed here.",
    bundled: true,
    group: "Artwork and content",
  },
  {
    name: "QMovies",
    role: "The movie site the QMovies window loads, from this project's own QMovies workspace (local dev server). Scaffolded with Lovable and built on TanStack Start; its catalogue is TMDb and OMDb data and its player is a vidsrc.sbs embed.",
    licence: "This project's own work — the data, images and embeds below remain their providers'",
    url: "https://qmovies.lovable.app",
    group: "Artwork and content",
  },
  {
    name: "TMDb",
    role: "Film and series metadata and artwork used by QMovies. Required attribution: “This product uses the TMDB API but is not endorsed or certified by TMDB.”",
    licence: "TMDB API terms of use",
    url: "https://www.themoviedb.org/documentation/api/terms-of-use",
    group: "Artwork and content",
  },
  {
    name: "OMDb API",
    role: "Additional title and season data used by QMovies.",
    licence: "OMDb API terms (CC BY-NC 4.0 data, with an API key)",
    url: "https://www.omdbapi.com/",
    group: "Artwork and content",
  },
  {
    name: "vidsrc.sbs",
    role: "Third-party video embed used by QMovies for playback. It is a third-party service: its availability, advertising and content are not controlled by this project.",
    licence: "Third-party embed service — no licence granted, used at the site operator's discretion",
    url: "https://vidsrc.sbs/",
    group: "Artwork and content",
  },
  {
    name: "Proxied third-party sites",
    role: "CrystalOS Browser, Drive, Discord, Spotify and Audiomack load the real sites through the proxy. Their content, brands, accounts and terms belong to their owners; CrystalOS only provides the window and the transport.",
    licence: "Each site's own terms of service",
    bundled: false,
    group: "Artwork and content",
  },
  {
    name: "System fonts",
    role: "No font files are bundled or downloaded. Every typography option is a font stack resolved against families the host system already has, so the OS renders immediately and ships no font licence obligations.",
    licence: "Not applicable — no font binaries are distributed",
    bundled: false,
    group: "Artwork and content",
  },
  {
    name: "CrystalOS icon set and brand mark",
    role: "Authored for this project on a single 24px grid (see `src/icons/icons.tsx` and `src/shell/CrystalOSMark.tsx`). No third-party icon library is used.",
    licence: "Part of this project",
    bundled: true,
    group: "Artwork and content",
  },
  {
    name: "Design guidance skills",
    role: "The `.agents/skills` set used while designing and reviewing the interface (brandkit, design-taste, high-end visual design and others). Development-time only — nothing from them is shipped.",
    licence: "Upstream skill repository: Leonxlnx/taste-skill — see `.agents/skills/skills-lock.json` for the exact source and hashes",
    bundled: false,
    group: "Development guidance",
  },
];

/** Flat view used by the About page. */
export const acknowledgements: { name: string; note: string; licence: string }[] = credits.map(
  (entry) => ({ name: entry.name, note: entry.role, licence: entry.licence }),
);

export const creditGroups: CreditEntry["group"][] = [
  "Interface and runtime",
  "Build and tooling",
  "Browsing proxy",
  "Artwork and content",
  "Development guidance",
];
