import { useMemo } from "react";
import type { CSSProperties } from "react";
import { AppIcon, Icon } from "@/icons/Icon";
import { metaFor } from "@/apps/catalog";
import { useClock } from "@/hooks/useClock";
import { useBattery } from "@/hooks/useBattery";
import { useOffline } from "@/hooks/useOffline";
import { offlineExplanation, offlineHeadline } from "@/services/offline";
import { openApp } from "@/services/os";
import { useShellStore } from "@/state/shell";
import { useSystemStore } from "@/state/system";
import { useNotificationStore } from "@/state/notifications";
import { useElementTheme } from "@/themes/scope";
import { useWindowStore } from "@/state/windows";
import { formatDateLong, formatTime } from "@/utils/format";
import { HzReadout } from "./HzReadout";

/* ==========================================================================
   Top panel

   Left: activities and the focused window. Centre: the clock. Right: status
   indicators and the quick-settings trigger. The clock only re-renders itself
   — see hooks/useClock.
   ========================================================================== */

export function TopPanel() {
  const panel = useShellStore((state) => state.panel);
  const setLauncherOpen = useShellStore((state) => state.setLauncherOpen);
  const launcherOpen = useShellStore((state) => state.launcherOpen);
  const setQuickSettingsOpen = useShellStore((state) => state.setQuickSettingsOpen);
  const quickSettingsOpen = useShellStore((state) => state.quickSettingsOpen);
  const setNotificationCenterOpen = useShellStore((state) => state.setNotificationCenterOpen);

  const deviceType = useSystemStore((state) => state.deviceType);
  const hzDisplay = useSystemStore((state) => state.hzDisplay);
  const doNotDisturb = useNotificationStore((state) => state.prefs.doNotDisturb);
  const hidden = useNotificationStore((state) => state.prefs.hidden);
  const unread = useNotificationStore((state) => state.unreadCount);

  const focusedWindow = useWindowStore((state) => state.windows.find((window) => window.focused) ?? null);
  const focusedTitle = focusedWindow?.title ?? null;
  const focusedApp = focusedWindow ? metaFor(focusedWindow.appId) : undefined;
  /* A window in full screen has no bar of its own — the titlebar unmounts so the
     application can reach every edge — so this bar, which stays, is where full
     screen is left from. It is the only chrome the mode does not cover. */
  const focusedFull = focusedWindow?.full === true;
  const toggleFullScreen = useWindowStore((state) => state.toggleFullScreen);

  const battery = useBattery();
  const offline = useOffline();

  /* Published as a custom property the same way the taskbar does it: the theme
     supplies the material, this only scales how much of it is opaque. */
  const surfaceStyle = useMemo(
    () => ({ "--panel-surface-opacity": `${Math.round(panel.opacity * 100)}%` }) as CSSProperties,
    [panel.opacity],
  );
  const panelTheme = useElementTheme("panel");

  /* The clock is one button placed in whichever group the user picked, so it
     moves between the left, centre and right of the bar without duplicating
     its isolated re-render. */
  const clockButton = panel.showClock ? (
    <button
      type="button"
      className="cr-panel__clock"
      onClick={() => setNotificationCenterOpen(true)}
      aria-label="Open notifications"
    >
      <PanelClock />
    </button>
  ) : null;
  const clockPosition = panel.clockPosition ?? "center";

  return (
    <header
      className="cr-panel"
      role="banner"
      data-element-theme={panelTheme.themeId ?? undefined}
      style={panelTheme.style ? { ...surfaceStyle, ...panelTheme.style } : surfaceStyle}
    >
      <div className="cr-panel__left">
        {clockPosition === "left" && clockButton}
        {panel.showActivities && (
          <button
            type="button"
            className="cr-panel__activities"
            aria-label="Activities"
            aria-expanded={launcherOpen}
            onClick={() => setLauncherOpen(!launcherOpen)}
          >
            <span className="cr-panel__activities-glyph" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>
            {/* Hidden below 560px: the button keeps its name from aria-label. */}
            <span className="cr-panel__activities-label">Activities</span>
          </button>
        )}
        {focusedTitle && (
          <span className="cr-panel__app" title={focusedTitle}>
            {focusedApp ? <AppIcon appId={focusedApp.id} name={focusedApp.icon} size={16} /> : null}
            <span className="cr-truncate">{focusedTitle}</span>
          </span>
        )}
        {focusedFull && focusedWindow && (
          <button
            type="button"
            className="cr-panel__indicator cr-panel__indicator--action"
            title="Exit full screen"
            aria-label="Exit full screen"
            onClick={() => toggleFullScreen(focusedWindow.id)}
          >
            <Icon name="collapse" size={14} />
          </button>
        )}
      </div>

      <div className="cr-panel__center">{clockPosition === "center" && clockButton}</div>

      <div className="cr-panel__right">
        {clockPosition === "right" && clockButton}
        {hzDisplay === "panel" && <HzReadout />}
        <div className="cr-panel__tray" role="group" aria-label="System indicators">
          {panel.showNetwork && (
            <button
              type="button"
              className="cr-panel__indicator cr-panel__indicator--action"
              title={
                offline.offline
                  ? `${offlineHeadline(offline)} — ${offlineExplanation(offline)}`
                  : "Connected"
              }
              onClick={() => openApp("settings", { args: { section: "network" } })}
            >
              <Icon name={offline.offline ? "wifi-off" : "wifi"} size={14} />
            </button>
          )}
          {panel.showVolume && (
            <span className="cr-panel__indicator" title="System volume">
              <Icon name="volume" size={14} />
            </span>
          )}
          {panel.showBattery && deviceType === "laptop" && battery && (
            <span
              className="cr-panel__indicator cr-panel__indicator--value"
              title={
                battery.charging
                  ? `Charging · ${Math.round(battery.level * 100)}%`
                  : `${Math.round(battery.level * 100)}% remaining`
              }
            >
              <Icon
                name={
                  battery.charging
                    ? "battery-charging"
                    : battery.level > 0.25
                      ? "battery-full"
                      : "battery-low"
                }
                size={14}
              />
              <span className="cr-num">{Math.round(battery.level * 100)}%</span>
            </span>
          )}
          {(doNotDisturb || hidden) && (
            <span
              className="cr-panel__indicator"
              title={doNotDisturb ? "Do Not Disturb" : "Notifications hidden"}
            >
              <Icon name={doNotDisturb ? "bell-off" : "eye-off"} size={14} />
            </span>
          )}
        </div>
        <button
          type="button"
          className="cr-panel__status"
          aria-expanded={quickSettingsOpen}
          onClick={() => setQuickSettingsOpen(!quickSettingsOpen)}
          title="Quick settings"
        >
          <Icon name="sliders" size={14} />
          {unread > 0 && <span className="cr-panel__dot" aria-label={`${unread} unread notifications`} />}
        </button>
      </div>
    </header>
  );
}

/** Isolated so ticking never re-renders the rest of the panel. */
function PanelClock() {
  const panel = useShellStore((state) => state.panel);
  const interval = panel.clockSeconds ? 1000 : 15_000;
  const now = useClock(interval);
  const date = useMemo(() => new Date(now), [now]);

  return (
    <span className="cr-num cr-panel__clock-text">
      {panel.showDate && (
        <>
          <span className="cr-panel__date">{formatDateLong(date)}</span>
          <span className="cr-panel__clock-sep" aria-hidden="true" />
        </>
      )}
      <span className="cr-panel__time">{formatTime(date, panel.clock12h, panel.clockSeconds)}</span>
    </span>
  );
}
