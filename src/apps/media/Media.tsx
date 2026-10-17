import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, EmptyState, IconButton, Segmented, TextInput } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { attachMedia, detachMedia, resumeAudio } from "@/services/audio";
import { notify } from "@/services/os";
import { useFsStore, homeNodeId, resolvePath } from "@/state/fs";
import { usePlaybackStore } from "@/state/playback";
import { formatBytes, formatClockDuration } from "@/utils/format";

/* ==========================================================================
   Media

   One player for the audio and video files in the CrystalOS filesystem. The
   library is derived from real files: import something into ~/Videos or
   ~/Music and it appears here.
   ========================================================================== */

interface MediaItem {
  id: string;
  nodeId: string;
  title: string;
  mime: string;
  size: number;
  modified: number;
  kind: "video" | "audio";
}

const VIDEO_MIME = /^video\//;
const AUDIO_MIME = /^audio\//;

export function Media() {
  const nodes = useFsStore((state) => state.nodes);
  const addBinary = useFsStore((state) => state.addBinary);
  const setNowPlaying = usePlaybackStore((state) => state.setNowPlaying);
  const setPlayingGlobal = usePlaybackStore((state) => state.setPlaying);
  const setProgressGlobal = usePlaybackStore((state) => state.setProgress);
  const volume = usePlaybackStore((state) => state.volume);
  const muted = usePlaybackStore((state) => state.muted);

  const mediaRef = useRef<HTMLVideoElement>(null);
  const [kind, setKind] = useState<"all" | "video" | "audio">("all");
  const [query, setQuery] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const library = useMemo<MediaItem[]>(
    () =>
      nodes
        .filter(
          (node) =>
            node.kind === "file" &&
            !node.trashed &&
            Boolean(node.dataUrl) &&
            (VIDEO_MIME.test(node.mime ?? "") || AUDIO_MIME.test(node.mime ?? "")),
        )
        .map((node) => ({
          id: `media:${node.id}`,
          nodeId: node.id,
          title: node.name.replace(/\.[^.]+$/, ""),
          mime: node.mime ?? "",
          size: node.size,
          modified: node.modified,
          kind: VIDEO_MIME.test(node.mime ?? "") ? ("video" as const) : ("audio" as const),
        }))
        .sort((a, b) => b.modified - a.modified),
    [nodes],
  );

  const list = useMemo(
    () =>
      library.filter((item) => {
        if (kind !== "all" && item.kind !== kind) return false;
        return item.title.toLowerCase().includes(query.toLowerCase());
      }),
    [kind, library, query],
  );

  const current = library.find((item) => item.id === currentId) ?? null;

  useEffect(() => {
    if (!currentId && list.length > 0) setCurrentId(list[0].id);
  }, [currentId, list]);

  useEffect(() => {
    const element = mediaRef.current;
    if (!element || !current) return;
    const node = nodes.find((entry) => entry.id === current.nodeId);
    if (!node?.dataUrl) return;
    element.src = node.dataUrl;
    attachMedia(element);
    setDuration(0);
    setPosition(0);
    setNowPlaying({
      id: current.id,
      title: current.title,
      artist: current.kind === "video" ? "Video" : "Audio",
      appId: "media",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  useEffect(() => {
    const element = mediaRef.current;
    if (!element) return;
    element.volume = muted ? 0 : volume;
  }, [muted, volume]);

  const wire = useCallback(() => {
    const element = mediaRef.current;
    if (!element) return () => undefined;
    const onTime = () => {
      setPosition(element.currentTime);
      if (Number.isFinite(element.duration)) setDuration(element.duration);
      setProgressGlobal(
        element.currentTime,
        Number.isFinite(element.duration) ? element.duration : undefined,
      );
    };
    const onPlay = () => {
      setPlaying(true);
      setPlayingGlobal(true);
    };
    const onPause = () => {
      setPlaying(false);
      setPlayingGlobal(false);
    };
    const onEnded = () => {
      setPlaying(false);
      setPlayingGlobal(false);
    };
    element.addEventListener("timeupdate", onTime);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("ended", onEnded);
    return () => {
      element.removeEventListener("timeupdate", onTime);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("ended", onEnded);
      detachMedia(element);
    };
  }, [setPlayingGlobal, setProgressGlobal]);

  useEffect(() => wire(), [wire]);

  const toggle = () => {
    const element = mediaRef.current;
    if (!element) return;
    if (playing) {
      element.pause();
      return;
    }
    void resumeAudio();
    void element.play().then(
      () => setPlaying(true),
      () => setError("Playback was blocked. Press play again to allow audio."),
    );
  };

  const step = (direction: 1 | -1) => {
    if (list.length === 0) return;
    const index = list.findIndex((item) => item.id === currentId);
    const nextIndex = (index + direction + list.length) % list.length;
    setCurrentId(list[nextIndex].id);
  };

  const importMedia = async (files: FileList) => {
    setImporting(true);
    setError(null);
    let added = 0;
    for (const file of Array.from(files)) {
      const isVideo = VIDEO_MIME.test(file.type);
      const isAudio = AUDIO_MIME.test(file.type);
      if (!isVideo && !isAudio) {
        setError(`${file.name} is not an audio or video file.`);
        continue;
      }
      if (file.size > 200 * 1024 * 1024) {
        setError(`${file.name} is larger than the 200 MB import limit.`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("unreadable"));
        reader.readAsDataURL(file);
      }).catch(() => null);
      if (!dataUrl) continue;
      const parent = resolvePath(nodes, isVideo ? "/Home/Videos" : "/Home/Music") ?? homeNodeId(nodes);
      addBinary(parent, file.name, file.type, dataUrl);
      added += 1;
    }
    setImporting(false);
    if (added > 0) {
      notify({
        title: `${added} file${added === 1 ? "" : "s"} imported`,
        body: "Videos go to ~/Videos, audio to ~/Music.",
        icon: "media",
      });
    }
  };

  const requestFullscreen = async () => {
    const element = mediaRef.current;
    if (!element) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch {
      /* the browser refused; nothing to report beyond the unchanged state */
    }
  };

  return (
    <div className="cr-media">
      <aside className="cr-media__rail">
        <div className="cr-media__rail-head">Library</div>
        <button
          type="button"
          className="cr-media__rail-item"
          aria-current={kind === "all"}
          onClick={() => setKind("all")}
        >
          <Icon name="layers" size={15} /> Everything
          <span>{library.length}</span>
        </button>
        <button
          type="button"
          className="cr-media__rail-item"
          aria-current={kind === "video"}
          onClick={() => setKind("video")}
        >
          <Icon name="video" size={15} /> Video
          <span>{library.filter((item) => item.kind === "video").length}</span>
        </button>
        <button
          type="button"
          className="cr-media__rail-item"
          aria-current={kind === "audio"}
          onClick={() => setKind("audio")}
        >
          <Icon name="music" size={15} /> Audio
          <span>{library.filter((item) => item.kind === "audio").length}</span>
        </button>

        <label className="cr-btn cr-btn--primary cr-media__import">
          <Icon name="upload" size={15} />
          {importing ? "Importing…" : "Import media"}
          <input
            type="file"
            accept="video/*,audio/*"
            multiple
            className="cr-visually-hidden"
            onChange={(event) => {
              if (event.target.files?.length) void importMedia(event.target.files);
              event.target.value = "";
            }}
          />
        </label>

        <div className="cr-media__rail-note">
          Files are copied into the CrystalOS filesystem and play from local storage. Nothing is
          uploaded.
        </div>
      </aside>

      <div className="cr-media__main">
        <div className="cr-media__stage">
          <video
            ref={mediaRef}
            className="cr-media__video"
            playsInline
            controls={false}
            loop={loop}
            onClick={toggle}
          />
          {!current && (
            <div className="cr-media__placeholder">
              <Icon name="media" size={26} />
              <p>Select something to play, or import a file to get started.</p>
            </div>
          )}
        </div>

        <div className="cr-media__controls">
          <div className="cr-media__transport">
            <IconButton icon="skip-back" label="Previous" onClick={() => step(-1)} />
            <IconButton
              icon={playing ? "pause" : "play"}
              label={playing ? "Pause" : "Play"}
              size={17}
              onClick={toggle}
            />
            <IconButton icon="skip-forward" label="Next" onClick={() => step(1)} />
            <IconButton
              icon="repeat"
              label="Loop"
              active={loop}
              onClick={() => {
                setLoop((value) => !value);
                if (mediaRef.current) mediaRef.current.loop = !loop;
              }}
            />
            <IconButton icon="expand" label="Fullscreen" onClick={() => void requestFullscreen()} />
          </div>

          <div className="cr-media__track">
            <span className="cr-num">{formatClockDuration(position * 1000)}</span>
            <input
              type="range"
              className="cr-music__seek"
              min={0}
              max={Math.max(1, Math.round(duration))}
              value={Math.min(Math.round(position), Math.max(1, Math.round(duration)))}
              aria-label="Seek"
              disabled={!current}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (mediaRef.current) mediaRef.current.currentTime = value;
                setPosition(value);
              }}
            />
            <span className="cr-num">{duration ? formatClockDuration(duration * 1000) : "—"}</span>
          </div>

          <span className="cr-media__title">
            {current ? current.title : "Nothing loaded"}
            {current && <Badge>{current.kind}</Badge>}
          </span>
        </div>

        <div className="cr-media__list">
          <header className="cr-media__list-bar">
            <h2>Library</h2>
            <div className="cr-media__search">
              <TextInput
                icon="search"
                value={query}
                aria-label="Search media"
                placeholder="Search"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <Segmented
              label="Kind"
              value={kind}
              onChange={setKind}
              options={[
                { value: "all", label: "All" },
                { value: "video", label: "Video" },
                { value: "audio", label: "Audio" },
              ]}
            />
          </header>

          {error && <p className="cr-media__error">{error}</p>}

          {list.length === 0 ? (
            <EmptyState
              icon="media"
              title="Nothing in the library"
              hint="Import a video or audio file from this device. Files stay in this browser profile."
            />
          ) : (
            <div className="cr-media__rows">
              {list.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="cr-media__row"
                  data-active={item.id === currentId}
                  onClick={() => setCurrentId(item.id)}
                  onDoubleClick={() => {
                    setCurrentId(item.id);
                    window.setTimeout(() => void mediaRef.current?.play(), 120);
                  }}
                >
                  <Icon name={item.kind === "video" ? "video" : "music"} size={15} />
                  <span className="cr-media__row-text">
                    <span>{item.title}</span>
                    <span className="cr-row__desc">
                      {item.mime} · {formatBytes(item.size)}
                    </span>
                  </span>
                  {item.id === currentId && <Badge tone="accent">Loaded</Badge>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Media;
