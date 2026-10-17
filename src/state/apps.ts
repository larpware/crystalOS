import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";

export interface InstalledApp {
  appId: string;
  installedAt: number;
  /** Version at install time, compared against the catalogue for updates. */
  version: string;
}

interface AppsState {
  recents: string[];
  launchCounts: Record<string, number>;
  /** Apps the user removed from the store. Bundled code stays on disk. */
  removed: string[];
  installed: InstalledApp[];

  recordLaunch: (appId: string) => void;
  clearRecents: () => void;
  install: (appId: string, version: string) => void;
  remove: (appId: string) => void;
  /** Marks a bundled app as present without showing an install animation. */
  syncBundled: (entries: { appId: string; version: string }[]) => void;
}

export const useAppsStore = create<AppsState>()(
  persist(
    (set, get) => ({
      recents: [],
      launchCounts: {},
      removed: [],
      installed: [],

      recordLaunch: (appId) =>
        set({
          recents: [appId, ...get().recents.filter((id) => id !== appId)].slice(0, 8),
          launchCounts: { ...get().launchCounts, [appId]: (get().launchCounts[appId] ?? 0) + 1 },
        }),

      clearRecents: () => set({ recents: [] }),

      install: (appId, version) => {
        const installed = get().installed.filter((entry) => entry.appId !== appId);
        set({
          installed: [...installed, { appId, version, installedAt: Date.now() }],
          removed: get().removed.filter((id) => id !== appId),
        });
      },

      remove: (appId) =>
        set({
          installed: get().installed.filter((entry) => entry.appId !== appId),
          removed: [...new Set([...get().removed, appId])],
        }),

      syncBundled: (entries) => {
        const known = new Map(get().installed.map((entry) => [entry.appId, entry]));
        const next = [...get().installed];
        for (const entry of entries) {
          if (!known.has(entry.appId)) {
            next.push({ ...entry, installedAt: Date.now() });
          }
        }
        set({ installed: next });
      },
    }),
    {
      name: "apps",
      version: 2,
      storage: jsonStorageFor<AppsState>(),
      /*
       * v2 renames the movie application from `cinejoy` to `qmovies` so a
       * profile that launched or installed it under the old id keeps its
       * recents, launch counts, install entry and removal state under the new
       * one instead of showing a ghost entry that resolves to nothing.
       */
      migrate: (persisted, version) => {
        const state = persisted as Partial<AppsState> | undefined;
        if (version >= 2 || !state) return state as AppsState;
        const rename = (id: string) => (id === "cinejoy" ? "qmovies" : id);
        const mapIds = (ids: string[] | undefined) => ids?.map(rename);
        return {
          ...state,
          recents: mapIds(state.recents),
          removed: mapIds(state.removed),
          launchCounts: state.launchCounts
            ? Object.fromEntries(
                Object.entries(state.launchCounts).map(([id, count]) => [rename(id), count]),
              )
            : state.launchCounts,
          installed: state.installed?.map((entry) => ({ ...entry, appId: rename(entry.appId) })),
        } as AppsState;
      },
    },
  ),
);
