export function formatBytes(bytes: number, precision = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : precision)} ${units[unitIndex]}`;
}

export function formatCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}K`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function timeFormatter(hour12: boolean, seconds: boolean): Intl.DateTimeFormat {
  const key = `${hour12 ? 12 : 24}-${seconds ? "s" : "m"}`;
  const existing = timeFormatters.get(key);
  if (existing) return existing;
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    hour12,
  });
  timeFormatters.set(key, formatter);
  return formatter;
}

export function formatTime(date: Date, hour12: boolean, seconds = false): string {
  return timeFormatter(hour12, seconds).format(date);
}

export function formatDayName(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
}

export function formatDateLong(date: Date, withYear = false): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(withYear ? { year: "numeric" as const } : {}),
  }).format(date);
}

export function formatDateShort(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function formatRelative(timestamp: number, now = Date.now()): string {
  const delta = Math.max(0, now - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateShort(new Date(timestamp));
}

export function formatClockDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

const idAlphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

export function createId(prefix = "id"): string {
  let random = "";
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (const byte of bytes) random += idAlphabet[byte % idAlphabet.length];
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

/* --------------------------------------------------------------------------
   Friend codes

   Codes are generated on the account server (server/accounts/codes.mjs) and are
   immutable for the life of an account. Everything here is display and input
   formatting only — the browser never creates a code.
   -------------------------------------------------------------------------- */

/** Canonical body alphabet: no 0/O/1/I/L, so codes survive being read aloud. */
export const FRIEND_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const FRIEND_CODE_PREFIX = "CR";

/** Matches the display form `CR-7K4M-9Q2X` and the bare form `CR7K4M9Q2X`. */
export const FRIEND_CODE_PATTERN = new RegExp(
  `^${FRIEND_CODE_PREFIX}-?[${FRIEND_CODE_ALPHABET}]{4}-?[${FRIEND_CODE_ALPHABET}]{4}$`,
  "i",
);

/** Strips separators/case — the same normalisation the server performs. */
export function normalizeFriendCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Formats a code for display, tolerating partial input: `cr 7k4m` becomes
 * `CR-7K4M` while it is still being typed.
 */
export function formatFriendCode(value: string): string {
  const canonical = normalizeFriendCode(value).slice(0, FRIEND_CODE_PREFIX.length + 8);
  if (!canonical) return "";
  const body = canonical.startsWith(FRIEND_CODE_PREFIX)
    ? canonical.slice(FRIEND_CODE_PREFIX.length)
    : canonical;
  const groups = [body.slice(0, 4), body.slice(4, 8)].filter(Boolean);
  return [FRIEND_CODE_PREFIX, ...groups].join("-");
}

/** True once the input looks like a complete code. */
export function isCompleteFriendCode(value: string): boolean {
  const canonical = normalizeFriendCode(value);
  return canonical.length === FRIEND_CODE_PREFIX.length + 8 && FRIEND_CODE_PATTERN.test(canonical);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delay = 180,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Escapes text for safe insertion into markup-free render paths. */
export function stripControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "");
}
