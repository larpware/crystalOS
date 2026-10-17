import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AppIcon } from "@/icons/Icon";
import { Badge, Button, Chip, IconButton, Tooltip } from "@/components/ui";
import { appCatalog } from "@/apps/catalog";
import { isImplemented } from "@/apps/registry";
import { useAppsStore } from "@/state/apps";
import { useShellStore } from "@/state/shell";
import { useWindowStore } from "@/state/windows";
import { APP_DRAG_TYPE, lockSession, openApp, powerOff, sleepSession } from "@/services/os";
import { APP_CATEGORY_LABEL, type AppCategory } from "@/types";
import { useSystemStore } from "@/state/system";

/* ==========================================================================
   Launcher

   Fast to open and keyboard-first: type to filter, arrow keys to move, Enter to
   launch, Escape to dismiss. Layout follows the dock position so it always
   opens where the user's attention already is.
   ========================================================================== */

export function Launcher() {
  const open = useShellStore((state) => state.launcherOpen);
  const setOpen = useShellStore((state) => state.setLauncherOpen);
  const closeContextMenu = useShellStore((state) => state.closeContextMenu);
  const config = useShellStore((state) => state.launcher);
  const setConfig = useShellStore((state) => state.setLauncher);

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
        const categories: (AppCategory | "all")[] = [
          "all",
          "system",
          "internet",
          "media",
          "games",
          "productivity",
          "utilities",
        ];
        const index = categories.indexOf(category);
        setCategory(categories[(index + 1) % categories.length]);
      }
    },
    [category, cursor, launch, ordered, setOpen],
  );

  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>("[data-cursor='true']");
    element?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const categories: (AppCategory | "all")[] = [
    "all",
    "system",
    "internet",
    "media",
    "games",
    "productivity",
    "utilities",
  ];

  return (
    <div className="cr-launcher" data-side="bottom" onKeyDown={onKeyDown}>
      <div className="cr-launcher__scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="cr-launcher__panel" role="dialog" aria-modal="true" aria-label="Application launcher">
        <div className="cr-launcher__search">
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

        {config.showCategories && (
          <div className="cr-launcher__categories">
            {categories.map((entry) => (
              <Chip
                key={entry}
                active={category === entry}
                onClick={() => setCategory(entry)}
              >
                {entry === "all" ? "All" : APP_CATEGORY_LABEL[entry]}
              </Chip>
            ))}
            <span className="cr-launcher__count cr-num">{ordered.length}</span>
          </div>
        )}

        <div className="cr-launcher__body" ref={listRef}>
          {ordered.length === 0 ? (
            <div className="cr-empty">
              <div className="cr-empty__title">No applications match</div>
              <p className="cr-empty__hint">
                Try a different term, or switch back to All to see every installed application.
              </p>
              <Button size="sm" onClick={() => { setQuery(""); setCategory("all"); }}>
                Reset filters
              </Button>
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
                    <AppIcon appId={app.id} name={app.icon} size={26} />
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
            <div className="cr-launcher__grid">
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
                  <AppIcon appId={app.id} name={app.icon} size={46} />
                  <span className="cr-launcher__tile-name cr-clamp-2">{app.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {config.showRecents && recents.length > 0 && !query && category === "all" && (
          <div className="cr-launcher__recents">
            <span className="cr-launcher__recents-label">Recent</span>
            {recents.slice(0, 6).map((appId) => {
              const app = available.find((candidate) => candidate.id === appId);
              if (!app) return null;
              return (
                <Tooltip key={appId} label={app.name}>
                  <button type="button" className="cr-launcher__recent" onClick={() => launch(appId)}>
                    <AppIcon appId={appId} name={app.icon} size={24} />
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}

        <div className="cr-launcher__footer">
          <div className="cr-launcher__footer-group">
            <Button size="sm" variant="ghost" icon="settings" onClick={() => launch("settings")}>
              Settings
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={config.layout === "grid" ? "list" : "grid"}
              onClick={() => setConfig({ layout: config.layout === "grid" ? "list" : "grid" })}
            >
              {config.layout === "grid" ? "List view" : "Grid view"}
            </Button>
            {!performanceMode && (
              <span className="cr-launcher__hint">
                ↑ ↓ to move · Enter to open · Tab for categories
              </span>
            )}
          </div>
          <div className="cr-launcher__footer-group">
            <IconButton icon="lock" label="Lock screen" onClick={() => { lockSession(); setOpen(false); }} />
            <IconButton icon="sleep" label="Sleep" onClick={() => { sleepSession(); setOpen(false); }} />
            <IconButton
              icon="restart"
              label="Restart session"
              onClick={() => {
                useWindowStore.getState().closeAll();
                setOpen(false);
              }}
            />
            <IconButton icon="power" label="Shut down" onClick={() => { powerOff(); setOpen(false); }} />
          </div>
        </div>
      </div>
    </div>
  );
}
