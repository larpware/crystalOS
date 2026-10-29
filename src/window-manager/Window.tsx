import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Icon } from "@/icons/Icon";
import { panelReservedTop, useShellStore } from "@/state/shell";
import { useSystemStore } from "@/state/system";
import { useWindowStore } from "@/state/windows";
import type { Rect, SnapZone, WindowInstance } from "@/types";
import { WindowChromeContext } from "./titlebarChrome";
import { useElementTheme } from "@/themes/scope";
import { useViewport } from "@/hooks/useUi";
import {
  applyResize,
  constrainToWorkArea,
  detectSnapZone,
  handleCursor,
  isMaximizeZone,
  resizeHandles,
  type ResizeHandle,
} from "./geometry";

/** What the desktop should outline while a window is being dragged. */
export type WindowPreview =
  | { kind: "snap"; zone: SnapZone }
  | { kind: "maximize" }
  | null;

interface WindowProps {
  window: WindowInstance;
  minSize: { width: number; height: number };
  resizable: boolean;
  onPreview: (preview: WindowPreview) => void;
  onContextMenu: (event: ReactPointerEvent<HTMLElement>) => void;
  isClosing?: boolean;
  /** True when the window belongs to a workspace that is not in front. */
  hidden?: boolean;
  children: ReactNode;
}

interface DragSession {
  kind: "move" | "resize";
  handle?: ResizeHandle;
  startX: number;
  startY: number;
  startRect: Rect;
  pointerId: number;
}

/**
 * Pointer capture is best-effort: a webview or an automated synthetic pointer
 * can report an id that is not currently active, and the drag must still work.
 */
function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    /* capture unavailable — the drag still tracks pointermove on the element */
  }
}

function releasePointer(element: HTMLElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    /* nothing to release */
  }
}

export function Window({
  window: instance,
  minSize,
  resizable,
  onPreview,
  onContextMenu,
  isClosing = false,
  hidden = false,
  children,
}: WindowProps) {
  const focus = useWindowStore((state) => state.focus);
  const closeWindow = useWindowStore((state) => state.close);
  const minimize = useWindowStore((state) => state.minimize);
  const toggleMaximize = useWindowStore((state) => state.toggleMaximize);
  const toggleFullScreen = useWindowStore((state) => state.toggleFullScreen);
  const setRect = useWindowStore((state) => state.setRect);
  const snapWindow = useWindowStore((state) => state.snap);
  const storedWorkArea = useWindowStore((state) => state.workArea);
  const panel = useShellStore((state) => state.panel);
  /*
   * The shell publishes the work area from its layout pass; this floors it with
   * the strip the panel reserves right now, so a window can never be dragged,
   * resized or snapped into the top bar — not even on the commit where the bar's
   * own geometry changed. In a settled session the floor is a no-op.
   */
  const workArea = useMemo(() => {
    const top = panelReservedTop(panel.panelScale, panel.style);
    if (storedWorkArea.y >= top) return storedWorkArea;
    const lost = top - storedWorkArea.y;
    return { ...storedWorkArea, y: top, height: Math.max(240, storedWorkArea.height - lost) };
  }, [panel.panelScale, panel.style, storedWorkArea]);

  const performanceMode = useSystemStore((state) => state.performanceMode);
  const windowControls = useShellStore((state) => state.desktop.windowControls);

  const [interacting, setInteracting] = useState(false);
  const sessionRef = useRef<DragSession | null>(null);
  const activePreview = useRef<WindowPreview>(null);

  const isMaximized = instance.state === "maximized";
  const isFull = instance.full === true;
  const rect = instance.rect;
  /* Full screen is measured from the viewport rather than the work area: this is
     the one geometry that deliberately includes the strips the panel and the
     dock reserve everywhere else. */
  const viewport = useViewport();
  /* A per-element theme scopes the whole window, apps included: the tokens land
     as custom properties on the window element, so every surface inside it
     recomputes against the picked palette. */
  const windowTheme = useElementTheme("windows");

  /* The middle of the titlebar belongs to the application if it wants it — see
     window-manager/titlebarChrome. `setReplacesTitle` is a state setter and so
     keeps a stable identity, which is what lets an application ask for the
     title to stand down once, on mount. */
  const [chromeSlot, setChromeSlot] = useState<HTMLElement | null>(null);
  const [titleReplaced, setTitleReplaced] = useState(false);
  const chromeApi = useMemo(
    () => ({ slot: chromeSlot, setReplacesTitle: setTitleReplaced }),
    [chromeSlot],
  );

  /*
   * Geometry is written straight to the store on every pointermove, for the
   * same reason the desktop icons are: the browser already coalesces
   * pointermove to one event per frame, so a requestAnimationFrame hop adds no
   * smoothing — it only adds a way for a stalled compositor to freeze the
   * window mid-drag. Movement itself stays on the compositor: the window is
   * positioned with `transform`, and CSS transitions for the drag are disabled
   * while `data-interacting` is set.
   */
  const applyRect = useCallback((next: Rect) => setRect(instance.id, next), [instance.id, setRect]);

  /* ---- drag ------------------------------------------------------------ */
  const beginMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
      focus(instance.id);

      const fresh = useWindowStore.getState().windows.find((candidate) => candidate.id === instance.id);
      if (!fresh) return;

      /*
       * Dragging a window that is maximized or tiled gives it back its own size
       * under the pointer: the grab keeps the same relative position inside
       * whatever the window was filling, so it does not jump. `setRect` then
       * clears the tile, which is what stops the next work-area change from
       * snapping it back into place.
       */
      if (fresh.state === "maximized" || fresh.state === "snapped") {
        const filled = fresh.state === "maximized" ? workArea : fresh.rect;
        const ratio = (event.clientX - filled.x) / Math.max(1, filled.width);
        const restored = constrainToWorkArea(
          {
            ...fresh.restoreRect,
            x: event.clientX - fresh.restoreRect.width * ratio,
            y: event.clientY - 18,
          },
          workArea,
        );
        setRect(instance.id, restored);
        focus(instance.id);
      }

      const startRect =
        useWindowStore.getState().windows.find((candidate) => candidate.id === instance.id)?.rect ??
        fresh.rect;

      sessionRef.current = {
        kind: "move",
        startX: event.clientX,
        startY: event.clientY,
        startRect,
        pointerId: event.pointerId,
      };
      setInteracting(true);
      capturePointer(event.currentTarget, event.pointerId);
    },
    [focus, instance.id, setRect, workArea],
  );

  /* ---- resize ---------------------------------------------------------- */
  const beginResize = useCallback(
    (handle: ResizeHandle) => (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      focus(instance.id);
      const fresh = useWindowStore.getState().windows.find((candidate) => candidate.id === instance.id);
      if (!fresh || fresh.state === "maximized") return;
      sessionRef.current = {
        kind: "resize",
        handle,
        startX: event.clientX,
        startY: event.clientY,
        startRect: fresh.rect,
        pointerId: event.pointerId,
      };
      setInteracting(true);
      capturePointer(event.currentTarget, event.pointerId);
    },
    [focus, instance.id],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (!session) return;
      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;

      if (session.kind === "resize" && session.handle) {
        applyRect(
          applyResize({ handle: session.handle, startRect: session.startRect, dx, dy, minSize, workArea }),
        );
        return;
      }

      applyRect(
        constrainToWorkArea(
          { ...session.startRect, x: session.startRect.x + dx, y: session.startRect.y + dy },
          workArea,
        ),
      );

      const pointer = { x: event.clientX, y: event.clientY };
      const next: WindowPreview = !resizable
        ? null
        : isMaximizeZone(pointer, workArea)
          ? { kind: "maximize" }
          : (() => {
              const zone = detectSnapZone(pointer, workArea);
              return zone ? { kind: "snap" as const, zone } : null;
            })();

      const changed =
        next?.kind !== activePreview.current?.kind ||
        (next?.kind === "snap" &&
          activePreview.current?.kind === "snap" &&
          next.zone !== activePreview.current.zone);

      if (changed) {
        activePreview.current = next;
        onPreview(next);
      }
    },
    [applyRect, minSize, onPreview, resizable, workArea],
  );

  const endSession = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (!session) return;
      sessionRef.current = null;
      setInteracting(false);

      if (session.kind === "move") {
        const preview = activePreview.current;
        activePreview.current = null;
        onPreview(null);
        if (preview?.kind === "snap") snapWindow(instance.id, preview.zone);
        else if (preview?.kind === "maximize") toggleMaximize(instance.id);
      }

      releasePointer(event.currentTarget, session.pointerId);
    },
    [instance.id, onPreview, snapWindow, toggleMaximize],
  );

  const onTitleDoubleClick = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!resizable) return;
      if ((event.target as HTMLElement).closest("[data-no-drag]")) return;
      toggleMaximize(instance.id);
    },
    [instance.id, resizable, toggleMaximize],
  );

  const titlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      /* A bar is furniture, not content: the browser must not select the
         title's text nor start a native drag of the icon image, either of
         which leaves a ghost that can steal the release this gesture needs.
         This is not a navigation hazard — it keeps the move session clean. */
      event.preventDefault();
      if (event.detail > 1) return;
      beginMove(event);
    },
    [beginMove],
  );

  /*
   * Window controls act on pointer-down, the way native traffic lights do.
   * Acting on `click` was fragile: focusing the window re-renders the title
   * bar mid-gesture, and the pointer sequence could end up resolving against
   * whatever had moved under the cursor. `onClick` stays wired for keyboard
   * activation (Enter and Space synthesise a click with no pointer phase).
   */
  const controlHandlers = useMemo(() => {
    const handle = (run: () => void) => {
      let handledAt = 0;
      return {
        onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          handledAt = Date.now();
          focus(instance.id);
          run();
        },
        onClick: () => {
          // Suppress the click that follows a pointer-down we already handled.
          if (Date.now() - handledAt < 500) return;
          focus(instance.id);
          run();
        },
      };
    };
    return {
      close: handle(() => closeWindow(instance.id)),
      minimize: handle(() => minimize(instance.id)),
      maximize: handle(() => toggleMaximize(instance.id)),
      full: handle(() => toggleFullScreen(instance.id)),
    };
  }, [closeWindow, focus, instance.id, minimize, toggleMaximize, toggleFullScreen]);

  const controls = (
    <div className="cr-window__controls" data-no-drag>
      <button
        type="button"
        className="cr-window__control cr-window__control--close"
        aria-label="Close window"
        title="Close"
        {...controlHandlers.close}
      >
        <Icon name="close" size={8} strokeWidth={2.6} />
      </button>
      <button
        type="button"
        className="cr-window__control cr-window__control--minimize"
        aria-label="Minimize window"
        title="Minimize"
        {...controlHandlers.minimize}
      >
        <Icon name="minimize" size={8} strokeWidth={2.6} />
      </button>
      <button
        type="button"
        className="cr-window__control cr-window__control--maximize"
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        title={isMaximized ? "Restore" : "Maximize"}
        {...controlHandlers.maximize}
      >
        <Icon name={isMaximized ? "restore" : "maximize"} size={8} strokeWidth={2.6} />
      </button>
      {/*
        Not a fourth traffic light: a quiet glyph beside the dots, in the place a
        header bar keeps its own actions. Full screen takes the whole viewport —
        panel and dock included, and both of them stay painted above the window.
      */}
      <button
        type="button"
        className="cr-window__fullscreen"
        aria-label="Full screen"
        title="Full screen — the whole screen, with the dock and panel on top"
        {...controlHandlers.full}
      >
        <Icon name="expand" size={11} strokeWidth={2.2} />
      </button>
    </div>
  );

  // A window on another workspace leaves the desk the same way a minimized one
  // does, and comes back the same way.
  const minimized = instance.minimized || hidden;

  /*
   * A minimized window stays mounted — its application keeps its state, exactly
   * as a native window does — but it leaves the desk: it fades, shrinks a
   * little and drops toward the taskbar, then stops painting and stops taking
   * pointer events. `visibility` is what actually removes it, delayed by the
   * stylesheet until the fade is over so the gesture is visible.
   *
   * Position stays on `transform` while the animation writes the independent
   * `scale`/`translate` properties, so collapsing a window never fights with
   * the transform that places it.
   */
  const style = useMemo(() => {
    const box = isFull ? { x: 0, y: 0, width: viewport.width, height: viewport.height } : rect;
    return {
      transform: `translate3d(${Math.round(box.x)}px, ${Math.round(box.y)}px, 0)`,
      width: Math.round(box.width),
      height: Math.round(box.height),
      zIndex: instance.z,
      opacity: isClosing || minimized ? 0 : 1,
      scale: isClosing ? 0.92 : minimized ? 0.94 : 1,
      translate: minimized ? "0 26px" : "0 0",
      visibility: minimized ? "hidden" : undefined,
      pointerEvents: minimized ? "none" : undefined,
    } as CSSProperties;
  }, [isFull, rect, viewport.height, viewport.width, instance.z, isClosing, minimized]);

  /*
   * Escape leaves full screen the way it does everywhere else. It listens in the
   * bubble phase on purpose: an application that has its own use for Escape — a
   * game opening its menu, a browser leaving pointer lock — stops the event first
   * and keeps it, and an open launcher, quick settings or notification centre
   * swallows the key for itself before this ever sees it.
   */
  useEffect(() => {
    if (!isFull) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || useWindowStore.getState().focusedId !== instance.id) return;
      const shell = useShellStore.getState();
      if (shell.launcherOpen || shell.quickSettingsOpen || shell.notificationCenterOpen) return;
      useWindowStore.getState().toggleFullScreen(instance.id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [instance.id, isFull]);

  return (
    <section
      className={`cr-window${isClosing ? " cr-window--closing" : ""}`}
      data-focused={instance.focused}
      data-state={instance.state}
      data-full={isFull || undefined}
      data-minimized={minimized}
      data-workspace-hidden={hidden || undefined}
      data-interacting={interacting}
      data-controls={windowControls}
      data-motion={performanceMode ? "off" : "on"}
      data-element-theme={windowTheme.themeId ?? undefined}
      style={windowTheme.style ? { ...style, ...windowTheme.style } : style}
      role="dialog"
      aria-label={instance.title}
      aria-hidden={minimized || undefined}
      onPointerDown={() => {
        if (!instance.focused) focus(instance.id);
      }}
      onContextMenu={onContextMenu}
    >
      {/*
        Every way a drag can end is wired here — up, cancel and a lost capture.
        Without the last one a gesture that loses its pointer capture would
        leave the window marked as interacting with no pointer left to finish
        it.
      */}
      <WindowChromeContext.Provider value={chromeApi}>
        {/*
          Full screen has no bar of its own: the shell's top panel is the chrome
          that stays — it carries the application's name and the control that
          leaves full screen — so a second bar at the same edge would only sit
          under it. Everything the bar hosted unmounts with it; an application
          portalling into the slot simply renders nothing.
        */}
        {!isFull && (
          <header
            className="cr-window__titlebar"
            onPointerDown={titlePointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endSession}
            onPointerCancel={endSession}
            onLostPointerCapture={endSession}
            onDoubleClick={onTitleDoubleClick}
          >
            {windowControls === "left" ? controls : null}
            {/*
              The middle of the bar: application chrome when there is any, the
              window's own icon and title when there is not. The slot is always
              rendered so an application has something to portal into on its very
              first paint.
            */}
            <div className="cr-window__lead">
              <div className="cr-window__chrome" ref={setChromeSlot} />
              {!titleReplaced && (
                <div className="cr-window__title">
                  <Icon name={instance.icon} size={13} className="cr-window__title-icon" />
                  <span className="cr-truncate">{instance.title}</span>
                </div>
              )}
            </div>
            {windowControls === "right" ? controls : null}
          </header>
        )}

        <div className="cr-window__body">{children}</div>
      </WindowChromeContext.Provider>

      {resizable && !isMaximized && !isFull && (
        <>
          {resizeHandles.map((handle) => (
            <span
              key={handle}
              className={`cr-window__resize cr-window__resize--${handle}`}
              style={{ cursor: handleCursor[handle] }}
              onPointerDown={beginResize(handle)}
              onPointerMove={onPointerMove}
              onPointerUp={endSession}
              onPointerCancel={endSession}
              onLostPointerCapture={endSession}
            />
          ))}
        </>
      )}
    </section>
  );
}
