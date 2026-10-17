import { useEffect, useMemo, useRef, useState } from "react";
import { useAppearanceStore } from "@/state/appearance";
import { useSystemStore } from "@/state/system";
import { findBuiltInWallpaper } from "./library";
import { findCustomWallpaper, resolveWallpaperUrl } from "./custom";
import { liveScenes } from "./liveScenes";
import { prefersReducedMotion } from "@/services/system";
import type { LiveSceneId, WallpaperSource } from "@/types";

/* ==========================================================================
   Wallpaper rendering

   Three kinds, one component: gradients paint immediately, images fade in
   over their gradient fallback, and live scenes run on a capped canvas that
   falls back to a static frame when motion is reduced.
   ========================================================================== */

export interface ResolvedWallpaper {
  id: string;
  name: string;
  kind: WallpaperSource["kind"];
  category: WallpaperSource["category"];
  /** CSS background that is always available. */
  fallback: string;
  /** Resolved URL for a built-in asset or a custom import. */
  url?: string;
  scene?: LiveSceneId;
  isCustom: boolean;
  loading: boolean;
}

export function useResolvedWallpaper(id: string): ResolvedWallpaper {
  const [customUrl, setCustomUrl] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const record = useMemo(() => findCustomWallpaper(id), [id]);
  const builtIn = useMemo(() => findBuiltInWallpaper(id), [id]);

  useEffect(() => {
    let cancelled = false;
    if (!record) {
      setCustomUrl(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    resolveWallpaperUrl(record).then((url) => {
      if (cancelled) return;
      setCustomUrl(url ?? undefined);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [record]);

  if (record) {
    return {
      id: record.id,
      name: record.name,
      kind: record.kind,
      category: "custom",
      fallback: "linear-gradient(160deg, #14171c 0%, #0b0d10 100%)",
      url: customUrl,
      isCustom: true,
      loading,
    };
  }

  const source = builtIn ?? findBuiltInWallpaper("gradient-graphite")!;
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    category: source.category,
    fallback: source.fallback,
    url: source.url,
    scene: source.scene,
    isCustom: false,
    loading: false,
  };
}

interface LiveCanvasProps {
  scene: LiveSceneId;
  quality: "low" | "medium" | "high";
  fpsCap: number;
  interactive: boolean;
  frozen: boolean;
}

const qualityScale: Record<LiveCanvasProps["quality"], number> = {
  low: 0.55,
  medium: 0.75,
  high: 1,
};

export function LiveWallpaperCanvas({
  scene,
  quality,
  fpsCap,
  interactive,
  frozen,
}: LiveCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    let frame = 0;
    let disposed = false;
    let lastDraw = 0;
    const minInterval = 1000 / Math.max(1, fpsCap);
    const started = performance.now();

    const resize = () => {
      const scale = qualityScale[quality];
      const width = Math.max(320, Math.round(canvas.clientWidth * scale));
      const height = Math.max(200, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    const draw = (now: number) => {
      if (disposed) return;
      resize();

      if (!frozen && now - lastDraw < minInterval) {
        frame = requestAnimationFrame(draw);
        return;
      }
      lastDraw = now;

      const pointer = pointerRef.current;
      pointer.x += (pointer.targetX - pointer.x) * 0.04;
      pointer.y += (pointer.targetY - pointer.y) * 0.04;

      liveScenes[scene]({
        ctx: context,
        width: canvas.width,
        height: canvas.height,
        t: (now - started) / 1000,
        pointerX: pointer.x,
        pointerY: pointer.y,
      });

      // A frozen scene is drawn once; no further frames are scheduled.
      if (!frozen) frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, [scene, quality, fpsCap, frozen]);

  useEffect(() => {
    if (!interactive || frozen) return;
    const onMove = (event: PointerEvent) => {
      pointerRef.current.targetX = (event.clientX / window.innerWidth) * 2 - 1;
      pointerRef.current.targetY = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [interactive, frozen]);

  return <canvas ref={canvasRef} className="cr-wallpaper__canvas" aria-hidden="true" />;
}

interface WallpaperLayerProps {
  target: "desktop" | "lock";
  /** Draws a stronger scrim, used behind the lock screen. */
  dimmed?: boolean;
}

export function WallpaperLayer({ target, dimmed }: WallpaperLayerProps) {
  const wallpaper = useAppearanceStore((state) => state.wallpaper);
  const live = useAppearanceStore((state) => state.live);
  const performanceMode = useSystemStore((state) => state.performanceMode);
  const [imageReady, setImageReady] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const id = target === "lock" ? wallpaper.lockId : wallpaper.desktopId;
  const resolved = useResolvedWallpaper(id);

  useEffect(() => {
    setImageReady(false);
    setImageFailed(false);
  }, [resolved.url]);

  // Procedural live scenes only; imported videos are handled above.
  const liveActive =
    resolved.kind === "live" && !resolved.isCustom && live.enabled && !performanceMode;

  const frozen = prefersReducedMotion() || performanceMode;
  const objectFit = wallpaper.scale === "contain" ? "contain" : "cover";
  const isVideo = resolved.isCustom && resolved.kind === "live";

  return (
    <div
      className="cr-wallpaper"
      style={{ background: resolved.fallback }}
      data-target={target}
      aria-hidden="true"
    >
      {resolved.url && resolved.kind === "image" && !imageFailed && (
        <img
          className="cr-wallpaper__image"
          src={resolved.url}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() => setImageReady(true)}
          onError={() => setImageFailed(true)}
          style={{
            objectFit,
            opacity: imageReady ? 1 : 0,
            filter: wallpaper.blur > 0 ? `blur(${wallpaper.blur}px)` : undefined,
            transform: wallpaper.blur > 0 ? `scale(${1 + wallpaper.blur / 120})` : undefined,
          }}
        />
      )}

      {resolved.url && isVideo && (
        <video
          className="cr-wallpaper__image"
          src={resolved.url}
          autoPlay={live.enabled && !performanceMode}
          loop
          muted
          playsInline
          onLoadedData={() => setImageReady(true)}
          onError={() => setImageFailed(true)}
          style={{ objectFit, opacity: imageReady ? 1 : 0 }}
        />
      )}

      {liveActive && resolved.scene && !resolved.isCustom && (
        <LiveWallpaperCanvas
          scene={resolved.scene}
          quality={performanceMode ? "low" : live.quality}
          fpsCap={performanceMode ? 12 : live.fpsCap}
          interactive={live.interactive}
          frozen={frozen}
        />
      )}

      <div
        className="cr-wallpaper__dim"
        style={{
          opacity: dimmed
            ? Math.min(0.72, wallpaper.dim + 0.22)
            : wallpaper.dim,
        }}
      />
    </div>
  );
}

/** Small preview tile used by the Wallpaper Library and Settings. */
export function WallpaperPreview({
  id,
  className,
  radius = 8,
}: {
  id: string;
  className?: string;
  radius?: number;
}) {
  const resolved = useResolvedWallpaper(id);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const isVideo = resolved.isCustom && resolved.kind === "live";

  return (
    <div
      className={className}
      style={{ background: resolved.fallback, borderRadius: radius, overflow: "hidden" }}
    >
      {resolved.url && !isVideo && !failed && (
        <img
          src={resolved.url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setReady(true)}
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: ready ? 1 : 0,
            transition: "opacity var(--dur-normal) var(--ease-standard)",
          }}
        />
      )}
      {isVideo && !failed && (
        <video
          src={resolved.url}
          muted
          loop
          autoPlay
          playsInline
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
    </div>
  );
}
