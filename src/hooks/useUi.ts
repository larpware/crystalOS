import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useAppearanceStore } from "@/state/appearance";
import { useShellStore } from "@/state/shell";
import { useWindowStore } from "@/state/windows";
import { useWorkspaceStore } from "@/state/workspaces";
import { viewportInOsSpace } from "@/window-manager/geometry";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/**
 * Size of the desktop in OS layout pixels.
 *
 * The shell runs inside `:root { zoom: var(--os-scale) }`, so the usable
 * desktop is the viewport divided by the current UI scale — 1440 px of browser
 * viewport is 960 OS pixels at 150%. Work areas, maximized geometry and widget
 * bounds are all measured in that space, so this hook reports it rather than
 * the raw viewport. The division itself is a pure function in
 * `window-manager/geometry`, where it is covered by tests.
 */
export function useViewport(): { width: number; height: number } {
  const osScale = useAppearanceStore((state) => state.osScale);
  const [raw, setRaw] = useState(() => ({
    width: typeof window === "undefined" ? 1440 : window.innerWidth,
    height: typeof window === "undefined" ? 900 : window.innerHeight,
  }));

  /*
   * The size is set straight from the event rather than through a
   * requestAnimationFrame hop. Browsers already coalesce `resize` to one event
   * per frame, so the hop bought nothing — but it cost something real: where
   * frames do not arrive (an embedded webview, a background tab), the work area
   * never followed the window, and maximized windows kept the geometry of a
   * screen that no longer existed. Reading innerWidth in a resize handler needs
   * no layout, so there is nothing to thrash.
   */
  useEffect(() => {
    const update = () => setRaw({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return useMemo(
    () => viewportInOsSpace(raw.width, raw.height, osScale),
    [osScale, raw.height, raw.width],
  );
}

/** Fires when a pointer press lands outside every supplied element. */
export function useClickOutside(
  refs: Array<RefObject<HTMLElement | null>>,
  handler: () => void,
  active = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      for (const ref of refs) {
        if (ref.current && ref.current.contains(target)) return;
      }
      handlerRef.current();
    };
    // Defer so the press that opened the surface does not immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [refs, active]);
}

export function useEscape(handler: () => void, active = true): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handlerRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);
}

export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

export function useElementSize<T extends HTMLElement>(): [
  RefObject<T | null>,
  { width: number; height: number },
] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(element);
    setSize({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

/**
 * Border-box size of an element, including padding and border. `useElementSize`
 * reports the content box, which is the wrong measurement for reserving space.
 */
export function useElementBox<T extends HTMLElement>(): [
  RefObject<T | null>,
  { width: number; height: number },
] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize((current) =>
        current.width === Math.round(rect.width) && current.height === Math.round(rect.height)
          ? current
          : { width: Math.round(rect.width), height: Math.round(rect.height) },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

/** Tracks whether the document is currently visible. */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/** Which edge of the screen is currently holding the shell's chrome open. */
type ChromeReveal = "" | "top" | "bottom" | "both";

/**
 * Full screen owns the viewport, so the shell's own chrome stands aside for it.
 *
 * While a window is in full screen the top panel and the dock leave the screen
 * rather than sitting on top of the application — and they slide back the
 * moment the pointer touches the edge they live on, so neither is ever more
 * than one gesture away. Pointer events that land on a full-screen application
 * arrive at its frame element and bubble to the document, so a single listener
 * is enough to watch the pointer approach an edge even when the application is
 * an embedded frame.
 *
 * The reveal is held until the pointer has travelled past the bar it opened,
 * not merely out of the few-pixel edge strip: the bar slides out from under the
 * cursor, and a reveal keyed only to the strip would see it leave and close
 * again — and again — while the pointer sat still.
 *
 * Shell surfaces opened from the keyboard (the launcher, quick settings, the
 * notification centre and the palette) hold both bars open for as long as they
 * are up, because the panel and the dock are where those surfaces are read and
 * dismissed. The state is published on the root as `data-fullscreen` and
 * `data-fullscreen-reveal`, which is all the stylesheet needs; on a normal desk
 * the flag reads "off" and none of the auto-hide CSS applies.
 */
export function useFullScreenChrome(): void {
  const windows = useWindowStore((state) => state.windows);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeId);
  const overlaysOpen = useShellStore(
    (state) =>
      state.launcherOpen ||
      state.quickSettingsOpen ||
      state.notificationCenterOpen ||
      state.commandPaletteOpen,
  );

  /* A full-screen window on a workspace that is not in front is off the desk
     exactly like any other hidden window, so it does not take the chrome with
     it. Sticky windows belong to every workspace. */
  const active = useMemo(
    () =>
      windows.some(
        (window) =>
          window.full === true &&
          !window.minimized &&
          (window.sticky === true ||
            !window.workspaceId ||
            window.workspaceId === activeWorkspaceId),
      ),
    [activeWorkspaceId, windows],
  );

  const [reveal, setReveal] = useState<ChromeReveal>("");

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.fullscreen = active ? "on" : "off";
    // Entering or leaving the mode, and opening a keyboard-driven surface, both
    // settle the reveal here; after that the pointer owns it until either
    // changes again.
    if (!active || overlaysOpen) setReveal(overlaysOpen && active ? "both" : "");
  }, [active, overlaysOpen]);

  useEffect(() => {
    const root = document.documentElement;
    if (reveal) root.dataset.fullscreenReveal = reveal;
    else delete root.dataset.fullscreenReveal;
  }, [reveal]);

  useEffect(() => {
    if (!active || overlaysOpen) return;

    /** Pixels from the edge that count as reaching for a bar. */
    const EDGE = 6;
    /** How far past its own edge a revealed bar still counts as under the
        pointer — a little more than any bar is tall, so crossing its lip does
        not close it the instant it opens. */
    const REACH = 20;
    let open: ChromeReveal = "";

    const apply = (next: ChromeReveal) => {
      if (next === open) return;
      open = next;
      setReveal(next);
    };

    const barHeight = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return 0;
      // The bounding rect, not offsetHeight: the shell runs inside a zoomed
      // root, the pointer reports viewport pixels, and the rect is the one
      // measured in them. A translate changes the position and leaves the
      // height alone, so this reads the same with the bar away or open.
      return element.getBoundingClientRect().height;
    };

    const onPointerMove = (event: PointerEvent) => {
      const height = window.innerHeight;
      const y = event.clientY;
      let next: ChromeReveal = "";
      if (y <= EDGE) next = "top";
      else if (y >= height - EDGE) next = "bottom";
      else if (open === "top" && y <= barHeight(".cr-panel") + REACH) next = "top";
      else if (open === "bottom" && y >= height - barHeight(".cr-taskbar") - REACH)
        next = "bottom";
      apply(next);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerMove);
      open = "";
    };
  }, [active, overlaysOpen]);
}
