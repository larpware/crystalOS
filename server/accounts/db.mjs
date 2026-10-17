/*
 * CrystalOS — accounts database
 *
 * Storage is SQLite through Node's built-in `node:sqlite` (Node 22.5+), so a
 * real database with real constraints is one `import` away and the project
 * gains no dependency. Everything that must never be duplicated is enforced by
 * the schema itself:
 *
 *   users.username_lower        UNIQUE — one account per username
 *   users.friend_code           UNIQUE — one account per friend code
 *   friend_requests(from,to)    UNIQUE — one live request per direction
 *   friendships(user_a,user_b)  UNIQUE — one friendship per pair (canonical order)
 *   conversations(user_a,user_b) UNIQUE — one thread per pair (canonical order)
 *
 * `DatabaseSync` is synchronous, which is a feature here: there is no
 * interleaving between a uniqueness check and the write that follows it, and a
 * UNIQUE violation surfaces as a thrown error the caller can react to. The
 * friend-code retry loop in `createUser` relies on exactly that.
 *
 * The default database file lives under `server/accounts/data/` and is ignored
 * by version control; `CRESCENT_ACCOUNTS_DB` overrides it (used by the tests,
 * which run against a throwaway file in the OS temp directory).
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createId } from "./ids.mjs";
import { formatFriendCode, generateFriendCode } from "./codes.mjs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS friend_requests (
  id           TEXT PRIMARY KEY,
  from_user    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  responded_at INTEGER,
  UNIQUE (from_user, to_user)
);
CREATE INDEX IF NOT EXISTS friend_requests_to ON friend_requests(to_user, status);

CREATE TABLE IF NOT EXISTS friendships (
  id         TEXT PRIMARY KEY,
  user_a     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE (user_a, user_b)
);
CREATE INDEX IF NOT EXISTS friendships_a ON friendships(user_a);
CREATE INDEX IF NOT EXISTS friendships_b ON friendships(user_b);

CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  user_a     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  author_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  sent_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, sent_at);
`;

/** Thrown when a UNIQUE constraint fires for a column the caller must handle. */
export class UsernameTakenError extends Error {
  constructor() {
    super("That username is already taken.");
    this.name = "UsernameTakenError";
    this.code = "USERNAME_TAKEN";
  }
}

const FRIEND_CODE_ATTEMPTS = 8;

function uniqueViolation(error, column) {
  const message = String(error?.message ?? "");
  return message.includes("UNIQUE constraint failed") && message.includes(column);
}

/** Canonical pair ordering, so (a,b) and (b,a) are the same row. */
export function orderedPair(first, second) {
  return first < second ? [first, second] : [second, first];
}

/** Conversation/channel id shared by both participants. */
export function conversationIdFor(first, second) {
  const [a, b] = orderedPair(first, second);
  return `dm_${a}__${b}`;
}

/** How recently a user must have been seen to count as online. */
export const PRESENCE_WINDOW_MS = 60_000;

/** The public shape of an account. Never contains a hash, salt or session. */
export function publicUser(row, now = Date.now()) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    friendCode: formatFriendCode(row.friend_code),
    bio: row.bio ?? undefined,
    avatar: row.avatar ?? undefined,
    createdAt: row.created_at,
    online: row.last_seen_at > now - PRESENCE_WINDOW_MS,
    lastSeenAt: row.last_seen_at,
  };
}

/**
 * Opens (and migrates) the accounts database.
 * @param {{ file?: string }} [options]
 */
export function openAccountsStore(options = {}) {
  const file = resolve(
    process.cwd(),
    options.file ?? process.env.CRESCENT_ACCOUNTS_DB ?? "server/accounts/data/accounts.db",
  );
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);

  /** Runs `fn` inside a transaction; rolls back if it throws. */
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* already unwound */
      }
      throw error;
    }
  }

  const store = {
    db,
    file,
    transaction,
    close: () => db.close(),

    /* ---- users -------------------------------------------------------- */

    /**
     * Inserts a user, generating the friend code server-side. A friend-code
     * collision is retried with a brand new code; a username collision is
     * surfaced to the caller as `UsernameTakenError`.
     */
    createUser({ username, displayName, passwordSalt, passwordHash, bio, avatar, createdAt }) {
      const id = createId("usr");
      for (let attempt = 0; attempt < FRIEND_CODE_ATTEMPTS; attempt += 1) {
        const friendCode = generateFriendCode();
        try {
          db.prepare(
            `INSERT INTO users
               (id, username, username_lower, display_name, friend_code,
                password_salt, password_hash, bio, avatar, created_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            username,
            username.toLowerCase(),
            displayName,
            friendCode,
            passwordSalt,
            passwordHash,
            bio ?? null,
            avatar ?? null,
            createdAt,
            createdAt,
          );
          return store.userById(id);
        } catch (error) {
          if (uniqueViolation(error, "username_lower")) throw new UsernameTakenError();
          if (uniqueViolation(error, "friend_code")) continue;
          throw error;
        }
      }
      throw new Error("Could not allocate a unique friend code.");
    },

    userById: (id) => db.prepare("SELECT * FROM users WHERE id = ?").get(id) ?? null,
    userByUsername: (username) =>
      db.prepare("SELECT * FROM users WHERE username_lower = ?").get(username.toLowerCase()) ??
      null,
    /** `canonicalCode` is the normalised form from `normalizeFriendCode`. */
    userByFriendCode: (canonicalCode) =>
      db.prepare("SELECT * FROM users WHERE friend_code = ?").get(canonicalCode) ?? null,
    countUsers: () => Number(db.prepare("SELECT COUNT(*) AS n FROM users").get().n),

    /** Only these fields are writable; friend codes and ids never are. */
    updateUser(id, patch) {
      const fields = [];
      const values = [];
      if (patch.username !== undefined) {
        fields.push("username = ?", "username_lower = ?");
        values.push(patch.username, patch.username.toLowerCase());
      }
      if (patch.displayName !== undefined) {
        fields.push("display_name = ?");
        values.push(patch.displayName);
      }
      if (patch.bio !== undefined) {
        fields.push("bio = ?");
        values.push(patch.bio ?? null);
      }
      if (patch.avatar !== undefined) {
        fields.push("avatar = ?");
        values.push(patch.avatar ?? null);
      }
      if (fields.length === 0) return store.userById(id);
      values.push(id);
      try {
        db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
      } catch (error) {
        if (uniqueViolation(error, "username_lower")) throw new UsernameTakenError();
        throw error;
      }
      return store.userById(id);
    },

    updatePassword: (id, salt, hash) =>
      db
        .prepare("UPDATE users SET password_salt = ?, password_hash = ?, kdf = 'scrypt' WHERE id = ?")
        .run(salt, hash, id),

    touchUser: (id, at) => db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(at, id),

    /** Deleting a user cascades to sessions, requests, friendships, messages. */
    deleteUser: (id) => db.prepare("DELETE FROM users WHERE id = ?").run(id),

    /* ---- sessions ----------------------------------------------------- */

    /** `tokenHash` — the raw token is never stored, only its digest. */
    createSession({ tokenHash, userId, createdAt, expiresAt }) {
      db.prepare(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      ).run(tokenHash, userId, createdAt, expiresAt);
    },
    sessionByTokenHash: (tokenHash) =>
      db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash) ?? null,
    deleteSession: (tokenHash) => db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash),
    deleteSessionsForUser: (userId) => db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId),
    pruneSessions: (now) => db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now),

    /* ---- friend requests ---------------------------------------------- */

    requestBetween: (fromId, toId) =>
      db
        .prepare("SELECT * FROM friend_requests WHERE from_user = ? AND to_user = ?")
        .get(fromId, toId) ?? null,
    requestById: (id) => db.prepare("SELECT * FROM friend_requests WHERE id = ?").get(id) ?? null,

    /** Inserts a pending request, or flips a previous decline/cancel back to pending. */
    upsertPendingRequest({ id, fromId, toId, at }) {
      db.prepare(
        `INSERT INTO friend_requests (id, from_user, to_user, status, created_at, responded_at)
         VALUES (?, ?, ?, 'pending', ?, NULL)
         ON CONFLICT (from_user, to_user)
         DO UPDATE SET status = 'pending', created_at = excluded.created_at, responded_at = NULL`,
      ).run(id, fromId, toId, at);
      return store.requestBetween(fromId, toId);
    },
    setRequestStatus: (id, status, at) =>
      db
        .prepare("UPDATE friend_requests SET status = ?, responded_at = ? WHERE id = ?")
        .run(status, at, id),
    deleteRequest: (id) => db.prepare("DELETE FROM friend_requests WHERE id = ?").run(id),
    deleteRequestsBetween: (first, second) =>
      db
        .prepare(
          `DELETE FROM friend_requests
           WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)`,
        )
        .run(first, second, second, first),

    incomingRequests: (userId) =>
      db
        .prepare(
          `SELECT r.id AS request_id, r.created_at AS request_created_at, u.*
             FROM friend_requests r
             JOIN users u ON u.id = r.from_user
            WHERE r.to_user = ? AND r.status = 'pending'
            ORDER BY r.created_at DESC`,
        )
        .all(userId),
    outgoingRequests: (userId) =>
      db
        .prepare(
          `SELECT r.id AS request_id, r.status AS request_status, r.created_at AS request_created_at, u.*
             FROM friend_requests r
             JOIN users u ON u.id = r.to_user
            WHERE r.from_user = ?
            ORDER BY r.created_at DESC`,
        )
        .all(userId),
    /** Housekeeping: drop requests that were answered more than a day ago. */
    pruneRespondedRequests: (before) =>
      db
        .prepare("DELETE FROM friend_requests WHERE status <> 'pending' AND responded_at <= ?")
        .run(before),

    /* ---- friendships -------------------------------------------------- */

    friendshipBetween(first, second) {
      const [a, b] = orderedPair(first, second);
      return db.prepare("SELECT * FROM friendships WHERE user_a = ? AND user_b = ?").get(a, b) ?? null;
    },
    areFriends(first, second) {
      return store.friendshipBetween(first, second) !== null;
    },
    addFriendship(first, second, at) {
      const [a, b] = orderedPair(first, second);
      db.prepare(
        `INSERT INTO friendships (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_a, user_b) DO NOTHING`,
      ).run(createId("frn"), a, b, at);
      return store.friendshipBetween(a, b);
    },
    removeFriendship(first, second) {
      const [a, b] = orderedPair(first, second);
      return db.prepare("DELETE FROM friendships WHERE user_a = ? AND user_b = ?").run(a, b);
    },
    friendsOf(userId, now = Date.now()) {
      const rows = db
        .prepare(
          `SELECT f.created_at AS friends_since, u.*
             FROM friendships f
             JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
            WHERE f.user_a = ? OR f.user_b = ?
            ORDER BY u.display_name COLLATE NOCASE ASC`,
        )
        .all(userId, userId, userId);
      return rows.map((row) => ({
        ...publicUser(row, now),
        friendsSince: Number(row.friends_since),
      }));
    },

    /* ---- conversations + messages ------------------------------------- */

    ensureConversation(first, second, at) {
      const [a, b] = orderedPair(first, second);
      const id = conversationIdFor(a, b);
      db.prepare(
        `INSERT INTO conversations (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_a, user_b) DO NOTHING`,
      ).run(id, a, b, at);
      return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    },
    conversationFor(first, second) {
      const [a, b] = orderedPair(first, second);
      return (
        db.prepare("SELECT * FROM conversations WHERE user_a = ? AND user_b = ?").get(a, b) ?? null
      );
    },

    /**
     * Idempotent on the client-supplied id, so a retried send cannot duplicate
     * a message. Returns the stored row.
     */
    insertMessage({ id, conversationId, authorId, body, sentAt }) {
      db.prepare(
        `INSERT OR IGNORE INTO messages (id, conversation_id, author_id, body, sent_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(id, conversationId, authorId, body, sentAt);
      return db.prepare("SELECT * FROM messages WHERE id = ?").get(id) ?? null;
    },

    messagesInConversation(conversationId, { before = Number.MAX_SAFE_INTEGER, limit = 100 } = {}) {
      const rows = db
        .prepare(
          `SELECT * FROM messages
            WHERE conversation_id = ? AND sent_at <= ?
            ORDER BY sent_at DESC, rowid DESC LIMIT ?`,
        )
        .all(conversationId, before, limit);
      return rows.reverse();
    },

    /** Every message addressed to `userId` newer than `since`, oldest first. */
    newMessagesForUser(userId, since, limit = 200) {
      return db
        .prepare(
          `SELECT m.*, c.user_a, c.user_b
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
            WHERE (c.user_a = ? OR c.user_b = ?)
              AND m.author_id <> ?
              AND m.sent_at > ?
            ORDER BY m.sent_at ASC, m.rowid ASC
            LIMIT ?`,
        )
        .all(userId, userId, userId, since, limit);
    },

    messageCountFor(userId) {
      return Number(
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM messages m
               JOIN conversations c ON c.id = m.conversation_id
              WHERE c.user_a = ? OR c.user_b = ?`,
          )
          .get(userId, userId).n,
      );
    },
  };

  return store;
}
