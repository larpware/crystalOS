/*
 * CrystalOS — VPN client URL contract
 *
 * Every function here is one `fetch` away from the backend, and the shared
 * helper they use defaults to the *accounts* prefix. That default is how
 * `/api/vpn/session` became `/api/accounts/session` in the real app: the
 * request 404'd, the store reported "the server is not reachable", and nothing
 * in the type system objected. A wrong URL is invisible until something asks
 * the network, so the network is what this file asks.
 *
 * The assertions are deliberately about the request line — path, method, body —
 * rather than about the parsed result, because those are the parts a future
 * edit can silently change.
 *
 * Node resolves neither Vite's `@/` alias nor Vite's extensionless relative
 * imports, so the hook below maps them the way the bundler does. It is scoped
 * to this process and exists only so that service modules can be tested without
 * a build step.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

/** `src/`, so `@/services/api` resolves the same way Vite resolves it. */
const SRC_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "../..");

function resolveWithExtensions(base) {
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
  clearEndpoint,
  connect,
  disconnect,
  fetchDiagnostics,
  fetchServers,
  fetchStatus,
  quickConnect,
  reconnect,
  saveEndpoint,
  setEnforce,
  setProvider,
  testEndpoint,
  verifyExit,
} = await import("./client.ts");

/** Requests seen since the last reset. */
let requests = [];
let originalFetch = null;

/** Answers like the backend: JSON, and never with an error payload. */
function respond(payload = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json; charset=utf-8" },
    json: async () => payload,
  };
}

beforeEach(() => {
  requests = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({
      url: String(url),
      method: init.method ?? "GET",
      body: init.body === undefined ? null : JSON.parse(String(init.body)),
    });
    return respond({ status: "disconnected" });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("every VPN call reaches the VPN API", () => {
  test("no call is sent to another API prefix", async () => {
    await fetchStatus();
    await fetchDiagnostics();
    await connect({ country: "CH" });
    await disconnect();
    await reconnect();
    await quickConnect();
    await verifyExit();
    await fetchServers();
    await fetchServers(true);
    await setEnforce(true);
            await setProvider("manual");
    await saveEndpoint({ host: "proxy.example.com", port: 8443 });
    await testEndpoint({ host: "proxy.example.com", port: 8443 });
    await clearEndpoint();

    assert.equal(requests.length, 14);
    for (const request of requests) {
      assert.match(
        request.url,
        /^\/api\/vpn(\/|\?|$)/,
        `${request.method} went to ${request.url} instead of the VPN API`,
      );
      assert.doesNotMatch(request.url, /\/api\/accounts/);
    }
  });

  test("the paths and methods are the ones the backend serves", async () => {
    await fetchStatus();
    await fetchDiagnostics();
    await connect({ country: "CH", city: "Zurich" });
    await disconnect();
    await reconnect({ serverId: "7" });
    await quickConnect();
    await verifyExit();
    await fetchServers();
    await fetchServers(true);
    await setEnforce(false);
            await setProvider("manual");
    await saveEndpoint({ host: "proxy.example.com", port: 8443 });
    await testEndpoint({ host: "proxy.example.com", port: 8443 });
    await clearEndpoint();

    assert.deepEqual(
      requests.map((request) => `${request.method} ${request.url}`),
      [
        "GET /api/vpn",
        "GET /api/vpn/diagnostics",
        "POST /api/vpn/connect",
        "POST /api/vpn/disconnect",
        "POST /api/vpn/reconnect",
        "POST /api/vpn/quick-connect",
        "POST /api/vpn/verify",
        "GET /api/vpn/servers",
        "GET /api/vpn/servers?refresh=1",
        "POST /api/vpn/settings",
        "POST /api/vpn/provider",
        "POST /api/vpn/endpoint",
        "POST /api/vpn/endpoint/test",
        "DELETE /api/vpn/endpoint",
      ],
    );
  });

  test("the account-free endpoint calls carry the endpoint body the backend reads", async () => {
    const endpoint = {
      scheme: "https",
      host: "proxy.example.com",
      port: 8443,
      username: "crystalvpn-user",
      password: "crystalvpn-token",
      name: "CrystalVPN — Frankfurt",
      checkUrl: "http://check.example.net/ip",
    };

    await setProvider("manual");
    await saveEndpoint(endpoint);
    await testEndpoint(endpoint);

    assert.deepEqual(requests[0].body, { provider: "manual" });
    assert.deepEqual(requests[1].body, endpoint);
    assert.deepEqual(requests[2].body, endpoint);

    // An endpoint with no credentials must still be a JSON body, not a blank one.
    requests = [];
    await saveEndpoint({ host: "proxy.example.com" });
    assert.deepEqual(requests[0].body, { host: "proxy.example.com" });

    requests = [];
    await clearEndpoint();
    assert.equal(requests[0].method, "DELETE");
    assert.equal(requests[0].body, null);
  });

  test("a preference is sent as a body the backend can read", async () => {
    await connect({ country: "us", serverId: "42" });
    assert.deepEqual(requests[0].body, { country: "us", serverId: "42" });

    // No preference must still be a JSON body: the API reads the body for every
    // mutating route and rejects a request that does not carry one.
    requests = [];
    await connect();
    assert.deepEqual(requests[0].body, {});
  });

  test("an unreachable backend is reported as offline, not as a VPN state", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    const result = await fetchStatus();
    assert.equal(result.ok, false);
    assert.equal(result.error.offline, true);
    assert.equal(result.error.code, "SERVER_UNREACHABLE");
  });

  test("the backend's own error survives intact", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 502,
      headers: { get: () => "application/json" },
      json: async () => ({
        error: { code: "SERVER_LIST_UNAVAILABLE", message: "The proxy is not answering." },
      }),
    });
    const result = await fetchServers();
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "SERVER_LIST_UNAVAILABLE");
    assert.equal(result.error.message, "The proxy is not answering.");
    assert.equal(result.error.status, 502);
  });
});
