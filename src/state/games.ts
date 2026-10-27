import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";

/* ==========================================================================
   Games

   Favourites, play history and per-game preferences. Play sessions are
   recorded from real usage; nothing here is synthesised for display.
   ========================================================================== */

export interface PlaySession {
  gameId: string;
  at: number;
  /** Seconds the player stayed open, measured from mount to unmount. */
  seconds: number;
}

/** How a game's Play button hands the game over. */
export type GameLaunchMode = "embedded" | "browser" | "external";

/**
 * A game profile: the per-game configuration the player and the library honour.
 *
 * Favourites, history and hidden games are their own fields on the store — this
 * is the part that changes how a game *launches* and how it is described, so it
 * is kept apart from play history and survives clearHistory().
 */
export interface GameProfile {
  /** An override for the catalogue title. Empty means "use the catalogue". */
  title: string;
  notes: string;
  tags: string[];
  /**
   * `embedded` keeps the game in the CrystalOS frame. `browser` opens the
   * publisher's URL in a CrystalOS Browser tab, which is how a host that
   * refuses to be framed still becomes playable — the player says so itself
   * when a frame fails. `external` hands the URL to the system browser.
   */
  launchMode: GameLaunchMode;
  /** Ask for fullscreen as soon as the frame mounts. */
  fullscreenOnLaunch: boolean;
}

export const defaultGameProfile: GameProfile = {
  title: "",
  notes: "",
  tags: [],
  launchMode: "embedded",
  fullscreenOnLaunch: false,
};

/** The launch modes, with the wording the profile editor shows. */
export const gameLaunchModes: {
  value: GameLaunchMode;
  label: string;
  hint: string;
}[] = [
  {
    value: "embedded",
    label: "In CrystalOS",
    hint: "Plays in the Games window. Some hosts refuse to be framed; choose another mode for those.",
  },
  {
    value: "browser",
    label: "Browser tab",
    hint: "Opens the game in a CrystalOS Browser tab, where the frame restriction does not apply.",
  },
  {
    value: "external",
    label: "System browser",
    hint: "Hands the address to the browser CrystalOS is running in, outside the desktop.",
  },
];

const launchModeValues: GameLaunchMode[] = ["embedded", "browser", "external"];

/**
 * Coerces a stored profile into one the player can act on.
 *
 * Profiles come out of localStorage, so a hand-edited or older value can hold
 * anything. Field caps are applied here rather than only in the editor, so a
 * profile that never passed through the editor still cannot put an unknown
 * launch mode in front of the player or grow an unbounded tag list.
 */
export function normaliseGameProfile(value: Partial<GameProfile> | undefined): GameProfile {
  if (!value || typeof value !== "object") return { ...defaultGameProfile };
  return {
    title: typeof value.title === "string" ? value.title.slice(0, 80) : "",
    notes: typeof value.notes === "string" ? value.notes.slice(0, 600) : "",
    tags: Array.isArray(value.tags)
      ? [
          ...new Set(
            value.tags
              .filter((tag): tag is string => typeof tag === "string")
              .map((tag) => tag.trim().slice(0, 24))
              .filter(Boolean),
          ),
        ].slice(0, 8)
      : [],
    launchMode: launchModeValues.includes(value.launchMode as GameLaunchMode)
      ? (value.launchMode as GameLaunchMode)
      : defaultGameProfile.launchMode,
    fullscreenOnLaunch: value.fullscreenOnLaunch === true,
  };
}

/** True when a profile is still the default and can be dropped entirely. */
export function isDefaultGameProfile(profile: GameProfile): boolean {
  return (
    profile.title === "" &&
    profile.notes === "" &&
    profile.tags.length === 0 &&
    profile.launchMode === defaultGameProfile.launchMode &&
    profile.fullscreenOnLaunch === false
  );
}

interface GamesState {
  favourites: string[];
  recents: string[];
  sessions: PlaySession[];
  /** Games the user has hidden from the library. */
  hidden: string[];
  /** Per-game configuration, keyed by catalogue id. Absent means "all default". */
  profiles: Record<string, GameProfile>;
  /**
   * Play a game in a window of its own rather than swapping the library's own
   * view for the player. On, the library stays open while a game fills the
   * desk; off, a game takes over the library window it was launched from.
   */
  windowPerGame: boolean;

  setWindowPerGame: (windowPerGame: boolean) => void;
  toggleFavourite: (gameId: string) => void;
  isFavourite: (gameId: string) => boolean;
  recordSession: (session: PlaySession) => void;
  hideGame: (gameId: string) => void;
  unhideGame: (gameId: string) => void;
  clearHistory: () => void;
  totalPlaySeconds: () => number;
  /** Merges a patch into one game's profile, normalising the result. */
  setProfile: (gameId: string, patch: Partial<GameProfile>) => void;
  /** Returns a game to the catalogue defaults. */
  resetProfile: (gameId: string) => void;
  /** The stored profile, normalised; always safe to read. */
  profileFor: (gameId: string) => GameProfile;
}

export const useGamesStore = create<GamesState>()(
  persist(
    (set, get) => ({
      favourites: [],
      recents: [],
      sessions: [],
      hidden: [],
      profiles: {},
      windowPerGame: true,

      setWindowPerGame: (windowPerGame) => set({ windowPerGame }),

      toggleFavourite: (gameId) =>
        set({
          favourites: get().favourites.includes(gameId)
            ? get().favourites.filter((id) => id !== gameId)
            : [...get().favourites, gameId],
        }),

      isFavourite: (gameId) => get().favourites.includes(gameId),

      recordSession: (session) =>
        set({
          sessions: [session, ...get().sessions].slice(0, 120),
          recents: [session.gameId, ...get().recents.filter((id) => id !== session.gameId)].slice(
            0,
            16,
          ),
        }),

      hideGame: (gameId) => set({ hidden: [...new Set([...get().hidden, gameId])] }),
      unhideGame: (gameId) => set({ hidden: get().hidden.filter((id) => id !== gameId) }),

      clearHistory: () => set({ sessions: [], recents: [] }),

      totalPlaySeconds: () =>
        get().sessions.reduce((total, session) => total + session.seconds, 0),

      setProfile: (gameId, patch) =>
        set({
          profiles: {
            ...get().profiles,
            [gameId]: normaliseGameProfile({ ...get().profiles[gameId], ...patch }),
          },
        }),

      resetProfile: (gameId) => {
        const profiles = { ...get().profiles };
        delete profiles[gameId];
        set({ profiles });
      },

      profileFor: (gameId) => normaliseGameProfile(get().profiles[gameId]),
    }),
    {
      name: "games",
      version: 2,
      storage: jsonStorageFor<GamesState>(),
      /**
       * v1 shipped no profiles. Everything else on this store is untouched, and
       * a missing `profiles` merges to `{}` — not throwing away someone's
       * favourites and play history was the whole point of migrating rather
       * than rejecting.
       */
      migrate: (persisted, version) => {
        const state = persisted as Partial<GamesState>;
        if (version < 2 && !state.profiles) state.profiles = {};
        return state as GamesState;
      },
    },
  ),
);
