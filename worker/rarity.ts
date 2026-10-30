/* ==========================================================================
   Friend codes and rarity — the Worker port of server/accounts/{codes,rarity}.mjs

   Same alphabet, same weights, same canonical forms, so codes generated on
   the Workers deployment read and behave exactly like the Node backend's.
   The draw happens only at account creation; no route ever re-rolls.
   ========================================================================== */

export const FRIEND_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const FRIEND_CODE_PREFIX = "CR";
export const FRIEND_CODE_BODY_LENGTH = 8;

export interface RarityTier {
  id: string;
  name: string;
  weight: number;
  description: string;
}

/** Every tier, lowest → highest. Weights total exactly 1000 (tenths of %). */
export const RARITY_TIERS: RarityTier[] = [
  { id: "basic", name: "Basic", weight: 600, description: "The everyday draw. Most codes land here, which is what makes the higher tiers mean anything." },
  { id: "uncommon", name: "Uncommon", weight: 220, description: "A little colour on the profile. Common enough to feel normal, rare enough to notice." },
  { id: "rare", name: "Rare", weight: 100, description: "Roughly one code in ten. Carries a quiet accent on the profile card." },
  { id: "epic", name: "Epic", weight: 50, description: "One in twenty. The profile card picks up a moving sheen, muted under reduced motion." },
  { id: "legendary", name: "Legendary", weight: 20, description: "One in fifty. A warm halo and a distinctive badge on your own profile." },
  { id: "prismatic", name: "Prismatic", weight: 9, description: "Nine in a thousand. A slow, shifting gradient rather than a single colour." },
  { id: "transcendent", name: "Transcendent", weight: 1, description: "One in a thousand. The rarest draw the generator can produce." },
];

export const RARITY_TOTAL_WEIGHT = RARITY_TIERS.reduce((total, tier) => total + tier.weight, 0);

export const RARITY_IDS = RARITY_TIERS.map((tier) => tier.id);

export function isRarityId(value: unknown): value is string {
  return typeof value === "string" && RARITY_IDS.includes(value);
}

/** Maps a roll in 0..999 to a tier, walking lowest first — tiles with no gaps. */
export function rarityForRoll(roll: number): RarityTier {
  let cursor = 0;
  for (const tier of RARITY_TIERS) {
    cursor += tier.weight;
    if (roll < cursor) return tier;
  }
  return RARITY_TIERS[RARITY_TIERS.length - 1];
}

/** Uniform 0..999 (integer) from Web Crypto — the Workers CSPRNG. */
function randomInt(total: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  // Rejection sampling keeps the distribution honest across all 1000 values.
  const limit = Math.floor(0x1_0000_0000 / total) * total;
  let value = buffer[0];
  while (value >= limit) {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  }
  return value % total;
}

export function rollRarity(): { rarity: string; roll: number } {
  const roll = randomInt(RARITY_TOTAL_WEIGHT);
  return { rarity: rarityForRoll(roll).id, roll };
}

const CANONICAL_PATTERN = new RegExp(
  `^${FRIEND_CODE_PREFIX}[${FRIEND_CODE_ALPHABET}]{${FRIEND_CODE_BODY_LENGTH}}$`,
);

export function generateFriendCode(): string {
  let body = "";
  for (let index = 0; index < FRIEND_CODE_BODY_LENGTH; index += 1) {
    body += FRIEND_CODE_ALPHABET[randomInt(FRIEND_CODE_ALPHABET.length)];
  }
  return FRIEND_CODE_PREFIX + body;
}

export function normalizeFriendCode(input: unknown): string {
  return String(input ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function isWellFormedFriendCode(canonical: string): boolean {
  return CANONICAL_PATTERN.test(canonical);
}

export function formatFriendCode(canonical: string): string {
  if (!isWellFormedFriendCode(canonical)) return String(canonical ?? "");
  const rest = canonical.slice(FRIEND_CODE_PREFIX.length);
  return `${FRIEND_CODE_PREFIX}-${rest.slice(0, 4)}-${rest.slice(4, 8)}`;
}

/** The published table, shaped for the client's rarity guide. */
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
