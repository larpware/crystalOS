import type { ThemePreset, ThemeTokens } from "@/types";

/* ==========================================================================
   Built-in themes

   Every theme is a complete material system: surfaces, chrome materials, icon
   treatment, lighting and elevation. Two themes never differ only by accent —
   Graphite is matte and neutral, Midnight is deep with softer light, Arctic is
   cool and crisp, Ember is warm and subdued.
   ========================================================================== */

const darkBase: ThemeTokens = {
  bgRoot: "#08090b",
  bgDesktop: "#0b0d10",
  surface0: "#101216",
  surface1: "#14171c",
  surface2: "#191c22",
  surface3: "#20242b",
  surfaceHover: "#252a32",
  surfaceActive: "#2b3039",
  surfaceSunken: "#0c0e11",
  panelMaterial: "#0e1014",
  dockMaterial: "#15181d",
  windowMaterial: "#101216",
  modalMaterial: "#161a1f",
  textPrimary: "#f4f5f7",
  textSecondary: "#c4c8cf",
  textTertiary: "#8e949e",
  textMuted: "#656b75",
  borderSubtle: "rgba(255,255,255,.055)",
  borderDefault: "rgba(255,255,255,.085)",
  borderStrong: "rgba(255,255,255,.13)",
  innerHighlight: "rgba(255,255,255,.055)",
  edgeLight: "rgba(255,255,255,.14)",
  iconSurface: "#1b1f26",
  iconSurfaceStrong: "#23282f",
  shadowSoft: "0 1px 2px rgba(0,0,0,.3), 0 2px 6px rgba(0,0,0,.22)",
  shadowPopover: "0 18px 40px -12px rgba(0,0,0,.58), 0 4px 12px rgba(0,0,0,.38)",
  shadowWindow: "0 28px 60px -18px rgba(0,0,0,.62), 0 5px 14px rgba(0,0,0,.38)",
  accent: "#0a84ff",
  accentHover: "#3d9bff",
  accentMuted: "rgba(10,132,255,.22)",
  accentOnMuted: "#a8c9ff",
};

export const themePresets: ThemePreset[] = [
  {
    id: "cinema",
    name: "Cinema",
    appearance: "dark",
    recommended: true,
    description:
      "Warm charcoal surfaces, cream text and a single moss-green accent — film-long shadows, no glass, one colour doing the talking.",
    tokens: {
      bgRoot: "#131110",
      bgDesktop: "#171412",
      surface0: "#1b1816",
      surface1: "#201c19",
      surface2: "#272220",
      surface3: "#2f2a26",
      surfaceHover: "#352f2a",
      surfaceActive: "#3c352f",
      surfaceSunken: "#161311",
      panelMaterial: "#181413",
      dockMaterial: "#211c18",
      windowMaterial: "#1b1816",
      modalMaterial: "#241f1c",
      textPrimary: "#f3ede4",
      textSecondary: "#cfc4b6",
      textTertiary: "#9a8e80",
      textMuted: "#6e6558",
      /* Warm cream hairlines: the lighting stays inside the same colour family
         as the surfaces it separates — never a cool grey on warm brown. */
      borderSubtle: "rgba(255,232,200,.06)",
      borderDefault: "rgba(255,232,200,.10)",
      borderStrong: "rgba(255,232,200,.15)",
      innerHighlight: "rgba(255,232,200,.055)",
      edgeLight: "rgba(255,232,200,.15)",
      iconSurface: "#27211c",
      iconSurfaceStrong: "#302923",
      /* Long, warm, ambient throw: shadows sit low and brown-black, like a
         lamp in a room, not a drop shadow under a widget. */
      shadowSoft: "0 1px 2px rgba(15,8,3,.34), 0 3px 8px rgba(15,8,3,.26)",
      shadowPopover: "0 20px 44px -14px rgba(15,8,3,.6), 0 4px 12px rgba(15,8,3,.4)",
      shadowWindow: "0 30px 64px -20px rgba(15,8,3,.62), 0 6px 16px rgba(15,8,3,.4)",
      /* The one saturated thing on screen: moss green, plus an ochre partner
         available from the accent picker. */
      accent: "#43915c",
      accentHover: "#56a86e",
      accentMuted: "rgba(67,145,92,.24)",
      accentOnMuted: "#a2d9b4",
      wallpaperDefault: "gradient-ember",
    },
  },
  {
    id: "cinema-light",
    name: "Cinema Light",
    appearance: "light",
    recommended: true,
    description:
      "Warm paper surfaces, brown ink and the same moss accent — the daylight counterpart of Cinema.",
    tokens: {
      bgRoot: "#efe9df",
      bgDesktop: "#e7e1d5",
      surface0: "#faf6ef",
      surface1: "#f4efe6",
      surface2: "#ece6da",
      surface3: "#e2dbcd",
      surfaceHover: "#e8e1d4",
      surfaceActive: "#ddd5c6",
      surfaceSunken: "#f5f1e8",
      panelMaterial: "#f6f1e8",
      dockMaterial: "#faf6ef",
      windowMaterial: "#faf6ef",
      modalMaterial: "#faf6ef",
      textPrimary: "#211b12",
      textSecondary: "#4e463a",
      textTertiary: "#7c7260",
      textMuted: "#a49a87",
      borderSubtle: "rgba(60,45,25,.08)",
      borderDefault: "rgba(60,45,25,.13)",
      borderStrong: "rgba(60,45,25,.2)",
      innerHighlight: "rgba(255,255,255,.85)",
      edgeLight: "rgba(255,255,255,.9)",
      iconSurface: "#ffffff",
      iconSurfaceStrong: "#f0eadd",
      shadowSoft: "0 1px 2px rgba(48,34,16,.06), 0 2px 6px rgba(48,34,16,.08)",
      shadowPopover: "0 16px 34px -12px rgba(48,34,16,.2), 0 3px 10px rgba(48,34,16,.11)",
      shadowWindow: "0 24px 50px -18px rgba(48,34,16,.24), 0 4px 12px rgba(48,34,16,.11)",
      accent: "#3e8a58",
      accentHover: "#33774b",
      accentMuted: "rgba(62,138,88,.16)",
      accentOnMuted: "#2d6a42",
      wallpaperDefault: "dawn-ridge",
    },
  },
  /* --------------------------------------------------------------------------
     Solar family — the technical readout persona: a different type system
     (IBM Plex Sans / Space Grotesk / Plex Mono), hard corners, hairline rules.
     Solarized Dark is the base03 board (base02 chrome, bright glassy text and
     the cyan accent); Dim is the scheme's black variant (near-black chrome on
     the muted base0 / base1 text ladder); Solarized Light is the base3 paper
     counterpart.
     -------------------------------------------------------------------------- */
  {
    id: "deep-sea",
    name: "Solarized Dark",
    appearance: "dark",
    recommended: true,
    description:
      "The base03 board in deep teal: lacquered surfaces, glassy bright text and the cyan accent, with hard corners and hairline rules.",
    defaultFonts: { ui: "plex", mono: "plexmono", display: "space-grotesk" },
    tokens: {
      bgRoot: "#002b36",
      bgDesktop: "#00222b",
      surface0: "#073642",
      surface1: "#0b3f4c",
      surface2: "#104a57",
      surface3: "#16525f",
      surfaceHover: "#1b5a67",
      surfaceActive: "#216172",
      surfaceSunken: "#012530",
      panelMaterial: "#043441",
      dockMaterial: "#093c49",
      windowMaterial: "#073642",
      modalMaterial: "#0c4350",
      textPrimary: "#dbe4e1",
      textSecondary: "#a7bdbd",
      textTertiary: "#8ba4a8",
      textMuted: "#6f8689",
      borderSubtle: "rgba(147,161,161,.14)",
      borderDefault: "rgba(147,161,161,.2)",
      borderStrong: "rgba(147,161,161,.3)",
      innerHighlight: "rgba(147,161,161,.08)",
      edgeLight: "rgba(147,161,161,.17)",
      iconSurface: "#0e4552",
      iconSurfaceStrong: "#14505e",
      shadowSoft: "0 1px 2px rgba(0,8,10,.4), 0 3px 8px rgba(0,8,10,.3)",
      shadowPopover: "0 20px 44px -14px rgba(0,8,10,.62), 0 4px 12px rgba(0,8,10,.42)",
      shadowWindow: "0 30px 64px -20px rgba(0,8,10,.64), 0 6px 16px rgba(0,8,10,.42)",
      accent: "#2aa198",
      accentHover: "#43bdb3",
      accentMuted: "rgba(42,161,152,.22)",
      accentOnMuted: "#8fd9d2",
      wallpaperDefault: "gradient-tide",
    },
  },
  {
    id: "dim",
    name: "Dim",
    appearance: "dark",
    recommended: true,
    description:
      "Solarized's black variant: near-black surfaces, canonical base0/base1 text and all eight accent hues in their assigned roles, blue primary. The dimmed read of Schoonover's dark scheme.",
    defaultFonts: { ui: "plex", mono: "plexmono", display: "space-grotesk" },
    tokens: {
      bgRoot: "#06090a",
      bgDesktop: "#040708",
      surface0: "#0d1416",
      surface1: "#101a1d",
      surface2: "#121f22",
      surface3: "#152428",
      surfaceHover: "#121f22",
      surfaceActive: "#152428",
      surfaceSunken: "#030607",
      panelMaterial: "#0a1012",
      dockMaterial: "#070c0e",
      windowMaterial: "#0d1416",
      modalMaterial: "#111a1c",
      /* Canonical Solarized reading hierarchy on black: base0 rides ordinary
         text, base1 carries emphasis — on the black surfaces both clear 8:1,
         so the muted aesthetic never costs legibility. */
      textPrimary: "#93a1a1",
      textSecondary: "#839496",
      textTertiary: "#657b83",
      textMuted: "#586e75",
      borderSubtle: "rgba(147,161,161,.12)",
      borderDefault: "rgba(147,161,161,.18)",
      borderStrong: "rgba(147,161,161,.26)",
      innerHighlight: "rgba(147,161,161,.07)",
      edgeLight: "rgba(147,161,161,.15)",
      iconSurface: "#111b1e",
      iconSurfaceStrong: "#162125",
      shadowSoft: "0 1px 2px rgba(0,0,0,.6), 0 3px 8px rgba(0,0,0,.4)",
      shadowPopover: "0 20px 44px -14px rgba(0,0,0,.8), 0 4px 12px rgba(0,0,0,.55)",
      shadowWindow: "0 32px 72px -20px rgba(0,0,0,.85), 0 6px 16px rgba(0,0,0,.55)",
      accent: "#268bd2",
      accentHover: "#3fa7e5",
      accentMuted: "rgba(38,139,210,.25)",
      accentOnMuted: "#8cc6ef",
      wallpaperDefault: "gradient-tide",
    },
  },
  {
    id: "solar-light",
    name: "Solarized Light",
    appearance: "light",
    recommended: true,
    description:
      "Solarized base3 paper: warm cream surfaces, teal ink, the cyan-and-ochre set, hard corners and hairline rules.",
    defaultFonts: { ui: "plex", mono: "plexmono", display: "space-grotesk" },
    tokens: {
      bgRoot: "#fdf6e3",
      bgDesktop: "#f2ecd9",
      surface0: "#faf5e6",
      surface1: "#f3edda",
      surface2: "#eae3cb",
      surface3: "#e0d8bd",
      surfaceHover: "#e7e0c8",
      surfaceActive: "#ddd5ba",
      surfaceSunken: "#f6f0e0",
      panelMaterial: "#f6f1e1",
      dockMaterial: "#faf5e6",
      windowMaterial: "#faf5e6",
      modalMaterial: "#f7f2e4",
      textPrimary: "#073642",
      textSecondary: "#455c62",
      textTertiary: "#5b7079",
      textMuted: "#7e9297",
      borderSubtle: "rgba(88,110,117,.16)",
      borderDefault: "rgba(88,110,117,.24)",
      borderStrong: "rgba(88,110,117,.34)",
      innerHighlight: "rgba(255,255,255,.85)",
      edgeLight: "rgba(255,255,255,.92)",
      iconSurface: "#ffffff",
      iconSurfaceStrong: "#efe9d6",
      shadowSoft: "0 1px 2px rgba(38,50,54,.08), 0 2px 6px rgba(38,50,54,.09)",
      shadowPopover: "0 16px 34px -12px rgba(38,50,54,.24), 0 3px 10px rgba(38,50,54,.13)",
      shadowWindow: "0 26px 52px -18px rgba(38,50,54,.3), 0 5px 14px rgba(38,50,54,.15)",
      accent: "#268bd2",
      accentHover: "#1f76b3",
      accentMuted: "rgba(38,139,210,.16)",
      accentOnMuted: "#1d6fa9",
      wallpaperDefault: "dawn-ridge",
    },
  },
  {
    id: "crescent-dark",
    name: "CrystalOS Dark",
    appearance: "dark",
    description: "The OS-native look: near-black navy-tinted surfaces, one depth step of desk behind the windows, and the electric blue accent at rest.",
    tokens: {
      ...darkBase,
      bgRoot: "#08090b",
      bgDesktop: "#07080a",
      windowMaterial: "#111318",
      panelMaterial: "#0d0f13",
      dockMaterial: "#14171c",
      modalMaterial: "#161a1f",
      wallpaperDefault: "ridge-dusk",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    appearance: "dark",
    description: "Deep blue-black chrome with softer light and a heavier, pooling shadow.",
    tokens: {
      ...darkBase,
      bgRoot: "#05070c",
      bgDesktop: "#070a11",
      surface0: "#0b0f17",
      surface1: "#0f141d",
      surface2: "#141a25",
      surface3: "#1b222e",
      surfaceHover: "#202836",
      surfaceActive: "#26303f",
      surfaceSunken: "#080b12",
      panelMaterial: "#070a11",
      dockMaterial: "#0c111a",
      windowMaterial: "#0a0e15",
      modalMaterial: "#10151f",
      textPrimary: "#eef2f8",
      textSecondary: "#bcc6d4",
      textTertiary: "#8794a5",
      textMuted: "#5e6a7a",
      borderSubtle: "rgba(150,180,255,.07)",
      borderDefault: "rgba(150,180,255,.11)",
      borderStrong: "rgba(150,180,255,.17)",
      innerHighlight: "rgba(150,180,255,.075)",
      edgeLight: "rgba(160,190,255,.18)",
      iconSurface: "#151d2b",
      iconSurfaceStrong: "#1d2637",
      shadowSoft: "0 1px 2px rgba(0,0,0,.36), 0 2px 8px rgba(2,4,10,.3)",
      shadowPopover: "0 20px 46px -12px rgba(0,0,0,.66), 0 6px 16px rgba(2,4,10,.5)",
      shadowWindow: "0 34px 74px -20px rgba(0,0,0,.7), 0 8px 20px rgba(2,4,10,.5)",
      accent: "#5e5ce6",
      accentHover: "#7b79f0",
      accentMuted: "rgba(94,92,230,.22)",
      accentOnMuted: "#b9b8f5",
      wallpaperDefault: "night-sky",
    },
  },
  {
    id: "graphite",
    name: "Graphite",
    appearance: "dark",
    description: "Neutral charcoal, matte elevation and sharp metallic separation.",
    tokens: {
      ...darkBase,
      bgRoot: "#0a0a0a",
      bgDesktop: "#0d0d0d",
      surface0: "#131313",
      surface1: "#171717",
      surface2: "#1d1d1d",
      surface3: "#242424",
      surfaceHover: "#2a2a2a",
      surfaceActive: "#313131",
      surfaceSunken: "#0e0e0e",
      panelMaterial: "#111111",
      dockMaterial: "#181818",
      windowMaterial: "#121212",
      modalMaterial: "#1a1a1a",
      textPrimary: "#f2f1ef",
      textSecondary: "#c6c4c0",
      textTertiary: "#918e88",
      textMuted: "#6a6862",
      borderSubtle: "rgba(255,250,240,.06)",
      borderDefault: "rgba(255,250,240,.1)",
      borderStrong: "rgba(255,250,240,.16)",
      innerHighlight: "rgba(255,250,240,.05)",
      edgeLight: "rgba(255,250,240,.16)",
      iconSurface: "#1e1e1e",
      iconSurfaceStrong: "#262626",
      /* Matte: almost no blur radius, tight and graphic. */
      shadowSoft: "0 1px 0 rgba(0,0,0,.4), 0 2px 4px rgba(0,0,0,.3)",
      shadowPopover: "0 12px 24px -8px rgba(0,0,0,.6), 0 2px 6px rgba(0,0,0,.45)",
      shadowWindow: "0 18px 34px -14px rgba(0,0,0,.64), 0 3px 8px rgba(0,0,0,.4)",
      /* Brushed steel: still neutral — Graphite stays matte and weapon-grey —
         but bright enough that selected states and switches read as active
         rather than disabled. */
      accent: "#9aa7b0",
      accentHover: "#b3c0c8",
      accentMuted: "rgba(154,167,176,.24)",
      accentOnMuted: "#d4dce1",
      wallpaperDefault: "gradient-graphite",
    },
  },
  {
    id: "arctic",
    name: "Arctic",
    appearance: "dark",
    description: "Cool slate with brighter inner light and crisp, cold separation.",
    tokens: {
      ...darkBase,
      bgRoot: "#06090c",
      bgDesktop: "#080c10",
      surface0: "#0d1216",
      surface1: "#11171c",
      surface2: "#171e24",
      surface3: "#1e262e",
      surfaceHover: "#242d36",
      surfaceActive: "#2b353f",
      surfaceSunken: "#0a0f12",
      panelMaterial: "#0a0f13",
      dockMaterial: "#121a20",
      windowMaterial: "#0c1116",
      modalMaterial: "#131b21",
      textPrimary: "#f0f6f9",
      textSecondary: "#bfced6",
      textTertiary: "#8899a4",
      textMuted: "#5f6f7a",
      borderSubtle: "rgba(180,230,255,.08)",
      borderDefault: "rgba(180,230,255,.13)",
      borderStrong: "rgba(180,230,255,.2)",
      innerHighlight: "rgba(200,240,255,.08)",
      edgeLight: "rgba(200,240,255,.22)",
      iconSurface: "#152027",
      iconSurfaceStrong: "#1c2a33",
      shadowSoft: "0 1px 2px rgba(0,6,12,.34), 0 3px 8px rgba(0,6,12,.26)",
      shadowPopover: "0 20px 42px -14px rgba(0,8,14,.6), 0 4px 12px rgba(0,8,14,.4)",
      shadowWindow: "0 30px 62px -20px rgba(0,8,14,.62), 0 6px 16px rgba(0,8,14,.4)",
      accent: "#40c8e0",
      accentHover: "#63d5ea",
      accentMuted: "rgba(64,200,224,.22)",
      accentOnMuted: "#a5e6f2",
      wallpaperDefault: "cold-peak",
    },
  },
  {
    id: "ember",
    name: "Ember",
    appearance: "dark",
    description: "Warm, subdued brown-grey surfaces with low-contrast lighting.",
    tokens: {
      ...darkBase,
      bgRoot: "#0d0b09",
      bgDesktop: "#12100c",
      surface0: "#171412",
      surface1: "#1c1815",
      surface2: "#231e1a",
      surface3: "#2b2520",
      surfaceHover: "#332c26",
      surfaceActive: "#3b332c",
      surfaceSunken: "#13100e",
      panelMaterial: "#151210",
      dockMaterial: "#1d1916",
      windowMaterial: "#161311",
      modalMaterial: "#1f1a17",
      textPrimary: "#f5efe8",
      textSecondary: "#cdc2b6",
      textTertiary: "#998d80",
      textMuted: "#6f655a",
      borderSubtle: "rgba(255,225,190,.06)",
      borderDefault: "rgba(255,225,190,.1)",
      borderStrong: "rgba(255,225,190,.16)",
      innerHighlight: "rgba(255,225,190,.055)",
      edgeLight: "rgba(255,225,190,.15)",
      iconSurface: "#241e1a",
      iconSurfaceStrong: "#2d2621",
      shadowSoft: "0 1px 2px rgba(10,6,2,.32), 0 3px 7px rgba(10,6,2,.24)",
      shadowPopover: "0 18px 38px -14px rgba(10,6,2,.56), 0 4px 12px rgba(10,6,2,.36)",
      shadowWindow: "0 28px 58px -20px rgba(10,6,2,.58), 0 6px 16px rgba(10,6,2,.34)",
      accent: "#ff9f0a",
      accentHover: "#ffb340",
      accentMuted: "rgba(255,159,10,.20)",
      accentOnMuted: "#ffd39b",
      wallpaperDefault: "gradient-ember",
    },
  },
  {
    id: "amethyst",
    name: "Amethyst",
    appearance: "dark",
    description: "Muted violet-charcoal with a restrained lilac accent.",
    tokens: {
      ...darkBase,
      bgRoot: "#0a080d",
      bgDesktop: "#0d0a11",
      surface0: "#130f18",
      surface1: "#18131e",
      surface2: "#1e1826",
      surface3: "#261f30",
      surfaceHover: "#2d2538",
      surfaceActive: "#352c42",
      surfaceSunken: "#0f0c14",
      panelMaterial: "#120e17",
      dockMaterial: "#1a1421",
      windowMaterial: "#130f18",
      modalMaterial: "#1c1624",
      textPrimary: "#f3f0f7",
      textSecondary: "#c8c1d3",
      textTertiary: "#928a9f",
      textMuted: "#6b6377",
      borderSubtle: "rgba(220,190,255,.07)",
      borderDefault: "rgba(220,190,255,.11)",
      borderStrong: "rgba(220,190,255,.17)",
      innerHighlight: "rgba(220,190,255,.07)",
      edgeLight: "rgba(225,200,255,.18)",
      iconSurface: "#201a2b",
      iconSurfaceStrong: "#292136",
      shadowSoft: "0 1px 2px rgba(6,2,12,.34), 0 3px 8px rgba(6,2,12,.26)",
      shadowPopover: "0 20px 44px -14px rgba(6,2,12,.6), 0 4px 12px rgba(6,2,12,.4)",
      shadowWindow: "0 30px 64px -20px rgba(6,2,12,.62), 0 6px 16px rgba(6,2,12,.4)",
      accent: "#bf5af2",
      accentHover: "#cd7df5",
      accentMuted: "rgba(191,90,242,.22)",
      accentOnMuted: "#dfaaf9",
      wallpaperDefault: "gradient-violet",
    },
  },
  {
    id: "ivy",
    name: "Ivy",
    appearance: "dark",
    description:
      "Deep forest green, one tonal step between panels and a single restrained green accent. Flat, quiet and monochromatic.",
    tokens: {
      ...darkBase,
      bgRoot: "#0a130c",
      bgDesktop: "#0d1a10",
      surface0: "#121e16",
      surface1: "#142019",
      surface2: "#182619",
      surface3: "#1c2c1f",
      surfaceHover: "#213426",
      surfaceActive: "#28402e",
      surfaceSunken: "#0c160e",
      panelMaterial: "#0f1e13",
      dockMaterial: "#102014",
      windowMaterial: "#111d14",
      modalMaterial: "#16241a",
      textPrimary: "#f0f0f0",
      textSecondary: "#b9c6bb",
      textTertiary: "#8a9e8f",
      textMuted: "#6b7a6f",
      /* Green-tinted hairlines rather than neutral white ones: the lighting
         stays inside the same colour family as the surfaces it separates. */
      borderSubtle: "rgba(180,225,190,.065)",
      borderDefault: "rgba(180,225,190,.10)",
      borderStrong: "rgba(180,225,190,.155)",
      innerHighlight: "rgba(190,235,200,.05)",
      edgeLight: "rgba(190,235,200,.14)",
      iconSurface: "#16241a",
      iconSurfaceStrong: "#1d2f21",
      /* Flat by design: a tight contact shadow and no long ambient throw. */
      shadowSoft: "0 1px 2px rgba(2,8,4,.34), 0 2px 5px rgba(2,8,4,.22)",
      shadowPopover: "0 16px 34px -14px rgba(2,8,4,.56), 0 3px 10px rgba(2,8,4,.34)",
      shadowWindow: "0 24px 52px -18px rgba(2,8,4,.6), 0 4px 12px rgba(2,8,4,.32)",
      accent: "#34c759",
      accentHover: "#4fd471",
      accentMuted: "rgba(52,199,89,.20)",
      accentOnMuted: "#9ee5b3",
      wallpaperDefault: "ivy-canopy",
    },
  },
  {
    id: "daylight",
    name: "Daylight",
    appearance: "light",
    description: "Bright paper-white surfaces, soft light and gentle shadows.",
    tokens: {
      bgRoot: "#e9ebee",
      bgDesktop: "#dfe2e7",
      surface0: "#ffffff",
      surface1: "#f7f8fa",
      surface2: "#eef0f3",
      surface3: "#e4e7eb",
      surfaceHover: "#e7eaee",
      surfaceActive: "#dcdfe4",
      surfaceSunken: "#f2f3f6",
      panelMaterial: "#f4f5f8",
      dockMaterial: "#ffffff",
      windowMaterial: "#ffffff",
      modalMaterial: "#ffffff",
      textPrimary: "#16181c",
      textSecondary: "#3d434c",
      textTertiary: "#626974",
      textMuted: "#878e99",
      borderSubtle: "rgba(0,0,0,.06)",
      borderDefault: "rgba(0,0,0,.12)",
      borderStrong: "rgba(0,0,0,.18)",
      innerHighlight: "rgba(255,255,255,.9)",
      edgeLight: "rgba(255,255,255,.95)",
      iconSurface: "#ffffff",
      iconSurfaceStrong: "#eef0f3",
      shadowSoft: "0 1px 2px rgba(20,24,32,.06), 0 2px 6px rgba(20,24,32,.08)",
      shadowPopover: "0 16px 34px -12px rgba(20,24,32,.22), 0 3px 10px rgba(20,24,32,.12)",
      shadowWindow: "0 24px 50px -18px rgba(20,24,32,.26), 0 4px 12px rgba(20,24,32,.12)",
      accent: "#007aff",
      accentHover: "#0068e0",
      accentMuted: "rgba(0,122,255,.14)",
      accentOnMuted: "#0059bd",
      wallpaperDefault: "dawn-ridge",
    },
  },
  {
    id: "contrast",
    name: "High Contrast",
    appearance: "dark",
    description: "Maximum separation between surfaces, text, borders and focus.",
    tokens: {
      ...darkBase,
      bgRoot: "#000000",
      bgDesktop: "#000000",
      surface0: "#0c0c0c",
      surface1: "#161616",
      surface2: "#1f1f1f",
      surface3: "#2b2b2b",
      surfaceHover: "#363636",
      surfaceActive: "#444444",
      surfaceSunken: "#050505",
      panelMaterial: "#000000",
      dockMaterial: "#111111",
      windowMaterial: "#0a0a0a",
      modalMaterial: "#161616",
      textPrimary: "#ffffff",
      textSecondary: "#e6e6e6",
      textTertiary: "#c4c4c4",
      textMuted: "#a3a3a3",
      borderSubtle: "rgba(255,255,255,.2)",
      borderDefault: "rgba(255,255,255,.32)",
      borderStrong: "rgba(255,255,255,.5)",
      innerHighlight: "rgba(255,255,255,.12)",
      edgeLight: "rgba(255,255,255,.4)",
      iconSurface: "#1c1c1c",
      iconSurfaceStrong: "#2b2b2b",
      shadowSoft: "0 0 0 1px rgba(255,255,255,.08)",
      shadowPopover: "0 0 0 1px rgba(255,255,255,.28), 0 10px 24px rgba(0,0,0,.7)",
      shadowWindow: "0 0 0 1px rgba(255,255,255,.28), 0 16px 32px rgba(0,0,0,.7)",
      accent: "#ffd21f",
      accentHover: "#ffdd52",
      accentMuted: "rgba(255,210,31,.2)",
      accentOnMuted: "#ffe680",
      wallpaperDefault: "gradient-contrast",
    },
  },
  /* --------------------------------------------------------------------------
     Catppuccin — four milks of one palette. Every flavour keeps the same
     mauve accent and the same surface logic (crust, mantle, base, then the
     surface ladder), so only how dark the base runs changes: Latte is paper,
     Frappé the middle step, Macchiato deep indigo and Mocha the night read
     most ports ship by default.
     -------------------------------------------------------------------------- */
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    appearance: "light",
    description:
      "The light milk: cool blue-grey paper, periwinkle ink and the mauve accent over bright cream windows.",
    tokens: {
      bgRoot: "#eff1f5",
      bgDesktop: "#e6e9ef",
      surface0: "#f8f9fc",
      surface1: "#f1f3f8",
      surface2: "#eaecf3",
      surface3: "#e3e6ee",
      surfaceHover: "#dfe3ed",
      surfaceActive: "#d7dbe5",
      surfaceSunken: "#e6e9ef",
      panelMaterial: "#f4f5f9",
      dockMaterial: "#f8f9fc",
      windowMaterial: "#f8f9fc",
      modalMaterial: "#fbfcfe",
      textPrimary: "#4c4f69",
      textSecondary: "#5c5f77",
      textTertiary: "#6c6f85",
      textMuted: "#8c8fa1",
      /* Every border and shadow is mixed from the same periwinkle ink the text
         uses — a cool blue-grey cast, never neutral grey on blue paper. */
      borderSubtle: "rgba(76,79,105,.1)",
      borderDefault: "rgba(76,79,105,.16)",
      borderStrong: "rgba(76,79,105,.26)",
      innerHighlight: "rgba(255,255,255,.9)",
      edgeLight: "rgba(255,255,255,.95)",
      iconSurface: "#ffffff",
      iconSurfaceStrong: "#eceff5",
      shadowSoft: "0 1px 2px rgba(48,52,74,.07), 0 2px 6px rgba(48,52,74,.08)",
      shadowPopover: "0 16px 34px -12px rgba(48,52,74,.2), 0 3px 10px rgba(48,52,74,.11)",
      shadowWindow: "0 24px 50px -18px rgba(48,52,74,.24), 0 5px 14px rgba(48,52,74,.11)",
      accent: "#8839ef",
      accentHover: "#7418ec",
      accentMuted: "rgba(136,57,239,.16)",
      accentOnMuted: "#421b74",
      wallpaperDefault: "dawn-ridge",
    },
  },
  {
    id: "catppuccin-frappe",
    name: "Catppuccin Frappé",
    appearance: "dark",
    description:
      "The middle milk: slate-blue surfaces, powder-blue text and the mauve accent — the quietest dark step of the four.",
    tokens: {
      bgRoot: "#232634",
      bgDesktop: "#292c3c",
      surface0: "#303446",
      surface1: "#363a4d",
      surface2: "#3b4053",
      surface3: "#414559",
      surfaceHover: "#494d63",
      surfaceActive: "#51576d",
      surfaceSunken: "#262936",
      panelMaterial: "#2d3041",
      dockMaterial: "#292c3c",
      windowMaterial: "#303446",
      modalMaterial: "#363a4d",
      textPrimary: "#c6d0f5",
      textSecondary: "#b5bfe2",
      textTertiary: "#a5b1c2",
      textMuted: "#838ba7",
      borderSubtle: "rgba(198,208,245,.07)",
      borderDefault: "rgba(198,208,245,.11)",
      borderStrong: "rgba(198,208,245,.17)",
      innerHighlight: "rgba(198,208,245,.06)",
      edgeLight: "rgba(198,208,245,.16)",
      iconSurface: "#363a4d",
      iconSurfaceStrong: "#414559",
      shadowSoft: "0 1px 2px rgba(12,14,24,.36), 0 3px 8px rgba(12,14,24,.28)",
      shadowPopover: "0 20px 44px -14px rgba(12,14,24,.6), 0 4px 12px rgba(12,14,24,.4)",
      shadowWindow: "0 30px 64px -20px rgba(12,14,24,.62), 0 5px 14px rgba(12,14,24,.4)",
      accent: "#ca9ee6",
      accentHover: "#dec2ef",
      accentMuted: "rgba(202,158,230,.22)",
      accentOnMuted: "#d3aeea",
      wallpaperDefault: "gradient-slate",
    },
  },
  {
    id: "catppuccin-macchiato",
    name: "Catppuccin Macchiato",
    appearance: "dark",
    description:
      "The dark milk: deep indigo surfaces under lavender text, hairline separation and the same mauve accent.",
    tokens: {
      bgRoot: "#181926",
      bgDesktop: "#1e2030",
      surface0: "#24273a",
      surface1: "#2b2e42",
      surface2: "#303348",
      surface3: "#363a4f",
      surfaceHover: "#3f435a",
      surfaceActive: "#494d64",
      surfaceSunken: "#1b1d2b",
      panelMaterial: "#222436",
      dockMaterial: "#1e2030",
      windowMaterial: "#24273a",
      modalMaterial: "#2b2e42",
      textPrimary: "#cad3f5",
      textSecondary: "#a5adcb",
      textTertiary: "#939ab7",
      textMuted: "#6e738d",
      borderSubtle: "rgba(202,211,245,.07)",
      borderDefault: "rgba(202,211,245,.11)",
      borderStrong: "rgba(202,211,245,.17)",
      innerHighlight: "rgba(202,211,245,.06)",
      edgeLight: "rgba(202,211,245,.16)",
      iconSurface: "#2b2e42",
      iconSurfaceStrong: "#363a4f",
      shadowSoft: "0 1px 2px rgba(10,10,20,.4), 0 3px 8px rgba(10,10,20,.3)",
      shadowPopover: "0 20px 44px -14px rgba(10,10,20,.62), 0 4px 12px rgba(10,10,20,.42)",
      shadowWindow: "0 30px 64px -20px rgba(10,10,20,.64), 0 5px 14px rgba(10,10,20,.42)",
      accent: "#c6a0f6",
      accentHover: "#dfcafa",
      accentMuted: "rgba(198,160,246,.22)",
      accentOnMuted: "#c8acec",
      wallpaperDefault: "gradient-aubergine",
    },
  },
  {
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    appearance: "dark",
    description:
      "The darkest milk: warm indigo surfaces, pastel text and mauve — the Catppuccin most ports ship by default.",
    tokens: {
      bgRoot: "#11111b",
      bgDesktop: "#181825",
      surface0: "#1e1e2e",
      surface1: "#262639",
      surface2: "#2c2c40",
      surface3: "#313244",
      surfaceHover: "#3a3b4f",
      surfaceActive: "#45475a",
      surfaceSunken: "#151521",
      panelMaterial: "#1c1c2c",
      dockMaterial: "#181825",
      windowMaterial: "#1e1e2e",
      modalMaterial: "#242436",
      textPrimary: "#cdd6f4",
      textSecondary: "#bac2de",
      textTertiary: "#a6adc8",
      textMuted: "#6c7086",
      borderSubtle: "rgba(205,214,244,.07)",
      borderDefault: "rgba(205,214,244,.11)",
      borderStrong: "rgba(205,214,244,.17)",
      innerHighlight: "rgba(205,214,244,.06)",
      edgeLight: "rgba(205,214,244,.16)",
      iconSurface: "#262639",
      iconSurfaceStrong: "#313244",
      shadowSoft: "0 1px 2px rgba(8,8,16,.4), 0 3px 8px rgba(8,8,16,.3)",
      shadowPopover: "0 20px 44px -14px rgba(8,8,16,.62), 0 4px 12px rgba(8,8,16,.42)",
      shadowWindow: "0 30px 64px -20px rgba(8,8,16,.64), 0 5px 14px rgba(8,8,16,.42)",
      accent: "#cba6f7",
      accentHover: "#e4d0fb",
      accentMuted: "rgba(203,166,247,.22)",
      accentOnMuted: "#c9acec",
      wallpaperDefault: "gradient-violet",
    },
  },
  /* --------------------------------------------------------------------------
     Deprecated themes. They stay in the array because saved profiles and custom
     themes built from them must keep resolving, but they are badged as
     deprecated in the pickers and sit at the end of every grid so the themes we
     actually recommend are what a new eye lands on first.
     -------------------------------------------------------------------------- */
  {
    id: "frosted_glass",
    name: "Frosted Glass",
    appearance: "dark",
    deprecated: true,
    description: "Semi-transparent frosted glass surfaces that blend with the wallpaper behind them.",
    tokens: {
      ...darkBase,
      /* A cool alpine haze: the glass tints blue-white rather than grey, the
         way frost on a window actually reads. */
      panelMaterial: "rgba(23, 28, 36, 0.64)",
      dockMaterial: "rgba(25, 30, 39, 0.60)",
      windowMaterial: "rgba(20, 25, 33, 0.70)",
      modalMaterial: "rgba(26, 32, 41, 0.82)",
      surface0: "rgba(20, 25, 33, 0.72)",
      surface1: "rgba(23, 28, 36, 0.68)",
      surface2: "rgba(29, 35, 45, 0.70)",
      surface3: "rgba(36, 43, 53, 0.66)",
      surfaceHover: "rgba(41, 48, 59, 0.72)",
      surfaceActive: "rgba(48, 56, 68, 0.76)",
      surfaceSunken: "rgba(13, 16, 21, 0.86)",
      borderSubtle: "rgba(255, 255, 255, 0.08)",
      borderDefault: "rgba(255, 255, 255, 0.12)",
      borderStrong: "rgba(255, 255, 255, 0.18)",
      innerHighlight: "rgba(255, 255, 255, 0.08)",
      edgeLight: "rgba(255, 255, 255, 0.18)",
      iconSurface: "rgba(32, 39, 50, 0.84)",
      iconSurfaceStrong: "rgba(39, 47, 58, 0.80)",
      shadowSoft: "0 1px 3px rgba(0,0,0,0.25), 0 4px 12px rgba(0,0,0,0.18)",
      shadowPopover: "0 18px 48px -12px rgba(0,0,0,0.5), 0 6px 16px rgba(0,0,0,0.35)",
      shadowWindow: "0 30px 64px -18px rgba(0,0,0,0.56), 0 6px 14px rgba(0,0,0,0.32)",
      wallpaperDefault: "ridge-dusk",
    },
  },
  {
    id: "windowglass",
    name: "Windowglass",
    appearance: "dark",
    deprecated: true,
    description: "Semi-transparent black-tinted surfaces inspired by performance mode taskbars.",
    tokens: {
      ...darkBase,
      panelMaterial: "rgba(8, 10, 14, 0.70)",
      dockMaterial: "rgba(10, 12, 16, 0.66)",
      windowMaterial: "rgba(8, 10, 14, 0.74)",
      modalMaterial: "rgba(12, 14, 18, 0.88)",
      surface0: "rgba(10, 12, 16, 0.78)",
      surface1: "rgba(12, 14, 18, 0.72)",
      surface2: "rgba(18, 20, 26, 0.74)",
      surface3: "rgba(24, 26, 32, 0.68)",
      surfaceHover: "rgba(30, 32, 38, 0.72)",
      surfaceActive: "rgba(36, 38, 44, 0.76)",
      surfaceSunken: "rgba(6, 8, 12, 0.90)",
      borderSubtle: "rgba(255, 255, 255, 0.06)",
      borderDefault: "rgba(255, 255, 255, 0.10)",
      borderStrong: "rgba(255, 255, 255, 0.14)",
      innerHighlight: "rgba(255, 255, 255, 0.04)",
      edgeLight: "rgba(255, 255, 255, 0.10)",
      iconSurface: "rgba(18, 20, 26, 0.88)",
      iconSurfaceStrong: "rgba(24, 26, 32, 0.84)",
      shadowSoft: "0 1px 2px rgba(0,0,0,0.4), 0 3px 8px rgba(0,0,0,0.35)",
      shadowPopover: "0 16px 38px -10px rgba(0,0,0,0.65), 0 4px 10px rgba(0,0,0,0.45)",
      shadowWindow: "0 24px 48px -14px rgba(0,0,0,0.7), 0 5px 12px rgba(0,0,0,0.5)",
      wallpaperDefault: "harbour-night",
    },
  },
];

export const defaultThemeId = "cinema";

/** Theme ids that were renamed; saved profiles keep working. */
export const themeAliases: Record<string, string> = {
  slate: "ember",
  /* Deep Sea ships as Solarized Dark (same tokens, new name) and the old
     black-variant Solarized Dark ships as Dim. Deep Sea 2 was dropped as a
     duplicate of the same board, so its profiles land on the closest remaining
     theme. Each old id maps straight to a live preset, never through another
     alias, so a saved profile keeps the look it had. */
  "deep-sea-2": "deep-sea",
  "solar-dark": "dim",
};

export function findTheme(id: string): ThemePreset | undefined {
  const resolved = themeAliases[id] ?? id;
  return themePresets.find((theme) => theme.id === resolved);
}

/* --------------------------------------------------------------------------
   Accent overrides — applied on top of whatever theme is active.
   -------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
   Accents

   Every accent is a single base colour. Hover, active, the translucent
   selection fills and the two text colours are all derived from it, because
   hand-written variants are exactly how an accent system drifts: a pastel
   "on-muted" that only reads on a dark theme, or white label text on an amber
   button.

   The palette is what real desktops actually ship — the macOS system colours,
   Windows 11's accent set and Adwaita's slate — so a user arriving from any of
   them finds the colour they already trust rather than an invented one.
   -------------------------------------------------------------------------- */

export interface AccentOption {
  id: string;
  name: string;
  value: string;
  hover: string;
  active: string;
  muted: string;
  /** Heavier fill for a selected row than `muted`. */
  mutedStrong: string;
  onMuted: string;
  /** Label and icon colour on a solid accent fill; dark on light accents. */
  onAccent: string;
}

export interface AccentVariants {
  value: string;
  hover: string;
  active: string;
  muted: string;
  mutedStrong: string;
  onMuted: string;
  onAccent: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rgbToHsl(rgb: { r: number; g: number; b: number }): { h: number; s: number; l: number } {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = clamp01(s / 100);
  const lN = clamp01(l / 100);
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lN - c / 2;
  const to = (v: number) => toHexChannel((v + m) * 255);
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/**
 * Builds every accent variant from one colour for a given appearance.
 *
 * The appearance matters: an "on-muted" label has to be light on a dark theme
 * and dark on a light one, and hover should raise contrast in both cases rather
 * than always lighten.
 */
/**
 * The label ink for text sitting on a solid accent fill.
 *
 * The rule is the contrast itself rather than a hand-picked luminance cut-off:
 * white keeps the fill exactly as long as it still reads at 3:1 on it, and dark
 * ink takes over the moment it no longer does. A fixed threshold was the bug —
 * several accents sit just under it, where white is already failing and the
 * darker ink reads twice as clearly.
 */
function inkOn(luminance: number): string {
  // contrast(#ffffff, fill) with white's own luminance at 1.
  return 1.05 / (luminance + 0.05) >= 3 ? "#ffffff" : "#14161c";
}

export function accentVariants(baseHex: string, appearance: "dark" | "light"): AccentVariants {
  const rgb = parseHexColor(baseHex) ?? { r: 10, g: 132, b: 255 };
  const { h, s, l } = rgbToHsl(rgb);
  const dark = appearance === "dark";
  const hover = hslToHex(h, s, dark ? Math.min(96, l + 9) : Math.max(12, l - 7));
  const active = hslToHex(h, s, dark ? Math.max(10, l - 9) : Math.max(8, l - 12));
  const hue = h.toFixed(0);
  const sat = s.toFixed(0);
  const lig = l.toFixed(0);
  return {
    value: baseHex,
    hover,
    active,
    muted: `hsla(${hue}, ${sat}%, ${lig}%, ${dark ? 0.22 : 0.16})`,
    mutedStrong: `hsla(${hue}, ${sat}%, ${lig}%, ${dark ? 0.34 : 0.26})`,
    onMuted: hslToHex(h, Math.min(s, 62), dark ? 80 : 28),
    onAccent: inkOn(relativeLuminance(rgb)),
  };
}

function accentOption(id: string, name: string, base: string): AccentOption {
  return { id, name, ...accentVariants(base, "dark") };
}

export const accentOptions: AccentOption[] = [
  accentOption("moss", "Moss", "#43915c"),
  accentOption("ochre", "Ochre", "#d29a3f"),
  accentOption("blue", "Blue", "#0a84ff"),
  accentOption("indigo", "Indigo", "#5e5ce6"),
  accentOption("violet", "Violet", "#bf5af2"),
  accentOption("rose", "Pink", "#ff375f"),
  accentOption("red", "Red", "#ff453a"),
  accentOption("orange", "Orange", "#ff9f0a"),
  accentOption("amber", "Amber", "#e5a50a"),
  accentOption("yellow", "Yellow", "#f2c94c"),
  accentOption("green", "Green", "#30d158"),
  accentOption("teal", "Teal", "#40c8e0"),
  accentOption("graphite", "Graphite", "#8e8e93"),
];

export function findAccent(id: string): AccentOption | undefined {
  return accentOptions.find((accent) => accent.id === id);
}

/* --------------------------------------------------------------------------
   User-defined accent

   The curated list is deliberately short — five or six colours that were
   checked against every theme. A colour picker covers everything else: hover,
   muted and on-muted variants are derived from the chosen colour, so a custom
   accent behaves like a preset one instead of half-applying and leaving
   hover or selected states on the theme's original hue.
   -------------------------------------------------------------------------- */

export const customAccentId = "custom";

/** Keeps a derived colour inside a valid 0–255 channel range. */
function channel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHexChannel(value: number): string {
  return channel(value).toString(16).padStart(2, "0");
}

/** Parses `#rgb` or `#rrggbb`; null for anything else. */
export function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const trimmed = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(trimmed);
  if (!long) return null;
  return {
    r: parseInt(long[1], 16),
    g: parseInt(long[2], 16),
    b: parseInt(long[3], 16),
  };
}

/** Canonical `#rrggbb` form, or null when the input is not a hex colour. */
export function normaliseHex(value: string): string | null {
  const rgb = parseHexColor(value);
  if (!rgb) return null;
  return `#${toHexChannel(rgb.r)}${toHexChannel(rgb.g)}${toHexChannel(rgb.b)}`;
}

/**
 * Builds a full accent option from one colour the user picked.
 *
 * The option carries the dark-appearance variants for the settings preview;
 * `applyTheme` re-derives them for the theme's actual appearance so a custom
 * accent behaves exactly like a preset one on a light theme.
 */
export function accentFromHex(value: string, name = "Custom"): AccentOption | null {
  const base = normaliseHex(value);
  if (!base) return null;
  return { id: customAccentId, name, ...accentVariants(base, "dark") };
}

/* --------------------------------------------------------------------------
   Custom themes are user-authored token sets. They must be complete, so new
   themes start from a deep clone of whatever palette is currently active.
   -------------------------------------------------------------------------- */

export function emptyThemeFrom(base: ThemePreset, id: string, name: string): ThemePreset {
  return {
    id,
    name,
    appearance: base.appearance,
    description: "Custom theme",
    tokens: { ...base.tokens },
  };
}

export const themeTokenKeys: (keyof ThemeTokens)[] = [
  "bgRoot",
  "bgDesktop",
  "surface0",
  "surface1",
  "surface2",
  "surface3",
  "surfaceHover",
  "surfaceActive",
  "surfaceSunken",
  "panelMaterial",
  "dockMaterial",
  "windowMaterial",
  "modalMaterial",
  "textPrimary",
  "textSecondary",
  "textTertiary",
  "textMuted",
  "borderSubtle",
  "borderDefault",
  "borderStrong",
  "innerHighlight",
  "edgeLight",
  "iconSurface",
  "iconSurfaceStrong",
  "shadowSoft",
  "shadowPopover",
  "shadowWindow",
  "accent",
  "accentHover",
  "accentMuted",
  "accentOnMuted",
];

export const themeTokenLabel: Record<keyof ThemeTokens, string> = {
  bgRoot: "Root background",
  bgDesktop: "Desktop material",
  surface0: "Surface 0 — windows",
  surface1: "Surface 1 — bars and panels",
  surface2: "Surface 2 — controls",
  surface3: "Surface 3 — raised",
  surfaceHover: "Hover state",
  surfaceActive: "Active state",
  surfaceSunken: "Sunken — inputs",
  panelMaterial: "Panel material",
  dockMaterial: "Dock material",
  windowMaterial: "Window material",
  modalMaterial: "Dialog material",
  textPrimary: "Text primary",
  textSecondary: "Text secondary",
  textTertiary: "Text tertiary",
  textMuted: "Text muted",
  borderSubtle: "Border subtle",
  borderDefault: "Border default",
  borderStrong: "Border strong",
  innerHighlight: "Inner highlight",
  edgeLight: "Edge light",
  iconSurface: "Icon surface",
  iconSurfaceStrong: "Icon surface raised",
  shadowSoft: "Elevation — soft",
  shadowPopover: "Elevation — popover",
  shadowWindow: "Elevation — window",
  accent: "Accent",
  accentHover: "Accent hover",
  accentMuted: "Accent muted",
  accentOnMuted: "Accent text",
  wallpaperDefault: "Default wallpaper",
};

/** Shadows are validated as CSS values, not as colours the picker can edit. */
export const themeShadowTokens: (keyof ThemeTokens)[] = [
  "shadowSoft",
  "shadowPopover",
  "shadowWindow",
];

/** Validates imported theme JSON before it is allowed into the store. */
export function parseThemeJSON(raw: string): ThemePreset | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const candidate = data as Partial<ThemePreset>;
  if (typeof candidate.name !== "string" || !candidate.tokens) return null;

  const source = candidate.tokens as Partial<ThemeTokens>;
  // Themes exported before a token existed are filled from the default palette
  // rather than rejected, so old files keep importing.
  const tokens = { ...darkBase } as ThemeTokens;
  let recognised = 0;
  for (const key of themeTokenKeys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      tokens[key] = value;
      recognised += 1;
    }
  }
  if (recognised < 6) return null;

  return {
    id: typeof candidate.id === "string" ? candidate.id : `imported-${Date.now()}`,
    name: candidate.name.slice(0, 40),
    appearance: candidate.appearance === "light" ? "light" : "dark",
    description: candidate.description?.slice(0, 120) ?? "Imported theme",
    tokens,
  };
}

export { darkBase as fallbackThemeTokens };
