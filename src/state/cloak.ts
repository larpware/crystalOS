import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";
import type { TabIdentityPreset } from "@/types";

/* ==========================================================================
   OS-level tab identity

   Tab cloaking lives in the shell, not inside CrystalOS Browser: it describes
   what the *operating system's* browser tab looks like, so it applies to the
   whole session and survives window changes.

   What a web application can actually do here is limited by the host browser:
   the shell owns `document.title` and the favicon link, and nothing else. The
   URL bar, the browser's own menus and — in installed/PWA windows — some of the
   chrome belong to the browser and cannot be changed by a page. Settings says
   this plainly instead of implying more.
   ========================================================================== */

export const builtInTabIdentities: TabIdentityPreset[] = [
  {
    id: "study",
    name: "Study",
    title: "Course Materials — Week 6",
    favicon: "/cloak/study.svg",
    description: "A course site reading list.",
    builtIn: true,
  },
  {
    id: "calculator",
    name: "Calculator",
    title: "Calculator",
    favicon: "/cloak/calculator.svg",
    description: "A plain calculator window.",
    builtIn: true,
  },
  {
    id: "notes",
    name: "Notes",
    title: "Notes",
    favicon: "/cloak/notes.svg",
    description: "A notepad.",
    builtIn: true,
  },
  {
    id: "documentation",
    name: "Documentation",
    title: "Reference — API",
    favicon: "/cloak/documentation.svg",
    description: "Developer documentation.",
    builtIn: true,
  },
  {
    id: "calendar",
    name: "Calendar",
    title: "Calendar",
    favicon: "/cloak/calendar.svg",
    description: "A monthly calendar.",
    builtIn: true,
  },
  {
    id: "search",
    name: "Search",
    title: "Search",
    favicon: "/cloak/search.svg",
    description: "A search results page.",
    builtIn: true,
  },
];

export interface TabIdentityState {
  enabled: boolean;
  presetId: string;
  /** User-authored presets, editable from Settings. */
  presets: TabIdentityPreset[];
  /** Recorded when the shell could not apply the identity. */
  lastError: string | null;

  setEnabled: (enabled: boolean) => void;
  setPreset: (presetId: string) => void;
  savePreset: (preset: TabIdentityPreset) => void;
  removePreset: (id: string) => void;
  setLastError: (message: string | null) => void;
}

export const defaultTabIdentity: Pick<TabIdentityState, "enabled" | "presetId" | "presets"> = {
  enabled: false,
  presetId: "study",
  presets: [],
};

export const useTabIdentityStore = create<TabIdentityState>()(
  persist(
    (set, get) => ({
      ...defaultTabIdentity,
      lastError: null,

      setEnabled: (enabled) => set({ enabled, lastError: null }),
      setPreset: (presetId) => set({ presetId, lastError: null }),
      savePreset: (preset) =>
        set({
          presets: [...get().presets.filter((entry) => entry.id !== preset.id), preset],
        }),
      removePreset: (id) =>
        set({
          presets: get().presets.filter((entry) => entry.id !== id),
          presetId: get().presetId === id ? "study" : get().presetId,
        }),
      // No-ops when unchanged: `applyTabIdentity` runs from an effect, so a
      // notification per call would loop.
      setLastError: (lastError) => {
        if (get().lastError === lastError) return;
        set({ lastError });
      },
    }),
    {
      name: "tab-identity",
      version: 1,
      storage: jsonStorageFor<TabIdentityState>(),
      partialize: (state) =>
        ({
          enabled: state.enabled,
          presetId: state.presetId,
          presets: state.presets,
        }) as TabIdentityState,
    },
  ),
);

export function allTabIdentities(): TabIdentityPreset[] {
  return [...builtInTabIdentities, ...useTabIdentityStore.getState().presets];
}

export function findTabIdentity(id: string): TabIdentityPreset | undefined {
  return allTabIdentities().find((preset) => preset.id === id);
}

/* --------------------------------------------------------------------------
   Applying the identity to the real host tab
   -------------------------------------------------------------------------- */

const ORIGINAL = {
  title: typeof document === "undefined" ? "" : document.title,
  favicon:
    typeof document === "undefined"
      ? "/icons/crystal.svg"
      : (document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href ?? "/icons/crystal.svg"),
};

function faviconLink(): HTMLLinkElement {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (existing) return existing;
  const link = document.createElement("link");
  link.rel = "icon";
  document.head.appendChild(link);
  return link;
}

/**
 * Applies the active preset to the host tab, or restores the shell's own title
 * and icon when cloaking is off. Returns the reason on failure so Settings can
 * show it instead of claiming success.
 */
export function applyTabIdentity(): string | null {
  if (typeof document === "undefined") return null;
  const { enabled, presetId } = useTabIdentityStore.getState();

  if (!enabled) {
    document.title = ORIGINAL.title;
    faviconLink().href = ORIGINAL.favicon;
    useTabIdentityStore.getState().setLastError(null);
    return null;
  }

  const preset = findTabIdentity(presetId);
  if (!preset) {
    const message = "That preset no longer exists; the CrystalOS tab identity is showing.";
    document.title = ORIGINAL.title;
    faviconLink().href = ORIGINAL.favicon;
    useTabIdentityStore.getState().setLastError(message);
    return message;
  }

  try {
    document.title = preset.title;
  } catch {
    const message = "This browser blocked the title change.";
    useTabIdentityStore.getState().setLastError(message);
    return message;
  }

  try {
    faviconLink().href = preset.favicon;
  } catch {
    const message =
      "The title was applied, but this browser blocked the favicon change (some installed windows keep the app icon).";
    useTabIdentityStore.getState().setLastError(message);
    return message;
  }

  useTabIdentityStore.getState().setLastError(null);
  return null;
}

/** The preset currently in force, or null when cloaking is off. */
export function activeTabIdentity(): TabIdentityPreset | null {
  const { enabled, presetId } = useTabIdentityStore.getState();
  return enabled ? (findTabIdentity(presetId) ?? null) : null;
}
