import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AppIcon, Icon } from "@/icons/Icon";
import { Badge } from "@/components/ui";
import { appCatalog } from "@/apps/catalog";
import { isImplemented } from "@/apps/registry";
import { useAppsStore } from "@/state/apps";
import { useShellStore } from "@/state/shell";
import { useWindowStore } from "@/state/windows";
import { APP_DRAG_TYPE, lockSession, openApp, powerOff, sleepSession } from "@/services/os";
import { APP_CATEGORY_LABEL, type AppCategory } from "@/types";
import { useSystemStore } from "@/state/system";
import { useElementTheme } from "@/themes/scope";

/* ==========================================================================
   Launcher — "All Apps"

   Visual language follows the supplied All Apps design: a glass panel holding a
   search row, category pills, an artwork grid, and a bottom bar that pairs a
   Recent strip with a status row (Settings · List view · key hints · system
   actions).

   Behaviour is the shell's own and is unchanged: type to filter, arrow keys to
   move, Enter to launch, Escape to dismiss, right-click for the application
   menu, and dragging a tile out places a desktop shortcut.

   The panel is drawn over the live desktop instead of the design's page
   background, because in the OS the wallpaper behind it belongs to the user.
   ========================================================================== */

const CATEGORIES: (AppCategory | "all")[] = [
  "all",
  "system",
  "internet",
  "media",
  "games",
  "productivity",
  "utilities",
];

export function Launcher() {
  const open = useShellStore((state) => state.launcherOpen);
  const setOpen = useShellStore((state) => state.setLauncherOpen);
  const closeContextMenu = useShellStore((state) => state.closeContextMenu);
  const config = useShellStore((state) => state.launcher);
  const setConfig = useShellStore((state) => state.setLauncher);
  const overlayTheme = useElementTheme("overlays");

  const recents = useAppsStore((state) => state.recents);
  const launchCounts = useAppsStore((state) => state.launchCounts);
  const removed = useAppsStore((state) => state.removed);
  const performanceMode = useSystemStore((state) => state.performanceMode);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AppCategory | "all">("all");
  const [cursor, setCursor] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const available = useMemo(
    () => appCatalog.filter((app) => !removed.includes(app.id)),
    [removed],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return available.filter((app) => {
      if (category !== "all" && app.category !== category) return false;
      if (!term) return true;
      return (
        app.name.toLowerCase().includes(term) ||
        app.id.includes(term) ||
        app.summary.toLowerCase().includes(term) ||
        APP_CATEGORY_LABEL[app.category].toLowerCase().includes(term)
      );
    });
  }, [available, category, query]);

  /** Frequently used first, then alphabetical. */
  const ordered = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const usesA = launchCounts[a.id] ?? 0;
      const usesB = launchCounts[b.id] ?? 0;
      if (usesA !== usesB) return usesB - usesA;
      return a.name.localeCompare(b.name);
    });
  }, [filtered, launchCounts]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      closeContextMenu();
      const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open, closeContextMenu]);

  useEffect(() => {
    setCursor(0);
  }, [query, category]);

  const launch = useCallback(
    (appId: string) => {
      openApp(appId);
      setOpen(false);
    },
    [setOpen],
  );

  /* Right-clicking an application in the launcher offers the same actions the
     dock does, and dragging it out places a shortcut on the desktop. */
  const onAppContextMenu = useCallback((appId: string, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    useShellStore.getState().openContextMenu({
      x: event.clientX,
      y: event.clientY,
      target: "app",
      payload: { appId },
    });
  }, []);

  const onAppDragStart = useCallback((appId: string, event: ReactDragEvent<HTMLElement>) => {
    event.dataTransfer.setData(APP_DRAG_TYPE, appId);
    event.dataTransfer.effectAllowed = "copy";
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        setCursor((current) => Math.min(current + 1, ordered.length - 1));
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        setCursor((current) => Math.max(current - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const target = ordered[cursor];
        if (target) launch(target.id);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const index = CATEGORIES.indexOf(category);
        setCategory(CATEGORIES[(index + 1) % CATEGORIES.length]);
      }
    },
    [category, cursor, launch, ordered, setOpen],
  );

  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>("[data-cursor='true']");
    element?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const recentApps = recents
    .slice(0, 6)
    .map((appId) => available.find((candidate) => candidate.id === appId))
    .filter((app): app is (typeof available)[number] => Boolean(app));

  /* One setting, three sizes: the grid tile carries the artwork the user
     chose, and the list row and the Recent chips are derived from it so the
     whole panel scales together instead of drifting apart. */
  const iconSize = config.iconSize;
  const listIconSize = Math.max(20, Math.round(iconSize * 0.6));
  const recentIconSize = Math.max(16, Math.round(iconSize * 0.52));

  return (
    <div
      className="cr-launcher"
      data-side="bottom"
      data-element-theme={overlayTheme.themeId ?? undefined}
      style={overlayTheme.style}
      onKeyDown={onKeyDown}
    >
      <div className="cr-launcher__scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <div
        className="cr-launcher__panel"
        role="dialog"
        aria-modal="true"
        aria-label="All applications"
      >
        {/* search -------------------------------------------------------- */}
        <div className="cr-launcher__search">
          <Icon name="search" size={18} className="cr-launcher__search-icon" />
          <input
            ref={inputRef}
            className="cr-launcher__input"
            value={query}
            placeholder="Search applications"
            aria-label="Search applications"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd className="cr-launcher__kbd">Esc</kbd>
        </div>

        {/* category pills ------------------------------------------------ */}
        {config.showCategories && (
          <div className="cr-launcher__categories" role="tablist" aria-label="Application categories">
            {CATEGORIES.map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={category === entry}
                className="cr-launcher__tab"
                data-active={category === entry}
                onClick={() => setCategory(entry)}
              >
                {entry === "all" ? "All" : APP_CATEGORY_LABEL[entry]}
              </button>
            ))}
            <span className="cr-launcher__count cr-num">{ordered.length}</span>
          </div>
        )}

        {/* grid / list --------------------------------------------------- */}
        <div className="cr-launcher__body" ref={listRef}>
          {ordered.length === 0 ? (
            <div className="cr-empty">
              <div className="cr-empty__title">No apps found</div>
              <p className="cr-empty__hint">Try a different search term.</p>
              <button
                type="button"
                className="cr-launcher__reset"
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                }}
              >
                Reset filters
              </button>
            </div>
          ) : config.layout === "list" ? (
            <ul className="cr-launcher__list">
              {ordered.map((app, index) => (
                <li key={app.id}>
                  <button
                    type="button"
                    className="cr-launcher__row"
                    data-cursor={index === cursor}
                    onPointerEnter={() => setCursor(index)}
                    onClick={() => launch(app.id)}
                    onContextMenu={(event) => onAppContextMenu(app.id, event)}
                    draggable
                    onDragStart={(event: ReactDragEvent<HTMLElement>) => onAppDragStart(app.id, event)}
                  >
                    <AppIcon appId={app.id} name={app.icon} size={listIconSize} />
                    <span className="cr-launcher__row-text">
                      <span className="cr-launcher__row-name">{app.name}</span>
                      <span className="cr-launcher__row-summary cr-truncate">{app.summary}</span>
                    </span>
                    {!isImplemented(app.id) && <Badge tone="warning">Not bundled</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div
              className="cr-launcher__grid"
              style={{ "--launcher-tile": `${config.tileSize}px` } as CSSProperties}
            >
              {ordered.map((app, index) => (
                <button
                  key={app.id}
                  type="button"
                  className="cr-launcher__tile"
                  data-cursor={index === cursor}
                  onPointerEnter={() => setCursor(index)}
                  onClick={() => launch(app.id)}
                  onContextMenu={(event) => onAppContextMenu(app.id, event)}
                  draggable
                  onDragStart={(event: ReactDragEvent<HTMLElement>) => onAppDragStart(app.id, event)}
                  title={app.summary}
                >
                  <span className="cr-launcher__tile-icon">
                    <AppIcon appId={app.id} name={app.icon} size={iconSize} />
                  </span>
                  <span className="cr-launcher__tile-name cr-clamp-2">{app.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* bottom bar ---------------------------------------------------- */}
        <div className="cr-launcher__footer">
          {config.showRecents && recentApps.length > 0 && !query && category === "all" && (
            <div className="cr-launcher__recent-row">
              <span className="cr-launcher__recent-label">Recent</span>
              <div className="cr-launcher__recent-icons">
                {recentApps.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    className="cr-launcher__recent"
                    title={app.name}
                    aria-label={app.name}
                    onClick={() => launch(app.id)}
                  >
                    <AppIcon appId={app.id} name={app.icon} size={recentIconSize} />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="cr-launcher__status-row">
            <div className="cr-launcher__status-group">
              <button
                type="button"
                className="cr-launcher__status-btn"
                onClick={() => launch("settings")}
              >
                <Icon name="settings" size={14} />
                Settings
              </button>
              <span className="cr-launcher__sep-v" aria-hidden="true" />
              <button
                type="button"
                className="cr-launcher__status-btn"
                title="Toggle list view"
                onClick={() => setConfig({ layout: config.layout === "grid" ? "list" : "grid" })}
              >
                <Icon name={config.layout === "grid" ? "list" : "grid"} size={14} />
                {config.layout === "grid" ? "List view" : "Grid view"}
              </button>
            </div>

            {!performanceMode && (
              <div className="cr-launcher__hints">
                <span className="cr-launcher__hint">
                  <span className="cr-launcher__kbd">↑↓</span> move
                </span>
                <span className="cr-launcher__hint">
                  <span className="cr-launcher__kbd">↵</span> open
                </span>
                <span className="cr-launcher__hint">
                  <span className="cr-launcher__kbd">Tab</span> categories
                </span>
              </div>
            )}

            <div className="cr-launcher__system">
              <button
                type="button"
                className="cr-launcher__sys-btn"
                title="Lock screen"
                aria-label="Lock screen"
                onClick={() => {
                  lockSession();
                  setOpen(false);
                }}
              >
                <Icon name="lock" size={16} />
              </button>
              <button
                type="button"
                className="cr-launcher__sys-btn"
                title="Sleep"
                aria-label="Sleep"
                onClick={() => {
                  sleepSession();
                  setOpen(false);
                }}
              >
                <Icon name="sleep" size={16} />
              </button>
              <button
                type="button"
                className="cr-launcher__sys-btn"
                title="Restart session"
                aria-label="Restart session"
                onClick={() => {
                  useWindowStore.getState().closeAll();
                  setOpen(false);
                }}
              >
                <Icon name="restart" size={16} />
              </button>
              <button
                type="button"
                className="cr-launcher__sys-btn cr-launcher__sys-btn--power"
                title="Shut down"
                aria-label="Shut down"
                onClick={() => {
                  powerOff();
                  setOpen(false);
                }}
              >
                <Icon name="power" size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
