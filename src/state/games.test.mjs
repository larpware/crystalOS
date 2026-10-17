/*
 * CrystalOS — game profile tests
 *
 * Run with `npm test` (or `node --test src/state/games.test.mjs`).
 *
 * Profiles are the one part of the Games store a user can hand-edit: they live
 * in localStorage, and a value written by an older build — or by hand — is read
 * back on the next boot. So the property under test is not "the editor saves a
 * profile" (the editor is one of several writers) but "nothing that reaches the
 * player through a profile can be malformed": an unknown launch mode, an
 * unbounded tag list, or a title that swallows the panel.
 *
 * Node resolves neither Vite's `@/` alias nor extensionless relative imports,
 * so the hook below maps them the way the bundler does. The store's storage
 * adapter already falls back to memory when there is no `window`, which is what
 * makes the real store loadable here at all.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

/** `src/`, so `@/state/games` resolves the same way Vite resolves it. */
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

const {
  defaultGameProfile,
  gameLaunchModes,
  isDefaultGameProfile,
  normaliseGameProfile,
  useGamesStore,
} = await import("@/state/games");

beforeEach(() => {
  useGamesStore.setState({
    favourites: [],
    recents: [],
    sessions: [],
    hidden: [],
    profiles: {},
  });
});

describe("normaliseGameProfile", () => {
  test("a missing or non-object profile is the default", () => {
    assert.deepEqual(normaliseGameProfile(undefined), defaultGameProfile);
    assert.deepEqual(normaliseGameProfile(null), defaultGameProfile);
    assert.deepEqual(normaliseGameProfile("nonsense"), defaultGameProfile);
    assert.deepEqual(normaliseGameProfile(42), defaultGameProfile);
  });

  test("an unknown launch mode never reaches the player", () => {
    for (const mode of ["Embedded", "popup", "", null, 7, undefined]) {
      assert.equal(normaliseGameProfile({ launchMode: mode }).launchMode, "embedded", String(mode));
    }
    // Every advertised mode survives, so the editor and the guard agree.
    for (const mode of gameLaunchModes) {
      assert.equal(normaliseGameProfile({ launchMode: mode.value }).launchMode, mode.value);
    }
  });

  test("text fields are capped, and non-strings are dropped", () => {
    const profile = normaliseGameProfile({
      title: "t".repeat(200),
      notes: "n".repeat(2000),
    });
    assert.equal(profile.title.length, 80);
    assert.equal(profile.notes.length, 600);
    assert.equal(normaliseGameProfile({ title: 12, notes: {} }).title, "");
    assert.equal(normaliseGameProfile({ title: 12, notes: {} }).notes, "");
  });

  test("tags are trimmed, de-duplicated, capped and emptied out", () => {
    const profile = normaliseGameProfile({
      tags: ["  co-op  ", "co-op", "", "   ", "short", 5, null, "a".repeat(50)],
    });
    assert.deepEqual(profile.tags, ["co-op", "short", "a".repeat(24)]);
    assert.deepEqual(normaliseGameProfile({ tags: "co-op" }).tags, []);
    assert.deepEqual(normaliseGameProfile({ tags: [1, 2, 3] }).tags, []);
  });

  test("no more than eight tags survive", () => {
    const tags = Array.from({ length: 20 }, (_, index) => `tag-${index}`);
    assert.equal(normaliseGameProfile({ tags }).tags.length, 8);
  });

  test("fullscreenOnLaunch is only true when it is exactly true", () => {
    assert.equal(normaliseGameProfile({ fullscreenOnLaunch: true }).fullscreenOnLaunch, true);
    for (const value of ["true", 1, {}, undefined, null]) {
      assert.equal(normaliseGameProfile({ fullscreenOnLaunch: value }).fullscreenOnLaunch, false);
    }
  });
});

describe("isDefaultGameProfile", () => {
  test("recognises the default and every single-step departure from it", () => {
    assert.equal(isDefaultGameProfile(defaultGameProfile), true);
    assert.equal(isDefaultGameProfile(normaliseGameProfile({})), true);
    assert.equal(isDefaultGameProfile(normaliseGameProfile({ title: "Renamed" })), false);
    assert.equal(isDefaultGameProfile(normaliseGameProfile({ notes: "hi" })), false);
    assert.equal(isDefaultGameProfile(normaliseGameProfile({ tags: ["x"] })), false);
    assert.equal(isDefaultGameProfile(normaliseGameProfile({ launchMode: "browser" })), false);
    assert.equal(isDefaultGameProfile(normaliseGameProfile({ fullscreenOnLaunch: true })), false);
  });
});

describe("the store", () => {
  test("setProfile merges rather than replaces, and normalises on the way in", () => {
    const { setProfile } = useGamesStore.getState();
    setProfile("game-1", { title: "My name" });
    setProfile("game-1", { launchMode: "browser" });
    assert.deepEqual(useGamesStore.getState().profileFor("game-1"), {
      ...defaultGameProfile,
      title: "My name",
      launchMode: "browser",
    });
  });

  test("a hand-written profile in storage is normalised on read", () => {
    // Standing in for localStorage that was edited by hand, or written by an
    // older build whose launch modes were different.
    useGamesStore.setState({
      profiles: { "game-2": { launchMode: "teleport", tags: ["ok", 3], title: "x".repeat(99) } },
    });
    const profile = useGamesStore.getState().profileFor("game-2");
    assert.equal(profile.launchMode, "embedded");
    assert.deepEqual(profile.tags, ["ok"]);
    assert.equal(profile.title.length, 80);
  });

  test("profileFor always answers, even for a game with no profile", () => {
    assert.deepEqual(useGamesStore.getState().profileFor("never-seen"), defaultGameProfile);
  });

  test("resetProfile removes the entry rather than storing a default", () => {
    const { setProfile, resetProfile } = useGamesStore.getState();
    setProfile("game-3", { notes: "temporary" });
    assert.ok(useGamesStore.getState().profiles["game-3"]);
    resetProfile("game-3");
    assert.equal(useGamesStore.getState().profiles["game-3"], undefined);
    assert.deepEqual(useGamesStore.getState().profileFor("game-3"), defaultGameProfile);
  });

  test("clearing history leaves profiles alone", () => {
    const { setProfile, recordSession, clearHistory } = useGamesStore.getState();
    setProfile("game-4", { title: "Kept" });
    recordSession({ gameId: "game-4", at: Date.now(), seconds: 60 });
    clearHistory();
    const state = useGamesStore.getState();
    assert.deepEqual(state.sessions, []);
    assert.deepEqual(state.recents, []);
    assert.equal(state.profileFor("game-4").title, "Kept");
  });
});
