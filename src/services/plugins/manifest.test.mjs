/*
 * CrystalOS — plugin manifest tests
 *
 * Run with `npm test` (or `node --test src/services/plugins/manifest.test.mjs`).
 *
 * A plugin is untrusted data, so these are mostly tests about refusal: what
 * normalisePlugin() will not accept, and — more importantly — that a manifest
 * cannot reach a command it did not ask permission for, cannot borrow another
 * plugin's permissions, and cannot smuggle anything that is not a command id or
 * a notification into a step.
 *
 * Node resolves neither Vite's `@/` alias nor extensionless relative imports,
 * so the hook below maps them the way the bundler does.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

/** `src/`, so `@/services/plugins/manifest` resolves the way Vite resolves it. */
const SRC_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

function resolveWithExtensions(base) {
  if (existsSync(base)) return base;
  for (const suffix of [".ts", ".tsx", ".js", ".mjs", "/index.ts"]) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith("@/")) {
      base = resolvePath(SRC_ROOT, specifier.slice(2));
    } else if (!/\.[cm]?[jt]sx?$|\.json$/.test(specifier) && specifier.startsWith(".") && context.parentURL) {
      base = fileURLToPath(new URL(specifier, context.parentURL));
    }
    const found = base === null ? null : resolveWithExtensions(base);
    return found ? { url: pathToFileURL(found).href, shortCircuit: true } : nextResolve(specifier, context);
  },
});

const {
  PLUGIN_PERMISSIONS,
  commandNamespace,
  permissionForCommand,
  permissionLabel,
  pluginCommandId,
  normalisePlugin,
} = await import("@/services/plugins/manifest");
const { bundledManifests } = await import("@/services/plugins/bundled");
const { sanitiseInstalledPlugins, usePluginStore } = await import("@/services/plugins/store");

/** A manifest that passes, so each test can spoil exactly one thing. */
function valid(overrides = {}) {
  return {
    id: "my-plugin",
    name: "My plugin",
    version: "1.0.0",
    permissions: ["window", "notify"],
    commands: [
      {
        id: "tidy",
        name: "Tidy up",
        steps: [{ command: "window.minimize-all" }, { notify: { title: "Done" } }],
      },
    ],
    ...overrides,
  };
}

const errorsOf = (input) => {
  const result = normalisePlugin(input);
  assert.equal(result.ok, false, "expected the manifest to be refused");
  return result.errors.join("\n");
};

const pluginOf = (input) => {
  const result = normalisePlugin(input);
  assert.equal(result.ok, true, `expected the manifest to be accepted: ${JSON.stringify(result)}`);
  return result.plugin;
};

describe("the shape of the format", () => {
  test("a valid manifest is accepted and kept whole", () => {
    const plugin = pluginOf(valid({ author: "Someone", description: "Does a thing" }));
    assert.equal(plugin.id, "my-plugin");
    assert.equal(plugin.name, "My plugin");
    assert.equal(plugin.version, "1.0.0");
    assert.equal(plugin.author, "Someone");
    assert.deepEqual(plugin.permissions, ["window", "notify"]);
    assert.equal(plugin.commands.length, 1);
    assert.equal(plugin.commands[0].steps.length, 2);
  });

  test("anything that is not an object is refused with one clear line", () => {
    for (const value of [null, undefined, 42, "nope", []]) {
      assert.match(errorsOf(value), /not a plugin/i);
    }
  });

  test("a database record with a function in it is still only data", () => {
    // Whatever a hostile manifest puts in, nothing survives that could be
    // called: the format only keeps strings and lists of strings.
    const plugin = pluginOf(valid({ evil: () => "boom", commands: [{ id: "x", name: "X", steps: [{ command: "window.minimize-all" }], onRun: () => "boom" }] }));
    assert.equal(typeof plugin.commands[0].onRun, "undefined");
    assert.equal(JSON.parse(JSON.stringify(plugin)).commands[0].onRun, undefined);
  });
});

describe("identifiers", () => {
  test("ids are lowercase, digits and dashes", () => {
    assert.equal(normalisePlugin(valid({ id: "My Plugin" })).ok, false);
    assert.equal(normalisePlugin(valid({ id: "-leading" })).ok, false);
    assert.equal(normalisePlugin(valid({ id: "has.dot" })).ok, false);
    assert.equal(normalisePlugin(valid({ id: "a".repeat(41) })).ok, false);
    assert.equal(normalisePlugin(valid({ id: "ok-id-2" })).ok, true);
  });

  test("a registered command id is namespaced under the plugin", () => {
    assert.equal(pluginCommandId("desk-tools", "tidy"), "plugin.desk-tools.tidy");
  });

  test("version has to start with a digit", () => {
    assert.equal(normalisePlugin(valid({ version: "latest" })).ok, false);
    assert.equal(normalisePlugin(valid({ version: 1 })).ok, false);
    assert.equal(normalisePlugin(valid({ version: "2.0.0-beta.1" })).ok, true);
  });
});

describe("permissions", () => {
  test("an unknown permission is refused rather than ignored", () => {
    const message = errorsOf(valid({ permissions: ["window", "root"] }));
    assert.match(message, /not a permission/i);
  });

  test("a step may not use a namespace the manifest did not ask for", () => {
    const message = errorsOf(
      valid({
        permissions: ["notify"],
        commands: [{ id: "x", name: "X", steps: [{ command: "window.close-all" }] }],
      }),
    );
    assert.match(message, /does not request/i);
  });

  test("the permission of a command id is its namespace", () => {
    assert.equal(permissionForCommand("window.minimize-all"), "window");
    assert.equal(permissionForCommand("session.save"), "session");
    assert.equal(permissionForCommand("settings.appearance"), "settings");
    assert.equal(commandNamespace("system.lock"), "system");
  });

  test("a command id with no namespace cannot be used at all", () => {
    // There is no permission that could name it, so there is no way to show a
    // user what they are agreeing to.
    assert.equal(permissionForCommand("lock"), null);
    assert.equal(permissionForCommand(""), null);
  });

  test("one plugin may never invoke another plugin's command", () => {
    // Otherwise a plugin with no dangerous permissions could chain through one
    // that has them.
    assert.equal(permissionForCommand("plugin.other-thing.tidy"), null);
    const message = errorsOf(
      valid({
        permissions: ["notify"],
        commands: [{ id: "x", name: "X", steps: [{ command: "plugin.other.tidy" }] }],
      }),
    );
    assert.match(message, /never another plugin/i);
  });

  test("`plugin` is not a grantable permission", () => {
    assert.equal(PLUGIN_PERMISSIONS.includes("plugin"), false);
  });

  test("a notification is an action and needs its own permission", () => {
    const message = errorsOf(
      valid({
        permissions: ["window"],
        commands: [{ id: "x", name: "X", steps: [{ notify: { title: "Hi" } }] }],
      }),
    );
    assert.match(message, /notify/i);
  });

  test("duplicate permissions are collapsed", () => {
    const plugin = pluginOf(valid({ permissions: ["window", "window", "notify"] }));
    assert.deepEqual(plugin.permissions, ["window", "notify"]);
  });

  test("every permission the format accepts has a label to show a user", () => {
    for (const permission of PLUGIN_PERMISSIONS) {
      assert.equal(typeof permissionLabel(permission), "string");
      assert.ok(permissionLabel(permission).length > 3, permission);
    }
  });
});

describe("steps", () => {
  test("a step holds exactly one of command or notify", () => {
    assert.match(
      errorsOf(valid({ commands: [{ id: "x", name: "X", steps: [{ command: "window.minimize-all", notify: { title: "x" } }] }] })),
      /exactly one/i,
    );
    assert.match(errorsOf(valid({ commands: [{ id: "x", name: "X", steps: [{}] }] })), /exactly one/i);
  });

  test("a notification needs a title", () => {
    assert.match(
      errorsOf(valid({ commands: [{ id: "x", name: "X", steps: [{ notify: { body: "no title" } }] }] })),
      /title is required/i,
    );
  });

  test("a step that is neither shape is refused", () => {
    assert.match(
      errorsOf(valid({ commands: [{ id: "x", name: "X", steps: ["window.minimize-all"] }] })),
      /not an object/i,
    );
  });

  test("a namespaced command that is not registered yet is allowed", () => {
    // Commands arrive from applications that may not have loaded yet, and a
    // manifest is not wrong for using one. It fails loudly at run time instead.
    const plugin = pluginOf(
      valid({
        permissions: ["app", "notify"],
        commands: [{ id: "x", name: "X", steps: [{ command: "app.all" }] }],
      }),
    );
    assert.equal(plugin.commands[0].steps[0].command, "app.all");
  });
});

describe("limits", () => {
  test("a manifest may not contribute an unbounded number of commands", () => {
    const commands = Array.from({ length: 21 }, (_, index) => ({
      id: `c${index}`,
      name: `Command ${index}`,
      steps: [{ command: "window.minimize-all" }],
    }));
    assert.match(errorsOf(valid({ commands })), /at most 20/i);
  });

  test("a single command may not hold an unbounded number of steps", () => {
    const steps = Array.from({ length: 13 }, () => ({ command: "window.minimize-all" }));
    assert.match(
      errorsOf(valid({ commands: [{ id: "x", name: "X", steps }] })),
      /at most 12 steps/i,
    );
  });

  test("duplicate command ids inside one manifest are refused", () => {
    const message = errorsOf(
      valid({
        commands: [
          { id: "x", name: "X", steps: [{ command: "window.minimize-all" }] },
          { id: "x", name: "X again", steps: [{ command: "window.minimize-all" }] },
        ],
      }),
    );
    assert.match(message, /repeats/i);
  });

  test("long text is clamped instead of rejected", () => {
    const plugin = pluginOf(valid({ name: "N".repeat(400) }));
    assert.equal(plugin.name.length, 60);
  });

  test("a command with no name or no steps is refused", () => {
    assert.match(errorsOf(valid({ commands: [{ id: "x", steps: [{ command: "window.minimize-all" }] }] })), /name is required/i);
    assert.match(errorsOf(valid({ commands: [{ id: "x", name: "X", steps: [] }] })), /steps must be a non-empty list/i);
  });
});

describe("bundled plugins", () => {
  test("every bundled manifest is valid and uses only granted permissions", () => {
    assert.ok(bundledManifests.length >= 2, "there should be at least two bundled plugins");
    for (const manifest of bundledManifests) {
      const result = normalisePlugin(manifest);
      assert.equal(result.ok, true, `${manifest.id}: ${JSON.stringify(result)}`);
      assert.ok(result.plugin.commands.length > 0, manifest.id);
    }
  });

  test("bundled plugins have distinct ids", () => {
    const ids = bundledManifests.map((manifest) => manifest.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("the store", () => {
  beforeEach(() => {
    usePluginStore.getState().reset();
  });

  const manifest = () => pluginOf(valid());

  test("installing a plugin enables it and records when", () => {
    const result = usePluginStore.getState().install(manifest());
    assert.equal(result.ok, true);
    const [stored] = usePluginStore.getState().plugins;
    assert.equal(stored.id, "my-plugin");
    assert.equal(stored.enabled, true);
    assert.ok(stored.installedAt > 0);
  });

  test("installing the same id again replaces it rather than duplicating", () => {
    usePluginStore.getState().install(manifest());
    usePluginStore.getState().install(pluginOf(valid({ version: "2.0.0" })));
    const plugins = usePluginStore.getState().plugins;
    assert.equal(plugins.length, 1);
    assert.equal(plugins[0].version, "2.0.0");
  });

  test("a plugin can be switched off without being removed", () => {
    usePluginStore.getState().install(manifest());
    usePluginStore.getState().setEnabled("my-plugin", false);
    const [stored] = usePluginStore.getState().plugins;
    assert.equal(stored.enabled, false);
    assert.equal(stored.commands.length, 1);
  });

  test("removing reports whether anything was removed", () => {
    usePluginStore.getState().install(manifest());
    assert.equal(usePluginStore.getState().remove("my-plugin"), true);
    assert.equal(usePluginStore.getState().remove("my-plugin"), false);
    assert.deepEqual(usePluginStore.getState().plugins, []);
  });
});

describe("reading back what was stored", () => {
  test("a stored plugin is re-validated, not trusted", () => {
    const kept = sanitiseInstalledPlugins([
      { ...valid(), enabled: true, installedAt: 7 },
      // A permission that this build does not grant.
      { ...valid({ id: "bad" }), permissions: ["window", "root"], enabled: true, installedAt: 7 },
      // A step needing a permission the manifest does not request.
      {
        ...valid({ id: "worse" }),
        commands: [{ id: "x", name: "X", steps: [{ command: "system.lock" }] }],
        enabled: true,
        installedAt: 7,
      },
      "not a plugin",
    ]);
    assert.deepEqual(kept.map((plugin) => plugin.id), ["my-plugin"]);
    assert.equal(kept[0].enabled, true);
    assert.equal(kept[0].installedAt, 7);
  });

  test("a missing or nonsense `enabled` reads as off, not on", () => {
    const [stored] = sanitiseInstalledPlugins([{ ...valid(), enabled: "yes", installedAt: 1 }]);
    assert.equal(stored.enabled, false);
  });

  test("duplicate ids in storage collapse to the first", () => {
    const kept = sanitiseInstalledPlugins([valid(), valid()]);
    assert.equal(kept.length, 1);
  });

  test("a value that is not a list reads as empty", () => {
    for (const value of [null, undefined, 42, {}, "plugins"]) {
      assert.deepEqual(sanitiseInstalledPlugins(value), []);
    }
  });
});
