/*
 * CrystalOS — friend-code rarity tests (client side)
 *
 * Run with `npm test` (or `node --test src/services/rarity.test.mjs`).
 *
 * The client keeps a mirror of the server's rarity table so the guide can be
 * read offline, and the whole risk of a mirror is that it drifts. So the first
 * test here imports the real server module and compares the two tables field by
 * field: if someone changes a weight on either side and not the other, this
 * fails. The remaining tests cover the guard that decides whether a server
 * payload is trustworthy enough to display.
 *
 * Node resolves neither Vite's `@/` alias nor extensionless relative imports,
 * so the hook below maps them the way the bundler does.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

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

const rarity = await import("./rarity.ts");
const server = await import("../../server/accounts/rarity.mjs");

describe("the client mirror", () => {
  test("matches the server's table exactly", () => {
    const guide = server.rarityGuide();
    assert.equal(rarity.RARITY_FALLBACK.length, guide.tiers.length);
    for (const [index, tier] of rarity.RARITY_FALLBACK.entries()) {
      assert.deepEqual(
        { id: tier.id, name: tier.name, percent: tier.percent, weight: tier.weight },
        {
          id: guide.tiers[index].id,
          name: guide.tiers[index].name,
          percent: guide.tiers[index].percent,
          weight: guide.tiers[index].weight,
        },
        `tier ${index} (${tier.id}) must match the server`,
      );
    }
  });

  test("adds up to a whole", () => {
    const weightTotal = rarity.RARITY_FALLBACK.reduce((sum, tier) => sum + tier.weight, 0);
    assert.equal(weightTotal, rarity.RARITY_TOTAL_WEIGHT);
    assert.equal(weightTotal, 1000, "1000 tenths of a percent is 100%");
    const percentTotal = rarity.RARITY_FALLBACK.reduce((sum, tier) => sum + tier.percent, 0);
    assert.equal(Math.round(percentTotal * 10) / 10, 100);
  });

  test("is ordered lowest to highest", () => {
    assert.deepEqual(rarity.RARITY_IDS, [
      "basic",
      "uncommon",
      "rare",
      "epic",
      "legendary",
      "prismatic",
      "transcendent",
    ]);
    // Each tier is strictly rarer than the one before it.
    for (let index = 1; index < rarity.RARITY_FALLBACK.length; index += 1) {
      assert.ok(
        rarity.RARITY_FALLBACK[index].weight < rarity.RARITY_FALLBACK[index - 1].weight,
        `${rarity.RARITY_FALLBACK[index].id} must be rarer than ${rarity.RARITY_FALLBACK[index - 1].id}`,
      );
    }
  });
});

describe("rarity lookups", () => {
  test("rank orders the tiers and tolerates junk", () => {
    assert.equal(rarity.rarityRank("basic"), 0);
    assert.equal(rarity.rarityRank("transcendent"), 6);
    assert.equal(rarity.rarityRank("diamond"), -1);
    assert.equal(rarity.rarityRank(undefined), -1);
  });

  test("names resolve only for known tiers", () => {
    assert.equal(rarity.rarityName("epic"), "Epic");
    assert.equal(rarity.rarityName("diamond"), null);
    assert.equal(rarity.rarityName(undefined), null);
  });

  test("isRarityId rejects everything that is not a tier", () => {
    assert.ok(rarity.isRarityId("prismatic"));
    assert.ok(!rarity.isRarityId("Prismatic"));
    assert.ok(!rarity.isRarityId(7));
    assert.ok(!rarity.isRarityId(null));
  });
});

describe("normaliseGuide", () => {
  const good = () => JSON.parse(JSON.stringify(server.rarityGuide()));

  test("accepts the live server payload and marks it live", () => {
    const guide = rarity.normaliseGuide(good());
    assert.ok(guide);
    assert.equal(guide.live, true);
    assert.equal(guide.total, 1000);
    assert.equal(guide.tiers.length, 7);
  });

  test("refuses a table that is missing tiers", () => {
    const payload = good();
    payload.tiers.pop();
    assert.equal(rarity.normaliseGuide(payload), null);
  });

  test("refuses an unknown tier id", () => {
    const payload = good();
    payload.tiers[0].id = "mythical";
    assert.equal(rarity.normaliseGuide(payload), null);
  });

  test("refuses percentages that do not add up", () => {
    const payload = good();
    payload.tiers[6].weight = 5; // total is now 1004
    assert.equal(rarity.normaliseGuide(payload), null);
  });

  test("refuses a non-numeric or non-positive share", () => {
    for (const bad of ["60", 0, -1, Number.NaN]) {
      const payload = good();
      payload.tiers[0].percent = bad;
      assert.equal(rarity.normaliseGuide(payload), null, `percent ${String(bad)} must be refused`);
    }
  });

  test("refuses anything that is not a guide at all", () => {
    for (const bad of [null, undefined, 42, "guide", {}, { tiers: "seven" }]) {
      assert.equal(rarity.normaliseGuide(bad), null);
    }
  });

  test("the fallback stands in with live: false rather than pretending", () => {
    const guide = rarity.fallbackGuide();
    assert.equal(guide.live, false);
    assert.equal(guide.tiers, rarity.RARITY_FALLBACK);
  });
});
