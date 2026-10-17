import { useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, Modal, Segmented, TextInput } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { loadJSON, saveJSON } from "@/services/storage";
import { notify } from "@/services/os";
import { useAppearanceStore } from "@/state/appearance";
import { useSystemStore } from "@/state/system";
import {
  deleteCustomWallpaper,
  importWallpaperFile,
  listCustomWallpapers,
  renameCustomWallpaper,
} from "@/wallpapers/custom";
import { WallpaperPreview, useResolvedWallpaper } from "@/wallpapers/Wallpaper";
import { gradientWallpapers, builtInWallpapers, liveWallpapers } from "@/wallpapers/library";
import type { CustomWallpaperRecord, WallpaperSource } from "@/types";
import { liveSceneLabels } from "@/wallpapers/liveScenes";
import { formatRelative } from "@/utils/format";

/* ==========================================================================
   Wallpaper Library

   One entry point for every wallpaper on the system: photographic, generated
   gradient, procedural live scene and your own imported files.
   ========================================================================== */

const FAVOURITES_KEY = "wallpaper-favourites";

type Tab = "all" | "image" | "gradient" | "live" | "custom" | "favourites";
type Target = "desktop" | "lock" | "both";

interface Entry {
  id: string;
  name: string;
  kind: "image" | "gradient" | "live";
  category: string;
  credit?: string;
  custom?: CustomWallpaperRecord;
  mime?: string;
}

function builtInEntry(source: WallpaperSource): Entry {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    category: source.category,
    credit: source.credit,
  };
}

function customEntry(record: CustomWallpaperRecord): Entry {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind === "live" ? "live" : "image",
    category: "custom",
    custom: record,
    mime: record.mime,
  };
}

export function WallpaperLibrary() {
  const desktopId = useAppearanceStore((state) => state.wallpaper.desktopId);
  const lockId = useAppearanceStore((state) => state.wallpaper.lockId);
  const syncLock = useAppearanceStore((state) => state.wallpaper.syncLock);
  const setWallpaper = useAppearanceStore((state) => state.setWallpaper);
  const live = useAppearanceStore((state) => state.live);
  const setLive = useAppearanceStore((state) => state.setLive);
  const performanceMode = useSystemStore((state) => state.performanceMode);

  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [favourites, setFavourites] = useState<string[]>(() =>
    loadJSON<string[]>(FAVOURITES_KEY, []),
  );
  const [customs, setCustoms] = useState<CustomWallpaperRecord[]>(() => listCustomWallpapers());
  const [selected, setSelected] = useState<Entry | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    saveJSON(FAVOURITES_KEY, favourites);
  }, [favourites]);

  const entries = useMemo<Entry[]>(
    () => [
      ...customs.map(customEntry),
      ...builtInWallpapers.map(builtInEntry),
      ...gradientWallpapers.map(builtInEntry),
      ...liveWallpapers.map(builtInEntry),
    ],
    [customs],
  );

  const visible = useMemo(() => {
    const value = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (tab === "favourites" && !favourites.includes(entry.id)) return false;
      if (tab === "custom" && !entry.custom) return false;
      if (tab !== "all" && tab !== "custom" && tab !== "favourites" && entry.kind !== tab) {
        return false;
      }
      if (!value) return true;
      return `${entry.name} ${entry.category}`.toLowerCase().includes(value);
    });
  }, [entries, favourites, query, tab]);

  const apply = (entry: Entry, target: Target) => {
    const patch =
      target === "desktop"
        ? { desktopId: entry.id }
        : target === "lock"
          ? { lockId: entry.id }
          : { desktopId: entry.id, lockId: entry.id };

    setWallpaper(patch);

    // Selecting a live wallpaper should turn the live layer on; picking a
    // still wallpaper should turn it off, otherwise the desktop would show a
    // scene that has nothing to do with the tile the user clicked. Imported
    // video wallpapers are "live" too, so they start playing as well.
    if (entry.kind === "live") {
      const scene = liveWallpapers.find((source) => source.id === entry.id)?.scene;
      setLive(scene ? { scene, enabled: !performanceMode } : { enabled: !performanceMode });
    } else {
      setLive({ enabled: false });
    }

    notify({
      title: "Wallpaper applied",
      body:
        target === "both"
          ? `${entry.name} is now on the desktop and lock screen.`
          : `${entry.name} is now on the ${target === "desktop" ? "desktop" : "lock screen"}.`,
      icon: "wallpaper",
    });
  };

  const toggleFavourite = (id: string) =>
    setFavourites((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const runImport = async (file: File) => {
    setBusy(true);
    const result = await importWallpaperFile(file);
    setBusy(false);
    if (!result.ok) {
      setImportError(result.error ?? "That file could not be imported.");
      return;
    }
    setImportError(null);
    setCustoms(listCustomWallpapers());
    if (result.record) {
      setSelected(customEntry(result.record));
      apply(customEntry(result.record), "desktop");
    }
  };

  const removeCustom = async (entry: Entry) => {
    if (!entry.custom) return;
    await deleteCustomWallpaper(entry.custom);
    setCustoms(listCustomWallpapers());
    setFavourites((current) => current.filter((id) => id !== entry.id));
    setSelected(null);
    if (desktopId === entry.id) setWallpaper({ desktopId: "gradient-graphite" });
    if (lockId === entry.id) setWallpaper({ lockId: "gradient-graphite" });
  };

  const renameCustom = async (entry: Entry, name: string) => {
    if (!entry.custom) return;
    await renameCustomWallpaper(entry.custom, name);
    setCustoms(listCustomWallpapers());
    setSelected({ ...entry, name: name.slice(0, 48) });
  };

  const counts = {
    all: entries.length,
    favourites: favourites.length,
    custom: customs.length,
  };

  return (
    <div className="cr-wp-lib">
      <header className="cr-wp-lib__bar">
        <div className="cr-wp-lib__search">
          <TextInput
            icon="search"
            value={query}
            placeholder="Search wallpapers"
            aria-label="Search wallpapers"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <label className="cr-btn cr-btn--primary">
          <Icon name="upload" size={15} />
          {busy ? "Importing…" : "Import"}
          <input
            type="file"
            accept="image/*,video/mp4,video/webm"
            className="cr-visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void runImport(file);
              event.target.value = "";
            }}
          />
        </label>
      </header>

      <div className="cr-wp-lib__tabs">
        <Segmented
          label="Wallpaper category"
          value={tab}
          onChange={setTab}
          options={[
            { value: "all", label: `All ${counts.all}` },
            { value: "image", label: "Photographs" },
            { value: "gradient", label: "Gradients" },
            { value: "live", label: "Live" },
            { value: "custom", label: `Imported ${counts.custom}` },
            { value: "favourites", label: `Favourites ${counts.favourites}` },
          ]}
        />
      </div>

      {importError && <p className="cr-wp-lib__error">{importError}</p>}

      <div className="cr-wp-lib__scroll">
        {visible.length === 0 ? (
          <EmptyState
            icon="wallpaper"
            title={tab === "favourites" ? "No favourites yet" : "Nothing matches that search"}
            hint={
              tab === "favourites"
                ? "Open a wallpaper and mark it as a favourite to keep it here."
                : "Try a different term, or import your own image or video."
            }
          />
        ) : (
          <div className="cr-wp-grid">
            {visible.map((entry) => (
              <WallpaperTile
                key={entry.id}
                entry={entry}
                active={entry.id === desktopId}
                onLock={entry.id === lockId}
                favourite={favourites.includes(entry.id)}
                onToggleFavourite={() => toggleFavourite(entry.id)}
                onOpen={() => setSelected(entry)}
                onApply={() => apply(entry, "desktop")}
              />
            ))}
          </div>
        )}
      </div>

      <footer className="cr-wp-lib__foot">
        <span className="cr-row__desc">
          Desktop: {nameFor(entries, desktopId)} · Lock screen:{" "}
          {syncLock ? "synced with desktop" : nameFor(entries, lockId)}
        </span>
        <div className="cr-wp-lib__foot-actions">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setWallpaper({ syncLock: !syncLock, lockId: desktopId })}
          >
            {syncLock ? "Unlink lock screen" : "Sync lock screen"}
          </Button>
        </div>
      </footer>

      <DetailModal
        entry={selected}
        onClose={() => setSelected(null)}
        onApply={apply}
        favourite={selected ? favourites.includes(selected.id) : false}
        onToggleFavourite={() => selected && toggleFavourite(selected.id)}
        onDelete={() => selected && void removeCustom(selected)}
        onRename={(name) => selected && void renameCustom(selected, name)}
        liveEnabled={live.enabled}
        performanceMode={performanceMode}
        onToggleLive={(enabled) => setLive({ enabled })}
      />
    </div>
  );
}

function nameFor(entries: Entry[], id: string): string {
  return entries.find((entry) => entry.id === id)?.name ?? id;
}

function WallpaperTile({
  entry,
  active,
  onLock,
  favourite,
  onToggleFavourite,
  onOpen,
  onApply,
}: {
  entry: Entry;
  active: boolean;
  onLock: boolean;
  favourite: boolean;
  onToggleFavourite: () => void;
  onOpen: () => void;
  onApply: () => void;
}) {
  return (
    <article className="cr-wp-tile" data-active={active}>
      <button
        type="button"
        className="cr-wp-tile__preview"
        onDoubleClick={onApply}
        onClick={onOpen}
        aria-label={`Open ${entry.name}`}
      >
        <WallpaperPreview id={entry.id} radius={6} className="cr-wp-tile__image" />
        {entry.kind === "live" && (
          <span className="cr-wp-tile__live">
            <Icon name="play" size={11} /> Live
          </span>
        )}
      </button>
      <div className="cr-wp-tile__meta">
        <div className="cr-wp-tile__text">
          <span className="cr-wp-tile__name">{entry.name}</span>
          <span className="cr-wp-tile__sub">
            {entry.kind === "image" && entry.custom
              ? `Imported ${formatRelative(entry.custom.createdAt)}`
              : entry.category}
          </span>
        </div>
        <button
          type="button"
          className="cr-wp-tile__star"
          aria-label={favourite ? `Remove ${entry.name} from favourites` : `Favourite ${entry.name}`}
          aria-pressed={favourite}
          onClick={onToggleFavourite}
        >
          <Icon name="star" size={14} />
        </button>
      </div>
      {active && <span className="cr-wp-tile__badge">Desktop</span>}
      {onLock && !active && <span className="cr-wp-tile__badge">Lock</span>}
    </article>
  );
}

function DetailModal({
  entry,
  onClose,
  onApply,
  favourite,
  onToggleFavourite,
  onDelete,
  onRename,
  liveEnabled,
  performanceMode,
  onToggleLive,
}: {
  entry: Entry | null;
  onClose: () => void;
  onApply: (entry: Entry, target: Target) => void;
  favourite: boolean;
  onToggleFavourite: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  liveEnabled: boolean;
  performanceMode: boolean;
  onToggleLive: (enabled: boolean) => void;
}) {
  const resolved = useResolvedWallpaper(entry?.id ?? "");
  const [name, setName] = useState("");

  useEffect(() => {
    setName(entry?.name ?? "");
  }, [entry?.id, entry?.name]);

  if (!entry) return null;

  return (
    <Modal
      open
      title={entry.name}
      width={680}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" icon="star" onClick={onToggleFavourite}>
            {favourite ? "Remove favourite" : "Add to favourites"}
          </Button>
          <Button onClick={() => onApply(entry, "lock")}>Lock screen</Button>
          <Button variant="primary" icon="check" onClick={() => onApply(entry, "both")}>
            Apply to both
          </Button>
        </>
      }
    >
      <div className="cr-wp-detail">
        <div className="cr-wp-detail__stage">
          <WallpaperPreview id={entry.id} radius={8} className="cr-wp-detail__preview" />
        </div>
        <dl className="cr-wp-detail__facts">
          <div>
            <dt>Kind</dt>
            <dd>{resolved.kind}</dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{resolved.category}</dd>
          </div>
          {entry.mime && (
            <div>
              <dt>Format</dt>
              <dd>{entry.mime}</dd>
            </div>
          )}
          {entry.credit && (
            <div>
              <dt>Source</dt>
              <dd>{entry.credit}</dd>
            </div>
          )}
          {resolved.scene && (
            <div>
              <dt>Scene</dt>
              <dd>{liveSceneLabels[resolved.scene]}</dd>
            </div>
          )}
        </dl>

        {entry.kind === "live" && (
          <div className="cr-wp-detail__note">
            <Icon name="info" size={14} />
            <span>
              {performanceMode
                ? "Live scenes are paused while performance mode is on."
                : liveEnabled
                  ? "The live wallpaper layer is running."
                  : "The live wallpaper layer is off, so this scene is shown as a still."}
            </span>
            <Button
              size="sm"
              disabled={performanceMode}
              onClick={() => onToggleLive(!liveEnabled)}
            >
              {liveEnabled ? "Pause layer" : "Enable layer"}
            </Button>
          </div>
        )}

        {entry.custom && (
          <div className="cr-wp-detail__manage">
            <TextInput
              value={name}
              aria-label="Wallpaper name"
              onChange={(event) => setName(event.target.value)}
              onBlur={() => name.trim() && name !== entry.name && onRename(name.trim())}
            />
            <Button variant="ghost" icon="check" onClick={() => name.trim() && onRename(name.trim())}>
              Rename
            </Button>
            <Button variant="danger" icon="trash" onClick={onDelete}>
              Delete
            </Button>
          </div>
        )}

        <div className="cr-wp-detail__targets">
          <Badge>Double-click a tile to apply it immediately</Badge>
        </div>
      </div>
    </Modal>
  );
}

export default WallpaperLibrary;
