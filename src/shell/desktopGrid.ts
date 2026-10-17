/* ==========================================================================
   Desktop grid

   One grid for the desktop layer: hand-placed icons, auto-placed icons and an
   application dropped in from the dock or the launcher all land on the same
   slots, so a desktop full of entries reads as a layout rather than a pile.
   ========================================================================== */

export const GRID_PADDING = 24;
export const GRID_GAP = 12;
export const ROW_CELL = 118;

/** Horizontal distance between two icon slots, for a given artwork size. */
export function columnStride(iconSize: number): number {
  return iconSize + GRID_GAP;
}

/**
 * Nearest slot to a point. `top` is the strip the top bar reserves, so a slot
 * is never returned underneath it.
 */
export function desktopSlot(
  x: number,
  y: number,
  iconSize: number,
  top: number,
): { x: number; y: number } {
  const stride = columnStride(iconSize);
  return {
    x: Math.max(GRID_PADDING, GRID_PADDING + Math.round((x - GRID_PADDING) / stride) * stride),
    y: Math.max(top, top + Math.round((y - top) / ROW_CELL) * ROW_CELL),
  };
}
