/*
 * CrystalOS — the automatic free-proxy pool
 *
 * Two things are worth testing here, and both are about *not* trusting the
 * input:
 *
 *   • parsing — a public list is hostile, noisy text, and a malformed line must
 *     be skipped rather than turned into a connection attempt;
 *   • selection — a list entry is a claim, so `findBest` must only offer a proxy
 *     that actually accepted a CONNECT, and must report a reason instead of a
 *     server when none did.
 *
 * `fetch` and the CONNECT client are injected, so nothing here touches the
 * network.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { countrySources, createProxyPool, parseCandidates, parseProxyLine } from "./proxies.mjs";
import { createVpnController, ERROR, STATUS } from "./controller.mjs";
import { PROVIDER } from "./endpoint.mjs";

/* ----------------------------------------------------------------- parsing */

describe("parsing a public proxy list", () => {
  test("a plain host:port is understood", () => {
    assert.deepEqual(parseProxyLine("1.2.3.4:8080"), {
      scheme: "http",
      host: "1.2.3.4",
      port: 8080,
      username: "",
      password: "",
    });
  });

  test("a scheme prefix and a trailing path are stripped", () => {
    assert.deepEqual(parseProxyLine("http://1.2.3.4:8080/some/path"), {
      scheme: "http",
      host: "1.2.3.4",
      port: 8080,
      username: "",
      password: "",
    });
  });

  test("a trailing field after the address is ignored", () => {
    assert.deepEqual(parseProxyLine("1.2.3.4:8080 anonymous"), {
      scheme: "http",
      host: "1.2.3.4",
      port: 8080,
      username: "",
      password: "",
    });
  });

  test("credentials survive a round trip", () => {
    assert.deepEqual(parseProxyLine("user:secret@1.2.3.4:3128"), {
      scheme: "http",
      host: "1.2.3.4",
      port: 3128,
      username: "user",
      password: "secret",
    });
  });

  test("a bracketed IPv6 literal keeps its brackets out of the host", () => {
    const parsed = parseProxyLine("[2001:db8::1]:8080");
    assert.equal(parsed.host, "2001:db8::1");
    assert.equal(parsed.port, 8080);
  });

  test("comments, headers and malformed lines are skipped, not guessed at", () => {
    for (const line of ["", "   ", "# a comment", "host-only", "1.2.3.4:", ":8080", "1.2.3.4:notaport", "1.2.3.4:70000"]) {
      assert.equal(parseProxyLine(line), null, `"${line}" should not parse`);
    }
  });
});

/* -------------------------------------------------------------- selection */

/** A fetch that answers each URL with a fixed body, and never hits the wire. */
function listFetch(pages) {
  return async (url) => {
    const body = pages[url] ?? "";
    return {
      ok: true,
      status: 200,
      text: async () => body,
    };
  };
}

/**
 * A probe where only a chosen set of proxies works, and each takes a distinct,
 * known time — so "fastest" is a fact the test controls. It stands in for the
 * verified-TLS probe: a throw is a reject, a resolve is a pass.
 */
function timedTunnel(workingTimes) {
  const attempted = [];
  const connect = async ({ proxy }) => {
    attempted.push(proxy.host);
    const ms = workingTimes[proxy.host];
    if (ms === undefined) throw new Error("refused");
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { socket: { destroy() {} } };
  };
  return { attempted, probe: connect, tunnel: { openConnectTunnel: connect } };
}

describe("finding a working proxy", () => {
  test("only a proxy that accepted a CONNECT is offered, and the fastest wins", async () => {
    const sources = ["a", "b"];
    const pages = {
      a: "1.1.1.1:1000\n2.2.2.2:2000\n# comment\n",
      b: "2.2.2.2:2000\n3.3.3.3:3000\n", // 2.2.2.2 is a duplicate
    };
    const { probe, attempted } = timedTunnel({ "1.1.1.1": 40, "3.3.3.3": 10 });

    const pool = createProxyPool({
      sources,
      fetchImpl: listFetch(pages),
      probe,
      concurrency: 8,
    });
    const result = await pool.findBest();

    assert.equal(result.endpoint.host, "3.3.3.3");
    assert.equal(result.endpoint.port, 3000);
    assert.equal(result.endpoint.scheme, "http");
    assert.equal(result.working, 2);
    assert.equal(result.tested, 3);
    // The duplicate was never tried twice.
    assert.equal(attempted.filter((host) => host === "2.2.2.2").length, 1);
  });

  test("a dead source does not stop the scan", async () => {
    const fetchImpl = async (url) => {
      if (url === "dead") throw new Error("ENOTFOUND");
      return { ok: true, status: 200, text: async () => "4.4.4.4:4444\n" };
    };
    const { probe } = timedTunnel({ "4.4.4.4": 5 });
    const pool = createProxyPool({ sources: ["dead", "live"], fetchImpl, probe });
    const result = await pool.findBest();
    assert.equal(result.endpoint.host, "4.4.4.4");
  });

  test("no working proxy is a reason, never an invented server", async () => {
    const { probe } = timedTunnel({});
    const pool = createProxyPool({
      sources: ["a"],
      fetchImpl: listFetch({ a: "1.1.1.1:1\n2.2.2.2:2\n" }),
      probe,
    });
    const result = await pool.findBest();
    assert.equal(result.endpoint, null);
    assert.match(result.reason, /none could carry a verified TLS connection/i);
  });

  test("a proxy that passes a bare CONNECT but fails the TLS proof is rejected", async () => {
    // The CONNECT would succeed — a bare-CONNECT check would accept this proxy —
    // but the verified TLS handshake fails, exactly as it does through a
    // man-in-the-middle or a black-holing exit. It must never be offered.
    const pool = createProxyPool({
      sources: ["a"],
      fetchImpl: listFetch({ a: "1.1.1.1:1000\n" }),
      tunnel: { openConnectTunnel: async () => ({ socket: { destroy() {} } }) },
      verifyTls: async () => {
        throw new Error("self-signed certificate in certificate chain");
      },
    });
    const result = await pool.findBest();
    assert.equal(result.endpoint, null);
  });

  test("an unreachable list is still a reason, not a crash", async () => {
    const pool = createProxyPool({
      sources: ["a"],
      fetchImpl: async () => {
        throw new Error("offline");
      },
      tunnel: timedTunnel({}).tunnel,
      probe: timedTunnel({}).probe,
    });
    const result = await pool.findBest();
    assert.equal(result.endpoint, null);
    assert.match(result.reason, /no proxy lists/i);
  });

  test("the candidate list is bounded", async () => {
    const many = Array.from({ length: 200 }, (_, index) => `10.0.0.${index}:${1000 + index}`).join("\n");
    const { probe, attempted } = timedTunnel({});
    const pool = createProxyPool({
      sources: ["a"],
      fetchImpl: listFetch({ a: many }),
      probe,
      maxCandidates: 10,
    });
    await pool.findBest();
    assert.equal(attempted.length, 10);
  });
});

/* ------------------------------------------------------- controller wiring */

function memoryStores() {
  return {
    sessionStore: {
      load: async () => null,
      save: async (session) => session,
      clear: async () => undefined,
      describe: async () => ({ signedIn: false, uid: null, updatedAt: null }),
    },
    endpointStore: {
      saved: null,
      async load() {
        return { provider: PROVIDER.proton, endpoint: null, updatedAt: null };
      },
      async save(value) {
        this.saved = value;
        return value;
      },
      async clear() {
        this.saved = null;
      },
    },
  };
}

function realTunnelFor(workingTimes) {
  return timedTunnel(workingTimes).tunnel;
}

describe("quick connect through the controller", () => {
  test("it discovers, stores the endpoint, and connects through it", async () => {
    const { sessionStore, endpointStore } = memoryStores();
    const pool = {
      async findBest() {
        return {
          endpoint: { scheme: "http", host: "9.9.9.9", port: 9999, checkUrl: "" },
          ms: 12,
          tested: 5,
          working: 1,
        };
      },
    };
    const controller = createVpnController({
      sessionStore,
      endpointStore,
      proton: {},
      proxyPool: pool,
      tunnel: realTunnelFor({ "9.9.9.9": 1 }),
    });

    const snapshot = await controller.quickConnect();

    assert.equal(snapshot.status, STATUS.connected);
    assert.equal(snapshot.provider, PROVIDER.manual);
    assert.equal(snapshot.endpoint.host, "9.9.9.9");
    assert.equal(endpointStore.saved.provider, PROVIDER.manual);
    assert.equal(endpointStore.saved.endpoint.host, "9.9.9.9");
  });

  test("no working proxy is a NO_PROXY_FOUND error, and intent survives", async () => {
    const { sessionStore, endpointStore } = memoryStores();
    const pool = { async findBest() { return { endpoint: null, reason: "nothing worked" }; } };
    const controller = createVpnController({
      sessionStore,
      endpointStore,
      proton: {},
      proxyPool: pool,
      tunnel: realTunnelFor({}),
    });

    const snapshot = await controller.quickConnect();
    assert.equal(snapshot.status, STATUS.error);
    assert.equal(snapshot.error.code, ERROR.NO_PROXY_FOUND);
    assert.equal(snapshot.enabled, true, "a failed connect must not silently turn the VPN off");
    assert.equal(endpointStore.saved, null);
  });

  test("a proxy that dies after the health test falls through to the next", async () => {
    const { sessionStore, endpointStore } = memoryStores();
    const pool = {
      async findBest() {
        return {
          endpoints: [
            { scheme: "http", host: "1.1.1.1", port: 1111, checkUrl: "" },
            { scheme: "http", host: "2.2.2.2", port: 2222, checkUrl: "" },
          ],
        };
      },
    };
    // 1.1.1.1 was "working" at scan time but now refuses; 2.2.2.2 succeeds.
    const controller = createVpnController({
      sessionStore,
      endpointStore,
      proton: {},
      proxyPool: pool,
      tunnel: realTunnelFor({ "2.2.2.2": 1 }),
    });

    const snapshot = await controller.quickConnect();
    assert.equal(snapshot.status, STATUS.connected);
    assert.equal(snapshot.endpoint.host, "2.2.2.2");
    assert.equal(endpointStore.saved.endpoint.host, "2.2.2.2");
  });

  test("an existing endpoint is connected through without re-scanning", async () => {
    const { sessionStore, endpointStore } = memoryStores();
    let scanned = false;
    const pool = {
      async findBest() {
        scanned = true;
        return { endpoint: null };
      },
    };
    const controller = createVpnController({
      sessionStore,
      endpointStore,
      proton: {},
      proxyPool: pool,
      tunnel: realTunnelFor({ "5.5.5.5": 1 }),
    });
    await controller.saveEndpoint({ host: "5.5.5.5", port: 5555, checkUrl: "" });

    const snapshot = await controller.quickConnect();
    assert.equal(snapshot.status, STATUS.connected);
    assert.equal(snapshot.endpoint.host, "5.5.5.5");
    assert.equal(scanned, false, "a stored endpoint must not trigger a fresh scan");
  });

  test("a dead stored endpoint falls back to a fresh scan instead of failing", async () => {
    const { sessionStore, endpointStore } = memoryStores();
    let scanned = false;
    const pool = {
      async findBest() {
        scanned = true;
        return { endpoints: [{ scheme: "http", host: "9.9.9.9", port: 9999, checkUrl: "" }] };
      },
    };
    // The stored 5.5.5.5 is dead; only the discovered 9.9.9.9 answers.
    const controller = createVpnController({
      sessionStore,
      endpointStore,
      proton: {},
      proxyPool: pool,
      tunnel: realTunnelFor({ "9.9.9.9": 1 }),
    });
    await controller.saveEndpoint({ host: "5.5.5.5", port: 5555, checkUrl: "" });

    const snapshot = await controller.quickConnect();
    assert.equal(scanned, true, "a dead stored endpoint must trigger a re-scan");
    assert.equal(snapshot.status, STATUS.connected);
    assert.equal(snapshot.endpoint.host, "9.9.9.9");
    assert.equal(endpointStore.saved.endpoint.host, "9.9.9.9");
  });

  test("a stored endpoint that fails the TLS proof falls through to a fresh scan", async () => {
    const { sessionStore, endpointStore } = memoryStores();
    const verified = [];
    // A CONNECT-only check would accept 5.5.5.5; the TLS proof rejects it, exactly
    // as it does for a man-in-the-middle or a black-holing exit.
    const tunnel = {
      verifyTls: async ({ proxy }) => {
        verified.push(proxy.host);
        if (proxy.host === "5.5.5.5") throw new Error("self-signed certificate in certificate chain");
        return { subject: "example.com" };
      },
      openConnectTunnel: async () => ({ socket: { destroy() {} } }),
    };
    const pool = {
      async findBest() {
        return { endpoints: [{ scheme: "http", host: "9.9.9.9", port: 9999, checkUrl: "" }] };
      },
    };
    const controller = createVpnController({
      sessionStore,
      endpointStore,
      proton: {},
      proxyPool: pool,
      tunnel,
    });
    await controller.saveEndpoint({ host: "5.5.5.5", port: 5555, checkUrl: "" });

    const snapshot = await controller.quickConnect();

    assert.equal(snapshot.status, STATUS.connected);
    assert.equal(snapshot.endpoint.host, "9.9.9.9");
    assert.deepEqual(verified, ["5.5.5.5", "9.9.9.9"]);
  });
});

/* --------------------------------------------------- countries and canaries */

describe("choosing a country", () => {
  test("the country sources all carry the requested code", () => {
    for (const url of countrySources("de")) {
      assert.match(url, /country=DE/);
    }
  });

  test("a GeoNode JSON page is parsed, and its junk is skipped", () => {
    const body = JSON.stringify({
      data: [
        { ip: "1.2.3.4", port: "8080" },
        { ip: "bad", port: 0 },
        { ip: "5.6.7.8", port: 3128 },
      ],
    });
    assert.deepEqual(
      parseCandidates(body).map((candidate) => `${candidate.host}:${candidate.port}`),
      ["1.2.3.4:8080", "5.6.7.8:3128"],
    );
    // A plain-text page still parses through the same entry point.
    assert.deepEqual(
      parseCandidates("9.9.9.9:9000\n# comment\n").map((candidate) => candidate.host),
      ["9.9.9.9"],
    );
  });

  test("asking for a country queries only that country's sources", async () => {
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      return { ok: true, status: 200, text: async () => "7.7.7.7:7000\n" };
    };
    const pool = createProxyPool({
      sources: ["https://worldwide.example/list"],
      fetchImpl,
      probe: timedTunnel({ "7.7.7.7": 1 }).probe,
    });

    const result = await pool.findBest({ country: "DE" });

    assert.ok(seen.length > 0);
    assert.ok(seen.every((url) => /country=DE/.test(url)), seen.join("\n"));
    assert.equal(seen.includes("https://worldwide.example/list"), false);
    assert.equal(result.endpoint.host, "7.7.7.7");
    assert.equal(result.endpoint.country, "DE");
  });
});

describe("preferring a proxy that can reach the canary", () => {
  /** Like `timedTunnel`, but keyed by proxy *and* target, so behaviour per site. */
  function targetAwareTunnel(behavior) {
    return {
      probe: async ({ proxy, target }) => {
        const ms = behavior[`${proxy.host}|${target.host}`];
        if (ms === undefined) throw new Error("refused");
        await new Promise((resolve) => setTimeout(resolve, ms));
      },
    };
  }

  const pages = { a: "slowgood:1000\nfastbad:2000\n" };

  test("a canary-capable proxy beats a faster one that black-holes the site", async () => {
    const { probe } = targetAwareTunnel({
      "slowgood|example.com": 50,
      "slowgood|duckduckgo.com": 5,
      "fastbad|example.com": 5,
      // fastbad cannot reach the canary at all.
    });
    const pool = createProxyPool({ sources: ["a"], fetchImpl: listFetch(pages), probe });

    const result = await pool.findBest({ canary: [{ host: "duckduckgo.com", port: 443 }] });

    assert.equal(result.endpoint.host, "slowgood");
    assert.equal(result.canaryOk, 1);
    assert.equal(result.working, 2);
  });

  test("with no canary asked for, the fastest still wins", async () => {
    const { probe } = targetAwareTunnel({
      "slowgood|example.com": 50,
      "fastbad|example.com": 5,
    });
    const pool = createProxyPool({ sources: ["a"], fetchImpl: listFetch(pages), probe });

    const result = await pool.findBest();

    assert.equal(result.endpoint.host, "fastbad");
    assert.equal(result.endpoint.canary, null);
  });
});

describe("quick connect scoped to a country", () => {
  test("asking for a country rescans even when an endpoint is already stored", async () => {
    const { sessionStore, endpointStore } = memoryStores();
    const seen = [];
    const pool = {
      async findBest(options) {
        seen.push(options);
        return { endpoints: [{ scheme: "http", host: "8.8.8.8", port: 8080, country: "DE" }], working: 1, canaryOk: 0 };
      },
    };
    const controller = createVpnController({
      sessionStore,
      endpointStore,
      proton: {},
      proxyPool: pool,
      tunnel: realTunnelFor({ "5.5.5.5": 1, "8.8.8.8": 1 }),
    });
    await controller.saveEndpoint({ host: "5.5.5.5", port: 5555, checkUrl: "" });

    const snapshot = await controller.quickConnect({ country: "DE", canary: [{ host: "duckduckgo.com", port: 443 }] });

    assert.equal(seen.length, 1, "a different country must force a fresh scan");
    assert.equal(seen[0].country, "DE");
    assert.deepEqual(seen[0].canary, [{ host: "duckduckgo.com", port: 443 }]);
    assert.equal(snapshot.status, STATUS.connected);
    assert.equal(snapshot.endpoint.host, "8.8.8.8");
    assert.equal(snapshot.endpoint.country, "DE");
    assert.equal(snapshot.preference.country, "DE");
  });

  test("a stored endpoint already in that country is reused, not rescanned", async () => {
    const { sessionStore, endpointStore } = memoryStores();
    let scanned = false;
    const pool = {
      async findBest() {
        scanned = true;
        return { endpoint: null };
      },
    };
    const controller = createVpnController({
      sessionStore,
      endpointStore,
      proton: {},
      proxyPool: pool,
      tunnel: realTunnelFor({ "6.6.6.6": 1 }),
    });
    await controller.saveEndpoint({ host: "6.6.6.6", port: 6666, checkUrl: "", country: "US" });

    const snapshot = await controller.quickConnect({ country: "US" });

    assert.equal(scanned, false);
    assert.equal(snapshot.status, STATUS.connected);
    assert.equal(snapshot.endpoint.country, "US");
  });

  test("a malformed country is rejected, not turned into a worldwide scan", async () => {
    const { sessionStore, endpointStore } = memoryStores();
    let scanned = false;
    const pool = {
      async findBest() {
        scanned = true;
        return { endpoint: null };
      },
    };
    const controller = createVpnController({
      sessionStore,
      endpointStore,
      proton: {},
      proxyPool: pool,
      tunnel: realTunnelFor({}),
    });

    const snapshot = await controller.quickConnect({ country: "USA" });

    assert.equal(scanned, false);
    assert.equal(snapshot.status, STATUS.error);
    assert.match(snapshot.error.message, /two-letter/i);
  });
});
