import { notify } from "@/services/os";
import {
  getCommand,
  registerCommands,
  runCommand,
  unregisterOwner,
  type Command,
} from "@/services/commands";
import {
  permissionForCommand,
  pluginCommandId,
  type InstalledPlugin,
  type PluginCommandDefinition,
  type PluginStep,
} from "./manifest";
import { usePluginStore } from "./store";

/* ==========================================================================
   Plugin commands in the registry

   A plugin's commands become ordinary entries in the one command registry, so
   the palette, the automation engine and anything else that runs a command
   need to know nothing about plugins. They are registered under an owner id
   (`plugin:<id>`), which is what the registry's owner grouping exists for: one
   call removes every command a plugin contributed.

   Permissions are checked twice — when the manifest is validated, and again
   here when a step runs. The second check is not redundant: a build can drop a
   namespace from the permission table without touching installed plugins, and
   a step whose permission no longer exists must fail loudly rather than run.
   ========================================================================== */

const OWNER_PREFIX = "plugin:";

export function pluginOwner(pluginId: string): string {
  return `${OWNER_PREFIX}${pluginId}`;
}

/** The registered id of one of a plugin's commands. */
export function registeredCommandId(plugin: InstalledPlugin, commandId: string): string {
  return pluginCommandId(plugin.id, commandId);
}

function isVerboseOnly(step: PluginStep): step is { notify: { title: string; body?: string } } {
  return "notify" in step;
}

async function runSteps(plugin: InstalledPlugin, definition: PluginCommandDefinition): Promise<void> {
  for (const [index, step] of definition.steps.entries()) {
    if (isVerboseOnly(step)) {
      notify({
        title: step.notify.title,
        body: step.notify.body,
        icon: "layers",
        appId: "settings",
      });
      continue;
    }

    /* Asked for again, here, for the reason in the header: an installed plugin
       outlives the permission table it was checked against. */
    const permission = permissionForCommand(step.command);
    if (!permission || !plugin.permissions.includes(permission)) {
      throw new Error(
        `“${plugin.name}” is not allowed to run ${step.command}. Remove and reinstall it to review its permissions.`,
      );
    }

    if (!getCommand(step.command)) {
      throw new Error(`${step.command} is not available, so “${definition.name}” stopped at step ${index + 1}.`);
    }

    const result = await runCommand(step.command);
    if (!result.ok) {
      // Half a recipe is worse than none: the user is told which step failed
      // rather than being left to guess how far it got.
      throw new Error(`Step ${index + 1} (${step.command}) failed: ${result.error}`);
    }
  }
}

function toCommand(plugin: InstalledPlugin, definition: PluginCommandDefinition): Command {
  return {
    id: registeredCommandId(plugin, definition.id),
    name: definition.name,
    description: definition.description ?? `A sequence from the “${plugin.name}” plugin.`,
    category: "Plugins",
    icon: "layers",
    keywords: ["plugin", plugin.name, ...(definition.keywords ?? [])],
    confirm: definition.confirm,
    announce: `${definition.name} — done.`,
    run: () => runSteps(plugin, definition),
  };
}

/** The part of a plugin that changes what the registry should hold. */
function signatureOf(plugins: InstalledPlugin[]): string {
  return plugins
    .map((plugin) => `${plugin.id}@${plugin.version}:${plugin.enabled ? "on" : "off"}:${plugin.commands.length}`)
    .join("|");
}

let lastSignature: string | null = null;

/**
 * The owners that are currently registered, remembered so they can be cleared
 * even after the plugin that owned them is gone.
 *
 * Without this, an uninstall was invisible to the registry: the loop below can
 * only unregister owners for plugins still in the store, and a removed plugin
 * is precisely the one that is not there any more. Its commands stayed in the
 * palette and stayed runnable.
 */
let syncedOwners: string[] = [];

/**
 * Makes the registry match the store. Cheap enough to run on every store write,
 * and skipped outright when nothing relevant changed so an unrelated write (a
 * rename, say) does not churn the palette's ordering.
 */
export function syncPluginCommands(force = false): void {
  const { plugins } = usePluginStore.getState();
  const signature = signatureOf(plugins);
  if (!force && signature === lastSignature) return;
  lastSignature = signature;

  for (const owner of syncedOwners) unregisterOwner(owner);
  syncedOwners = [];

  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    const owner = pluginOwner(plugin.id);
    registerCommands(
      plugin.commands.map((definition) => toCommand(plugin, definition)),
      { owner },
    );
    syncedOwners.push(owner);
  }
}

let started = false;

/** Applies installed plugins and keeps applying them. Called once, at boot. */
export function startPluginCommands(): void {
  syncPluginCommands(true);
  if (started) return;
  started = true;
  usePluginStore.subscribe(() => syncPluginCommands());
}
