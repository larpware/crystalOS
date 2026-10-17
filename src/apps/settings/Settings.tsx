import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Icon, type IconName } from "@/icons/Icon";
import { EmptyState, TextInput } from "@/components/ui";
import type { AppProps } from "@/types";
import { useWindowStore } from "@/state/windows";
import {
  AppearancePage,
  IconsPage,
  LockScreenPage,
  WallpaperPage,
} from "./pages/appearance";
import {
  AllAppsPage,
  ApplicationsPage,
  DockPage,
  KeyboardPage,
  NotificationsPage,
  WidgetsPage,
} from "./pages/shell";
import {
  AboutPage,
  AdvancedPage,
  BrowserPage,
  NetworkPage,
  PerformancePage,
  PowerPage,
  TabIdentityPage,
} from "./pages/system";
import { AccountsPage, MessagingPage, PrivacyPage } from "./pages/account";
import { CreditsPage } from "./pages/credits";
import { PluginsPage } from "./pages/plugins";
import { VpnPage } from "./pages/vpn";

/* ==========================================================================
   Settings

   One page per concern, grouped in a sidebar. Search matches page titles,
   descriptions and the individual keywords each page declares, so typing
   "dock" or "wallpaper" lands on the right page.
   ========================================================================== */

interface SettingsPage {
  id: string;
  label: string;
  icon: IconName;
  group: "Personal" | "Shell" | "System";
  keywords: string[];
  Component: ComponentType;
}

const pages: SettingsPage[] = [
  {
    id: "appearance",
    label: "Appearance",
    icon: "palette",
    group: "Personal",
    keywords: ["theme", "accent", "colour", "color", "scale", "density", "motion", "transparency"],
    Component: AppearancePage,
  },
  {
    id: "wallpaper",
    label: "Wallpaper",
    icon: "wallpaper",
    group: "Personal",
    keywords: ["wallpaper", "background", "live", "dim", "blur", "shuffle", "lock"],
    Component: WallpaperPage,
  },
  {
    id: "lock",
    label: "Lock Screen",
    icon: "lock",
    group: "Personal",
    keywords: ["lock", "login", "clock", "avatar", "power", "password", "screen"],
    Component: LockScreenPage,
  },
  {
    id: "icons",
    label: "Icons",
    icon: "image",
    group: "Personal",
    keywords: ["icon", "pack", "graphics", "applications"],
    Component: IconsPage,
  },
  {
    id: "dock",
    label: "Taskbar",
    icon: "layout",
    group: "Shell",
    keywords: ["dock", "taskbar", "panel", "position", "icons", "autohide", "desktop", "windows"],
    Component: DockPage,
  },
  {
    id: "allapps",
    label: "All Apps",
    icon: "grid",
    group: "Shell",
    keywords: [
      "all apps",
      "launcher",
      "application menu",
      "icon size",
      "tile size",
      "grid",
      "list view",
      "categories",
      "recent",
    ],
    Component: AllAppsPage,
  },
  {
    id: "widgets",
    label: "Widgets",
    icon: "grid",
    group: "Shell",
    keywords: ["widget", "desktop", "drag", "snap", "clock", "calendar", "grid"],
    Component: WidgetsPage,
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: "bell",
    group: "Shell",
    keywords: ["notification", "toast", "banner", "dnd", "do not disturb", "hide", "history"],
    Component: NotificationsPage,
  },
  {
    id: "keyboard",
    label: "Keyboard",
    icon: "keyboard",
    group: "Shell",
    keywords: ["keyboard", "shortcut", "hotkey", "keys", "terminal"],
    Component: KeyboardPage,
  },
  {
    id: "applications",
    label: "Applications",
    icon: "layers",
    group: "Shell",
    keywords: ["application", "app", "install", "remove", "recent"],
    Component: ApplicationsPage,
  },
  {
    id: "performance",
    label: "Performance",
    icon: "gauge",
    group: "System",
    keywords: ["performance", "live wallpaper", "animation", "blur", "refresh", "hz", "fps"],
    Component: PerformancePage,
  },
  {
    id: "browser",
    label: "Browser",
    icon: "browser",
    group: "System",
    keywords: ["browser", "proxy", "scramjet", "transport", "search engine", "home", "wisp"],
    Component: BrowserPage,
  },
  {
    id: "tabIdentity",
    label: "Tab identity",
    icon: "eye-off",
    group: "System",
    keywords: ["cloak", "cloaking", "tab", "title", "favicon", "identity", "preset", "disguise"],
    Component: TabIdentityPage,
  },
  {
    id: "network",
    label: "Network",
    icon: "wifi",
    group: "System",
    keywords: ["network", "wifi", "connection", "online", "memory", "storage", "device"],
    Component: NetworkPage,
  },
  {
    id: "power",
    label: "Power",
    icon: "battery-full",
    group: "System",
    keywords: ["power", "battery", "sleep", "restart", "shutdown", "lock", "dim", "volume", "boot", "startup", "start up", "animation", "splash"],
    Component: PowerPage,
  },
  {
    id: "vpn",
    label: "VPN",
    icon: "shield",
    group: "System",
    keywords: [
      "vpn",
      "crystalvpn",
      "proxy",
      "endpoint",
      "tunnel",
      "privacy",
      "encrypt",
      "server",
      "exit",
      "leak",
      "scramjet",
      "protection",
    ],
    Component: VpnPage,
  },
  {
    id: "privacy",
    label: "Privacy",
    icon: "shield",
    group: "System",
    keywords: ["privacy", "permission", "data", "erase", "storage", "camera", "microphone"],
    Component: PrivacyPage,
  },
  {
    id: "accounts",
    label: "Accounts",
    icon: "user",
    group: "System",
    keywords: ["account", "profile", "guest", "password", "sign in", "sign out", "friend code"],
    Component: AccountsPage,
  },
  {
    id: "messaging",
    label: "Messaging",
    icon: "messages",
    group: "System",
    keywords: ["messaging", "chat", "calls", "webrtc", "transport", "relay", "friends"],
    Component: MessagingPage,
  },
  {
    id: "plugins",
    label: "Plugins",
    icon: "layers",
    group: "System",
    keywords: ["plugin", "extension", "add-on", "manifest", "permission", "install", "recipe", "automation"],
    Component: PluginsPage,
  },
  {
    id: "advanced",
    label: "Advanced",
    icon: "sliders",
    group: "System",
    keywords: ["advanced", "developer", "diagnostics", "export", "import", "reset", "data"],
    Component: AdvancedPage,
  },
  {
    id: "credits",
    label: "Credits",
    icon: "shield",
    group: "System",
    keywords: [
      "credits",
      "credit",
      "licence",
      "license",
      "acknowledgements",
      "attribution",
      "third party",
      "open source",
      "notices",
    ],
    Component: CreditsPage,
  },
  {
    id: "about",
    label: "About",
    icon: "info",
    group: "System",
    keywords: ["about", "version", "build", "runtime", "licence", "license", "acknowledgements"],
    Component: AboutPage,
  },
];

const groups: SettingsPage["group"][] = ["Personal", "Shell", "System"];

function searchPages(query: string): SettingsPage[] {
  const value = query.trim().toLowerCase();
  if (!value) return pages;
  return pages.filter((page) =>
    [page.label, page.group, ...page.keywords].join(" ").toLowerCase().includes(value),
  );
}

export function Settings({ args, windowId }: AppProps) {
  // Deep links arrive as `page` (from inside Settings) or `section` (from the
  // taskbar, desktop menu, quick settings and the browser), and unknown ids
  // fall back to Appearance instead of opening an empty pane.
  const requested =
    typeof args?.page === "string"
      ? args.page
      : typeof args?.section === "string"
        ? args.section
        : "appearance";
  const [pageId, setPageId] = useState(
    pages.some((page) => page.id === requested) ? requested : "appearance",
  );
  const [query, setQuery] = useState("");
  const setWindowTitle = useWindowStore((state) => state.setTitle);
  const contentRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => searchPages(query), [query]);
  const active = matches.find((page) => page.id === pageId) ?? matches[0] ?? null;

  // Jump to the first match while searching, without losing the chosen page.
  const shown = query.trim() ? (matches[0] ?? null) : (pages.find((page) => page.id === pageId) ?? null);

  // The title belongs to *this* window. Using the globally focused window id
  // here renamed whatever window the user focused next.
  useEffect(() => {
    if (!windowId) return;
    const label = shown?.label ?? "Settings";
    setWindowTitle(windowId, `Settings — ${label}`);
  }, [shown, windowId, setWindowTitle]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [shown?.id]);

  return (
    <div className="cr-settings">
      <aside className="cr-settings__aside">
        <div className="cr-settings__search">
          <TextInput
            icon="search"
            value={query}
            placeholder="Search settings"
            aria-label="Search settings"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <nav className="cr-settings__nav" aria-label="Settings sections">
          {query.trim() ? (
            matches.length === 0 ? (
              <p className="cr-settings__none">No settings match “{query}”.</p>
            ) : (
              matches.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className="cr-settings__item"
                  aria-current={shown?.id === page.id}
                  onClick={() => {
                    setPageId(page.id);
                    setQuery("");
                  }}
                >
                  <Icon name={page.icon} size={16} />
                  <span>{page.label}</span>
                  <span className="cr-settings__group-tag">{page.group}</span>
                </button>
              ))
            )
          ) : (
            groups.map((group) => (
              <div key={group} className="cr-settings__group">
                <div className="cr-settings__group-title">{group}</div>
                {pages
                  .filter((page) => page.group === group)
                  .map((page) => (
                    <button
                      key={page.id}
                      type="button"
                      className="cr-settings__item"
                      aria-current={page.id === pageId}
                      onClick={() => setPageId(page.id)}
                    >
                      <Icon name={page.icon} size={16} />
                      <span>{page.label}</span>
                    </button>
                  ))}
              </div>
            ))
          )}
        </nav>
      </aside>

      <div className="cr-settings__content" ref={contentRef}>
        {shown ? (
          <article className="cr-settings__page">
            <header className="cr-settings__page-head">
              <h2>
                <Icon name={shown.icon} size={18} /> {shown.label}
              </h2>
            </header>
            <shown.Component />
          </article>
        ) : (
          <EmptyState
            icon="search"
            title="Nothing found"
            hint="Try a different term — search covers every settings page, including Dock, Wallpaper and Notifications."
          />
        )}
        {active === null && query.trim() === "" && (
          <p className="cr-settings__none">That section is unavailable in this build.</p>
        )}
      </div>
    </div>
  );
}

export default Settings;
