import { games as portedGames, type Game as PortedGame } from "../../../integrations/sndgames-remastered/games-data";

/* ==========================================================================
   CrystalOS Games catalogue

   The raw list is ported from sndgames-remastered. Everything below turns it
   into CrystalOS metadata: a stable id, a readable category, a search index and
   a thumbnail that degrades to a generated tile when a host has no cover.

   Nothing here invents data. Where a host provides no cover art, the tile falls
   back to a deterministic colour derived from the game's own name.
   ========================================================================== */

export interface CrystalOSGame {
  id: string;
  title: string;
  url: string;
  category: GameCategory;
  /** A second, broader grouping used by the library. */
  collection: string;
  host: string;
  /** Cover art, when the host publishes one or the app ships its own. */
  cover: string | null;
  addedIndex: number;
  /** Hand-picked by the catalogue editors and labelled as such in the UI. */
  editorsChoice?: boolean;
  /**
   * A game this build ships and runs itself, on a canvas in the player frame.
   * Built-ins need no host, no network and no embed permission, so they are
   * the games that still play with the proxy off.
   */
  builtin?: "snake" | "breakout";
}

export type GameCategory =
  | "html"
  | "arcade"
  | "car"
  | "bike"
  | "multiplayer"
  | "io"
  | "od"
  | "atari";

export const categoryLabels: Record<GameCategory, string> = {
  html: "Browser",
  arcade: "Arcade",
  car: "Racing",
  bike: "Motorcycle",
  multiplayer: "Multiplayer",
  io: "IO",
  od: "Classics",
  atari: "Atari",
};

const collectionFor: Record<GameCategory, string> = {
  html: "Instant play",
  arcade: "Arcade classics",
  car: "Racing",
  bike: "Racing",
  multiplayer: "Play with others",
  io: "Play with others",
  od: "Offline friendly",
  atari: "Offline friendly",
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Cover art. Several hosts publish predictable cover URLs, which the original
 * project already relied on; the rest fall back to the hosting site's own icon
 * (a real, per-game-host image) so every tile shows something recognisable
 * instead of a generated letter. When even that image fails to load, the UI
 * degrades to the deterministic generated tile.
 */
function coverFor(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const segments = parsed.pathname.split("/").filter(Boolean);

    if (host.includes("crazygames.com")) {
      const slug = parsed.pathname.split("/embed/")[1];
      if (slug) {
        return `https://images.crazygames.com/games/${slug}/cover-1695108717043.png?auto=format%2Ccompress&q=45&cs=strip&ch=DPR&w=400`;
      }
    }
    if (host.includes("gamedistribution.com")) {
      const hash = segments[0];
      if (hash) return `https://img.gamedistribution.com/${hash}-512x384.jpg`;
    }
    if (host.includes("poki.com")) {
      // Poki embeds look like /en/g/<slug>; their thumbnail CDN is predictable.
      const slug = segments[segments.indexOf("g") + 1];
      if (slug) return `https://img.poki.com/cdn-cgi/image/width=400,height=300,fit=cover/${slug}.webp`;
    }
    if (host.includes("famobi.com") || host === "play.famobi.com") {
      // Famobi serves cover art under its own asset host, keyed by game slug.
      const slug = segments[segments.length - 1];
      if (slug) return `https://www.famobi.com/img/games/${slug}.jpg`;
    }
    if (host.includes("onlinegames.io")) {
      // onlinegames.io stores one thumbnail per game folder.
      const folder = segments[segments.length - 2];
      if (folder) return `https://www.onlinegames.io/media/posts/thumb/${folder}.jpg`;
    }

    // Real icon of the hosting site for everything else.
    if (host) return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  } catch {
    return null;
  }
  return null;
}

function isCategory(value: string): value is GameCategory {
  return value in categoryLabels;
}

/**
 * Editor's Choice picks. The hosted page is the game itself; the cover is
 * bundled so the tile never depends on the host's image being reachable.
 */
export const editorsChoiceGames: CrystalOSGame[] = [
  {
    id: "gta-5",
    title: "GTA 5",
    url: "https://playgta5.net/",
    category: "html",
    collection: collectionFor.html,
    host: "playgta5.net",
    cover: "/games/gta5-cover.webp",
    addedIndex: -1,
    editorsChoice: true,
  },
  {
    id: "territorial-io",
    title: "Territorial.io",
    url: "https://territorial.io/",
    category: "io",
    collection: collectionFor.io,
    host: "territorial.io",
    cover: "/games/territorial-cover.png",
    addedIndex: -3,
    editorsChoice: true,
  },
];

export const games: CrystalOSGame[] = (portedGames as PortedGame[])
  .filter((game) => Boolean(game.url) && isCategory(game.category))
  .map((game, index) => {
    const category = game.category as GameCategory;
    return {
      id: slugify(game.title) || `game-${index}`,
      title: game.title,
      url: game.url,
      category,
      collection: collectionFor[category],
      host: hostOf(game.url),
      cover: coverFor(game.url),
      addedIndex: index,
    };
  });

/**
 * Built-in games. They carry an empty url on purpose: launch routes them to
 * the player frame, which renders the shipped component instead of a host.
 */
export const builtinGames: CrystalOSGame[] = [
  {
    id: "crystal-snake",
    title: "Crystal Snake",
    url: "",
    category: "od",
    collection: collectionFor.od,
    host: "CrystalOS built-in",
    cover: null,
    addedIndex: -2,
    builtin: "snake",
  },
  {
    id: "crystal-breakout",
    title: "Crystal Breakout",
    url: "",
    category: "od",
    collection: collectionFor.od,
    host: "CrystalOS built-in",
    cover: null,
    addedIndex: -2,
    builtin: "breakout",
  },
];

games.unshift(...builtinGames);

// Editor's Choice titles sit at the front of the catalogue, in pick order.
games.unshift(...editorsChoiceGames);

/** De-duplicates ids that collide after slugging, keeping both titles. */
const idCounts = new Map<string, number>();
for (const game of games) {
  const seen = idCounts.get(game.id) ?? 0;
  if (seen > 0) game.id = `${game.id}-${seen + 1}`;
  idCounts.set(game.id, seen + 1);
}

export const gameById = new Map(games.map((game) => [game.id, game]));

export const categoryCounts: { id: GameCategory | "all"; label: string; count: number }[] = [
  { id: "all", label: "All games", count: games.length },
  ...(Object.keys(categoryLabels) as GameCategory[])
    .map((category) => ({
      id: category,
      label: categoryLabels[category],
      count: games.filter((game) => game.category === category).length,
    }))
    .filter((entry) => entry.count > 0),
];

export const collections = Array.from(new Set(games.map((game) => game.collection)));

/** Deterministic tile colours for games without cover art. */
export function tilePalette(seed: string): { from: string; to: string; letter: string } {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  const hue = hash;
  return {
    from: `hsl(${hue} 24% 21%)`,
    to: `hsl(${(hue + 28) % 360} 26% 13%)`,
    letter: seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "?",
  };
}

export function searchGames(query: string, category: GameCategory | "all"): CrystalOSGame[] {
  const value = query.trim().toLowerCase();
  return games.filter((game) => {
    if (category !== "all" && game.category !== category) return false;
    if (!value) return true;
    return `${game.title} ${game.host} ${game.collection}`.toLowerCase().includes(value);
  });
}

/**
 * Featured picks: a fixed, reviewable selection spread across categories so the
 * hero area is stable between reloads and never claims to be personalised.
 */
const featuredIds = [
  "crystal-snake",
  "gta-5",
  "smash-karts",
  "moto-x3m",
  "2048",
  "slither-io",
  "cut-the-rope",
  "krunker-io",
];

export const featuredGames: CrystalOSGame[] = featuredIds
  .map((id) => games.find((game) => game.id === id))
  .filter((game): game is CrystalOSGame => Boolean(game));

export const gamesPerPage = 48;
