/*
 * CrystalOS — accent derivation tests
 *
 * Run with `npm test` (or `node --test src/themes/accents.test.mjs`).
 *
 * presets.ts imports only types at runtime, so the Node test runner can load it
 * directly.
 *
 * These guard the property that made the old accent system look wrong: every
 * variant is derived from one base colour, so a light accent never gets white
 * label text and an "on-muted" label never ends up pale-on-pale in a light
 * theme. The contrast checks below re-implement luminance independently rather
 * than trusting the module's own maths.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  accentFromHex,
  accentOptions,
  accentVariants,
  customAccentId,
  findAccent,
  themePresets,
} from "./presets.ts";

/* ---- independent colour maths ------------------------------------------ */

function parseHex(hex) {
  const value = hex.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG relative luminance. */
function luminance(hex) {
  const { r, g, b } = parseHex(hex);
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Parses `hsla(h, s%, l%, a)` back to an opaque rgb triple. */
function mutedOver(hex, surface) {
  const match = /hsla\((\d+),\s*(\d+)%,\s*(\d+)%,\s*([\d.]+)\)/.exec(hex);
  if (!match) throw new Error(`not an hsla colour: ${hex}`);
  const [, hueS, satS, lightS, alphaS] = match;
  const h = Number(hueS) / 360;
  const s = Number(satS) / 100;
  const l = Number(lightS) / 100;
  const a = Number(alphaS);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 360) / 60) % 2 - 1));
  const m = l - c / 2;
  const seg = Math.floor(h * 6) % 6;
  const [r1, g1, b1] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][seg];
  const base = parseHex(surface);
  const mix = (v, back) => Math.round((v + m) * 255 * a + back * (1 - a));
  return { r: mix(r1, base.r), g: mix(g1, base.g), b: mix(b1, base.b) };
}

function rgbToHex({ r, g, b }) {
  const to = (v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

const DARK_SURFACE = "#191c22";
const LIGHT_SURFACE = "#ffffff";

const HEX = /^#[0-9a-f]{6}$/i;

describe("accent variants", () => {
  test("every built-in accent derives a complete, valid set", () => {
    for (const option of accentOptions) {
      for (const key of ["value", "hover", "active", "onMuted", "onAccent"]) {
        assert.match(option[key], HEX, `${option.id}.${key} should be a 6-digit hex`);
      }
      assert.match(option.muted, /^hsla\(/, `${option.id}.muted should be translucent`);
      assert.match(option.mutedStrong, /^hsla\(/, `${option.id}.mutedStrong should be translucent`);
    }
  });

  test("ids are unique and stay backwards compatible", () => {
    const ids = accentOptions.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length);
    // Ids shipped by the previous palette; a stored profile keeps working.
    for (const legacy of ["blue", "teal", "green", "amber", "rose", "violet"]) {
      assert.ok(ids.includes(legacy), `legacy accent id "${legacy}" must survive`);
      assert.ok(findAccent(legacy), `findAccent("${legacy}") must resolve`);
    }
  });

  test("label text on a solid fill is chosen for contrast, not hard-coded", () => {
    const lightInk = accentVariants("#e5a50a", "dark").onAccent; // amber
    const whiteInk = accentVariants("#0a84ff", "dark").onAccent; // blue
    assert.notEqual(lightInk, "#ffffff", "amber must not keep white label text");
    assert.equal(whiteInk, "#ffffff");

    // Whatever the module picks, it must actually be easier to read.
    for (const option of accentOptions) {
      const chosen = contrast(option.onAccent, option.value);
      const other = contrast("#ffffff", option.value);
      assert.ok(
        chosen >= other - 0.001,
        `${option.id}: picked ink has ${chosen.toFixed(2)}:1 but white gives ${other.toFixed(2)}:1`,
      );
      assert.ok(chosen >= 3, `${option.id}: label contrast ${chosen.toFixed(2)}:1 is too low`);
    }
  });

  test("on-muted text flips with the appearance instead of staying pastel", () => {
    for (const option of accentOptions) {
      const dark = accentVariants(option.value, "dark");
      const light = accentVariants(option.value, "light");
      assert.ok(
        luminance(dark.onMuted) > luminance(light.onMuted),
        `${option.id}: on-muted should be lighter on a dark theme than a light one`,
      );

      // And it has to be legible over the fill it sits on.
      const onDark = contrast(dark.onMuted, rgbToHex(mutedOver(dark.muted, DARK_SURFACE)));
      const onLight = contrast(light.onMuted, rgbToHex(mutedOver(light.muted, LIGHT_SURFACE)));
      assert.ok(onDark >= 4.5, `${option.id}: dark-theme on-muted is ${onDark.toFixed(2)}:1`);
      assert.ok(onLight >= 4.5, `${option.id}: light-theme on-muted is ${onLight.toFixed(2)}:1`);
    }
  });

  test("hover raises contrast in both appearances", () => {
    for (const option of accentOptions) {
      const dark = accentVariants(option.value, "dark");
      const light = accentVariants(option.value, "light");
      assert.ok(
        luminance(dark.hover) > luminance(dark.value),
        `${option.id}: hover should lighten on a dark theme`,
      );
      assert.ok(
        luminance(light.hover) < luminance(light.value),
        `${option.id}: hover should deepen on a light theme`,
      );
      assert.equal(light.value, option.value);
    }
  });

  test("hover and active are distinct from the base", () => {
    for (const option of accentOptions) {
      const v = accentVariants(option.value, "dark");
      assert.notEqual(v.hover, v.value, `${option.id}: hover must differ`);
      assert.notEqual(v.active, v.value, `${option.id}: active must differ`);
      assert.notEqual(v.hover, v.active, `${option.id}: hover and active must differ`);
    }
  });
});

describe("theme presets", () => {
  test("every theme's accent produces readable label text", () => {
    assert.ok(themePresets.length > 0);
    for (const theme of themePresets) {
      const accent = theme.tokens.accent;
      assert.match(accent, HEX, `${theme.id}: accent should be a hex colour`);
      const appearance = luminance(theme.tokens.bgRoot) > 0.5 ? "light" : "dark";
      const derived = accentVariants(accent, appearance);
      assert.ok(
        contrast(derived.onAccent, accent) >= 3,
        `${theme.id}: label contrast on its accent is ${contrast(derived.onAccent, accent).toFixed(2)}:1`,
      );
    }
  });

  test("no theme still ships a light accent with white button text", () => {
    for (const theme of themePresets) {
      const accent = theme.tokens.accent;
      if (luminance(accent) <= 0.42) continue;
      const appearance = luminance(theme.tokens.bgRoot) > 0.5 ? "light" : "dark";
      assert.equal(
        accentVariants(accent, appearance).onAccent,
        "#14161c",
        `${theme.id}: a light accent must use dark ink`,
      );
    }
  });
});

describe("accentFromHex", () => {
  test("normalises shorthand and mixed case", () => {
    const option = accentFromHex("#0A8");
    assert.ok(option);
    assert.equal(option.id, customAccentId);
    assert.equal(option.value, "#00aa88");
  });

  test("rejects anything that is not a colour", () => {
    for (const bad of ["", "nope", "#12", "#12345", "#gggggg", "rgb(1,2,3)"]) {
      assert.equal(accentFromHex(bad), null, `"${bad}" should be rejected`);
    }
  });

  test("the custom accent still derives the same guarantee", () => {
    const option = accentFromHex("#ffd21f"); // high-contrast yellow
    assert.ok(option);
    assert.equal(option.onAccent, "#14161c");
  });
});
