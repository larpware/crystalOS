/*
 * Server-side id generation. Ids are random and opaque; they carry no user
 * data and are never accepted from the client (the client may propose a
 * message id, and it is validated before use).
 */

import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function createId(prefix = "id") {
  const bytes = randomBytes(10);
  let random = "";
  for (const byte of bytes) random += ALPHABET[byte % ALPHABET.length];
  return `${prefix}_${Date.now().toString(36)}${random}`;
}
