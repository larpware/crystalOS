/*
 * CrystalOS — VPN API tests
 *
 * Run with `node --test server/vpn/api.test.mjs`.
 *
 * Real HTTP against a real server, because the parts worth checking here are
 * HTTP-shaped: the route table, the same-origin guard on writes, body limits and
 * the error envelope the frontend's `apiRequest` already understands. The
 * controller itself is exercised in controller.test.mjs, so it is injected here
 * with a fake Proton — no credentials, no network.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createVpnApi } from "./api.mjs";
import { createVpnController } from "./controller.mjs";

const SESSION = { uid: "uid-9", accessToken: "access-9", refreshToken: "refresh-9" };

function logical(overrides = {}) {
  return {
    ID: "logical-us",
    Name: "US-NY#1",
    Tier: 1,
    Features: 0,
    EntryCountry: "US",
    ExitCountry: "US",
    City: "New York",
    Domain: "us-ny-01.protonvpn.net",
    StatusReference: { Cost: 10 },
    Servers: [{ ID: "s1", Domain: "us-ny-101.protonvpn.net", Label: "101", Load: 5, Status: 1, ExitIP: "203.0.113.9" }],
    ...overrides,
  };
}

let server;
let origin;

before(async () => {
  let current = null;
  const sessionStore = {
    load: async () => current,
    save: async (session) => {
      if (!session?.uid || !session?.refreshToken) throw new Error("That session has no refresh token.");
      current = { ...session };
      return current;
    },
    clear: async () => {
      current = null;
    },
    describe: async () => ({ signedIn: Boolean(current), uid: current?.uid ?? null, updatedAt: null }),
  };

  const proton = {
    refresh: async (session) => ({ ...session, accessToken: "access-10" }),
    browserToken: async () => ({ username: "u", password: "p", expiresAt: Date.now() + 600_000 }),
    logicals: async () => [logical()],
    location: async () => ({ IP: "198.51.100.7" }),
  };

  const tunnel = {
    openConnectTunnel: async () => ({ socket: { destroy() {} }, reader: { takeRest() {} } }),
    requestThroughTunnel: async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ IP: "203.0.113.9" }),
    }),
  };

  const controller = createVpnController({ sessionStore, proton, tunnel });
  const api = createVpnApi({ controller, sessionStore, proton });

  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (await api.handle(req, res, url)) return;
    res.writeHead(404, { "content-type": "text/plain" }).end("no");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function post(path, body, headers = {}) {
  return fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });
}

describe("GET routes", () => {
  test("the status route carries the transport, the scope and the coverage map", async () => {
    const response = await fetch(`${origin}/api/vpn`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "disconnected");
    assert.equal(body.enforce, true);
    assert.equal(body.transport.kind, "proton-browser-proxy");
    assert.equal(body.transport.protocol, "CONNECT");
    assert.equal(body.transport.scope, "crescent-scramjet-traffic");
    assert.equal(body.coverage.hostApplications, "out-of-scope");
  });

  test("diagnostics state the mechanism and never a secret", async () => {
    const body = await (await fetch(`${origin}/api/vpn/diagnostics`)).json();
    assert.equal(body.transport.protocol, "CONNECT");
    assert.ok(body.transport.notes.some((note) => /not the whole device/.test(note)));
    assert.equal(JSON.stringify(body).includes("refresh-9"), false);
  });

  test("an unknown route answers in the shared error envelope", async () => {
    const response = await fetch(`${origin}/api/vpn/does-not-exist`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, "NOT_FOUND");
    assert.equal(typeof body.error.message, "string");
  });

  test("an unrelated path is left for the rest of the backend", async () => {
    const response = await fetch(`${origin}/api/accounts/me`);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "no");
  });
});

describe("write protection", () => {
  test("a cross-origin write is refused", async () => {
    const response = await post("/api/vpn/connect", {}, { origin: "https://evil.example" });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "CROSS_ORIGIN");
  });

  test("a same-origin write is allowed", async () => {
    const response = await post("/api/vpn/connect", {}, { origin });
    assert.equal(response.status, 200);
  });

  test("a non-JSON body is refused rather than parsed", async () => {
    const response = await fetch(`${origin}/api/vpn/connect`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "nope",
    });
    assert.equal(response.status, 415);
    assert.equal((await response.json()).error.code, "UNSUPPORTED_MEDIA_TYPE");
  });

  test("an oversized body is refused", async () => {
    const response = await post("/api/vpn/session", { uid: "x".repeat(20_000) });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, "BODY_TOO_LARGE");
  });
});

describe("session routes", () => {
  test("a session without a refresh token is rejected with a specific reason", async () => {
    const response = await post("/api/vpn/session", { uid: "uid-9", accessToken: "a" });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, "INVALID_SESSION");
    assert.match(body.error.message, /refresh token/);
  });

  test("a well-formed session is stored and reported as signed in", async () => {
    const response = await post("/api/vpn/session", SESSION);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.signedIn, true);
    assert.equal(body.uid, "uid-9");
    // The reply carries the session id but never either token.
    assert.equal(JSON.stringify(body).includes("access-9"), false);
    assert.equal(JSON.stringify(body).includes("refresh-9"), false);
  });

  test("the server list is served from the catalogue", async () => {
    const body = await (await fetch(`${origin}/api/vpn/servers`)).json();
    assert.equal(body.servers.length, 1);
    assert.equal(body.servers[0].name, "US-NY#1");
  });

  test("signing out clears the session", async () => {
    await post("/api/vpn/session", SESSION);
    const response = await fetch(`${origin}/api/vpn/session`, { method: "DELETE" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.signedIn, false);
    assert.equal(body.uid, null);
  });

  test("without a signed-in session the server list explains itself instead of erroring", async () => {
    const body = await (await fetch(`${origin}/api/vpn/servers`)).json();
    assert.deepEqual(body.servers, []);
    assert.match(body.reason, /Sign in/);
  });
});

describe("connection routes", () => {
  test("connect with no session answers 200 with an error state, not a fake success", async () => {
    const response = await post("/api/vpn/connect", {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "error");
    assert.equal(body.error.code, "SIGN_IN_REQUIRED");
    assert.equal(body.server, null);
  });

  test("a connect that succeeds reports the real server and the tunnel check", async () => {
    await post("/api/vpn/session", SESSION);
    const body = await (await post("/api/vpn/connect", { country: "US" })).json();
    assert.equal(body.status, "connected");
    assert.equal(body.server.name, "US-NY#1");
    assert.equal(body.server.proxyHost, "us-ny-101.protonvpn.net");
    assert.equal(body.verified.tunnel.ok, true);
    // The egress check runs after the connection is usable, so it may not have
    // landed yet — but it must never be claimed before it has.
    if (body.verified.egress) assert.equal(body.verified.egress.conclusive, true);
  });

  test("verify on a connected tunnel returns a measured result", async () => {
    const body = await (await post("/api/vpn/verify", {})).json();
    assert.equal(body.verification.ok, true);
    assert.equal(body.verification.exitIp, "203.0.113.9");
    assert.equal(body.verification.directIp, "198.51.100.7");
  });

  test("disconnect clears the server and turns enforcement state off honestly", async () => {
    const body = await (await post("/api/vpn/disconnect", {})).json();
    assert.equal(body.status, "disconnected");
    assert.equal(body.enabled, false);
    assert.equal(body.server, null);
  });

  test("verify while disconnected is a conflict, not a fabricated pass", async () => {
    const response = await post("/api/vpn/verify", {});
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "NOT_CONNECTED");
  });

  test("the enforcement setting is applied and reflected", async () => {
    const off = await (await post("/api/vpn/settings", { enforce: false })).json();
    assert.equal(off.enforce, false);
    const on = await (await post("/api/vpn/settings", { enforce: true })).json();
    assert.equal(on.enforce, true);
  });
});

describe("country-aware routes", () => {
  test("the country list leads with 'anywhere' and never promises availability", async () => {
    const response = await fetch(`${origin}/api/vpn/countries`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.countries[0].code, "");
    assert.ok(body.countries.some((entry) => entry.code === "DE"));
    assert.match(body.note, /availability varies/i);
  });

  test("a malformed country is a 400, not a silently worldwide scan", async () => {
    const response = await post("/api/vpn/quick-connect", { country: "USA" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_COUNTRY");
  });

  test("quick-connect without a pool is an honest error state at 200", async () => {
    const response = await post("/api/vpn/quick-connect", { country: "DE" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "error");
    assert.equal(body.error.code, "NO_PROXY_FOUND");
    assert.equal(body.preference.country, "DE");
  });
});
