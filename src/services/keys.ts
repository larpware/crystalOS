/* ==========================================================================
   Key combinations

   Pure helpers for describing and comparing keyboard shortcuts, so the registry
   (services/shortcuts) and the settings editor share one definition of what a
   binding is and whether two of them collide.

   Free of runtime imports so the Node test runner can load it directly.
   ========================================================================== */

export interface KeyCombo {
  /** Normalised key: "k", "arrowleft", "tab", "space", "1", "escape". */
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

/** Modifiers only — these never complete a shortcut on their own. */
const MODIFIER_KEYS = new Set(["control", "shift", "alt", "meta", "os", "altgraph"]);

export function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === " ") return "space";
  if (lower === "esc") return "escape";
  if (lower === "arrowup" || lower === "arrowdown" || lower === "arrowleft" || lower === "arrowright") {
    return lower;
  }
  return lower;
}

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key.toLowerCase());
}

export function combo(key: string, modifiers: Partial<Omit<KeyCombo, "key">> = {}): KeyCombo {
  return { key: normalizeKey(key), ...modifiers };
}

export function comboFromEvent(event: KeyboardEvent, platform: "mac" | "other" = "other"): KeyCombo | null {
  if (isModifierKey(event.key)) return null;
  void platform;
  return {
    key: normalizeKey(event.key),
    // Modifiers are reported exactly as pressed. The binding that says
    // `meta: true` is the Super/Command/Windows key and only ever matches that
    // key; `ctrl: true` is the Control key. Folding one into the other would
    // make "Super + L" unreachable on a non-Mac, because the folded value can
    // never equal the literal `meta` flag it is compared against.
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
}

export function sameCombo(a: KeyCombo | null | undefined, b: KeyCombo | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    normalizeKey(a.key) === normalizeKey(b.key) &&
    Boolean(a.ctrl) === Boolean(b.ctrl) &&
    Boolean(a.alt) === Boolean(b.alt) &&
    Boolean(a.shift) === Boolean(b.shift) &&
    Boolean(a.meta) === Boolean(b.meta)
  );
}

/** True when a physical event is exactly this binding. */
export function comboFromEventMatches(
  binding: KeyCombo,
  event: KeyboardEvent,
  platform: "mac" | "other" = "other",
): boolean {
  const pressed = comboFromEvent(event, platform);
  return sameCombo(binding, pressed);
}

const PRETTY_KEYS: Record<string, string> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  escape: "Esc",
  space: "Space",
  tab: "Tab",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Del",
  ",": ",",
  ".": ".",
  "/": "/",
  "-": "-",
};

/** Human-readable label, e.g. "Ctrl + Alt + →". */
export function formatCombo(binding: KeyCombo | null | undefined, platform: "mac" | "other" = "other"): string {
  if (!binding) return "Unassigned";
  const parts: string[] = [];
  if (binding.meta) parts.push(platform === "mac" ? "⌘" : "Meta");
  if (binding.ctrl) parts.push(platform === "mac" ? "⌃" : "Ctrl");
  if (binding.alt) parts.push(platform === "mac" ? "⌥" : "Alt");
  if (binding.shift) parts.push(platform === "mac" ? "⇧" : "Shift");
  const key = normalizeKey(binding.key);
  const label = PRETTY_KEYS[key] ?? (key.length === 1 ? key.toUpperCase() : key.replace(/^f(\d+)$/, "F$1"));
  parts.push(label);
  return platform === "mac" ? parts.join("") : parts.join(" + ");
}

export interface ComboConflict {
  combo: KeyCombo;
  /** Ids of every shortcut sharing the combination. */
  ids: string[];
}

/** Every combination claimed more than once, in registry order. */
export function findConflicts(bindings: Record<string, KeyCombo | null | undefined>): ComboConflict[] {
  const groups: ComboConflict[] = [];
  for (const [id, value] of Object.entries(bindings)) {
    if (!value) continue;
    const existing = groups.find((group) => sameCombo(group.combo, value));
    if (existing) {
      if (!existing.ids.includes(id)) existing.ids.push(id);
    } else {
      groups.push({ combo: value, ids: [id] });
    }
  }
  return groups.filter((group) => group.ids.length > 1);
}

/**
 * Combinations a browser claims for itself (new tab, close tab, reload, focus
 * the address bar...). CrystalOS can still bind them — the browser simply
 * wins when it does — so the settings page labels them instead of hiding them.
 */
const BROWSER_RESERVED: KeyCombo[] = [
  combo("w", { ctrl: true }),
  combo("w", { ctrl: true, shift: true }),
  combo("t", { ctrl: true }),
  combo("n", { ctrl: true }),
  combo("l", { ctrl: true }),
  combo("r", { ctrl: true }),
  combo("p", { ctrl: true }),
  combo("s", { ctrl: true }),
  combo("d", { ctrl: true }),
  combo("tab", { ctrl: true }),
  combo("f4", { alt: true }),
  combo("escape", { meta: true }),
];

export function isBrowserReserved(binding: KeyCombo | null | undefined): boolean {
  return Boolean(binding) && BROWSER_RESERVED.some((entry) => sameCombo(entry, binding));
}

/** Parses "Ctrl + Alt + ArrowLeft" (what the settings editor shows) back into a combo. */
export function parseCombo(input: string): KeyCombo | null {
  const tokens = input
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const result: KeyCombo = { key: "" };
  for (const token of tokens) {
    if (token === "ctrl" || token === "control" || token === "⌃") result.ctrl = true;
    else if (token === "alt" || token === "⌥" || token === "option") result.alt = true;
    else if (token === "shift" || token === "⇧") result.shift = true;
    else if (token === "meta" || token === "cmd" || token === "super" || token === "⌘") result.meta = true;
    else result.key = normalizeKey(token);
  }
  if (!result.key) return null;
  return result;
}
