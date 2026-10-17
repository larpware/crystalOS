import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/icons/Icon";
import { Button, Slider, Switch } from "@/components/ui";
import { themePresets, accentOptions } from "@/themes/presets";
import { useAppearanceStore } from "@/state/appearance";
import { useNotificationStore } from "@/state/notifications";
import { usePlaybackStore } from "@/state/playback";
import { useShellStore } from "@/state/shell";
import { useSystemStore } from "@/state/system";
import { useNetworkStatus } from "@/hooks/useNetwork";
import { isEnforcing, providerAppId, providerName } from "@/services/vpn/coverage";
import { useVpnStore } from "@/state/vpn";
import { lockSession, notify, openApp, powerOff, sleepSession } from "@/services/os";
import { useWindowStore } from "@/state/windows";
import { formatBytes } from "@/utils/format";
import { byteSize } from "@/services/storage";
import { useWidgetStore } from "@/state/widgets";

/* ==========================================================================
   Quick settings

   An aggregate popover for the things people change often. Controls that the
   browser cannot perform are labelled as such rather than faked: the panel
   backlight is not exposed to the web, so the dim control dims the OS surface
   and says so.
   ========================================================================== */

export function QuickSettings() {
  const open = useShellStore((state) => state.quickSettingsOpen);
  const setOpen = useShellStore((state) => state.setQuickSettingsOpen);
  const panelRef = useRef<HTMLDivElement>(null);

  const network = useNetworkStatus();
  const prefs = useNotificationStore((state) => state.prefs);
  const setPrefs = useNotificationStore((state) => state.setPrefs);

  const appearance = useAppearanceStore();
  const system = useSystemStore();
  const playback = usePlaybackStore();
  const widgetDragging = useWidgetStore((state) => state.draggingEnabled);
  const setWidgetDragging = useWidgetStore((state) => state.setDraggingEnabled);

  const [storageUsed, setStorageUsed] = useState<number | null>(null);

  useEffect(() => {
    if (open) setStorageUsed(byteSize());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const trigger = document.querySelector(".cr-panel__status");
      if (panelRef.current?.contains(target) || trigger?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  const openSettings = useCallback(
    (section?: string) => {
      openApp("settings", section ? { args: { section } } : {});
      setOpen(false);
    },
    [setOpen],
  );

  if (!open) return null;

  return (
    <div className="cr-quick" ref={panelRef} role="dialog" aria-label="Quick settings">
      <div className="cr-quick__status">
        <div className="cr-quick__status-main">
          <Icon name={network.online ? "wifi" : "wifi-off"} size={16} />
          <div>
            <div className="cr-quick__status-title">
              {network.online ? "Connected" : "Offline"}
            </div>
            <div className="cr-quick__status-sub">
              {network.effectiveType ? `${network.effectiveType} link` : "Browser reports no link type"}
              {network.rttMs != null ? ` · ${network.rttMs} ms` : ""}
            </div>
          </div>
        </div>
        <div className="cr-quick__status-actions">
          <span className="cr-quick__theme-name">{activeThemeName()}</span>
        </div>
      </div>

      <div className="cr-quick__sliders">
        <div className="cr-quick__slider-row">
          <Icon name="volume" size={15} />
          <Slider
            label="Output volume"
            min={0}
            max={100}
            value={Math.round((playback.muted ? 0 : playback.volume) * 100)}
            format={(value) => `${value}%`}
            onChange={(value) => playback.setVolume(value / 100)}
          />
          <button
            type="button"
            className="cr-icon-btn"
            aria-pressed={playback.muted}
            onClick={playback.toggleMuted}
            aria-label={playback.muted ? "Unmute output" : "Mute output"}
            title={playback.muted ? "Unmute" : "Mute"}
          >
            <Icon name={playback.muted ? "volume-mute" : "volume"} size={15} />
          </button>
        </div>

        <div className="cr-quick__slider-row">
          <Icon name="brightness" size={15} />
          <Slider
            label="Screen dim"
            min={0}
            max={60}
            value={Math.round(playback.dim * 100)}
            format={(value) => `${value}%`}
            onChange={(value) => playback.setDim(value / 100)}
          />
          <span className="cr-quick__note" title="The browser cannot change the physical backlight.">
            OS only
          </span>
        </div>
      </div>

      <div className="cr-quick__toggles">
        <QuickTile
          icon="bell-off"
          label="Do Not Disturb"
          active={prefs.doNotDisturb}
          onClick={() => setPrefs({ doNotDisturb: !prefs.doNotDisturb })}
          hint="Queues notifications"
        />
        <QuickTile
          icon="gauge"
          label="Performance"
          active={system.performanceMode}
          onClick={() => system.setPerformanceMode(!system.performanceMode)}
          hint="Reduces effects"
        />
        <QuickTile
          icon="eye-off"
          label="Hide banners"
          active={prefs.hidden}
          onClick={() => setPrefs({ hidden: !prefs.hidden })}
          hint="Separate from DND"
        />
        <QuickTile
          icon="activity"
          label="Hz readout"
          active={system.hzDisplay !== "off"}
          onClick={() =>
            system.setHzDisplay(system.hzDisplay === "off" ? "panel" : "off")
          }
          hint="Measured refresh"
        />
        <QuickTile
          icon="globe"
          label="Proxy"
          active={system.proxyEnabled}
          onClick={() => system.setProxyEnabled(!system.proxyEnabled)}
          hint="Scramjet for every proxied application"
        />
        <VpnQuickTile />
      </div>

      <div className="cr-quick__row">
        <span className="cr-quick__row-label">Theme</span>
        <div className="cr-quick__themes">
          {themePresets.slice(0, 8).map((theme) => (
            <button
              key={theme.id}
              type="button"
              className="cr-quick__theme"
              data-active={appearance.themeId === theme.id}
              title={theme.name}
              onClick={() => appearance.setTheme(theme.id)}
              style={{
                background: `linear-gradient(140deg, ${theme.tokens.surface2}, ${theme.tokens.bgDesktop})`,
                borderColor:
                  appearance.themeId === theme.id ? theme.tokens.accent : theme.tokens.borderStrong,
              }}
            >
              <span
                className="cr-quick__theme-swatch"
                style={{ background: theme.tokens.accent }}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="cr-quick__row">
        <span className="cr-quick__row-label">Accent</span>
        <div className="cr-quick__accents">
          <button
            type="button"
            className="cr-quick__accent"
            data-active={appearance.accentId === "default"}
            title="Use the theme accent"
            onClick={() => appearance.setAccent("default")}
          >
            <Icon name="refresh" size={12} />
          </button>
          {accentOptions.map((accent) => (
            <button
              key={accent.id}
              type="button"
              className="cr-quick__accent"
              data-active={appearance.accentId === accent.id}
              title={accent.name}
              style={{ background: accent.value }}
              onClick={() => appearance.setAccent(accent.id)}
            />
          ))}
        </div>
      </div>

      <div className="cr-quick__row">
        <span className="cr-quick__row-label">Widget dragging</span>
        <Switch
          label="Allow widget dragging"
          checked={widgetDragging}
          onChange={setWidgetDragging}
        />
      </div>

      <div className="cr-quick__footer">
        <div className="cr-quick__shotcut-row">
          <Button size="sm" variant="ghost" icon="settings" onClick={() => openSettings()}>
            Settings
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            onClick={() => openSettings("performance")}
          >
            Performance
          </Button>
        </div>
        <div className="cr-quick__power">
          <button
            type="button"
            className="cr-icon-btn"
            title="Lock"
            aria-label="Lock screen"
            onClick={() => {
              lockSession();
              setOpen(false);
            }}
          >
            <Icon name="lock" size={16} />
          </button>
          <button
            type="button"
            className="cr-icon-btn"
            title="Sleep"
            aria-label="Sleep"
            onClick={() => {
              sleepSession();
              setOpen(false);
            }}
          >
            <Icon name="sleep" size={16} />
          </button>
          <button
            type="button"
            className="cr-icon-btn"
            title="Restart session"
            aria-label="Restart session"
            onClick={() => {
              useWindowStore.getState().closeAll();
              setOpen(false);
            }}
          >
            <Icon name="restart" size={16} />
          </button>
          <button
            type="button"
            className="cr-icon-btn"
            title="Shut down"
            aria-label="Shut down"
            onClick={() => {
              powerOff();
              setOpen(false);
            }}
          >
            <Icon name="power" size={16} />
          </button>
        </div>
      </div>

      <div className="cr-quick__meta">
        <span>
          {activeThemeName()} · UI scale {appearance.osScale.toFixed(2)}×
        </span>
        <span>{storageUsed != null ? `${formatBytes(storageUsed)} of settings stored` : ""}</span>
      </div>
    </div>
  );
}

/* ---- VPN ---------------------------------------------------------------
 *
 * The tile is a real control, not an indicator: it drives the same controller
 * the VPN windows do. It is provider-aware — under CrystalVPN it needs an endpoint
 * rather than a sign-in — and it refuses to guess when it has nothing to go on:
 * with no endpoint or session, or with the backend unreachable, it opens the
 * right window where the reason is spelled out instead of flipping a switch
 * that cannot work.
 */

function VpnQuickTile() {
  const snapshot = useVpnStore((state) => state.snapshot);
  const reachable = useVpnStore((state) => state.reachable);
  const busy = useVpnStore((state) => state.busy);
  const setOpen = useShellStore((state) => state.setQuickSettingsOpen);

  const connected = snapshot?.status === "connected";
  const working = busy === "connect" || busy === "reconnect" || busy === "disconnect";
  const enforcing = isEnforcing(snapshot);
  const app = providerAppId(snapshot);
  const name = providerName(snapshot);
  /** CrystalVPN is ready once it has an endpoint to dial. */
  const ready = Boolean(snapshot?.endpoint);

  const hint = !reachable
    ? `The VPN backend is not answering. Open ${name} for details.`
    : !ready
      ? "Add an endpoint in CrystalVPN first — or press Quick connect there."
      : connected
        ? `Connected${snapshot?.server ? ` to ${snapshot.server.name}` : ""}. Click to disconnect.`
        : enforcing
          ? `The VPN is on but not connected, so proxied traffic is blocked. Open ${name} VPN to fix it or turn it off.`
          : `Click to connect through ${name}.`;

  const onClick = () => {
    if (!reachable || !ready || working) {
      openApp(app);
      setOpen(false);
      return;
    }
    if (connected) {
      void useVpnStore
        .getState()
        .disconnect()
        .then((next) => {
          if (next) notify({ title: "VPN disconnected", body: "Proxied browsing is unprotected again.", icon: "shield" });
        });
      return;
    }
    void (async () => {
      const store = useVpnStore.getState();
      // CrystalVPN is the only provider the OS offers, so a stored legacy
      // transport choice must not be allowed to hijack the click.
      if (store.snapshot?.provider !== "manual") await store.setProvider();
      const next = await useVpnStore.getState().connect();
      if (!next) return;
      if (next.status === "connected") {
        notify({
          title: "VPN connected",
          body: next.server ? `Proxied browsing exits through ${next.server.name}.` : "Proxied browsing is protected.",
          icon: "shield",
        });
        return;
      }
      notify({
        title: "VPN could not connect",
        body: next.error?.message ?? "The connection attempt did not succeed.",
        icon: "warning",
      });
    })();
  };

  return <QuickTile icon="shield" label={name} active={connected} onClick={onClick} hint={hint} />;
}

function QuickTile({
  icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="cr-quick__tile"
      aria-pressed={active}
      onClick={onClick}
      title={hint}
    >
      <Icon name={icon} size={16} />
      <span className="cr-quick__tile-label">{label}</span>
      <span className="cr-quick__tile-state">{active ? "On" : "Off"}</span>
    </button>
  );
}

function activeThemeName(): string {
  const id = useAppearanceStore.getState().themeId;
  const custom = useAppearanceStore.getState().customThemes.find((theme) => theme.id === id);
  return custom?.name ?? themePresets.find((theme) => theme.id === id)?.name ?? id;
}
