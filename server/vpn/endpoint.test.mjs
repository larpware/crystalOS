/*
 * CrystalOS — user-supplied endpoint tests
 *
 * Two things matter here. A mistyped endpoint must be rejected with a message
 * that says what to fix, rather than being "repaired" into a connection the
 * user did not ask for. And a rejected endpoint must never reach the disk,
 * because it would then come back at boot as a failure with no visible cause.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createEndpointStore,
  describeEndpoint,
  EndpointError,
  normaliseEndpoint,
  PROVIDER,
} from "./endpoint.mjs";

async function withTempFile(run) {
  const dir = await mkdtemp(join(tmpdir(), "crescent-endpoint-"));
  try {
    return await run(join(dir, "endpoint.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("normaliseEndpoint", () => {
  test("defaults to an HTTPS proxy on 443", () => {
    assert.deepEqual(normaliseEndpoint({ host: "proxy.example.com" }), {
      host: "proxy.example.com",
      port: 443,
      scheme: "https",
      name: "proxy.example.com",
      username: "",
      password: "",
      checkUrl: "",
      country: "",
    });
  });

  test("a plain HTTP proxy defaults to port 80", () => {
    assert.equal(normaliseEndpoint({ host: "proxy.example.com", scheme: "http" }).port, 80);
  });

  test("accepts host:port in one field, and lowercases the host", () => {
    const endpoint = normaliseEndpoint({ host: "Proxy.Example.COM:3128" });
    assert.equal(endpoint.host, "proxy.example.com");
    assert.equal(endpoint.port, 3128);
  });

  test("accepts a bracketed IPv6 literal", () => {
    const endpoint = normaliseEndpoint({ host: "[2001:db8::1]:8080" });
    assert.equal(endpoint.host, "2001:db8::1");
    assert.equal(endpoint.port, 8080);
  });

  test("rejects a URL where a host belongs, with advice", () => {
    for (const host of ["https://proxy.example.com/", "http://proxy.example.com", "user@proxy.example.com"]) {
      assert.throws(() => normaliseEndpoint({ host }), (error) => {
        assert.ok(error instanceof EndpointError);
        assert.match(error.message, /only the proxy's host|not a URL/i);
        return true;
      });
    }
  });

  test("rejects an unparseable IPv6 address rather than guessing", () => {
    assert.throws(() => normaliseEndpoint({ host: "2001:db8::1" }), /Wrap it in \[ \]/);
    assert.throws(() => normaliseEndpoint({ host: "[2001:db8::1" }), /unfinished IPv6/);
  });

  test("rejects a missing host, a bad scheme and a bad port", () => {
    assert.throws(() => normaliseEndpoint({}), /host name or IP/);
    assert.throws(() => normaliseEndpoint({ host: "  " }), /host name or IP/);
    assert.throws(() => normaliseEndpoint({ host: "a.example", scheme: "socks5" }), /scheme must be/);
    assert.throws(() => normaliseEndpoint({ host: "a.example", port: 0 }), /between 1 and 65535/);
    assert.throws(() => normaliseEndpoint({ host: "a.example", port: "443a" }), /between 1 and 65535/);
    assert.throws(() => normaliseEndpoint({ host: "a.example", port: 70000 }), /between 1 and 65535/);
  });

  test("treats blank credentials as none, and keeps a name", () => {
    const endpoint = normaliseEndpoint({
      host: "proxy.example.com",
      username: "  ",
      password: "",
      name: "  Home proxy  ",
    });
    assert.equal(endpoint.username, "");
    assert.equal(endpoint.password, "");
    assert.equal(endpoint.name, "Home proxy");
  });

  test("rejects non-text and over-long values", () => {
    assert.throws(() => normaliseEndpoint({ host: "a.example", username: 42 }), /must be text/);
    assert.throws(() => normaliseEndpoint({ host: "a.example", name: "x".repeat(61) }), /too long/);
    assert.throws(() => normaliseEndpoint({ host: "a.example", username: "y".repeat(201) }), /too long/);
  });

  test("requires a plain-http exit check URL, because it is fetched through the tunnel", () => {
    assert.equal(normaliseEndpoint({ host: "a.example", checkUrl: "" }).checkUrl, "");
    assert.equal(
      normaliseEndpoint({ host: "a.example", checkUrl: "http://example.net/ip" }).checkUrl,
      "http://example.net/ip",
    );
    // An https check URL would be plaintext written at a TLS port inside the
    // tunnel, so it is refused here rather than failing later.
    assert.throws(() => normaliseEndpoint({ host: "a.example", checkUrl: "https://example.net/ip" }), /http:\/\//);
    assert.throws(() => normaliseEndpoint({ host: "a.example", checkUrl: "example.net/ip" }), /full http/);
    assert.throws(() => normaliseEndpoint({ host: "a.example", checkUrl: "ftp://example.net/ip" }), /http:\/\//);
  });
});

describe("describeEndpoint", () => {
  test("never carries a username, a password or the check URL", () => {
    const described = describeEndpoint(
      normaliseEndpoint({
        host: "proxy.example.com",
        port: 443,
        username: "someone",
        password: "hunter2",
        checkUrl: "http://example.net/ip?token=secret",
      }),
    );
    assert.deepEqual(described, {
      name: "proxy.example.com",
      host: "proxy.example.com",
      port: 443,
      scheme: "https",
      authenticated: true,
      hasCheckUrl: true,
      country: null,
    });
    assert.equal(JSON.stringify(described).includes("hunter2"), false);
    assert.equal(JSON.stringify(described).includes("secret"), false);
    assert.equal(JSON.stringify(described).includes("someone"), false);
  });

  test("describes nothing as null", () => {
    assert.equal(describeEndpoint(null), null);
  });
});

describe("endpoint store", () => {
  test("round-trips a provider and endpoint", async () => {
    await withTempFile(async (file) => {
      const store = createEndpointStore({ file });
      await store.save({
        provider: PROVIDER.manual,
        endpoint: { host: "proxy.example.com", port: 3128, username: "u", password: "p" },
      });

      const reloaded = createEndpointStore({ file });
      const stored = await reloaded.load();
      assert.equal(stored.provider, PROVIDER.manual);
      assert.equal(stored.endpoint.host, "proxy.example.com");
      assert.equal(stored.endpoint.port, 3128);
      assert.equal(stored.endpoint.username, "u");

      const described = await reloaded.describe();
      assert.equal(described.hasEndpoint, true);
      assert.equal(described.endpoint.authenticated, true);
      assert.equal(JSON.stringify(described).includes('"p"'), false);
    });
  });

  test("refuses to write an endpoint it would refuse to read", async () => {
    await withTempFile(async (file) => {
      const store = createEndpointStore({ file });
      await assert.rejects(() => store.save({ provider: PROVIDER.manual, endpoint: { host: "http://x/" } }));
      // Nothing was created, so a later boot reads "no endpoint" rather than
      // an error it cannot explain.
      await assert.rejects(() => readFile(file, "utf8"));
    });
  });

  test("a hand-edited invalid endpoint reads as none, keeping the provider", async () => {
    await withTempFile(async (file) => {
      await writeFile(file, JSON.stringify({ provider: "manual", endpoint: { host: "" } }), "utf8");
      const store = createEndpointStore({ file });
      const stored = await store.load();
      assert.equal(stored.provider, PROVIDER.manual);
      assert.equal(stored.endpoint, null);
    });
  });

  test("a missing or corrupt file means Proton with no endpoint", async () => {
    await withTempFile(async (file) => {
      const missing = await createEndpointStore({ file }).load();
      assert.deepEqual({ provider: missing.provider, endpoint: missing.endpoint }, { provider: "proton", endpoint: null });

      await writeFile(file, "not json at all", "utf8");
      const corrupt = await createEndpointStore({ file }).load();
      assert.equal(corrupt.provider, "proton");
      assert.equal(corrupt.endpoint, null);
    });
  });

  test("clear removes the file and resets to Proton", async () => {
    await withTempFile(async (file) => {
      const store = createEndpointStore({ file });
      await store.save({ provider: PROVIDER.manual, endpoint: { host: "proxy.example.com" } });
      await store.clear();
      assert.equal(await store.describe().then((d) => d.provider), PROVIDER.proton);
      await assert.rejects(() => readFile(file, "utf8"));
    });
  });
});
