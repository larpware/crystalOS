import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";

export interface InstalledApp {
  appId: string;
  installedAt: number;
  /** Version at install time, compared against the catalogue for updates. */
  version: string;
}

export interface InstalledCommunityApp {
  id: string;
  name: string;
  description: string;
  websiteUrl: string;
  iconUrl?: string | null;
  category: string;
  developerUsername?: string;
  developerDisplayName?: string;
  installedAt: number;
}

interface AppsState {
  recents: string[];
  launchCounts: Record<string, number>;
  /** Apps the user removed from the store. Bundled code stays on disk. */
  removed: string[];
  installed: InstalledApp[];
  /** User-installed community applications */
  installedCommunityApps: InstalledCommunityApp[];

  recordLaunch: (appId: string) => void;
  clearRecents: () => void;
  install: (appId: string, version: string) => void;
  remove: (appId: string) => void;
  installCommunity: (app: InstalledCommunityApp) => void;
  uninstallCommunity: (appId: string) => void;
  syncCommunityInstallations: (apps: InstalledCommunityApp[]) => void;
  getCommunityApp: (appId: string) => InstalledCommunityApp | undefined;
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
      installedCommunityApps: [],

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

      installCommunity: (app) => {
        const cleanId = app.id.replace(/^community:/, "");
        const filtered = get().installedCommunityApps.filter((a) => a.id !== cleanId);
        set({
          installedCommunityApps: [...filtered, { ...app, id: cleanId, installedAt: Date.now() }],
        });
      },

      uninstallCommunity: (appId) => {
        const cleanId = appId.replace(/^community:/, "");
        set({
          installedCommunityApps: get().installedCommunityApps.filter((a) => a.id !== cleanId),
        });
      },

      syncCommunityInstallations: (apps) => {
        set({ installedCommunityApps: apps });
      },

      getCommunityApp: (appId) => {
        const cleanId = appId.replace(/^community:/, "");
        return get().installedCommunityApps.find((a) => a.id === cleanId);
      },

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
