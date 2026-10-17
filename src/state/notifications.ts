import { create } from "zustand";
import { persist } from "zustand/middleware";
import { jsonStorageFor } from "@/services/storage";
import type { IconName, OsNotification } from "@/types";
import { createId } from "@/utils/format";

export interface NotificationPrefs {
  /** Suppresses new toasts entirely and queues them into history. */
  doNotDisturb: boolean;
  /** Manual hide: keeps toasts off without implying DND is on. */
  hidden: boolean;
  /** Disable only the notification that is currently showing banners. */
  bannerDurationMs: number;
  showOnLockScreen: boolean;
  playSound: boolean;
  keepHistory: boolean;
  maxHistory: number;
  anchor: "bottom-right" | "bottom-left" | "top-right";
}

interface NotificationState {
  /** Currently visible toasts. */
  active: OsNotification[];
  history: OsNotification[];
  prefs: NotificationPrefs;
  unreadCount: number;

  notify: (input: {
    appId: string;
    icon: IconName;
    title: string;
    body?: string;
    transient?: boolean;
    actions?: OsNotification["actions"];
  }) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  markAllRead: () => void;
  removeFromHistory: (id: string) => void;
  clearHistory: () => void;
  setPrefs: (patch: Partial<NotificationPrefs>) => void;
}

export const defaultNotificationPrefs: NotificationPrefs = {
  doNotDisturb: false,
  hidden: false,
  bannerDurationMs: 5200,
  showOnLockScreen: false,
  playSound: false,
  keepHistory: true,
  maxHistory: 60,
  anchor: "bottom-right",
};

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      active: [],
      history: [],
      prefs: defaultNotificationPrefs,
      unreadCount: 0,

      notify: ({ appId, icon, title, body, transient, actions }) => {
        const { prefs } = get();
        const notification: OsNotification = {
          id: createId("ntf"),
          appId,
          icon,
          title,
          body,
          createdAt: Date.now(),
          read: false,
          transient,
          actions,
        };

        const suppressed = prefs.doNotDisturb || prefs.hidden || transient === true;
        set({
          active: suppressed ? get().active : [...get().active, notification],
          history: prefs.keepHistory
            ? [notification, ...get().history].slice(0, prefs.maxHistory)
            : get().history,
          unreadCount: suppressed ? get().unreadCount + 1 : get().unreadCount,
        });
        return notification.id;
      },

      dismiss: (id) =>
        set({
          active: get().active.filter((notification) => notification.id !== id),
          history: get().history.map((notification) =>
            notification.id === id ? { ...notification, read: true } : notification,
          ),
        }),

      dismissAll: () =>
        set({
          active: [],
          history: get().history.map((notification) => ({ ...notification, read: true })),
          unreadCount: 0,
        }),

      markAllRead: () =>
        set({
          history: get().history.map((notification) => ({ ...notification, read: true })),
          unreadCount: 0,
        }),

      removeFromHistory: (id) =>
        set({ history: get().history.filter((notification) => notification.id !== id) }),

      clearHistory: () => set({ history: [], unreadCount: 0 }),

      setPrefs: (patch) => set({ prefs: { ...get().prefs, ...patch } }),
    }),
    {
      name: "notifications",
      version: 1,
      storage: jsonStorageFor<NotificationState>(),
      partialize: (state) =>
        ({
          prefs: state.prefs,
          // Action callbacks cannot be serialised — history keeps the record only.
          history: state.history.map(({ actions: _actions, ...rest }) => rest),
          unreadCount: state.unreadCount,
        }) as NotificationState,
    },
  ),
);
