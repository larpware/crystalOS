/*
 * Tests for the account migration tool.
 *
 * The fixtures here are synthetic accounts created by the test itself; no real
 * account, password or token from any CrystalOS database is involved. Password
 * material is generated per run and asserted against only as booleans.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { looksLikeSqlite, migrate, parseArgs, readJsonSource } from "./migrate-accounts.mjs";
import { openAccountsStore } from "../server/accounts/db.mjs";
import { hashPassword, verifyPassword } from "../server/accounts/security.mjs";

const sink = { write() {} };

/**
 * A scratch directory whose databases are closed *before* it is removed —
 * Windows refuses to delete a directory an open SQLite handle is using, so the
 * cleanup has to be ordered, and every store opened inside a test is tracked
 * here rather than registered as its own after-hook.
 */
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "crystal-migrate-"));
  const closers = [];
  const open = (file) => {
    const store = openAccountsStore({ file });
    closers.push(() => store.close());
    return store;
  };
  t.after(() => {
    for (const close of closers.reverse()) {
      try {
        close();
      } catch {
        /* already closed */
      }
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* a leftover temp directory is not a test failure */
    }
  });
  return { dir, open };
}

/** A source database holding synthetic accounts with known passwords. */
async function makeSourceDatabase(dir, names) {
  const file = join(dir, "source.db");
  const store = openAccountsStore({ file });
  const created = [];
  for (const name of names) {
    const plaintext = `fixture-password-${name}-42`;
    const material = await hashPassword(plaintext);
    const user = store.createUser({
      username: name,
      displayName: name.toUpperCase(),
      passwordSalt: material.salt,
      passwordHash: material.hash,
      bio: `hello from ${name}`,
      createdAt: Date.parse("2026-01-05T00:00:00Z"),
    });
    created.push({ ...user, plaintext });
  }
  store.close();
  return { file, created };
}

test("sqlite source: accounts, profiles and passwords survive the move", async (t) => {
  const { dir, open } = tempDir(t);

  const { file: sourcePath, created } = await makeSourceDatabase(dir, ["luna", "sol", "owner"]);
  const source = openAccountsStore({ file: sourcePath });
  const [firstId, secondId] = [created[0].id, created[1].id].sort();
  const conversationId = `dm_${firstId}__${secondId}`;
  source.db
    .prepare("INSERT INTO friendships (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)")
    .run("frn_fixture", created[0].id, created[1].id, Date.now());
  source.db
    .prepare("INSERT INTO conversations (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)")
    .run(conversationId, firstId, secondId, Date.now());
  source.db
    .prepare(
      "INSERT INTO messages (id, conversation_id, author_id, body, sent_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run("msg_fixture", conversationId, created[0].id, "see you there", Date.now());
  // A session must NOT travel: it is another browser's live credential.
  source.db
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run("f".repeat(64), created[0].id, Date.now(), Date.now() + 86_400_000);
  source.close();

  const targetPath = join(dir, "target.db");
  const result = await migrate({ from: sourcePath, to: targetPath, stdout: sink, stderr: sink });

  assert.equal(result.ok, true);
  assert.equal(result.discovered, 3);
  assert.equal(result.toImport, 3);
  assert.equal(result.alreadyImported, 0);
  assert.ok(result.backupPath && existsSync(result.backupPath), "a backup was taken");

  const target = open(targetPath);
  assert.equal(target.countUsers(), 3);

  for (const user of created) {
    const row = target.userById(user.id);
    assert.ok(row, `${user.username} kept its id`);
    assert.equal(row.username, user.username);
    assert.equal(row.display_name, user.display_name);
    assert.equal(row.friend_code, user.friend_code, "friend code preserved");
    assert.equal(row.bio, user.bio);
    assert.equal(row.created_at, user.created_at, "created-at preserved");
    assert.equal(
      await verifyPassword(user.plaintext, row.password_salt, row.password_hash),
      true,
      `${user.username} can still sign in with the old password`,
    );
  }

  const friendship = target.db.prepare("SELECT * FROM friendships WHERE id = 'frn_fixture'").get();
  assert.ok(friendship, "associated data came along");
  const message = target.db.prepare("SELECT * FROM messages WHERE id = 'msg_fixture'").get();
  assert.ok(message, "messages came along");
  assert.equal(
    target.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n,
    0,
    "sessions are never migrated",
  );
  assert.equal(result.related.copied >= 2, true, "the summary reports the associated data");
});

test("re-running the same migration is a no-op", async (t) => {
  const { dir, open } = tempDir(t);

  const { file: sourcePath } = await makeSourceDatabase(dir, ["ada", "grace"]);
  const targetPath = join(dir, "target.db");

  const first = await migrate({ from: sourcePath, to: targetPath, stdout: sink, stderr: sink });
  assert.equal(first.toImport, 2);

  const second = await migrate({ from: sourcePath, to: targetPath, stdout: sink, stderr: sink });
  assert.equal(second.ok, true);
  assert.equal(second.toImport, 0);
  assert.equal(second.alreadyImported, 2);
  assert.equal(second.related.copied, 0, "nothing is copied twice");
  assert.equal(second.related.skipped, 0);

  const target = open(targetPath);
  assert.equal(target.countUsers(), 2, "no duplicates were created");
});

test("a username the target already holds is never overwritten", async (t) => {
  const { dir, open } = tempDir(t);

  const { file: firstSource, created } = await makeSourceDatabase(dir, ["mira"]);
  const targetPath = join(dir, "target.db");
  await migrate({ from: firstSource, to: targetPath, stdout: sink, stderr: sink });

  // A different machine's database claims the same username under another id.
  const clashDir = mkdtempSync(join(tmpdir(), "crystal-clash-"));
  const { file: clashSource, created: clashCreated } = await makeSourceDatabase(clashDir, ["mira"]);
  const clashStore = openAccountsStore({ file: clashSource });
  const clashRow = clashStore.userByUsername("mira");
  clashStore.close();

  const result = await migrate({ from: clashSource, to: targetPath, stdout: sink, stderr: sink });
  assert.equal(result.toImport, 0);
  assert.equal(result.skipped.username_collision, 1);

  const target = open(targetPath);
  const kept = target.userByUsername("mira");
  assert.equal(kept.id, created[0].id, "the target's account kept its id");
  assert.notEqual(kept.id, clashRow.id);
  assert.equal(target.countUsers(), 1, "the clash was not imported alongside");
  assert.equal(
    target.db.prepare("SELECT COUNT(*) AS n FROM friendships").get().n,
    0,
    "data belonging to a skipped account is not copied",
  );
  assert.equal(clashCreated.length, 1);
  try {
    rmSync(clashDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

test("browser-local JSON export: hashed records import, unhashed ones do not", async (t) => {
  const { dir, open } = tempDir(t);

  const material = await hashPassword("harbour-lantern-77");
  const exportPath = join(dir, "export.json");
  writeFileSync(
    exportPath,
    JSON.stringify({
      // The whole localStorage shape: namespaced keys, stringified values.
      "crescent.accounts": JSON.stringify({
        accounts: [
          {
            id: "usr_json_mira",
            username: "mira",
            displayName: "Mira Vale",
            friendCode: "CR23456789",
            bio: "from an older build",
            passwordSalt: material.salt,
            passwordHash: material.hash,
            createdAt: 1_700_000_000_000,
          },
          { id: "usr_json_nopass", username: "nopass", displayName: "No Pass" },
          { id: "usr_json_guest", username: "guesty", displayName: "Guesty", guest: true },
        ],
      }),
    }),
  );

  assert.ok(!looksLikeSqlite(exportPath), "a JSON export is not mistaken for SQLite");
  assert.equal(readJsonSource(exportPath).length, 3, "records found inside a namespaced dump");

  const targetPath = join(dir, "target.db");
  const result = await migrate({ from: exportPath, to: targetPath, stdout: sink, stderr: sink });
  assert.equal(result.ok, true);
  assert.equal(result.toImport, 1);
  assert.equal(result.skipped.no_password, 1);
  assert.equal(result.skipped.guest_profile, 1);

  const target = open(targetPath);
  const mira = target.userById("usr_json_mira");
  assert.ok(mira, "the id was preserved");
  assert.equal(mira.username, "mira");
  assert.equal(mira.display_name, "Mira Vale");
  assert.equal(mira.friend_code, "CR23456789", "a free friend code was preserved");
  assert.equal(mira.created_at, 1_700_000_000_000);
  assert.equal(
    await verifyPassword("harbour-lantern-77", mira.password_salt, mira.password_hash),
    true,
    "the old password works against the migrated account",
  );
  assert.equal(target.userById("usr_json_nopass"), null, "no password was invented");
});

test("--adopt-passwordless imports with unusable credentials, never a guessable one", async (t) => {
  const { dir, open } = tempDir(t);

  const exportPath = join(dir, "export.json");
  writeFileSync(
    exportPath,
    JSON.stringify({ accounts: [{ username: "nopass", displayName: "No Pass" }] }),
  );

  const targetPath = join(dir, "target.db");
  const result = await migrate({
    from: exportPath,
    to: targetPath,
    adoptPasswordless: true,
    stdout: sink,
    stderr: sink,
  });
  assert.equal(result.toImport, 1);
  assert.equal(result.adoptedPasswords, 1);

  const target = open(targetPath);
  const row = target.userByUsername("nopass");
  assert.ok(row);
  for (const guess of ["nopass", "", "password", "12345678"]) {
    assert.equal(
      await verifyPassword(guess, row.password_salt, row.password_hash),
      false,
      `the adopted account must not accept "${guess}"`,
    );
  }
});

test("a friend code the target already holds is re-drawn, and the import proceeds", async (t) => {
  const { dir, open } = tempDir(t);

  const { file: firstSource } = await makeSourceDatabase(dir, ["ada"]);
  const targetPath = join(dir, "target.db");
  await migrate({ from: firstSource, to: targetPath, stdout: sink, stderr: sink });
  const target = open(targetPath);
  const takenCode = target.userByUsername("ada").friend_code;

  const material = await hashPassword("second-lantern-12");
  const exportPath = join(dir, "export.json");
  writeFileSync(
    exportPath,
    JSON.stringify({
      accounts: [
        {
          username: "grace",
          displayName: "Grace",
          friendCode: takenCode,
          passwordSalt: material.salt,
          passwordHash: material.hash,
        },
      ],
    }),
  );

  const result = await migrate({ from: exportPath, to: targetPath, stdout: sink, stderr: sink });
  assert.equal(result.toImport, 1);
  assert.equal(result.regeneratedFriendCodes, 1);

  const grace = target.userByUsername("grace");
  assert.ok(grace);
  assert.notEqual(grace.friend_code, takenCode);
  assert.equal(target.userByFriendCode(takenCode).username, "ada", "the original code is untouched");
});

test("a dry run changes nothing", async (t) => {
  const { dir, open } = tempDir(t);

  const { file: sourcePath } = await makeSourceDatabase(dir, ["ada"]);
  const targetPath = join(dir, "target.db");

  const result = await migrate({
    from: sourcePath,
    to: targetPath,
    dryRun: true,
    stdout: sink,
    stderr: sink,
  });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.toImport, 1, "the plan is reported");
  assert.equal(result.related.copied, 0, "a source with no associated data reports none");

  const target = open(targetPath);
  assert.equal(target.countUsers(), 0, "but nothing was written");
});

test("a missing source names the export that is needed", async (t) => {
  const { dir } = tempDir(t);

  const messages = [];
  const result = await migrate({
    from: join(dir, "not-here.db"),
    to: join(dir, "target.db"),
    stdout: sink,
    stderr: { write: (text) => messages.push(text) },
  });
  assert.equal(result.ok, false);
  assert.match(messages.join(""), /does not exist/);
  assert.match(messages.join(""), /crescent\.accounts/, "it says how to export the browser data");
});

test("parseArgs reads the documented flags and rejects anything else", () => {
  assert.deepEqual(parseArgs(["--from", "a.db", "--to", "b.db", "--dry-run"]), {
    from: "a.db",
    to: "b.db",
    dryRun: true,
  });
  assert.deepEqual(parseArgs(["--from", "a.json", "--adopt-passwordless", "--no-backup"]), {
    from: "a.json",
    adoptPasswordless: true,
    backup: false,
  });
  assert.ok(parseArgs(["--nope"]).error);
});
