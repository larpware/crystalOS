/*
 * CrystalOS — Proton server selection tests
 *
 * Run with `node --test server/vpn/servers.test.mjs`.
 *
 * The rules under test are the extension's own (`isLogicalConnectable`,
 * `pickServerInLogical`, the proxy-port spread in `connectLogical`). Getting
 * them wrong produces a connection that Proton refuses for a reason the UI
 * cannot explain, so they are pinned here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  describeLogical,
  isLogicalConnectable,
  listConnectable,
  pickServer,
  proxyPortFor,
  resolveEndpoint,
  selectLogical,
} from "./servers.mjs";
import { FEATURE, PROTON } from "./config.mjs";

function logical(overrides = {}) {
  return {
    ID: "logical-1",
    Name: "US-NY#1",
    Tier: 2,
    Features: 0,
    EntryCountry: "US",
    ExitCountry: "US",
    City: "New York",
    Domain: "us-ny-01.protonvpn.net",
    Servers: [
      { ID: "s1", Domain: "us-ny-101.protonvpn.net", Label: "101", Load: 40, Status: 1, ExitIP: "203.0.113.10" },
      { ID: "s2", Domain: "us-ny-102.protonvpn.net", Label: "102", Load: 10, Status: 1, ExitIP: "203.0.113.11" },
    ],
    ...overrides,
  };
}

describe("isLogicalConnectable", () => {
  test("tiers 0–2 are served over the browser proxy", () => {
    assert.equal(isLogicalConnectable(logical({ Tier: 0 })), true);
    assert.equal(isLogicalConnectable(logical({ Tier: 2 })), true);
  });

  test("a higher tier is refused, because Proton's proxy does not serve it", () => {
    assert.equal(isLogicalConnectable(logical({ Tier: 3 })), false);
  });

  test("TOR and RESTRICTED servers are refused", () => {
    assert.equal(isLogicalConnectable(logical({ Features: FEATURE.TOR })), false);
    assert.equal(isLogicalConnectable(logical({ Features: FEATURE.RESTRICTED })), false);
    assert.equal(isLogicalConnectable(logical({ Features: FEATURE.P2P | FEATURE.STREAMING })), true);
  });

  test("a missing or malformed entry is not connectable", () => {
    assert.equal(isLogicalConnectable(null), false);
    assert.equal(isLogicalConnectable({}), false);
    assert.equal(isLogicalConnectable(logical({ Tier: "two" })), false);
  });
});

describe("proxyPortFor", () => {
  test("a normal server uses the extension's base port plus its numeric label", () => {
    assert.equal(proxyPortFor({ secureCore: false, label: "101" }), PROTON.proxyPort + 11);
    assert.equal(proxyPortFor({ secureCore: false, label: "0" }), PROTON.proxyPort);
  });

  test("a non-numeric label does not shift the port", () => {
    assert.equal(proxyPortFor({ secureCore: false, label: "us-ny" }), PROTON.proxyPort);
    assert.equal(proxyPortFor({ secureCore: false, label: null }), PROTON.proxyPort);
  });

  test("Secure Core uses its own port regardless of label", () => {
    assert.equal(proxyPortFor({ secureCore: true, label: "101" }), PROTON.secureCoreProxyPort);
  });
});

describe("pickServer", () => {
  test("the least loaded server that is up wins", () => {
    const chosen = pickServer(logical());
    assert.equal(chosen.ID, "s2");
  });

  test("an unknown load never beats a known-good server", () => {
    const chosen = pickServer(
      logical({
        Servers: [
          { ID: "unknown", Domain: "a", Load: null, Status: 1 },
          { ID: "known", Domain: "b", Load: 90, Status: 1 },
        ],
      }),
    );
    assert.equal(chosen.ID, "known");
  });

  test("a logical with no physical servers yields nothing rather than a guess", () => {
    assert.equal(pickServer(logical({ Servers: [] })), null);
    assert.equal(pickServer(undefined), null);
  });
});

describe("resolveEndpoint", () => {
  test("a connectable logical resolves to its physical host and port", () => {
    const { endpoint, reason } = resolveEndpoint(logical());
    assert.equal(reason, null);
    assert.equal(endpoint.host, "us-ny-102.protonvpn.net");
    assert.equal(endpoint.port, PROTON.proxyPort + 11);
    assert.equal(endpoint.exitIp, "203.0.113.11");
    assert.equal(endpoint.secureCore, false);
  });

  test("Secure Core is carried through to the port choice", () => {
    const { endpoint } = resolveEndpoint(logical({ Features: FEATURE.SECURE_CORE }));
    assert.equal(endpoint.secureCore, true);
    assert.equal(endpoint.port, PROTON.secureCoreProxyPort);
  });

  test("with no physical servers it falls back to the logical domain", () => {
    const { endpoint } = resolveEndpoint(logical({ Servers: [] }));
    assert.equal(endpoint.host, "us-ny-01.protonvpn.net");
  });

  test("an unsupported logical explains itself instead of failing silently", () => {
    assert.match(resolveEndpoint(logical({ Tier: 4 })).reason, /free and tier-1\/2/);
    assert.match(resolveEndpoint(logical({ Features: FEATURE.TOR })).reason, /TOR/);
    assert.match(resolveEndpoint(logical({ Features: FEATURE.RESTRICTED })).reason, /restricted/);
  });
});

describe("selectLogical", () => {
  const pool = [
    logical({ ID: "a", Name: "US-NY#1", ExitCountry: "US", StatusReference: { Cost: 50 } }),
    logical({ ID: "b", Name: "DE-FRA#1", ExitCountry: "DE", City: "Frankfurt", StatusReference: { Cost: 10 } }),
    logical({ ID: "c", Name: "PAID#1", Tier: 4, ExitCountry: "CH", StatusReference: { Cost: 1 } }),
  ];

  test("with no preference the cheapest connectable server is chosen", () => {
    assert.equal(selectLogical(pool, {}).logical.ID, "b");
  });

  test("an explicit id wins over load", () => {
    assert.equal(selectLogical(pool, { id: "a" }).logical.ID, "a");
  });

  test("a country narrows the pool", () => {
    assert.equal(selectLogical(pool, { country: "us" }).logical.ID, "a");
  });

  test("a city narrows further, and falls back to the country", () => {
    assert.equal(selectLogical(pool, { country: "DE", city: "Frankfurt" }).logical.ID, "b");
    assert.equal(selectLogical(pool, { country: "DE", city: "Berlin" }).logical.ID, "b");
  });

  test("an unusable plan reports why instead of returning nothing quietly", () => {
    const result = selectLogical([logical({ Tier: 4 })], {});
    assert.equal(result.logical, null);
    assert.match(result.reason, /browser proxy/);
  });

  test("an unknown id or country is reported, not substituted", () => {
    assert.match(selectLogical(pool, { id: "nope" }).reason, /nope/);
    assert.match(selectLogical(pool, { country: "ZZ" }).reason, /ZZ/);
  });
});

describe("listConnectable", () => {
  test("lists only what can actually be reached, sorted by name", () => {
    const list = listConnectable([
      logical({ ID: "b", Name: "DE-FRA#1" }),
      logical({ ID: "a", Name: "US-NY#1" }),
      logical({ ID: "c", Name: "PAID#1", Tier: 4 }),
    ]);
    assert.deepEqual(
      list.map((entry) => entry.name),
      ["DE-FRA#1", "US-NY#1"],
    );
  });

  test("a description carries only what Proton reported", () => {
    const described = describeLogical(logical({ Features: FEATURE.SECURE_CORE | FEATURE.P2P }));
    assert.equal(described.secureCore, true);
    assert.equal(described.p2p, true);
    assert.equal(described.streaming, false);
    assert.equal(described.serverCount, 2);
    assert.equal(described.id, "logical-1");
  });
});
