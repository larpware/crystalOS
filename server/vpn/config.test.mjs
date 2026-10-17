/*
 * CrystalOS — Proton config tests
 *
 * The exclusion rule decides what is allowed to bypass the tunnel. Getting it
 * wrong in one direction sends CrystalOS's own loopback traffic to a remote
 * exit; in the other it sends Proton's own API through Proton's proxy, which
 * breaks the session that keeps the tunnel alive.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FEATURE, MAX_PROXY_TIER, PROTON, isPrivateAddress } from "./config.mjs";

describe("Proton constants", () => {
  test("match the extension's own config.js", () => {
    assert.equal(PROTON.proxyPort, 4443);
    assert.equal(PROTON.secureCoreProxyPort, 443);
    assert.equal(PROTON.proxyScheme, "https");
    assert.equal(PROTON.apiBase, "https://account.proton.me/api/");
    assert.equal(PROTON.browserTokenPath, "vpn/v1/browser/token");
  });

  test("feature bits are the extension's bitmap", () => {
    assert.equal(FEATURE.SECURE_CORE, 1);
    assert.equal(FEATURE.TOR, 2);
    assert.equal(FEATURE.P2P, 4);
    assert.equal(FEATURE.STREAMING, 8);
    assert.equal(FEATURE.RESTRICTED, 32);
  });

  test("the proxy is offered up to tier 2, as the extension's isLogicalAuthorized says", () => {
    assert.equal(MAX_PROXY_TIER, 2);
  });
});

describe("isPrivateAddress", () => {
  test("loopback names and literals are local", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]) {
      assert.equal(isPrivateAddress(host), true, host);
    }
  });

  test("private IPv4 ranges are local", () => {
    for (const host of ["10.0.0.5", "192.168.1.10", "172.16.0.1", "172.31.255.254", "169.254.1.1"]) {
      assert.equal(isPrivateAddress(host), true, host);
    }
  });

  test("public addresses just outside those ranges are not local", () => {
    for (const host of ["172.15.0.1", "172.32.0.1", "11.0.0.1", "8.8.8.8", "203.0.113.10"]) {
      assert.equal(isPrivateAddress(host), false, host);
    }
  });

  test("public hostnames are not local", () => {
    for (const host of ["example.com", "account.proton.me", "us-ny-101.protonvpn.net", "a.b.localhost.example"]) {
      assert.equal(isPrivateAddress(host), false, host);
    }
  });

  test("IPv6 unique-local and link-local addresses are local", () => {
    assert.equal(isPrivateAddress("fd00::1"), true);
    assert.equal(isPrivateAddress("fe80::1"), true);
    assert.equal(isPrivateAddress("2606:4700::1111"), false);
  });
});
