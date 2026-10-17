import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";
import { normalisePlugin, type InstalledPlugin, type PluginManifest } from "./manifest";

/* ==========================================================================
   Installed plugins

   The store holds what the user installed, and nothing holds a plugin's code
   because a plugin has none. Two consequences worth stating:

     - Reading is not trusted either. Storage is writable by hand, so the
       `merge` below puts every stored record back through normalisePlugin(),
       which is the same function a pasted manifest goes through. A plugin that
       was valid when it was written but is not valid now is dropped rather
       than half-loaded.

     - Installing is a decision the user makes with the permissions in front of
       them, so the store's install() takes an already-validated manifest. The
       page is what parses and shows it; this file never sees raw JSON.
   ========================================================================== */

export type InstallResult =
  | { ok: true; plugin: InstalledPlugin }
  | { ok: false; message: string };

export interface PluginState {
  plugins: InstalledPlugin[];

  /** Adds a validated manifest, replacing an earlier version of the same id. */
  install: (manifest: PluginManifest) => InstallResult;
  setEnabled: (id: string, enabled: boolean) => void;
  remove: (id: string) => boolean;
  reset: () => void;
}

/** Re-validates a stored record, keeping the parts the manifest does not own. */
export function reviveStoredPlugin(value: unknown): InstalledPlugin | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const result = normalisePlugin(record);
  if (!result.ok) return null;
  return {
    ...result.plugin,
    // A plugin that was on stays on; anything else is off, which is the safe way
    // for a field that was missing or of the wrong type.
    enabled: record.enabled === true,
    installedAt: typeof record.installedAt === "number" ? record.installedAt : 0,
  };
}

/**
 * The rule applied to whatever is in storage: a stored list is only as
 * trustworthy as the last thing that wrote to it, which may not have been this
 * build. Exported so it can be tested on its own.
 */
export function sanitiseInstalledPlugins(value: unknown): InstalledPlugin[] {
  if (!Array.isArray(value)) return [];
  const plugins: InstalledPlugin[] = [];
  for (const entry of value) {
    const plugin = reviveStoredPlugin(entry);
    if (!plugin) continue;
    if (plugins.some((existing) => existing.id === plugin.id)) continue;
    plugins.push(plugin);
  }
  return plugins;
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set, get) => ({
      plugins: [],

      install: (manifest) => {
        const entries = get().plugins;
        const existing = entries.find((entry) => entry.id === manifest.id);
        const installed: InstalledPlugin = {
          ...manifest,
          enabled: true,
          installedAt: Date.now(),
        };
        set({
          plugins: existing
            ? entries.map((entry) => (entry.id === manifest.id ? installed : entry))
            : [...entries, installed],
        });
        return { ok: true, plugin: installed };
      },

      setEnabled: (id, enabled) =>
        set({
          plugins: get().plugins.map((entry) => (entry.id === id ? { ...entry, enabled } : entry)),
        }),

      remove: (id) => {
        const entries = get().plugins;
        if (!entries.some((entry) => entry.id === id)) return false;
        set({ plugins: entries.filter((entry) => entry.id !== id) });
        return true;
      },

      reset: () => set({ plugins: [] }),
    }),
    {
      name: "plugins",
      version: 1,
      storage: jsonStorageFor<PluginState>(),
      /* Every stored plugin is re-validated here, once, so the rest of the OS
         can treat `plugins` as valid without re-checking. */
      merge: (persisted, current) => ({
        ...current,
        plugins: sanitiseInstalledPlugins((persisted as Partial<PluginState> | undefined)?.plugins),
      }),
    },
  ),
);

/** Every installed plugin, enabled or not. */
export function installedPlugins(): InstalledPlugin[] {
  return usePluginStore.getState().plugins;
}

/** The plugins that are currently contributing commands. */
export function enabledPlugins(): InstalledPlugin[] {
  return usePluginStore.getState().plugins.filter((plugin) => plugin.enabled);
}
