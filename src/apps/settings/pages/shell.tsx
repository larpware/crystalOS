import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  Row,
  Section,
  Segmented,
  Select,
  Slider,
  Switch,
  TextInput,
} from "@/components/ui";
import { Icon, AppIcon } from "@/icons/Icon";
import { appCatalog, metaFor, optionalApps, systemApps, type AppMeta } from "@/apps/catalog";
import { isImplemented } from "@/apps/registry";
import { openApp } from "@/services/os";
import { useAppsStore } from "@/state/apps";
import { useNotificationStore } from "@/state/notifications";
import {
  LAUNCHER_ICON_RANGE,
  LAUNCHER_TILE_RANGE,
  defaultLauncher,
  useShellStore,
} from "@/state/shell";
import { useWidgetStore, widgetSize, WIDGET_CELL } from "@/state/widgets";
import { shortcutViews, useShortcutStore } from "@/services/shortcuts";
import { formatCombo, type KeyCombo } from "@/services/keys";
import type { WidgetId } from "@/types";
import { formatRelative } from "@/utils/format";

/* ==========================================================================
   Settings — shell group
   ========================================================================== */

export function DockPage() {
  const { dock, setDock, panel, setPanel, desktop, setDesktop } = useShellStore();

  return (
    <>
      <Section title="Floating dock" description="The floating pill of icons. It does not name applications.">
        <Row
          label="Dock alignment"
          description="Horizontal anchor of the floating dock. The strip extends from this edge."
          control={
            <Segmented
              label="Dock alignment"
              value={dock.align}
              onChange={(align) => setDock({ align })}
              options={[
                { value: "left", label: "Left" },
                { value: "center", label: "Centre" },
                { value: "right", label: "Right" },
              ]}
            />
          }
        />
        <Row
          label="Corner radius"
          description="Rounding of the floating dock's corners."
          control={
            <Slider
              label="Dock corner radius"
              min={0}
              max={32}
              value={dock.borderRadius}
              onChange={(borderRadius) => setDock({ borderRadius })}
              format={(value) => `${value}px`}
              disabled={dock.mode !== "dock"}
            />
          }
        />
        <Row
          label="Icon size"
          description="Artwork size of each dock tile."
          control={
            <Slider
              label="Icon size"
              min={16}
              max={40}
              value={dock.iconSize}
              onChange={(iconSize) => setDock({ iconSize })}
              format={(value) => `${value}px`}
            />
          }
        />
        <Row
          label="Spacing"
          control={
            <Slider
              label="Spacing"
              min={0}
              max={18}
              value={dock.dockGap}
              onChange={(gap) => setDock({ dockGap: gap })}
              format={(value) => `${value}px`}
            />
          }
        />
        <Row
          label="Padding"
          control={
            <Slider
              label="Padding"
              min={2}
              max={24}
              value={dock.padding}
              onChange={(padding) => setDock({ padding })}
              format={(value) => `${value}px`}
            />
          }
        />
      </Section>

      <Section title="Taskbar" description="The bottom bar. A floating dock keeps only icons; a taskbar spans the edge and names each application.">
        <Row
          label="Shape"
          description="Floating dock or a full-width taskbar pinned to the edge."
          control={
            <Segmented
              label="Taskbar shape"
              value={dock.mode}
              onChange={(mode) => setDock({ mode })}
              options={[
                { value: "dock", label: "Floating dock" },
                { value: "taskbar", label: "Normal taskbar" },
              ]}
            />
          }
        />
        <Row
          label="Height extension"
          description="Grows the strip taller without changing the icon artwork size."
          control={
            <Slider
              label="Height extension"
              min={0}
              max={22}
              value={dock.height}
              onChange={(height) => setDock({ height })}
              format={(value) => `${value}px`}
            />
          }
        />
        <Row
          label="All Apps position"
          description="Where the All Apps box sits along the strip."
          control={
            <Segmented
              label="All Apps position"
              value={dock.allAppsPosition}
              onChange={(allAppsPosition) => setDock({ allAppsPosition })}
              options={[
                { value: "left", label: "Left" },
                { value: "center", label: "Centre" },
                { value: "right", label: "Right" },
              ]}
            />
          }
        />
        <Row
          label="Icon size"
          description="Artwork size of each taskbar tile."
          control={
            <Slider
              label="Icon size"
              min={16}
              max={40}
              value={dock.iconSize}
              onChange={(iconSize) => setDock({ iconSize })}
              format={(value) => `${value}px`}
            />
          }
        />
        <Row
          label="Spacing"
          control={
            <Slider
              label="Spacing"
              min={0}
              max={18}
              value={dock.taskbarGap}
              onChange={(gap) => setDock({ taskbarGap: gap })}
              format={(value) => `${value}px`}
            />
          }
        />
        <Row
          label="Padding"
          control={
            <Slider
              label="Padding"
              min={2}
              max={24}
              value={dock.padding}
              onChange={(padding) => setDock({ padding })}
              format={(value) => `${value}px`}
            />
          }
        />
        <Row
          label="Surface opacity"
          description="How far the wallpaper shows through the taskbar surface."
          control={
            <Slider
              label="Taskbar surface opacity"
              min={0.3}
              max={1}
              step={0.02}
              value={dock.opacity}
              onChange={(opacity) => setDock({ opacity })}
              format={(value) => `${Math.round(value * 100)}%`}
            />
          }
        />
        <Row
          label="Show app names"
          description="Labels each icon tile on the taskbar, including the All Apps button."
          control={
            <Switch
              label="Show app names"
              checked={dock.showAppNames}
              onChange={(showAppNames) => setDock({ showAppNames })}
            />
          }
        />
      </Section>

      <Section title="Top bar" description="How the top bar is laid out and how solid it is.">
        <Row
          label="Clock position"
          description="Moves the date and time to the left, centre or right of the bar."
          control={
            <Segmented
              label="Clock position"
              value={panel.clockPosition}
              onChange={(clockPosition) => setPanel({ clockPosition })}
              options={[
                { value: "left", label: "Left" },
                { value: "center", label: "Centre" },
                { value: "right", label: "Right" },
              ]}
            />
          }
        />
        <Row
          label="Style"
          description="A floating dock held off the screen edges, or a bar that spans them."
          control={
            <Segmented
              label="Top bar style"
              value={panel.style}
              onChange={(style) => setPanel({ style })}
              options={[
                { value: "dock", label: "Floating" },
                { value: "full", label: "Full width" },
              ]}
            />
          }
        />
        <Row
          label="Corner radius"
          description="Rounding of the floating bar's corners."
          control={
            <Slider
              label="Top bar corner radius"
              min={0}
              max={26}
              value={panel.radius}
              onChange={(radius) => setPanel({ radius })}
              format={(value) => `${value}px`}
              disabled={panel.style !== "dock"}
            />
          }
        />
        <Row
          label="Surface opacity"
          description="How far the wallpaper shows through the top bar surface."
          control={
            <Slider
              label="Top bar surface opacity"
              min={0.3}
              max={1}
              step={0.02}
              value={panel.opacity}
              onChange={(opacity) => setPanel({ opacity })}
              format={(value) => `${Math.round(value * 100)}%`}
            />
          }
        />
      </Section>

      <Section title="Desktop icons">
        <Row
          label="Show desktop icons"
          description="Home, Trash and any files placed on the desktop."
          control={
            <Switch
              label="Show desktop icons"
              checked={desktop.showIcons}
              onChange={(showIcons) => setDesktop({ showIcons })}
            />
          }
        />
        <Row
          label="Icon size"
          control={
            <Slider
              label="Desktop icon size"
              min={56}
              max={104}
              value={desktop.iconSize}
              onChange={(iconSize) => setDesktop({ iconSize })}
              format={(value) => `${value}px`}
            />
          }
        />
        <Row
          label="Align to grid"
          description="Snaps desktop icons to the widget grid."
          control={
            <Switch
              label="Align to grid"
              checked={desktop.alignToGrid}
              onChange={(alignToGrid) => setDesktop({ alignToGrid })}
            />
          }
        />
        <Row
          label="Window buttons"
          description="Traffic-light controls on the left or the right of a title bar."
          control={
            <Segmented
              label="Window controls"
              value={desktop.windowControls}
              onChange={(windowControls) => setDesktop({ windowControls })}
              options={[
                { value: "left", label: "Left" },
                { value: "right", label: "Right" },
              ]}
            />
          }
        />
      </Section>
    </>
  );
}

/* ---- widgets ----------------------------------------------------------- */

const widgetLabels: Record<WidgetId, string> = {
  clock: "Clock",
  calendar: "Calendar",
  weather: "Weather",
  notes: "Quick note",
  system: "System status",
  music: "Now playing",
  shortcuts: "Shortcuts",
  battery: "Battery",
  todo: "Tasks",
  files: "Files",
  network: "Network",
  countdown: "Timer",
};

const widgetDescription: Record<WidgetId, string> = {
  clock: "Time and date, with an optional second clock.",
  calendar: "Month view with today highlighted.",
  weather: "Current conditions from Open-Meteo using your location.",
  notes: "A scratchpad saved as a real file in your filesystem.",
  system: "Viewport, memory, processor count and refresh estimate.",
  music: "Transport controls for the Music application.",
  shortcuts: "One-click launch buttons for your pinned applications.",
  battery: "Charge level and state from the browser Battery API.",
  todo: "A checklist that remembers what is ticked.",
  files: "What the virtual filesystem is holding right now.",
  network: "Link type, latency and data-saver state.",
  countdown: "A countdown timer you can start, pause and reset.",
};

export function WidgetsPage() {
  const widgets = useWidgetStore();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <Section
        title="Widget layer"
        description="Widgets sit behind windows on the desktop. A new profile starts with an empty desktop."
      >
        <Row
          label="Move and resize widgets"
          description="Drag a widget by its header to move it, or by the grip in its corner to resize it. When off, widgets stay exactly where they are and keep the size they have."
          control={
            <Switch
              label="Move and resize widgets"
              checked={widgets.draggingEnabled}
              onChange={widgets.setDraggingEnabled}
            />
          }
        />
        <Row
          label="Always snap to grid"
          description={`Hold ⇧ Shift while dragging to snap a widget to the ${WIDGET_CELL}px grid for that drag alone. Turn this on to snap every time.`}
          control={
            <Switch
              label="Always snap to grid"
              checked={widgets.snapToGrid}
              onChange={widgets.setSnapToGrid}
            />
          }
        />
        <Row
          label="Show on lock screen"
          control={
            <Switch
              label="Show widgets on lock screen"
              checked={widgets.showOnLockScreen}
              onChange={widgets.setShowOnLockScreen}
            />
          }
        />
      </Section>

      <Section title="Placed widgets">
        {widgets.instances.length === 0 ? (
          <EmptyState
            icon="layout"
            title="No widgets added"
            hint="Open the widget picker to choose your first widget."
            action={
              <Button variant="primary" icon="plus" onClick={() => setPickerOpen(true)}>
                Add a widget
              </Button>
            }
          />
        ) : (
          <>
            {widgets.instances.map((instance) => (
              <Row
                key={instance.id}
                label={
                  <span className="cr-inline-label">
                    <Icon name="layout" size={14} /> {widgetLabels[instance.widget]}
                  </span>
                }
                description={`Position ${Math.round(instance.x)}, ${Math.round(instance.y)} · ${instance.w}×${instance.h} cells`}
                control={
                  <div className="cr-inline-actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="grid"
                      onClick={() =>
                        widgets.moveWidget(instance.id, instance.x + WIDGET_CELL, instance.y)
                      }
                    >
                      Nudge
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon="trash"
                      onClick={() => widgets.removeWidget(instance.id)}
                    >
                      Remove
                    </Button>
                  </div>
                }
              />
            ))}
            <div className="cr-button-row">
              <Button icon="plus" onClick={() => setPickerOpen(true)}>
                Add widget
              </Button>
              <Button variant="ghost" icon="trash" onClick={widgets.clearAll}>
                Remove all
              </Button>
            </div>
          </>
        )}
      </Section>

      <Modal open={pickerOpen} title="Widget picker" onClose={() => setPickerOpen(false)} width={560}>
        <div className="cr-widget-picker">
          {(Object.keys(widgetLabels) as WidgetId[]).map((widget) => (
            <button
              key={widget}
              type="button"
              className="cr-widget-picker__item"
              onClick={() => {
                widgets.addWidget(widget);
                setPickerOpen(false);
              }}
            >
              <span className="cr-widget-picker__head">
                <Icon name="layout" size={16} />
                <span>{widgetLabels[widget]}</span>
                <Badge>
                  {widgetSize[widget].w}×{widgetSize[widget].h}
                </Badge>
              </span>
              <span className="cr-widget-picker__desc">{widgetDescription[widget]}</span>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}

/* ---- notifications ----------------------------------------------------- */

export function NotificationsPage() {
  const { prefs, setPrefs, history, clearHistory, removeFromHistory, dismissAll } =
    useNotificationStore();

  return (
    <>
      <Section title="Delivery">
        <Row
          label="Do Not Disturb"
          description="Holds back new banners while keeping them in the history."
          control={
            <Switch
              label="Do Not Disturb"
              checked={prefs.doNotDisturb}
              onChange={(doNotDisturb) => setPrefs({ doNotDisturb })}
            />
          }
        />
        <Row
          label="Hide notifications"
          description="Hides banners without pretending Do Not Disturb is on. Independent of the toggle above."
          control={
            <Switch
              label="Hide notifications"
              checked={prefs.hidden}
              onChange={(hidden) => setPrefs({ hidden })}
            />
          }
        />
        <Row
          label="Banner duration"
          control={
            <Select
              aria-label="Banner duration"
              value={String(prefs.bannerDurationMs)}
              onChange={(event) => setPrefs({ bannerDurationMs: Number(event.target.value) })}
              options={[
                { value: "3000", label: "3 seconds" },
                { value: "5200", label: "5 seconds" },
                { value: "8000", label: "8 seconds" },
                { value: "12000", label: "12 seconds" },
              ]}
            />
          }
        />
        <Row
          label="Position"
          control={
            <Segmented
              label="Notification position"
              value={prefs.anchor}
              onChange={(anchor) => setPrefs({ anchor })}
              options={[
                { value: "bottom-right", label: "Bottom right" },
                { value: "bottom-left", label: "Bottom left" },
                { value: "top-right", label: "Top right" },
              ]}
            />
          }
        />
        <Row
          label="Show on lock screen"
          control={
            <Switch
              label="Show notifications on lock screen"
              checked={prefs.showOnLockScreen}
              onChange={(showOnLockScreen) => setPrefs({ showOnLockScreen })}
            />
          }
        />
      </Section>

      <Section
        title="History"
        description="Stored on this device only. Action buttons are not retained across reloads."
      >
        <Row
          label="Keep history"
          control={
            <Switch
              label="Keep history"
              checked={prefs.keepHistory}
              onChange={(keepHistory) => setPrefs({ keepHistory })}
            />
          }
        />
        <Row
          label="Maximum entries"
          control={
            <Select
              aria-label="Maximum history entries"
              value={String(prefs.maxHistory)}
              onChange={(event) => setPrefs({ maxHistory: Number(event.target.value) })}
              options={[
                { value: "20", label: "20" },
                { value: "60", label: "60" },
                { value: "200", label: "200" },
              ]}
            />
          }
        />
        {history.length === 0 ? (
          <EmptyState icon="bell" title="Nothing in the history" hint="Notifications you receive will appear here." />
        ) : (
          <>
            {history.slice(0, 25).map((notification) => (
              <Row
                key={notification.id}
                label={notification.title}
                description={`${notification.body ?? "No details"} · ${formatRelative(notification.createdAt)}`}
                control={
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="close"
                    aria-label={`Remove ${notification.title}`}
                    onClick={() => removeFromHistory(notification.id)}
                  />
                }
              />
            ))}
            <div className="cr-button-row">
              <Button variant="ghost" icon="check" onClick={dismissAll}>
                Mark all read
              </Button>
              <Button variant="danger" icon="trash" onClick={clearHistory}>
                Clear history
              </Button>
            </div>
          </>
        )}
      </Section>
    </>
  );
}

/* ---- keyboard ---------------------------------------------------------- */

/**
 * Shortcut bindings, read straight from the registry the keydown dispatcher
 * uses, so this page can never drift from what actually fires.
 *
 * A binding is re-recorded by pressing the keys: the next combination that
 * arrives is taken as the new one, exactly as the dispatcher would see it.
 */
export function KeyboardPage() {
  const { setBinding, clearBinding, resetAll } = useShortcutStore();
  const [listening, setListening] = useState<string | null>(null);
  const [captured, setCaptured] = useState<KeyCombo | null>(null);

  const views = shortcutViews();
  const conflicts = views.filter((view) => view.conflicting).length;
  const customised = views.filter((view) => view.customised).length;

  useEffect(() => {
    if (!listening) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setListening(null);
        setCaptured(null);
        return;
      }
      if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
        setCaptured({
          key: "",
          ctrl: event.ctrlKey,
          alt: event.altKey,
          shift: event.shiftKey,
          meta: event.metaKey,
        });
        return;
      }
      setBinding(listening, {
        key: event.key.toLowerCase(),
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey,
      });
      setListening(null);
      setCaptured(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [listening, setBinding]);

  const preview = captured ? formatCombo(captured) : null;

  return (
    <>
      <Section
        title="Shortcuts"
        description="Record a new combination for any action, or leave the default. Combinations the host browser claims are labelled rather than hidden."
      >
        {conflicts > 0 && (
          <Row
            label={`${conflicts} conflict${conflicts === 1 ? "" : "s"}`}
            description="Two shortcuts share a combination; only the first one registered will fire."
          />
        )}
        <div className="cr-shortcut-list">
          {views.map((view) => {
            const isListening = listening === view.definition.id;
            return (
              <div
                key={view.definition.id}
                className="cr-shortcut"
                data-conflicting={view.conflicting}
              >
                <button
                  type="button"
                  className="cr-shortcut__keys"
                  aria-label={`Change ${view.definition.label}`}
                  onClick={() => {
                    setCaptured(null);
                    setListening(isListening ? null : view.definition.id);
                  }}
                >
                  <kbd className="cr-kbd">
                    {isListening
                      ? (preview ?? "Press keys…")
                      : formatCombo(view.binding)}
                  </kbd>
                </button>
                <span className="cr-shortcut__action">
                  <span className="cr-shortcut__label">{view.definition.label}</span>
                  {view.definition.description && (
                    <span className="cr-row__desc">{view.definition.description}</span>
                  )}
                </span>
                <span className="cr-shortcut__tags">
                  {view.conflicting && <Badge tone="danger">Conflict</Badge>}
                  {view.browserReserved && <Badge tone="warning">May be reserved</Badge>}
                  {view.customised && (
                    <button
                      type="button"
                      className="cr-shortcut__reset"
                      onClick={() => clearBinding(view.definition.id)}
                    >
                      Reset
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <div className="cr-button-row">
          <Button
            variant="ghost"
            icon="refresh"
            disabled={customised === 0}
            onClick={() => {
              resetAll();
              setListening(null);
            }}
          >
            Reset all{customised > 0 ? ` (${customised})` : ""}
          </Button>
        </div>
      </Section>
      <Section title="Terminal">
        <Row
          label="Tab completion"
          description="Commands, paths and application ids complete on Tab."
        />
        <Row
          label="History"
          description="The last 200 commands are kept for the session and recalled with the arrow keys."
        />
      </Section>
    </>
  );
}

/* ---- applications ------------------------------------------------------ */

export function ApplicationsPage() {
  const { installed, removed, install, remove, recents, clearRecents, launchCounts } =
    useAppsStore();
  const [query, setQuery] = useState("");

  const term = query.trim().toLowerCase();
  const matches = (meta: AppMeta) =>
    !term || `${meta.name} ${meta.summary} ${meta.features.join(" ")}`.toLowerCase().includes(term);

  const systemList = systemApps().filter(matches);
  const optionalList = optionalApps().filter(matches);

  return (
    <>
      <Section title="Search" description="Filters both the system and optional lists below.">
        <Row label="Search" stacked>
          <TextInput
            icon="search"
            value={query}
            placeholder="Filter applications"
            onChange={(event) => setQuery(event.target.value)}
          />
        </Row>
      </Section>

      <Section
        title="System apps"
        description="The applications that are part of CrystalOS itself. They ship with the build, cannot be removed, and are not listed in the Store — this is where they live."
      >
        {systemList.length === 0 ? (
          <p className="cr-row__desc">No system application matches that search.</p>
        ) : (
          systemList.map((meta) => {
            const launches = launchCounts[meta.id] ?? 0;
            return (
              <Row
                key={meta.id}
                label={
                  <span className="cr-inline-label">
                    <AppIcon appId={meta.id} name={meta.icon} size={20} />
                    {meta.name}
                  </span>
                }
                description={`${meta.summary} · v${meta.version}${launches ? ` · launched ${launches}×` : ""}`}
                control={
                  <div className="cr-inline-actions">
                    <Button size="sm" icon="external" onClick={() => openApp(meta.id)}>
                      Open
                    </Button>
                    <Badge>System</Badge>
                  </div>
                }
              />
            );
          })
        )}
      </Section>

      <Section
        title="Optional applications"
        description="Bundled but optional, and the same list the Store manages. Remove one to hide it from this profile, or restore it — the bundle always stays on disk."
      >
        {optionalList.length === 0 ? (
          <p className="cr-row__desc">No optional application matches that search.</p>
        ) : (
          optionalList.map((meta) => {
            const isRemoved = removed.includes(meta.id);
            const installedEntry = installed.find((entry) => entry.appId === meta.id);
            const launches = launchCounts[meta.id] ?? 0;
            return (
              <Row
                key={meta.id}
                label={
                  <span className="cr-inline-label">
                    <AppIcon appId={meta.id} name={meta.icon} size={20} />
                    {meta.name}
                  </span>
                }
                description={
                  isRemoved
                    ? "Removed from this profile — the bundle stays on disk."
                    : `${meta.version}${installedEntry ? ` · installed ${formatRelative(installedEntry.installedAt)}` : ""}${launches ? ` · launched ${launches}×` : ""}`
                }
                control={
                  <div className="cr-inline-actions">
                    <Button size="sm" icon="external" onClick={() => openApp(meta.id)}>
                      Open
                    </Button>
                    {isRemoved ? (
                      <Button size="sm" icon="download" onClick={() => install(meta.id, meta.version)}>
                        Restore
                      </Button>
                    ) : (
                      <Button size="sm" variant="danger" onClick={() => remove(meta.id)}>
                        Remove
                      </Button>
                    )}
                  </div>
                }
              />
            );
          })
        )}
      </Section>

      <Section title="Recently used">
        {recents.length === 0 ? (
          <p className="cr-row__desc">Nothing launched yet in this profile.</p>
        ) : (
          <>
            <p className="cr-row__desc">{recents.map((id) => metaFor(id)?.name ?? id).join(" · ")}</p>
            <Button variant="ghost" icon="trash" onClick={clearRecents}>
              Clear recents
            </Button>
          </>
        )}
      </Section>
    </>
  );
}

/* ---- all apps ---------------------------------------------------------- */

/**
 * The All Apps panel is the one surface with sizes of its own: the artwork in
 * a tile, and the tile itself. Both are sliders, and the preview below renders
 * the real tile markup at the chosen numbers rather than an illustration, so
 * what is on screen is what the panel will do.
 */
export function AllAppsPage() {
  const launcher = useShellStore((state) => state.launcher);
  const setLauncher = useShellStore((state) => state.setLauncher);

  const previewApps = useMemo(
    () => appCatalog.filter((app) => isImplemented(app.id)).slice(0, 6),
    [],
  );

  const dirty =
    launcher.iconSize !== defaultLauncher.iconSize ||
    launcher.tileSize !== defaultLauncher.tileSize ||
    launcher.layout !== defaultLauncher.layout ||
    launcher.showCategories !== defaultLauncher.showCategories ||
    launcher.showRecents !== defaultLauncher.showRecents;

  return (
    <>
      <Section
        title="Preview"
        description="The panel's own grid, drawn at the sizes below. Nothing here changes the taskbar or the desktop."
      >
        <div className="cr-allapps-preview">
          <div
            className="cr-launcher__grid"
            style={{ "--launcher-tile": `${launcher.tileSize}px` } as CSSProperties}
          >
            {previewApps.map((app) => (
              <span key={app.id} className="cr-launcher__tile">
                <span className="cr-launcher__tile-icon">
                  <AppIcon appId={app.id} name={app.icon} size={launcher.iconSize} />
                </span>
                <span className="cr-launcher__tile-name">{app.name}</span>
              </span>
            ))}
          </div>
          <p className="cr-row__desc cr-num">
            Artwork {launcher.iconSize}px · tile {launcher.tileSize}px
          </p>
        </div>
      </Section>

      <Section title="Size">
        <Row
          label="Icon size"
          description="Artwork inside each tile. The list rows and the Recent strip scale with it."
          control={
            <Slider
              label="All Apps icon size"
              min={LAUNCHER_ICON_RANGE.min}
              max={LAUNCHER_ICON_RANGE.max}
              value={launcher.iconSize}
              onChange={(iconSize) => setLauncher({ iconSize })}
              format={(value) => `${value}px`}
            />
          }
        />
        <Row
          label="Tile size"
          description="Smallest width of a tile. Wider tiles fit fewer per row and give the names more room."
          control={
            <Slider
              label="All Apps tile size"
              min={LAUNCHER_TILE_RANGE.min}
              max={LAUNCHER_TILE_RANGE.max}
              value={launcher.tileSize}
              onChange={(tileSize) => setLauncher({ tileSize })}
              format={(value) => `${value}px`}
            />
          }
        />
        <div className="cr-button-row">
          <Button
            variant="ghost"
            icon="refresh"
            disabled={!dirty}
            onClick={() => setLauncher({ ...defaultLauncher })}
          >
            Reset to defaults
          </Button>
        </div>
      </Section>

      <Section title="Contents">
        <Row
          label="Category pills"
          description="The All · System · Internet row above the grid."
          control={
            <Switch
              checked={launcher.showCategories}
              onChange={(showCategories) => setLauncher({ showCategories })}
              label="Show category pills"
            />
          }
        />
        <Row
          label="Recent strip"
          description="The applications used most recently, in the panel's footer."
          control={
            <Switch
              checked={launcher.showRecents}
              onChange={(showRecents) => setLauncher({ showRecents })}
              label="Show the recent strip"
            />
          }
        />
        <Row
          label="Default layout"
          description="Grid of artwork, or a compact list with each application's summary."
          control={
            <Segmented
              label="Default All Apps layout"
              value={launcher.layout}
              onChange={(layout) => setLauncher({ layout })}
              options={[
                { value: "grid", label: "Grid" },
                { value: "list", label: "List" },
              ]}
            />
          }
        />
      </Section>
    </>
  );
}
