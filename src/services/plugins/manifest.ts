/* ==========================================================================
   Plugin manifests

   A plugin is data, never code. It contributes named, multi-step actions built
   out of commands the OS already has, plus optional notifications. Nothing in
   a manifest is evaluated and there is no field in the format that can carry a
   function, so "installing a plugin" cannot become "running a stranger's
   program" — the format simply has nowhere to put one.

   That makes the permission model the whole security story, and it is derived
   from the command ids rather than invented beside them: a step naming
   `window.close-all` needs the `window` permission, and a manifest cannot reach
   a command from a namespace it did not ask for. Plugin commands live under
   `plugin.<id>.*`, and `plugin` is deliberately not a grantable permission — so
   one plugin can never invoke another's actions and borrow its permissions.

   Validation is hand-rolled for the same reason as the rest of the OS: no
   schema library is a dependency, and the rules that matter here are about what
   is *refused*, which reads better as explicit checks than as a schema.
   ========================================================================== */

/** The command namespaces a plugin may use, one permission each. */
export const PLUGIN_COMMAND_NAMESPACES = [
  "app",
  "layout",
  "session",
  "settings",
  "system",
  "window",
  "workspace",
] as const;

/** Posting a notification is an action in its own right, so it is its own grant. */
export const NOTIFY_PERMISSION = "notify";

export const PLUGIN_PERMISSIONS = [...PLUGIN_COMMAND_NAMESPACES, NOTIFY_PERMISSION] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

const PERMISSION_LABELS: Record<PluginPermission, string> = {
  app: "Open applications",
  layout: "Arrange windows into layouts",
  session: "Save, restore and clear the session",
  settings: "Open settings pages",
  system: "Lock, sleep and other system actions",
  window: "Minimise, restore and close windows",
  workspace: "Switch, create and rename workspaces",
  notify: "Show notifications",
};

export function permissionLabel(permission: PluginPermission): string {
  return PERMISSION_LABELS[permission];
}

export function isPluginPermission(value: unknown): value is PluginPermission {
  return typeof value === "string" && (PLUGIN_PERMISSIONS as readonly string[]).includes(value);
}

/* ---- the format --------------------------------------------------------- */

export interface PluginNotifyStep {
  notify: { title: string; body?: string };
}

export interface PluginCommandStep {
  command: string;
}

export type PluginStep = PluginNotifyStep | PluginCommandStep;

export interface PluginCommandDefinition {
  /** Local to the plugin; the registered id becomes `plugin.<plugin id>.<id>`. */
  id: string;
  name: string;
  description?: string;
  keywords?: string[];
  /** Text the palette shows before running the command. */
  confirm?: string;
  steps: PluginStep[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  permissions: PluginPermission[];
  commands: PluginCommandDefinition[];
}

export interface InstalledPlugin extends PluginManifest {
  enabled: boolean;
  installedAt: number;
}

/* ---- limits -------------------------------------------------------------
 * Every one of these exists to stop a hostile manifest from making the OS
 * unusable: a thousand commands, a step list that runs for an hour, or a name
 * long enough to push the palette off the screen. */

const MAX_COMMANDS = 20;
const MAX_STEPS_PER_COMMAND = 12;
const MAX_TOTAL_STEPS = 60;
const MAX_TITLE = 60;
const MAX_DESCRIPTION = 200;
const MAX_AUTHOR = 60;
const MAX_VERSION = 24;
const MAX_KEYWORDS = 6;
const MAX_KEYWORD = 24;
const MAX_CONFIRM = 160;
const MAX_NOTIFY_TITLE = 80;
const MAX_NOTIFY_BODY = 200;

/** Identifiers: lowercase, digits and dashes. No dots — those separate ids. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VERSION_PATTERN = new RegExp(`^[0-9][0-9a-zA-Z.+-]{0,${MAX_VERSION - 1}}$`);

/** The namespace a command id belongs to, or null when it has none. */
export function commandNamespace(id: string): string | null {
  const dot = id.indexOf(".");
  if (dot <= 0) return null;
  return id.slice(0, dot);
}

/** The permission a command id needs, or null when a plugin may never use it. */
export function permissionForCommand(id: string): PluginPermission | null {
  const namespace = commandNamespace(id);
  if (!namespace) return null;
  // `plugin.*` is another plugin's action; using it would borrow its grants.
  if (namespace === "plugin") return null;
  return isPluginPermission(namespace) ? namespace : null;
}

/** The id a plugin command is registered under. */
export function pluginCommandId(pluginId: string, commandId: string): string {
  return `plugin.${pluginId}.${commandId}`;
}

/* ---- validation --------------------------------------------------------- */

export interface PluginValidationOk {
  ok: true;
  plugin: PluginManifest;
}

export interface PluginValidationFailed {
  ok: false;
  errors: string[];
}

export type PluginValidation = PluginValidationOk | PluginValidationFailed;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function optionalText(value: unknown, max: number): string | undefined {
  return text(value, max) ?? undefined;
}

/**
 * Reads an untrusted value into a manifest, or explains why it cannot.
 *
 * Used both when a manifest arrives and when a stored one is re-read, so an
 * older build's data, a hand-edited store and a pasted file all pass through
 * exactly the same rules.
 */
export function normalisePlugin(input: unknown): PluginValidation {
  const errors: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["That is not a plugin: the manifest has to be a JSON object."] };
  }
  const raw = input as Record<string, unknown>;

  const id = typeof raw.id === "string" && ID_PATTERN.test(raw.id) ? raw.id : null;
  if (!id) {
    errors.push("`id` must be 1–40 characters of lowercase letters, digits and dashes.");
  }

  const name = text(raw.name, MAX_TITLE);
  if (!name) errors.push("`name` is required (up to 60 characters).");

  const version = typeof raw.version === "string" && VERSION_PATTERN.test(raw.version) ? raw.version : null;
  if (!version) {
    errors.push("`version` is required and must start with a digit (for example 1.0.0).");
  }

  const rawPermissions = Array.isArray(raw.permissions) ? raw.permissions : null;
  if (!rawPermissions) {
    errors.push("`permissions` must be a list — a plugin that asks for nothing cannot do anything.");
  }
  const permissions: PluginPermission[] = [];
  if (rawPermissions) {
    for (const entry of rawPermissions) {
      if (!isPluginPermission(entry)) {
        errors.push(`\`permissions\` contains “${String(entry)}”, which is not a permission CrystalOS grants.`);
        continue;
      }
      if (!permissions.includes(entry)) permissions.push(entry);
    }
  }

  const rawCommands = Array.isArray(raw.commands) ? raw.commands : null;
  if (!rawCommands || rawCommands.length === 0) {
    errors.push("`commands` must be a non-empty list.");
  } else if (rawCommands.length > MAX_COMMANDS) {
    errors.push(`A plugin may contribute at most ${MAX_COMMANDS} commands.`);
  }

  const commands: PluginCommandDefinition[] = [];
  const seenCommandIds = new Set<string>();
  let totalSteps = 0;

  for (const [index, entry] of (rawCommands ?? []).entries()) {
    const where = `commands[${index}]`;
    if (commands.length >= MAX_COMMANDS) break;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${where} is not an object.`);
      continue;
    }
    const command = entry as Record<string, unknown>;

    const commandId =
      typeof command.id === "string" && ID_PATTERN.test(command.id) ? command.id : null;
    if (!commandId) {
      errors.push(`${where}.id must be 1–40 characters of lowercase letters, digits and dashes.`);
    } else if (seenCommandIds.has(commandId)) {
      errors.push(`${where}.id repeats “${commandId}”.`);
    }

    const commandName = text(command.name, MAX_TITLE);
    if (!commandName) errors.push(`${where}.name is required (up to 60 characters).`);

    const rawKeywords = Array.isArray(command.keywords) ? command.keywords : [];
    const keywords: string[] = [];
    for (const keyword of rawKeywords) {
      const value = text(keyword, MAX_KEYWORD);
      if (value && !keywords.includes(value) && keywords.length < MAX_KEYWORDS) keywords.push(value);
    }

    const rawSteps = Array.isArray(command.steps) ? command.steps : null;
    if (!rawSteps || rawSteps.length === 0) {
      errors.push(`${where}.steps must be a non-empty list.`);
      continue;
    }
    if (rawSteps.length > MAX_STEPS_PER_COMMAND) {
      errors.push(`${where}.steps may hold at most ${MAX_STEPS_PER_COMMAND} steps.`);
      continue;
    }

    const steps: PluginStep[] = [];
    for (const [stepIndex, stepEntry] of rawSteps.entries()) {
      const at = `${where}.steps[${stepIndex}]`;
      if (!stepEntry || typeof stepEntry !== "object" || Array.isArray(stepEntry)) {
        errors.push(`${at} is not an object.`);
        continue;
      }
      const step = stepEntry as Record<string, unknown>;
      const hasCommand = "command" in step;
      const hasNotify = "notify" in step;

      if (hasCommand === hasNotify) {
        errors.push(`${at} must hold exactly one of \`command\` or \`notify\`.`);
        continue;
      }

      if (hasCommand) {
        const target = typeof step.command === "string" ? step.command.trim() : "";
        const permission = permissionForCommand(target);
        if (!permission) {
          errors.push(
            `${at} names “${target || "(nothing)"}”. A plugin may only use namespaced CrystalOS commands ` +
              `(${PLUGIN_COMMAND_NAMESPACES.join(", ")}) and never another plugin's.`,
          );
          continue;
        }
        if (!permissions.includes(permission)) {
          errors.push(
            `${at} needs the “${permission}” permission for ${target}, which the manifest does not request. ` +
              "Permissions are shown before installing, so a step may not quietly widen them.",
          );
          continue;
        }
        steps.push({ command: target });
        continue;
      }

      const notify = step.notify as Record<string, unknown> | null;
      if (!notify || typeof notify !== "object" || Array.isArray(notify)) {
        errors.push(`${at}.notify must be an object with a ` + "`title`" + `.`);
        continue;
      }
      if (!permissions.includes(NOTIFY_PERMISSION)) {
        errors.push(`${at} posts a notification but the manifest does not request the “notify” permission.`);
        continue;
      }
      const title = text(notify.title, MAX_NOTIFY_TITLE);
      if (!title) {
        errors.push(`${at}.notify.title is required (up to 80 characters).`);
        continue;
      }
      steps.push({ notify: { title, body: optionalText(notify.body, MAX_NOTIFY_BODY) } });
    }

    if (commandId && commandName && steps.length > 0) {
      totalSteps += steps.length;
      seenCommandIds.add(commandId);
      commands.push({
        id: commandId,
        name: commandName,
        description: optionalText(command.description, MAX_DESCRIPTION),
        keywords: keywords.length ? keywords : undefined,
        confirm: optionalText(command.confirm, MAX_CONFIRM),
        steps,
      });
    }
  }

  if (totalSteps > MAX_TOTAL_STEPS) {
    errors.push(`A plugin may run at most ${MAX_TOTAL_STEPS} steps in total.`);
  }

  if (errors.length > 0 || !id || !name || !version) {
    return { ok: false, errors: errors.length ? errors : ["That manifest is incomplete."] };
  }

  return {
    ok: true,
    plugin: {
      id,
      name,
      version,
      author: optionalText(raw.author, MAX_AUTHOR),
      description: optionalText(raw.description, MAX_DESCRIPTION),
      permissions,
      commands,
    },
  };
}
