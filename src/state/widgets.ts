import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";
import type { WidgetId, WidgetInstance } from "@/types";
import { createId } from "@/utils/format";

/** Pixel size of one layout cell. Widget positions snap to this grid. */
export const WIDGET_CELL = 96;

interface WidgetState {
  instances: WidgetInstance[];
  /** Settings → Widgets: "Move and resize widgets". */
  draggingEnabled: boolean;
  /** Always snap while dragging, without holding the modifier. */
  snapToGrid: boolean;
  showOnLockScreen: boolean;
  /** Whether the first-run move/resize hint has been shown. */
  gestureHintShown: boolean;

  addWidget: (widget: WidgetId, position?: { x: number; y: number }) => string;
  removeWidget: (id: string) => void;
  /** `snap` overrides the setting for this move — Shift during a drag. */
  moveWidget: (id: string, x: number, y: number, snap?: boolean) => void;
  resizeWidget: (id: string, w: number, h: number) => void;
  configureWidget: (id: string, settings: Record<string, unknown>) => void;
  setDraggingEnabled: (enabled: boolean) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setShowOnLockScreen: (enabled: boolean) => void;
  markGestureHintShown: () => void;
  clearAll: () => void;
}

/** Default footprint per widget, in grid cells. */
export const widgetSize: Record<WidgetId, { w: number; h: number }> = {
  clock: { w: 3, h: 2 },
  calendar: { w: 4, h: 4 },
  weather: { w: 3, h: 3 },
  notes: { w: 4, h: 3 },
  system: { w: 4, h: 3 },
  music: { w: 4, h: 2 },
  shortcuts: { w: 3, h: 2 },
  battery: { w: 3, h: 2 },
  todo: { w: 4, h: 3 },
  files: { w: 4, h: 3 },
  network: { w: 3, h: 3 },
  countdown: { w: 3, h: 3 },
};

function snap(value: number): number {
  return Math.round(value / WIDGET_CELL) * WIDGET_CELL;
}

export const useWidgetStore = create<WidgetState>()(
  persist(
    (set, get) => ({
      // A brand-new desktop is intentionally empty — widgets are opt-in.
      instances: [],
      draggingEnabled: true,
      // Placement is free-hand by default; holding Shift during a drag snaps to
      // the grid. The setting is for people who would rather always snap.
      snapToGrid: false,
      showOnLockScreen: false,
      gestureHintShown: false,

      addWidget: (widget, position) => {
        const cells = widgetSize[widget];
        const index = get().instances.filter((instance) => instance.widget === widget).length;
        const id = createId("wdg");
        const instance: WidgetInstance = {
          id,
          widget,
          x: snap(position?.x ?? 32 + index * 24),
          y: snap(position?.y ?? 44 + index * 24),
          w: cells.w,
          h: cells.h,
        };
        set({ instances: [...get().instances, instance] });
        return id;
      },

      removeWidget: (id) =>
        set({ instances: get().instances.filter((instance) => instance.id !== id) }),

      moveWidget: (id, x, y, snapOverride) =>
        set({
          instances: get().instances.map((instance) => {
            if (instance.id !== id) return instance;
            const shouldSnap = snapOverride ?? get().snapToGrid;
            return {
              ...instance,
              x: shouldSnap ? snap(x) : Math.round(x),
              y: shouldSnap ? snap(y) : Math.round(y),
            };
          }),
        }),

      resizeWidget: (id, w, h) =>
        set({
          instances: get().instances.map((instance) =>
            instance.id === id
              ? { ...instance, w: Math.max(2, w), h: Math.max(2, h) }
              : instance,
          ),
        }),

      configureWidget: (id, settings) =>
        set({
          instances: get().instances.map((instance) =>
            instance.id === id
              ? { ...instance, settings: { ...instance.settings, ...settings } }
              : instance,
          ),
        }),

      setDraggingEnabled: (draggingEnabled) => set({ draggingEnabled }),
      setSnapToGrid: (snapToGrid) => set({ snapToGrid }),
      setShowOnLockScreen: (showOnLockScreen) => set({ showOnLockScreen }),
      markGestureHintShown: () => set({ gestureHintShown: true }),
      clearAll: () => set({ instances: [] }),
    }),
    {
      name: "widgets",
      version: 2,
      storage: jsonStorageFor<WidgetState>(),
      /**
       * v2 makes the grid something you ask for: dragging snaps only while
       * Shift is held unless the setting is turned on, and the first drag or
       * resize teaches the gestures once. Widgets themselves are untouched.
       */
      migrate: (persisted, version) => {
        const state = persisted as Partial<WidgetState> | undefined;
        if (version < 2) {
          return { ...state, snapToGrid: false, gestureHintShown: false } as WidgetState;
        }
        return state as WidgetState;
      },
    },
  ),
);
