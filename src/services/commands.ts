import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { IconName } from "@/icons/Icon";
import { searchCommands, type SearchableCommand } from "./commandSearch";

/* ==========================================================================
   Command registry

   Everything the OS can do on request is a command: opening an application,
   launching a game, switching workspace, applying a layout, changing a
   preference, running an automation. The palette is only a view over this
   registry, and so are the plugin SDK and the automation engine — which is why
   there is exactly one place where "run something" is implemented.
   ========================================================================== */

export type CommandCategory =
  | "Applications"
  | "Games"
  | "Workspaces"
  | "Windows"
  | "Layouts"
  | "Settings"
  | "Session"
  | "Automation"
  | "Plugins"
  | "System";

export const commandCategoryOrder: CommandCategory[] = [
  "Applications",
  "Games",
  "Workspaces",
  "Windows",
  "Layouts",
  "Settings",
  "Session",
  "Automation",
  "Plugins",
  "System",
];

export interface Command extends SearchableCommand {
  category: CommandCategory;
  icon?: IconName;
  /** Hidden from the palette when this returns false. */
  when?: () => boolean;
  /** Confirmation text; the palette asks before running when set. */
  confirm?: string;
  /** Keep the palette open after running (useful for chained commands). */
  keepOpen?: boolean;
  /** Reported to the user after a successful run. */
  announce?: string;
  /* The action. `runCommand` awaits it, so async commands work; whatever it
     returns is ignored, which is why a `run` that happens to return a value
     (a boolean, a message) is still a valid command. */
  run: () => void;
}

const registry = new Map<string, Command>();
/** Insertion order per owner, so a plugin or app can unregister as a group. */
const order: string[] = [];
const owners = new Map<string, Set<string>>();

export interface RegisterOptions {
  /** Who owns the commands; used to remove them all at once (plugins, apps). */
  owner?: string;
}

export function registerCommand(command: Command, options: RegisterOptions = {}): void {
  if (!registry.has(command.id)) order.push(command.id);
  registry.set(command.id, command);
  if (options.owner) {
    const set = owners.get(options.owner) ?? new Set<string>();
    set.add(command.id);
    owners.set(options.owner, set);
  }
}

export function registerCommands(commands: Command[], options: RegisterOptions = {}): void {
  for (const command of commands) registerCommand(command, options);
}

export function unregisterCommand(id: string): void {
  if (!registry.delete(id)) return;
  const index = order.indexOf(id);
  if (index >= 0) order.splice(index, 1);
}

/** Removes every command registered under an owner id. */
export function unregisterOwner(owner: string): number {
  const ids = owners.get(owner);
  if (!ids) return 0;
  let removed = 0;
  for (const id of ids) {
    if (registry.has(id)) {
      unregisterCommand(id);
      removed += 1;
    }
  }
  owners.delete(owner);
  return removed;
}

export function hasCommand(id: string): boolean {
  return registry.has(id);
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id);
}

/** Every registered command that is currently available. */
export function listCommands(): Command[] {
  return order
    .map((id) => registry.get(id))
    .filter((entry): entry is Command => Boolean(entry))
    .filter((entry) => {
      if (!entry.when) return true;
      try {
        return entry.when();
      } catch {
        return false;
      }
    });
}

export function searchRegisteredCommands(query: string, limit = 40): Command[] {
  return searchCommands(listCommands(), query, {
    recents: useCommandHistory.getState().recent,
    limit,
  });
}

/* ---- recents ------------------------------------------------------------- */

interface CommandHistory {
  /** Most recently run commands, most recent first. */
  recent: string[];
  lastRun: { id: string; at: number } | null;
  lastError: { id: string; message: string; at: number } | null;
  remember: (id: string) => void;
  recordError: (id: string, message: string) => void;
  clear: () => void;
}

export const useCommandHistory = create<CommandHistory>()(
  persist(
    (set, get) => ({
      recent: [],
      lastRun: null,
      lastError: null,
      remember: (id) =>
        set({ recent: [id, ...get().recent.filter((entry) => entry !== id)].slice(0, 12) }),
      recordError: (id, message) => set({ lastError: { id, message, at: Date.now() } }),
      clear: () => set({ recent: [], lastRun: null, lastError: null }),
    }),
    { name: "commands", version: 1 },
  ),
);

/* ---- execution ----------------------------------------------------------- */

export type CommandResult =
  | { ok: true; command: Command }
  | { ok: false; error: string };

/**
 * Runs a command by id. Failures are reported, never thrown at the caller: the
 * palette and the automation engine both need to survive a broken command.
 */
export async function runCommand(id: string): Promise<CommandResult> {
  const command = registry.get(id);
  if (!command) return { ok: false, error: `Command "${id}" is not registered.` };
  if (command.when) {
    try {
      if (!command.when()) return { ok: false, error: `"${command.name}" is not available right now.` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Unavailable." };
    }
  }
  try {
    await command.run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useCommandHistory.getState().recordError(id, message);
    return { ok: false, error: message };
  }
  const history = useCommandHistory.getState();
  history.remember(id);
  useCommandHistory.setState({ lastRun: { id, at: Date.now() } });
  return { ok: true, command };
}
