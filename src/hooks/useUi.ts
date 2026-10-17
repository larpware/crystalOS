import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useAppearanceStore } from "@/state/appearance";
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
