import type { FractionalRect, Rect, SnapZone } from "@/types";

/* ==========================================================================
   Window geometry

   Pure functions for snapping and resizing. Keeping the maths out of the
   components keeps the drag handlers thin and the behaviour predictable.

   Like window-manager/layouts, this module has no runtime imports: the type
   import above is erased, and `clamp` is local rather than pulled from
   utils/format. That keeps the module importable by the Node test runner
   (src/window-manager/geometry.test.mjs), so the snap and resize maths is
   covered by tests instead of only by dragging windows around.
   ========================================================================== */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const resizeHandles: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/*
 * Snap regions are measured from the near edge and the remainder is handed to
 * the far one, so an odd work area (1203px wide) still tiles exactly: the left
 * half is 602px and the right half is 601px. Splitting from both edges instead
 * would give each side 602px and the two windows would overlap by a pixel.
 */
export function zoneRect(zone: SnapZone, workArea: Rect): Rect {
  const halfWidth = Math.round(workArea.width / 2);
  const halfHeight = Math.round(workArea.height / 2);
  const farWidth = Math.max(0, workArea.width - halfWidth);
  const farHeight = Math.max(0, workArea.height - halfHeight);
  // The far edge starts where the near one ends, so the two meet exactly.
  const middleX = workArea.x + halfWidth;
  const middleY = workArea.y + halfHeight;

  switch (zone) {
    case "left":
      return { x: workArea.x, y: workArea.y, width: halfWidth, height: workArea.height };
    case "right":
      return { x: middleX, y: workArea.y, width: farWidth, height: workArea.height };
    case "top-left":
      return { x: workArea.x, y: workArea.y, width: halfWidth, height: halfHeight };
    case "top-right":
      return { x: middleX, y: workArea.y, width: farWidth, height: halfHeight };
    case "bottom-left":
      return { x: workArea.x, y: middleY, width: halfWidth, height: farHeight };
    case "bottom-right":
    default:
      return { x: middleX, y: middleY, width: farWidth, height: farHeight };
  }
}

/**
 * Decides which snap target the pointer is currently over.
 *
 * The outer band triggers half-screen snaps; the corners of that band trigger
 * quarter snaps. The top edge maximises instead of snapping.
 */
export function detectSnapZone(
  pointer: { x: number; y: number },
  workArea: Rect,
  band = 34,
): SnapZone | null {
  const nearLeft = pointer.x <= workArea.x + band;
  const nearRight = pointer.x >= workArea.x + workArea.width - band;

  const cornerBand = band * 2.6;
  const inCornerTop =
    pointer.y <= workArea.y + Math.min(cornerBand, workArea.height * 0.28);
  const inCornerBottom =
    pointer.y >= workArea.y + workArea.height - Math.min(cornerBand, workArea.height * 0.28);

  if (nearLeft && inCornerTop) return "top-left";
  if (nearLeft && inCornerBottom) return "bottom-left";
  if (nearRight && inCornerTop) return "top-right";
  if (nearRight && inCornerBottom) return "bottom-right";
  if (nearLeft) return "left";
  if (nearRight) return "right";
  return null;
}

export function isMaximizeZone(pointer: { x: number; y: number }, workArea: Rect, band = 12): boolean {
  return pointer.y <= workArea.y + band;
}

interface ResizeInput {
  handle: ResizeHandle;
  startRect: Rect;
  dx: number;
  dy: number;
  minSize: { width: number; height: number };
  workArea: Rect;
}

/** Applies a pointer delta to a rect for the given handle. */
export function applyResize({
  handle,
  startRect,
  dx,
  dy,
  minSize,
  workArea,
}: ResizeInput): Rect {
  const maxWidth = Math.min(minSize.width, workArea.width);
  const maxHeight = Math.min(minSize.height, workArea.height);

  let { x, y, width, height } = startRect;

  if (handle.includes("e")) {
    width = clamp(startRect.width + dx, maxWidth, workArea.x + workArea.width - startRect.x);
  }
  if (handle.includes("s")) {
    height = clamp(startRect.height + dy, maxHeight, workArea.y + workArea.height - startRect.y);
  }
  if (handle.includes("w")) {
    // The right edge stays put; the left edge moves and the width compensates.
    const right = startRect.x + startRect.width;
    const nextX = clamp(startRect.x + dx, workArea.x, right - maxWidth);
    x = nextX;
    width = right - nextX;
  }
  if (handle.includes("n")) {
    const bottom = startRect.y + startRect.height;
    const nextY = clamp(startRect.y + dy, workArea.y, bottom - maxHeight);
    y = nextY;
    height = bottom - nextY;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Cursor for each handle, used by both the CSS and the drag session. */
export const handleCursor: Record<ResizeHandle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

/* ---- work-area relative geometry ----------------------------------------
 * A snapped window stores its geometry as a fraction of the work area as well
 * as in pixels. The fraction is what survives a viewport change: resizing the
 * browser re-derives the tile instead of leaving a half-screen window at the
 * size of the screen that no longer exists.
 */

/** The same rect expressed as 0..1 of the work area. */
export function fractionOf(rect: Rect, workArea: Rect): FractionalRect {
  const width = Math.max(1, workArea.width);
  const height = Math.max(1, workArea.height);
  return {
    x: (rect.x - workArea.x) / width,
    y: (rect.y - workArea.y) / height,
    width: rect.width / width,
    height: rect.height / height,
  };
}

/**
 * Turns a stored fraction back into pixels for the current work area.
 *
 * A fraction is only meaningful while it stays a fraction: clamping it here
 * would bake in the size of one particular viewport, so pinch values are used
 * verbatim and the result is rounded to whole pixels.
 */
export function rectFromFraction(fraction: FractionalRect, workArea: Rect): Rect {
  return {
    x: Math.round(workArea.x + fraction.x * workArea.width),
    y: Math.round(workArea.y + fraction.y * workArea.height),
    width: Math.round(fraction.width * workArea.width),
    height: Math.round(fraction.height * workArea.height),
  };
}

/* ---- viewport and UI scale ---------------------------------------------- *
 * The whole OS renders inside `:root { zoom: var(--os-scale) }`, so a browser
 * viewport of 1440 CSS px holds only 960 pixels of desktop at 150%. Window
 * geometry, the work area and widget bounds are all expressed in that zoomed
 * space, which is why the raw viewport has to be divided by the scale.
 * Skipping that division is not cosmetic: at 150% a maximized window becomes
 * 1.5x the screen, so its titlebar and window controls leave the viewport and
 * the window can no longer be moved or restored by pointer.
 */
export function viewportInOsSpace(
  width: number,
  height: number,
  scale: number,
): { width: number; height: number } {
  // A zero or nonsense scale would divide by zero; 100% is the safe reading.
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    width: Math.max(320, Math.round(width / factor)),
    height: Math.max(240, Math.round(height / factor)),
  };
}

/**
 * Keeps a dragged window reachable without changing its size.
 *
 * A window is not forced to sit inside the work area — it may hang off the right
 * or bottom edge, the way a desktop lets a window be parked half off-screen —
 * but it always keeps enough of itself on the desk to grab again: at least
 * 140px of width, and the 44px titlebar strip at the top of the window.
 */
export function constrainToWorkArea(rect: Rect, workArea: Rect): Rect {
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - Math.min(rect.width, 140));
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - 44);
  return {
    ...rect,
    x: Math.round(clamp(rect.x, workArea.x, maxX)),
    y: Math.round(clamp(rect.y, workArea.y, maxY)),
  };
}
