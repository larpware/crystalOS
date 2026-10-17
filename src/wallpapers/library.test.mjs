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

const { builtInWallpapers, gradientWallpapers, liveWallpapers, builtInWallpaperIds, findBuiltInWallpaper } =
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
