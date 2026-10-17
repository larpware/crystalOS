/*
 * CrystalOS — Proton proxy transport
 *
 * ## What the Proton extension actually does
 *
 * The extension shipped in this repository (protonvpnextension/) is an MV3
 * WebExtension whose manifest asks for `proxy`. It never opens a VPN tunnel
 * itself. `tools/proxy.ts` builds a `fixed_servers` proxy config with
 * `scheme: 'https'` pointing at the selected server on port 4443 (443 for
 * Secure Core), and `vpn/getBasicAuth.ts` supplies a pre-emptive Basic
 * `Proxy-Authorization` header from the short-lived credentials Proton mints per
 * session. Everything else — server choice, credential issuance, status — is
 * plain HTTPS to `account.proton.me/api/`.
 *
 * An HTTPS CONNECT proxy is ordinary TCP, so none of that requires a Chromium
 * extension host. This module is the same transport, spoken from CrystalOS's own
 * backend.
 *
 * ## Why it lives on the backend
 *
 * Proxied CrystalOS traffic does not leave from the browser: the Scramjet
 * service worker forwards it over the Wisp WebSocket to
 * `server/scramjet/index.js`, which dials the real socket. So the machine that
 * makes the final request is the backend, and the backend is where the proxy has
 * to be applied. Pointing the *browser* at a proxy would protect nothing here —
 * the earlier audit identified this traffic path correctly, and this module is
 * the answer to it.
 *
 * ## The socket contract
 *
 * `@mercuryworkshop/wisp-js` lets a caller replace the socket it dials through
 * the documented `conn_options` of `routeRequest(req, socket, head, options)`:
 * `ServerConnection` resolves `options.TCPSocket || NodeTCPSocket`. Its own
 * socket class is not in the package's export map, so a replacement has to
 * implement the contract itself, which is what `createRoutedTCPSocket` does:
 *
 *   new S(hostname, port) · connect() · recv() · send(data)
 *   close() · pause() · resume() · hostname  (used in wisp's log lines)
 *
 * `recv()` resolves with a chunk, or `null` once the stream is finished — wisp
 * breaks its read loop on `null`.
 */

import { lookup } from "node:dns/promises";
import { connect as netConnect, isIP, Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

import { PROXY_HANDSHAKE_TIMEOUT_MS } from "./config.mjs";

/** `Basic <base64(user:pass)>`, the header the extension sends pre-emptively. */
export function basicAuthHeader(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

/**
 * A bounded async queue with wisp's `AsyncQueue` semantics.
 *
 * Kept local rather than imported: wisp's copy is not reachable through the
 * package's export map, and the contract is four methods wide. `get()` resolves
 * with `undefined` after `close()`, which is what makes wisp's `data == null`
 * check end a stream cleanly.
 */
class BoundedQueue {
  constructor(maxSize) {
    this.max_size = maxSize;
    this.items = [];
    this.waitingForItem = [];
    this.waitingForSpace = [];
    this.closed = false;
  }

  put(data) {
    // A closed stream must not accumulate anything: its readers have already
    // been told the stream is over, and buffering after that is a leak.
    if (this.closed) return Promise.resolve();
    if (this.items.length <= this.max_size) {
      this.items.push(data);
      this.waitingForItem.shift()?.();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waitingForSpace.push(() => {
        this.items.push(data);
        this.waitingForItem.shift()?.();
        resolve();
      });
    });
  }

  get() {
    if (this.items.length > 0) {
      this.waitingForSpace.shift()?.();
      return Promise.resolve(this.items.shift());
    }
    // Answering a read that arrives *after* close immediately is what stops a
    // consumer from parking forever. wisp's own loop may already be inside
    // `recv()` when a stream is torn down, and a reader that never returns
    // would leave that read task alive for the life of the process.
    if (this.closed) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      this.waitingForItem.push(() => {
        this.waitingForSpace.shift()?.();
        resolve(this.items.shift());
      });
    });
  }

  close() {
    this.closed = true;
    this.items = [];
    for (const resolve of this.waitingForItem.splice(0)) resolve();
    for (const resolve of this.waitingForSpace.splice(0)) resolve();
  }

  get size() {
    return this.items.length;
  }
}

/* ------------------------------------------------------------ header reader */

function parseHeaderBlock(head) {
  const lines = head.split("\r\n");
  const statusLine = lines.shift() ?? "";
  const match = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/.exec(statusLine);
  const headers = {};
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index === -1) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return { status: match ? Number(match[1]) : 0, statusText: match?.[2] ?? "", headers };
}

/**
 * Decodes a response body as it arrives.
 *
 * Two framings have to be handled, because real APIs use both: an explicit
 * `content-length`, and `transfer-encoding: chunked`, which HTTP/1.1 falls back
 * to whenever the responder did not know the size in advance. Reading the raw
 * stream without decoding chunk framing yields a body that starts with a hex
 * length and ends with a bare `0`, which is the difference between a working
 * exit-IP check and a permanent "unexpected response from the VPN API".
 *
 * Deliberately minimal: no trailers, no compression, no redirects — it decodes
 * exactly the framings this one verification request can encounter, and refuses
 * anything it does not understand rather than guessing.
 */
function createBodyDecoder({ chunked, contentLength, maxBytes }) {
  let raw = Buffer.alloc(0);
  let body = Buffer.alloc(0);
  let remaining = contentLength;
  let finished = !chunked && contentLength === 0;
  let overflow = false;

  const append = (slice) => {
    if (body.length + slice.length > maxBytes) {
      overflow = true;
      finished = true;
      return;
    }
    body = Buffer.concat([body, slice]);
  };

  return {
    /** Feeds newly arrived bytes; returns true once the body is complete. */
    push(chunk) {
      if (finished) return true;
      if (!chunked) {
        const take = remaining == null ? chunk : chunk.subarray(0, remaining);
        append(take);
        if (remaining != null) {
          remaining -= take.length;
          if (remaining <= 0) finished = true;
        }
        return finished;
      }
      raw = Buffer.concat([raw, chunk]);
      for (;;) {
        const lineEnd = raw.indexOf("\r\n");
        if (lineEnd === -1) return false;
        // The size line may carry chunk extensions after a `;`, which are not
        // part of the data and must not be read as part of the length.
        const size = Number.parseInt(raw.subarray(0, lineEnd).toString("latin1").split(";")[0].trim(), 16);
        if (!Number.isInteger(size) || size < 0) {
          finished = true;
          return true;
        }
        if (size === 0) {
          finished = true;
          raw = Buffer.alloc(0);
          return true;
        }
        if (raw.length < lineEnd + 2 + size + 2) return false;
        append(raw.subarray(lineEnd + 2, lineEnd + 2 + size));
        raw = raw.subarray(lineEnd + 2 + size + 2);
        if (finished) return true;
      }
    },
    get done() {
      return finished;
    },
    get overflowed() {
      return overflow;
    },
    text() {
      return body.toString("utf8");
    },
  };
}

/**
 * Reads one HTTP header block off a socket, then hands over the byte stream.
 *
 * The ordering here is the whole point. A TLS tunnel can deliver the CONNECT
 * response and the first bytes the caller actually wants inside the *same*
 * packet, so a reader that attaches late, or that drops the remainder of its
 * buffer, silently swallows the beginning of the stream — which surfaces as a
 * page that never renders rather than as an error.
 *
 * `takeRest(consumer)` is also the only data path after the handshake. Adding a
 * second `data` listener would deliver every chunk twice, so the contract is:
 * once `takeRest` has been called, the consumer owns all bytes.
 */
function createHeaderReader(socket) {
  let buffer = Buffer.alloc(0);
  let done = false;
  let consumer = null;
  const pending = [];
  let settle = null;

  const onData = (chunk) => {
    if (done) {
      if (consumer) consumer(chunk);
      else pending.push(chunk);
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    const end = buffer.indexOf("\r\n\r\n");
    if (end === -1) return;
    done = true;
    const head = buffer.subarray(0, end).toString("latin1");
    const rest = Buffer.from(buffer.subarray(end + 4));
    buffer = Buffer.alloc(0);
    if (rest.length > 0) pending.push(rest);
    settle?.resolve(head);
  };

  const onFail = (error) => {
    if (done) return;
    done = true;
    settle?.reject(error instanceof Error ? error : new Error(String(error)));
  };

  socket.on("data", onData);
  socket.once("error", onFail);
  socket.once("close", () => onFail(new Error("The proxy closed the connection during the handshake.")));

  return {
    /** Resolves with the raw header block once `\r\n\r\n` arrives. */
    wait() {
      return new Promise((resolve, reject) => {
        settle = { resolve, reject };
      });
    },
    /**
     * Installs the post-handshake consumer and replays everything already read.
     *
     * Buffering until a consumer exists matters as much as the remainder above:
     * the handshake resolves its promise a tick before the caller resumes, and
     * a payload arriving inside that window used to be dropped on the floor.
     * Both are the same bug — bytes that exist but reach nobody.
     */
    takeRest(consumer_) {
      consumer = consumer_;
      socket.off("error", onFail);
      socket.off("close", onFail);
      for (const chunk of pending.splice(0)) consumer(chunk);
    },
  };
}

/* ----------------------------------------------------------------- tunnel */

/**
 * Dials the Proton HTTPS proxy and CONNECTs to `target`.
 *
 * Returns a handshaken TLS socket positioned at the start of the target's
 * payload. Because the socket is a TLS session with the *proxy*, the bytes that
 * flow through it are the caller's own end-to-end session with the target:
 * CrystalOS neither terminates nor inspects it, and the target's certificate is
 * still validated by whoever owns that session (the browser).
 *
 * `rejectUnauthorized` is left at Node's default of `true`. The hop to Proton's
 * proxy is verified, and relaxing that to make a connection succeed is exactly
 * the downgrade this integration must not perform.
 */
export async function openConnectTunnel({
  proxy,
  target,
  timeoutMs = PROXY_HANDSHAKE_TIMEOUT_MS,
  connectImpl = null,
}) {
  /*
   * Proton's proxy is HTTPS, so the hop to it is TLS. A user-supplied endpoint
   * may be a plain-HTTP proxy (`scheme: "http"`), which is the same protocol
   * without the TLS wrapper — so the scheme selects how the socket is opened
   * and which event means "the socket is up". TLS verification is unaffected:
   * `rejectUnauthorized` stays at Node's default of `true` for HTTPS, and it is
   * never relaxed to make a connection succeed.
   */
  const scheme = proxy.scheme === "http" ? "http" : "https";
  // An injected connector keeps the TLS-shaped call, so the existing tests that
  // supply their own throwaway-CA connector are unchanged.
  const connector = connectImpl ?? (scheme === "http" ? netConnect : tlsConnect);
  const socket =
    scheme === "http" && !connectImpl
      ? connector({ host: proxy.host, port: proxy.port })
      : connector({
          host: proxy.host,
          port: proxy.port,
          // SNI must be the proxy's own hostname: the proxy presents a
          // certificate for it, and an empty servername would fail verification.
          servername: proxy.host,
          rejectUnauthorized: true,
          ALPNProtocols: ["http/1.1"],
        });
  socket.setNoDelay(true);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out reaching the VPN server's proxy."));
    }, timeoutMs);
    const done = (error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    socket.once(scheme === "http" && !connectImpl ? "connect" : "secureConnect", () => done());
    socket.once("error", (error) => done(error));
  });

  const reader = createHeaderReader(socket);
  const waited = reader.wait();
  const connectRequest = [
    `CONNECT ${target.host}:${target.port} HTTP/1.1`,
    `Host: ${target.host}:${target.port}`,
  ];
  // Only sent when there are credentials: a proxy that wants none must not be
  // handed an empty `Basic Og==` that it may reject outright.
  if (proxy.authorization) connectRequest.push(`Proxy-Authorization: ${proxy.authorization}`);
  connectRequest.push("Proxy-Connection: keep-alive", "", "");
  socket.write(connectRequest.join("\r\n"));

  const head = await Promise.race([
    waited,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("The VPN server's proxy did not answer the CONNECT request.")),
        timeoutMs,
      ),
    ),
  ]).catch((error) => {
    socket.destroy();
    throw error;
  });

  const { status, statusText } = parseHeaderBlock(head);
  if (status === 407) {
    socket.destroy();
    throw new Error(
      "The proxy rejected these credentials. Reconnect to fetch fresh ones, or check the endpoint's username and password.",
    );
  }
  if (status !== 200) {
    socket.destroy();
    throw new Error(
      `The VPN server refused the connection to ${target.host}:${target.port} (${status} ${statusText})`.trim(),
    );
  }

  return { socket, reader };
}

/* --------------------------------------------------- TLS proof through a proxy */

/** Reads the CONNECT response head off a socket, keeping any bytes after it. */
function readConnectResponse(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const finish = (fn, value) => {
      clearTimeout(timer);
      socket.off("data", onData);
      fn(value);
    };
    const timer = setTimeout(
      () => finish(reject, new Error("The proxy did not answer the CONNECT request.")),
      timeoutMs,
    );
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      finish(resolve, {
        head: buffer.subarray(0, end).toString("latin1"),
        rest: Buffer.from(buffer.subarray(end + 4)),
      });
    };
    socket.on("data", onData);
    socket.once("error", (error) => finish(reject, error));
  });
}

/**
 * Proves a proxy can carry a *real, verified* TLS session to `target`.
 *
 * A CONNECT that returns 200 is only a promise. It cannot tell a working exit
 * from one that black-holes the target, and it cannot tell either from a proxy
 * that answers the CONNECT itself and then performs a man-in-the-middle TLS
 * handshake with an untrusted certificate. All three look identical at the
 * CONNECT layer — and a MITM or a dead exit is exactly how a proxied page goes
 * blank or throws a certificate error.
 *
 * So this dials the tunnel and then completes an ordinary TLS handshake with
 * `rejectUnauthorized` left at its default of `true`, checking the target's
 * certificate against the target's own name. A rogue proxy cannot pass, because
 * passing would require a certificate it cannot forge. The session is destroyed
 * the moment it is proven; nothing is ever requested over it.
 *
 * On success resolves `{ subject }` (the certificate's CN, for the log). On any
 * failure it throws — the caller treats every throw as "this proxy is no good".
 */
export async function verifyTlsThroughProxy({ proxy, target, timeoutMs = PROXY_HANDSHAKE_TIMEOUT_MS }) {
  const scheme = proxy.scheme === "http" ? "http" : "https";
  const socket =
    scheme === "http"
      ? netConnect({ host: proxy.host, port: proxy.port })
      : tlsConnect({
          host: proxy.host,
          port: proxy.port,
          servername: proxy.host,
          rejectUnauthorized: true,
          ALPNProtocols: ["http/1.1"],
        });
  socket.setNoDelay(true);

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("Timed out reaching the proxy."));
      }, timeoutMs);
      const done = (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      socket.once(scheme === "http" ? "connect" : "secureConnect", () => done());
      socket.once("error", (error) => done(error));
    });

    const connectRequest = [
      `CONNECT ${target.host}:${target.port} HTTP/1.1`,
      `Host: ${target.host}:${target.port}`,
    ];
    if (proxy.authorization) connectRequest.push(`Proxy-Authorization: ${proxy.authorization}`);
    connectRequest.push("Proxy-Connection: keep-alive", "", "");
    socket.write(connectRequest.join("\r\n"));

    const { head, rest } = await readConnectResponse(socket, timeoutMs);
    const { status, statusText } = parseHeaderBlock(head);
    if (status !== 200) {
      throw new Error(`The proxy refused a CONNECT to ${target.host}:${target.port} (${status} ${statusText})`.trim());
    }
    // Any bytes that arrived with the CONNECT reply belong to the target's TLS
    // stream, so they are handed back to the socket before TLS wraps it.
    if (rest.length > 0) socket.unshift(rest);

    const secure = tlsConnect({ socket, servername: target.host, rejectUnauthorized: true });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        secure.destroy();
        reject(new Error("Timed out completing TLS through the proxy."));
      }, timeoutMs);
      secure.once("secureConnect", () => {
        clearTimeout(timer);
        resolve();
      });
      secure.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const subject = secure.getPeerCertificate()?.subject?.CN ?? null;
    secure.destroy();
    socket.destroy();
    return { subject };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

/* --------------------------------------------------- direct dial (fallback) */

/**
 * The plain, unprotected dial used for hosts the tunnel must never carry:
 * Proton's own API host, and loopback/private addresses.
 *
 * Only ever reached when `decide()` answers `direct`. When the user has asked
 * for protection and the connection is not up, `decide()` answers `block`
 * instead, so this path cannot become a silent leak.
 */
function openDirectSocket(hostname, port, timeoutMs = PROXY_HANDSHAKE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const dial = async () => {
      const address = isIP(hostname) ? hostname : (await lookup(hostname)).address;
      const socket = new Socket();
      socket.setNoDelay(true);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Timed out connecting to ${hostname}:${port}.`));
      }, timeoutMs);
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.connect({ host: address, port }, () => {
        clearTimeout(timer);
        socket.off("error", () => undefined);
        resolve(socket);
      });
    };
    dial().catch(reject);
  });
}

/* ----------------------------------------------------------------- socket */

/**
 * Builds the socket class wisp dials through.
 *
 * `decide(hostname, port)` runs once per stream, at connect time, and is the
 * single place where routing is chosen. Deciding per stream rather than per
 * process is what makes a settings change apply to the next request instead of
 * to the process's whole lifetime, and what lets an in-flight request keep the
 * route it started on.
 */
export function createRoutedTCPSocket({
  decide,
  openTunnel = openConnectTunnel,
  openDirect = openDirectSocket,
}) {
  return class RoutedTCPSocket {
    constructor(hostname, port) {
      this.hostname = hostname;
      this.port = port;
      this.recv_buffer_size = 128;

      this.socket = null;
      this.paused = false;
      this.connected = false;
      this.mode = null;
      this.queue = new BoundedQueue(this.recv_buffer_size);
    }

    async connect() {
      const decision = await decide(this.hostname, this.port);
      this.mode = decision.mode;

      if (decision.mode === "block") {
        // Fail closed. The controller renders the same reason in the UI, so the
        // user sees why rather than a page that silently failed.
        throw new Error(decision.reason ?? "Blocked: the VPN is not protecting traffic right now.");
      }

      if (decision.mode === "direct") {
        this.socket = await openDirect(this.hostname, this.port);
        // No handshake reader here, so this is the only data path.
        this.socket.on("data", (chunk) => void this.queue.put(chunk));
      } else {
        const { socket, reader } = await openTunnel({
          proxy: decision.proxy,
          target: { host: this.hostname, port: this.port },
        });
        this.socket = socket;
        // From here the socket is a byte stream. `takeRest` replays anything
        // that arrived with the handshake and owns every later chunk, so no
        // second `data` listener is attached in this branch.
        reader.takeRest((chunk) => void this.queue.put(chunk));
      }

      this.socket.on("end", () => this.queue.close());
      this.socket.on("close", () => this.queue.close());
      this.socket.on("error", () => this.queue.close());

      this.connected = true;
    }

    async recv() {
      const item = await this.queue.get();
      return item === undefined ? null : item;
    }

    async send(data) {
      if (!this.socket || this.socket.destroyed) {
        throw new Error("The stream is closed.");
      }
      await new Promise((resolve, reject) => {
        this.socket.write(data, (error) => (error ? reject(error) : resolve()));
      });
    }

    async close() {
      this.queue.close();
      if (this.socket && !this.socket.destroyed) this.socket.end();
      this.socket = null;
    }

    pause() {
      if (this.queue.size >= this.queue.max_size && this.socket && !this.paused) {
        this.socket.pause();
        this.paused = true;
      }
    }

    resume() {
      if (this.paused && this.socket) {
        this.socket.resume();
        this.paused = false;
      }
    }
  };
}

/* --------------------------------------------------- through-tunnel HTTP */

/**
 * Sends one HTTP request through the tunnel and returns the parsed response.
 *
 * Used for the exit-IP verification: the request is issued inside the CONNECT
 * tunnel, so whatever answers it observes the VPN exit address rather than this
 * machine's. Deliberately narrow — one request, a byte cap, a timeout — because
 * it is not a general-purpose HTTP client and must not become one.
 */
export async function requestThroughTunnel({
  proxy,
  host,
  port = 443,
  path = "/",
  method = "GET",
  headers = {},
  body = null,
  timeoutMs = PROXY_HANDSHAKE_TIMEOUT_MS,
  maxBytes = 256 * 1024,
  /*
   * `null` rather than `tlsConnect`, so `openConnectTunnel` chooses the
   * connector from the proxy's own scheme. Defaulting to the TLS connector here
   * forced every exit check through a TLS handshake, which a plain-HTTP proxy
   * (the account-free provider's default case) cannot answer — the check then
   * failed as "unreachable" for a proxy that was working. A test can still
   * inject its own connector, and the production path still never relaxes
   * verification: for an https proxy the scheme branch uses `tlsConnect` with
   * `rejectUnauthorized: true`.
   */
  connectImpl = null,
}) {
  const { socket, reader } = await openConnectTunnel({
    proxy,
    target: { host, port },
    timeoutMs,
    connectImpl,
  });
  const result = { status: 0, headers: {}, body: "" };

  try {
    const requestHeaders = {
      host,
      accept: "application/json",
      "accept-encoding": "identity",
      connection: "close",
      ...headers,
    };
    if (body != null) requestHeaders["content-length"] = String(Buffer.byteLength(body));

    const lines = [`${method} ${path} HTTP/1.1`];
    for (const [key, value] of Object.entries(requestHeaders)) lines.push(`${key}: ${value}`);
    socket.write(`${lines.join("\r\n")}\r\n\r\n${body ?? ""}`);

    await new Promise((resolve, reject) => {
      let decoder = null;
      let head = Buffer.alloc(0);
      let settled = false;

      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("The verification request through the tunnel timed out."));
      }, timeoutMs);

      const complete = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!error && decoder) result.body = decoder.text();
        if (error) reject(error);
        else resolve();
      };

      reader.takeRest((chunk) => {
        if (decoder) {
          decoder.push(chunk);
          if (decoder.overflowed) {
            socket.destroy();
            complete(new Error("The verification response was larger than expected."));
          } else if (decoder.done) {
            complete();
          }
          return;
        }
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n");
        if (end === -1) return;

        const parsed = parseHeaderBlock(head.subarray(0, end).toString("latin1"));
        result.status = parsed.status;
        result.headers = parsed.headers;
        const rest = head.subarray(end + 4);
        head = Buffer.alloc(0);

        const length = parsed.headers["content-length"];
        decoder = createBodyDecoder({
          chunked: (parsed.headers["transfer-encoding"] ?? "").toLowerCase().includes("chunked"),
          contentLength: length != null && Number.isFinite(Number(length)) ? Number(length) : null,
          maxBytes,
        });
        if (rest.length > 0) decoder.push(rest);
        if (decoder.done) complete();
      });

      // A `connection: close` response ends at the peer's FIN; one with a known
      // framing has usually already been completed above, before the FIN ever
      // arrives. The `close` path covers a peer that drops the connection
      // without one, so a half-read body is reported rather than hung on.
      socket.once("close", () => complete());
      socket.once("end", () => complete());
      socket.once("error", (error) => complete(error));
    });

    return result;
  } finally {
    if (!socket.destroyed) socket.destroy();
  }
}

/** Convenience: the same request, decoded as JSON when it is JSON. */
export async function jsonThroughTunnel(options) {
  const response = await requestThroughTunnel(options);
  try {
    return { status: response.status, data: JSON.parse(response.body) };
  } catch {
    return { status: response.status, data: null };
  }
}

export { BoundedQueue, parseHeaderBlock, createHeaderReader };
