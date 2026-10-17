/*
 * CrystalOS — backend reachability tests
 *
 * Run with `node --test server/health.test.mjs` (or `npm test`).
 *
 * These cover the defect that produced Vite's
 * `http proxy error: connect ECONNREFUSED 127.0.0.1:8787` log: the dev runner
 * could not tell "no backend yet" from "a backend is answering", so it started
 * the frontend anyway. Every case is exercised against a real local HTTP server
 * on an ephemeral port — no backend and no network access are required.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { backendOrigin, probeBackend, waitForBackend } from "./health.mjs";

const GOOD_STATUS = {
  ok: true,
  scramjet: true,
  transport: "libcurl",
  wispPath: "/wisp/",
  privateAddresses: false,
};

/** Serves `body` (or `handler`) at /api/proxy-status. */
async function fakeBackend(respond) {
  const httpServer = createServer((req, res) => {
    if (!req.url?.startsWith("/api/proxy-status")) {
      res.writeHead(404).end();
      return;
    }
    respond(req, res);
  });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const { port } = httpServer.address();
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    async close() {
      httpServer.closeAllConnections();
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

function jsonResponder(payload, status = 200) {
  return (_req, res) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
  };
}

function htmlResponder() {
  return (_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>CrystalOS</title>");
  };
}

/** A port nothing is listening on: bind, note it, release it. */
async function closedOrigin() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}`;
}

describe("backendOrigin", () => {
  it("defaults to the loopback backend the shell proxies to", () => {
    assert.equal(backendOrigin({}), "http://127.0.0.1:8787");
  });

  it("honours CRESCENT_HOST and CRESCENT_PORT", () => {
    assert.equal(backendOrigin({ CRESCENT_HOST: "0.0.0.0", CRESCENT_PORT: "8788" }), "http://0.0.0.0:8788");
  });

  it("prefers an explicit CRESCENT_BACKEND_URL and trims trailing slashes", () => {
    assert.equal(
      backendOrigin({ CRESCENT_BACKEND_URL: "https://backend.example.com/", CRESCENT_PORT: "8787" }),
      "https://backend.example.com",
    );
  });
});

describe("probeBackend", () => {
  it("returns the status of a healthy backend", async () => {
    const backend = await fakeBackend(jsonResponder(GOOD_STATUS));
    try {
      assert.deepEqual(await probeBackend(backend.url), GOOD_STATUS);
    } finally {
      await backend.close();
    }
  });

  it("returns null when nothing is listening (the ECONNREFUSED case)", async () => {
    const origin = await closedOrigin();
    assert.equal(await probeBackend(origin), null);
  });

  it("returns null for the dev server's HTML fallback, not a false positive", async () => {
    const backend = await fakeBackend(htmlResponder());
    try {
      assert.equal(await probeBackend(backend.url), null);
    } finally {
      await backend.close();
    }
  });

  it("returns null for a JSON body that is not a CrystalOS status", async () => {
    const backend = await fakeBackend(jsonResponder({ hello: "world" }));
    try {
      assert.equal(await probeBackend(backend.url), null);
    } finally {
      await backend.close();
    }
  });

  it("returns null for an error response", async () => {
    const backend = await fakeBackend(jsonResponder({ error: "nope" }, 503));
    try {
      assert.equal(await probeBackend(backend.url), null);
    } finally {
      await backend.close();
    }
  });

  it("returns null instead of throwing on a host that does not resolve", async () => {
    assert.equal(await probeBackend("http://crescent.invalid", 1000), null);
  });
});

describe("waitForBackend", () => {
  let backend;
  let origin;

  before(async () => {
    backend = await fakeBackend(jsonResponder(GOOD_STATUS));
    origin = backend.url;
  });

  after(async () => {
    await backend.close();
  });

  it("resolves as soon as the backend answers", async () => {
    const status = await waitForBackend(origin, { timeoutMs: 5000, intervalMs: 50 });
    assert.deepEqual(status, GOOD_STATUS);
  });

  it("keeps waiting while the backend is still starting, then resolves", async () => {
    const seen = [];
    const probe = async (url) => {
      seen.push(url);
      // "Not up yet" for the first two probes, exactly like a backend that is
      // still downloading its Scramjet assets, then the real answer.
      if (seen.length <= 2) return null;
      return probeBackend(url);
    };
    const status = await waitForBackend(origin, { timeoutMs: 2000, intervalMs: 10, probe });
    assert.deepEqual(status, GOOD_STATUS);
    assert.equal(seen.length, 3);
    assert.deepEqual(new Set(seen), new Set([origin]));
  });

  it("gives up at the timeout instead of hanging", async () => {
    const dead = await closedOrigin();
    const started = Date.now();
    const status = await waitForBackend(dead, { timeoutMs: 300, intervalMs: 50 });
    const elapsed = Date.now() - started;
    assert.equal(status, null);
    assert.ok(elapsed >= 300, `expected at least 300ms, took ${elapsed}ms`);
  });

  it("stops immediately when the child process has already exited", async () => {
    const dead = await closedOrigin();
    let alive = true;
    const status = await waitForBackend(dead, {
      timeoutMs: 30_000,
      intervalMs: 10,
      isAlive: () => alive,
      probe: async () => {
        alive = false; // the backend dies mid-wait
        return null;
      },
    });
    assert.equal(status, null);
  });
});
