import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";
import type { BrowserTab } from "@/types";
import { createId } from "@/utils/format";

/* ==========================================================================
   Browser state

   Only what outlives a window lives here: tabs, history, bookmarks, downloads
   and preferences. Navigation itself is owned by the Scramjet frames in
   src/services/scramjet, one per tab, which is why nothing in this store talks
   about iframes, proxies or cloaking any more.
   ========================================================================== */

export type SearchEngine = "duckduckgo" | "google" | "bing" | "wikipedia";

/**
 * The browser's own stance on the proxy, layered on top of the OS-wide toggle:
 * `inherit` follows the system setting, `on` forces the proxy for every tab, and
 * `off` loads everything directly in this window.
 */
export type ProxyMode = "inherit" | "on" | "off";

export const searchEngines: Record<SearchEngine, { name: string; query: (value: string) => string }> =
  {
    duckduckgo: { name: "DuckDuckGo", query: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
    google: { name: "Google", query: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
    bing: { name: "Bing", query: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
    wikipedia: {
      name: "Wikipedia",
      query: (q) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
    },
  };

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  at: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  createdAt: number;
}

export interface DownloadRecord {
  id: string;
  name: string;
  url: string;
  at: number;
  size?: number;
  /** Recorded when the file is actually saved into the CrystalOS filesystem. */
  savedToFiles?: boolean;
}

interface BrowserState {
  tabs: BrowserTab[];
  activeTabId: string | null;

  history: HistoryEntry[];
  bookmarks: Bookmark[];
  downloads: DownloadRecord[];
  searchEngine: SearchEngine;
  homepage: string;
  proxyMode: ProxyMode;

  newTab: (url?: string, activate?: boolean) => string;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  setActiveTab: (id: string) => void;
  /** Resolves address-bar input and points the tab at it. */
  navigate: (id: string, input: string) => { ok: boolean; error?: string; url: string };
  /** Records the URL a frame actually settled on. */
  settleTab: (id: string, url: string) => void;
  updateTab: (id: string, patch: Partial<BrowserTab>) => void;
  /**
   * Loads the tab directly in this window instead of through Scramjet. This is
   * the fallback for a proxy that is not running: the page still opens inside
   * the OS, in this tab, rather than in the user's own browser.
   */
  setDirectMode: (id: string, direct: boolean) => void;
  reorderTabs: (from: number, to: number) => void;

  addHistory: (url: string, title: string) => void;
  clearHistory: () => void;
  removeHistoryEntry: (id: string) => void;
  toggleBookmark: (url: string, title: string) => void;
  removeBookmark: (id: string) => void;
  addDownload: (record: Omit<DownloadRecord, "id" | "at">) => void;
  markDownloadSaved: (id: string) => void;
  clearDownloads: () => void;

  setSearchEngine: (engine: SearchEngine) => void;
  setHomepage: (homepage: string) => void;
  setProxyMode: (mode: ProxyMode) => void;
  reset: () => void;
}

const DEFAULT_HOME = "about:crystal";

const blockedProtocols = ["javascript:", "vbscript:", "file:", "data:text/html"];

/** Rejects address forms that would be unsafe or meaningless to proxy. */
export function blockReason(url: string): string | null {
  const lower = url.toLowerCase();
  if (blockedProtocols.some((protocol) => lower.startsWith(protocol))) {
    return "CrystalOS Browser will not open that address type.";
  }
  return null;
}

/** Normalises address-bar input into either a URL or a search query. */
export function resolveAddress(input: string, engine: SearchEngine): string {
  const value = input.trim();
  if (!value) return DEFAULT_HOME;
  if (value.startsWith("about:")) return value;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return value;
  if (/^localhost(:\d+)?(\/|$)/.test(value)) return `http://${value}`;
  const looksLikeHost =
    /^[\w-]+(\.[\w-]+)+((:\d+)?(\/\S*)?)?$/.test(value) && !value.includes(" ");
  if (looksLikeHost) return `https://${value}`;
  return searchEngines[engine].query(value);
}

function createTab(url: string, title: string): BrowserTab {
  return {
    id: createId("tab"),
    title,
    url,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    nonce: 0,
  };
}

export const useBrowserStore = create<BrowserState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,

      history: [],
      bookmarks: [],
      downloads: [],
      searchEngine: "duckduckgo",
      homepage: DEFAULT_HOME,
      proxyMode: "inherit",

      newTab: (url, activate = true) => {
        const target = url ?? get().homepage;
        const tab = createTab(target, prettyTitle(target));
        set({
          tabs: [...get().tabs, tab],
          activeTabId: activate ? tab.id : get().activeTabId,
        });
        return tab.id;
      },

      closeTab: (id) => {
        const tabs = get().tabs.filter((tab) => tab.id !== id);
        const activeTabId =
          get().activeTabId === id
            ? (tabs[tabs.length - 1]?.id ?? null)
            : get().activeTabId;
        set({ tabs, activeTabId });
      },

      closeOtherTabs: (id) => {
        const keep = get().tabs.filter((tab) => tab.id === id);
        set({ tabs: keep, activeTabId: keep[0]?.id ?? null });
      },

      setActiveTab: (activeTabId) => set({ activeTabId }),

      navigate: (id, input) => {
        const value = input.trim();
        if (!value) {
          return { ok: false, error: "Enter an address or search term.", url: "" };
        }
        const url = resolveAddress(value, get().searchEngine);
        const blocked = blockReason(url);
        const title = prettyTitle(url);
        // A newly typed address always goes back through the proxy: direct mode
        // is a per-address decision, not a sticky mode the user can forget.
        get().updateTab(id, {
          url,
          title,
          direct: false,
          error: blocked ?? undefined,
          loading: !blocked,
        });
        if (blocked) return { ok: false, error: blocked, url };
        if (!url.startsWith("about:")) get().addHistory(url, title);
        return { ok: true, url };
      },

      settleTab: (id, url) => {
        const tab = get().tabs.find((candidate) => candidate.id === id);
        if (!tab || tab.url === url) return;
        const title = prettyTitle(url);
        get().updateTab(id, { url, title, loading: false, error: undefined });
        if (!url.startsWith("about:")) get().addHistory(url, title);
      },

      updateTab: (id, patch) =>
        set({
          tabs: get().tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)),
        }),

      setDirectMode: (id, direct) =>
        set({
          tabs: get().tabs.map((tab) =>
            tab.id === id
              ? {
                  ...tab,
                  direct,
                  error: undefined,
                  loading: direct,
                  // Remounting the pane is what actually switches loaders.
                  nonce: tab.nonce + 1,
                }
              : tab,
          ),
        }),

      reorderTabs: (from, to) => {
        const tabs = [...get().tabs];
        if (from < 0 || from >= tabs.length || to < 0 || to >= tabs.length) return;
        const [moved] = tabs.splice(from, 1);
        tabs.splice(to, 0, moved);
        set({ tabs });
      },

      addHistory: (url, title) => {
        const entry: HistoryEntry = { id: createId("hist"), url, title, at: Date.now() };
        const deduped = get().history.filter((item) => item.url !== url);
        set({ history: [entry, ...deduped].slice(0, 300) });
      },

      clearHistory: () => set({ history: [] }),
      removeHistoryEntry: (id) =>
        set({ history: get().history.filter((entry) => entry.id !== id) }),

      toggleBookmark: (url, title) => {
        const existing = get().bookmarks.find((bookmark) => bookmark.url === url);
        if (existing) {
          set({ bookmarks: get().bookmarks.filter((bookmark) => bookmark.id !== existing.id) });
          return;
        }
        set({
          bookmarks: [
            { id: createId("bkm"), url, title, createdAt: Date.now() },
            ...get().bookmarks,
          ],
        });
      },

      removeBookmark: (id) => set({ bookmarks: get().bookmarks.filter((b) => b.id !== id) }),

      addDownload: (record) =>
        set({
          downloads: [{ ...record, id: createId("dwn"), at: Date.now() }, ...get().downloads].slice(0, 60),
        }),

      markDownloadSaved: (id) =>
        set({
          downloads: get().downloads.map((record) =>
            record.id === id ? { ...record, savedToFiles: true } : record,
          ),
        }),

      clearDownloads: () => set({ downloads: [] }),

      setSearchEngine: (searchEngine) => set({ searchEngine }),
      setHomepage: (homepage) => set({ homepage }),
      setProxyMode: (proxyMode) => set({ proxyMode }),
      reset: () =>
        set({ tabs: [], activeTabId: null, history: [], bookmarks: [], downloads: [] }),
    }),
    {
      name: "browser",
      version: 2,
      storage: jsonStorageFor<BrowserState>(),
      /** v2 dropped the tab-cloaking and hand-rolled proxy preferences. */
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version < 2) {
          delete state.cloak;
          delete state.cloakPresets;
          delete state.proxy;
          delete state.curlMode;
          delete state.stacks;
          delete state.tabs;
          delete state.activeTabId;
        }
        return state as unknown as BrowserState;
      },
      partialize: (state) =>
        ({
          history: state.history,
          bookmarks: state.bookmarks,
          downloads: state.downloads,
          searchEngine: state.searchEngine,
          homepage: state.homepage,
          proxyMode: state.proxyMode,
        }) as BrowserState,
    },
  ),
);

export function prettyTitle(url: string): string {
  if (url.startsWith("about:")) return url;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

export { DEFAULT_HOME };
