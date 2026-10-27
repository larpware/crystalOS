/*
 * CrystalOS — Proton proxy transport, over real TLS
 *
 * The unit tests in tunnel.test.mjs use an injected socket, which proves the
 * routing logic but not the wire format. These run the real
 * `openConnectTunnel` / `requestThroughTunnel` / `createRoutedTCPSocket`
 * against a real HTTPS CONNECT proxy on loopback, with a real certificate and
 * real targets behind it. That is the closest thing to Proton's proxy available
 * without Proton credentials, and it exercises the failures that only appear on
 * the wire:
 *
 *   • the CONNECT request line, Host and Basic `Proxy-Authorization` headers;
 *   • a certificate that is verified rather than ignored — the test trusts its
 *     own throwaway CA through the injectable `connectImpl`, while the code
 *     under test keeps `rejectUnauthorized: true`;
 *   • the coalesced case where the gateway's own first bytes arrive in the same
 *     TLS record as the CONNECT reply, which is what silently eats the start of
 *     a stream when the handshake reader is wrong;
 *   • an HTTP request and its response travelling the whole way through a
 *     tunnel;
 *   • a 407 surfaced as a credential rejection rather than retried.
 *
 * A throwaway self-signed certificate is generated into a temporary directory
 * at run time: committing a private key, even a useless one, is not something a
 * repository should contain. If `openssl` is unavailable the suite skips itself
 * and says so rather than passing quietly.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer, connect as netConnect } from "node:net";
import { createServer as createTlsServer, connect as tlsConnect } from "node:tls";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRoutedTCPSocket, openConnectTunnel, requestThroughTunnel, verifyTlsThroughProxy } from "./tunnel.mjs";

const USERNAME = "proxy-user";
const PASSWORD = "proxy-pass";
const AUTHORIZATION = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;
/**
 * Bytes the proxy writes in the *same* TLS record as the CONNECT reply.
 *
 * This is the whole point of the coalescing case: a gateway is free to start
 * sending payload before the client has finished reading the handshake, and a
 * reader that discards its buffer loses it.
 */
const COALESCED = "GATEWAY-FIRST-BYTES";

let skip = false;
let reason = "";
let directory = null;
let certificate = null;
/** Every CONNECT the proxy saw, so the wire format can be asserted. */
const connects = [];
/** Server-side sockets, so a test run cannot leave the loop open. */
const liveSockets = new Set();
let proxyServer = null;
let proxyPort = 0;
let echoServer = null;
let echoPort = 0;
let httpServer = null;
let httpPort = 0;
let chunkedServer = null;
let chunkedPort = 0;
/** TLS targets used by the proof tests: one answers, one stays silent. */
let tlsAnswerServer = null;
let tlsAnswerPort = 0;
let tlsSilentServer = null;
let tlsSilentPort = 0;
let tlsNoiseServer = null;
let tlsNoisePort = 0;

function track(socket) {
  liveSockets.add(socket);
  socket.on("close", () => liveSockets.delete(socket));
  socket.on("error", () => undefined);
  return socket;
}

before(async () => {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
  } catch {
    skip = true;
    reason = "openssl is not on PATH, so the throwaway test certificate cannot be generated.";
    return;
  }

  directory = await mkdtemp(join(tmpdir(), "crescent-vpn-tls-"));
  const keyPath = join(directory, "key.pem");
  const certPath = join(directory, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", keyPath, "-out", certPath, "-days", "2",
      "-subj", "/CN=localhost",
      "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  certificate = await readFile(certPath, "utf8");
  const key = await readFile(keyPath, "utf8");

  // A plain echo target. It answers whatever it is sent, which is enough to
  // prove a byte stream survived the round trip both ways.
  echoServer = createNetServer((socket) => {
    track(socket);
    socket.on("data", (chunk) => socket.write(chunk));
  });
  await new Promise((resolve) => echoServer.listen(0, "127.0.0.1", resolve));
  echoPort = echoServer.address().port;

  // A target that speaks HTTP and closes, so a tunnelled request can be read to
  // completion instead of waiting for a timeout.
  httpServer = createHttpServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ IP: "203.0.113.9", Country: "CH", ISP: "Proton AG" }));
  });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  httpPort = httpServer.address().port;

  // A target that hand-writes chunked framing and deliberately splits the size
  // line, the chunk data and the terminator across separate writes. A decoder
  // that only works when a whole chunk arrives at once fails here.
  const chunkedPayload = JSON.stringify({ IP: "198.51.100.7", Country: "SE" });
  chunkedServer = createNetServer((socket) => {
    track(socket);
    socket.once("data", () => {
      const parts = [
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ntransfer-encoding: chunked\r\n\r\n",
        `${chunkedPayload.length.toString(16)}\r\n`,
        chunkedPayload.slice(0, 8),
        chunkedPayload.slice(8),
        "\r\n0\r\n\r\n",
      ];
      let index = 0;
      const writeNext = () => {
        if (index >= parts.length) return;
        socket.write(parts[index++]);
        setTimeout(writeNext, 5);
      };
      writeNext();
    });
  });
  await new Promise((resolve) => chunkedServer.listen(0, "127.0.0.1", resolve));
  chunkedPort = chunkedServer.address().port;

  /*
   * TLS targets for the proof. Each one completes a real handshake with the
   * throwaway certificate and then behaves differently — which is the whole
   * point: a handshake alone cannot tell them apart, and telling them apart is
   * what the proof now has to do.
   */
  tlsAnswerServer = createTlsServer({ key, cert: certificate }, (socket) => {
    track(socket);
    socket.once("data", () => {
      socket.write("HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok");
    });
  });
  await new Promise((resolve) => tlsAnswerServer.listen(0, "127.0.0.1", resolve));
  tlsAnswerPort = tlsAnswerServer.address().port;

  // Handshakes and then says nothing, ever: the exit that answers a CONNECT and
  // black-holes the stream behind it.
  tlsSilentServer = createTlsServer({ key, cert: certificate }, (socket) => {
    track(socket);
    socket.resume();
  });
  await new Promise((resolve) => tlsSilentServer.listen(0, "127.0.0.1", resolve));
  tlsSilentPort = tlsSilentServer.address().port;

  // Handshakes and then writes bytes that are not TLS records: the stream is
  // mangled in transit, which is the failure that used to surface as a page
  // that simply never rendered.
  tlsNoiseServer = createTlsServer({ key, cert: certificate }, (socket) => {
    track(socket);
    socket.once("data", () => socket.write(Buffer.alloc(512, 7)));
  });
  await new Promise((resolve) => tlsNoiseServer.listen(0, "127.0.0.1", resolve));
  tlsNoisePort = tlsNoiseServer.address().port;

  // An HTTPS CONNECT proxy with Proton's contract: TLS to the proxy, a CONNECT
  // line carrying Basic credentials, then an opaque byte pipe.
  proxyServer = createTlsServer({ key, cert: certificate }, (socket) => {
    track(socket);
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      socket.off("data", onData);

      const head = buffer.subarray(0, end).toString("latin1");
      const requestLine = head.split("\r\n")[0] ?? "";
      connects.push({
        requestLine,
        hostHeader: /^host:\s*(.+)$/im.exec(head)?.[1] ?? null,
        authorization: /^proxy-authorization:\s*(.+)$/im.exec(head)?.[1] ?? null,
      });

      if (/^proxy-authorization:\s*(.+)$/im.exec(head)?.[1] !== AUTHORIZATION) {
        socket.write("HTTP/1.1 407 Proxy Authentication Required\r\nproxy-authenticate: Basic\r\n\r\n");
        socket.end();
        return;
      }

      const match = /^CONNECT ([^:]+):(\d+) /.exec(requestLine);
      if (!match) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.end();
        return;
      }
      const destinationPort = Number(match[2]);
      const remainder = buffer.subarray(end + 4);

      const upstream = track(netConnect(destinationPort, match[1], () => {
        // The echo target is used for the coalescing scenario, so its reply and
        // the gateway's own bytes go out as one write. The HTTP target is not,
        // because a real gateway would not prepend bytes to a response.
        const extra = destinationPort === echoPort ? COALESCED : "";
        socket.write(`HTTP/1.1 200 Connection established\r\n\r\n${extra}`);
        if (remainder.length > 0) upstream.write(remainder);
      }));
      const pump = (from, to) => {
        from.on("data", (chunk) => to.write(chunk));
        from.on("end", () => to.end());
      };
      pump(socket, upstream);
      pump(upstream, socket);
    };
    socket.on("data", onData);
  });
  await new Promise((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
  proxyPort = proxyServer.address().port;
});

after(async () => {
  for (const socket of liveSockets) socket.destroy();
  liveSockets.clear();
  for (const server of [proxyServer, echoServer, httpServer, chunkedServer, tlsAnswerServer, tlsSilentServer, tlsNoiseServer]) {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

/**
 * Trusts the throwaway CA by name.
 *
 * `servername` is set to `localhost` rather than the loopback address because
 * RFC 6066 forbids an IP in SNI — a real gateway is always reached by name, so
 * this is the test correcting its own setup, not the code being lenient.
 */
const connectTrustingTestCa = (options) =>
  tlsConnect({ ...options, ca: certificate, servername: "localhost" });

const PROXY = { host: "127.0.0.1", port: 0, authorization: AUTHORIZATION };

/** Reads until `predicate(chunk)` is true, or the budget runs out. */
async function recvUntil(socket, predicate, budgetMs = 4_000) {
  const deadline = Date.now() + budgetMs;
  let text = "";
  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      socket.recv(),
      new Promise((resolve) => setTimeout(() => resolve("__timeout__"), Math.max(1, deadline - Date.now()))),
    ]);
    if (chunk === null) break;
    if (chunk === "__timeout__") break;
    text += Buffer.from(chunk).toString("utf8");
    if (predicate(text)) break;
  }
  return text;
}

describe("openConnectTunnel over real TLS", () => {
  test("completes a verified TLS handshake and issues a valid CONNECT", async (t) => {
    if (skip) return t.skip(reason);
    connects.length = 0;
    const { socket } = await openConnectTunnel({
      proxy: { ...PROXY, port: proxyPort },
      target: { host: "127.0.0.1", port: echoPort },
      connectImpl: connectTrustingTestCa,
    });
    socket.destroy();

    assert.equal(connects.length, 1);
    assert.equal(connects[0].requestLine, `CONNECT 127.0.0.1:${echoPort} HTTP/1.1`);
    assert.equal(connects[0].hostHeader, `127.0.0.1:${echoPort}`);
    assert.equal(connects[0].authorization, AUTHORIZATION);
  });

  test("the bytes that arrived with the CONNECT reply are not lost", async (t) => {
    if (skip) return t.skip(reason);
    const { socket, reader } = await openConnectTunnel({
      proxy: { ...PROXY, port: proxyPort },
      target: { host: "127.0.0.1", port: echoPort },
      connectImpl: connectTrustingTestCa,
    });

    const received = [];
    reader.takeRest((chunk) => received.push(chunk.toString("utf8")));
    // The gateway's bytes were written in the same TLS record as the reply, so
    // they were already in the handshake reader's buffer — but they are handed
    // over on the next tick, not synchronously.
    await new Promise((resolve) => setTimeout(resolve, 300));
    socket.destroy();

    assert.equal(received.join(""), COALESCED);
  });

  test("a rejected credential is reported as such, not retried", async (t) => {
    if (skip) return t.skip(reason);
    await assert.rejects(
      () =>
        openConnectTunnel({
          proxy: { host: "127.0.0.1", port: proxyPort, authorization: "Basic wrong" },
          target: { host: "127.0.0.1", port: echoPort },
          connectImpl: connectTrustingTestCa,
        }),
      /rejected these credentials/,
    );
  });

  test("an untrusted certificate is refused, because verification is not relaxed", async (t) => {
    if (skip) return t.skip(reason);
    // The default `connectImpl` uses Node's own trust store, where a throwaway
    // self-signed certificate is unknown — which is exactly what should happen.
    await assert.rejects(() =>
      openConnectTunnel({
        proxy: { ...PROXY, port: proxyPort },
        target: { host: "127.0.0.1", port: echoPort },
        timeoutMs: 5_000,
      }),
    );
  });
});

describe("the exit proof over real TLS", () => {
  /*
   * These are the difference between a VPN that says "connected" and a VPN that
   * can actually carry a page. The certificate check is one half; the answer a
   * real request gets over the session is the other, and it is the half a
   * public exit fails while still completing handshakes.
   */
  test("a session that carries a real answer is accepted", async (t) => {
    if (skip) return t.skip(reason);
    const proof = await verifyTlsThroughProxy({
      proxy: { ...PROXY, port: proxyPort },
      target: { host: "127.0.0.1", port: tlsAnswerPort },
      connectImpl: connectTrustingTestCa,
      timeoutMs: 6_000,
    });
    assert.equal(proof.status, 200);
    assert.equal(typeof proof.subject, "string");
  });

  test("a session that answers a CONNECT and then says nothing is refused", async (t) => {
    if (skip) return t.skip(reason);
    await assert.rejects(
      () =>
        verifyTlsThroughProxy({
          proxy: { ...PROXY, port: proxyPort },
          target: { host: "127.0.0.1", port: tlsSilentPort },
          connectImpl: connectTrustingTestCa,
          timeoutMs: 1_200,
        }),
      /no answer to a request over it/,
    );
  });

  test("a session whose stream is mangled is refused", async (t) => {
    if (skip) return t.skip(reason);
    await assert.rejects(() =>
      verifyTlsThroughProxy({
        proxy: { ...PROXY, port: proxyPort },
        target: { host: "127.0.0.1", port: tlsNoisePort },
        connectImpl: connectTrustingTestCa,
        timeoutMs: 1_200,
      }),
    );
  });

  test("a proxy whose credentials are refused never gets as far as a session", async (t) => {
    if (skip) return t.skip(reason);
    await assert.rejects(
      () =>
        verifyTlsThroughProxy({
          proxy: { host: "127.0.0.1", port: proxyPort, authorization: "Basic wrong" },
          target: { host: "127.0.0.1", port: tlsAnswerPort },
          connectImpl: connectTrustingTestCa,
          timeoutMs: 1_200,
        }),
      /refused a CONNECT/,
    );
  });
});

describe("requestThroughTunnel over real TLS", () => {
  test("carries a request end to end and reads the response", async (t) => {
    if (skip) return t.skip(reason);
    const response = await requestThroughTunnel({
      proxy: { ...PROXY, port: proxyPort },
      host: "127.0.0.1",
      port: httpPort,
      path: "/api/vpn/v1/location",
      connectImpl: connectTrustingTestCa,
      timeoutMs: 8_000,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), {
      IP: "203.0.113.9",
      Country: "CH",
      ISP: "Proton AG",
    });
  });

  test("decodes a chunked body, which is how a server answers without a length", async (t) => {
    if (skip) return t.skip(reason);
    const { jsonThroughTunnel } = await import("./tunnel.mjs");
    const response = await jsonThroughTunnel({
      proxy: { ...PROXY, port: proxyPort },
      host: "127.0.0.1",
      port: chunkedPort,
      path: "/api/vpn/v1/location",
      connectImpl: connectTrustingTestCa,
      timeoutMs: 8_000,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.data, { IP: "198.51.100.7", Country: "SE" });
  });
});

describe("the wisp socket over real TLS", () => {
  test("a proxied stream round-trips bytes through the tunnel", async (t) => {
    if (skip) return t.skip(reason);
    const Routed = createRoutedTCPSocket({
      decide: async () => ({
        mode: "proxy",
        proxy: { host: "127.0.0.1", port: proxyPort, authorization: AUTHORIZATION },
      }),
      openTunnel: (args) => openConnectTunnel({ ...args, connectImpl: connectTrustingTestCa }),
    });

    const socket = new Routed("127.0.0.1", echoPort);
    await socket.connect();

    // The gateway's coalesced bytes arrive first, then the echo target answers.
    assert.match(await recvUntil(socket, (text) => text.includes(COALESCED)), /GATEWAY-FIRST-BYTES/);

    await socket.send(Buffer.from("ping"));
    assert.match(await recvUntil(socket, (text) => text.includes("ping")), /ping/);

    await socket.close();
    assert.equal(await socket.recv(), null);
  });

  test("a block decision refuses before any CONNECT is sent", async (t) => {
    if (skip) return t.skip(reason);
    const Routed = createRoutedTCPSocket({
      decide: async () => ({ mode: "block", reason: "The VPN is not connected." }),
      openTunnel: (args) => openConnectTunnel({ ...args, connectImpl: connectTrustingTestCa }),
    });
    const before = connects.length;
    const socket = new Routed("127.0.0.1", echoPort);
    await assert.rejects(() => socket.connect(), /not connected/);
    assert.equal(connects.length, before, "no CONNECT may reach the proxy when routing is blocked");
  });

  test("a direct decision dials the target itself, bypassing the proxy", async (t) => {
    if (skip) return t.skip(reason);
    const Routed = createRoutedTCPSocket({
      decide: async () => ({ mode: "direct" }),
      openTunnel: (args) => openConnectTunnel({ ...args, connectImpl: connectTrustingTestCa }),
    });
    const before = connects.length;
    const socket = new Routed("127.0.0.1", echoPort);
    await socket.connect();
    await socket.send(Buffer.from("direct"));
    assert.match(await recvUntil(socket, (text) => text.includes("direct")), /direct/);
    await socket.close();
    assert.equal(connects.length, before, "an excluded host must not reach the proxy");
  });
});
