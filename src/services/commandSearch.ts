/* ==========================================================================
   Command matching

   Local, deterministic scoring for the command palette. Everything is computed
   in memory — nothing here ever touches the network — and the weights make the
   same command rank the same way every time.

   Free of runtime imports so the Node test runner can load it directly.
   ========================================================================== */

export interface SearchableCommand {
  id: string;
  name: string;
  description?: string;
  category: string;
  keywords?: string[];
  hint?: string;
}

const WEIGHTS = {
  nameExact: 1000,
  namePrefix: 800,
  nameWord: 650,
  nameSubstring: 560,
  keywordExact: 520,
  keywordPrefix: 420,
  keywordSubstring: 300,
  descriptionSubstring: 200,
  subsequence: 120,
  recentBonus: 60,
  shortNameBonus: 20,
} as const;

function normalise(value: string): string {
  return value.toLowerCase().trim();
}

/** Subsequence match ("opst" → "open settings"), used as a last resort. */
function subsequenceScore(query: string, haystack: string): number {
  let index = 0;
  let gaps = 0;
  for (const character of haystack) {
    if (character === query[index]) index += 1;
    else if (index > 0) gaps += 1;
    if (index === query.length) break;
  }
  if (index < query.length) return 0;
  return Math.max(20, WEIGHTS.subsequence - gaps);
}

export function scoreCommand(query: string, command: SearchableCommand): number {
  const needle = normalise(query);
  if (!needle) return 1;
  const name = normalise(command.name);
  const words = name.split(/[\s·—-]+/);
  let best = 0;

  if (name === needle) best = WEIGHTS.nameExact;
  else if (name.startsWith(needle)) best = WEIGHTS.namePrefix;
  else if (words.some((word) => word.startsWith(needle))) best = WEIGHTS.nameWord;
  else if (name.includes(needle)) best = WEIGHTS.nameSubstring;

  for (const keyword of command.keywords ?? []) {
    const value = normalise(keyword);
    if (value === needle) best = Math.max(best, WEIGHTS.keywordExact);
    else if (value.startsWith(needle)) best = Math.max(best, WEIGHTS.keywordPrefix);
    else if (value.includes(needle)) best = Math.max(best, WEIGHTS.keywordSubstring);
  }

  if (!best && command.description && normalise(command.description).includes(needle)) {
    best = WEIGHTS.descriptionSubstring;
  }
  if (!best) best = subsequenceScore(needle, name);
  if (!best) return 0;

  return best + Math.max(0, WEIGHTS.shortNameBonus - Math.floor(name.length / 4));
}

export interface SearchOptions {
  /** Ids most recently run, most recent first. */
  recents?: string[];
  limit?: number;
}

export function searchCommands<T extends SearchableCommand>(
  commands: T[],
  query: string,
  options: SearchOptions = {},
): T[] {
  const recents = options.recents ?? [];
  const rank = new Map(recents.map((id, index) => [id, index]));
  const limit = options.limit ?? 40;
  const needle = normalise(query);

  const scored = commands
    .map((command) => {
      const score = scoreCommand(needle, command);
      if (score <= 0) return null;
      const recent = rank.get(command.id);
      return { command, score: score + (recent === undefined ? 0 : WEIGHTS.recentBonus - recent) };
    })
    .filter((entry): entry is { command: T; score: number } => entry !== null);

  scored.sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name));
  return scored.slice(0, limit).map((entry) => entry.command);
}
