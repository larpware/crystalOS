import type { WallpaperSource } from "@/types";

/* ==========================================================================
   Wallpaper Library

   Every remote asset below was verified to return a real image before being
   listed. Each entry also carries a CSS `fallback`, so a failed request
   degrades to a deliberate gradient instead of a blank desktop. Gradient
   wallpapers have no remote dependency at all.
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
