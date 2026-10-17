import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { AppIcon } from "@/icons/Icon";
import { metaFor } from "@/apps/catalog";
import { useShellStore } from "@/state/shell";
import { useWindowStore } from "@/state/windows";
import { APP_DRAG_TYPE, activateApp } from "@/services/os";
import { useElementBox } from "@/hooks/useUi";

/* ==========================================================================
   Taskbar

   One strip pinned to the bottom edge: a slim glass bar holding rounded
   artwork tiles with a running dot beneath each open application. Hovering a
   tile lifts and enlarges it, raises its name above the strip and brightens
   its dot; a click presses the tile down while the window opens.

   `mode: "taskbar"` keeps the same tiles but stretches the strip across the
   screen edge and names each application inline. The All Apps box can sit at
   the left, in the middle, or at the right of the strip (Settings → Taskbar →
   All Apps position). Each tile is the application's own local PNG artwork;
   a missing file falls back to the drawn glyph.
   ========================================================================== */

interface TaskbarItem {
  appId: string;
  /** The dock's own PNG tile for this application. */
  icon: string;
}

const taskbarItems: TaskbarItem[] = [
  { appId: "browser", icon: "/icons/taskbar/browser.png" },
  { appId: "drive", icon: "/icons/taskbar/googledrive.png" },
  { appId: "messages", icon: "/icons/taskbar/chat.png" },
  { appId: "games", icon: "/icons/taskbar/crescentgames.png" },
  { appId: "store", icon: "/icons/taskbar/appstore.png" },
  { appId: "terminal", icon: "/icons/taskbar/terminal.png" },
  { appId: "settings", icon: "/icons/taskbar/Settings.png" },
];

interface LabeledTaskbarItem extends TaskbarItem {
  name: string;
}

/** Each taskbar item paired with the name the catalogue exposes for it. */
const labeledTaskbarItems: LabeledTaskbarItem[] = taskbarItems.map((item) => ({
  ...item,
  name: metaFor(item.appId)?.name ?? item.appId,
}));

interface HoverCard {
  appId: string;
  /** Viewport coordinates of the hovered tile. */
  x: number;
  y: number;
}

/**
 * The All Apps mark: nine dots on a three-by-three grid.
 *
 * Inline SVG rather than a bitmap on purpose — it decodes as vector geometry
 * with no image request, cannot blur at any tile size, and inherits the dock's
 * light ink through `currentColor`.
 */
function AllAppsGlyph({ size }: { size: number }) {
  const dots = [5, 12, 19];
  return (
    <svg
      className="cr-taskbar__all-apps-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {dots.map((y) => dots.map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.7} fill="currentColor" />))}
    </svg>
  );
}

export function Taskbar() {
  const dock = useShellStore((state) => state.dock);
  const setLauncherOpen = useShellStore((state) => state.setLauncherOpen);
  const windows = useWindowStore((state) => state.windows);
  const focusWindow = useWindowStore((state) => state.focus);
  const restoreWindow = useWindowStore((state) => state.restore);

  const [hovered, setHovered] = useState<HoverCard | null>(null);
  /** Artwork that failed to load, so the tile can fall back to the drawn icon. */
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  // The strip reports the box it occupies so the desktop's safe area covers
  // the visible surface exactly and windows never sit under the taskbar.
  const [stripRef, stripBox] = useElementBox<HTMLDivElement>();
  const setDockSize = useShellStore((state) => state.setDockSize);
  useEffect(() => {
    if (stripBox.width === 0 && stripBox.height === 0) return;
    setDockSize({ width: Math.round(stripBox.width), height: Math.round(stripBox.height) });
  }, [setDockSize, stripBox.height, stripBox.width]);

  const runningByApp = useMemo(() => {
    const map = new Map<string, number>();
    for (const window of windows) {
      map.set(window.appId, (map.get(window.appId) ?? 0) + 1);
    }
    return map;
  }, [windows]);

  /* Focusing, restoring and launching is the OS service's job, so a dock tile
     and a context menu item behave identically. */
  const activate = useCallback((appId: string) => activateApp(appId), []);

  /** Right-click: the dock's own menu for that application. */
  const openMenu = useCallback((appId: string, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    // The desktop's handler must not claim this one as a desktop menu.
    event.stopPropagation();
    setHovered(null);
    useShellStore.getState().openContextMenu({
      x: event.clientX,
      y: event.clientY,
      target: "dock",
      payload: { appId },
    });
  }, []);

  const showHover = useCallback((appId: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setHovered({ appId, x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  const hoveredWindows = hovered ? windows.filter((window) => window.appId === hovered.appId) : [];

  const style = useMemo(
    () => {
      const alignMap: Record<string, string> = { left: "flex-start", center: "center", right: "flex-end" };
      return {
        /* --tb-base is the user's tile size. shell.css multiplies it by
           --tb-scale, which the viewport queries there turn down when the
           window is smaller than the screen. */
        "--tb-base": `${dock.iconSize}px`,
        "--tb-gap": `${dock.mode === "dock" ? dock.dockGap : dock.taskbarGap}px`,
        "--tb-pad": `${dock.padding}px`,
        "--tb-extra": `${dock.height}px`,
        "--tb-surface-opacity": `${Math.round(dock.opacity * 100)}%`,
        "--tb-radius": `${dock.borderRadius ?? 16}px`,
        "--tb-align": alignMap[dock.align ?? "center"],
      } as CSSProperties;
    },
    [dock.dockGap, dock.taskbarGap, dock.height, dock.iconSize, dock.opacity, dock.padding, dock.borderRadius, dock.align, dock.mode],
  );

  const showLabels = dock.mode !== "dock" && dock.showAppNames !== false;

  const tiles = labeledTaskbarItems.map((item) => {
    const { appId, name, icon } = item;
    const meta = metaFor(appId);
    const open = (runningByApp.get(appId) ?? 0) > 0;
    return (
      <button
        key={appId}
        type="button"
        className="cr-taskbar__item"
        data-open={open}
        data-hovered={hovered?.appId === appId}
        onClick={() => activate(appId)}
        onPointerEnter={(event) => showHover(appId, event.currentTarget)}
        onFocus={(event) => showHover(appId, event.currentTarget)}
        onBlur={() => setHovered(null)}
        onContextMenu={(event) => openMenu(appId, event)}
        /* An application can be dragged out of the dock onto the desktop,
           which places a shortcut where it lands. */
        draggable
        onDragStart={(event: ReactDragEvent<HTMLElement>) => {
          event.dataTransfer.setData(APP_DRAG_TYPE, appId);
          event.dataTransfer.effectAllowed = "copy";
          setHovered(null);
        }}
        aria-label={`${name}${open ? " (running)" : ""}`}
      >
        <span className="cr-taskbar__tile">
          {broken[appId] || !meta ? (
            <span className="cr-taskbar__icon cr-taskbar__icon--fallback">
              <AppIcon appId={appId} name={meta?.icon ?? "question"} size={dock.iconSize} plain />
            </span>
          ) : (
            <img
              className="cr-taskbar__icon"
              src={icon}
              alt=""
              draggable={false}
              decoding="async"
              onError={() => setBroken((current) => ({ ...current, [appId]: true }))}
            />
          )}
        </span>
        {showLabels && <span className="cr-taskbar__label cr-truncate">{name}</span>}
        <span className="cr-taskbar__dot" data-visible={open} aria-hidden="true" />
      </button>
    );
  });

  const separator = (key: string) => <span key={key} className="cr-taskbar__sep" aria-hidden="true" />;

  const allApps = (
    <button
      key="__all-apps__"
      type="button"
      className="cr-taskbar__item cr-taskbar__item--all-apps"
      data-hovered={hovered?.appId === "__all-apps__"}
      onClick={() => setLauncherOpen(true)}
      onPointerEnter={(event) => showHover("__all-apps__", event.currentTarget)}
      onFocus={(event) => showHover("__all-apps__", event.currentTarget)}
      onBlur={() => setHovered(null)}
      aria-label="All Apps"
    >
      <span className="cr-taskbar__tile cr-taskbar__tile--all-apps">
        <AllAppsGlyph size={Math.round(dock.iconSize * 0.56)} />
      </span>
      {showLabels && <span className="cr-taskbar__label">All Apps</span>}
      <span className="cr-taskbar__dot" aria-hidden="true" />
    </button>
  );

  /* Applications are grouped the way the reference dock groups them: the app
     row, a hairline, then the system pair. All Apps gets its own hairline at
     whichever end the setting places it. */
  const settingsIndex = labeledTaskbarItems.findIndex((item) => item.appId === "settings");
  const appRow: ReactNode[] = [];
  tiles.forEach((tile, index) => {
    if (index === settingsIndex && index > 0) appRow.push(separator("sep-settings"));
    appRow.push(tile);
  });

  const position = dock.allAppsPosition ?? "left";
  const middle = Math.ceil(appRow.length / 2);
  const content =
    position === "right"
      ? [...appRow, separator("sep-all"), allApps]
      : position === "center"
        ? [...appRow.slice(0, middle), separator("sep-all-a"), allApps, separator("sep-all-b"), ...appRow.slice(middle)]
        : [allApps, separator("sep-all"), ...appRow];

  return (
    <nav
      className="cr-taskbar"
      data-mode={dock.mode ?? "dock"}
      data-align={dock.align ?? "center"}
      aria-label="Taskbar"
      onPointerLeave={() => setHovered(null)}
    >
      <div className="cr-taskbar__strip" ref={stripRef} style={style} data-mode={dock.mode ?? "dock"}>
        {content}
      </div>

      {hovered && (
        <div
          className="cr-taskbar__hover"
          role="tooltip"
          data-kind={hoveredWindows.length > 0 ? "previews" : "label"}
          style={{ "--hover-x": `${hovered.x}px`, "--hover-y": `${hovered.y}px` } as CSSProperties}
        >
          {hoveredWindows.length > 0 ? (
            <ul className="cr-taskbar__previews">
              {hoveredWindows.map((window) => (
                <li key={window.id}>
                  <button
                    type="button"
                    className="cr-taskbar__preview"
                    data-focused={window.focused}
                    onClick={() => {
                      if (window.minimized) restoreWindow(window.id);
                      focusWindow(window.id);
                      setHovered(null);
                    }}
                  >
                    <span className="cr-taskbar__preview-title cr-truncate">{window.title}</span>
                    {window.minimized && <span className="cr-taskbar__preview-tag">minimized</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <span className="cr-taskbar__hover-label">
              {hovered.appId === "__all-apps__" ? "All Apps" : metaFor(hovered.appId)?.name ?? hovered.appId}
            </span>
          )}
        </div>
      )}
    </nav>
  );
}
