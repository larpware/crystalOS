import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IconName } from "@/icons/Icon";
import { jsonStorageFor } from "@/services/storage";
import { createId } from "@/utils/format";

/* ==========================================================================
   CrystalOS Workspaces

   A workspace is a named set of desktop windows. Windows keep running when a
   workspace is not visible — the window manager only hides them — so switching
   is an organisational move, never a restart, and never a security boundary.

   Membership lives on the window itself (`WindowInstance.workspaceId`), which
   keeps one source of truth: this store owns the workspaces and which one is
   active, the window store owns which window belongs where.
   ========================================================================== */

export interface Workspace {
  /** Stable identifier. Names are labels and may change freely. */
  id: string;
  name: string;
  icon: IconName;
  /** Snap layout applied to this workspace's windows, when one is chosen. */
  layoutId?: string;
  createdAt: number;
}

interface WorkspacesState {
  workspaces: Workspace[];
  activeId: string;
  /** Timestamp of the last switch, so other layers can react to a change. */
  switchedAt: number;

  create: (name?: string, options?: Partial<Omit<Workspace, "id" | "createdAt">>) => string;
  rename: (id: string, name: string) => void;
  setIcon: (id: string, icon: IconName) => void;
  setLayout: (id: string, layoutId: string | undefined) => void;
  /** Moves a workspace to a new index; order is what the switcher shows. */
  reorder: (id: string, toIndex: number) => void;
  remove: (id: string) => boolean;
  duplicate: (id: string) => string | null;
  activate: (id: string) => boolean;
  /** Switches by offset, wrapping around the list. */
  step: (offset: number) => string;
  /** Switches to the nth workspace (0-based) when it exists. */
  activateIndex: (index: number) => string | null;
  reset: () => void;
}

export const MAX_WORKSPACES = 12;

const GLYPHS: IconName[] = ["layout", "grid", "browser", "terminal", "games", "notes", "music", "media"];

/** Names assigned to workspaces the user has not named themselves. */
const DEFAULT_NAMES = [
  "Main",
  "Gaming",
  "Work",
  "Browsing",
  "Personal",
  "Reference",
  "Studio",
  "Media",
];

function makeWorkspace(name: string, index: number, options: Partial<Workspace> = {}): Workspace {
  return {
    id: createId("ws"),
    name,
    icon: GLYPHS[index % GLYPHS.length],
    createdAt: Date.now(),
    ...options,
  };
}

function clampName(name: string, fallback: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return fallback;
  return trimmed.slice(0, 28);
}

/**
 * Repairs anything that a hand-edited or truncated store could contain, and
 * guarantees the invariant the rest of the OS relies on: at least one
 * workspace exists, and exactly one of them is active.
 */
function repair(workspaces: Workspace[], activeId: string): { workspaces: Workspace[]; activeId: string } {
  const seen = new Set<string>();
  const clean: Workspace[] = [];
  for (const entry of Array.isArray(workspaces) ? workspaces : []) {
    if (!entry || typeof entry !== "object") continue;
    const id = typeof entry.id === "string" && entry.id ? entry.id : createId("ws");
    if (seen.has(id)) continue;
    seen.add(id);
    clean.push({
      id,
      name: clampName(String(entry.name ?? ""), DEFAULT_NAMES[clean.length % DEFAULT_NAMES.length]),
      icon: (entry.icon as IconName) ?? GLYPHS[clean.length % GLYPHS.length],
      layoutId: typeof entry.layoutId === "string" ? entry.layoutId : undefined,
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
    });
  }
  if (clean.length === 0) clean.push(makeWorkspace(DEFAULT_NAMES[0], 0));
  const active = clean.some((workspace) => workspace.id === activeId) ? activeId : clean[0].id;
  return { workspaces: clean.slice(0, MAX_WORKSPACES), activeId: active };
}

const first = makeWorkspace(DEFAULT_NAMES[0], 0);

export const useWorkspaceStore = create<WorkspacesState>()(
  persist(
    (set, get) => ({
      workspaces: [first],
      activeId: first.id,
      switchedAt: Date.now(),

      create: (name, options = {}) => {
        const { workspaces } = get();
        if (workspaces.length >= MAX_WORKSPACES) return get().activeId;
        const index = workspaces.length;
        const workspace = makeWorkspace(
          clampName(name ?? "", `Workspace ${index + 1}`),
          index,
          options,
        );
        set({ workspaces: [...workspaces, workspace] });
        return workspace.id;
      },

      rename: (id, name) => {
        if (!name.trim()) return;
        set({
          workspaces: get().workspaces.map((workspace) =>
            workspace.id === id ? { ...workspace, name: clampName(name, workspace.name) } : workspace,
          ),
        });
      },

      setIcon: (id, icon) =>
        set({
          workspaces: get().workspaces.map((workspace) =>
            workspace.id === id ? { ...workspace, icon } : workspace,
          ),
        }),

      setLayout: (id, layoutId) =>
        set({
          workspaces: get().workspaces.map((workspace) =>
            workspace.id === id ? { ...workspace, layoutId } : workspace,
          ),
        }),

      reorder: (id, toIndex) => {
        const list = [...get().workspaces];
        const from = list.findIndex((workspace) => workspace.id === id);
        const to = Math.max(0, Math.min(list.length - 1, Math.round(toIndex)));
        if (from < 0 || from === to) return;
        const [moved] = list.splice(from, 1);
        list.splice(to, 0, moved);
        set({ workspaces: list });
      },

      remove: (id) => {
        const list = get().workspaces;
        // The desktop always has somewhere for a window to live.
        if (list.length <= 1) return false;
        const workspace = list.find((entry) => entry.id === id);
        if (!workspace) return false;
        const index = list.indexOf(workspace);
        const remaining = list.filter((entry) => entry.id !== id);
        const activeId =
          get().activeId === id
            ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? remaining[0].id)
            : get().activeId;
        set({ workspaces: remaining, activeId, switchedAt: Date.now() });
        return true;
      },

      duplicate: (id) => {
        const source = get().workspaces.find((workspace) => workspace.id === id);
        if (!source) return null;
        if (get().workspaces.length >= MAX_WORKSPACES) return null;
        const copy = makeWorkspace(`${source.name} copy`.slice(0, 28), get().workspaces.length, {
          icon: source.icon,
          layoutId: source.layoutId,
        });
        set({ workspaces: [...get().workspaces, copy] });
        return copy.id;
      },

      activate: (id) => {
        const exists = get().workspaces.some((workspace) => workspace.id === id);
        if (!exists || get().activeId === id) return false;
        set({ activeId: id, switchedAt: Date.now() });
        return true;
      },

      step: (offset) => {
        const { workspaces, activeId } = get();
        if (workspaces.length === 0) return activeId;
        const index = workspaces.findIndex((workspace) => workspace.id === activeId);
        const next = ((index + offset) % workspaces.length + workspaces.length) % workspaces.length;
        const target = workspaces[next].id;
        set({ activeId: target, switchedAt: Date.now() });
        return target;
      },

      activateIndex: (index) => {
        const target = get().workspaces[index];
        if (!target) return null;
        set({ activeId: target.id, switchedAt: Date.now() });
        return target.id;
      },

      reset: () => {
        const workspace = makeWorkspace(DEFAULT_NAMES[0], 0);
        set({ workspaces: [workspace], activeId: workspace.id, switchedAt: Date.now() });
      },
    }),
    {
      name: "workspaces",
      version: 1,
      storage: jsonStorageFor<WorkspacesState>(),
      partialize: (state) =>
        ({ workspaces: state.workspaces, activeId: state.activeId }) as WorkspacesState,
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<WorkspacesState>;
        const { workspaces, activeId } = repair(stored.workspaces ?? [], stored.activeId ?? "");
        return { ...current, workspaces, activeId };
      },
    },
  ),
);

/** The active workspace id, readable outside React (window creation path). */
export function activeWorkspaceId(): string {
  return useWorkspaceStore.getState().activeId;
}

export function workspaceById(id: string | undefined): Workspace | undefined {
  if (!id) return undefined;
  return useWorkspaceStore.getState().workspaces.find((workspace) => workspace.id === id);
}

export function workspaceName(id: string | undefined): string {
  return workspaceById(id)?.name ?? "Workspace";
}
