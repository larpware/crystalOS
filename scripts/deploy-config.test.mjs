/*
 * Tests for the build-time deployment wiring (scripts/deploy-config.mjs).
 *
 * This script is the thing that decides whether a host gets working accounts:
 * it writes the proxy rules (a host that can proxy) or the runtime origin (a
 * host that cannot), and it refuses to publish a site whose /api/* has nowhere
 * to go. Everything here uses throwaway directories.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EXTRA_BACKEND_PATHS,
  parseBackendUrl,
  redirectRules,
  runtimeConfig,
  writeDeployConfig,
} from "./deploy-config.mjs";

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "crystal-deploy-"));
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
  return dir;
}

const sink = { write() {} };

test("parseBackendUrl accepts an origin and rejects everything that is not one", () => {
  assert.deepEqual(parseBackendUrl("https://crystalos-api.example.com"), {
    ok: true,
    origin: "https://crystalos-api.example.com",
  });
  // A path is dropped rather than trusted, so rules always append their own.
  assert.equal(parseBackendUrl("https://api.example.com/ignored/path").origin, "https://api.example.com");
  assert.equal(parseBackendUrl("not a url").ok, false);
  assert.equal(parseBackendUrl("ftp://api.example.com").ok, false);
  assert.equal(parseBackendUrl("https://api.example.com?query=1").ok, false);
  assert.equal(parseBackendUrl("").ok, false);
});

test("a backend on the build machine is refused for a public host", () => {
  const local = parseBackendUrl("http://localhost:8787", { rejectPrivate: true });
  assert.equal(local.ok, false);
  assert.match(local.problem, /unreachable from the CDN edge/);
  // …but the same value is fine when nothing public is implied (local preview).
  assert.equal(parseBackendUrl("http://localhost:8787").ok, true);
});

test("redirect rules cover the API and every backend path the shell requests", () => {
  const rules = redirectRules("https://api.example.com");
  assert.match(rules, /^\/api\/\* https:\/\/api\.example\.com\/api\/:splat 200$/m);
  for (const entry of EXTRA_BACKEND_PATHS) {
    assert.ok(
      rules.includes(`${entry.from} https://api.example.com${entry.to} 200`),
      `${entry.from} is proxied`,
    );
  }
  assert.ok(rules.startsWith("#"), "the file explains itself");
});

test("runtimeConfig writes the JSON the shell reads at runtime", () => {
  assert.deepEqual(JSON.parse(runtimeConfig("https://api.example.com")), {
    apiOrigin: "https://api.example.com",
  });
});

test("a host that can proxy gets _redirects, and nothing else", (t) => {
  const dir = scratch(t);
  const result = writeDeployConfig({
    backendUrl: "https://api.example.com",
    outDir: dir,
    isNetlify: true,
    stdout: sink,
    stderr: sink,
  });
  assert.equal(result.ok, true);
  assert.equal(result.redirects, true);
  assert.equal(result.config, false);
  assert.ok(existsSync(join(dir, "_redirects")));
  assert.ok(!existsSync(join(dir, "config.json")), "no direct-origin file when proxying");
});

test("a host that cannot proxy gets config.json, and the proxy is skipped", (t) => {
  const dir = scratch(t);
  const result = writeDeployConfig({
    backendUrl: "https://api.example.com",
    apiOrigin: "https://api.example.com",
    outDir: dir,
    isNetlify: false,
    stdout: sink,
    stderr: sink,
  });
  assert.equal(result.ok, true);
  assert.equal(result.config, true);
  assert.equal(result.redirects, false, "the direct origin wins, so no proxy rules are written");
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")), {
    apiOrigin: "https://api.example.com",
  });
});

test("a Netlify build with nowhere for /api/* to go fails loudly", (t) => {
  const dir = scratch(t);
  const errors = [];
  const result = writeDeployConfig({
    backendUrl: "",
    apiOrigin: "",
    outDir: dir,
    isNetlify: true,
    stdout: sink,
    stderr: { write: (text) => errors.push(text) },
  });
  assert.equal(result.ok, false);
  assert.match(errors.join(""), /account service would be dead on deploy/);
  assert.match(errors.join(""), /CRESCENT_BACKEND_URL/, "it names the variable to set");
});

test("the same silence is allowed off Netlify, and with the explicit opt-out", (t) => {
  const plain = scratch(t);
  assert.equal(
    writeDeployConfig({
      backendUrl: "",
      apiOrigin: "",
      outDir: plain,
      isNetlify: false,
      stdout: sink,
      stderr: sink,
    }).ok,
    true,
    "a static host keeps same-origin defaults",
  );

  const opted = scratch(t);
  assert.equal(
    writeDeployConfig({
      backendUrl: "",
      apiOrigin: "",
      outDir: opted,
      isNetlify: true,
      allowNoBackend: true,
      stdout: sink,
      stderr: sink,
    }).ok,
    true,
    "CRESCENT_ALLOW_NO_BACKEND=1 is honoured",
  );
});

test("a localhost backend cannot be published through a Netlify proxy", (t) => {
  const dir = scratch(t);
  const errors = [];
  const result = writeDeployConfig({
    backendUrl: "http://localhost:8787",
    outDir: dir,
    isNetlify: true,
    stdout: sink,
    stderr: { write: (text) => errors.push(text) },
  });
  assert.equal(result.ok, false);
  assert.match(errors.join(""), /unreachable from the CDN edge/);
  assert.ok(!existsSync(join(dir, "_redirects")), "no misleading rules were written");
});
