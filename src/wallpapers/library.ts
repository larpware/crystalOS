import type { WallpaperSource } from "@/types";

/* ==========================================================================
   Wallpaper Library

   Every remote asset below was verified to return a real image before being
   listed, and each image was looked at before it was named — the name
   describes the picture that is actually there, not the picture the id was
   expected to be. Each entry also carries a CSS `fallback`, so a failed
   request degrades to a deliberate gradient instead of a blank desktop.
   Gradient and live wallpapers have no remote dependency at all, which is why
   the library always has something to offer with no connection.
   ========================================================================== */

/**
 * Builds a QHD+ source URL.
 *
 * 2560px looked soft on a 4K panel and on any hidpi display, where a full-width
 * wallpaper needs roughly `cssWidth * devicePixelRatio` real pixels. 3840 is the
 * largest size Unsplash serves without a paid tier, so that is the ceiling; the
 * renderer never needs to upscale below it, and `auto=format` still negotiates
 * WebP/AVIF so the extra pixels cost far less than they would as JPEG.
 */
function unsplash(id: string, width = 3840): string {
  return `https://images.unsplash.com/${id}?auto=format&w=${width}&q=85`;
}

/* ---- display-sized requests --------------------------------------------- *
 * The manifest asks for the largest size Unsplash serves, which is the right
 * answer for a 4K panel and the wrong one for everything else. A photograph is
 * decoded into a full bitmap before it is painted, so the 3840px entry is a
 * ~39MB decode held for the lifetime of the view that asked for it — and the
 * wallpaper grid asks for one per tile, at 200px each. This desktop is meant for
 * low-powered machines, where that is a lot of work for pixels nobody sees.
 *
 * So the display names the width it will paint and gets the smallest request
 * that covers it, rounded up to a cache-friendly step. The manifest URL is
 * still the ceiling: a request is never enlarged, and a URL that is not ours is
 * never rewritten at all.
 */

/** Below this a photograph starts to look soft on a hidpi panel. */
export const minDisplayWidth = 640;

/** Unsplash sizes are cached per width, so requests land on round numbers. */
export const displayWidthStep = 160;

/**
 * The same photograph at a width that covers `cssWidth` at `pixelRatio`.
 *
 * `zoom` is the wallpaper's framing zoom. A zoomed picture is painted larger
 * than the layer measures, so the request covers the zoom too — bucketed to
 * whole steps, so dragging the zoom slider asks for at most three sizes rather
 * than one per tick. A zoom of 1 or less never reduces the request below what
 * the layer itself paints.
 *
 * Returns `url` untouched when it is not an Unsplash photo, when it carries no
 * readable width, or when it is already small enough.
 */
export function wallpaperUrlForDisplay(
  url: string,
  cssWidth: number,
  pixelRatio = 1,
  zoom = 1,
): string {
  if (!url.includes("images.unsplash.com")) return url;
  const requested = unsplashWidth(url);
  if (requested === null) return url;

  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const css = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : minDisplayWidth;
  const zoomFactor = Math.max(1, Math.ceil(Number.isFinite(zoom) && zoom > 0 ? zoom : 1));
  const needed = Math.ceil((css * ratio * zoomFactor) / displayWidthStep) * displayWidthStep;
  const width = Math.min(requested, Math.max(minDisplayWidth, needed));
  if (width >= requested) return url;

  try {
    const parsed = new URL(url);
    parsed.searchParams.set("w", String(width));
    return parsed.toString();
  } catch {
    return url;
  }
}

function unsplashWidth(url: string): number | null {
  try {
    const value = Number(new URL(url).searchParams.get("w"));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Neutral gradient used when a photographic wallpaper cannot be fetched. */
const photoFallback =
  "linear-gradient(160deg, #10131a 0%, #0d1017 45%, #090b10 100%)";

export const builtInWallpapers: WallpaperSource[] = [
  {
    id: "ridge-dusk",
    name: "Ridge at Dusk",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1506905925346-21bda4d32df4"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "fog-line",
    name: "Fog Line",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1470071459604-3b5ec3a7fe05"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "canopy",
    name: "Canopy Light",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1441974231531-c6227db76b6e"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "stillwater",
    name: "Still Water",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1501785888041-af3ef285b470"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "shoreline",
    name: "Shoreline",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1507525428034-b723cf961d3e"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "cold-peak",
    name: "Cold Peak",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1519681393784-d120267933ba"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "night-sky",
    name: "Open Sky",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1419242902214-272b3f66ee7a"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "highland",
    name: "Highland",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1493246507139-91e8fad9978e"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "forest-road",
    name: "Forest Road",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1439066615861-d1af74d74000"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "valley-haze",
    name: "Valley Haze",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1475924156734-496f6cac6ec1"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "cascade",
    name: "Cascade",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1433086966358-54859d0ed716"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "deep-woods",
    name: "Deep Woods",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1447752875215-b2761acb3c5d"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "city-nights",
    name: "City Nights",
    kind: "image",
    category: "graphics",
    url: unsplash("photo-1444927714506-8492d94b4e3d"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "facade",
    name: "Facade",
    kind: "image",
    category: "graphics",
    url: unsplash("photo-1518005020951-eccb494ad742"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "field",
    name: "Orbit Field",
    kind: "image",
    category: "abstract",
    url: unsplash("photo-1451187580459-43490279c0fa"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "nebula",
    name: "Nebula",
    kind: "image",
    category: "abstract",
    url: unsplash("photo-1462331940025-496dfbfc7564"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "interference",
    name: "Interference",
    kind: "image",
    category: "abstract",
    url: unsplash("photo-1508739773434-c26b3d09e071"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "soft-field",
    name: "Soft Field",
    kind: "image",
    category: "abstract",
    url: unsplash("photo-1550859492-d5da9d8e45f3"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "desert-line",
    name: "Desert Line",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1500534314209-a25ddb2bd429"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  {
    id: "dawn-ridge",
    name: "Dawn Ridge",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1470252649378-9c29740c9fa8"),
    fallback: photoFallback,
    credit: "Unsplash",
  },
  /* ---- green set --------------------------------------------------------
     Added with the Ivy theme. Each URL was requested before being listed, so
     a slow or blocked request degrades to the gradient fallback above rather
     than to an empty desktop. */
  {
    id: "ivy-canopy",
    name: "Ivy Canopy",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1518495973542-4542c06a5843"),
    fallback:
      "radial-gradient(130% 110% at 30% 0%, #1d3a25 0%, #122218 48%, #08110b 100%)",
    credit: "Unsplash",
  },
  {
    id: "fern-floor",
    name: "Fern Floor",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1502082553048-f009c37129b9"),
    fallback: "linear-gradient(165deg, #14241a 0%, #0f1c14 48%, #080f0a 100%)",
    credit: "Unsplash",
  },
  {
    id: "mossy-trail",
    name: "Mossy Trail",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1511497584788-876760111969"),
    fallback: "linear-gradient(160deg, #16241b 0%, #101b13 50%, #080e09 100%)",
    credit: "Unsplash",
  },
  {
    id: "pine-mist",
    name: "Pine Mist",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1509316975850-ff9c5deb0cd9"),
    fallback: "linear-gradient(180deg, #16231c 0%, #101a14 55%, #0a0f0c 100%)",
    credit: "Unsplash",
  },
  {
    id: "rainforest",
    name: "Rainforest",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1533106418989-88406c7cc8ca"),
    fallback: "linear-gradient(170deg, #16261c 0%, #101c15 50%, #08100b 100%)",
    credit: "Unsplash",
  },
  {
    id: "boreal",
    name: "Boreal",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1523712999610-f77fbcfc3843"),
    fallback: "linear-gradient(155deg, #131f18 0%, #0e1811 48%, #070d09 100%)",
    credit: "Unsplash",
  },
  {
    id: "meadow",
    name: "Meadow",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1472214103451-9374bd1c798e"),
    fallback: "linear-gradient(180deg, #1a2a1c 0%, #14201a 50%, #0b120c 100%)",
    credit: "Unsplash",
  },
  {
    id: "green-highlands",
    name: "Green Highlands",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1501854140801-50d01698950b"),
    fallback: "linear-gradient(160deg, #182a1d 0%, #11201a 50%, #09100b 100%)",
    credit: "Unsplash",
  },
  {
    id: "lake-dawn",
    name: "Lake Dawn",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1470770841072-f978cf4d019e"),
    fallback: "linear-gradient(180deg, #14202a 0%, #101820 55%, #0a0e12 100%)",
    credit: "Unsplash",
  },
  {
    id: "glacier",
    name: "Glacier",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1509316785289-025f5b846b35"),
    fallback: "linear-gradient(175deg, #1a2830 0%, #131e26 50%, #0a0f13 100%)",
    credit: "Unsplash",
  },
  {
    id: "canyon-dusk",
    name: "Canyon Dusk",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1542273917363-3b1817f69a2d"),
    fallback: "linear-gradient(165deg, #241a14 0%, #1a1310 50%, #0c0908 100%)",
    credit: "Unsplash",
  },
  {
    id: "dunes",
    name: "Dunes",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1504384308090-c894fdcc538d"),
    fallback: "linear-gradient(170deg, #241f16 0%, #1a1610 50%, #0d0b08 100%)",
    credit: "Unsplash",
  },
  {
    id: "harbour-night",
    name: "Harbour Night",
    kind: "image",
    category: "graphics",
    url: unsplash("photo-1445264718234-a623be589d37"),
    fallback: "linear-gradient(155deg, #0f1620 0%, #0c1119 50%, #07090d 100%)",
    credit: "Unsplash",
  },
  {
    id: "aurora-field",
    name: "Aurora Field",
    kind: "image",
    category: "abstract",
    url: unsplash("photo-1465101162946-4377e57745c3"),
    fallback: "linear-gradient(180deg, #0c1622 0%, #0a1018 55%, #06080c 100%)",
    credit: "Unsplash",
  },
  {
    id: "glass-tower",
    name: "Glass Tower",
    kind: "image",
    category: "graphics",
    url: unsplash("photo-1483728642387-6c3bdd6c93e5"),
    fallback: "linear-gradient(150deg, #121720 0%, #0e1219 50%, #080a0e 100%)",
    credit: "Unsplash",
  },
  {
    id: "leaf-macro",
    name: "Leaf Macro",
    kind: "image",
    category: "abstract",
    url: unsplash("photo-1426604966848-d7adac402bff"),
    fallback: "linear-gradient(160deg, #17251a 0%, #111c15 50%, #080e0a 100%)",
    credit: "Unsplash",
  },
  {
    id: "studio-soft",
    name: "Studio Soft",
    kind: "image",
    category: "abstract",
    url: unsplash("photo-1490750967868-88aa4486c946"),
    fallback: "linear-gradient(180deg, #1a1c20 0%, #131519 55%, #0a0b0e 100%)",
    credit: "Unsplash",
  },
  {
    id: "ink-cloud",
    name: "Ink Cloud",
    kind: "image",
    category: "abstract",
    url: unsplash("photo-1441716844725-09cedc13a4e7"),
    fallback: "linear-gradient(170deg, #14161c 0%, #101218 50%, #08090c 100%)",
    credit: "Unsplash",
  },
  {
    id: "star-trail",
    name: "Star Trail",
    kind: "image",
    category: "abstract",
    url: unsplash("photo-1469474968028-56623f02e42e"),
    fallback: "linear-gradient(180deg, #0c1220 0%, #090e18 55%, #05070b 100%)",
    credit: "Unsplash",
  },

  /* ---- second photographic set ------------------------------------------
     Added to widen the library beyond the original green-and-blue run:
     wilderness, night sky, cities and quiet texture. Every URL was requested
     and every image was looked at before being named. The fallback on each
     entry is tuned to that picture's palette, so a failed fetch still reads
     as the wallpaper it replaced rather than as a generic dark rectangle. */

  {
    id: "valley-dusk",
    name: "Valley Dusk",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1506744038136-46273834b3fb"),
    fallback: "linear-gradient(175deg, #2b3140 0%, #1d2331 48%, #0d1016 100%)",
    credit: "Unsplash",
  },
  {
    id: "alpine-lake",
    name: "Alpine Lake",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1464822759023-fed622ff2c3b"),
    fallback: "linear-gradient(172deg, #1f2b39 0%, #172230 48%, #0a0e14 100%)",
    credit: "Unsplash",
  },
  {
    id: "sunlit-sea",
    name: "Sunlit Sea",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1439405326854-014607f694d7"),
    fallback: "linear-gradient(176deg, #2d3340 0%, #1f252f 50%, #0c0f14 100%)",
    credit: "Unsplash",
  },
  {
    id: "beach-break",
    name: "Beach Break",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1500375592092-40eb2168fd21"),
    fallback: "linear-gradient(176deg, #1c2a33 0%, #15222b 50%, #080d11 100%)",
    credit: "Unsplash",
  },
  {
    id: "emerald-edge",
    name: "Emerald Edge",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1497436072909-60f360e1d4b1"),
    fallback: "linear-gradient(165deg, #123028 0%, #0e2620 48%, #061210 100%)",
    credit: "Unsplash",
  },
  {
    id: "still-lake",
    name: "Still Lake",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1476514525535-07fb3b4ae5f1"),
    fallback: "linear-gradient(170deg, #1a2630 0%, #141e27 48%, #090d11 100%)",
    credit: "Unsplash",
  },
  {
    id: "boathouse",
    name: "Boathouse",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1470770903676-69b98201ea1c"),
    fallback: "linear-gradient(170deg, #1b2530 0%, #151d26 48%, #090d11 100%)",
    credit: "Unsplash",
  },
  {
    id: "hill-road",
    name: "Hill Road",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1518098268026-4e89f1a2cd8e"),
    fallback: "linear-gradient(180deg, #241d2b 0%, #1a1620 45%, #0b0a0e 100%)",
    credit: "Unsplash",
  },
  {
    id: "turquoise-surf",
    name: "Turquoise Surf",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1505144808419-1957a94ca61e"),
    fallback: "linear-gradient(170deg, #0f3140 0%, #0c2531 48%, #061016 100%)",
    credit: "Unsplash",
  },
  {
    id: "quiet-pier",
    name: "Quiet Pier",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1454372182658-c712e4c5a1db"),
    fallback: "linear-gradient(180deg, #1d2833 0%, #16202a 50%, #090d12 100%)",
    credit: "Unsplash",
  },
  {
    id: "golden-flare",
    name: "Golden Flare",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1494548162494-384bba4ab999"),
    fallback: "linear-gradient(180deg, #2a2318 0%, #1d1811 48%, #0b0906 100%)",
    credit: "Unsplash",
  },
  {
    id: "turquoise-lake",
    name: "Turquoise Lake",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1439853949127-fa647821eba0"),
    fallback: "linear-gradient(172deg, #143037 0%, #10262c 48%, #071316 100%)",
    credit: "Unsplash",
  },
  {
    id: "violet-shore",
    name: "Violet Shore",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1532274402911-5a369e4c4bb5"),
    fallback: "linear-gradient(180deg, #241a33 0%, #1a1226 45%, #0a0710 100%)",
    credit: "Unsplash",
  },
  {
    id: "midnight-fuji",
    name: "Midnight Fuji",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1436891620584-47fd0e565afb"),
    fallback: "linear-gradient(180deg, #101828 0%, #0c1220 50%, #06080e 100%)",
    credit: "Unsplash",
  },
  {
    id: "alpenglow",
    name: "Alpenglow",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1477346611705-65d1883cee1e"),
    fallback: "linear-gradient(165deg, #2a161a 0%, #1c1013 48%, #0b0608 100%)",
    credit: "Unsplash",
  },
  {
    id: "blue-ridges",
    name: "Blue Ridges",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1516117172878-fd2c41f4a759"),
    fallback: "linear-gradient(180deg, #1c2637 0%, #16202f 48%, #090d14 100%)",
    credit: "Unsplash",
  },
  {
    id: "elk-meadow",
    name: "Elk Meadow",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1472396961693-142e6e269027"),
    fallback: "linear-gradient(175deg, #1d2418 0%, #161c12 50%, #090c08 100%)",
    credit: "Unsplash",
  },
  {
    id: "white-sand",
    name: "White Sand",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1505118380757-91f5f5632de0"),
    fallback: "linear-gradient(170deg, #123039 0%, #0f252d 48%, #071216 100%)",
    credit: "Unsplash",
  },
  {
    id: "calm-sea",
    name: "Calm Sea",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1518837695005-2083093ee35b"),
    fallback: "linear-gradient(180deg, #1b2733 0%, #16202a 50%, #090d12 100%)",
    credit: "Unsplash",
  },
  {
    id: "palm-shore",
    name: "Palm Shore",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1519046904884-53103b34b206"),
    fallback: "linear-gradient(175deg, #12303a 0%, #0e2530 48%, #061116 100%)",
    credit: "Unsplash",
  },
  {
    id: "wadi-rum",
    name: "Wadi Rum",
    kind: "image",
    category: "landscape",
    url: unsplash("photo-1547234935-80c7145ec969"),
    fallback: "linear-gradient(170deg, #2b1c14 0%, #1e1410 48%, #0c0806 100%)",
    credit: "Unsplash",
  },

  /* ---- night sky ------------------------------------------------------- */

  {
    id: "orbital",
    name: "Orbital",
    kind: "image",
    category: "space",
    url: unsplash("photo-1446776811953-b23d57bd21aa"),
    fallback: "radial-gradient(120% 100% at 50% 100%, #12202e 0%, #0a1119 45%, #04060a 100%)",
    credit: "Unsplash",
  },
  {
    id: "milky-way",
    name: "Milky Way",
    kind: "image",
    category: "space",
    url: unsplash("photo-1444703686981-a3abbc4d4fe3"),
    fallback: "radial-gradient(130% 110% at 50% 60%, #1b1630 0%, #0e0b1b 45%, #04040a 100%)",
    credit: "Unsplash",
  },
  {
    id: "spacewalk",
    name: "Spacewalk",
    kind: "image",
    category: "space",
    url: unsplash("photo-1454789548928-9efd52dc4031"),
    fallback: "radial-gradient(120% 100% at 50% 100%, #0d1a28 0%, #070d14 50%, #02030a 100%)",
    credit: "Unsplash",
  },
  {
    id: "andromeda",
    name: "Andromeda",
    kind: "image",
    category: "space",
    url: unsplash("photo-1543722530-d2c3201371e7"),
    fallback: "radial-gradient(130% 110% at 50% 50%, #1a1a24 0%, #0d0d14 48%, #03030a 100%)",
    credit: "Unsplash",
  },
  {
    id: "cosmos",
    name: "Cosmos",
    kind: "image",
    category: "space",
    url: unsplash("photo-1502134249126-9f3755a50d78"),
    fallback: "radial-gradient(125% 110% at 40% 60%, #16203a 0%, #0d1224 45%, #04050c 100%)",
    credit: "Unsplash",
  },
  {
    id: "orion",
    name: "Orion",
    kind: "image",
    category: "space",
    url: unsplash("photo-1516339901601-2e1b62dc0c45"),
    fallback: "radial-gradient(130% 110% at 50% 55%, #221226 0%, #120a16 45%, #05030a 100%)",
    credit: "Unsplash",
  },

  /* ---- city ------------------------------------------------------------ */

  {
    id: "skyline",
    name: "Skyline",
    kind: "image",
    category: "city",
    url: unsplash("photo-1477959858617-67f85cf4f1df"),
    fallback: "linear-gradient(175deg, #1e2a38 0%, #16202b 50%, #090d13 100%)",
    credit: "Unsplash",
  },
  {
    id: "avenue",
    name: "Avenue",
    kind: "image",
    category: "city",
    url: unsplash("photo-1480714378408-67cf0d13bc1b"),
    fallback: "linear-gradient(178deg, #2a2620 0%, #1c1a16 50%, #0b0a08 100%)",
    credit: "Unsplash",
  },
  {
    id: "upward",
    name: "Upward",
    kind: "image",
    category: "city",
    url: unsplash("photo-1486406146926-c627a92ad1ab"),
    fallback: "linear-gradient(180deg, #1c232e 0%, #151b24 50%, #080a0e 100%)",
    credit: "Unsplash",
  },
  {
    id: "fifth-avenue",
    name: "Fifth Avenue",
    kind: "image",
    category: "city",
    url: unsplash("photo-1449824913935-59a10b8d2000"),
    fallback: "linear-gradient(178deg, #23262c 0%, #1a1d22 50%, #0a0b0e 100%)",
    credit: "Unsplash",
  },
  {
    id: "rain-city",
    name: "Rain City",
    kind: "image",
    category: "city",
    url: unsplash("photo-1519501025264-65ba15a82390"),
    fallback: "linear-gradient(178deg, #17202e 0%, #111826 50%, #070910 100%)",
    credit: "Unsplash",
  },
  {
    id: "city-lights",
    name: "City Lights",
    kind: "image",
    category: "city",
    url: unsplash("photo-1444723121867-7a241cacace9"),
    fallback: "radial-gradient(130% 100% at 50% 100%, #1b2130 0%, #101520 50%, #05070b 100%)",
    credit: "Unsplash",
  },
  {
    id: "golden-gate",
    name: "Golden Gate",
    kind: "image",
    category: "city",
    url: unsplash("photo-1449034446853-66c86144b0ad"),
    fallback: "linear-gradient(178deg, #26303a 0%, #1a222b 48%, #0a0d12 100%)",
    credit: "Unsplash",
  },
  {
    id: "manhattan-moon",
    name: "Manhattan Moon",
    kind: "image",
    category: "city",
    url: unsplash("photo-1514565131-fce0801e5785"),
    fallback: "linear-gradient(178deg, #1d2438 0%, #151a2a 50%, #080a12 100%)",
    credit: "Unsplash",
  },

  /* ---- texture --------------------------------------------------------- */

  {
    id: "single-leaf",
    name: "Single Leaf",
    kind: "image",
    category: "abstract",
    url: unsplash("photo-1504198266287-1659872e6590"),
    fallback: "linear-gradient(165deg, #16211a 0%, #101812 48%, #070a08 100%)",
    credit: "Unsplash",
  },
  {
    id: "backlit-leaves",
    name: "Backlit Leaves",
    kind: "image",
    category: "abstract",
    url: unsplash("photo-1520121401995-928cd50d4e27"),
    fallback: "linear-gradient(165deg, #1a2a16 0%, #131f11 48%, #070c06 100%)",
    credit: "Unsplash",
  },
  {
    id: "ink-grain",
    name: "Ink Grain",
    kind: "image",
    category: "abstract",
    url: unsplash("photo-1550684376-efcbd6e3f031"),
    fallback: "radial-gradient(130% 110% at 50% 30%, #15161a 0%, #0d0e11 50%, #040405 100%)",
    credit: "Unsplash",
  },
  {
    id: "marbled",
    name: "Marbled",
    kind: "image",
    category: "abstract",
    url: unsplash("photo-1553356084-58ef4a67b2a7"),
    fallback: "linear-gradient(150deg, #1a1a34 0%, #171333 45%, #0a0a16 100%)",
    credit: "Unsplash",
  },
  {
    id: "bokeh",
    name: "Bokeh",
    kind: "image",
    category: "abstract",
    url: unsplash("photo-1523821741446-edb2b68bb7a0"),
    fallback: "radial-gradient(120% 110% at 30% 40%, #141a2c 0%, #0d1220 48%, #05070d 100%)",
    credit: "Unsplash",
  },
];

/* --------------------------------------------------------------------------
   Gradient wallpapers — no network dependency, always available.
   -------------------------------------------------------------------------- */

export const gradientWallpapers: WallpaperSource[] = [
  {
    id: "gradient-graphite",
    name: "Graphite",
    kind: "gradient",
    category: "graphics",
    fallback:
      "radial-gradient(120% 100% at 20% 0%, #23262b 0%, #14161a 45%, #0b0c0e 100%)",
  },
  {
    id: "gradient-tide",
    name: "Tide",
    kind: "gradient",
    category: "graphics",
    fallback:
      "linear-gradient(150deg, #0d1b26 0%, #10222e 40%, #0a1116 100%)",
  },
  {
    id: "gradient-ember",
    name: "Ember",
    kind: "gradient",
    category: "graphics",
    fallback:
      "radial-gradient(110% 90% at 80% 10%, #2a1b16 0%, #191110 45%, #0b0808 100%)",
  },
  {
    id: "gradient-moss",
    name: "Moss",
    kind: "gradient",
    category: "graphics",
    fallback:
      "linear-gradient(165deg, #131b16 0%, #101711 45%, #090c0a 100%)",
  },
  {
    id: "gradient-violet",
    name: "Violet Hour",
    kind: "gradient",
    category: "graphics",
    fallback:
      "radial-gradient(120% 110% at 15% 100%, #1d1730 0%, #141122 45%, #0a0810 100%)",
  },
  {
    id: "gradient-crescent",
    name: "CrystalOS",
    kind: "gradient",
    category: "graphics",
    fallback:
      "linear-gradient(200deg, #0f141c 0%, #131a26 35%, #0a0d13 100%)",
  },
  {
    id: "gradient-ivy",
    name: "Ivy",
    kind: "gradient",
    category: "graphics",
    fallback:
      "radial-gradient(120% 110% at 25% 0%, #1c3624 0%, #122116 45%, #08120b 100%)",
  },
  {
    id: "gradient-fern",
    name: "Fern",
    kind: "gradient",
    category: "graphics",
    fallback:
      "linear-gradient(160deg, #17301f 0%, #12251a 45%, #08120d 100%)",
  },
  {
    id: "gradient-forest-night",
    name: "Forest Night",
    kind: "gradient",
    category: "graphics",
    fallback:
      "linear-gradient(180deg, #0a1810 0%, #081209 55%, #050b06 100%)",
  },
  {
    id: "gradient-contrast",
    name: "Ink",
    kind: "gradient",
    category: "graphics",
    fallback: "radial-gradient(120% 100% at 50% 0%, #141414 0%, #0a0a0a 50%, #000000 100%)",
  },
  {
    id: "gradient-steel",
    name: "Steel",
    kind: "gradient",
    category: "graphics",
    fallback: "linear-gradient(150deg, #1b1f26 0%, #141820 45%, #0a0d12 100%)",
  },
  {
    id: "gradient-sand",
    name: "Dune Sand",
    kind: "gradient",
    category: "graphics",
    fallback: "radial-gradient(120% 110% at 80% 0%, #2a2116 0%, #1c1710 45%, #0c0a07 100%)",
  },
  {
    id: "gradient-plum",
    name: "Plum",
    kind: "gradient",
    category: "graphics",
    fallback: "linear-gradient(160deg, #1e1428 0%, #170f1f 45%, #0a070d 100%)",
  },
  {
    id: "gradient-rosewood",
    name: "Rosewood",
    kind: "gradient",
    category: "graphics",
    fallback: "linear-gradient(160deg, #26161c 0%, #1c1116 45%, #0c0709 100%)",
  },
  {
    id: "gradient-citrus",
    name: "Citrus",
    kind: "gradient",
    category: "graphics",
    fallback: "radial-gradient(120% 110% at 20% 100%, #2b2411 0%, #1d190d 45%, #0c0a06 100%)",
  },
  {
    id: "gradient-obsidian",
    name: "Obsidian",
    kind: "gradient",
    category: "graphics",
    fallback: "radial-gradient(130% 110% at 30% 0%, #16171b 0%, #0e0f12 48%, #050506 100%)",
  },
  {
    id: "gradient-slate",
    name: "Slate",
    kind: "gradient",
    category: "graphics",
    fallback: "linear-gradient(155deg, #1a1e26 0%, #141820 48%, #090b10 100%)",
  },
  {
    id: "gradient-copper",
    name: "Copper",
    kind: "gradient",
    category: "graphics",
    fallback: "radial-gradient(125% 110% at 75% 15%, #2a1c12 0%, #1b1210 45%, #0a0706 100%)",
  },
  {
    id: "gradient-lagoon",
    name: "Lagoon",
    kind: "gradient",
    category: "graphics",
    fallback: "linear-gradient(160deg, #0b2229 0%, #0d1c24 45%, #060f13 100%)",
  },
  {
    id: "gradient-aubergine",
    name: "Aubergine",
    kind: "gradient",
    category: "graphics",
    fallback: "radial-gradient(125% 110% at 20% 100%, #221427 0%, #180e1c 45%, #0a070c 100%)",
  },
  {
    id: "gradient-cinder",
    name: "Cinder",
    kind: "gradient",
    category: "graphics",
    fallback: "linear-gradient(170deg, #1c1a1a 0%, #141313 48%, #080708 100%)",
  },
  {
    id: "gradient-harbour",
    name: "Harbour",
    kind: "gradient",
    category: "graphics",
    fallback: "linear-gradient(165deg, #101c2a 0%, #0d1824 48%, #070d14 100%)",
  },
];

/* --------------------------------------------------------------------------
   Live wallpapers — rendered on canvas, no assets required.
   -------------------------------------------------------------------------- */

export const liveWallpapers: WallpaperSource[] = [
  {
    id: "live-aurora",
    name: "Aurora Drift",
    kind: "live",
    category: "abstract",
    scene: "aurora",
    fallback: "linear-gradient(180deg, #0b1220 0%, #0a0f18 60%, #070a0e 100%)",
  },
  {
    id: "live-drift",
    name: "Slow Drift",
    kind: "live",
    category: "abstract",
    scene: "drift",
    fallback: "linear-gradient(180deg, #12161d 0%, #0e1117 60%, #090b0f 100%)",
  },
  {
    id: "live-mesh",
    name: "Lattice",
    kind: "live",
    category: "graphics",
    scene: "mesh",
    fallback: "linear-gradient(180deg, #0d1219 0%, #0b0f14 60%, #080a0d 100%)",
  },
  {
    id: "live-starfield",
    name: "Deep Field",
    kind: "live",
    category: "abstract",
    scene: "starfield",
    fallback: "linear-gradient(180deg, #080a10 0%, #06080c 100%)",
  },
  {
    id: "live-waves",
    name: "Ridgeline",
    kind: "live",
    category: "graphics",
    scene: "waves",
    fallback: "linear-gradient(180deg, #0a1018 0%, #090d13 60%, #07090c 100%)",
  },
  {
    id: "live-rainfall",
    name: "Rainfall",
    kind: "live",
    category: "abstract",
    scene: "rainfall",
    fallback: "linear-gradient(180deg, #0a0e14 0%, #080b10 60%, #07090c 100%)",
  },
  {
    id: "live-ember",
    name: "Embers",
    kind: "live",
    category: "abstract",
    scene: "ember",
    fallback: "linear-gradient(180deg, #150d0a 0%, #100a09 60%, #08060a 100%)",
  },
  {
    id: "live-snowfall",
    name: "Snowfall",
    kind: "live",
    category: "abstract",
    scene: "snowfall",
    fallback: "linear-gradient(180deg, #0d1119 0%, #0a0d13 60%, #07090c 100%)",
  },
  {
    id: "live-dunes",
    name: "Dunes Drift",
    kind: "live",
    category: "graphics",
    scene: "dunes",
    fallback: "linear-gradient(180deg, #1a140e 0%, #120e0a 60%, #080605 100%)",
  },
];

export const builtInWallpaperIds = new Set([
  ...builtInWallpapers.map((wallpaper) => wallpaper.id),
  ...gradientWallpapers.map((wallpaper) => wallpaper.id),
  ...liveWallpapers.map((wallpaper) => wallpaper.id),
]);

export function findBuiltInWallpaper(id: string): WallpaperSource | undefined {
  return [...builtInWallpapers, ...gradientWallpapers, ...liveWallpapers].find(
    (wallpaper) => wallpaper.id === id,
  );
}
