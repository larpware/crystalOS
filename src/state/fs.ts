import { create } from "zustand";
import { persist } from "zustand/middleware";
import { IDB_STORES, idbStorageFor } from "@/services/storage";
import type { ClipboardState, FileNode } from "@/types";
import { createId } from "@/utils/format";

/* ==========================================================================
   Virtual filesystem

   CrystalOS never pretends it can read the user's real disk. Files, Trash
   and the desktop icons all operate on this structured store, which is
   persisted to IndexedDB. Users can still bring real data in through the
   import action in Files, which writes the file body into the same store.
   ========================================================================== */

export const ROOT_ID = "root";

/** Mime of a desktop entry that opens an application rather than a document. */
export const APP_SHORTCUT_MIME = "application/x-crescent-shortcut";

const day = 86_400_000;
const now = Date.now();

interface SeedNode {
  name: string;
  kind: "file" | "folder";
  children?: SeedNode[];
  content?: string;
  mime?: string;
  url?: string;
  size?: number;
  ageDays?: number;
}

const seedTree: SeedNode[] = [
  {
    name: "Home",
    kind: "folder",
    children: [
      {
        name: "Desktop",
        kind: "folder",
        children: [
          {
            name: "Shortcuts.txt",
            kind: "file",
            mime: "text/plain",
            ageDays: 3,
            content: [
              "CrystalOS keyboard shortcuts",
              "",
              "Super              Open the launcher",
              "Ctrl+Alt+T         New terminal",
              "Ctrl+W             Close the focused window",
              "Ctrl+Shift+W       Close every window",
              "Alt+Tab            Cycle windows",
              "Super+L            Lock the screen",
              "Super+D            Toggle Do Not Disturb",
              "Escape             Close menus and overlays",
              "",
              "Right-click the desktop for display and wallpaper actions.",
            ].join("\n"),
          },
          {
            name: "Read me first.md",
            kind: "file",
            mime: "text/markdown",
            ageDays: 8,
            content: [
              "# Welcome to CrystalOS",
              "",
              "This is a desktop environment that runs entirely in the browser.",
              "Everything you do here is stored locally in this browser profile:",
              "settings, files, wallpapers and accounts.",
              "",
              "## Getting started",
              "",
              "- Open the launcher with the Super key or the Activities button.",
              "- Pin apps to the dock by right-clicking them in the launcher.",
              "- Add widgets from Settings → Widgets. The desktop starts empty on purpose.",
              "- Change the wallpaper, theme and OS scale from Settings.",
              "- Try the Terminal: `help`, `neofetch`, `ls`, `open files`.",
              "",
              "## What is local and what is not",
              "",
              "Nothing leaves this machine unless you enable the browsing proxy, which",
              "talks to the local proxy server you can start with `npm run proxy`.",
              "Messaging between tabs is real; internet-wide messaging needs the",
              "signalling server described in Settings → Messaging.",
            ].join("\n"),
          },
        ],
      },
      {
        name: "Documents",
        kind: "folder",
        children: [
          {
            name: "Design principles.txt",
            kind: "file",
            mime: "text/plain",
            ageDays: 5,
            content: [
              "CrystalOS design principles",
              "",
              "1. Hierarchy before decoration.",
              "2. One border, one shadow, one radius per surface.",
              "3. Motion explains state change, it does not entertain.",
              "4. If a value cannot be measured, it is not displayed.",
              "5. Empty space is a feature.",
              "",
              "Rejected: liquid glass, glow gradients, decorative orbs,",
              "floating cards, invented statistics, holographic accents.",
            ].join("\n"),
          },
          {
            name: "Project notes.md",
            kind: "file",
            mime: "text/markdown",
            ageDays: 2,
            content: [
              "## Release checklist",
              "",
              "- [x] Window manager: drag, resize, snap, maximise",
              "- [x] Theme engine driven entirely by custom properties",
              "- [x] Wallpaper Library with local imports",
              "- [ ] Review the widget grid on a 1280 wide display",
              "- [ ] Verify the messaging fallback copy",
            ].join("\n"),
          },
          {
            name: "Q3 budget.csv",
            kind: "file",
            mime: "text/csv",
            ageDays: 12,
            content: [
              "category,planned,actual",
              "Hardware,4200,3980",
              "Software,1800,1640",
              "Training,900,1230",
              "Support,1400,1180",
            ].join("\n"),
          },
        ],
      },
      {
        name: "Downloads",
        kind: "folder",
        children: [
          {
            name: "wallpaper-pack-notes.txt",
            kind: "file",
            mime: "text/plain",
            ageDays: 1,
            content:
              "Add wallpapers from Wallpaper Library → Add wallpaper.\nSupported here: JPG, PNG, WebP, GIF, MP4 and WebM.",
          },
        ],
      },
      {
        name: "Pictures",
        kind: "folder",
        children: [
          {
            name: "Reference — coastline.txt",
            kind: "file",
            mime: "text/plain",
            ageDays: 20,
            content: "Palette reference: cold sky, warm sand, deep water.",
          },
        ],
      },
      { name: "Music", kind: "folder", children: [] },
      { name: "Videos", kind: "folder", children: [] },
      {
        name: "Projects",
        kind: "folder",
        children: [
          {
            name: "crystalos",
            kind: "folder",
            children: [
              {
                name: "architecture.md",
                kind: "file",
                mime: "text/markdown",
                ageDays: 1,
                content: [
                  "## Modules",
                  "",
                  "shell/            desktop, panel, dock, overlays",
                  "window-manager/   geometry, focus, snapping",
                  "apps/             one directory per application",
                  "state/            one store per domain, no god object",
                  "themes/           token presets and the applier",
                  "wallpapers/       library, live scenes, resolver",
                  "services/         storage, system info, auth, messaging",
                ].join("\n"),
              },
            ],
          },
        ],
      },
    ],
  },
  { name: "System", kind: "folder", children: [] },
];

function seedNodes(): FileNode[] {
  const nodes: FileNode[] = [
    {
      id: ROOT_ID,
      name: "/",
      kind: "folder",
      parentId: null,
      size: 0,
      modified: now,
      created: now,
      readonly: true,
    },
  ];

  const walk = (entries: SeedNode[], parentId: string) => {
    for (const entry of entries) {
      const id = createId("fs");
      const modified = now - (entry.ageDays ?? 1) * day;
      const size = entry.content ? entry.content.length : (entry.size ?? 0);
      nodes.push({
        id,
        name: entry.name,
        kind: entry.kind,
        parentId,
        size,
        modified,
        created: modified,
        mime: entry.mime,
        content: entry.content,
        dataUrl: entry.url,
      });
      if (entry.children) walk(entry.children, id);
    }
  };

  walk(seedTree, ROOT_ID);
  return nodes;
}

interface FsState {
  nodes: FileNode[];
  clipboard: ClipboardState | null;
  /** Selected ids, owned here so Files, Trash and the desktop agree. */
  selection: string[];
  lastVisitedId: string;

  createFolder: (parentId: string, name?: string) => string;
  /** Appends an application shortcut, optionally at a position on the desktop. */
  createShortcut: (
    parentId: string,
    name: string,
    appId: string,
    position?: { x: number; y: number },
  ) => string;
  createFile: (
    parentId: string,
    name: string,
    content: string,
    mime?: string,
  ) => string;
  addBinary: (parentId: string, name: string, mime: string, dataUrl: string) => string;
  rename: (id: string, name: string) => void;
  setContent: (id: string, content: string) => void;
  moveMany: (ids: string[], targetParentId: string) => void;
  copyMany: (ids: string[], targetParentId: string) => string[];
  trashMany: (ids: string[]) => void;
  restoreMany: (ids: string[]) => void;
  deleteForever: (ids: string[]) => void;
  emptyTrash: () => void;
  setClipboard: (clipboard: ClipboardState | null) => void;
  setSelection: (ids: string[]) => void;
  setDesktopPosition: (id: string, position: { x: number; y: number }) => void;
  setLastVisited: (id: string) => void;
  resetToSeed: () => void;
}

function uniqueName(nodes: FileNode[], parentId: string, name: string): string {
  const siblings = new Set(
    nodes.filter((node) => node.parentId === parentId).map((node) => node.name.toLowerCase()),
  );
  if (!siblings.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let counter = 2;
  let candidate = `${base} (${counter})${extension}`;
  while (siblings.has(candidate.toLowerCase())) {
    counter += 1;
    candidate = `${base} (${counter})${extension}`;
  }
  return candidate;
}

/** True when `candidateId` is `nodeId` or one of its descendants. */
function isInside(nodes: FileNode[], nodeId: string, candidateId: string): boolean {
  if (nodeId === candidateId) return true;
  let cursor = nodes.find((node) => node.id === nodeId);
  while (cursor?.parentId) {
    if (cursor.parentId === candidateId) return true;
    cursor = nodes.find((node) => node.id === cursor?.parentId);
  }
  return false;
}

function cloneSubtree(
  nodes: FileNode[],
  sourceIds: string[],
  targetParentId: string,
): FileNode[] {
  const created: FileNode[] = [];

  const copy = (sourceId: string, parentId: string) => {
    const source = nodes.find((node) => node.id === sourceId);
    if (!source) return;
    const id = createId("fs");
    created.push({
      ...source,
      id,
      parentId,
      name: uniqueName([...nodes, ...created], parentId, source.name),
      created: Date.now(),
      modified: Date.now(),
      trashed: false,
      desktopPosition: undefined,
    });
    for (const child of nodes.filter((node) => node.parentId === sourceId)) {
      copy(child.id, id);
    }
  };

  for (const sourceId of sourceIds) copy(sourceId, targetParentId);
  return created;
}

export const useFsStore = create<FsState>()(
  persist(
    (set, get) => ({
      nodes: seedNodes(),
      clipboard: null,
      selection: [],
      lastVisitedId: ROOT_ID,

      createFolder: (parentId, name = "New folder") => {
        const nodes = get().nodes;
        const id = createId("fs");
        const folder: FileNode = {
          id,
          name: uniqueName(nodes, parentId, name),
          kind: "folder",
          parentId,
          size: 0,
          modified: Date.now(),
          created: Date.now(),
        };
        set({ nodes: [...nodes, folder] });
        return id;
      },

      createFile: (parentId, name, content, mime = "text/plain") => {
        const nodes = get().nodes;
        const id = createId("fs");
        const file: FileNode = {
          id,
          name: uniqueName(nodes, parentId, name),
          kind: "file",
          parentId,
          size: content.length,
          modified: Date.now(),
          created: Date.now(),
          mime,
          content,
        };
        set({ nodes: [...nodes, file] });
        return id;
      },

      createShortcut: (parentId, name, appId, position) => {
        const nodes = get().nodes;
        const id = createId("fs");
        const shortcut: FileNode = {
          id,
          name: uniqueName(nodes, parentId, name),
          kind: "file",
          parentId,
          size: 0,
          modified: Date.now(),
          created: Date.now(),
          mime: APP_SHORTCUT_MIME,
          appId,
          content: "",
          desktopPosition: position,
        };
        set({ nodes: [...nodes, shortcut] });
        return id;
      },

      addBinary: (parentId, name, mime, dataUrl) => {
        const nodes = get().nodes;
        const id = createId("fs");
        const file: FileNode = {
          id,
          name: uniqueName(nodes, parentId, name),
          kind: "file",
          parentId,
          // Data URLs carry a base64 payload; approximate the real byte size.
          size: Math.round(dataUrl.length * 0.75),
          modified: Date.now(),
          created: Date.now(),
          mime,
          dataUrl,
        };
        set({ nodes: [...nodes, file] });
        return id;
      },

      rename: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const nodes = get().nodes;
        const target = nodes.find((node) => node.id === id);
        if (!target || target.parentId === null) return;
        set({
          nodes: nodes.map((node) =>
            node.id === id
              ? {
                  ...node,
                  name: uniqueName(
                    nodes.filter((other) => other.id !== id),
                    node.parentId as string,
                    trimmed,
                  ),
                  modified: Date.now(),
                }
              : node,
          ),
        });
      },

      setContent: (id, content) =>
        set({
          nodes: get().nodes.map((node) =>
            node.id === id
              ? { ...node, content, size: content.length, modified: Date.now() }
              : node,
          ),
        }),

      moveMany: (ids, targetParentId) => {
        const nodes = get().nodes;
        const moving = ids.filter((id) => {
          const movingIntoItself = ids.some((other) => isInside(nodes, other, targetParentId));
          if (movingIntoItself && isInside(nodes, targetParentId, id)) return false;
          const node = nodes.find((candidate) => candidate.id === id);
          return Boolean(node) && node?.parentId !== targetParentId && !node?.readonly;
        });
        if (moving.length === 0) return;
        const updated = [...nodes];
        for (const id of moving) {
          const node = updated.find((candidate) => candidate.id === id);
          if (!node) continue;
          node.name = uniqueName(
            updated.filter((candidate) => candidate.id !== id),
            targetParentId,
            node.name,
          );
          node.parentId = targetParentId;
          node.modified = Date.now();
        }
        set({ nodes: updated });
      },

      copyMany: (ids, targetParentId) => {
        const created = cloneSubtree(get().nodes, ids, targetParentId);
        set({ nodes: [...get().nodes, ...created] });
        return created.map((node) => node.id);
      },

      trashMany: (ids) => {
        const nodes = get().nodes;
        const affected = new Set(ids);
        let changed = true;
        while (changed) {
          changed = false;
          for (const node of nodes) {
            if (node.parentId && affected.has(node.parentId) && !affected.has(node.id)) {
              affected.add(node.id);
              changed = true;
            }
          }
        }
        set({
          nodes: nodes.map((node) =>
            affected.has(node.id) && !node.readonly
              ? { ...node, trashed: true, modified: Date.now() }
              : node,
          ),
          selection: [],
        });
      },

      restoreMany: (ids) => {
        const nodes = get().nodes;
        const affected = new Set(ids);
        let changed = true;
        while (changed) {
          changed = false;
          for (const node of nodes) {
            if (node.parentId && affected.has(node.parentId) && !affected.has(node.id)) {
              affected.add(node.id);
              changed = true;
            }
          }
        }
        // If the original parent is gone, restore into Home so nothing is lost.
        const home = nodes.find((node) => node.name === "Home" && node.kind === "folder");
        const updated = nodes.map((node) => {
          if (!affected.has(node.id)) return node;
          const parentExists =
            node.parentId &&
            nodes.some((candidate) => candidate.id === node.parentId && !candidate.trashed);
          return {
            ...node,
            trashed: false,
            parentId: parentExists ? node.parentId : (home?.id ?? ROOT_ID),
            modified: Date.now(),
          };
        });
        set({ nodes: updated, selection: [] });
      },

      deleteForever: (ids) => {
        const nodes = get().nodes;
        const affected = new Set(ids);
        let changed = true;
        while (changed) {
          changed = false;
          for (const node of nodes) {
            if (node.parentId && affected.has(node.parentId) && !affected.has(node.id)) {
              affected.add(node.id);
              changed = true;
            }
          }
        }
        set({ nodes: nodes.filter((node) => !affected.has(node.id)), selection: [] });
      },

      emptyTrash: () =>
        set({ nodes: get().nodes.filter((node) => !node.trashed), selection: [] }),

      setClipboard: (clipboard) => set({ clipboard }),
      setSelection: (selection) => {
        const current = get().selection;
        if (
          current.length === selection.length &&
          current.every((id, index) => id === selection[index])
        ) {
          return;
        }
        set({ selection });
      },
      setDesktopPosition: (id, desktopPosition) =>
        set({
          nodes: get().nodes.map((node) => (node.id === id ? { ...node, desktopPosition } : node)),
        }),
      setLastVisited: (lastVisitedId) => set({ lastVisitedId }),
      resetToSeed: () =>
        set({ nodes: seedNodes(), clipboard: null, selection: [], lastVisitedId: ROOT_ID }),
    }),
    {
      name: "filesystem",
      version: 2,
      storage: idbStorageFor<FsState>(IDB_STORES.files),
      /*
       * v2 follows the `cinejoy` → `qmovies` application rename: any desktop
       * shortcut that pointed at the old id now points at the new one, so a
       * profile that put the movie app on the desktop keeps a working shortcut
       * instead of one that resolves to nothing.
       */
      migrate: (persisted, version) => {
        const state = persisted as Partial<FsState> | undefined;
        if (version >= 2 || !state?.nodes) return state as FsState;
        return {
          ...state,
          nodes: state.nodes.map((node) =>
            node.appId === "cinejoy" ? { ...node, appId: "qmovies" } : node,
          ),
        } as FsState;
      },
      partialize: (state) =>
        ({
          nodes: state.nodes,
          lastVisitedId: state.lastVisitedId,
        }) as FsState,
    },
  ),
);

/* ==========================================================================
   Selectors and path helpers
   ========================================================================== */

export function childrenOf(nodes: FileNode[], parentId: string, includeTrashed = false): FileNode[] {
  return nodes
    .filter(
      (node) => node.parentId === parentId && (includeTrashed || !node.trashed),
    )
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });
}

export function trashedNodes(nodes: FileNode[]): FileNode[] {
  return nodes
    .filter((node) => node.trashed)
    .sort((a, b) => b.modified - a.modified);
}

export function ancestorPath(nodes: FileNode[], id: string): FileNode[] {
  const path: FileNode[] = [];
  let cursor = nodes.find((node) => node.id === id);
  while (cursor) {
    path.unshift(cursor);
    cursor = cursor.parentId
      ? nodes.find((node) => node.id === cursor?.parentId)
      : undefined;
  }
  return path;
}

export function pathString(nodes: FileNode[], id: string): string {
  const path = ancestorPath(nodes, id);
  if (path.length <= 1) return "/";
  return `/${path
    .slice(1)
    .map((node) => node.name)
    .join("/")}`;
}

/** Resolves a `/Home/Documents` style path to a node id. */
export function resolvePath(nodes: FileNode[], pathOrName: string): string | null {
  const trimmed = pathOrName.replace(/\\/g, "/").trim();
  if (trimmed === "/" || trimmed === "") return ROOT_ID;

  let cursorId = ROOT_ID;
  const segments = trimmed.split("/").filter(Boolean);
  for (const segment of segments) {
    const child = nodes.find(
      (node) =>
        node.parentId === cursorId &&
        !node.trashed &&
        node.name.toLowerCase() === segment.toLowerCase(),
    );
    if (!child) return null;
    cursorId = child.id;
  }
  return cursorId;
}

/** Shortcut targets used by the Terminal and the Files sidebar. */
export function homeNodeId(nodes: FileNode[]): string {
  return (
    nodes.find((node) => node.name === "Home" && node.kind === "folder" && !node.trashed)?.id ??
    ROOT_ID
  );
}

export function desktopFolderId(nodes: FileNode[]): string {
  return (
    nodes.find((node) => node.name === "Desktop" && node.kind === "folder" && !node.trashed)?.id ??
    homeNodeId(nodes)
  );
}

export function descendantSize(nodes: FileNode[], id: string): number {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) return 0;
  if (node.kind === "file") return node.size;
  return nodes
    .filter((candidate) => candidate.parentId === id)
    .reduce((total, child) => total + descendantSize(nodes, child.id), 0);
}

export function countFiles(nodes: FileNode[]): number {
  return nodes.filter((node) => node.kind === "file" && !node.trashed).length;
}
