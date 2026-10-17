/*
 * CrystalOS — VPN coverage tests
 *
 * Run with `npm test` (or `node --test src/services/vpn/coverage.test.mjs`).
 *
 * coverage.ts imports only types at runtime, so the Node test runner can load
 * it directly.
 *
 * These cover the part of the integration most likely to lie: what the OS is
 * allowed to claim. The rule is that `protected` requires a real connection
 * *and* a path the tunnel actually carries, and that nothing else may be
 * dressed up as protection — including the case where the VPN is on, broken,
 * and the correct answer is "blocked".
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveCoverage, isEnforcing, isVpnLocked, protectionLabel, providerAppId, providerName } from "./coverage.ts";

/** A snapshot shaped exactly like the backend controller's. */
function snapshot(overrides = {}) {
  return {
    status: "disconnected",
    enabled: false,
    enforce: true,
    signedIn: false,
    uid: null,
    provider: "manual",
    endpoint: null,
    server: null,
    verified: { tunnel: null, egress: null },
    credentialsExpireAt: null,
    error: null,
    attempts: 0,
    connectedSince: null,
    lastTransitionAt: 0,
    coverage: {
      scramjetTraffic: "unprotected",
      directBrowserTabs: "unprotected",
      shellRequests: "unprotected",
      hostApplications: "out-of-scope",
    },
    transport: {
      kind: "custom-http-proxy",
      scheme: "https",
      protocol: "CONNECT",
      scope: "crescent-scramjet-traffic",
      serverHost: null,
      serverPort: null,
    },
    ...overrides,
  };
}

describe("provider presentation", () => {
  test("always names CrystalVPN, whatever the backend calls the transport", () => {
    assert.equal(providerName(null), "CrystalVPN");
    assert.equal(providerName(snapshot({ provider: "manual" })), "CrystalVPN");
    assert.equal(providerName(snapshot({ provider: "legacy" })), "CrystalVPN");
    assert.equal(providerAppId(null), "crystalvpn");
    assert.equal(providerAppId(snapshot({ provider: "manual" })), "crystalvpn");
    assert.equal(providerAppId(snapshot({ provider: "legacy" })), "crystalvpn");
  });
});

describe("deriveCoverage", () => {
  test("VPN off: nothing is protected and nothing is blocked", () => {
    const coverage = deriveCoverage({
      snapshot: snapshot(),
      scramjetEnabled: true,
      browserUsingProxy: true,
    });
    assert.equal(coverage.scramjet, "unprotected");
    assert.equal(coverage.browserTabs, "unprotected");
    assert.equal(coverage.anyProtected, false);
    assert.equal(coverage.headline, "VPN off");
  });

  test("connected with Scramjet on: the proxied path is protected", () => {
    const coverage = deriveCoverage({
      snapshot: snapshot({ status: "connected", enabled: true }),
      scramjetEnabled: true,
      browserUsingProxy: true,
    });
    assert.equal(coverage.scramjet, "protected");
    assert.equal(coverage.browserTabs, "protected");
    assert.equal(coverage.anyProtected, true);
    // The paths a tunnel cannot reach stay unprotected even while connected —
    // this is the assertion that keeps the UI honest.
    assert.equal(coverage.shellRequests, "unprotected");
    assert.equal(coverage.hostApplications, "out-of-scope");
  });

  test("connected with Scramjet off protects nothing, and does not pretend to", () => {
    const coverage = deriveCoverage({
      snapshot: snapshot({ status: "connected", enabled: true }),
      scramjetEnabled: false,
      browserUsingProxy: false,
    });
    assert.equal(coverage.scramjet, "disabled");
    assert.equal(coverage.browserTabs, "unprotected");
    assert.equal(coverage.anyProtected, false);
    assert.equal(coverage.headline, "Connected — proxy is off");
  });

  test("a tab loaded directly is unprotected even while connected", () => {
    const coverage = deriveCoverage({
      snapshot: snapshot({ status: "connected", enabled: true }),
      scramjetEnabled: true,
      browserUsingProxy: false,
    });
    assert.equal(coverage.browserTabs, "unprotected");
    assert.equal(coverage.scramjet, "protected");
  });

  test("enabled, enforcing and connecting reports blocked, never connected", () => {
    const coverage = deriveCoverage({
      snapshot: snapshot({ status: "connecting", enabled: true, enforce: true }),
      scramjetEnabled: true,
      browserUsingProxy: true,
    });
    assert.equal(coverage.scramjet, "blocked");
    assert.equal(coverage.anyProtected, false);
    assert.equal(coverage.headline, "Connecting to CrystalVPN");
  });

  test("enabled with enforcement off falls back to unprotected, not blocked", () => {
    const coverage = deriveCoverage({
      snapshot: snapshot({ status: "error", enabled: true, enforce: false }),
      scramjetEnabled: true,
      browserUsingProxy: true,
    });
    assert.equal(coverage.scramjet, "unprotected");
    assert.equal(coverage.anyProtected, false);
  });

  test("an unreachable backend is reported as such rather than as disconnected", () => {
    const coverage = deriveCoverage({
      snapshot: null,
      scramjetEnabled: true,
      browserUsingProxy: true,
      controllerUnreachable: true,
    });
    assert.equal(coverage.headline, "VPN backend unreachable");
    assert.equal(coverage.anyProtected, false);
  });

  test("an error state surfaces the controller's own message", () => {
    const coverage = deriveCoverage({
      snapshot: snapshot({
        status: "error",
        enabled: true,
        error: { code: "CREDENTIALS_REJECTED", message: "The VPN server rejected these credentials." },
      }),
      scramjetEnabled: true,
      browserUsingProxy: true,
    });
    assert.equal(coverage.headline, "The VPN server rejected these credentials.");
  });
});

describe("isEnforcing / isVpnLocked", () => {
  test("enforcement needs both intent and the setting", () => {
    assert.equal(isEnforcing(snapshot({ enabled: true, enforce: true })), true);
    assert.equal(isEnforcing(snapshot({ enabled: true, enforce: false })), false);
    assert.equal(isEnforcing(snapshot({ enabled: false, enforce: true })), false);
    assert.equal(isEnforcing(null), false);
  });

  test("the shell is locked only while enforcing and not yet connected", () => {
    assert.equal(isVpnLocked(snapshot({ enabled: true, enforce: true, status: "connecting" })), true);
    assert.equal(isVpnLocked(snapshot({ enabled: true, enforce: true, status: "error" })), true);
    assert.equal(isVpnLocked(snapshot({ enabled: true, enforce: true, status: "connected" })), false);
    assert.equal(isVpnLocked(snapshot({ enabled: true, enforce: false, status: "error" })), false);
  });
});

describe("protectionLabel", () => {
  test("only a genuinely protected path says Protected", () => {
    assert.equal(protectionLabel("protected"), "Protected");
    assert.notEqual(protectionLabel("unprotected"), "Protected");
    assert.notEqual(protectionLabel("blocked"), "Protected");
    assert.notEqual(protectionLabel("disabled"), "Protected");
    assert.notEqual(protectionLabel("out-of-scope"), "Protected");
  });
});
