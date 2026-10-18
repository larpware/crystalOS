/*
 * CrystalOS terminal — application resolution tests
 *
 * Run with `npm test` (or `node --test src/apps/terminal/installs.test.mjs`).
 *
 * The install commands make a claim the user can check against the catalogue —
 * "this app exists, here is its version and what it can reach" — and a refusal
 * claim they can check against the real world: "Firefox is native software and
 * CrystalOS cannot install it". Both are worth pinning. The alias and refusal
 * tables are also only as good as their targets, so the tests walk them and
 * fail on a name that points at nothing.
 *
 * Node resolves neither Vite's `@/` alias nor extensionless relative imports,
 * so the hook below maps them the way the bundler does.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const SRC_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A directory is not a module: `@/types` has to reach `types/index.ts`. */
function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

function resolveWithExtensions(base) {
  if (isFile(base)) return base;
  for (const suffix of [".ts", ".tsx", ".js", ".mjs", "/index.ts"]) {
    const candidate = `${base}${suffix}`;
    if (isFile(candidate)) return candidate;
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

const installs = await import("./installs.ts");
const { appCatalog, metaFor } = await import("@/apps/catalog");

describe("resolveApp", () => {
  test("finds an application by its id", () => {
    const resolution = installs.resolveApp("notes");
    assert.equal(resolution.kind, "app");
    if (resolution.kind !== "app") return;
    assert.equal(resolution.meta.id, "notes");
    assert.equal(resolution.matchedBy, "id");
  });

  test("finds an application by its displayed name, case-insensitively", () => {
    const resolution = installs.resolveApp("  crystalos GAMES ");
    assert.equal(resolution.kind, "app");
    if (resolution.kind !== "app") return;
    assert.equal(resolution.meta.id, "games");
    assert.equal(resolution.matchedBy, "name");
  });

  test("resolves an alias and reports which alias was used", () => {
    const resolution = installs.resolveApp("calc");
    assert.equal(resolution.kind, "app");
    if (resolution.kind !== "app") return;
    assert.equal(resolution.meta.id, "calculator");
    assert.equal(resolution.matchedBy, "alias");
    assert.equal(resolution.alias, "calc");
  });

  test("an id wins over anything else that happens to share the name", () => {
    const resolution = installs.resolveApp("media");
    assert.equal(resolution.kind, "app");
    if (resolution.kind !== "app") return;
    assert.equal(resolution.matchedBy, "id");
  });

  test("refuses a native program with a reason, and never an app", () => {
    for (const [token, label] of [
      ["firefox", "Mozilla Firefox"],
      ["chrome", "Google Chrome"],
      ["vlc", "VLC"],
      ["vscode", "Visual Studio Code"],
      ["git", "Git"],
    ]) {
      const resolution = installs.resolveApp(token);
      assert.equal(resolution.kind, "native", `${token} must be refused, not installed`);
      if (resolution.kind !== "native") continue;
      assert.equal(resolution.label, label);
      assert.ok(resolution.reason.length > 5, `${token} explains why`);
    }
  });

  test("reports an unknown name as unknown rather than guessing", () => {
    for (const token of ["spreadsheets", "definitely-not-an-app", ""]) {
      assert.equal(installs.resolveApp(token).kind, "unknown", `${token} must not resolve`);
    }
  });
});

describe("the alias and refusal tables", () => {
  test("every alias points at a real catalogue entry", () => {
    for (const [alias, target] of Object.entries(installs.APP_ALIASES)) {
      assert.ok(metaFor(target), `alias '${alias}' points at '${target}', which is not in the catalogue`);
    }
  });

  test("every 'closest' application in the refusal table exists", () => {
    for (const [token, entry] of Object.entries(installs.NATIVE_ONLY)) {
      if (!entry.closest) continue;
      assert.ok(metaFor(entry.closest), `'${token}' names '${entry.closest}', which is not in the catalogue`);
    }
  });

  test("no refusal shadows a real application or one of its aliases", () => {
    for (const token of Object.keys(installs.NATIVE_ONLY)) {
      assert.ok(!installs.APP_ALIASES[token], `'${token}' is both an alias and a refusal`);
      assert.ok(
        !appCatalog.some((meta) => meta.id === token || meta.name.toLowerCase() === token),
        `'${token}' is both a catalogue application and a refusal`,
      );
    }
  });

  test("the refusal table is keyed in the folded form the lookup uses", () => {
    for (const token of Object.keys(installs.NATIVE_ONLY)) {
      assert.equal(token, token.trim().toLowerCase().replace(/\s+/g, " "), `'${token}' must be folded`);
    }
  });
});

describe("searchApps", () => {
  test("an empty term matches nothing rather than everything", () => {
    assert.deepEqual(installs.searchApps("   "), []);
  });

  test("finds an application by name fragment", () => {
    const results = installs.searchApps("game");
    assert.ok(results.some((meta) => meta.id === "games"), "the games app is found");
  });

  test("finds applications by category label", () => {
    const results = installs.searchApps("internet");
    assert.ok(results.length > 1, "several applications are filed under Internet");
    assert.ok(results.every((meta) => meta.category === "internet"));
  });

  test("finds an application by summary text", () => {
    const results = installs.searchApps("wallpaper");
    assert.ok(results.some((meta) => meta.id === "wallpaper"));
  });

  test("a name match outranks a summary match", () => {
    const results = installs.searchApps("browser");
    assert.equal(results[0].id, "browser", "the application named after the term comes first");
  });
});

describe("the description a user sees before installing", () => {
  test("every catalogue application can describe itself", () => {
    for (const meta of appCatalog) {
      assert.ok(installs.appSource(meta).includes("bundled with CrystalOS"), `${meta.id} says where it comes from`);
      assert.ok(meta.version.length > 0, `${meta.id} has a version`);
    }
  });

  test("every declared capability has a plain-language label", () => {
    for (const meta of appCatalog) {
      const labels = installs.capabilityLabels(meta);
      assert.equal(labels.length, meta.capabilities?.length ?? 0, `${meta.id} labels every capability`);
      for (const label of labels) assert.ok(label.length > 2 && !label.includes("_"), `${meta.id}: '${label}'`);
    }
  });

  test("system applications are not removable and optional ones are", () => {
    for (const meta of appCatalog) {
      assert.equal(installs.isRemovable(meta), !meta.system, `${meta.id} removability follows its system flag`);
    }
    assert.ok(appCatalog.some((meta) => !meta.system), "the catalogue has at least one optional application");
  });
});

describe("staleInstalled", () => {
  test("reports a record that no longer matches the catalogue", () => {
    const notes = metaFor("notes");
    const stale = installs.staleInstalled([{ appId: "notes", version: "0.0.1" }]);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].from, "0.0.1");
    assert.equal(stale[0].to, notes.version);
  });

  test("says nothing about records that already agree", () => {
    const notes = metaFor("notes");
    assert.deepEqual(installs.staleInstalled([{ appId: "notes", version: notes.version }]), []);
  });

  test("ignores an id that is not in the catalogue instead of inventing a version", () => {
    assert.deepEqual(installs.staleInstalled([{ appId: "ghost-app", version: "1.0.0" }]), []);
  });
});
