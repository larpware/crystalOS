#!/usr/bin/env node
/* CrystalOS — account migration
 *
 * Moves existing accounts into the authoritative account database
 * (`server/accounts/data/accounts.db`, overridable with CRESCENT_ACCOUNTS_DB)
 * so the same identities work on every deployment, wherever the shell is
 * hosted.
 *
 * Two sources are understood, detected from the file itself:
 *
 *   SQLite  an accounts database written by an earlier CrystalOS backend
 *           (…/server/accounts/data/accounts.db). This is the common case:
 *           the local backend kept real accounts in SQLite that a static host
 *           could never reach.
 *
 *   JSON    an export of the browser-local records from a build that stored
 *           profiles in localStorage under `crescent.accounts`. Accepts the
 *           raw value (`{ "accounts": [ … ] }`), a bare array, a `{ "users": […]
 *           }` wrapper, or a whole localStorage dump keyed by name. Export it
 *           in the source browser with:
 *
 *             copy(JSON.stringify(localStorage.getItem("crescent.accounts")))
 *
 *           (or F12 → Application → Local storage → crescent.accounts).
 *
 * What is preserved, in order of importance:
 *
 *   - the account id, so anything keyed by it keeps pointing at the same row;
 *   - the scrypt password salt and hash, byte for byte, so existing
 *     passwords keep working — the plaintext is neither needed nor read;
 *   - the username, display name, bio, avatar, friend code, rarity draw,
 *     role and tags;
 *   - created-at timestamps.
 *
 * What it refuses to do:
 *
 *   - overwrite or rewrite an account that already exists in the target
 *     (a username or id held by another account is reported and skipped);
 *   - invent a password. A record with no compatible password material is
 *     skipped with a reason unless `--adopt-passwordless` is given, and even
 *     then the account gets random credentials it cannot sign in with until an
 *     administrator sets a real password — never a guessable one;
 *   - print or log anything derived from a password.
 *
 * Safety:
 *
 *   - `--dry-run` plans and validates everything, writes nothing;
 *   - a `VACUUM INTO` snapshot of the target is taken before the first write
 *     (…<db>.pre-migration-<timestamp>.bak) — the rollback is to stop the
 *     backend and restore that file;
 *   - the whole import runs inside one transaction: it either lands or does
 *     not;
 *   - re-running the same import is a no-op (idempotent), which is what makes
 *     it safe to run again after a partial or interrupted attempt.
 *
 * Usage:
 *   node scripts/migrate-accounts.mjs --from <accounts.db|export.json> [--to <db>]
 *                                      [--dry-run] [--adopt-passwordless] [--no-backup]
 *
 * Exit codes: 0 — nothing left to do / everything imported; 1 — the run was
 * refused (bad arguments, unreadable source, failed verification).
 */

import { closeSync, copyFileSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { openAccountsStore } from "../server/accounts/db.mjs";
import {
  generateFriendCode,
  isWellFormedFriendCode,
  normalizeFriendCode,
} from "../server/accounts/codes.mjs";
import { createId } from "../server/accounts/ids.mjs";
import { RARITY_IDS, isRarityId, rollRarity } from "../server/accounts/rarity.mjs";
import { parseTags, validateTags } from "../server/accounts/tags.mjs";
import {
  RESERVED_NAMES,
  hashPassword,
  validateAvatar,
  validateBio,
  validateDisplayName,
  validateUsername,
} from "../server/accounts/security.mjs";

const FRIEND_CODE_ATTEMPTS = 8;
const USER_COLUMNS = [
  "id",
  "username",
  "username_lower",
  "display_name",
  "friend_code",
  "password_salt",
  "password_hash",
  "kdf",
  "bio",
  "avatar",
  "rarity",
  "rarity_roll",
  "created_at",
  "last_seen_at",
  "private_account",
  "role",
  "tags",
];

/* ------------------------------------------------------------------ source */

/** Column names of a table, or [] when it does not exist. */
export function tableColumns(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((entry) => entry.name);
}

/** Primary-key columns of a table, in key order (empty when it has none). */
export function tablePrimaryKeys(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .filter((entry) => entry.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((entry) => entry.name);
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row.name);
}

/**
 * Opens a source SQLite accounts database read-only and checks it really is
 * one. The caller owns the handle (the related-data copy needs it open for the
 * whole run), so this never closes it itself.
 */
export function openSourceDb(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  if (!tableNames(db).includes("users")) {
    db.close();
    throw new Error(`${file} has no "users" table — this is not a CrystalOS accounts database.`);
  }
  return db;
}

/** Every user row of an open source database, as plain objects. */
export function readSqliteUsers(db) {
  const columns = tableColumns(db, "users");
  return db
    .prepare(`SELECT ${columns.map((name) => `"${name}"`).join(", ")} FROM users ORDER BY created_at`)
    .all();
}

/** True for the file shapes this tool treats as SQLite (magic-byte check). */
export function looksLikeSqlite(file) {
  if (file === ":memory:") return false;
  if (!existsSync(file)) return false;
  const head = Buffer.alloc(16);
  let fd;
  try {
    fd = openSync(file, "r");
    readSync(fd, head, 0, 16, 0);
    return head.subarray(0, 15).toString("utf8") === "SQLite format 3";
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Pulls account records out of a JSON export. Accepts a bare array, an
 * `{ accounts: [...] }` or `{ users: [...] }` object, or a whole localStorage
 * dump whose values are themselves JSON strings (the browser case).
 */
export function readJsonSource(file) {
  const text = readFileSync(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
  const records = [];
  const seen = new Set();
  const visit = (value, depth) => {
    if (depth > 4 || value == null) return;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry && typeof entry === "object" && !seen.has(entry)) {
          seen.add(entry);
          records.push(entry);
        }
      }
      return;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          visit(JSON.parse(trimmed), depth + 1);
        } catch {
          /* not an encoded value — ignored */
        }
      }
      return;
    }
    if (typeof value !== "object") return;
    for (const key of ["accounts", "users"]) {
      if (Array.isArray(value[key])) visit(value[key], depth + 1);
    }
    for (const nested of Object.values(value)) {
      // Strings are visited too: a localStorage dump stores every value as an
      // encoded JSON string, which is exactly where the profiles live.
      visit(nested, depth + 1);
    }
  };
  visit(parsed, 0);
  if (records.length === 0) {
    throw new Error(
      `${file} contains no account records (looked for an array, or "accounts"/"users" keys).`,
    );
  }
  return records;
}

/* -------------------------------------------------------------- normalise */

function textOf(value) {
  return typeof value === "string" ? value : null;
}

function numberOf(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/**
 * One source record in the shape the planner works with. Reads both the
 * snake_case SQLite columns and the camelCase fields an export may carry.
 * Only field *names* and non-secret values are handled here.
 */
export function normaliseRecord(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { index, invalid: true };
  }
  const salt = textOf(raw.password_salt ?? raw.passwordSalt ?? raw.salt ?? "");
  const hash = textOf(raw.password_hash ?? raw.passwordHash ?? raw.hash ?? "");
  const rawTags = raw.tags;
  return {
    index,
    invalid: false,
    sourceId: textOf(raw.id)?.trim() ?? "",
    username: String(raw.username ?? "").trim(),
    displayName: String(raw.display_name ?? raw.displayName ?? "").trim(),
    friendCode: String(raw.friend_code ?? raw.friendCode ?? "").trim(),
    bio: textOf(raw.bio),
    avatar: textOf(raw.avatar),
    password: salt && hash ? { salt, hash, kdf: textOf(raw.kdf) ?? "scrypt" } : null,
    createdAt: numberOf(raw.created_at ?? raw.createdAt),
    lastSeenAt: numberOf(raw.last_seen_at ?? raw.lastSeenAt),
    rarity: isRarityId(raw.rarity) ? raw.rarity : null,
    rarityRoll: numberOf(raw.rarity_roll ?? raw.rarityRoll),
    role: raw.role === "admin" ? "admin" : "user",
    tags: Array.isArray(rawTags) ? rawTags : parseTags(rawTags),
    privateAccount: Boolean(raw.private_account ?? raw.privateAccount),
    // A guest profile never was an account: no credentials, no server
    // identity. It is reported rather than quietly turned into one.
    guest: Boolean(raw.guest),
  };
}

/* ------------------------------------------------------------------ plan */

/**
 * Decides, without writing anything, which records import and why the rest do
 * not. Collisions are never resolved by overwriting: an id or username the
 * target already holds belongs to the target's copy of that account.
 *
 * @returns {{ rows: object[], decisions: object[], stats: object }}
 */
export function planMigration(records, store) {
  const db = store.db;
  const existing = new Map();
  for (const row of db.prepare("SELECT id, username_lower FROM users").all()) {
    existing.set(row.id, row.username_lower);
  }
  const takenUsernames = new Set(existing.values());
  const takenCodes = new Set(
    db.prepare("SELECT friend_code FROM users").all().map((row) => row.friend_code),
  );

  const rows = [];
  const decisions = [];
  const seenIds = new Set();
  const seenUsernames = new Set();
  /*
   * source user id → id in the target. Related rows (messages, posts,
   * friendships …) are only copied when every account they reference has an
   * entry here, so a record that was skipped can never leave orphaned data
   * behind in the new database.
   */
  const idMap = new Map();
  const stats = {
    discovered: records.length,
    toImport: 0,
    alreadyImported: 0,
    skipped: {},
    regeneratedIds: 0,
    regeneratedFriendCodes: 0,
    adoptedPasswords: 0,
    defaultedCreatedAt: 0,
    droppedFields: 0,
  };

  const skip = (record, reason, detail) => {
    decisions.push({ action: "skip", username: record.username || "(unnamed)", reason, detail });
    stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1;
  };

  for (const record of records) {
    if (record.invalid) {
      decisions.push({ action: "skip", username: "(unreadable record)", reason: "invalid_record" });
      stats.skipped.invalid_record = (stats.skipped.invalid_record ?? 0) + 1;
      continue;
    }

    if (record.guest) {
      skip(record, "guest_profile", "guest sessions are local by design and have no credentials");
      continue;
    }

    // Idempotency: this record is already in the target.
    if (record.sourceId && existing.has(record.sourceId)) {
      if (existing.get(record.sourceId) === record.username.toLowerCase()) {
        decisions.push({ action: "skip", username: record.username, reason: "already_imported" });
        stats.alreadyImported += 1;
        idMap.set(record.sourceId, record.sourceId);
      } else {
        skip(record, "id_collision", "the id belongs to a different account in the target");
      }
      continue;
    }
    if (record.sourceId && seenIds.has(record.sourceId)) {
      skip(record, "duplicate_in_source", "the same id appears twice in the source");
      continue;
    }

    const usernameError = validateUsername(record.username)?.error ?? null;
    // The owner's own name is reserved against *registration*; migrating the
    // owner's real account is exactly what it is reserved for.
    const reservedButLegitimate =
      usernameError !== null && RESERVED_NAMES.has(record.username.toLowerCase());
    if (usernameError && !reservedButLegitimate) {
      skip(record, "invalid_username", usernameError);
      continue;
    }

    const lower = record.username.toLowerCase();
    if (takenUsernames.has(lower) || seenUsernames.has(lower)) {
      skip(record, "username_collision", "the target already has an account with this username");
      continue;
    }

    if (!record.password) {
      const adopted = record.adoptedPassword;
      if (!adopted) {
        skip(
          record,
          "no_password",
          "no compatible password hash in the source; supply one or rerun with --adopt-passwordless",
        );
        continue;
      }
      stats.adoptedPasswords += 1;
    }

    const displayName = validateDisplayName(record.displayName, record.username);
    const bio = record.bio === null || record.bio === undefined ? { value: null } : validateBio(record.bio);
    const avatar = record.avatar === null || record.avatar === undefined
      ? { value: null }
      : validateAvatar(record.avatar);
    if (displayName.error || bio.error || avatar.error) stats.droppedFields += 1;

    let id = record.sourceId;
    if (!id) {
      id = createId("usr");
      stats.regeneratedIds += 1;
    }

    const canonicalCode = normalizeFriendCode(record.friendCode);
    let friendCode = canonicalCode;
    if (!isWellFormedFriendCode(friendCode) || takenCodes.has(friendCode)) {
      friendCode = allocateFriendCode(takenCodes);
      stats.regeneratedFriendCodes += 1;
    }

    const createdAt = record.createdAt ?? Date.now();
    if (!record.createdAt) stats.defaultedCreatedAt += 1;
    // A stored tier keeps its stored roll (the draw that produced it). A
    // record with neither gets a genuine draw at the published distribution,
    // exactly as a new account would.
    let rarity = record.rarity;
    let rarityRoll = record.rarityRoll ?? null;
    if (!rarity) {
      const drawn = rollRarity();
      rarity = drawn.rarity;
      rarityRoll = drawn.roll;
    }
    const tagCheck = validateTags(record.tags);

    const password = record.password ?? record.adoptedPassword;

    const row = {
      id,
      username: record.username,
      username_lower: lower,
      display_name: displayName.value ?? record.username,
      friend_code: friendCode,
      password_salt: password.salt,
      password_hash: password.hash,
      kdf: password.kdf ?? "scrypt",
      bio: bio.value ?? null,
      avatar: avatar.value ?? null,
      rarity,
      rarity_roll: rarityRoll,
      created_at: createdAt,
      last_seen_at: record.lastSeenAt ?? createdAt,
      private_account: record.privateAccount ? 1 : 0,
      role: record.role === "admin" ? "admin" : "user",
      tags: JSON.stringify(tagCheck.value ?? []),
    };

    rows.push(row);
    decisions.push({ action: "import", username: record.username, id, friendCode });
    seenIds.add(id);
    seenUsernames.add(lower);
    takenUsernames.add(lower);
    takenCodes.add(friendCode);
    if (record.sourceId) idMap.set(record.sourceId, id);
    stats.toImport += 1;
  }

  return { rows, decisions, stats, idMap };
}

/** A friend code the target does not hold yet. */
function allocateFriendCode(taken) {
  for (let attempt = 0; attempt < FRIEND_CODE_ATTEMPTS; attempt += 1) {
    const code = generateFriendCode();
    if (!taken.has(code)) return code;
  }
  throw new Error("Could not allocate a unique friend code.");
}

/* ------------------------------------------------------------------ apply */

/**
 * Inserts the planned rows. Returns nothing: the caller wraps this in the
 * store's transaction, so a failure anywhere rolls the whole run back.
 */
export function applyMigration(store, rows) {
  const available = new Set(tableColumns(store.db, "users"));
  const columns = USER_COLUMNS.filter((name) => available.has(name));
  const statement = store.db.prepare(
    `INSERT INTO users (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  );
  for (const row of rows) {
    statement.run(...columns.map((name) => row[name]));
  }
}

/* ------------------------------------------------------- associated data */

/**
 * Every table that belongs to an account and can travel with it.
 *
 * `users` is excluded (it *is* the migration) and `sessions` is excluded on
 * purpose: a session row is a browser's live credential, it expires anyway,
 * and copying it would only replay someone else's sign-in onto a machine that
 * never earned one. Everything else — the social graph, messages, posts,
 * comments, bookmarks, chat servers and store submissions — is what the
 * account owner would otherwise lose by moving host.
 */
export const RELATED_TABLES = [
  "friend_requests",
  "friendships",
  "conversations",
  "messages",
  "follows",
  "blocks",
  "posts",
  "post_likes",
  "comments",
  "comment_likes",
  "bookmarks",
  "notifications",
  "post_reports",
  "servers",
  "roles",
  "server_members",
  "channels",
  "server_messages",
  "invites",
  "server_audit",
  "store_submissions",
];

/**
 * Parents before children, derived from the schema rather than a hand-written
 * list, so a table added later still lands in a workable order.
 */
export function topologicalOrder(tables, source) {
  const inScope = new Set(tables);
  const dependencies = new Map(tables.map((table) => [table, new Set()]));
  for (const table of tables) {
    for (const fk of source.prepare(`PRAGMA foreign_key_list(${table})`).all()) {
      if (fk.table !== table && inScope.has(fk.table)) dependencies.get(table).add(fk.table);
    }
  }
  const ordered = [];
  const placed = new Set();
  const pending = [...tables];
  while (pending.length > 0) {
    const ready = pending.filter((table) =>
      [...dependencies.get(table)].every((dep) => placed.has(dep)),
    );
    // A cycle would mean the schema itself is recursive; fall back to the
    // original order and let the database tell us if that cannot work.
    if (ready.length === 0) return pending;
    for (const table of ready) {
      ordered.push(table);
      placed.add(table);
      pending.splice(pending.indexOf(table), 1);
    }
  }
  return ordered;
}

/**
 * Copies the associated data of the migrated accounts into `target`.
 *
 * Runs inside the caller's transaction, so it lands with the accounts or not
 * at all, and every insert is `INSERT OR IGNORE`, so rerunning the migration
 * cannot duplicate a row. A row is copied only when each account it references
 * was carried over; otherwise it is counted and left behind rather than
 * pointing at something that does not exist.
 */
export function copyRelatedData({ source, target, idMap, tables = RELATED_TABLES, dryRun = false }) {
  const sourceTables = new Set(tableNames(source));
  const targetTables = new Set(tableNames(target));
  const inScope = tables.filter((name) => sourceTables.has(name));
  const order = topologicalOrder(inScope, source);
  const stats = { copied: 0, ignored: 0, skipped: 0, perTable: {}, unavailable: [], dryRun };

  /*
   * Which columns other tables point at, so a dry run can answer "is this
   * parent present or about to be?" without inserting anything: an accepted
   * row registers its key under each column that is referenced.
   */
  const referencedColumns = new Map();
  for (const table of inScope) {
    for (const fk of source.prepare(`PRAGMA foreign_key_list(${table})`).all()) {
      if (fk.table === "users" || !inScope.includes(fk.table)) continue;
      const columns = referencedColumns.get(fk.table) ?? new Set();
      columns.add(fk.to);
      referencedColumns.set(fk.table, columns);
    }
  }
  const planned = new Map();

  for (const table of order) {
    if (!targetTables.has(table)) {
      stats.unavailable.push(table);
      continue;
    }
    const targetColumns = new Set(tableColumns(target, table));
    const columns = tableColumns(source, table).filter((name) => targetColumns.has(name));
    if (columns.length === 0) {
      stats.unavailable.push(table);
      continue;
    }
    const primaryKeys = tablePrimaryKeys(source, table).filter((name) => targetColumns.has(name));
    const presentLookup =
      dryRun && primaryKeys.length > 0
        ? target.prepare(
            `SELECT 1 AS present FROM "${table}" WHERE ${primaryKeys
              .map((name) => `"${name}" = ?`)
              .join(" AND ")}`,
          )
        : null;
    const foreignKeys = source.prepare(`PRAGMA foreign_key_list(${table})`).all();
    const rows = source
      .prepare(`SELECT ${columns.map((name) => `"${name}"`).join(", ")} FROM ${table}`)
      .all();
    const insert = target.prepare(
      `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${columns
        .map(() => "?")
        .join(", ")})`,
    );
    const parentLookups = new Map();

    let copied = 0;
    let ignored = 0;
    let skipped = 0;
    for (const row of rows) {
      let referenceable = true;
      for (const fk of foreignKeys) {
        const value = row[fk.from];
        if (value === null || value === undefined) continue;
        if (fk.table === "users") {
          if (!idMap.has(value)) {
            referenceable = false;
            break;
          }
          continue;
        }
        const key = `${fk.table}.${fk.to}`;
        if (dryRun && planned.get(key)?.has(String(value))) continue;
        let lookup = parentLookups.get(key);
        if (!lookup) {
          lookup = target.prepare(`SELECT 1 AS present FROM "${fk.table}" WHERE "${fk.to}" = ?`);
          parentLookups.set(key, lookup);
        }
        if (!lookup.get(value)) {
          referenceable = false;
          break;
        }
      }
      if (!referenceable) {
        skipped += 1;
        continue;
      }
      const referenced = referencedColumns.get(table);
      if (referenced) {
        for (const column of referenced) {
          const key = `${table}.${column}`;
          const values = planned.get(key) ?? new Set();
          values.add(String(row[column]));
          planned.set(key, values);
        }
      }
      if (dryRun) {
        const alreadyThere =
          presentLookup !== null &&
          presentLookup.get(...primaryKeys.map((name) => row[name])) !== undefined;
        if (alreadyThere) ignored += 1;
        else copied += 1;
        continue;
      }
      const result = insert.run(...columns.map((name) => row[name]));
      if (result.changes === 0) ignored += 1;
      else copied += 1;
    }

    stats.copied += copied;
    stats.ignored += ignored;
    stats.skipped += skipped;
    stats.perTable[table] = { copied, ignored, skipped };
  }
  return stats;
}

/**
 * A consistent snapshot of the target taken before the first write (VACUUM
 * INTO folds the WAL in, so the copy is a complete database, not just the
 * main file). This is the rollback: stop the backend, restore this file.
 * @returns {string | null} the backup path, or null when it could not be made
 */
export function backupTarget(store, { now = Date.now() } = {}) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const backup = `${store.file}.pre-migration-${stamp}.bak`;
  try {
    store.db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    return backup;
  } catch {
    try {
      copyFileSync(store.file, backup);
      return backup;
    } catch {
      return null;
    }
  }
}

/**
 * Confirms every imported account is in the target with its identity and
 * password material intact. Returns per-row booleans only — no value from the
 * database ever leaves this function as text.
 */
export function verifyImport(store, rows) {
  const failures = [];
  const read = store.db.prepare(
    "SELECT id, username_lower, friend_code, display_name, password_salt, password_hash FROM users WHERE id = ?",
  );
  for (const row of rows) {
    const found = read.get(row.id);
    if (!found) {
      failures.push({ username: row.username, problem: "missing after import" });
      continue;
    }
    if (found.username_lower !== row.username_lower) {
      failures.push({ username: row.username, problem: "username differs" });
      continue;
    }
    if (found.friend_code !== row.friend_code) {
      failures.push({ username: row.username, problem: "friend code differs" });
      continue;
    }
    if (found.password_salt !== row.password_salt || found.password_hash !== row.password_hash) {
      failures.push({ username: row.username, problem: "password material differs" });
    }
  }
  return { checked: rows.length, failures };
}

/* ------------------------------------------------------------------- run */

export const DEFAULT_TARGET = "server/accounts/data/accounts.db";

/**
 * Full migration: read → plan → (backup) → import → verify.
 * `stdout`/`stderr` make the summary testable and keep it out of the server
 * log. Nothing derived from a password is ever written to either.
 */
export async function migrate({
  from,
  to = process.env.CRESCENT_ACCOUNTS_DB ?? DEFAULT_TARGET,
  dryRun = false,
  adoptPasswordless = false,
  backup = true,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (!from) {
    stderr.write("migrate-accounts: --from <accounts.db|export.json> is required.\n");
    return { ok: false, problem: "no source" };
  }

  const source = resolve(from);
  const target = resolve(to);

  if (!existsSync(source)) {
    stderr.write(
      [
        "",
        `migrate-accounts: the source ${source} does not exist.`,
        "",
        "  · Migrating from a previous backend: copy that machine's",
        "      server/accounts/data/accounts.db",
        "    (plus any -wal/-shm files) here and pass it to --from.",
        "  · Migrating browser-local profiles: in the source browser, open the",
        "    CrystalOS origin, then F12 → Console →",
        '      copy(JSON.stringify(localStorage.getItem("crescent.accounts")))',
        "    and save that string to a .json file here.",
        "",
      ].join("\n"),
    );
    return { ok: false, problem: "source missing" };
  }

  const isSqlite = looksLikeSqlite(source);
  let sourceDb = null;
  let records;
  try {
    if (isSqlite) {
      sourceDb = openSourceDb(source);
      records = readSqliteUsers(sourceDb);
    } else {
      records = readJsonSource(source);
    }
  } catch (error) {
    sourceDb?.close();
    stderr.write(`migrate-accounts: ${error.message}\n`);
    return { ok: false, problem: "unreadable source" };
  }

  const normalised = records.map((record, index) => normaliseRecord(record, index));

  // Passwordless adoption needs a real hash, and hashing is async, so it
  // happens before the (synchronous) transaction opens.
  if (adoptPasswordless) {
    for (const record of normalised) {
      if (record.invalid || record.password) continue;
      const secret = randomBytes(32).toString("base64url");
      const material = await hashPassword(secret);
      record.adoptedPassword = { salt: material.salt, hash: material.hash, kdf: "scrypt" };
    }
  }

  const store = openAccountsStore({ file: to });
  let result;
  try {
    const plan = planMigration(normalised, store);
    /*
     * What the associated-data pass would do, decided before anything is
     * written: it is a dry run's report, and it tells a real run whether the
     * backup is needed at all (a rerun that would change nothing takes none).
     */
    const relatedPreview =
      sourceDb && plan.idMap.size > 0
        ? copyRelatedData({ source: sourceDb, target: store.db, idMap: plan.idMap, dryRun: true })
        : null;
    /* Accounts and their data move together: one transaction, or neither. */
    const runImport = () => {
      let related = null;
      store.transaction(() => {
        if (!dryRun) applyMigration(store, plan.rows);
        if (sourceDb && plan.idMap.size > 0) {
          related = copyRelatedData({
            source: sourceDb,
            target: store.db,
            idMap: plan.idMap,
            dryRun,
          });
        }
      });
      return related;
    };

    if (dryRun) {
      const related = runImport();
      stdout.write(summarise(plan.stats, plan.decisions, { dryRun: true, related }));
      return {
        ok: true,
        dryRun: true,
        ...plan.stats,
        rows: [],
        decisions: plan.decisions,
        related,
      };
    }

    let backupPath = null;
    const writesPlanned = plan.rows.length > 0 || (relatedPreview?.copied ?? 0) > 0;
    if (backup && writesPlanned) {
      backupPath = backupTarget(store);
      if (!backupPath) {
        stderr.write(
          "migrate-accounts: could not take a backup of the target; nothing was written.\n",
        );
        return { ok: false, problem: "backup failed" };
      }
    }

    const related = writesPlanned ? runImport() : relatedPreview;

    const verification = verifyImport(store, plan.rows);
    stdout.write(summarise(plan.stats, plan.decisions, { backupPath, verification, related }));
    if (verification.failures.length > 0) {
      stderr.write(
        `migrate-accounts: ${verification.failures.length} imported account(s) failed verification. ` +
          `Restore ${backupPath ?? "the backup"} and report this.\n`,
      );
      result = { ok: false, problem: "verification failed", ...plan.stats, backupPath, related };
    } else {
      result = {
        ok: true,
        ...plan.stats,
        backupPath,
        related,
        decisions: plan.decisions,
      };
    }
  } catch (error) {
    stderr.write(`migrate-accounts: ${error?.message ?? error}\n`);
    result = { ok: false, problem: String(error?.message ?? error) };
  } finally {
    sourceDb?.close();
    store.close();
  }
  return result;
}

/** The human summary. Usernames and counts only — never a hash, salt or token. */
export function summarise(
  stats,
  decisions = [],
  { dryRun = false, backupPath = null, verification = null, related = null } = {},
) {
  const lines = [];
  lines.push("");
  lines.push(dryRun ? "Migration DRY RUN (nothing written)" : "Migration summary");
  lines.push("-".repeat(52));
  lines.push(`  records discovered      ${stats.discovered}`);
  lines.push(`  imported                ${stats.toImport}`);
  lines.push(`  already present         ${stats.alreadyImported}`);
  const skippedTotal = Object.values(stats.skipped).reduce((sum, count) => sum + count, 0);
  lines.push(`  skipped                 ${skippedTotal}`);
  for (const [reason, count] of Object.entries(stats.skipped)) {
    lines.push(`      ${reason.padEnd(24)} ${count}`);
  }
  if (stats.regeneratedIds) lines.push(`  new ids assigned        ${stats.regeneratedIds}`);
  if (stats.regeneratedFriendCodes) lines.push(`  friend codes re-drawn   ${stats.regeneratedFriendCodes}`);
  if (stats.adoptedPasswords) lines.push(`  passwordless adopted    ${stats.adoptedPasswords} (cannot sign in until reset)`);
  if (stats.defaultedCreatedAt) lines.push(`  created-at defaulted    ${stats.defaultedCreatedAt}`);
  if (stats.droppedFields) lines.push(`  invalid fields dropped  ${stats.droppedFields}`);

  const skippedDetails = decisions.filter(
    (entry) => entry.action === "skip" && entry.reason !== "already_imported",
  );
  if (skippedDetails.length > 0) {
    lines.push("");
    lines.push("  Skipped records:");
    for (const entry of skippedDetails) {
      lines.push(`      ${entry.username} — ${entry.reason}${entry.detail ? ` (${entry.detail})` : ""}`);
    }
  }

  if (related) {
    lines.push("");
    lines.push(
      `  Associated data: ${related.copied} row(s) ${dryRun ? "would be " : ""}copied, ` +
        `${related.ignored} already present, ${related.skipped} left behind (owner not migrated)`,
    );
    for (const [table, entry] of Object.entries(related.perTable)) {
      if (entry.copied === 0 && entry.skipped === 0) continue;
      const note = entry.skipped > 0 ? ` (${entry.skipped} left behind)` : "";
      lines.push(`      ${table.padEnd(20)} +${entry.copied}${note}`);
    }
    if (related.unavailable.length > 0) {
      lines.push(`      not in target: ${related.unavailable.join(", ")}`);
    }
  }

  if (backupPath) {
    lines.push("");
    lines.push(`  Backup: ${backupPath}`);
    lines.push("  Rollback: stop the backend, restore that file over the target.");
  }
  if (verification) {
    lines.push("");
    lines.push(
      verification.failures.length === 0
        ? `  Verified: ${verification.checked} imported account(s) present with identity and password intact.`
        : `  VERIFICATION FAILED for ${verification.failures.length} account(s).`,
    );
    for (const failure of verification.failures) {
      lines.push(`      ${failure.username} — ${failure.problem}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/* ------------------------------------------------------------------- CLI */

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") options.dryRun = true;
    else if (token === "--adopt-passwordless") options.adoptPasswordless = true;
    else if (token === "--no-backup") options.backup = false;
    else if (token === "--from" || token === "--to") options[token.slice(2)] = argv[(index += 1)];
    else if (token === "--help" || token === "-h") options.help = true;
    else return { error: `Unknown argument: ${token}` };
  }
  return options;
}

const HELP = `
CrystalOS account migration

  node scripts/migrate-accounts.mjs --from <accounts.db|export.json> [options]

  --from <path>            source: a previous accounts SQLite file, or a JSON
                            export of browser-local profiles (required)
  --to <path>              target database (default: CRESCENT_ACCOUNTS_DB or
                            server/accounts/data/accounts.db)
  --dry-run                plan and validate everything, write nothing
  --adopt-passwordless     import records that carry no password with random,
                            unusable credentials (they need an admin reset)
  --no-backup              skip the pre-migration snapshot (not recommended)
  --help                   this text
`;

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const options = parseArgs(process.argv.slice(2));
  if (options.error) {
    process.stderr.write(`${options.error}\n${HELP}`);
    process.exit(1);
  }
  if (options.help || !options.from) {
    process.stdout.write(HELP);
    process.exit(options.help ? 0 : 1);
  }
  const result = await migrate(options);
  process.exit(result.ok ? 0 : 1);
}
