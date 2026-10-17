import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, EmptyState, IconButton, Segmented, TextInput } from "@/components/ui";
import { Icon } from "@/icons/Icon";
import { attachMedia, audioAvailable, detachMedia, resumeAudio } from "@/services/audio";
import { notify } from "@/services/os";
import { homeNodeId, resolvePath, useFsStore } from "@/state/fs";
import { usePlaybackStore } from "@/state/playback";
import type { AppProps, FileNode } from "@/types";
import { formatBytes, formatClockDuration } from "@/utils/format";

/* ==========================================================================
   Music

   A local player with no bundled content: the library is empty until the user
   adds their own files, and nothing is ever uploaded.

   Where the files go: the browser cannot keep a reference to a file the user
   picked across reloads, so added files are copied into this browser profile's
   own storage — they appear in ~/Music, survive reloads, and disappear when
   the profile's site data is cleared. The empty state and the footer say so
   rather than implying a permanent cloud library.
   ========================================================================== */

const AUDIO_MIME = /^audio\//;
const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i;
const MAX_FILE_BYTES = 80 * 1024 * 1024;

export function Music({ args }: AppProps) {
  const nodes = useFsStore((state) => state.nodes);
  const addBinary = useFsStore((state) => state.addBinary);
  const volume = usePlaybackStore((state) => state.volume);
  const setNowPlaying = usePlaybackStore((state) => state.setNowPlaying);
  const setPlaying = usePlaybackStore((state) => state.setPlaying);
  const setProgress = usePlaybackStore((state) => state.setProgress);

  const audioRef = useRef<HTMLAudioElement>(null);
  const [query, setQuery] = useState("");
  const [queue, setQueue] = useState<string[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlayingLocal] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [adding, setAdding] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const autoStarted = useRef(false);

  const library = useMemo(
    () =>
      nodes
        .filter(
          (node): node is FileNode & { dataUrl: string } =>
            node.kind === "file" &&
            !node.trashed &&
            Boolean(node.dataUrl) &&
            (AUDIO_MIME.test(node.mime ?? "") || AUDIO_EXTENSIONS.test(node.name)),
        )
        .map((node) => ({
          id: node.id,
          title: node.name.replace(/\.[^.]+$/, ""),
          mime: node.mime ?? "audio/*",
          size: node.size,
          modified: node.modified,
          dataUrl: node.dataUrl,
        }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [nodes],
  );

  const tracks = useMemo(
    () => library.filter((track) => track.title.toLowerCase().includes(query.toLowerCase())),
    [library, query],
  );

  const currentId = index >= 0 ? queue[index] : undefined;
  const current = currentId ? library.find((track) => track.id === currentId) : undefined;

  /* ---- playback ------------------------------------------------------- */

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) audio.pause();
    setPlayingLocal(false);
    setPlaying(false);
  }, [setPlaying]);

  const load = useCallback(
    (trackId: string | undefined) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (!trackId) {
        stopAudio();
        setNowPlaying(null);
        setPosition(0);
        setDuration(0);
        return;
      }
      const track = library.find((entry) => entry.id === trackId);
      if (!track) {
        setErrors([...errors, "That file is no longer in the library."]);
        return;
      }
      setNowPlaying({ id: track.id, title: track.title, artist: "Local file", appId: "music" });
      audio.src = track.dataUrl;
      attachMedia(audio);
      audio.currentTime = 0;
      setPosition(0);
      setDuration(0);
      void resumeAudio();
      audio
        .play()
        .then(() => {
          setPlayingLocal(true);
          setPlaying(true);
        })
        .catch(() => {
          setErrors((current) => [
            ...current,
            "Playback was blocked by the browser. Press play again to allow audio.",
          ]);
          setPlayingLocal(false);
          setPlaying(false);
        });
    },
    [errors, library, setNowPlaying, setPlaying, stopAudio],
  );

  const playFrom = useCallback(
    (trackId: string) => {
      const list = tracks.map((track) => track.id);
      const position = list.indexOf(trackId);
      setQueue(list.length > 0 ? list : [trackId]);
      setIndex(position >= 0 ? position : 0);
      load(trackId);
    },
    [load, tracks],
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      if (queue.length === 0) return;
      const next =
        shuffle && direction === 1
          ? Math.floor(Math.random() * queue.length)
          : index + direction;
      if (next < 0) return;
      if (next >= queue.length) {
        if (!repeat) {
          stopAudio();
          setIndex(-1);
          return;
        }
        setIndex(0);
        load(queue[0]);
        return;
      }
      setIndex(next);
      load(queue[next]);
    },
    [index, load, queue, repeat, shuffle, stopAudio],
  );

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!current) {
      const first = tracks[0];
      if (first) playFrom(first.id);
      return;
    }
    if (playing) {
      audio.pause();
      return;
    }
    void resumeAudio();
    void audio.play().catch(() => {
      setErrors((list) => [...list, "Playback was blocked. Press play again to allow audio."]);
    });
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setPosition(audio.currentTime);
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
      setProgress(audio.currentTime, Number.isFinite(audio.duration) ? audio.duration : undefined);
    };
    const onEnded = () => step(1);
    const onPause = () => {
      setPlayingLocal(false);
      setPlaying(false);
    };
    const onPlay = () => {
      setPlayingLocal(true);
      setPlaying(true);
    };
    const onError = () =>
      setErrors((list) => [
        ...list,
        "The browser could not decode that file. It may be a format this browser does not support.",
      ]);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("error", onError);
      detachMedia(audio);
    };
  }, [setPlaying, setProgress, step]);

  /* A track id in the launch arguments plays straight away. */
  const requested = typeof args?.trackId === "string" ? args.trackId : null;
  useEffect(() => {
    if (autoStarted.current || !requested) return;
    if (!library.some((track) => track.id === requested)) return;
    autoStarted.current = true;
    playFrom(requested);
  }, [library, playFrom, requested]);

  /* ---- adding files ---------------------------------------------------- */

  const addFiles = async (files: FileList) => {
    setAdding(true);
    setErrors([]);
    const parent = resolvePath(nodes, "/Home/Music") ?? homeNodeId(nodes);
    const rejected: string[] = [];
    let added = 0;

    for (const file of Array.from(files)) {
      const looksAudio = AUDIO_MIME.test(file.type) || AUDIO_EXTENSIONS.test(file.name);
      if (!looksAudio) {
        rejected.push(`${file.name}: not an audio file.`);
        continue;
      }
      if (file.size === 0) {
        rejected.push(`${file.name}: the file is empty.`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        rejected.push(`${file.name}: larger than the 80 MB import limit.`);
        continue;
      }
      const dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
      if (!dataUrl) {
        rejected.push(`${file.name}: this browser could not read it.`);
        continue;
      }
      addBinary(parent, file.name, file.type || "audio/mpeg", dataUrl);
      added += 1;
    }

    setAdding(false);
    setErrors(rejected);
    if (added > 0) {
      notify({
        title: `${added} track${added === 1 ? "" : "s"} added`,
        body: "Copied into this browser profile's ~/Music folder.",
        icon: "music",
      });
    }
  };

  /* ---- render ---------------------------------------------------------- */

  return (
    <div className="cr-music">
      <aside className="cr-music__rail">
        <div className="cr-music__rail-head">Library</div>
        <div className="cr-music__rail-item" data-static="true">
          <Icon name="music" size={15} />
          Tracks
          <span>{library.length}</span>
        </div>

        <label className="cr-btn cr-btn--primary cr-music__import">
          <Icon name="plus" size={15} />
          {adding ? "Adding…" : "Add Music"}
          <input
            type="file"
            accept="audio/mpeg,audio/mp3,audio/*,.mp3,.m4a,.wav,.ogg,.flac"
            multiple
            className="cr-visually-hidden"
            onChange={(event) => {
              if (event.target.files?.length) void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>

        <div className="cr-music__rail-note">
          Nothing is uploaded. Added files are copied into this browser profile and stay in{" "}
          <code className="cr-code">~/Music</code>, so they survive reloads but disappear if you clear
          this site's data.
        </div>

        <div className="cr-music__rail-note">
          {audioAvailable()
            ? "Volume is applied through the OS master gain."
            : "This browser exposes no Web Audio API, so the OS volume control does not apply."}
        </div>
      </aside>

      <div className="cr-music__main">
        <header className="cr-music__bar">
          <h2>Your tracks</h2>
          <div className="cr-music__search">
            <TextInput
              icon="search"
              value={query}
              aria-label="Search tracks"
              placeholder="Search"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Segmented
            label="Order"
            value={shuffle ? "shuffle" : "ordered"}
            onChange={(value) => setShuffle(value === "shuffle")}
            options={[
              { value: "ordered", label: "In order" },
              { value: "shuffle", label: "Shuffle" },
            ]}
          />
        </header>

        {errors.length > 0 && (
          <div className="cr-music__errors" role="status">
            {errors.map((message) => (
              <p key={message} className="cr-music__error">
                <Icon name="warning" size={13} /> {message}
              </p>
            ))}
            <button type="button" className="cr-music__dismiss" onClick={() => setErrors([])}>
              Dismiss
            </button>
          </div>
        )}

        <div className="cr-music__list">
          {tracks.length === 0 ? (
            library.length === 0 ? (
              <EmptyState
                icon="music"
                title="Your music library is empty"
                hint="Add MP3 files to start listening. They are copied into this browser profile only — nothing leaves your device."
              />
            ) : (
              <EmptyState icon="search" title="No tracks match" hint="Try a different search term." />
            )
          ) : (
            <>
              <div className="cr-music__list-head">
                <span>#</span>
                <span>Title</span>
                <span>Source</span>
                <span>Length</span>
                <span />
              </div>
              {tracks.map((track, trackIndex) => {
                const active = current?.id === track.id;
                return (
                  <div
                    key={track.id}
                    className="cr-music__row"
                    data-active={active}
                    onDoubleClick={() => playFrom(track.id)}
                  >
                    <span className="cr-music__row-index cr-num">
                      {active && playing ? <Icon name="volume" size={13} /> : trackIndex + 1}
                    </span>
                    <span className="cr-music__row-title">
                      <span>{track.title}</span>
                      <span className="cr-row__desc">{track.mime}</span>
                    </span>
                    <span className="cr-music__row-source">
                      <span className="cr-row__desc">{formatBytes(track.size)}</span>
                    </span>
                    <span className="cr-music__row-length cr-num">
                      {active && duration ? formatClockDuration(duration * 1000) : "—"}
                    </span>
                    <span className="cr-music__row-actions">
                      <IconButton
                        icon={active && playing ? "pause" : "play"}
                        label={active && playing ? "Pause" : `Play ${track.title}`}
                        size={14}
                        onClick={() => (active ? toggle() : playFrom(track.id))}
                      />
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <footer className="cr-music__player">
          <div className="cr-music__now">
            <div className="cr-music__now-art">
              <Icon name="music" size={18} />
            </div>
            <div className="cr-music__now-text">
              <span>{current ? current.title : "Nothing playing"}</span>
              <span className="cr-row__desc">
                {current
                  ? current.mime.startsWith("audio/") && !current.mime.startsWith("audio/x")
                    ? `${current.mime.replace("audio/", "").toUpperCase()} · local file`
                    : "Local file"
                  : "Add files to build your library"}
              </span>
            </div>
          </div>

          <div className="cr-music__transport">
            <IconButton icon="shuffle" label="Shuffle" active={shuffle} onClick={() => setShuffle((v) => !v)} />
            <IconButton icon="skip-back" label="Previous" onClick={() => step(-1)} />
            <IconButton
              icon={playing ? "pause" : "play"}
              label={playing ? "Pause" : "Play"}
              size={18}
              disabled={library.length === 0}
              onClick={toggle}
            />
            <IconButton icon="skip-forward" label="Next" onClick={() => step(1)} />
            <IconButton icon="repeat" label="Repeat" active={repeat} onClick={() => setRepeat((v) => !v)} />
          </div>

          <div className="cr-music__track">
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
                const audio = audioRef.current;
                if (!audio) return;
                audio.currentTime = Number(event.target.value);
                setPosition(Number(event.target.value));
              }}
            />
            <span className="cr-num">{duration ? formatClockDuration(duration * 1000) : "—"}</span>
            <span className="cr-music__volume">
              <Icon name="volume" size={14} />
              {Math.round(volume * 100)}%
            </span>
          </div>
        </footer>

        {library.length === 0 && (
          <div className="cr-music__limit-note">
            <Badge icon="info">Local only</Badge>
            <span className="cr-row__desc">
              Browsers cannot keep a handle to a file you picked across reloads, so CrystalOS copies the
              audio into its own storage instead of linking to your disk.
            </span>
          </div>
        )}
      </div>

      <audio ref={audioRef} preload="metadata" />
    </div>
  );
}

export default Music;
