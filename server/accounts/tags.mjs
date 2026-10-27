/*
 * CrystalOS — account tags
 *
 * Small labels that ride beside a display name everywhere a user appears:
 * profiles, feeds, member lists, message authors. The owner decides who wears
 * which tag (see the admin route in api.mjs); nothing here grants authority by
 * itself — tags are presentation, and moderation power stays in `users.role`.
 *
 * Lives in its own module so db.mjs, social.mjs and servers.mjs can all read
 * tags without importing each other (db.mjs already imports the other two, so
 * anything they needed from it would be circular).
 */

/** Longest tag, in characters. Tags read as labels, not prose. */
export const TAG_MAX_LENGTH = 16;

/** Most tags one account can wear at once. */
export const TAG_MAX_COUNT = 3;

const TAG_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Parses a stored tag list; anything unreadable counts as "no tags". */
export function parseTags(rawValue) {
  try {
    const parsed = JSON.parse(String(rawValue ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

/** A user row's tags, or `[]`. */
export function tagsOf(row) {
  return parseTags(row?.tags);
}

/**
 * Validates a replacement tag list for one account: a short array of lowercase
 * slugs, deduplicated, at most `TAG_MAX_COUNT`. Returns `{ value }` ready to
 * store, or `{ error }` in the style of the other validators.
 */
export function validateTags(value) {
  if (!Array.isArray(value)) return { error: "Tags are a list." };
  const tags = [];
  for (const raw of value) {
    if (typeof raw !== "string") return { error: "Every tag needs to be text." };
    const tag = raw.trim().toLowerCase();
    if (!tag) return { error: "Tags cannot be empty." };
    if (tag.length > TAG_MAX_LENGTH) {
      return { error: `Tags are limited to ${TAG_MAX_LENGTH} characters.` };
    }
    if (!TAG_PATTERN.test(tag)) {
      return { error: "Tags are lowercase words, dashes allowed." };
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > TAG_MAX_COUNT) {
    return { error: `Accounts wear at most ${TAG_MAX_COUNT} tags.` };
  }
  return { value: tags };
}
