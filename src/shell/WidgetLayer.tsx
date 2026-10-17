import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Icon, type IconName } from "@/icons/Icon";
import { Button } from "@/components/ui";
import { useClock } from "@/hooks/useClock";
import { useBattery } from "@/hooks/useBattery";
import { useNetworkStatus } from "@/hooks/useNetwork";
import { useViewport } from "@/hooks/useUi";
import { useAppearanceStore } from "@/state/appearance";
import { useFsStore, homeNodeId } from "@/state/fs";
import { usePlaybackStore } from "@/state/playback";
import { panelReservedTop, useShellStore } from "@/state/shell";
import { useSystemStore } from "@/state/system";
import { WIDGET_CELL, useWidgetStore } from "@/state/widgets";
import { useWindowStore } from "@/state/windows";
import { useNotificationStore } from "@/state/notifications";
import { openApp } from "@/services/os";
import { isOfflineNow } from "@/services/offline";
import { byteSize } from "@/services/storage";
import { clamp } from "@/utils/format";
import { deviceMemoryGb, logicalProcessors } from "@/services/system";
import { formatBytes, formatClockDuration, formatDateLong, formatTime, createId } from "@/utils/format";
import type { WidgetInstance } from "@/types";

/* ==========================================================================
   Widget layer

   Widgets live on their own layer, independent of windows. The layer is empty
   for a new profile — nothing is added until the user asks for it — and
   dragging is gated behind Settings → Widgets → Allow widget dragging.
   ========================================================================== */

/** Smallest widget the grip will shrink to, in grid cells. */
const MIN_WIDGET_CELLS = 2;

export function WidgetLayer() {
  const instances = useWidgetStore((state) => state.instances);
  const draggingEnabled = useWidgetStore((state) => state.draggingEnabled);
  const moveWidget = useWidgetStore((state) => state.moveWidget);
  const resizeWidget = useWidgetStore((state) => state.resizeWidget);
  const removeWidget = useWidgetStore((state) => state.removeWidget);
  const gestureHintShown = useWidgetStore((state) => state.gestureHintShown);
  const markGestureHintShown = useWidgetStore((state) => state.markGestureHintShown);
  const desktop = useShellStore((state) => state.desktop);
  const panel = useShellStore((state) => state.panel);
  const viewport = useViewport();
  /* The strip the top bar reserves. A widget dragged or left inside it would sit
     behind a translucent bar, which reads as a rendering fault. */
  const panelTop = panelReservedTop(panel.panelScale, panel.style);

  const [drag, setDrag] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [resize, setResize] = useState<{
    id: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);
  /** Shift is what turns a free drag into a snapped one; the widget shows it. */
  const [snapHeld, setSnapHeld] = useState(false);

  /* The gestures are not discoverable on their own, so the first move or resize
     explains them once and then never again. */
  const teachGestures = useCallback(() => {
    if (gestureHintShown) return;
    markGestureHintShown();
    useNotificationStore.getState().notify({
      appId: "system",
      icon: "grid",
      title: "Moving and resizing widgets",
      body: "Drag a widget by its header to move it, or by the grip in its corner to resize it. Hold ⇧ Shift while dragging to snap to the grid.",
    });
  }, [gestureHintShown, markGestureHintShown]);

  const onPointerDown = useCallback(
    (instance: WidgetInstance) => (event: ReactPointerEvent<HTMLElement>) => {
      if (!draggingEnabled || event.button !== 0) return;
      if ((event.target as HTMLElement).closest("[data-widget-no-drag]")) return;
      teachGestures();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      setDrag({
        id: instance.id,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      });
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* capture is best-effort; the drag still tracks pointermove */
      }
    },
    [draggingEnabled, teachGestures],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!drag) return;
      const x = event.clientX - drag.offsetX;
      const y = event.clientY - drag.offsetY;
      // Shift snaps for this drag only, whatever the setting says.
      const snapping = event.shiftKey;
      setSnapHeld(snapping);
      const nextY = Math.max(panelTop, y);
      // Applied straight away rather than on the next animation frame: a
      // pointermove is already coalesced to one per frame by the browser, and
      // deferring it means a stalled compositor freezes the widget mid-drag.
      moveWidget(drag.id, x, nextY, snapping ? true : undefined);
    },
    [drag, moveWidget, panelTop],
  );

  const releasePointer = (event: ReactPointerEvent<HTMLElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* nothing to release */
    }
  };

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    releasePointer(event);
    setSnapHeld(false);
    setDrag(null);
  }, []);

  /* ---- resizing --------------------------------------------------------
     The grip grows the widget in whole cells, so a resize can never leave a
     widget off the grid it is laid out on. */
  const onResizePointerDown = useCallback(
    (instance: WidgetInstance) => (event: ReactPointerEvent<HTMLElement>) => {
      if (!draggingEnabled || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      teachGestures();
      setResize({
        id: instance.id,
        startX: event.clientX,
        startY: event.clientY,
        startW: instance.w,
        startH: instance.h,
      });
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* capture is best-effort; the resize still tracks pointermove */
      }
    },
    [draggingEnabled, teachGestures],
  );

  const onResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!resize) return;
      // Stay inside the viewport: a widget is never resized past the screen.
      const maxW = Math.max(MIN_WIDGET_CELLS, Math.floor((viewport.width - 24) / WIDGET_CELL));
      const maxH = Math.max(MIN_WIDGET_CELLS, Math.floor((viewport.height - 24) / WIDGET_CELL));
      const w = clamp(resize.startW + Math.round((event.clientX - resize.startX) / WIDGET_CELL), MIN_WIDGET_CELLS, maxW);
      const h = clamp(resize.startH + Math.round((event.clientY - resize.startY) / WIDGET_CELL), MIN_WIDGET_CELLS, maxH);
      resizeWidget(resize.id, w, h);
    },
    [resize, resizeWidget, viewport.height, viewport.width],
  );

  const endResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    releasePointer(event);
    setResize(null);
  }, []);

  if (instances.length === 0) return null;

  return (
    <div className="cr-widgets" data-dragging={draggingEnabled}>
      {instances.map((instance) => {
        const width = instance.w * WIDGET_CELL;
        const height = instance.h * WIDGET_CELL;
        // Keep widgets on screen when the viewport shrinks.
        const x = Math.min(instance.x, Math.max(0, viewport.width - width - 12));
        // Kept out of the top bar's strip, and on screen when the viewport
        // shrinks.
        const y = Math.max(
          panelTop,
          Math.min(instance.y, Math.max(panelTop, viewport.height - height - 12)),
        );
        return (
          <section
            key={instance.id}
            className="cr-widget"
            data-draggable={draggingEnabled}
            data-active={drag?.id === instance.id || resize?.id === instance.id}
            data-snapping={drag?.id === instance.id && snapHeld}
            data-align={desktop.alignToGrid}
            style={{
              transform: `translate3d(${x}px, ${y}px, 0)`,
              width,
              height,
            }}
            onPointerDown={onPointerDown(instance)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-label={`${instance.widget} widget`}
          >
            {/* The header is the drag handle: the body is excluded so widget
                content keeps its own pointer behaviour, the remove button and
                the resize grip handle their own drags. */}
            <header className="cr-widget__header">
              <span className="cr-widget__title">{widgetTitles[instance.widget]}</span>
              {/* data-widget-no-drag keeps the header's drag from starting on
                  this button: the header captures the pointer for a drag, and a
                  captured pointer retargets the following click to the header,
                  which is why the X used to do nothing. */}
              <button
                type="button"
                className="cr-widget__remove"
                data-widget-no-drag
                aria-label="Remove widget"
                onClick={(event) => {
                  event.stopPropagation();
                  removeWidget(instance.id);
                }}
                title="Remove widget"
              >
                <Icon name="close" size={12} />
              </button>
            </header>
            <div className="cr-widget__body" data-widget-no-drag>
              <WidgetBody instance={instance} />
            </div>
            {draggingEnabled && (
              <button
                type="button"
                className="cr-widget__resize"
                data-widget-no-drag
                aria-label={`Resize ${widgetTitles[instance.widget]} widget`}
                title="Drag to resize · hold Shift to snap"
                onPointerDown={onResizePointerDown(instance)}
                onPointerMove={onResizePointerMove}
                onPointerUp={endResize}
                onPointerCancel={endResize}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

export const widgetTitles: Record<WidgetInstance["widget"], string> = {
  clock: "Clock",
  calendar: "Calendar",
  weather: "Weather",
  notes: "Quick note",
  system: "System status",
  music: "Now playing",
  shortcuts: "Shortcuts",
  battery: "Power",
  todo: "Tasks",
  files: "Files",
  network: "Network",
  countdown: "Timer",
};

export const widgetCatalog: { id: WidgetInstance["widget"]; name: string; description: string; icon: IconName }[] = [
  { id: "clock", name: "Clock", description: "Time and date, following the panel clock format.", icon: "clock" },
  { id: "calendar", name: "Calendar", description: "Month grid for the current month.", icon: "calendar" },
  { id: "weather", name: "Weather", description: "Current conditions from Open-Meteo using your location.", icon: "globe" },
  { id: "notes", name: "Quick note", description: "A scratchpad saved as a real file in your filesystem.", icon: "notes" },
  { id: "system", name: "System status", description: "Only measurements the browser exposes.", icon: "activity" },
  { id: "music", name: "Now playing", description: "Transport controls for the Music application.", icon: "music" },
  { id: "shortcuts", name: "Shortcuts", description: "One-click launchers for the apps you use most.", icon: "grid" },
  { id: "battery", name: "Power", description: "Battery level from the Battery Status API when available.", icon: "battery-full" },
  { id: "todo", name: "Tasks", description: "A checklist that keeps its ticked state.", icon: "check" },
  { id: "files", name: "Files", description: "What the virtual filesystem is holding right now.", icon: "folder" },
  { id: "network", name: "Network", description: "Link type, round-trip time and save-data from the browser.", icon: "wifi" },
  { id: "countdown", name: "Timer", description: "A countdown you can start, pause and reset.", icon: "clock" },
];

function WidgetBody({ instance }: { instance: WidgetInstance }) {
  switch (instance.widget) {
    case "clock":
      return <ClockWidget />;
    case "calendar":
      return <CalendarWidget />;
    case "weather":
      return <WeatherWidget />;
    case "notes":
      return <NotesWidget />;
    case "system":
      return <SystemWidget />;
    case "music":
      return <MusicWidget />;
    case "shortcuts":
      return <ShortcutsWidget />;
    case "battery":
      return <BatteryWidget />;
    case "todo":
      return <TodoWidget instance={instance} />;
    case "files":
      return <FilesWidget />;
    case "network":
      return <NetworkWidget />;
    case "countdown":
      return <CountdownWidget instance={instance} />;
    default:
      return null;
  }
}

function ClockWidget() {
  const panel = useShellStore((state) => state.panel);
  const backgroundUpdates = useSystemStore((state) => state.backgroundWidgetUpdates);
  // With background updates off the widget still shows the right time, it just
  // refreshes once a minute instead of every second.
  const interval = backgroundUpdates ? (panel.clockSeconds ? 1000 : 15_000) : 60_000;
  const now = useClock(interval);
  const date = new Date(now);
  return (
    <div className="cr-widget__clock">
      <div className="cr-widget__clock-time cr-num">{formatTime(date, panel.clock12h, panel.clockSeconds)}</div>
      <div className="cr-widget__clock-date">{formatDateLong(date, true)}</div>
    </div>
  );
}

function CalendarWidget() {
  const now = useClock(60_000);
  const date = new Date(now);
  const year = date.getFullYear();
  const month = date.getMonth();
  const today = date.getDate();

  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first grid
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const list: (number | null)[] = [];
    for (let i = 0; i < startOffset; i += 1) list.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) list.push(day);
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [month, year]);

  return (
    <div className="cr-widget__calendar">
      <div className="cr-widget__calendar-head">
        {new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date)}
      </div>
      <div className="cr-widget__calendar-grid cr-widget__calendar-grid--head">
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      <div className="cr-widget__calendar-grid">
        {cells.map((day, index) => (
          <span key={index} data-today={day === today} data-empty={day === null}>
            {day ?? ""}
          </span>
        ))}
      </div>
    </div>
  );
}

interface WeatherNow {
  temperature: number;
  windSpeed: number;
  code: number;
  place: string;
}

const weatherCodes: Record<number, { label: string; icon: IconName }> = {
  0: { label: "Clear", icon: "brightness" },
  1: { label: "Mostly clear", icon: "brightness" },
  2: { label: "Partly cloudy", icon: "layers" },
  3: { label: "Overcast", icon: "layers" },
  45: { label: "Fog", icon: "layers" },
  48: { label: "Freezing fog", icon: "layers" },
  51: { label: "Light drizzle", icon: "download" },
  61: { label: "Rain", icon: "download" },
  63: { label: "Rain", icon: "download" },
  65: { label: "Heavy rain", icon: "download" },
  71: { label: "Snow", icon: "sparkle" },
  73: { label: "Snow", icon: "sparkle" },
  75: { label: "Heavy snow", icon: "sparkle" },
  80: { label: "Showers", icon: "download" },
  95: { label: "Thunderstorm", icon: "warning" },
};

/**
 * Weather comes from Open-Meteo, which requires no API key, and the location
 * comes from the browser's geolocation prompt. If either is unavailable the
 * widget says so instead of showing invented conditions.
 */
function WeatherWidget() {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; data: WeatherNow }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const load = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState({ status: "error", message: "This browser has no location service." });
      return;
    }
    /* Weather is fetched from the internet, so an offline OS should say that
       rather than ask for a location it cannot use. */
    if (isOfflineNow()) {
      setState({ status: "error", message: "CrystalOS is offline, so there is no weather to fetch." });
      return;
    }
    setState({ status: "loading" });
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(3)}&longitude=${longitude.toFixed(3)}&current=temperature_2m,wind_speed_10m,weather_code`,
          );
          if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
          const payload = (await response.json()) as {
            current?: { temperature_2m?: number; wind_speed_10m?: number; weather_code?: number };
          };
          const current = payload.current;
          if (!current || current.temperature_2m === undefined) throw new Error("No reading returned");
          setState({
            status: "ready",
            data: {
              temperature: current.temperature_2m,
              windSpeed: current.wind_speed_10m ?? 0,
              code: current.weather_code ?? 0,
              place: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
            },
          });
        } catch (error) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Request failed",
          });
        }
      },
      (error) => {
        setState({
          status: "error",
          message:
            error.code === error.PERMISSION_DENIED
              ? "Location permission denied."
              : "Location unavailable.",
        });
      },
      { timeout: 10_000, maximumAge: 600_000 },
    );
  }, []);

  if (state.status === "idle") {
    return (
      <div className="cr-widget__center">
        <Icon name="globe" size={20} className="cr-widget__muted-icon" />
        <p className="cr-widget__hint">Weather needs your location to fetch a reading.</p>
        <Button size="sm" onClick={load} icon="download">
          Get weather
        </Button>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="cr-widget__center">
        <span className="cr-spinner" />
        <p className="cr-widget__hint">Requesting location…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="cr-widget__center">
        <Icon name="warning" size={18} className="cr-widget__muted-icon" />
        <p className="cr-widget__hint">{state.message}</p>
        <Button size="sm" onClick={load} icon="refresh">
          Retry
        </Button>
      </div>
    );
  }

  const condition = weatherCodes[state.data.code] ?? { label: "Unknown", icon: "question" as IconName };
  return (
    <div className="cr-widget__weather">
      <Icon name={condition.icon} size={26} />
      <div>
        <div className="cr-widget__weather-temp cr-num">{Math.round(state.data.temperature)}°C</div>
        <div className="cr-widget__weather-label">{condition.label}</div>
        <div className="cr-widget__weather-meta cr-num">
          wind {state.data.windSpeed.toFixed(1)} km/h · {state.data.place}
        </div>
        <div className="cr-widget__weather-credit">Open-Meteo</div>
      </div>
    </div>
  );
}

function NotesWidget() {
  const nodes = useFsStore((state) => state.nodes);
  const setContent = useFsStore((state) => state.setContent);
  const createFile = useFsStore((state) => state.createFile);

  // The scratch file is resolved once per mount; the store updates afterwards.
  const [fileId] = useState(() => {
    const existing = nodes.find((node) => node.name === "Scratch.txt" && !node.trashed);
    if (existing) return existing.id;
    return createFile(homeNodeId(nodes), "Scratch.txt", "");
  });

  const file = nodes.find((node) => node.id === fileId);
  const [draft, setDraft] = useState(file?.content ?? "");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!file) return;
    setDraft(file.content ?? "");
  }, [file?.id]);

  const onChange = useCallback(
    (value: string) => {
      setDraft(value);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setContent(fileId, value), 600);
    },
    [fileId, setContent],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <textarea
      className="cr-widget__textarea"
      value={draft}
      placeholder="Write something. It is saved to ~/Scratch.txt"
      onChange={(event) => onChange(event.target.value)}
      spellCheck={false}
      aria-label="Quick note"
    />
  );
}

function SystemWidget() {
  const viewport = useViewport();
  const osScale = useAppearanceStore((state) => state.osScale);
  const network = useNetworkStatus();
  const windows = useWindowStore((state) => state.windows.length);
  const sessionStartedAt = useSystemStore((state) => state.sessionStartedAt);
  const performanceMode = useSystemStore((state) => state.performanceMode);
  const backgroundUpdates = useSystemStore((state) => state.backgroundWidgetUpdates);
  const now = useClock(backgroundUpdates ? 15_000 : 60_000);

  const rows: [string, string][] = [
    // The desktop is measured in OS pixels (viewport ÷ UI scale), so the scale
    // is shown alongside it whenever it is not 100%.
    [
      "Desktop",
      osScale === 1
        ? `${viewport.width} × ${viewport.height}`
        : `${viewport.width} × ${viewport.height} @ ${Math.round(osScale * 100)}%`,
    ],
    ["Network", network.online ? (network.effectiveType ?? "online") : "offline"],
    ["Windows", String(windows)],
    ["Session", formatClockDuration(now - sessionStartedAt)],
    ["Profile", performanceMode ? "performance" : "full"],
    ["Settings", formatBytes(byteSize())],
  ];

  const memory = deviceMemoryGb();
  const cores = logicalProcessors();
  if (memory != null) rows.splice(3, 0, ["Device RAM", `${memory} GB`]);
  if (cores != null) rows.splice(4, 0, ["Threads", String(cores)]);

  return (
    <div className="cr-widget__stats">
      {rows.map(([label, value]) => (
        <div key={label} className="cr-widget__stat">
          <span className="cr-widget__stat-label">{label}</span>
          <span className="cr-widget__stat-value cr-num">{value}</span>
        </div>
      ))}
    </div>
  );
}

function MusicWidget() {
  const nowPlaying = usePlaybackStore((state) => state.nowPlaying);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const progress = usePlaybackStore((state) => state.progress);
  const duration = usePlaybackStore((state) => state.duration);

  if (!nowPlaying) {
    return (
      <div className="cr-widget__center">
        <Icon name="music" size={20} className="cr-widget__muted-icon" />
        <p className="cr-widget__hint">Nothing is playing.</p>
        <Button size="sm" onClick={() => openApp("music")} icon="play">
          Open Music
        </Button>
      </div>
    );
  }

  return (
    <div className="cr-widget__music">
      <div className="cr-widget__music-title cr-truncate">{nowPlaying.title}</div>
      <div className="cr-widget__music-artist cr-truncate">{nowPlaying.artist}</div>
      <div className="cr-widget__music-bar">
        <span className="cr-num">{formatClockDuration(progress)}</span>
        <div className="cr-progress">
          <div
            className="cr-progress__fill"
            style={{ width: `${duration > 0 ? (progress / duration) * 100 : 0}%` }}
          />
        </div>
        <span className="cr-num">{formatClockDuration(duration)}</span>
      </div>
      <div className="cr-widget__music-state">
        <Icon name={isPlaying ? "play" : "pause"} size={12} />
        {isPlaying ? "Playing" : "Paused"} · control playback in Music
      </div>
    </div>
  );
}

function ShortcutsWidget() {
  const shortcuts: { appId: string; label: string; icon: IconName }[] = [
    { appId: "drive", label: "Drive", icon: "drive" },
    { appId: "terminal", label: "Terminal", icon: "terminal" },
    { appId: "browser", label: "Browser", icon: "browser" },
    { appId: "games", label: "Games", icon: "games" },
    { appId: "music", label: "Music", icon: "music" },
    { appId: "wallpaper", label: "Wallpapers", icon: "wallpaper" },
  ];

  return (
    <div className="cr-widget__shortcuts">
      {shortcuts.map((shortcut) => (
        <button
          key={shortcut.label}
          type="button"
          className="cr-widget__shortcut"
          onClick={() => openApp(shortcut.appId)}
        >
          <Icon name={shortcut.icon} size={16} />
          <span>{shortcut.label}</span>
        </button>
      ))}
    </div>
  );
}

function BatteryWidget() {
  const battery = useBattery();
  if (battery === undefined) {
    return (
      <div className="cr-widget__center">
        <span className="cr-spinner" />
      </div>
    );
  }
  if (battery === null) {
    return (
      <div className="cr-widget__center">
        <Icon name="battery-full" size={20} className="cr-widget__muted-icon" />
        <p className="cr-widget__hint">
          This browser does not expose battery status. Nothing is displayed rather than a guess.
        </p>
      </div>
    );
  }
  return (
    <div className="cr-widget__battery">
      <div className="cr-widget__battery-level cr-num">{Math.round(battery.level * 100)}%</div>
      <div className="cr-widget__battery-state">
        {battery.charging ? "Charging" : "On battery"}
      </div>
      <div className="cr-progress" style={{ marginTop: 8 }}>
        <div className="cr-progress__fill" style={{ width: `${battery.level * 100}%` }} />
      </div>
      {battery.dischargingTime != null && !battery.charging && (
        <div className="cr-widget__hint" style={{ marginTop: 6 }}>
          About {Math.round(battery.dischargingTime / 60)} minutes remaining, per the browser.
        </div>
      )}
    </div>
  );
}

/* ---- tasks ------------------------------------------------------------- */

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

function TodoWidget({ instance }: { instance: WidgetInstance }) {
  const configureWidget = useWidgetStore((state) => state.configureWidget);
  const todos = (instance.settings?.todos as TodoItem[] | undefined) ?? [];
  const [draft, setDraft] = useState("");

  const commit = (next: TodoItem[]) => configureWidget(instance.id, { todos: next });

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    commit([...todos, { id: createId("todo"), text: text.slice(0, 120), done: false }]);
    setDraft("");
  };

  const doneCount = todos.filter((item) => item.done).length;

  return (
    <div className="cr-widget__todo" data-widget-no-drag>
      <form
        className="cr-widget__todo-add"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          className="cr-widget__todo-input"
          value={draft}
          placeholder="Add a task…"
          aria-label="New task"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="button" className="cr-widget__todo-submit" aria-label="Add task" onClick={add}>
          <Icon name="plus" size={14} />
        </button>
      </form>
      {todos.length === 0 ? (
        <p className="cr-widget__hint">Nothing on the list. Add your first task above.</p>
      ) : (
        <ul className="cr-widget__todo-list">
          {todos.map((item) => (
            <li key={item.id} className="cr-widget__todo-item" data-done={item.done}>
              <button
                type="button"
                className="cr-widget__todo-check"
                aria-pressed={item.done}
                aria-label={item.done ? `Mark ${item.text} not done` : `Mark ${item.text} done`}
                onClick={() =>
                  commit(todos.map((entry) => (entry.id === item.id ? { ...entry, done: !entry.done } : entry)))
                }
              >
                {item.done && <Icon name="check" size={12} />}
              </button>
              <span className="cr-widget__todo-text cr-truncate">{item.text}</span>
              <button
                type="button"
                className="cr-widget__todo-remove"
                aria-label={`Remove ${item.text}`}
                onClick={() => commit(todos.filter((entry) => entry.id !== item.id))}
              >
                <Icon name="close" size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {todos.length > 0 && (
        <div className="cr-widget__hint">
          {doneCount}/{todos.length} done
        </div>
      )}
    </div>
  );
}

/* ---- files ------------------------------------------------------------- */

function FilesWidget() {
  const nodes = useFsStore((state) => state.nodes);
  const files = nodes.filter((node) => !node.trashed && node.kind === "file");
  const folders = nodes.filter((node) => !node.trashed && node.kind === "folder");
  const bytes = files.reduce((total, node) => total + (node.size ?? 0), 0);

  const rows: [string, string][] = [
    ["Files", String(files.length)],
    ["Folders", String(folders.length)],
    ["Size", formatBytes(bytes)],
  ];

  return (
    <div className="cr-widget__files" data-widget-no-drag>
      <div className="cr-widget__stats">
        {rows.map(([label, value]) => (
          <div key={label} className="cr-widget__stat">
            <span className="cr-widget__stat-label">{label}</span>
            <span className="cr-widget__stat-value cr-num">{value}</span>
          </div>
        ))}
      </div>
      <Button size="sm" icon="folder" onClick={() => openApp("drive")}>
        Open Drive
      </Button>
    </div>
  );
}

/* ---- network ----------------------------------------------------------- */

function NetworkWidget() {
  const network = useNetworkStatus();
  const rows: [string, string][] = [
    ["Status", network.online ? "Online" : "Offline"],
    ["Link", network.effectiveType ?? "Unknown"],
    ["Downlink", network.downlinkMbps == null ? "—" : `${network.downlinkMbps} Mbps`],
    ["Latency", network.rttMs == null ? "—" : `${network.rttMs} ms`],
    ["Data saver", network.saveData ? "On" : "Off"],
  ];
  return (
    <div className="cr-widget__stats" data-widget-no-drag>
      {rows.map(([label, value]) => (
        <div key={label} className="cr-widget__stat">
          <span className="cr-widget__stat-label">{label}</span>
          <span className="cr-widget__stat-value cr-num">{value}</span>
        </div>
      ))}
    </div>
  );
}

/* ---- timer ------------------------------------------------------------- */

const DEFAULT_COUNTDOWN_MINUTES = 5;

function CountdownWidget({ instance }: { instance: WidgetInstance }) {
  const configureWidget = useWidgetStore((state) => state.configureWidget);
  const minutes = (instance.settings?.minutes as number | undefined) ?? DEFAULT_COUNTDOWN_MINUTES;
  const endAt = (instance.settings?.endAt as number | null | undefined) ?? null;
  const [now, setNow] = useState(() => Date.now());

  const running = endAt != null && endAt > now;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  // When the countdown elapses it announces itself once and stops.
  useEffect(() => {
    if (endAt != null && endAt <= now) {
      configureWidget(instance.id, { endAt: null });
      useNotificationStore.getState().notify({
        appId: "system",
        icon: "clock",
        title: "Timer finished",
        body: `Your ${minutes}-minute timer is done.`,
      });
    }
  }, [configureWidget, endAt, instance.id, minutes, now]);

  const remainingMs = endAt != null ? Math.max(0, endAt - now) : minutes * 60_000;
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const clock = `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;

  const setMinutes = (next: number) =>
    configureWidget(instance.id, { minutes: clamp(next, 1, 180), endAt: null });

  return (
    <div className="cr-widget__countdown" data-widget-no-drag>
      <div className="cr-widget__countdown-time cr-num">{clock}</div>
      <div className="cr-widget__countdown-controls">
        <button
          type="button"
          className="cr-widget__countdown-min"
          aria-label="One minute less"
          disabled={running}
          onClick={() => setMinutes(minutes - 1)}
        >
          −
        </button>
        <Button
          size="sm"
          variant={running ? "default" : "primary"}
          icon={running ? "pause" : "play"}
          onClick={() =>
            running
              ? configureWidget(instance.id, { endAt: null, minutes: Math.max(1, Math.round(remainingMs / 60_000)) })
              : configureWidget(instance.id, { endAt: Date.now() + minutes * 60_000 })
          }
        >
          {running ? "Pause" : "Start"}
        </Button>
        <button
          type="button"
          className="cr-widget__countdown-min"
          aria-label="One minute more"
          disabled={running}
          onClick={() => setMinutes(minutes + 1)}
        >
          +
        </button>
      </div>
      <div className="cr-widget__hint">{minutes} minute{minutes === 1 ? "" : "s"} · adjust with − / +</div>
    </div>
  );
}
