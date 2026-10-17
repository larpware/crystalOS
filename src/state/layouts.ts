import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";
import { builtInLayouts, validateRegions, type SnapLayout } from "@/window-manager/layouts";

/* ==========================================================================
   Custom layouts

   Built-in arrangements live in window-manager/layouts (pure data). This store
   holds only what the user created, validated on the way in so a hand-edited
   store can never place a window outside the work area.
   ========================================================================== */

interface LayoutState {
  custom: SnapLayout[];
  /** Adds or replaces a custom layout. Returns a readable error when invalid. */
  save: (layout: SnapLayout) => { ok: boolean; error?: string };
  rename: (id: string, name: string) => void;
  duplicate: (id: string) => string | null;
  remove: (id: string) => boolean;
  reset: () => void;
}

const builtInIds = new Set(builtInLayouts.map((layout) => layout.id));

function sanitise(list: unknown): SnapLayout[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const result: SnapLayout[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as SnapLayout;
    if (typeof candidate.id !== "string" || !candidate.id) continue;
    // A custom layout may never shadow a built-in one.
    if (builtInIds.has(candidate.id) || seen.has(candidate.id)) continue;
    if (validateRegions(candidate.regions)) continue;
    seen.add(candidate.id);
    result.push({
      id: candidate.id,
      name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.slice(0, 40) : "Custom layout",
      description:
        typeof candidate.description === "string" && candidate.description.trim()
          ? candidate.description.slice(0, 90)
          : "Custom arrangement.",
      regions: candidate.regions.map((region) => ({
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
      })),
      custom: true,
    });
    if (result.length >= 12) break;
  }
  return result;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      custom: [],

      save: (layout) => {
        const problem = validateRegions(layout.regions);
        if (problem) return { ok: false, error: problem };
        if (builtInIds.has(layout.id)) {
          return { ok: false, error: "That id belongs to a built-in layout." };
        }
        const entry: SnapLayout = { ...layout, custom: true };
        const existing = get().custom.findIndex((candidate) => candidate.id === layout.id);
        const custom = [...get().custom];
        if (existing >= 0) custom[existing] = entry;
        else custom.push(entry);
        set({ custom });
        return { ok: true };
      },

      rename: (id, name) =>
        set({
          custom: get().custom.map((layout) =>
            layout.id === id ? { ...layout, name: name.trim().slice(0, 40) || layout.name } : layout,
          ),
        }),

      duplicate: (id) => {
        const source = get().custom.find((layout) => layout.id === id);
        if (!source) return null;
        const copy: SnapLayout = {
          ...source,
          id: `${source.id}-copy-${Date.now().toString(36)}`,
          name: `${source.name} copy`.slice(0, 40),
        };
        set({ custom: [...get().custom, copy] });
        return copy.id;
      },

      remove: (id) => {
        if (!get().custom.some((layout) => layout.id === id)) return false;
        set({ custom: get().custom.filter((layout) => layout.id !== id) });
        return true;
      },

      reset: () => set({ custom: [] }),
    }),
    {
      name: "layouts",
      version: 1,
      storage: jsonStorageFor<LayoutState>(),
      partialize: (state) => ({ custom: state.custom }) as LayoutState,
      merge: (persisted, current) => ({
        ...current,
        custom: sanitise((persisted as Partial<LayoutState> | undefined)?.custom),
      }),
    },
  ),
);
