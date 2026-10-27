/*
 * CrystalOS — account security primitives
 *
 * Passwords are hashed with scrypt (Node's built-in KDF) using a per-account
 * 16-byte random salt. Plaintext is never written anywhere, including logs.
 * Sessions are opaque 32-byte random tokens; the database only stores the
 * SHA-256 digest, so a copy of the database cannot be replayed as a session.
 *
 * Every value that reaches the database passes through the validators here,
 * and every validator is applied server-side regardless of what the client
 * already checked.
 */

import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

/* scrypt cost. 16 MiB and ~40 ms per hash on a normal machine — high enough to
   make offline guessing expensive, low enough to keep sign-in snappy. */
const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
export const DISPLAY_NAME_MAX = 40;
export const BIO_MAX = 200;
export const MESSAGE_MAX = 2000;
export const POST_MAX = 4000;
export const COMMENT_MAX = 1500;
export const POST_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const REPORT_REASON_MAX = 500;
export const AVATAR_MAX_BYTES = 512 * 1024;
const AVATAR_PATTERN = /^data:image\/(png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/;
const POST_IMAGE_PATTERN = /^data:image\/(png|jpe?g|webp|gif|avif);base64,[A-Za-z0-9+/=]+$/;

export const SESSION_COOKIE = "crescent_session";
export const SESSION_TOKEN_BYTES = 32;

/* ------------------------------------------------------------------ input */

/** Strips control characters so nothing but text is ever stored or echoed. */
export function cleanText(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

/**
 * Names held for the project owner. Checked case-insensitively against both
 * usernames and display names, at registration and at every later rename, so
 * the identity cannot be borrowed, re-registered or cosplayed by spelling
 * around it. Display names may otherwise duplicate freely.
 */
export const RESERVED_NAMES = new Set(["kiyaan"]);

function isReservedName(value) {
  return RESERVED_NAMES.has(String(value ?? "").trim().toLowerCase());
}

function stringField(value) {
  return typeof value === "string" ? value : null;
}

export function validateUsername(value) {
  const username = stringField(value)?.trim() ?? "";
  if (!username) return { error: "Enter a username." };
  if (username.length < USERNAME_MIN) return { error: "Usernames need at least 3 characters." };
  if (username.length > USERNAME_MAX) return { error: "Usernames are limited to 20 characters." };
  if (!USERNAME_PATTERN.test(username)) {
    return { error: "Use letters, numbers, dot, dash or underscore only." };
  }
  if (isReservedName(username)) {
    return { error: "That username is reserved for the project owner." };
  }
  return { value: username };
}

export function validatePassword(value) {
  const password = stringField(value);
  if (password === null) return { error: "Enter a password." };
  if (password.length < PASSWORD_MIN) {
    return { error: `Passwords need at least ${PASSWORD_MIN} characters.` };
  }
  if (password.length > PASSWORD_MAX) return { error: "That password is too long." };
  return { value: password };
}

/** Falls back to the username when no display name was supplied. */
export function validateDisplayName(value, fallback) {
  const raw = cleanText(stringField(value) ?? "").trim();
  if (!raw) return { value: fallback };
  if (raw.length > DISPLAY_NAME_MAX) {
    return { error: `Display names are limited to ${DISPLAY_NAME_MAX} characters.` };
  }
  if (isReservedName(raw)) {
    return { error: "That display name is reserved for the project owner." };
  }
  return { value: raw };
}

export function validateBio(value) {
  const raw = cleanText(stringField(value) ?? "").trim();
  if (raw.length > BIO_MAX) return { error: `Bios are limited to ${BIO_MAX} characters.` };
  return { value: raw };
}

export function validateAvatar(value) {
  if (value === null || value === undefined || value === "") return { value: null };
  const raw = stringField(value);
  if (raw === null) return { error: "That avatar could not be read." };
  if (raw.length > AVATAR_MAX_BYTES) return { error: "That image is larger than 512 KB." };
  if (!AVATAR_PATTERN.test(raw)) return { error: "Avatars must be a PNG, JPEG, WebP, GIF or AVIF image." };
  return { value: raw };
}

export function validateMessageBody(value) {
  const body = cleanText(stringField(value) ?? "").trim();
  if (!body) return { error: "Messages cannot be empty." };
  if (body.length > MESSAGE_MAX) return { error: `Messages are limited to ${MESSAGE_MAX} characters.` };
  return { value: body };
}

/** A social post: text required, image optional and strictly validated. */
export function validatePostBody(value) {
  const body = cleanText(stringField(value) ?? "").trim();
  if (!body) return { error: "A post needs some text." };
  if (body.length > POST_MAX) return { error: `Posts are limited to ${POST_MAX} characters.` };
  return { value: body };
}

export function validateCommentBody(value) {
  const body = cleanText(stringField(value) ?? "").trim();
  if (!body) return { error: "Comments cannot be empty." };
  if (body.length > COMMENT_MAX) return { error: `Comments are limited to ${COMMENT_MAX} characters.` };
  return { value: body };
}

export function validatePostImage(value) {
  if (value === null || value === undefined || value === "") return { value: null };
  const raw = stringField(value);
  if (raw === null) return { error: "That image could not be read." };
  if (raw.length > POST_IMAGE_MAX_BYTES) {
    return { error: "Post images are limited to 2 MB. Try a smaller picture." };
  }
  if (!POST_IMAGE_PATTERN.test(raw)) {
    return { error: "Post images must be a PNG, JPEG, WebP, GIF or AVIF data URL." };
  }
  return { value: raw };
}

export function validateReportReason(value) {
  const reason = cleanText(stringField(value) ?? "").trim();
  if (!reason) return { error: "Say why you are reporting this." };
  if (reason.length > REPORT_REASON_MAX) {
    return { error: `Report reasons are limited to ${REPORT_REASON_MAX} characters.` };
  }
  return { value: reason };
}

/* ---- Store submissions --------------------------------------------------

   A submission proposes a web application for the catalogue. The URL is the
   only thing that ever "runs", and only inside the Browser, so it is held to
   the same http(s)-only rule the Browser itself enforces.
   ------------------------------------------------------------------------ */

export function validateSubmission(value) {
  const input = value && typeof value === "object" ? value : {};
  const name = cleanText(stringField(input.name) ?? "").trim();
  if (name.length < 2) return { error: "The application needs a name of at least 2 characters." };
  if (name.length > 60) return { error: "Application names are limited to 60 characters." };

  const description = cleanText(stringField(input.description) ?? "").trim();
  if (description.length < 10) {
    return { error: "Describe the application in at least 10 characters." };
  }
  if (description.length > 500) {
    return { error: "Descriptions are limited to 500 characters." };
  }

  const category = String(input.category ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(category)) {
    return { error: "Pick a category like 'games' or 'productivity'." };
  }

  const url = String(input.url ?? "").trim();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: "The application needs a valid URL." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "Only http(s) applications can be listed." };
  }
  if (url.length > 300) return { error: "URLs are limited to 300 characters." };

  return { value: { name, description, category, url } };
}

export function validateReview(value) {
  const input = value && typeof value === "object" ? value : {};
  const action = String(input.action ?? "").trim();
  if (action !== "approve" && action !== "reject") {
    return { error: "Review decisions are approve or reject." };
  }
  const note = cleanText(stringField(input.note) ?? "").trim();
  if (note.length > 500) return { error: "Review notes are limited to 500 characters." };
  return { value: { action, note: note || null } };
}

/** Client-proposed message ids are accepted only in a narrow, safe shape. */
export function validateMessageId(value) {
  const id = stringField(value)?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return { value: null };
  return { value: id };
}

/* --------------------------------------------------------------- password */

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("base64");
  const derived = await scryptAsync(password, salt, SCRYPT.keylen, SCRYPT);
  return { salt, hash: Buffer.from(derived).toString("base64") };
}

export async function verifyPassword(password, salt, expectedHash) {
  if (typeof password !== "string" || typeof salt !== "string" || typeof expectedHash !== "string") {
    return false;
  }
  const derived = await scryptAsync(password, salt, SCRYPT.keylen, SCRYPT);
  const actual = Buffer.from(derived);
  const expected = Buffer.from(expectedHash, "base64");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/* ---------------------------------------------------------------- sessions */

export function createSessionToken() {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

/* ----------------------------------------------------------------- cookies */

export function parseCookies(header) {
  const jar = {};
  for (const part of String(header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    jar[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

export function serializeCookie(name, value, { maxAge, secure, clear, sameSite = "Lax" } = {}) {
  const parts = [`${name}=${clear ? "" : encodeURIComponent(value)}`, "Path=/", "HttpOnly", `SameSite=${sameSite}`];
  if (clear) parts.push("Max-Age=0");
  else if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/* -------------------------------------------------------------- rate limit */

/**
 * Fixed-window limiter, keyed by client address + route. In-process by design:
 * this build runs a single account server, and the limiter's job is to stop
 * scripted account/friend-request abuse, not to be a distributed quota.
 */
export function createRateLimiter({ windowMs, max }) {
  const buckets = new Map();

  function take(key, now = Date.now()) {
    const bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, remaining: max - 1 };
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    return { ok: true, remaining: max - bucket.count };
  }

  return {
    take,
    /** Drops expired buckets; called opportunistically to bound memory. */
    sweep(now = Date.now()) {
      for (const [key, bucket] of buckets) if (now >= bucket.resetAt) buckets.delete(key);
    },
    size: () => buckets.size,
  };
}
