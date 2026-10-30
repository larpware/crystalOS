import { useMemo, type CSSProperties, type SVGProps } from "react";
import { icons, type IconName } from "./icons";
import { useAppearanceStore } from "@/state/appearance";
import { useAppsStore } from "@/state/apps";
import { appArtFor } from "./appIcons";

export type { IconName };

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

/** Renders a CrystalOS icon. Icons inherit `currentColor` and never fill. */
export function Icon({ name, size = 16, strokeWidth = 1.6, ...rest }: IconProps) {
  const glyph = icons[name] ?? icons.question;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {glyph}
    </svg>
  );
}

/** True for very small glyphs that need to be drawn on the pixel grid. */
export function isIconName(value: string): value is IconName {
  return value in icons;
}

/**
 * Stable hue per identifier so an app keeps the same tile colour everywhere
 * it appears. Hues are deliberately desaturated — the OS identity stays
 * neutral and the tiles only need to be tellable apart at a glance.
 */
export function appHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  }
  return hash;
}

export function appTileColors(seed: string): { bg: string; border: string; fg: string } {
  const hue = appHue(seed);
  return {
    bg: `hsl(${hue} 26% 19%)`,
    border: `hsl(${hue} 30% 28%)`,
    fg: `hsl(${hue} 60% 88%)`,
  };
}

/*
 * Curated accents for the applications that ship with the OS. Every tile shares
 * one material, one geometry and one inner highlight; only the tint changes,
 * which is what keeps a row of dock icons reading as one family while still
 * telling Spotify from Audiomack at a glance. Applications without an entry get
 * a stable hue from `appHue`, at the same saturation and lightness.
 */
const APP_ACCENTS: Record<string, string> = {
  browser: "#5b9cff",
  drive: "#4d8dff",
  spotify: "#3fd07a",
  audiomack: "#f0813f",
  music: "#a97ce0",
  messages: "#3fb8d8",
  terminal: "#7fd08a",
  settings: "#9aa4b2",
  store: "#d8a94a",
  games: "#8b7bff",
  library: "#7fb2e5",
  wallpaper: "#4fc8a8",
  trash: "#c2c8d0",
  notes: "#e2c14e",
  calculator: "#c2cad6",
  media: "#e0864f",
  updates: "#8fb7d8",
  discord: "#5865f2",
  qmovies: "#e0574f",
};

/** The tint an application's icon is drawn in, anywhere it appears. */
export function appAccent(appId: string): string {
  return APP_ACCENTS[appId] ?? `hsl(${appHue(appId)} 46% 64%)`;
}

interface AppIconProps {
  appId: string;
  name: IconName;
  size?: number;
  /** Removes the tile and renders a bare glyph. */
  plain?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** An application icon: designed artwork, or a drawn tile as the fallback. */
export function AppIcon({ appId, name, size = 34, plain, className, style }: AppIconProps) {
  // An imported icon pack overrides the bundled artwork per application id, and
  // applications without artwork fall back to the drawn tile, so an incomplete
  // pack can never leave a hole in the taskbar.
  const packId = useAppearanceStore((state) => state.iconPackId);
  const packs = useAppearanceStore((state) => state.customIconPacks);
  const override = useMemo(() => {
    if (appId.startsWith("community:") || appId.includes("-")) {
      const cleanId = appId.replace(/^community:/, "");
      const comm = useAppsStore.getState().getCommunityApp?.(cleanId);
      if (comm?.iconUrl) return comm.iconUrl;
    }
    if (packId !== "crescent") {
      const pack = packs.find((entry) => entry.id === packId);
      const url = pack?.mapping?.[appId];
      if (typeof url === "string" && url.length > 0) return url;
    }
    return appArtFor(appId);
  }, [appId, packId, packs]);

  if (plain) {
    return <Icon name={name} size={size} className={className} />;
  }
  const tint = appAccent(appId);
  const radius = Math.max(7, Math.round(size * 0.26));
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flex: "none",
        borderRadius: radius,
        // One material for every tile: a slightly raised surface with the app's
        // tint washing in from the top-left, plus the system's inner highlight.
        // Artwork is its own tile: it keeps its transparent surround instead of
        // being washed with a tint, so the drawing stays exactly as designed.
        background: override
          ? "transparent"
          : `radial-gradient(125% 125% at 26% -10%, color-mix(in srgb, ${tint} 26%, var(--icon-surface-strong)) 0%, var(--icon-surface) 68%)`,
        border: override ? "1px solid transparent" : `1px solid color-mix(in srgb, ${tint} 26%, var(--border-default))`,
        boxShadow: override
          ? "none"
          : "var(--inset-highlight), 0 1px 2px rgba(0,0,0,.24)",
        color: `color-mix(in srgb, ${tint} 84%, var(--text-primary))`,
        overflow: "hidden",
        ...style,
      }}
      aria-hidden="true"
      data-icon-source={override ? "art" : "crescent"}
    >
      {override ? (
        <img
          src={override}
          alt=""
          draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      ) : (
        <Icon name={name} size={Math.round(size * 0.5)} strokeWidth={1.7} />
      )}
    </span>
  );
}
