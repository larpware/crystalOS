import { useLayoutStore } from "@/state/layouts";
import { useWindowStore } from "@/state/windows";
import { useWorkspaceStore } from "@/state/workspaces";
import type { Rect } from "@/types";
import {
  builtInLayouts,
  isLayoutUsable,
  layoutRects,
  type SnapLayout,
} from "@/window-manager/layouts";

/* ==========================================================================
   Layout service

   Turns "apply this arrangement" into geometry for the windows that are on the
   workspace in front of the user. The window store stays a dumb container of
   rects, and the pure maths lives in window-manager/layouts.
   ========================================================================== */

export function allLayouts(): SnapLayout[] {
  return [...builtInLayouts, ...useLayoutStore.getState().custom];
}

export function layoutFor(id: string | undefined): SnapLayout | undefined {
  if (!id) return undefined;
  return allLayouts().find((layout) => layout.id === id);
}

export interface ApplyLayoutResult {
  ok: boolean;
  /** Windows that received a region. */
  applied: number;
  /** Windows left where they were because the layout ran out of regions. */
  extra: number;
  /** Human-readable explanation when nothing happened. */
  reason?: string;
}

/**
 * Applies a layout to the visible windows of a workspace. The focused window
 * takes the first region, the rest follow in stacking order, so the arrangement
 * is predictable and matches what the user was just looking at.
 */
export function applyLayout(
  layoutId: string,
  options: { workspaceId?: string } = {},
): ApplyLayoutResult {
  const layout = layoutFor(layoutId);
  if (!layout) return { ok: false, applied: 0, extra: 0, reason: `No layout called "${layoutId}".` };

  const workspaceId = options.workspaceId ?? useWorkspaceStore.getState().activeId;
  const { windows, workArea, applyRects } = useWindowStore.getState();

  const onWorkspace = windows
    .filter(
      (window) =>
        !window.minimized &&
        (window.sticky === true || !window.workspaceId || window.workspaceId === workspaceId),
    )
    .sort((a, b) => Number(b.focused) - Number(a.focused) || b.z - a.z);

  if (onWorkspace.length === 0) {
    return { ok: false, applied: 0, extra: 0, reason: "There are no windows on this workspace." };
  }
  if (!isLayoutUsable(layout, workArea)) {
    return {
      ok: false,
      applied: 0,
      extra: 0,
      reason: `${layout.name} does not fit this window size (${Math.round(workArea.width)}×${Math.round(workArea.height)}).`,
    };
  }

  const rects: Rect[] = layoutRects(layout, workArea);
  const targets = onWorkspace.slice(0, rects.length);
  applyRects(targets.map((window, index) => ({ id: window.id, rect: rects[index] })));

  return { ok: true, applied: targets.length, extra: Math.max(0, onWorkspace.length - targets.length) };
}

/**
 * Re-applies the workspace's chosen layout after the work area changes, which is
 * what keeps a tiled workspace tiled when the window is resized.
 */
export function reflowWorkspaceLayout(workspaceId?: string): ApplyLayoutResult | null {
  const spaces = useWorkspaceStore.getState();
  const id = workspaceId ?? spaces.activeId;
  const layoutId = spaces.workspaces.find((workspace) => workspace.id === id)?.layoutId;
  if (!layoutId) return null;
  const result = applyLayout(layoutId, { workspaceId: id });
  return result.ok ? result : null;
}

/** Layouts that fit the current work area, with the reason the others do not. */
export function layoutChoices(): {
  layout: SnapLayout;
  usable: boolean;
  reason?: string;
}[] {
  const { workArea } = useWindowStore.getState();
  return allLayouts().map((layout) => {
    const usable = isLayoutUsable(layout, workArea);
    return {
      layout,
      usable,
      reason: usable
        ? undefined
        : `Needs at least ${layout.minWidth ?? 300}×${layout.minHeight ?? 200} of work area.`,
    };
  });
}
