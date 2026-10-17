import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Field,
  Modal,
  Row,
  Section,
  Segmented,
  Select,
  Slider,
  Switch,
  TextInput,
} from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { useBattery, useRefreshRate } from "@/hooks/useBattery";
import { useNetworkStatus } from "@/hooks/useNetwork";
import { useOffline } from "@/hooks/useOffline";
import { apiRequest } from "@/services/api";
import {
  OFFLINE_AVAILABLE,
  OFFLINE_UNAVAILABLE,
  offlineExplanation,
  offlineHeadline,
} from "@/services/offline";
import { openApp } from "@/services/os";
import { byteSize, isPersistenceAvailable, listKeys, loadJSON, saveJSON } from "@/services/storage";
import {
  deviceMemoryGb,
  estimateStorage,
  hasBatteryApi,
  logicalProcessors,
  measureRefreshRate,
  readNetwork,
  type NetworkStatus,
} from "@/services/system";
import { useAppearanceStore } from "@/state/appearance";
import { searchEngines, useBrowserStore, type SearchEngine } from "@/state/browser";
import {
  applyTabIdentity,
  builtInTabIdentities,
  useTabIdentityStore,
} from "@/state/cloak";
import { retryScramjet, type ScramjetAssets } from "@/services/scramjet";
import { useScramjetState } from "@/services/scramjet/useProxiedFrame";
import { usePlaybackStore } from "@/state/playback";
import { useShellStore } from "@/state/shell";
import { useSystemStore, type MotionOverride } from "@/state/system";
import { useWindowStore } from "@/state/windows";
import { aboutBuild, credits, SYSTEM_VERSION } from "@/version";
import { createId, formatBytes } from "@/utils/format";
import type { TabIdentityPreset } from "@/types";

/* ==========================================================================
   Settings — system group
   ========================================================================== */

export function PerformancePage() {
  const {
    performanceMode,
    setPerformanceMode,
    backgroundWidgetUpdates,
    setBackgroundWidgetUpdates,
    hzDisplay,
    setHzDisplay,
    motionOverride,
    setMotionOverride,
  } = useSystemStore();
  const live = useAppearanceStore((state) => state.live);
  const setLive = useAppearanceStore((state) => state.setLive);
  const wallpaperBlur = useAppearanceStore((state) => state.wallpaper.blur);
  const setWallpaper = useAppearanceStore((state) => state.setWallpaper);
  const refresh = useRefreshRate(hzDisplay !== "off");

  return (
    <>
      <Section
        title="Performance mode"
        description="Performance mode is a real switch: it turns the features below off rather than relabelling them."
      >
        <Row
          label="Enable performance mode"
          description="Live wallpapers stop, dock magnification is disabled, background widget work pauses and long transitions are shortened."
          control={
            <Switch
              label="Performance mode"
              checked={performanceMode}
              onChange={setPerformanceMode}
            />
          }
        />
        <div className="cr-impact-list">
          <Impact label="Live wallpapers" impact="big" disabled={performanceMode} />
          <Impact label="Dock magnification" impact="small" disabled={performanceMode} />
          <Impact label="Background widget updates" impact="big" disabled={performanceMode} />
          <Impact label="Window animations" impact="small" disabled={performanceMode} />
        </div>
      </Section>

      <Section title="Rendering">
        <Row
          label="Background widget updates"
          description="Widgets tick continuously. Turning this off drops them to a slow clock."
          control={
            <Switch
              label="Background widget updates"
              checked={backgroundWidgetUpdates}
              disabled={performanceMode}
              onChange={setBackgroundWidgetUpdates}
            />
          }
        />
        <Row
          label="Motion"
          description="Overrides the system reduced-motion preference."
          control={
            <Select
              aria-label="Motion"
              value={motionOverride}
              onChange={(event) => setMotionOverride(event.target.value as MotionOverride)}
              options={[
                { value: "system", label: "Follow system" },
                { value: "full", label: "Full" },
                { value: "subtle", label: "Subtle" },
                { value: "reduced", label: "Reduced" },
              ]}
            />
          }
        />
        <Row
          label="Live wallpaper"
          control={
            <Switch
              label="Live wallpaper"
              checked={live.enabled}
              disabled={performanceMode}
              onChange={(enabled) => setLive({ enabled })}
            />
          }
        />
        <Row
          label="Wallpaper blur"
          description="Blurring the wallpaper is one of the more expensive compositing effects."
          control={
            <Slider
              label="Wallpaper blur"
              min={0}
              max={16}
              value={wallpaperBlur}
              onChange={(blur) => setWallpaper({ blur })}
              format={(value) => `${value}px`}
            />
          }
        />
      </Section>

      <Section
        title="Refresh rate readout"
        description="A measured estimate of the display's refresh timing, taken from requestAnimationFrame deltas. It is not a frame-rate counter, and it reports nothing the OS is not actually observing."
      >
        <Row
          label="Display readout"
          control={
            <Segmented
              label="Refresh rate readout"
              value={hzDisplay}
              onChange={setHzDisplay}
              options={[
                { value: "off", label: "Off" },
                { value: "corner", label: "Corner" },
                { value: "panel", label: "Panel" },
              ]}
            />
          }
        />
        <Row
          label="Current measurement"
          description="Sampled while this page is open."
          control={
            <span className="cr-num">
              {refresh
                ? `${refresh.hz.toFixed(1)} Hz · ${refresh.frameMs.toFixed(2)} ms`
                : "Sampling…"}
            </span>
          }
        />
      </Section>
    </>
  );
}

function Impact({
  label,
  impact,
  disabled,
}: {
  label: string;
  impact: "big" | "small";
  disabled: boolean;
}) {
  return (
    <div className="cr-impact">
      <span className="cr-impact__label">{label}</span>
      <Badge tone={disabled ? "success" : impact === "big" ? "warning" : "default"}>
        {disabled ? "Disabled" : impact === "big" ? "Big impact" : "Small impact"}
      </Badge>
    </div>
  );
}

/* ---- browser ----------------------------------------------------------- */

/**
 * Which files the backend is serving the proxy, and where they came from. This
 * is the one place a vendored `scramjet-assets/` folder becomes visible: a
 * version resolved from there is the operator's own copy, not an install.
 */
function proxyFileSummary(assets: ScramjetAssets | null): string {
  if (!assets) return "Not started yet in this session.";
  const files = Object.entries(assets.packages).map(
    ([name, entry]) => `${name} ${entry.version} · ${entry.source}`,
  );
  if (assets.missing.length) {
    files.push(`missing: ${assets.missing.map((entry) => entry.url).join(", ")}`);
  }
  return files.join(" — ") || "Nothing to serve.";
}

export function BrowserPage() {
  const browser = useBrowserStore();
  const proxy = useScramjetState();
  const system = useSystemStore();
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      await retryScramjet();
    } catch {
      // The shared service records the reason; the badge below shows it.
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Section title="Search and home">
        <Row
          label="Search engine"
          control={
            <Select
              aria-label="Search engine"
              value={browser.searchEngine}
              onChange={(event) => browser.setSearchEngine(event.target.value as SearchEngine)}
              options={(Object.keys(searchEngines) as SearchEngine[]).map((engine) => ({
                value: engine,
                label: searchEngines[engine].name,
              }))}
            />
          }
        />
        <Row label="Home page" description="Opened by new tabs. about:crystal is the start page." stacked>
          <TextInput
            value={browser.homepage}
            onChange={(event) => browser.setHomepage(event.target.value)}
            placeholder="about:crystal"
          />
        </Row>
      </Section>

      <Section
        title="Scramjet proxy"
        description="Every proxied application — Browser, Drive, Spotify, Audiomack, Discord, QMovies — can load through Scramjet and the Wisp transport, and each window keeps a proxy button in its toolbar so one application can be switched independently of the rest. The client assets, the rewriter and the transport are served by the Scramjet backend in server/scramjet."
      >
        <Row
          label="Proxy enabled"
          description="The master switch for the whole OS: applications follow it unless they have an override of their own — the Browser's setting below, or the proxy button in that application's toolbar. An overridden application says so in its own toolbar."
          control={
            <Switch
              label="Proxy enabled system-wide"
              checked={system.proxyEnabled}
              onChange={system.setProxyEnabled}
            />
          }
        />
        <Row
          label="In the Browser"
          description="Inherit the system switch, or force the proxy on or off for browser tabs only."
          control={
            <Segmented
              label="Browser proxy mode"
              value={browser.proxyMode}
              onChange={(proxyMode) => browser.setProxyMode(proxyMode)}
              options={[
                { value: "inherit", label: "System" },
                { value: "on", label: "On" },
                { value: "off", label: "Off" },
              ]}
            />
          }
        />
        <Row
          label="Status"
          control={
            <Badge
              tone={proxy.status === "ready" ? "success" : proxy.status === "error" ? "danger" : "default"}
              icon={proxy.status === "ready" ? "check" : "info"}
            >
              {proxy.status === "ready"
                ? "Ready"
                : proxy.status === "loading"
                  ? "Starting"
                  : proxy.status === "error"
                    ? "Unavailable"
                    : "Idle"}
            </Badge>
          }
        />
        <Row
          label="Transport"
          description={proxy.transport ? `Dialling the ${proxy.transport} client over Wisp.` : "Not started yet in this session."}
        />
        <Row label="Proxy files" description={proxyFileSummary(proxy.assets)} />
        <Row
          label="Backend"
          description={
            proxy.error ??
            (proxy.backendReachable === null
              ? "Not probed yet."
              : proxy.backendReachable
                ? "The backend answered on this origin."
                : "Nothing answered on /api/proxy-status.")
          }
        />
        <div className="cr-button-row">
          <Button icon="refresh" disabled={checking} onClick={() => void check()}>
            {checking ? "Starting…" : "Start and check proxy"}
          </Button>
          <Button icon="external" onClick={() => openApp("browser")}>
            Open CrystalOS Browser
          </Button>
        </div>
        <p className="cr-row__desc">
          Development: <code className="cr-code">npm run dev</code> now starts Vite and the Scramjet
          backend together, so the proxy is live as soon as the app loads. Production:{" "}
          <code className="cr-code">npm run build &amp;&amp; npm start</code> serves the built shell and
          the proxy from one process on port 8787.
        </p>
      </Section>

      <Section title="Browsing data">
        <Row
          label="History"
          description={`${browser.history.length} entries`}
          control={
            <Button size="sm" variant="danger" onClick={browser.clearHistory}>
              Clear
            </Button>
          }
        />
        <Row label="Bookmarks" description={`${browser.bookmarks.length} saved`} />
        <Row
          label="Downloads"
          description={`${browser.downloads.length} recorded`}
          control={
            <Button size="sm" variant="danger" onClick={browser.clearDownloads}>
              Clear
            </Button>
          }
        />
      </Section>
    </>
  );
}

/* ---- tab identity (OS-level cloaking) ---------------------------------- */

export function TabIdentityPage() {
  const identity = useTabIdentityStore();
  const [draft, setDraft] = useState({
    name: "",
    title: "",
    favicon: "/cloak/study.svg",
    description: "",
  });

  const presets = [...builtInTabIdentities, ...identity.presets];
  const active = identity.enabled ? presets.find((preset) => preset.id === identity.presetId) : undefined;
  const [hostTitle, setHostTitle] = useState(() => (typeof document === "undefined" ? "" : document.title));

  // Re-read the real host tab title so this page reports what the browser is
  // actually showing rather than what was requested.
  useEffect(() => {
    setHostTitle(document.title);
  }, [identity.enabled, identity.presetId, identity.lastError]);

  return (
    <>
      <Section
        title="Tab identity"
        description="Changes the browser tab this whole OS session runs in: its title and its icon. It is an operating-system setting, not a browser preference, so it stays active whatever window you are using and survives a reload."
      >
        <Row
          label="Tab identity enabled"
          control={
            <Switch
              label="Tab identity enabled"
              checked={identity.enabled}
              onChange={(enabled) => identity.setEnabled(enabled)}
            />
          }
        />
        <Row
          label="Active preset"
          control={
            <Select
              aria-label="Tab identity preset"
              value={identity.presetId}
              disabled={!identity.enabled}
              onChange={(event) => identity.setPreset(event.target.value)}
              options={presets.map((preset) => ({ value: preset.id, label: preset.name }))}
            />
          }
        />
        <Row
          label="This browser tab reads"
          description={
            active
              ? `${hostTitle} · icon ${active.favicon}`
              : "CrystalOS (identity off)."
          }
          control={<Badge tone={identity.enabled ? "accent" : "default"}>{identity.enabled ? "On" : "Off"}</Badge>}
        />
        {identity.lastError && (
          <Row label="Notice" description={identity.lastError} control={<Badge tone="warning">Limited</Badge>} />
        )}
        <p className="cr-row__desc">
          What a web application can change is limited by the host browser: the shell owns the document
          title and the favicon. The URL bar, bookmarks and the browser's own menus belong to the browser
          and cannot be rewritten from a page — and installed or app-mode windows may keep the icon from
          their manifest. The page you are viewing is never altered.
        </p>
      </Section>

      <Section title="Presets" description="Built-in presets ship with local icons; custom presets are yours to edit.">
        {presets.map((preset) => (
          <Row
            key={preset.id}
            label={
              <span className="cr-cloak-row">
                <img className="cr-cloak-row__icon" src={preset.favicon} alt="" width={18} height={18} />
                {preset.name}
              </span>
            }
            description={`${preset.title} — ${preset.description}`}
            control={
              preset.builtIn ? (
                <Badge>Built in</Badge>
              ) : (
                <div className="cr-button-row">
                  <Button
                    size="sm"
                    onClick={() => {
                      identity.setPreset(preset.id);
                      identity.setEnabled(true);
                    }}
                  >
                    Use
                  </Button>
                  <Button size="sm" variant="danger" icon="trash" onClick={() => identity.removePreset(preset.id)}>
                    Delete
                  </Button>
                </div>
              )
            }
          />
        ))}
      </Section>

      <Section title="New preset" description="Custom presets point at a local icon, so nothing can 404.">
        <Field label="Preset name">
          <TextInput
            value={draft.name}
            placeholder="Reading list"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </Field>
        <Field label="Tab title">
          <TextInput
            value={draft.title}
            placeholder="Course Materials — Week 6"
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </Field>
        <Field label="Icon">
          <Select
            aria-label="Preset icon"
            value={draft.favicon}
            onChange={(event) => setDraft({ ...draft, favicon: event.target.value })}
            options={[
              { value: "/cloak/study.svg", label: "Study" },
              { value: "/cloak/documentation.svg", label: "Documentation" },
              { value: "/cloak/notes.svg", label: "Notes" },
              { value: "/cloak/calendar.svg", label: "Calendar" },
              { value: "/cloak/calculator.svg", label: "Calculator" },
              { value: "/cloak/search.svg", label: "Search" },
            ]}
          />
        </Field>
        <Field label="Description">
          <TextInput
            value={draft.description}
            placeholder="Optional note about what this preset is for"
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </Field>
        <div className="cr-button-row">
          <Button
            icon="plus"
            variant="primary"
            disabled={!draft.name.trim() || !draft.title.trim()}
            onClick={() => {
              const preset: TabIdentityPreset = {
                id: createId("identity"),
                name: draft.name.trim().slice(0, 40),
                title: draft.title.trim().slice(0, 80),
                favicon: draft.favicon,
                description: draft.description.trim().slice(0, 120) || "Custom preset",
              };
              identity.savePreset(preset);
              identity.setPreset(preset.id);
              setDraft({ name: "", title: "", favicon: "/cloak/study.svg", description: "" });
            }}
          >
            Add preset
          </Button>
          <Button icon="refresh" onClick={() => applyTabIdentity()}>
            Apply now
          </Button>
        </div>
      </Section>
    </>
  );
}

/* ---- network ----------------------------------------------------------- */

export function NetworkPage() {
  const status = useNetworkStatus();
  const offline = useOffline();
  const offlineMode = useSystemStore((state) => state.offlineMode);
  const setOfflineMode = useSystemStore((state) => state.setOfflineMode);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [measured, setMeasured] = useState<NetworkStatus | null>(null);
  const [probe, setProbe] = useState<{ running: boolean; message: string | null }>({
    running: false,
    message: null,
  });

  useEffect(() => {
    void estimateStorage().then(setStorage);
    setMeasured(readNetwork());
  }, []);

  /* One real request, through the same client every other surface uses, so the
     answer describes the OS rather than a special case invented for this page.
     While offline mode is on the client refuses before it reaches the network,
     which is why the button becomes "go back online" instead. */
  const runProbe = async () => {
    setProbe({ running: true, message: null });
    const result = await apiRequest<{ server?: boolean; user?: unknown }>("/me", {
      timeoutMs: 6_000,
    });
    setProbe({
      running: false,
      message: result.ok
        ? "The CrystalOS server answered."
        : `No answer: ${result.error.message}`,
    });
  };

  return (
    <>
      <Section
        title="Offline mode"
        description="While CrystalOS believes it has no network it refuses each request at once, instead of letting every one of them sit until it times out."
      >
        <Row
          label="Work offline"
          description={offlineExplanation(offline)}
          control={
            <Switch
              label="Work offline"
              checked={offlineMode === "forced"}
              onChange={(checked) => setOfflineMode(checked ? "forced" : "auto")}
            />
          }
        />
        <Row
          label="State"
          control={
            <Badge tone={offline.offline ? "danger" : "success"} icon={offline.offline ? "wifi-off" : "wifi"}>
              {offlineHeadline(offline)}
            </Badge>
          }
        />
        {!offline.offline && (
          <Row
            label="Connection test"
            description={
              probe.running
                ? "Asking the CrystalOS server…"
                : (probe.message ??
                  "Sends one real request through the same client every other surface uses.")
            }
            control={
              <Button size="sm" icon="refresh" disabled={probe.running} onClick={runProbe}>
                Check now
              </Button>
            }
          />
        )}
      </Section>

      <Section
        title="What that means in practice"
        description="Listed rather than implied, so the OS is not vague about what still works."
      >
        <div className="cr-offline-lists">
          <div>
            <h4>Not available offline</h4>
            <ul>
              {OFFLINE_UNAVAILABLE.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Still works offline</h4>
            <ul>
              {OFFLINE_AVAILABLE.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section
        title="Connection"
        description="Read from the browser's Network Information API. Browsers deliberately round these values."
      >
        <Row
          label="Status"
          control={
            <Badge
              tone={status.online ? "success" : "danger"}
              icon={status.online ? "wifi" : "wifi-off"}
            >
              {status.online ? "Online" : "Offline"}
            </Badge>
          }
        />
        <Row
          label="Connection type"
          control={<span className="cr-num">{status.effectiveType ?? "Unavailable"}</span>}
        />
        <Row
          label="Estimated downlink"
          control={
            <span className="cr-num">
              {status.downlinkMbps === null ? "Unavailable" : `${status.downlinkMbps} Mbps`}
            </span>
          }
        />
        <Row
          label="Round-trip time"
          control={
            <span className="cr-num">{status.rttMs === null ? "Unavailable" : `${status.rttMs} ms`}</span>
          }
        />
        <Row
          label="Data saver"
          description="Set by the user or the platform, not by CrystalOS."
          control={<Badge>{status.saveData ? "On" : "Off"}</Badge>}
        />
        {measured && (
          <Row
            label="Sampled at"
            description="Values above update while this page is open."
            control={<span className="cr-row__desc">{new Date().toLocaleTimeString()}</span>}
          />
        )}
      </Section>

      <Section title="Device capacity">
        <Row
          label="Logical processors"
          control={<span className="cr-num">{logicalProcessors() ?? "Unavailable"}</span>}
        />
        <Row
          label="Device memory"
          control={
            <span className="cr-num">
              {deviceMemoryGb() ? `${deviceMemoryGb()} GB` : "Unavailable"}
            </span>
          }
        />
        <Row
          label="Storage used by CrystalOS"
          description={
            storage
              ? `${formatBytes(storage.usage)} used of ${formatBytes(storage.quota)} available to this origin`
              : "This browser does not expose storage estimates."
          }
        />
      </Section>
    </>
  );
}

/* ---- power ------------------------------------------------------------- */

export function PowerPage() {
  const dim = usePlaybackStore((state) => state.dim);
  const setDim = usePlaybackStore((state) => state.setDim);
  const volume = usePlaybackStore((state) => state.volume);
  const setVolume = usePlaybackStore((state) => state.setVolume);
  const muted = usePlaybackStore((state) => state.muted);
  const toggleMuted = usePlaybackStore((state) => state.toggleMuted);
  const setPowerState = useShellStore((state) => state.setPowerState);
  const removeExtraBootAnimation = useSystemStore((state) => state.removeExtraBootAnimation);
  const setRemoveExtraBootAnimation = useSystemStore(
    (state) => state.setRemoveExtraBootAnimation,
  );
  const battery = useBattery();
  const deviceType = useSystemStore((state) => state.deviceType);
  const windowCount = useWindowStore((state) => state.windows.length);

  return (
    <>
      <Section title="Session">
        <Row
          label="Device type"
          description="Chosen during first-run setup; controls whether the panel shows a battery indicator."
          control={<Badge>{deviceType}</Badge>}
        />
        <Row label="Open windows" control={<span className="cr-num">{windowCount}</span>} />
        <div className="cr-button-row">
          <Button icon="lock" onClick={() => useShellStore.getState().setPowerState("locked")}>
            Lock
          </Button>
          <Button icon="sleep" onClick={() => setPowerState("sleep")}>
            Sleep
          </Button>
          <Button
            icon="restart"
            onClick={() => {
              useWindowStore.getState().closeAll();
              setPowerState("on");
            }}
          >
            Restart session
          </Button>
          <Button variant="danger" icon="power" onClick={() => setPowerState("off")}>
            Shut down
          </Button>
        </div>
      </Section>

      <Section title="Startup">
        <Row
          label="Remove extra boot animation time"
          description="The boot screen holds for a randomised 3–7 seconds so a start reads as a start. That hold is the only part of boot that is not real work; switching this on removes it and leaves the brief honest minimum. It is also skipped automatically whenever motion is reduced or performance mode is on."
          control={
            <Switch
              label="Remove extra boot animation time"
              checked={removeExtraBootAnimation}
              onChange={setRemoveExtraBootAnimation}
            />
          }
        />
      </Section>

      <Section title="Display and sound">
        <Row
          label="Screen dim"
          description="A dark overlay over the desktop. Browsers cannot change panel backlight, so this is the honest equivalent."
          control={
            <Slider
              label="Screen dim"
              min={0}
              max={0.6}
              step={0.02}
              value={dim}
              onChange={setDim}
              format={(value) => `${Math.round(value * 100)}%`}
            />
          }
        />
        <Row
          label="Output volume"
          description="Applies to audio played by CrystalOS applications."
          control={
            <Slider
              label="Output volume"
              min={0}
              max={1}
              step={0.02}
              value={volume}
              onChange={setVolume}
              format={(value) => `${Math.round(value * 100)}%`}
            />
          }
        />
        <Row label="Mute" control={<Switch label="Mute output" checked={muted} onChange={toggleMuted} />} />
      </Section>

      <Section title="Battery">
        {!hasBatteryApi() ? (
          <Row
            label="Battery"
            description="This browser does not implement the Battery Status API, so nothing is shown here or in the panel."
            control={<Badge tone="warning">Unavailable</Badge>}
          />
        ) : battery === undefined ? (
          <Row label="Battery" description="Reading…" />
        ) : battery === null ? (
          <Row label="Battery" description="This device reports no battery." />
        ) : (
          <>
            <Row label="Charge" control={<span className="cr-num">{Math.round(battery.level * 100)}%</span>} />
            <Row
              label="State"
              control={<Badge>{battery.charging ? "Charging" : "Discharging"}</Badge>}
            />
            <Row
              label="Time remaining"
              control={
                <span className="cr-num">
                  {battery.dischargingTime
                    ? `${Math.round(battery.dischargingTime / 60)} min`
                    : "Unavailable"}
                </span>
              }
            />
          </>
        )}
      </Section>
    </>
  );
}

/* ---- advanced ---------------------------------------------------------- */

const EXPORT_KEYS = [
  "appearance",
  "shell",
  "notifications",
  "widgets",
  "playback",
  "system",
  "apps",
  "browser",
];

export function AdvancedPage() {
  const developerMode = useSystemStore((state) => state.developerMode);
  const setDeveloperMode = useSystemStore((state) => state.setDeveloperMode);
  const rerunSetup = useSystemStore((state) => state.rerunSetup);
  const backgroundWidgetUpdates = useSystemStore((state) => state.backgroundWidgetUpdates);
  const setBackgroundWidgetUpdates = useSystemStore((state) => state.setBackgroundWidgetUpdates);

  const [resetOpen, setResetOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [size, setSize] = useState(0);

  useEffect(() => {
    setKeys(listKeys());
    setSize(byteSize());
  }, [notice]);

  const exportSettings = () => {
    const values: Record<string, unknown> = {};
    for (const key of EXPORT_KEYS) values[key] = loadJSON(key, null);
    const blob = new Blob([JSON.stringify({ exportedAt: Date.now(), values }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `crescent-settings-${SYSTEM_VERSION.build}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importSettings = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { values?: Record<string, unknown> };
      const values = parsed.values ?? {};
      let restored = 0;
      for (const key of EXPORT_KEYS) {
        if (values[key] != null) {
          saveJSON(key, values[key]);
          restored += 1;
        }
      }
      setNotice(
        restored > 0
          ? `Imported ${restored} settings groups. Reload to apply every change.`
          : "That export contained no known settings groups.",
      );
    } catch {
      setNotice("That file could not be read as a CrystalOS settings export.");
    }
  };

  const forgetEverything = () => {
    for (const key of listKeys()) window.localStorage.removeItem(`crescent.${key}`);
    window.location.reload();
  };

  return (
    <>
      <Section title="Developer">
        <Row
          label="Developer mode"
          description="Exposes live stores and a diagnostics report on window.crescent, and shows extra detail on application error screens."
          control={
            <Switch label="Developer mode" checked={developerMode} onChange={setDeveloperMode} />
          }
        />
        <Row
          label="Diagnostics"
          description="Available in the browser console while developer mode is on."
          control={<span className="cr-row__desc cr-code">window.crescent.report()</span>}
        />
      </Section>

      <Section title="Setup">
        <Row
          label="Run setup again"
          description="Returns to the first-run wizard. Files, wallpaper and settings are kept."
          control={
            <Button icon="restart" onClick={rerunSetup}>
              Restart setup
            </Button>
          }
        />
        <Row
          label="Background widget updates"
          control={
            <Switch
              label="Background widget updates"
              checked={backgroundWidgetUpdates}
              onChange={setBackgroundWidgetUpdates}
            />
          }
        />
      </Section>

      <Section title="Local data" description="CrystalOS stores everything in this browser profile.">
        <Row
          label="Storage available"
          control={
            <Badge tone={isPersistenceAvailable() ? "success" : "warning"}>
              {isPersistenceAvailable() ? "Yes" : "No"}
            </Badge>
          }
        />
        <Row label="Keys in use" control={<span className="cr-num">{keys.length}</span>} />
        <Row label="Approximate size" control={<span className="cr-num">{formatBytes(size)}</span>} />
        <Row label="Keys" stacked>
          <div className="cr-key-list">
            {keys.map((key) => (
              <span key={key} className="cr-code">
                {key}
              </span>
            ))}
          </div>
        </Row>
        <div className="cr-button-row">
          <Button icon="download" onClick={exportSettings}>
            Export settings
          </Button>
          <label className="cr-btn">
            <Icon name="upload" size={15} />
            Import settings
            <input
              type="file"
              accept="application/json,.json"
              className="cr-visually-hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importSettings(file);
                event.target.value = "";
              }}
            />
          </label>
          <Button variant="danger" icon="warning" onClick={() => setResetOpen(true)}>
            Erase all data
          </Button>
        </div>
        {notice && <p className="cr-row__desc">{notice}</p>}
      </Section>

      <Modal
        open={resetOpen}
        title="Erase all CrystalOS data?"
        onClose={() => setResetOpen(false)}
        footer={
          <>
            <Button onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button variant="danger" icon="trash" onClick={forgetEverything}>
              Erase everything
            </Button>
          </>
        }
      >
        <p className="cr-row__desc">
          This clears settings, accounts, messages, the virtual filesystem and imported wallpapers
          from this browser, then reloads. It cannot be undone. Export your settings first if you
          want a copy.
        </p>
      </Modal>
    </>
  );
}

/* ---- about ------------------------------------------------------------- */

export function AboutPage() {
  const [refresh, setRefresh] = useState<{ hz: number; frameMs: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0, dpr: 1 });

  useEffect(() => {
    void measureRefreshRate().then(setRefresh);
    setViewport({
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    });
  }, []);

  return (
    <>
      <Section title="CrystalOS">
        <div className="cr-about">
          <div className="cr-about__mark">
            <Icon name="wallpaper" size={30} />
          </div>
          <div>
            <div className="cr-about__name">
              CrystalOS {SYSTEM_VERSION.version} “{SYSTEM_VERSION.codename}”
            </div>
            <div className="cr-row__desc">
              Build {SYSTEM_VERSION.build} · released {SYSTEM_VERSION.releaseDate}
            </div>
          </div>
        </div>
        <Row
          label="Update log"
          control={
            <Button icon="updates" onClick={() => openApp("updates")}>
              Open Update Log
            </Button>
          }
        />
      </Section>

      <Section title="Runtime">
        <Row label="Runtime" control={<span>{aboutBuild.runtime}</span>} />
        <Row label="Interface" control={<span>{aboutBuild.renderer}</span>} />
        <Row label="Bundler" control={<span>{aboutBuild.bundler}</span>} />
        <Row label="State" control={<span>{aboutBuild.state}</span>} />
        <Row label="Persistence" control={<span>{aboutBuild.persistence}</span>} />
      </Section>

      <Section title="Environment">
        <Row label="User agent" stacked>
          <span className="cr-code cr-code--wrap">{navigator.userAgent}</span>
        </Row>
        <Row
          label="Viewport"
          control={
            <span className="cr-num">
              {viewport.width} × {viewport.height} @ {viewport.dpr}×
            </span>
          }
        />
        <Row
          label="Refresh estimate"
          control={<span className="cr-num">{refresh ? `${refresh.hz.toFixed(1)} Hz` : "Unavailable"}</span>}
        />
        <Row label="Languages" control={<span>{navigator.languages.join(", ")}</span>} />
      </Section>

      <Section
        title="Acknowledgements"
        description="The components that ship inside this build. Build-time tooling, proxy licences, artwork and development guidance are on the Credits page."
      >
        {credits
          .filter((entry) => entry.bundled)
          .map((entry) => (
            <Row
              key={entry.name}
              label={entry.name}
              description={`${entry.role} — ${entry.licence}`}
            />
          ))}
        <Row
          label="Full credits"
          description="Every third-party work, its licence and where it came from."
          control={
            <Button
              icon="shield"
              onClick={() => openApp("settings", { args: { page: "credits" } })}
            >
              Open Credits
            </Button>
          }
        />
      </Section>
    </>
  );
}
