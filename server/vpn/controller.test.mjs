/*
 * CrystalOS — VPN controller tests
 *
 * The controller is the single source of truth and the place a routing mistake
 * becomes a leak, so these are the tests with teeth. Proton, the tunnel and the
 * session file are all injected, which means every branch — including the ones
 * that only happen when Proton misbehaves — can be exercised without a network
 * and without credentials.
 *
 * The behaviours pinned here:
 *   • "connected" is never published without a real authenticated tunnel;
 *   • enforcement blocks rather than downgrades;
 *   • an expired session stops claiming to be connected;
 *   • two overlapping operations cannot interleave;
 *   • the snapshot never carries a credential.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createVpnController, ERROR, STATUS } from "./controller.mjs";
import { ProtonError } from "./proton.mjs";

const SESSION = { uid: "uid-1", accessToken: "access-1", refreshToken: "refresh-1" };

/** A connectable logical, shaped like Proton's V2 payload. */
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

function memorySessionStore(initial = null) {
  let current = initial;
  return {
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
}

function fakeProton(overrides = {}) {
  const calls = { refresh: 0, browserToken: 0, logicals: 0, location: 0 };
  const client = {
    async refresh(session) {
      calls.refresh += 1;
      return { ...session, accessToken: "access-2", refreshToken: "refresh-2" };
    },
    async browserToken() {
      calls.browserToken += 1;
      return { username: "proxy-user", password: "proxy-pass", expiresAt: Date.now() + 20 * 60_000 };
    },
    async logicals() {
      calls.logicals += 1;
      return [logical()];
    },
    async location() {
      calls.location += 1;
      return { IP: "198.51.100.7", Country: "GB", ISP: "Home ISP" };
    },
    ...overrides,
  };
  return { client, calls };
}

/** The tunnel records what it was asked to do and answers as configured. */
function fakeTunnel({ exitIp = "203.0.113.9", handshakeError = null, requestError = null } = {}) {
  const opened = [];
  const requested = [];
  return {
    opened,
    requested,
    tunnel: {
      async openConnectTunnel({ proxy, target }) {
        if (handshakeError) throw handshakeError;
        opened.push({ proxy, target });
        return { socket: { destroy() {} }, reader: { takeRest() {} } };
      },
      async requestThroughTunnel(options) {
        if (requestError) throw requestError;
        requested.push(options);
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({ IP: exitIp, Country: "CH", ISP: "Proton AG" }),
        };
      },
    },
  };
}

function build({ session = SESSION, proton, tunnel } = {}) {
  const sessionStore = memorySessionStore(session);
  const protonParts = proton ?? fakeProton();
  const tunnelParts = tunnel ?? fakeTunnel();
  const controller = createVpnController({
    sessionStore,
    proton: protonParts.client,
    tunnel: tunnelParts.tunnel,
  });
  return { controller, sessionStore, proton: protonParts, tunnelParts };
}

/** Lets the connect-time egress check (deliberately not awaited) finish. */
async function settle(predicate) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return false;
}

describe("connect", () => {
  test("with no session it reports that signing in is required, not a generic failure", async () => {
    const { controller } = build({ session: null });
    const snapshot = await controller.connect();
    assert.equal(snapshot.status, STATUS.error);
    assert.equal(snapshot.error.code, ERROR.SIGN_IN_REQUIRED);
    assert.equal(snapshot.signedIn, false);
    assert.equal(snapshot.server, null);
    // The user asked for protection, so the intent is recorded even though the
    // connection failed — that is what makes enforcement meaningful.
    assert.equal(snapshot.enabled, true);
  });

  test("a successful connect publishes a real server and an authenticated tunnel", async () => {
    const { controller, tunnelParts } = build();
    const snapshot = await controller.connect();

    assert.equal(snapshot.status, STATUS.connected);
    assert.equal(snapshot.server.name, "US-NY#1");
    assert.equal(snapshot.server.exitIp, "203.0.113.9");
    assert.equal(snapshot.verified.tunnel.ok, true);
    assert.equal(snapshot.server.proxyHost, "us-ny-101.protonvpn.net");
    assert.equal(snapshot.server.proxyPort, 4454);
    // A real CONNECT was attempted against Proton's own API host.
    assert.equal(tunnelParts.opened.length, 1);
    assert.equal(tunnelParts.opened[0].target.host, "account.proton.me");
  });

  test("the snapshot never carries a credential", async () => {
    const { controller } = build();
    await controller.connect();
    const serialized = JSON.stringify(controller.snapshot());
    assert.equal(serialized.includes("proxy-user"), false);
    assert.equal(serialized.includes("proxy-pass"), false);
    assert.equal(serialized.includes("access-1"), false);
    assert.equal(serialized.includes("refresh-1"), false);
    // The expiry is fine to expose; the value is not.
    assert.equal(typeof controller.snapshot().credentialsExpireAt, "number");
  });

  test("credential minting failure is reported rather than retried forever", async () => {
    const proton = {
      client: fakeProton({
        async browserToken() {
          throw new ProtonError("nope", { httpStatus: 403, code: 403 });
        },
      }).client,
      calls: null,
    };
    const { controller } = build({ proton: { client: proton.client } });
    const snapshot = await controller.connect();
    assert.equal(snapshot.status, STATUS.error);
    assert.ok(snapshot.error);
    assert.equal(snapshot.server, null);
  });

  test("an expired session drops the signed-in state instead of looping", async () => {
    const proton = fakeProton({
      async refresh() {
        throw new ProtonError("invalid refresh token", { code: 10013, needsLogout: true });
      },
    });
    const { controller } = build({ proton });
    const snapshot = await controller.connect();
    assert.equal(snapshot.error.code, ERROR.SESSION_EXPIRED);
    assert.equal(snapshot.signedIn, false);
  });

  test("a plan with no connectable server explains why", async () => {
    const proton = fakeProton({ async logicals() { return [logical({ Tier: 4 })]; } });
    const { controller } = build({ proton });
    const snapshot = await controller.connect();
    assert.equal(snapshot.status, STATUS.error);
    assert.match(snapshot.error.message, /browser proxy/);
  });

  test("an unreachable proxy is a connect failure, not a connection", async () => {
    const tunnel = fakeTunnel({ handshakeError: new Error("Timed out reaching the VPN server's proxy.") });
    const { controller } = build({ tunnel });
    const snapshot = await controller.connect();
    assert.equal(snapshot.status, STATUS.error);
    assert.equal(snapshot.server, null);
    assert.equal(snapshot.verified.tunnel, null);
  });

  test("overlapping connect attempts are serialised, not interleaved", async () => {
    const { controller, proton } = build();
    const first = controller.connect();
    const second = controller.connect();
    assert.equal(first, second, "a second call must reuse the in-flight attempt");
    await first;
    assert.equal(proton.calls.browserToken, 1, "credentials were minted once, not once per click");
  });

  test("an explicit server id overrides the usual choice", async () => {
    const proton = fakeProton({
      async logicals() {
        return [
          logical({ ID: "cheap", Name: "DE-FRA#1", ExitCountry: "DE", StatusReference: { Cost: 1 } }),
          logical({ ID: "wanted", Name: "US-NY#1", StatusReference: { Cost: 90 } }),
        ];
      },
    });
    const { controller } = build({ proton });
    const snapshot = await controller.connect({ id: "wanted" });
    assert.equal(snapshot.server.name, "US-NY#1");
  });
});

describe("egress verification", () => {
  test("a different exit address is verified and recorded", async () => {
    const { controller } = build({ tunnel: fakeTunnel({ exitIp: "203.0.113.9" }) });
    await controller.connect();
    assert.ok(await settle(() => controller.snapshot().verified.egress !== null));

    const egress = controller.snapshot().verified.egress;
    assert.equal(egress.ok, true);
    assert.equal(egress.conclusive, true);
    assert.equal(egress.exitIp, "203.0.113.9");
    assert.equal(egress.directIp, "198.51.100.7");
    assert.equal(controller.snapshot().status, STATUS.connected);
  });

  test("an exit address identical to the direct one is a conclusive failure", async () => {
    const { controller } = build({ tunnel: fakeTunnel({ exitIp: "198.51.100.7" }) });
    await controller.connect();
    assert.ok(await settle(() => controller.snapshot().status === STATUS.error));

    const snapshot = controller.snapshot();
    assert.equal(snapshot.error.code, ERROR.EXIT_NOT_VPN);
    assert.equal(snapshot.server, null);
    assert.equal(snapshot.connectedSince, null);
  });

  test("a check that cannot run is recorded as unknown, not as a failure", async () => {
    const { controller } = build({ tunnel: fakeTunnel({ requestError: new Error("proxy refused the CONNECT") }) });
    await controller.connect();
    assert.ok(await settle(() => controller.snapshot().verified.egress !== null));

    const egress = controller.snapshot().verified.egress;
    assert.equal(egress.conclusive, false);
    assert.equal(egress.ok, false);
    assert.match(egress.reason, /refused/);
    // The connection itself stands: the tunnel handshake succeeded.
    assert.equal(controller.snapshot().status, STATUS.connected);
  });
});

describe("decideRoute", () => {
  test("Proton's own API host is never tunnelled", async () => {
    const { controller } = build();
    await controller.connect();
    for (const host of ["account.proton.me", "api.proton.me", "sub.protonvpn.com"]) {
      assert.equal((await controller.decideRoute(host, 443)).mode, "direct", host);
    }
  });

  test("loopback and private addresses are never tunnelled", async () => {
    const { controller } = build();
    await controller.connect();
    for (const host of ["localhost", "127.0.0.1", "10.0.0.4", "192.168.0.2", "fd00::1"]) {
      assert.equal((await controller.decideRoute(host, 8787)).mode, "direct", host);
    }
  });

  test("the proxy's own host is never tunnelled through itself", async () => {
    const { controller } = build();
    await controller.connect();
    assert.equal((await controller.decideRoute("us-ny-101.protonvpn.net", 443)).mode, "direct");
  });

  test("while connected, ordinary traffic is tunnelled with Basic credentials", async () => {
    const { controller } = build();
    await controller.connect();
    const decision = await controller.decideRoute("example.com", 443);
    assert.equal(decision.mode, "proxy");
    assert.equal(decision.proxy.host, "us-ny-101.protonvpn.net");
    assert.equal(decision.proxy.port, 4454);
    assert.equal(
      decision.proxy.authorization,
      `Basic ${Buffer.from("proxy-user:proxy-pass").toString("base64")}`,
    );
  });

  test("with enforcement on and no connection, traffic is blocked — never sent direct", async () => {
    const { controller } = build({ session: null });
    await controller.connect();
    assert.equal(controller.snapshot().status, STATUS.error);

    const decision = await controller.decideRoute("example.com", 443);
    assert.equal(decision.mode, "block");
    assert.match(decision.reason, /blocked/i);
  });

  test("enforcement off allows a direct dial and says it is unprotected", async () => {
    const { controller } = build({ session: null });
    await controller.connect();
    controller.setEnforce(false);
    assert.equal((await controller.decideRoute("example.com", 443)).mode, "direct");
  });

  test("with the VPN off, routing is untouched", async () => {
    const { controller } = build();
    assert.equal((await controller.decideRoute("example.com", 443)).mode, "direct");
    assert.equal(controller.snapshot().status, STATUS.disconnected);
  });

  test("after a disconnect there is no stale tunnel decision", async () => {
    const { controller } = build();
    await controller.connect();
    await controller.disconnect();
    const snapshot = controller.snapshot();
    assert.equal(snapshot.status, STATUS.disconnected);
    assert.equal(snapshot.server, null);
    assert.equal(snapshot.enabled, false);
    assert.equal((await controller.decideRoute("example.com", 443)).mode, "direct");
  });

  test("credentials that cannot be re-minted stop the connection claiming to be up", async () => {
    let mint = 0;
    const proton = fakeProton({
      async browserToken() {
        mint += 1;
        if (mint > 1) throw new ProtonError("invalid token", { code: 10013, needsLogout: true });
        return { username: "u", password: "p", expiresAt: Date.now() + 30 };
      },
    });
    const { controller } = build({ proton });
    await controller.connect();
    assert.equal(controller.snapshot().status, STATUS.connected);

    // Force the credentials to be considered stale, then ask to route.
    const decision = await controller.decideRoute("example.com", 443);
    assert.equal(decision.mode, "block");
    assert.equal(controller.snapshot().status, STATUS.error);
    assert.equal(controller.snapshot().error.code, ERROR.SESSION_EXPIRED);
  });
});

describe("session and settings", () => {
  test("signIn stores a session and reports it without the tokens", async () => {
    const { controller } = build({ session: null });
    const snapshot = await controller.signIn(SESSION);
    assert.equal(snapshot.signedIn, true);
    assert.equal(snapshot.uid, "uid-1");
    assert.equal(JSON.stringify(snapshot).includes("refresh-1"), false);
  });

  test("signOut clears the session, the server and the enforcement state", async () => {
    const { controller } = build();
    await controller.connect();
    const snapshot = await controller.signOut();
    assert.equal(snapshot.signedIn, false);
    assert.equal(snapshot.status, STATUS.disconnected);
    assert.equal(snapshot.enabled, false);
    assert.equal(snapshot.server, null);
    assert.equal((await controller.decideRoute("example.com", 443)).mode, "direct");
  });

  test("turning enforcement off clears the error it was holding traffic for", async () => {
    const { controller } = build({ session: null });
    await controller.connect();
    assert.ok(controller.snapshot().error);
    controller.setEnforce(false);
    assert.equal(controller.snapshot().error, null);
  });

  test("a reconnect reuses the same preference and re-mints credentials", async () => {
    const { controller, proton } = build();
    await controller.connect();
    const before = proton.calls.browserToken;
    await controller.reconnect();
    assert.equal(controller.snapshot().status, STATUS.connected);
    assert.ok(proton.calls.browserToken > before);
  });

  test("a failed reconnect leaves an honest error rather than a stale connected state", async () => {
    let mint = 0;
    const proton = fakeProton({
      async browserToken() {
        mint += 1;
        if (mint > 1) throw new Error("the proxy is gone");
        return { username: "u", password: "p", expiresAt: Date.now() + 10 * 60_000 };
      },
    });
    const { controller } = build({ proton });
    await controller.connect();
    await controller.reconnect();
    assert.equal(controller.snapshot().status, STATUS.error);
    assert.equal(controller.snapshot().server, null);
  });
});

describe("coverage reporting", () => {
  test("only the Scramjet path is ever described as protected", async () => {
    const { controller } = build();
    await controller.connect();
    const coverage = controller.snapshot().coverage;
    assert.equal(coverage.scramjetTraffic, "protected");
    assert.equal(coverage.directBrowserTabs, "unprotected");
    assert.equal(coverage.shellRequests, "unprotected");
    assert.equal(coverage.hostApplications, "out-of-scope");
  });

  test("while enforcing and disconnected the same path is reported blocked", async () => {
    const { controller } = build({ session: null });
    await controller.connect();
    assert.equal(controller.snapshot().coverage.scramjetTraffic, "blocked");
  });
});
