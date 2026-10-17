import type { Rect } from "@/types";

/* ==========================================================================
   CrystalOS snap layouts

   A layout is an ordered list of regions in normalised coordinates (0..1 of the
   work area). Normalised geometry means one definition works on every viewport,
   and every consumer — the window manager, the overview, the command palette,
   the automation engine — asks this module for concrete rects instead of doing
   its own arithmetic.

   This module is deliberately free of runtime imports so it can be unit tested
   directly by the Node test runner.
   ========================================================================== */

export interface LayoutRegion {
  /** 0..1 of the work area, left to right. */
  x: number;
  /** 0..1 of the work area, top to bottom. */
  y: number;
  width: number;
  height: number;
}

export interface SnapLayout {
  id: string;
  name: string;
  description: string;
  /** Regions in reading order; the focused window takes the first one. */
  regions: LayoutRegion[];
  /** Smallest work area this arrangement stays usable in. */
  minWidth?: number;
  minHeight?: number;
  /** True for layouts the user built, which may be edited or removed. */
  custom?: boolean;
}

/** A gap between regions and around the arrangement, in CSS pixels. */
export const LAYOUT_GAP = 6;

export const MAX_REGIONS = 6;

function region(x: number, y: number, width: number, height: number): LayoutRegion {
  return { x, y, width, height };
}

export const builtInLayouts: SnapLayout[] = [
  {
    id: "single",
    name: "Single window",
    description: "One window fills the work area.",
    regions: [region(0, 0, 1, 1)],
  },
  {
    id: "halves",
    name: "Two halves",
    description: "Two windows side by side.",
    regions: [region(0, 0, 0.5, 1), region(0.5, 0, 0.5, 1)],
  },
  {
    id: "rows",
    name: "Two rows",
    description: "Two windows stacked, one above the other.",
    regions: [region(0, 0, 1, 0.5), region(0, 0.5, 1, 0.5)],
  },
  {
    id: "two-thirds",
    name: "Wide and narrow",
    description: "A wide window on the left, a narrow one on the right.",
    regions: [region(0, 0, 2 / 3, 1), region(2 / 3, 0, 1 / 3, 1)],
    minWidth: 720,
  },
  {
    id: "thirds",
    name: "Three columns",
    description: "Three equal columns.",
    regions: [region(0, 0, 1 / 3, 1), region(1 / 3, 0, 1 / 3, 1), region(2 / 3, 0, 1 / 3, 1)],
    minWidth: 900,
  },
  {
    id: "focus-columns",
    name: "Focus in the middle",
    description: "A narrow window, a wide one, and another narrow one.",
    regions: [
      region(0, 0, 0.25, 1),
      region(0.25, 0, 0.5, 1),
      region(0.75, 0, 0.25, 1),
    ],
    minWidth: 1080,
  },
  {
    id: "main-stack",
    name: "Main and two stacked",
    description: "A main window, with two smaller ones stacked beside it.",
    regions: [
      region(0, 0, 2 / 3, 1),
      region(2 / 3, 0, 1 / 3, 0.5),
      region(2 / 3, 0.5, 1 / 3, 0.5),
    ],
    minWidth: 860,
  },
  {
    id: "grid-4",
    name: "Four windows",
    description: "An even grid of four windows.",
    regions: [
      region(0, 0, 0.5, 0.5),
      region(0.5, 0, 0.5, 0.5),
      region(0, 0.5, 0.5, 0.5),
      region(0.5, 0.5, 0.5, 0.5),
    ],
    minWidth: 820,
    minHeight: 560,
  },
  {
    id: "grid-6",
    name: "Six windows",
    description: "Three columns of two windows.",
    regions: [
      region(0, 0, 1 / 3, 0.5),
      region(1 / 3, 0, 1 / 3, 0.5),
      region(2 / 3, 0, 1 / 3, 0.5),
      region(0, 0.5, 1 / 3, 0.5),
      region(1 / 3, 0.5, 1 / 3, 0.5),
      region(2 / 3, 0.5, 1 / 3, 0.5),
    ],
    minWidth: 1020,
    minHeight: 600,
  },
];

/**
 * Resolves a layout into concrete rects. Regions are inset by half the gap so
 * neighbours end up one gap apart, and the whole arrangement keeps a small
 * margin from the work area edges.
 */
export function layoutRects(layout: SnapLayout, workArea: Rect, gap = LAYOUT_GAP): Rect[] {
  const gutter = gap / 2;
  return layout.regions.map((entry) => {
    const x = workArea.x + Math.round(entry.x * workArea.width) + gutter;
    const y = workArea.y + Math.round(entry.y * workArea.height) + gutter;
    const width = Math.round(entry.width * workArea.width) - gap;
    const height = Math.round(entry.height * workArea.height) - gap;
    return {
      x,
      y,
      width: Math.max(160, width),
      height: Math.max(120, height),
    };
  });
}

/** True when the work area is large enough for the arrangement to be usable. */
export function isLayoutUsable(layout: SnapLayout, workArea: Rect): boolean {
  if (layout.regions.length === 0) return false;
  if (layout.minWidth && workArea.width < layout.minWidth) return false;
  if (layout.minHeight && workArea.height < layout.minHeight) return false;
  // Every region must stay above the window minimums after the gutters.
  const rects = layoutRects(layout, workArea);
  return rects.every(
    (rect) =>
      rect.width >= 300 && rect.height >= 200 && rect.x + rect.width <= workArea.x + workArea.width + 1,
  );
}

export function layoutsFor(layouts: SnapLayout[], workArea: Rect): SnapLayout[] {
  return layouts.filter((layout) => isLayoutUsable(layout, workArea));
}

export function layoutById(layouts: SnapLayout[], id: string | undefined): SnapLayout | undefined {
  if (!id) return undefined;
  return layouts.find((layout) => layout.id === id);
}

/* ---- custom layouts ------------------------------------------------------ */

const MIN_REGION = 0.1;

/**
 * Validates a region list before it becomes a layout. Returns a readable reason
 * or null when the layout is usable. Custom layouts can never place a window
 * outside the work area, so the bounds check is the important one.
 */
export function validateRegions(regions: LayoutRegion[]): string | null {
  if (!Array.isArray(regions) || regions.length === 0) return "A layout needs at least one region.";
  if (regions.length > MAX_REGIONS) return `A layout can hold at most ${MAX_REGIONS} regions.`;
  for (const entry of regions) {
    if (
      typeof entry?.x !== "number" ||
      typeof entry?.y !== "number" ||
      typeof entry?.width !== "number" ||
      typeof entry?.height !== "number" ||
      ![entry.x, entry.y, entry.width, entry.height].every(Number.isFinite)
    ) {
      return "Every region needs numeric geometry.";
    }
    if (entry.width < MIN_REGION || entry.height < MIN_REGION) {
      return "Regions cannot be smaller than a tenth of the work area.";
    }
    if (entry.x < 0 || entry.y < 0 || entry.x + entry.width > 1.0001 || entry.y + entry.height > 1.0001) {
      return "Regions must stay inside the work area.";
    }
  }
  return null;
}

export function makeLayout(input: {
  id: string;
  name: string;
  description?: string;
  regions: LayoutRegion[];
}): SnapLayout | { error: string } {
  const problem = validateRegions(input.regions);
  if (problem) return { error: problem };
  return {
    id: input.id,
    name: input.name.trim().slice(0, 40) || "Custom layout",
    description: input.description?.trim().slice(0, 90) || "Custom arrangement.",
    regions: input.regions.map((entry) => ({
      x: round(entry.x),
      y: round(entry.y),
      width: round(entry.width),
      height: round(entry.height),
    })),
    custom: true,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Splits a column into rows, which is what the simple custom-layout editor
 * uses to build arrangements without a free-form canvas.
 */
export function regionsFromColumns(columns: number[], rows: number[]): LayoutRegion[] {
  const regions: LayoutRegion[] = [];
  const columnCount = Math.max(1, Math.min(3, Math.round(columns.length)));
  const widths = normalise(columns.slice(0, columnCount));
  for (let index = 0; index < columnCount; index += 1) {
    const x = widths.slice(0, index).reduce((total, value) => total + value, 0);
    const rowCount = Math.max(1, Math.min(3, Math.round(rows[index] ?? 1)));
    const heights = normalise(new Array(rowCount).fill(1));
    for (let row = 0; row < rowCount; row += 1) {
      const y = heights.slice(0, row).reduce((total, value) => total + value, 0);
      regions.push({ x: round(x), y: round(y), width: round(widths[index]), height: round(heights[row]) });
    }
  }
  return regions;
}

function normalise(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + Math.max(0.1, value), 0) || 1;
  return values.map((value) => round(Math.max(0.1, value) / total));
}
