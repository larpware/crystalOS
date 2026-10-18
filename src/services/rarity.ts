/* ==========================================================================
   CrystalOS — friend-code rarity (client)

   Rarity is decided once, on the server, when the account is created; nothing
   in this file can influence which tier an account gets. What lives here is
   presentation and one thing that must not be faked: the odds.

   The guide is fetched from `/api/accounts/rarities`, which is generated from
   the same table the draw uses. `RARITY_FALLBACK` below is a mirror of that
   table for the two cases where the server cannot be reached — a signed-out
   user reading the guide, or an offline desktop. It is a mirror, not a second
   source of truth, and `rarity.test.mjs` imports both this file and the server
   module and fails if they ever disagree, so the percentages a user reads can
   never drift from the percentages the generator uses.
   ========================================================================== */

import { apiRequest } from "./api";
import type { RarityId } from "@/types";

export interface RarityTier {
  id: RarityId;
  name: string;
  /** Share of accounts in this tier, as a percentage. 0.1 means one in a thousand. */
  percent: number;
  /** The same share in tenths of a percent — the integer the draw actually uses. */
  weight: number;
  description: string;
}

export interface RarityGuide {
  total: number;
  tiers: RarityTier[];
  /**
   * True when the table came from the live server. False when this build is
   * showing its mirror because the account server could not be reached — the
   * UI says which, rather than presenting a copy as if it were the live one.
   */
  live: boolean;
}

export const RARITY_TOTAL_WEIGHT = 1000;

/**
 * Mirror of `server/accounts/rarity.mjs`. Keep in step with that file; the test
 * in `rarity.test.mjs` enforces it.
 */
export const RARITY_FALLBACK: RarityTier[] = [
  {
    id: "basic",
    name: "Basic",
    percent: 60,
    weight: 600,
    description: "The everyday draw. Most codes land here, which is what makes the higher tiers mean anything.",
  },
  {
    id: "uncommon",
    name: "Uncommon",
    percent: 22,
    weight: 220,
    description: "A little colour on the profile. Common enough to feel normal, rare enough to notice.",
  },
  {
    id: "rare",
    name: "Rare",
    percent: 10,
    weight: 100,
    description: "Roughly one code in ten. Carries a quiet accent on the profile card.",
  },
  {
    id: "epic",
    name: "Epic",
    percent: 5,
    weight: 50,
    description: "One in twenty. The profile card picks up a moving sheen, muted under reduced motion.",
  },
  {
    id: "legendary",
    name: "Legendary",
    percent: 2,
    weight: 20,
    description: "One in fifty. A warm halo and a distinctive badge on your own profile.",
  },
  {
    id: "prismatic",
    name: "Prismatic",
    percent: 0.9,
    weight: 9,
    description: "Nine in a thousand. A slow, shifting gradient rather than a single colour.",
  },
  {
    id: "transcendent",
    name: "Transcendent",
    percent: 0.1,
    weight: 1,
    description: "One in a thousand. The rarest draw the generator can produce.",
  },
];

const RARITY_ID_SET = new Set<string>(RARITY_FALLBACK.map((tier) => tier.id));

export const RARITY_IDS = RARITY_FALLBACK.map((tier) => tier.id);

export function isRarityId(value: unknown): value is RarityId {
  return typeof value === "string" && RARITY_ID_SET.has(value);
}

export function rarityTier(id: string | undefined): RarityTier | null {
  if (!id) return null;
  return RARITY_FALLBACK.find((tier) => tier.id === id) ?? null;
}

export function rarityName(id: string | undefined): string | null {
  return rarityTier(id)?.name ?? null;
}

/**
 * Position in the tier order, so callers can sort or compare without repeating
 * the order. Unknown rarities sort below Basic rather than throwing.
 */
export function rarityRank(id: string | undefined): number {
  const index = RARITY_FALLBACK.findIndex((tier) => tier.id === id);
  return index === -1 ? -1 : index;
}

/** Newest lookup, cached for the session so the guide is one request, not one per render. */
let cached: RarityGuide | null = null;

/** The mirror, shaped like a guide. Used offline and before the first fetch. */
export function fallbackGuide(): RarityGuide {
  return { total: RARITY_TOTAL_WEIGHT, tiers: RARITY_FALLBACK, live: false };
}

/**
 * Accepts a server payload only if it is structurally sound and describes the
 * same seven tiers with percentages that add up. A malformed or truncated table
 * is worse than the mirror, because it would display wrong odds with authority.
 */
export function normaliseGuide(payload: unknown): RarityGuide | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as { total?: unknown; tiers?: unknown };
  if (!Array.isArray(candidate.tiers) || candidate.tiers.length !== RARITY_FALLBACK.length) return null;

  const tiers: RarityTier[] = [];
  for (const entry of candidate.tiers) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Partial<RarityTier>;
    if (!isRarityId(row.id)) return null;
    if (typeof row.name !== "string" || row.name.length === 0) return null;
    if (typeof row.percent !== "number" || !Number.isFinite(row.percent) || row.percent <= 0) return null;
    if (typeof row.weight !== "number" || !Number.isInteger(row.weight) || row.weight <= 0) return null;
    tiers.push({
      id: row.id,
      name: row.name,
      percent: row.percent,
      weight: row.weight,
      description: typeof row.description === "string" ? row.description : "",
    });
  }

  const weightTotal = tiers.reduce((sum, tier) => sum + tier.weight, 0);
  if (weightTotal !== (typeof candidate.total === "number" ? candidate.total : RARITY_TOTAL_WEIGHT)) return null;
  if (weightTotal !== RARITY_TOTAL_WEIGHT) return null;

  return { total: weightTotal, tiers, live: true };
}

/**
 * The published table. Rarity is a server-side draw, so the guide is a server
 * answer; when it cannot be fetched the mirror is returned with `live: false`
 * and the UI says so out loud.
 */
export async function fetchRarityGuide(): Promise<RarityGuide> {
  if (cached?.live) return cached;
  const result = await apiRequest<unknown>("/rarities");
  if (!result.ok) return cached ?? fallbackGuide();
  const guide = normaliseGuide(result.data);
  if (!guide) return cached ?? fallbackGuide();
  cached = guide;
  return guide;
}

/** Test seam: forget the cached guide. */
export function forgetRarityGuide(): void {
  cached = null;
}
