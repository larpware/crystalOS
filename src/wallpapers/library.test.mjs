/*
 * CrystalOS — wallpaper library tests
 *
 * Run with `npm test` (or `node --test src/wallpapers/library.test.mjs`).
 *
 * The library is data, and the tile grid trusts it completely: it renders
 * whatever id it is handed and looks the entry up by that id. So the cheap
 * ways to break the desktop are all data mistakes — a duplicated id silently
 * shadows an earlier wallpaper, a live entry pointing at a scene that does not
 * exist paints nothing, an entry with no fallback shows a black rectangle when
 * the fetch fails, and two entries sharing one photo waste a slot. None of
 * that is caught by the type system, because all of it is still well-typed.
 *
 * The remote URLs themselves cannot be checked from here (tests run offline),
 * so this covers the structure the renderer depends on, and the images are
 * verified when the library is edited instead.
 *
 * Node resolves neither Vite's `@/` alias nor extensionless relative imports,
 * so the hook below maps them the way the bundler does.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

/** `src/`, so `@/wallpapers/library` resolves the same way Vite resolves it. */
const SRC_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

function resolveWithExtensions(base) {
  if (existsSync(base)) return base;
  for (const suffix of [".ts", ".tsx", ".js", ".mjs", "/index.ts"]) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith("@/")) {
      base = resolvePath(SRC_ROOT, specifier.slice(2));
    } else if (!/\.[cm]?[jt]sx?$|\.json$/.test(specifier) && specifier.startsWith(".") && context.parentURL) {
      base = fileURLToPath(new URL(specifier, context.parentURL));
    }
    const found = base === null ? null : resolveWithExtensions(base);
    return found ? { url: pathToFileURL(found).href, shortCircuit: true } : nextResolve(specifier, context);
  },
});

const { builtInWallpapers, gradientWallpapers, liveWallpapers, builtInWallpaperIds, findBuiltInWallpaper, wallpaperUrlForDisplay } =
  await import("@/wallpapers/library");
const { liveScenes, liveSceneLabels } = await import("@/wallpapers/liveScenes");

const all = [...builtInWallpapers, ...gradientWallpapers, ...liveWallpapers];

/** The categories the tile subtitle and the search field expect to see. */
const CATEGORIES = new Set(["landscape", "abstract", "graphics", "space", "city", "custom", "video"]);

describe("wallpaper library", () => {
  test("ids are unique across every kind", () => {
    const seen = new Map();
    for (const wallpaper of all) {
      assert.ok(!seen.has(wallpaper.id), `duplicate wallpaper id: ${wallpaper.id}`);
      seen.set(wallpaper.id, wallpaper);
    }
    assert.equal(builtInWallpaperIds.size, all.length, "the id set must cover the whole library");
  });

  test("every entry can be looked up by the id the tile renders", () => {
    for (const wallpaper of all) {
      assert.equal(findBuiltInWallpaper(wallpaper.id), wallpaper);
    }
    assert.equal(findBuiltInWallpaper("no-such-wallpaper"), undefined);
  });

  test("every entry has a name, a known category and a fallback", () => {
    for (const wallpaper of all) {
      assert.ok(wallpaper.name.trim().length > 0, `${wallpaper.id} has no name`);
      assert.ok(CATEGORIES.has(wallpaper.category), `${wallpaper.id} has category ${wallpaper.category}`);
      // The fallback is what renders when the remote asset fails, so it has to
      // be a real paint — not an empty string and not a bare colour.
      assert.match(
        wallpaper.fallback,
        /^(linear-gradient|radial-gradient|conic-gradient)\(/,
        `${wallpaper.id} needs a gradient fallback`,
      );
    }
  });

  test("photographic entries point at one distinct remote image each", () => {
    const photos = all.filter((wallpaper) => wallpaper.kind === "image");
    assert.ok(photos.length > 0);
    const urls = new Set();
    for (const wallpaper of photos) {
      assert.match(wallpaper.url ?? "", /^https:\/\//, `${wallpaper.id} needs an https url`);
      assert.ok(!urls.has(wallpaper.url), `two wallpapers share ${wallpaper.url}`);
      urls.add(wallpaper.url);
    }
  });

  test("gradient entries have no remote dependency", () => {
    for (const wallpaper of gradientWallpapers) {
      assert.equal(wallpaper.kind, "gradient");
      assert.equal(wallpaper.url, undefined, `${wallpaper.id} must not fetch anything`);
    }
  });

  test("every live entry names a scene the renderer actually has", () => {
    for (const wallpaper of liveWallpapers) {
      assert.equal(wallpaper.kind, "live");
      assert.ok(wallpaper.scene, `${wallpaper.id} has no scene`);
      assert.equal(
        typeof liveScenes[wallpaper.scene],
        "function",
        `${wallpaper.id} points at missing scene ${wallpaper.scene}`,
      );
      assert.ok(liveSceneLabels[wallpaper.scene], `${wallpaper.scene} has no label`);
    }
  });

  test("every scene is offered by the library, so none is unreachable", () => {
    const offered = new Set(liveWallpapers.map((wallpaper) => wallpaper.scene));
    for (const scene of Object.keys(liveScenes)) {
      assert.ok(offered.has(scene), `scene ${scene} is implemented but has no wallpaper`);
    }
  });
});

describe("wallpaperUrlForDisplay", () => {
  const PHOTO = "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&w=3840&q=85";
  const width = (url) => Number(new URL(url).searchParams.get("w"));

  test("a desktop-sized request is trimmed to what the display paints", () => {
    const sized = wallpaperUrlForDisplay(PHOTO, 1280, 1);
    assert.equal(width(sized), 1280, "a 1280px layer must not decode a 3840px photograph");
    assert.ok(sized.includes("auto=format"), "the format negotiation is preserved");
    assert.ok(sized.includes("q=85"), "the quality is preserved");
  });

  test("a hidpi display still gets the pixels it shows", () => {
    // A 1440px layer on a 2x panel paints 2880 real pixels.
    assert.equal(width(wallpaperUrlForDisplay(PHOTO, 1440, 2)), 2880);
  });

  test("requests are rounded up to a cache step, never down below what is painted", () => {
    const sized = wallpaperUrlForDisplay(PHOTO, 1000, 1);
    assert.ok(width(sized) >= 1000, "rounding must not undershoot the layer");
    assert.equal(width(sized) % 160, 0, "requests should land on round widths");
  });

  test("the manifest size is a ceiling: a request is never enlarged", () => {
    assert.equal(wallpaperUrlForDisplay(PHOTO, 3840, 1), PHOTO);
    assert.equal(wallpaperUrlForDisplay(PHOTO, 6000, 2), PHOTO);
  });

  test("a small slot never asks for less than a legible photograph", () => {
    assert.equal(width(wallpaperUrlForDisplay(PHOTO, 120, 1)), 640);
  });

  test("a zoomed wallpaper is requested at the size it is painted", () => {
    // Framing zoom 2 paints twice the layer, so the request has to double.
    assert.equal(width(wallpaperUrlForDisplay(PHOTO, 800, 1, 2)), 1600);
    // Bucketed to whole steps, so a drag across 1.1..1.9 asks for 2x only once.
    assert.equal(width(wallpaperUrlForDisplay(PHOTO, 800, 1, 1.1)), 1600);
    assert.equal(width(wallpaperUrlForDisplay(PHOTO, 800, 1, 1.9)), 1600);
    assert.equal(width(wallpaperUrlForDisplay(PHOTO, 800, 1, 2.9)), 2400);
  });

  test("a zoom of one or less never shrinks the request below the layer", () => {
    for (const zoom of [1, 0.5, 0, -2]) {
      assert.equal(width(wallpaperUrlForDisplay(PHOTO, 800, 1, zoom)), 800);
    }
    assert.equal(width(wallpaperUrlForDisplay(PHOTO, 800, 1, Number.NaN)), 800);
  });

  test("a very large zoom still stops at the manifest ceiling", () => {
    assert.equal(width(wallpaperUrlForDisplay(PHOTO, 1440, 2, 3)), 3840);
  });

  test("a url that is not one of ours is returned untouched", () => {
    const custom = "blob:http://localhost:5273/8f0a-12b3";
    assert.equal(wallpaperUrlForDisplay(custom, 900, 1), custom);
    const otherHost = "https://example.com/photo.jpg?w=3840";
    assert.equal(wallpaperUrlForDisplay(otherHost, 900, 1), otherHost);
  });

  test("nonsense dimensions fall back to the legible minimum instead of throwing", () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(width(wallpaperUrlForDisplay(PHOTO, bad, 1)), 640);
    }
    assert.equal(width(wallpaperUrlForDisplay(PHOTO, 1280, Number.NaN)), 1280);
  });

  test("a url with no readable width is left alone", () => {
    const noWidth = "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format";
    assert.equal(wallpaperUrlForDisplay(noWidth, 800, 1), noWidth);
  });

  test("the manifest urls keep their full size, so a 4K panel is unaffected", () => {
    for (const wallpaper of all) {
      if (wallpaper.kind !== "image") continue;
      assert.equal(width(wallpaper.url), 3840, `${wallpaper.id} should stay at the ceiling`);
    }
  });
});
