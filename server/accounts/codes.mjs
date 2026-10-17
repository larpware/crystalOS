/*
 * CrystalOS — friend code generation
 *
 * Friend codes are generated here, on the server, from the OS CSPRNG. Nothing
 * in the client can influence them: there is no endpoint that accepts a code,
 * and the only value the database will ever store is one this module produced.
 *
 * Format: `CR-7K4M-9Q2X`
 *
 *   - the `CR` prefix makes a shared code recognisable as a CrystalOS code;
 *   - the remaining eight characters are random over a 31-symbol alphabet
 *     that omits 0/O/1/I/L, so a code read aloud or copied by hand is
 *     unambiguous. 31^8 ≈ 8.5e11 ≈ 2^39.6 combinations;
 *   - the stored form is canonical (no dashes, upper case): `CR7K4M9Q2X`.
 *     Dashes are purely presentational, which is why input normalisation can
 *     accept `cr 7k4m 9q2x` or `CR-7K4M-9Q2X` and still match exactly one row.
 */

import { randomInt } from "node:crypto";

export const FRIEND_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const FRIEND_CODE_PREFIX = "CR";
export const FRIEND_CODE_BODY_LENGTH = 8;
export const FRIEND_CODE_GROUPS = [4, 4];

/** Canonical (storage + comparison) form of a friend code. */
const CANONICAL_PATTERN = new RegExp(
  `^${FRIEND_CODE_PREFIX}[${FRIEND_CODE_ALPHABET}]{${FRIEND_CODE_BODY_LENGTH}}$`,
);

/**
 * A fresh random code. Uniqueness is enforced by the `users.friend_code`
 * UNIQUE constraint; callers retry on a collision (see `openAccountsStore`).
 */
export function generateFriendCode() {
  let body = "";
  for (let index = 0; index < FRIEND_CODE_BODY_LENGTH; index += 1) {
    body += FRIEND_CODE_ALPHABET[randomInt(FRIEND_CODE_ALPHABET.length)];
  }
  return FRIEND_CODE_PREFIX + body;
}

/**
 * Normalises whatever the user typed into the canonical stored form:
 * strips separators and whitespace, upper-cases, and drops anything else.
 * Normalising never changes the stored code — it only changes the lookup key.
 */
export function normalizeFriendCode(input) {
  return String(input ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** True when a *normalised* value has the shape of a real friend code. */
export function isWellFormedFriendCode(canonical) {
  return CANONICAL_PATTERN.test(canonical);
}

/** Canonical → display form. `CR7K4M9Q2X` → `CR-7K4M-9Q2X`. */
export function formatFriendCode(canonical) {
  if (!isWellFormedFriendCode(canonical)) return String(canonical ?? "");
  let rest = canonical.slice(FRIEND_CODE_PREFIX.length);
  const groups = [];
  for (const size of FRIEND_CODE_GROUPS) {
    groups.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  return `${FRIEND_CODE_PREFIX}-${groups.join("-")}`;
}
