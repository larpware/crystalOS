/*
 * CrystalOS — plugin registration tests
 *
 * Run with `npm test` (or `node --test src/services/plugins/registry.test.mjs`).
 *
 * These are about the join between the plugin store and the one command
 * registry: what appears in the palette when a plugin is installed, and — the
 * part that is easy to get wrong — what disappears when it is switched off or
 * removed. An uninstall that left the plugin's commands behind would leave a
 * user able to run code from something they had deleted, which is why there is
 * a test for it rather than a comment.
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

/** `src/`, so `@/services/plugins/registry` resolves the way Vite resolves it. */
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

const { hasCommand, registerCommand, runCommand } = await import("@/services/commands");
const { startPluginCommands, syncPluginCommands } = await import("@/services/plugins/registry");
const { normalisePlugin } = await import("@/services/plugins/manifest");
const { usePluginStore } = await import("@/services/plugins/store");

/** Records what ran, so step order can be asserted rather than assumed. */
const ran = [];

function manifest(overrides = {}) {
  return {
    id: "test-plugin",
    name: "Test plugin",
    version: "1.0.0",
    permissions: ["window", "notify"],
    commands: [
      {
        id: "first",
        name: "Test: first",
        steps: [{ command: "window.probe-one" }, { command: "window.probe-two" }],
      },
    ],
    ...overrides,
  };
}

const validated = (input) => {
  const result = normalisePlugin(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.plugin;
};

beforeEach(() => {
  usePluginStore.getState().reset();
  syncPluginCommands(true);
  ran.length = 0;
  // The probe commands registered above are the fixtures; they are deliberately
  // not unregistered here, since the plugin steps need something to point at.
});

registerCommand(
  { id: "window.probe-one", name: "Probe one", category: "System", run: () => void ran.push("one") },
  { owner: "test-probes" },
);
registerCommand(
  { id: "window.probe-two", name: "Probe two", category: "System", run: () => void ran.push("two") },
  { owner: "test-probes" },
);

/* The same call the entry point makes. Registration follows the store from
   here on, which is the behaviour most of these tests are about. */
startPluginCommands();

describe("installing", () => {
  test("registers each command under a namespaced id", () => {
    usePluginStore.getState().install(validated(manifest()));
    syncPluginCommands(true);
    assert.equal(hasCommand("plugin.test-plugin.first"), true);
    assert.equal(hasCommand("plugin.test-plugin.second"), false);
  });

  test("a disabled plugin contributes nothing", () => {
    usePluginStore.getState().install(validated(manifest()));
    usePluginStore.getState().setEnabled("test-plugin", false);
    assert.equal(hasCommand("plugin.test-plugin.first"), false);
  });

  test("switching a plugin back on restores its commands", () => {
    usePluginStore.getState().install(validated(manifest()));
    usePluginStore.getState().setEnabled("test-plugin", false);
    usePluginStore.getState().setEnabled("test-plugin", true);
    assert.equal(hasCommand("plugin.test-plugin.first"), true);
  });

  test("the store's own writes are what drive it, with no explicit sync", () => {
    usePluginStore.getState().install(validated(manifest()));
    assert.equal(hasCommand("plugin.test-plugin.first"), true);
  });
});

describe("removing", () => {
  test("takes the plugin's commands out of the registry", () => {
    usePluginStore.getState().install(validated(manifest()));
    assert.equal(hasCommand("plugin.test-plugin.first"), true);

    usePluginStore.getState().remove("test-plugin");

    // The regression this exists for: the sync used to clear owners only for
    // plugins still in the store, so the commands of a removed plugin survived
    // it and stayed runnable from the palette.
    assert.equal(hasCommand("plugin.test-plugin.first"), false);
    assert.equal(hasCommand("plugin.test-plugin.other"), false);
  });

  test("removing one plugin leaves another plugin's commands alone", () => {
    usePluginStore.getState().install(validated(manifest()));
    usePluginStore.getState().install(validated(manifest({ id: "keeper", name: "Keeper" })));
    assert.equal(hasCommand("plugin.keeper.first"), true);

    usePluginStore.getState().remove("test-plugin");

    assert.equal(hasCommand("plugin.test-plugin.first"), false);
    assert.equal(hasCommand("plugin.keeper.first"), true);
  });

  test("a removed plugin's command cannot be run afterwards", async () => {
    usePluginStore.getState().install(validated(manifest()));
    usePluginStore.getState().remove("test-plugin");
    const result = await runCommand("plugin.test-plugin.first");
    assert.equal(result.ok, false);
    assert.match(result.error, /not registered/i);
  });
});

describe("running a plugin command", () => {
  test("runs its steps in order", async () => {
    usePluginStore.getState().install(validated(manifest()));
    const result = await runCommand("plugin.test-plugin.first");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(ran, ["one", "two"]);
  });

  test("reports which step failed and stops there", async () => {
    usePluginStore.getState().install(
      validated(manifest({
        commands: [{ id: "first", name: "Test: first", steps: [{ command: "window.probe-one" }] }],
      })),
    );
    // A plugin whose steps no longer match its permissions cannot come from a
    // manifest on this build, but it can come from storage written by another
    // build — so the run-time guard is exercised the same way that would.
    const [installed] = usePluginStore.getState().plugins;
    usePluginStore.setState({ plugins: [{ ...installed, permissions: ["notify"] }] });
    syncPluginCommands(true);

    const result = await runCommand("plugin.test-plugin.first");
    assert.equal(result.ok, false);
    assert.match(result.error, /not allowed to run/i);
    assert.deepEqual(ran, [], "nothing should run when a step is refused");
  });

  test("a step naming a command that is missing fails loudly", async () => {
    usePluginStore.getState().install(
      validated(manifest({
        commands: [{ id: "first", name: "Test: first", steps: [{ command: "window.probe-gone" }] }],
      })),
    );
    const result = await runCommand("plugin.test-plugin.first");
    assert.equal(result.ok, false);
    assert.match(result.error, /not available/i);
  });
});
