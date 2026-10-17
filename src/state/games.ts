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

interface GamesState {
  favourites: string[];
  recents: string[];
  sessions: PlaySession[];
  /** Games the user has hidden from the library. */
  hidden: string[];

  toggleFavourite: (gameId: string) => void;
  isFavourite: (gameId: string) => boolean;
  recordSession: (session: PlaySession) => void;
  hideGame: (gameId: string) => void;
  unhideGame: (gameId: string) => void;
  clearHistory: () => void;
  totalPlaySeconds: () => number;
}

export const useGamesStore = create<GamesState>()(
  persist(
    (set, get) => ({
      favourites: [],
      recents: [],
      sessions: [],
      hidden: [],

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
    }),
    { name: "games", version: 1, storage: jsonStorageFor<GamesState>() },
  ),
);
