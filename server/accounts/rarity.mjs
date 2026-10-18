/*
 * CrystalOS — friend-code rarity
 *
 * A friend code is drawn once, when the account is created, and never again.
 * The code is immutable (the API rejects any request that carries a
 * `friendCode` field, and no store method writes the column) and the rarity
 * travels with the code, so the only way to see a second draw is to delete the
 * account — which requires the password, destroys the account's data, and is
 * rate limited like any other sign-up. There is deliberately no "roll again"
 * route: a re-roll button would make the published percentages meaningless,
 * because a user could sample until they got the tier they wanted.
 *
 * The draw is over `weight` integer tenths of a percent rather than
 * floating-point percentages. `randomInt(0, 1000)` is uniform over 0..999 and
 * each tier owns a disjoint slice of that range, so the number a tier
 * advertises is exactly the number generated. A float table can sum to
 * 99.999999% and silently mis-state the distribution; this one cannot — the
 * test suite asserts the weights total exactly 1000 and that repeated draws
 * land where the table says.
 *
 * Rarity is cosmetic. It grants nothing: not permissions, not moderation
 * rights, not account privileges. Those all live in the session and the
 * friendship tables, which never read this module.
 */

import { randomInt } from "node:crypto";

/**
 * Every tier, ordered lowest → highest. `weight` is in tenths of a percent:
 * 600 = 60%, 9 = 0.9%, 1 = 0.1%. The total must stay at 1000.
 */
export const RARITY_TIERS = [
  {
    id: "basic",
    name: "Basic",
    weight: 600,
    description: "The everyday draw. Most codes land here, which is what makes the higher tiers mean anything.",
  },
  {
    id: "uncommon",
    name: "Uncommon",
    weight: 220,
    description: "A little colour on the profile. Common enough to feel normal, rare enough to notice.",
  },
  {
    id: "rare",
    name: "Rare",
    weight: 100,
    description: "Roughly one code in ten. Carries a quiet accent on the profile card.",
  },
  {
    id: "epic",
    name: "Epic",
    weight: 50,
    description: "One in twenty. The profile card picks up a moving sheen, muted under reduced motion.",
  },
  {
    id: "legendary",
    name: "Legendary",
    weight: 20,
    description: "One in fifty. A warm halo and a distinctive badge on your own profile.",
  },
  {
    id: "prismatic",
    name: "Prismatic",
    weight: 9,
    description: "Nine in a thousand. A slow, shifting gradient rather than a single colour.",
  },
  {
    id: "transcendent",
    name: "Transcendent",
    weight: 1,
    description: "One in a thousand. The rarest draw the generator can produce.",
  },
];

/** Tenths of a percent across all tiers. Must be exactly 1000. */
export const RARITY_TOTAL_WEIGHT = RARITY_TIERS.reduce((total, tier) => total + tier.weight, 0);

export const RARITY_IDS = RARITY_TIERS.map((tier) => tier.id);

export function isRarityId(value) {
  return typeof value === "string" && RARITY_IDS.includes(value);
}

export function rarityTier(id) {
  return RARITY_TIERS.find((tier) => tier.id === id) ?? null;
}

/**
 * Maps a roll in `0..RARITY_TOTAL_WEIGHT-1` to a tier. Tiers are walked lowest
 * first and each claims the next `weight` values, so the slices tile the range
 * with no gap and no overlap.
 */
export function rarityForRoll(roll) {
  let cursor = 0;
  for (const tier of RARITY_TIERS) {
    cursor += tier.weight;
    if (roll < cursor) return tier;
  }
  return RARITY_TIERS[RARITY_TIERS.length - 1];
}

/**
 * Draws a rarity. `random` is injectable so the tests can drive the draw from a
 * known sequence; it must behave like `crypto.randomInt(min, max)` — uniform
 * over `[min, max)`.
 */
export function rollRarity(random = randomInt) {
  const roll = Math.max(0, Math.min(RARITY_TOTAL_WEIGHT - 1, random(0, RARITY_TOTAL_WEIGHT)));
  return { rarity: rarityForRoll(roll).id, roll };
}

/**
 * The published table. This is the single source the rarity guide renders, so
 * the percentages a user reads are the ones the generator uses — there is no
 * second, hand-written copy to drift out of date.
 */
export function rarityGuide() {
  return {
    total: RARITY_TOTAL_WEIGHT,
    tiers: RARITY_TIERS.map((tier) => ({
      id: tier.id,
      name: tier.name,
      percent: tier.weight / 10,
      weight: tier.weight,
      description: tier.description,
    })),
  };
}
