/*
 * CrystalOS — friend-code rarity tests
 *
 * Run with `npm test` (or `node --test server/accounts/rarity.test.mjs`).
 *
 * The claim this feature makes to the user is a numerical one — "Prismatic is
 * 0.9% of codes" — so the tests are numerical too. They pin the published
 * table, check the roll boundaries land exactly on the weights, check the
 * observed share of a large sample sits within four standard deviations of the
 * table, and check an account's rarity is drawn once and then never changes.
 *
 * A back-dated database is built here on purpose: rarity was added after
 * accounts existed, so the migration that backfills old rows is a real code
 * path, not a hypothetical one.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAccountsApi } from "./api.mjs";
import { openAccountsStore } from "./db.mjs";
import { RARITY_IDS, RARITY_TIERS, RARITY_TOTAL_WEIGHT, rarityForRoll, rarityGuide, rollRarity } from "./rarity.mjs";

/* --------------------------------------------------------------------------
   The table itself
   -------------------------------------------------------------------------- */

describe("rarity table", () => {
  it("totals exactly 100% of the draw", () => {
    assert.equal(RARITY_TOTAL_WEIGHT, 1000, "weights are tenths of a percent and must sum to 1000");
  });

  it("matches the published distribution", () => {
    // Pinned deliberately: changing a weight changes what users are told, so it
    // should be a conscious edit that also updates the guide.
    const expected = {
      basic: 60,
      uncommon: 22,
      rare: 10,
      epic: 5,
      legendary: 2,
      prismatic: 0.9,
      transcendent: 0.1,
    };
    const guide = rarityGuide();
    assert.deepEqual(
      guide.tiers.map((tier) => tier.id),
      Object.keys(expected),
      "the guide lists the tiers lowest first",
    );
    for (const tier of guide.tiers) {
      assert.equal(tier.percent, expected[tier.id], `${tier.id} percent`);
    }
    const total = guide.tiers.reduce((sum, tier) => sum + tier.percent, 0);
    assert.equal(Math.round(total * 10) / 10, 100, "the published percentages total 100%");
  });

  it("gives every tier a description and a name", () => {
    for (const tier of rarityGuide().tiers) {
      assert.ok(tier.name.length > 0, `${tier.id} has a name`);
      assert.ok(tier.description.length > 20, `${tier.id} explains itself`);
    }
  });
});

/* --------------------------------------------------------------------------
   The draw
   -------------------------------------------------------------------------- */

describe("rarity draws", () => {
  it("maps every roll to the tier whose slice contains it", () => {
    let cursor = 0;
    for (const tier of RARITY_TIERS) {
      // First and last value of this tier's slice.
      assert.equal(rarityForRoll(cursor).id, tier.id, `roll ${cursor} opens ${tier.id}`);
      assert.equal(rarityForRoll(cursor + tier.weight - 1).id, tier.id, `roll ${cursor + tier.weight - 1} closes ${tier.id}`);
      cursor += tier.weight;
    }
    assert.equal(rarityForRoll(RARITY_TOTAL_WEIGHT - 1).id, "transcendent", "the last value is the rarest tier");
  });

  it("draws the tier the injected random asks for", () => {
    for (const tier of RARITY_TIERS) {
      const start = RARITY_TIERS.slice(0, RARITY_TIERS.indexOf(tier)).reduce((n, t) => n + t.weight, 0);
      assert.equal(rollRarity(() => start).rarity, tier.id);
    }
  });

  it("clamps a random function that misbehaves instead of returning undefined", () => {
    assert.equal(rollRarity(() => 1000).rarity, "transcendent");
    assert.equal(rollRarity(() => -5).rarity, "basic");
  });

  it("never returns an unknown tier", () => {
    for (let i = 0; i < 2000; i += 1) {
      assert.ok(RARITY_IDS.includes(rollRarity().rarity));
    }
  });

  it("lands within four standard deviations of the published table", () => {
    // A large sample: 200k draws makes the rarest tier (0.1%) expect ~200 hits,
    // so a table that was wrong by even a factor of two would fail loudly, while
    // honest noise will not trip a four-sigma bound.
    const draws = 200_000;
    const counts = Object.fromEntries(RARITY_IDS.map((id) => [id, 0]));
    for (let i = 0; i < draws; i += 1) counts[rollRarity().rarity] += 1;

    for (const tier of RARITY_TIERS) {
      const p = tier.weight / RARITY_TOTAL_WEIGHT;
      const expected = draws * p;
      const sd = Math.sqrt(draws * p * (1 - p));
      const drift = Math.abs(counts[tier.id] - expected);
      assert.ok(
        drift <= 4 * sd + 1,
        `${tier.id}: expected ~${Math.round(expected)} of ${draws}, drew ${counts[tier.id]}`,
      );
    }
  });
});

/* --------------------------------------------------------------------------
   Migration of accounts that predate rarity
   -------------------------------------------------------------------------- */

describe("rarity migration", () => {
  let dir;
  let file;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "crystal-rarity-"));
    file = join(dir, "legacy.db");

    // The users table exactly as it looked before rarity existed.
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      CREATE TABLE users (
        id             TEXT PRIMARY KEY,
        username       TEXT NOT NULL,
        username_lower TEXT NOT NULL UNIQUE,
        display_name   TEXT NOT NULL,
        friend_code    TEXT NOT NULL UNIQUE,
        password_salt  TEXT NOT NULL,
        password_hash  TEXT NOT NULL,
        kdf            TEXT NOT NULL DEFAULT 'scrypt',
        bio            TEXT,
        avatar         TEXT,
        created_at     INTEGER NOT NULL,
        last_seen_at   INTEGER NOT NULL DEFAULT 0
      );
    `);
    legacy
      .prepare(
        `INSERT INTO users (id, username, username_lower, display_name, friend_code,
                            password_salt, password_hash, created_at, last_seen_at)
         VALUES ('usr_legacy', 'Legacy', 'legacy', 'Legacy', 'CRABCDEFGH', 's', 'h', 1, 1)`,
      )
      .run();
    legacy.close();
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it("backfills an old account with a real draw, and does not re-roll it", () => {
    const store = openAccountsStore({ file });
    const row = store.userById("usr_legacy");
    assert.ok(RARITY_IDS.includes(row.rarity), `backfilled rarity was ${row.rarity}`);
    assert.ok(row.rarity_roll >= 0 && row.rarity_roll < RARITY_TOTAL_WEIGHT, "the roll is recorded");
    assert.equal(rarityForRoll(row.rarity_roll).id, row.rarity, "the stored roll explains the stored tier");
    store.close();

    // Reopening must find the columns and leave the assigned rarity alone.
    const again = openAccountsStore({ file });
    assert.equal(again.userById("usr_legacy").rarity, row.rarity, "rarity is permanent");
    again.close();
  });
});

/* --------------------------------------------------------------------------
   The API surface
   -------------------------------------------------------------------------- */

describe("rarity API", () => {
  let dir;
  let store;
  let httpServer;
  let base;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "crystal-rarity-api-"));
    store = openAccountsStore({ file: join(dir, "api.db") });
    const api = createAccountsApi({ store });
    httpServer = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      void api.handle(req, res, url).then((handled) => {
        if (!handled && !res.headersSent) res.writeHead(404).end();
      });
    });
    await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${httpServer.address().port}`;
  });

  after(async () => {
    httpServer.closeAllConnections();
    await new Promise((resolve) => httpServer.close(resolve));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const post = (path, body, cookie) =>
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body ?? {}),
    });

  async function register(username) {
    const res = await post("/api/accounts/register", {
      username,
      displayName: username,
      password: "correct horse battery",
    });
    assert.equal(res.status, 201, `register ${username}`);
    const cookie = res.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
    const { user } = await res.json();
    return { user, cookie };
  }

  it("serves the guide without a session", async () => {
    const res = await fetch(`${base}/api/accounts/rarities`);
    assert.equal(res.status, 200);
    const guide = await res.json();
    assert.equal(guide.tiers.length, RARITY_TIERS.length);
    assert.deepEqual(guide, rarityGuide(), "the guide is served verbatim from the live table");
  });

  it("gives a new account a rarity from the table", async () => {
    const { user } = await register("rarityuser");
    assert.ok(RARITY_IDS.includes(user.rarity), `got ${user.rarity}`);
  });

  it("keeps the rarity stable across reads and profile edits", async () => {
    const { user, cookie } = await register("stablerarity");

    const me = await (await fetch(`${base}/api/accounts/me`, { headers: { cookie } })).json();
    assert.equal(me.user.rarity, user.rarity);

    const patched = await fetch(`${base}/api/accounts/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ displayName: "Renamed" }),
    });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).user.rarity, user.rarity, "an edit cannot change it");
  });

  it("offers no way to re-roll: there is no rarity write route", async () => {
    const { cookie } = await register("noroll");
    for (const [method, path] of [
      ["POST", "/api/accounts/rarities"],
      ["POST", "/api/accounts/me/rarity"],
      ["PATCH", "/api/accounts/rarities"],
    ]) {
      const res = await fetch(base + path, {
        method,
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ rarity: "transcendent" }),
      });
      assert.ok(res.status >= 400, `${method} ${path} must not be accepted (got ${res.status})`);
    }
  });

  it("sends rarity to friends, so a profile card can show it", async () => {
    const alice = await register("rarityalice");
    const bob = await register("raritybob");
    const request = await post(
      "/api/accounts/friend-requests",
      { friendCode: bob.user.friendCode },
      alice.cookie,
    );
    assert.equal(request.status, 201);
    const { request: created } = await request.json();
    const accepted = await post(
      `/api/accounts/friend-requests/${created.id}/accept`,
      {},
      bob.cookie,
    );
    assert.equal(accepted.status, 200);
    const { friend } = await accepted.json();
    // Accepting returns the other party — here, the account that sent it.
    assert.equal(friend.id, alice.user.id);
    assert.ok(RARITY_IDS.includes(friend.rarity), `friend rarity was ${friend.rarity}`);
    assert.equal(friend.rarity, alice.user.rarity, "the friend payload carries the rarity");
  });
});
