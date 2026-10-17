import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IconName } from "@/icons/Icon";
import { isBrowserReserved, type KeyCombo } from "./keys";

/* ==========================================================================
   Shortcut registry

   One registry, one keydown listener. Components never add their own
   document-level listener: they register a definition and the dispatcher in
   shell/useGlobalShortcuts decides which one fires. That is what makes
   conflicts detectable, bindings configurable and contexts respected.
   ========================================================================== */

export type ShortcutCategory =
  | "Shell"
  | "System"
  | "Session"
  | "Windows"
  | "Workspaces"
  | "Layouts"
  | "Search"
  | "Applications"
  | "Automation"
  | "Settings";

export interface ShortcutDefinition {
  /** Stable id, used as the persistence key for user bindings. */
  id: string;
  label: string;
  category: ShortcutCategory;
  /** What the shortcut does, shown in Settings. */
  description?: string;
  defaultKeys: KeyCombo;
  /** Extra bindings that also fire this shortcut (never listed or edited). */
  aliases?: KeyCombo[];
  icon?: IconName;
  /** Fire even while a text field has focus (Escape, Ctrl+K, …). */
  whileTyping?: boolean;
  /** Only active when this returns true. */
  when?: () => boolean;
  run: () => void;
}

const registry = new Map<string, ShortcutDefinition>();
/** Insertion order, so Settings lists shortcuts the way the OS defines them. */
const order: string[] = [];

export function registerShortcut(definition: ShortcutDefinition): void {
  if (!registry.has(definition.id)) order.push(definition.id);
  registry.set(definition.id, definition);
}

export function registerShortcuts(definitions: ShortcutDefinition[]): void {
  for (const definition of definitions) registerShortcut(definition);
}

export function unregisterShortcut(id: string): void {
  if (registry.delete(id)) {
    const index = order.indexOf(id);
    if (index >= 0) order.splice(index, 1);
  }
}

export function listShortcuts(): ShortcutDefinition[] {
  return order.map((id) => registry.get(id)).filter((entry): entry is ShortcutDefinition => Boolean(entry));
}

export function getShortcut(id: string): ShortcutDefinition | undefined {
  return registry.get(id);
}

/* ---- user bindings ------------------------------------------------------- */

interface BindingState {
  /** Overrides only: a missing entry means "use the definition's default". */
  overrides: Record<string, KeyCombo | null>;
  setBinding: (id: string, binding: KeyCombo | null) => void;
  clearBinding: (id: string) => void;
  resetAll: () => void;
}

export const useShortcutStore = create<BindingState>()(
  persist(
    (set, get) => ({
      overrides: {},
      setBinding: (id, binding) =>
        set({ overrides: { ...get().overrides, [id]: binding } }),
      clearBinding: (id) => {
        const next = { ...get().overrides };
        delete next[id];
        set({ overrides: next });
      },
      resetAll: () => set({ overrides: {} }),
    }),
    { name: "shortcuts", version: 1 },
  ),
);

/** The combination that currently fires a shortcut. */
export function bindingFor(id: string): KeyCombo | null {
  const definition = registry.get(id);
  const override = useShortcutStore.getState().overrides[id];
  if (override !== undefined) return override;
  return definition?.defaultKeys ?? null;
}

export function defaultBindingFor(id: string): KeyCombo | null {
  return registry.get(id)?.defaultKeys ?? null;
}

export function isCustomised(id: string): boolean {
  return useShortcutStore.getState().overrides[id] !== undefined;
}

/** Every effective binding, keyed by shortcut id — the input for conflict checks. */
export function effectiveBindings(): Record<string, KeyCombo | null> {
  const result: Record<string, KeyCombo | null> = {};
  for (const id of order) result[id] = bindingFor(id);
  return result;
}

export interface ShortcutView {
  definition: ShortcutDefinition;
  binding: KeyCombo | null;
  defaultBinding: KeyCombo | null;
  customised: boolean;
  /** Another shortcut already claims the same combination. */
  conflicting: boolean;
  browserReserved: boolean;
}

export function shortcutViews(): ShortcutView[] {
  const bindings = effectiveBindings();
  const counts = new Map<string, number>();
  for (const value of Object.values(bindings)) {
    if (!value) continue;
    const key = `${value.key}|${value.ctrl ? 1 : 0}${value.alt ? 1 : 0}${value.shift ? 1 : 0}${value.meta ? 1 : 0}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return listShortcuts().map((definition) => {
    const binding = bindings[definition.id];
    const key = binding
      ? `${binding.key}|${binding.ctrl ? 1 : 0}${binding.alt ? 1 : 0}${binding.shift ? 1 : 0}${binding.meta ? 1 : 0}`
      : "";
    return {
      definition,
      binding,
      defaultBinding: definition.defaultKeys,
      customised: isCustomised(definition.id),
      conflicting: Boolean(binding) && (counts.get(key) ?? 0) > 1,
      browserReserved: isBrowserReserved(binding),
    };
  });
}

/* ---- dispatch ------------------------------------------------------------ */

export interface DispatchOptions {
  /** Platform used to fold Cmd and Ctrl together. */
  platform: "mac" | "other";
  /** True when the focused element is a text field. */
  typing: boolean;
  /** The physical event, used to match a binding exactly. */
  matches: (binding: KeyCombo) => boolean;
}

/**
 * Runs the first matching shortcut. Returns the id that fired, so the caller
 * knows whether to call preventDefault (only claim keys the OS actually uses).
 */
export function dispatchShortcut(options: DispatchOptions): string | null {
  for (const definition of listShortcuts()) {
    const binding = bindingFor(definition.id);
    if (!binding) continue;
    if (options.typing && !definition.whileTyping) continue;
    const candidates = [binding, ...(definition.aliases ?? [])];
    if (!candidates.some((candidate) => options.matches(candidate))) continue;
    if (definition.when && !definition.when()) continue;
    try {
      definition.run();
    } catch (error) {
      console.error(`[shortcuts] ${definition.id} failed`, error);
    }
    return definition.id;
  }
  return null;
}
