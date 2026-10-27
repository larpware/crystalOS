import { useEffect, useRef, useState } from "react";
import { Icon } from "@/icons/Icon";
import { Button, EmptyState, Switch } from "@/components/ui";
import { useElementTheme } from "@/themes/scope";
import { useNotificationStore } from "@/state/notifications";
import { useShellStore } from "@/state/shell";
import type { OsNotification } from "@/types";
import { formatRelative, formatTimestamp } from "@/utils/format";

/* ==========================================================================
   Notifications

   Two independent controls, matching the brief:
     · Do Not Disturb suppresses new banners and queues them,
     · Hide banners stops banners without implying DND is on.
   Both are separate switches in the centre and in Settings.
   ========================================================================== */

export function ToastStack() {
  const active = useNotificationStore((state) => state.active);
  const dismiss = useNotificationStore((state) => state.dismiss);
  const prefs = useNotificationStore((state) => state.prefs);

  const anchorClass =
    prefs.anchor === "top-right"
      ? "cr-toasts--top"
      : prefs.anchor === "bottom-left"
        ? "cr-toasts--left"
        : "";

  return (
    <div className={`cr-toasts ${anchorClass}`} role="region" aria-label="Notifications" aria-live="polite">
      {active.map((notification) => (
        <Toast key={notification.id} notification={notification} onDismiss={() => dismiss(notification.id)} />
      ))}
    </div>
  );
}

function Toast({
  notification,
  onDismiss,
}: {
  notification: OsNotification;
  onDismiss: () => void;
}) {
  const duration = useNotificationStore((state) => state.prefs.bannerDurationMs);
  const timeout = useRef<number | undefined>(undefined);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || duration <= 0) return;
    timeout.current = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timeout.current);
  }, [duration, onDismiss, paused]);

  return (
    <article
      className="cr-toast"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <span className="cr-toast__icon">
        <Icon name={notification.icon} size={16} />
      </span>
      <div className="cr-toast__content">
        <div className="cr-toast__title cr-truncate">{notification.title}</div>
        {notification.body && <div className="cr-toast__body cr-clamp-2">{notification.body}</div>}
        <div className="cr-toast__actions">
          <span className="cr-toast__time">{formatTimestamp(notification.createdAt)}</span>
          {notification.actions?.map((action) => (
            <button
              key={action.label}
              type="button"
              className="cr-toast__action"
              onClick={() => {
                action.run();
                onDismiss();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="cr-toast__close"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <Icon name="close" size={12} />
      </button>
    </article>
  );
}

export function NotificationCenter() {
  const open = useShellStore((state) => state.notificationCenterOpen);
  const setOpen = useShellStore((state) => state.setNotificationCenterOpen);
  const overlayTheme = useElementTheme("overlays");
  const prefs = useNotificationStore((state) => state.prefs);
  const setPrefs = useNotificationStore((state) => state.setPrefs);
  const history = useNotificationStore((state) => state.history);
  const removeFromHistory = useNotificationStore((state) => state.removeFromHistory);
  const clearHistory = useNotificationStore((state) => state.clearHistory);
  const markAllRead = useNotificationStore((state) => state.markAllRead);

  useEffect(() => {
    if (open) markAllRead();
  }, [open, markAllRead]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <>
      <div className="cr-center-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
      <aside
        className="cr-center"
        role="dialog"
        aria-label="Notifications"
        data-element-theme={overlayTheme.themeId ?? undefined}
        style={overlayTheme.style}
      >
        <header className="cr-center__header">
          <span className="cr-center__title">Notifications</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {history.length > 0 && (
              <Button size="sm" variant="ghost" icon="trash" onClick={clearHistory}>
                Clear all
              </Button>
            )}
            <Button size="sm" variant="ghost" icon="close" onClick={() => setOpen(false)} aria-label="Close">
              Close
            </Button>
          </div>
        </header>

        <div className="cr-center__toggles">
          <label className="cr-center__toggle">
            <span className="cr-center__toggle-text">
              <span className="cr-row__label">Do Not Disturb</span>
              <span className="cr-row__desc">Suppress banners and collect notifications here.</span>
            </span>
            <Switch
              label="Do Not Disturb"
              checked={prefs.doNotDisturb}
              onChange={(value) => setPrefs({ doNotDisturb: value })}
            />
          </label>
          <label className="cr-center__toggle">
            <span className="cr-center__toggle-text">
              <span className="cr-row__label">Hide banners</span>
              <span className="cr-row__desc">
                Stops banners only. Do Not Disturb stays off, for when you just want quiet.
              </span>
            </span>
            <Switch
              label="Hide banners"
              checked={prefs.hidden}
              onChange={(value) => setPrefs({ hidden: value })}
            />
          </label>
        </div>

        <div className="cr-center__list">
          {history.length === 0 ? (
            <EmptyState
              icon="bell"
              title="Nothing here yet"
              hint="Notifications from applications appear here. Sending one is a good test: try `notify Hello | from the terminal`."
            />
          ) : (
            history.map((notification) => (
              <article key={notification.id} className="cr-center__item" data-read={notification.read}>
                <span className="cr-toast__icon">
                  <Icon name={notification.icon} size={15} />
                </span>
                <div className="cr-toast__content">
                  <div className="cr-center__item-title">{notification.title}</div>
                  {notification.body && <div className="cr-toast__body">{notification.body}</div>}
                  <div className="cr-toast__time">
                    {formatRelative(notification.createdAt)} · {formatTimestamp(notification.createdAt)}
                  </div>
                </div>
                <button
                  type="button"
                  className="cr-toast__close"
                  aria-label="Remove from history"
                  onClick={() => removeFromHistory(notification.id)}
                >
                  <Icon name="close" size={12} />
                </button>
              </article>
            ))
          )}
        </div>

        <footer className="cr-center__footer">
          <span>
            {history.length} stored
            {prefs.keepHistory ? ` · history keeps ${prefs.maxHistory}` : " · history off"}
          </span>
          <Button size="sm" variant="ghost" icon="settings" onClick={() => setPrefs({ keepHistory: !prefs.keepHistory })}>
            {prefs.keepHistory ? "Stop keeping history" : "Keep history"}
          </Button>
        </footer>
      </aside>
    </>
  );
}
