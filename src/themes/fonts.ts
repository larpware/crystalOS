/* ==========================================================================
   Font catalog

   CrystalOS runs entirely in the browser and installs no font files, so every
   option here is a stack: the OS picks the first family it actually has and
   falls through the rest. That means a choice always renders — on a machine
   without the first family the next one is used — instead of silently falling
   back to a broken face. Users never type a font name; they pick a role's
   family from a list.
   ========================================================================== */

export interface FontOption {
  id: string;
  name: string;
  /** Full CSS font-family value, written to the role's custom property. */
  stack: string;
  description: string;
}

export const uiFontOptions: FontOption[] = [
  {
    id: "dm",
    name: "DM Sans",
    stack:
      '"DM Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, system-ui, Roboto, sans-serif',
    description: "Knockout's bundled interface face — warm, even letterforms, all weights.",
  },
  {
    id: "plex",
    name: "IBM Plex Sans",
    stack:
      '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, Roboto, sans-serif',
    description: "Engineered grotesque with a technical, printed-readout character.",
  },
  {
    id: "system",
    name: "System",
    stack:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    description: "Whatever the operating system uses for its own interface.",
  },
  {
    id: "humanist",
    name: "Humanist",
    stack: '"Segoe UI", "Open Sans", "Helvetica Neue", Verdana, Tahoma, sans-serif',
    description: "Open letterforms with tall ascenders; very legible at small sizes.",
  },
  {
    id: "grotesk",
    name: "Neo-grotesk",
    stack: '"Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif',
    description: "Neutral, even-width sans with a technical feel.",
  },
  {
    id: "rounded",
    name: "Rounded",
    stack: '"SF Pro Rounded", ui-rounded, "Segoe UI Variable Display", Nunito, "Trebuchet MS", sans-serif',
    description: "Soft terminals for a friendlier, more playful shell.",
  },
  {
    id: "geometric",
    name: "Geometric",
    stack: '"Futura", "Century Gothic", "Avenir Next", "Segoe UI", sans-serif',
    description: "Circular shapes and generous spacing.",
  },
  {
    id: "serif",
    name: "Serif",
    stack: 'Georgia, "Times New Roman", "Noto Serif", ui-serif, serif',
    description: "Traditional book letterforms for the whole interface.",
  },
  {
    id: "mono",
    name: "Monospace",
    stack: '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    description: "Fixed-width text everywhere; rows always line up.",
  },
];

export const monoFontOptions: FontOption[] = [
  {
    id: "mono",
    name: "JetBrains Mono",
    stack:
      '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", monospace',
    description: "The default terminal face.",
  },
  {
    id: "fira",
    name: "Fira / Menlo",
    stack: '"Fira Code", "Fira Mono", Menlo, Monaco, "DejaVu Sans Mono", monospace',
    description: "Compact coding font with a wide, calm rhythm.",
  },
  {
    id: "consolas",
    name: "Consolas",
    stack: 'Consolas, "Liberation Mono", "Courier New", monospace',
    description: "Windows' classic console face.",
  },
  {
    id: "courier",
    name: "Courier",
    stack: '"Courier New", Courier, "Nimbus Mono PS", monospace',
    description: "The oldest typewriter look, for the terminal purist.",
  },
  {
    id: "plexmono",
    name: "IBM Plex Mono",
    stack: '"IBM Plex Mono", "Roboto Mono", "Source Code Pro", monospace',
    description: "Rounded terminals, reads like a printed listing.",
  },
];

/** The display role drives the lock-screen clock; it can borrow any family. */
export const displayFontOptions: FontOption[] = [
  {
    id: "display",
    name: "Follow theme",
    stack: "var(--font-display)",
    description: "Whatever display face the active theme carries — serif for Cinema, grotesk for Solarized.",
  },
  {
    id: "instrument",
    name: "Instrument Serif",
    stack: '"Instrument Serif", Georgia, "Times New Roman", ui-serif, serif',
    description: "The bundled editorial face — tall, quiet strokes for large type.",
  },
  {
    id: "space-grotesk",
    name: "Space Grotesk",
    stack: '"Space Grotesk", "IBM Plex Sans", Inter, system-ui, sans-serif',
    description: "Engineered grotesque with ink traps — the Solarized readout face.",
  },
  ...uiFontOptions,
  {
    id: "digital",
    name: "Digital (tabular mono)",
    stack:
      '"JetBrains Mono", "Cascadia Mono", Consolas, "SFMono-Regular", monospace',
    description: "Fixed-width digits for a clock that never jitters.",
  },
  {
    id: "thin",
    name: "Thin sans",
    stack:
      '"Helvetica Neue", "Segoe UI Light", "Segoe UI", "Roboto Thin", Roboto, Arial, sans-serif',
    description: "Light strokes for a large, airy clock.",
  },
];

const allFonts = [...uiFontOptions, ...monoFontOptions, ...displayFontOptions];
const fontById = new Map(allFonts.map((font) => [font.id, font]));

/** Resolves a font id to a usable CSS stack, falling back to the system face. */
export function fontStack(id: string): string {
  return fontById.get(id)?.stack ?? fontById.get("system")!.stack;
}

export function fontOption(id: string): FontOption | undefined {
  return fontById.get(id);
}
