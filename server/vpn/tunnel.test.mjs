/*
 * CrystalOS — Proton proxy transport tests
 *
 * These are the tests that matter most, because the socket is where a mistake
 * becomes a security bug rather than a cosmetic one. They pin three things:
 *
 *   1. `block` really refuses to open a stream, so enforcement cannot leak.
 *   2. the bytes that arrive with the CONNECT handshake are delivered to the
 *      caller before any later byte — the bug that turns into a blank page.
 *   3. the queue ends cleanly, because wisp stops reading on `null`.
 *
 * No network is used: the tunnel and direct dials are injected.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { BoundedQueue, basicAuthHeader, createRoutedTCPSocket, parseHeaderBlock } from "./tunnel.mjs";

/** A minimal stand-in for the TLS socket the tunnel returns. */
class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.paused = false;
    this.written = [];
  }
  write(data, callback) {
    this.written.push(data);
    callback?.();
    return true;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  end() {
    this.destroyed = true;
  }
  destroy() {
    this.destroyed = true;
  }
}

/**
 * A stand-in for the handshake reader with the real contract: it is the socket's
 * only data path (the real reader attaches its own `data` listener), it buffers
 * anything that arrives before a consumer is installed, and it replays the
 * residual handshake bytes when `takeRest` is called.
 */
function fakeReader(socket, leftover) {
  let consumer = null;
  const pending = [];
  socket.on("data", (chunk) => {
    if (consumer) consumer(chunk);
    else pending.push(chunk);
  });
  return {
    takeRest(next) {
      consumer = next;
      if (leftover && leftover.length) next(leftover);
      for (const chunk of pending.splice(0)) next(chunk);
    },
  };
}

function buildSocket({ route, leftover = Buffer.from("first-bytes") }) {
  const sockets = { tunneled: null, direct: null };
  const Routed = createRoutedTCPSocket({
    decide: async () => route,
    openTunnel: async () => {
      const socket = new FakeSocket();
      sockets.tunneled = socket;
      return { socket, reader: fakeReader(socket, leftover) };
    },
    openDirect: async () => {
      sockets.direct = new FakeSocket();
      return sockets.direct;
    },
  });
  return { Routed, sockets };
}

describe("basicAuthHeader", () => {
  test("encodes user:password as Basic auth", () => {
    assert.equal(basicAuthHeader("user", "pass"), `Basic ${Buffer.from("user:pass").toString("base64")}`);
  });
});

describe("parseHeaderBlock", () => {
  test("reads the status line and headers", () => {
    const parsed = parseHeaderBlock("HTTP/1.1 200 Connection established\r\nContent-Length: 0");
    assert.equal(parsed.status, 200);
    assert.equal(parsed.statusText, "Connection established");
    assert.equal(parsed.headers["content-length"], "0");
  });

  test("a 407 is readable as a proxy-auth failure", () => {
    const parsed = parseHeaderBlock("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic");
    assert.equal(parsed.status, 407);
  });

  test("a malformed status line yields 0 rather than a guess", () => {
    assert.equal(parseHeaderBlock("garbage").status, 0);
  });
});

describe("BoundedQueue", () => {
  test("delivers in order", async () => {
    const queue = new BoundedQueue(8);
    await queue.put("a");
    await queue.put("b");
    assert.equal(await queue.get(), "a");
    assert.equal(await queue.get(), "b");
  });

  test("get() waits for a later put()", async () => {
    const queue = new BoundedQueue(8);
    const waiting = queue.get();
    await queue.put("later");
    assert.equal(await waiting, "later");
  });

  test("close() resolves readers with undefined, which wisp treats as end-of-stream", async () => {
    const queue = new BoundedQueue(8);
    const waiting = queue.get();
    queue.close();
    assert.equal(await waiting, undefined);
  });

  test("close() discards buffered data so a closed stream cannot deliver", async () => {
    const queue = new BoundedQueue(8);
    await queue.put("buffered");
    queue.close();
    assert.equal(queue.size, 0);
    assert.equal(await queue.get(), undefined);
  });
});

describe("createRoutedTCPSocket", () => {
  test("a block decision refuses to connect, so nothing escapes unprotected", async () => {
    const { Routed, sockets } = buildSocket({
      route: { mode: "block", reason: "The VPN is not connected." },
    });
    const socket = new Routed("example.com", 443);
    await assert.rejects(() => socket.connect(), /not connected/);
    assert.equal(sockets.tunneled, null);
    assert.equal(sockets.direct, null);
    assert.equal(socket.mode, "block");
  });

  test("a direct decision dials directly and never touches the tunnel", async () => {
    const { Routed, sockets } = buildSocket({ route: { mode: "direct" } });
    const socket = new Routed("account.proton.me", 443);
    await socket.connect();
    assert.equal(socket.mode, "direct");
    assert.equal(sockets.tunneled, null);
    assert.ok(sockets.direct);
  });

  test("a proxy decision tunnels, and the residual handshake bytes arrive first", async () => {
    const { Routed, sockets } = buildSocket({
      route: { mode: "proxy", proxy: { host: "us-ny.protonvpn.net", port: 4454, authorization: "Basic x" } },
      leftover: Buffer.from("TLS-client-hello"),
    });
    const socket = new Routed("example.com", 443);
    await socket.connect();
    assert.equal(socket.mode, "proxy");
    assert.ok(sockets.tunneled);

    // The exact bug this guards: the first bytes of the target's session
    // arrived with the CONNECT response and must not be dropped.
    const first = await socket.recv();
    assert.equal(Buffer.from(first).toString(), "TLS-client-hello");

    sockets.tunneled.emit("data", Buffer.from("more"));
    assert.equal(Buffer.from(await socket.recv()).toString(), "more");
  });

  test("data is delivered once, not twice, after the handshake", async () => {
    const { Routed, sockets } = buildSocket({ route: { mode: "proxy", proxy: {} }, leftover: Buffer.alloc(0) });
    const socket = new Routed("example.com", 443);
    await socket.connect();

    sockets.tunneled.emit("data", Buffer.from("once"));
    const chunk = await socket.recv();
    assert.equal(Buffer.from(chunk).toString(), "once");

    // Nothing else was queued: a duplicate listener would have left a second
    // copy waiting here.
    assert.equal(socket.queue.size, 0);
  });

  test("recv() returns null once the stream ends, which is how wisp closes it", async () => {
    const { Routed, sockets } = buildSocket({ route: { mode: "proxy", proxy: {} }, leftover: Buffer.alloc(0) });
    const socket = new Routed("example.com", 443);
    await socket.connect();
    const waiting = socket.recv();
    sockets.tunneled.emit("end");
    assert.equal(await waiting, null);
  });

  test("sending on a closed stream fails instead of silently dropping bytes", async () => {
    const { Routed } = buildSocket({ route: { mode: "proxy", proxy: {} } });
    const socket = new Routed("example.com", 443);
    await socket.connect();
    await socket.close();
    await assert.rejects(() => socket.send(Buffer.from("x")), /closed/);
  });

  test("a stream that never connected cannot send", async () => {
    const { Routed } = buildSocket({ route: { mode: "direct" } });
    const socket = new Routed("example.com", 443);
    await assert.rejects(() => socket.send(Buffer.from("x")), /closed/);
  });

  test("pause and resume reach the underlying socket", async () => {
    const { Routed, sockets } = buildSocket({ route: { mode: "proxy", proxy: {} }, leftover: Buffer.alloc(0) });
    const socket = new Routed("example.com", 443);
    await socket.connect();
    // Fill past the high-water mark so pausing is warranted.
    for (let index = 0; index < socket.queue.max_size + 2; index += 1) {
      sockets.tunneled.emit("data", Buffer.from("x"));
    }
    socket.pause();
    assert.equal(sockets.tunneled.paused, true);
    socket.resume();
    assert.equal(sockets.tunneled.paused, false);
  });

  test("the socket exposes the hostname wisp logs", async () => {
    const { Routed } = buildSocket({ route: { mode: "direct" } });
    const socket = new Routed("example.com", 8443);
    assert.equal(socket.hostname, "example.com");
    assert.equal(socket.port, 8443);
  });
});
