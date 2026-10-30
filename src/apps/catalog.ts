import type { AppCapability, AppCategory } from "@/types";
import type { IconName } from "@/icons/icons";
import { useAppsStore } from "@/state/apps";

/* ==========================================================================
   Application catalogue

   Metadata only — no React imports — so the launcher, store, dock and the
   `openApp` service can all read it without pulling in application code.
   Components are attached in `registry.tsx`.

   `system: true` means the application ships with CrystalOS and always
   exists in this build: it never appears in the Store as something to install
   or remove. Applications without the flag are bundled but optional, and those
   are the ones the Store manages.
   ========================================================================== */

export interface AppMeta {
  id: string;
  name: string;
  summary: string;
  icon: IconName;
  category: AppCategory;
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  resizable?: boolean;
  /** Reuse a single window instead of allowing several instances. */
  singleton?: boolean;
  /** Show in the dock by default for new profiles. */
  pinnedByDefault?: boolean;
  /** Ships with the OS; cannot be removed and is not listed in the Store. */
  system?: boolean;
  /** Bundled but optional: the Store can disable and re-enable it. */
  optional?: boolean;
  capabilities?: AppCapability[];
  version: string;
  /** Feature bullets used by the store detail view. */
  features: string[];
  /** Set to true for user-installed community apps */
  isCommunity?: boolean;
  /** Custom icon URL for community applications */
  iconUrl?: string | null;
}

export const appCatalog: AppMeta[] = [
  {
    id: "browser",
    name: "CrystalOS Browser",
    summary: "Tabbed browsing where every tab is proxied by Scramjet.",
    icon: "browser",
    category: "internet",
    defaultSize: { width: 1080, height: 720 },
    minSize: { width: 480, height: 380 },
    pinnedByDefault: true,
    system: true,
    capabilities: ["network", "storage"],
    version: "2.0.0",
    features: [
      "Each tab owns a Scramjet frame with its own history",
      "Bookmarks, history and download records",
      "Per-tab proxied navigation through the shared proxy service",
      "Honest failure states when the proxy or a site refuses to load",
    ],
  },
  {
    id: "crystalvpn",
    name: "CrystalVPN",
    summary: "One-click, account-free VPN — the CrystalOS Browser uses it by default.",
    icon: "shield",
    category: "internet",
    defaultSize: { width: 760, height: 680 },
    minSize: { width: 460, height: 440 },
    singleton: true,
    system: true,
    capabilities: ["network"],
    version: "1.0.0",
    features: [
      "Quick connect finds a working public proxy automatically — no host, port or account to enter",
      "Connects through a proxy endpoint you name, when you would rather choose one",
      "Tests the endpoint with a real CONNECT before connecting, instead of fetching a server list",
      "Protects the Scramjet/Wisp traffic path, and blocks it rather than leaking when it cannot",
      "States which traffic paths are protected and which are not, path by path",
    ],
  },
  {
    id: "drive",
    name: "Drive",
    summary: "Google Drive through the Scramjet proxy, in a CrystalOS window.",
    icon: "drive",
    category: "internet",
    defaultSize: { width: 1080, height: 720 },
    minSize: { width: 480, height: 400 },
    pinnedByDefault: true,
    system: true,
    capabilities: ["network"],
    version: "1.0.0",
    features: [
      "Loads the real drive.google.com through Scramjet",
      "Sign-in and file handling stay on Google's own pages",
      "Navigation and loading state reported by the proxy",
    ],
  },
  {
    id: "discord",
    name: "Discord",
    summary: "Discord in a CrystalOS window, proxied by Scramjet.",
    icon: "discord",
    category: "internet",
    defaultSize: { width: 1080, height: 720 },
    minSize: { width: 480, height: 400 },
    pinnedByDefault: true,
    optional: true,
    capabilities: ["network"],
    version: "1.0.0",
    features: [
      "Loads discord.com/app through the shared Scramjet service",
      "Sign-in, servers and messages are handled by Discord",
      "Navigation and loading state reported by the proxy",
    ],
  },
  {
    id: "spotify",
    name: "Spotify",
    summary: "The Spotify web player, proxied by Scramjet.",
    icon: "spotify",
    category: "media",
    defaultSize: { width: 1080, height: 720 },
    minSize: { width: 480, height: 400 },
    pinnedByDefault: true,
    optional: true,
    capabilities: ["network"],
    version: "1.0.0",
    features: [
      "Loads open.spotify.com through the shared Scramjet service",
      "Playback and account state are Spotify's own",
    ],
  },
  {
    id: "audiomack",
    name: "Audiomack",
    summary: "Audiomack through the Scramjet proxy.",
    icon: "audiomack",
    category: "media",
    defaultSize: { width: 1080, height: 720 },
    minSize: { width: 480, height: 400 },
    pinnedByDefault: true,
    optional: true,
    capabilities: ["network"],
    version: "1.0.0",
    features: [
      "Loads audiomack.com through the shared Scramjet service",
      "Streaming and sign-in are Audiomack's own",
    ],
  },
  {
    id: "qmovies",
    name: "QMovies",
    summary: "A movie and series app: the local QMovies project, in a window of its own.",
    icon: "qmovies",
    category: "media",
    defaultSize: { width: 1160, height: 740 },
    minSize: { width: 520, height: 400 },
    pinnedByDefault: true,
    optional: true,
    capabilities: ["network"],
    version: "1.2.0",
    features: [
      "Runs the local QMovies project from the QMovies workspace on this machine",
      "Loads it directly in this window, or through Scramjet with the toolbar button",
      "Browsing, search and playback are QMovies' own service",
    ],
  },
  {
    id: "messages",
    name: "Chat",
    summary: "Friend codes, direct messages and servers on the local mesh.",
    icon: "messages",
    category: "internet",
    defaultSize: { width: 960, height: 640 },
    minSize: { width: 520, height: 400 },
    pinnedByDefault: true,
    system: true,
    capabilities: ["network", "microphone", "camera", "notifications"],
    version: "1.2.0",
    features: [
      "A stable friend code per account, with copy and lookup",
      "Friend requests with real pending, accepted and duplicate states",
      "Direct messages, groups and servers on the documented local transport",
      "WebRTC voice and video calls with real media streams",
    ],
  },
  {
    id: "music",
    name: "Music",
    summary: "Your own audio files. The library starts empty.",
    icon: "music",
    category: "media",
    defaultSize: { width: 900, height: 600 },
    minSize: { width: 520, height: 400 },
    pinnedByDefault: true,
    system: true,
    capabilities: ["storage"],
    version: "2.0.0",
    features: [
      "Add Music: pick local MP3 files from this device",
      "Queue, seek, shuffle, repeat and volume",
      "Nothing is uploaded; files stay in this browser profile",
    ],
  },
  {
    id: "terminal",
    name: "Crystal Dev",
    summary: "Terminal, projects, local developer tools and the community feed in one workspace.",
    icon: "terminal",
    category: "system",
    defaultSize: { width: 1040, height: 680 },
    minSize: { width: 560, height: 400 },
    pinnedByDefault: true,
    system: true,
    capabilities: ["filesystem", "network"],
    version: "2.0.0",
    features: [
      "Terminal: structured parser with history and tab completion over the virtual filesystem",
      "Projects: browse and edit the files this browser profile stores, with export",
      "Tools: JSON, Base64, URL, hash, timestamp, regex and colour — all computed locally",
      "Community: the CrystalOS feed and a shortcut into Crystal Community",
    ],
  },
  {
    id: "settings",
    name: "Settings",
    summary: "Configure the shell, appearance, applications and system.",
    icon: "settings",
    category: "system",
    defaultSize: { width: 1000, height: 660 },
    minSize: { width: 560, height: 420 },
    pinnedByDefault: true,
    system: true,
    singleton: true,
    version: "2.0.0",
    features: [
      "Sectioned settings with search across every page",
      "Themes, wallpapers, icons, dock, widgets and tab identity",
      "Performance, privacy, accounts and system diagnostics",
    ],
  },
  {
    id: "wallpaper",
    name: "Wallpaper Library",
    summary: "Browse, apply and import wallpapers and live scenes.",
    icon: "wallpaper",
    category: "system",
    defaultSize: { width: 1000, height: 660 },
    minSize: { width: 520, height: 400 },
    system: true,
    singleton: true,
    capabilities: ["storage"],
    version: "1.3.0",
    features: [
      "Built-in photographic and gradient sets",
      "Import images and video wallpapers locally",
      "Live scene controls with quality settings",
    ],
  },
  {
    id: "store",
    name: "CrystalOS Store",
    summary: "Enable or remove the optional applications bundled with the OS.",
    icon: "store",
    category: "utilities",
    defaultSize: { width: 920, height: 620 },
    minSize: { width: 520, height: 400 },
    system: true,
    singleton: true,
    version: "2.0.0",
    features: [
      "Optional applications only — system apps are never listed",
      "Enable and remove optional applications for this profile",
      "Version state read from the real registry",
    ],
  },
  {
    id: "trash",
    name: "Trash",
    summary: "Review deleted files, restore them or empty the trash.",
    icon: "trash",
    category: "system",
    defaultSize: { width: 860, height: 560 },
    minSize: { width: 460, height: 340 },
    system: true,
    singleton: true,
    capabilities: ["filesystem"],
    version: "1.2.0",
    features: ["Restore individual items", "Empty trash with confirmation"],
  },
  {
    /* The former system "CrystalOS Games" app and the optional "Game Library"
       were one catalogue rendered twice; this is the surviving copy, kept as a
       Store application so it can be removed and reinstalled like Discord.
       Every game opens in a player window of its own. */
    id: "library",
    name: "CrystalOS Games",
    summary: "A large browser game catalogue where every game gets its own window.",
    icon: "games",
    category: "games",
    defaultSize: { width: 1080, height: 700 },
    minSize: { width: 560, height: 420 },
    singleton: true,
    optional: true,
    version: "2.0.0",
    features: [
      "Editor's Choice picks, collections and search",
      "Every game opens in a separate player window",
      "Favourites, measured play sessions and per-game profiles",
    ],
  },
  {
    id: "workshop",
    name: "Crystal Workshop",
    summary: "Themes, accents, wallpapers and plugins — the customization and modding home.",
    icon: "palette",
    category: "system",
    defaultSize: { width: 960, height: 660 },
    minSize: { width: 520, height: 400 },
    system: true,
    capabilities: ["storage"],
    version: "1.0.0",
    features: [
      "Apply any theme or accent with one press — the same stores Settings uses",
      "Plugin management with the consent step intact: permissions first, install second",
      "Wallpaper status with a door into the Wallpaper Library",
      "Discover community creations in the Store and Crystal Community",
    ],
  },
  {
    id: "notes",
    name: "Notes",
    summary: "Plain text notes stored in the CrystalOS filesystem.",
    icon: "notes",
    category: "productivity",
    defaultSize: { width: 780, height: 540 },
    minSize: { width: 420, height: 320 },
    optional: true,
    capabilities: ["filesystem"],
    version: "1.1.0",
    features: [
      "Notes are real files in ~/Documents/Notes",
      "Autosave with a change indicator",
      "Open a text file from the desktop straight into Notes",
    ],
  },
  {
    id: "social",
    name: "Crystal Community",
    summary: "The social network for CrystalOS — feed, people, communities and notifications on your account.",
    icon: "users",
    category: "internet",
    defaultSize: { width: 940, height: 660 },
    minSize: { width: 480, height: 380 },
    system: true,
    capabilities: ["network", "storage"],
    version: "1.0.0",
    features: [
      "A unified feed: text posts, images, likes, comments and bookmarks",
      "Following and Discover scopes, filtered by topic — decided by the server, not the client",
      "Communities directory, with membership and roles managed in Chat",
      "Follow people; private accounts approve who follows them",
      "Profiles with followers, join date and privacy",
      "Notifications for likes, comments and follows",
      "Report and block — enforced by the server, not just hidden in the UI",
    ],
  },
  {
    id: "ai",
    name: "Crystal AI",
    summary: "A conversation with a real model, through Puter.js — your Puter account, your usage.",
    icon: "sparkle",
    category: "productivity",
    defaultSize: { width: 980, height: 660 },
    minSize: { width: 520, height: 400 },
    system: true,
    capabilities: ["network", "storage"],
    version: "1.0.0",
    features: [
      "Streaming answers with a stop button that actually stops",
      "Model choice from Puter's own catalogue, including a full list when you ask for it",
      "Markdown answers with copyable code blocks",
      "Conversations, rename and delete — stored on this machine",
      "No API key in CrystalOS: usage is billed to the Puter account you sign in with",
    ],
  },
  {
    id: "media",
    name: "Media",
    summary: "Video and audio player for local files.",
    icon: "media",
    category: "media",
    defaultSize: { width: 920, height: 620 },
    minSize: { width: 480, height: 360 },
    optional: true,
    capabilities: ["storage"],
    version: "1.1.0",
    features: ["Local video playback", "Playlist from recent media", "Keyboard transport controls"],
  },
  {
    id: "calculator",
    name: "Calculator",
    summary: "Keyboard-driven calculator with expression history.",
    icon: "calculator",
    category: "utilities",
    defaultSize: { width: 340, height: 500 },
    minSize: { width: 300, height: 460 },
    resizable: false,
    optional: true,
    version: "1.1.0",
    features: ["Standard and scientific modes", "Session history with reuse"],
  },
  {
    id: "updates",
    name: "Update Log",
    summary: "Release notes for the OS and bundled applications.",
    icon: "updates",
    category: "system",
    defaultSize: { width: 800, height: 620 },
    minSize: { width: 460, height: 360 },
    singleton: true,
    optional: true,
    version: "1.1.0",
    features: ["Expandable release notes from the real version manifest"],
  },
];

export function metaFor(appId: string): AppMeta | undefined {
  const bundled = appCatalog.find((app) => app.id === appId);
  if (bundled) return bundled;

  // Check if it is a community app:
  try {
    const cleanId = appId.replace(/^community:/, "");
    const comm = useAppsStore.getState().getCommunityApp?.(cleanId);
    if (comm) {
      return {
        id: `community:${comm.id}`,
        name: comm.name,
        summary: comm.description,
        icon: "grid",
        category: (comm.category as AppCategory) || "utilities",
        defaultSize: { width: 1024, height: 680 },
        minSize: { width: 440, height: 380 },
        singleton: false,
        version: "1.0.0",
        isCommunity: true,
        iconUrl: comm.iconUrl ?? null,
        features: [
          `Community application submitted by ${comm.developerDisplayName || comm.developerUsername || "developer"}`,
          "Runs securely inside isolated sandboxed iframe",
          `Website domain: ${comm.websiteUrl}`,
        ],
      };
    }
  } catch {
    // During early bootstrap before store initialization
  }

  return undefined;
}

/** Applications the Store manages: bundled, optional, never system apps. */
export function optionalApps(): AppMeta[] {
  return appCatalog.filter((meta) => !meta.system);
}

export function systemApps(): AppMeta[] {
  return appCatalog.filter((meta) => meta.system);
}

/*
 * Note: this module deliberately imports nothing from ./registry. Registry
 * imports the catalogue, so a catalogue that imported registry back would form
 * a cycle — and a cycle like that is only one entry-point reorder away from
 * evaluating the registry before `appCatalog` exists, which is a blank desktop
 * with a ReferenceError in the console. "Which apps are implemented" belongs to
 * the registry, and lives there (`implementedApps`).
 */
