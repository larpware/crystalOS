/*
 * CrystalOS — the account-free provider
 *
 * The manual provider is the one a user can actually run without handing
 * CrystalOS anybody's credentials, so it gets both kinds of test:
 *
 *   • injected-tunnel tests for the state machine — what `connected` is allowed
 *     to mean, what the snapshot may carry, and what survives a restart;
 *   • a real HTTP proxy on loopback for the wire — the CONNECT request line, the
 *     Basic credentials, a 407 refusal, and an egress check whose bytes really
 *     travel through the tunnel.
 *
 * The second group is the one that matters. A proxy client that has only ever
 * been tested against a fake can be wrong in ways no assertion notices.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer, connect as netConnect } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createVpnController, ERROR, STATUS } from "./controller.mjs";
import { createEndpointStore, EndpointError, PROVIDER } from "./endpoint.mjs";
import { openConnectTunnel, requestThroughTunnel } from "./tunnel.mjs";

/* ------------------------------------------------------------------ harness */

const ENDPOINT = {
  scheme: "https",
  host: "proxy.example.net",
  port: 8443,
  username: "crystalvpn-user",
  password: "crystalvpn-token",
  name: "CrystalVPN — Frankfurt",
  checkUrl: "http://check.example.net/ip",
};

function memorySessionStore() {
  return {
    load: async () => null,
    save: async (session) => session,
    clear: async () => undefined,
    describe: async () => ({ signedIn: false, uid: null, updatedAt: null }),
  };
}

/** Proton must never be consulted on the manual path; this fails loudly if it is. */
function unusedProton() {
  const handler = {
    get(_target, property) {
      return () => {
        throw new Error(`The manual provider must not call proton.${String(property)}.`);
      };
    },
  };
  return new Proxy({}, handler);
}

function fakeTunnel({ handshakeError = null, requestBody = '{"ip":"203.0.113.9"}' } = {}) {
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
        requested.push(options);
        return { status: 200, headers: {}, body: requestBody };
      },
    },
  };
}

/** The real transport, for the tests that put bytes on a socket. */
function realTunnel() {
  return { opened: [], requested: [], tunnel: { openConnectTunnel, requestThroughTunnel } };
}

function memoryEndpointStore(initial = null) {
  let current = initial;
  return {
    load: async () => current ?? { provider: PROVIDER.proton, endpoint: null, updatedAt: null },
    save: async (value) => {
      current = value;
      return value;
    },
    clear: async () => {
      current = null;
    },
    current: () => current,
    describe: async () => ({
      provider: current?.provider ?? PROVIDER.proton,
      endpoint: current?.endpoint ?? null,
      hasEndpoint: Boolean(current?.endpoint),
      updatedAt: null,
    }),
  };
}

function build({ tunnel, endpointStore } = {}) {
  const tunnelParts = tunnel ?? fakeTunnel();
  const store = endpointStore ?? memoryEndpointStore();
  const controller = createVpnController({
    sessionStore: memorySessionStore(),
    endpointStore: store,
    proton: unusedProton(),
    tunnel: tunnelParts.tunnel,
  });
  return { controller, tunnelParts, endpointStore: store };
}

/** Lets the connect-time egress check (deliberately not awaited) finish. */
async function settle(predicate) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return false;
}

/* ------------------------------------------------------- state machine tests */

describe("the account-free provider", () => {
  test("a fresh profile has no endpoint and follows the stored provider", () => {
    const { controller } = build();
    assert.equal(controller.snapshot().provider, PROVIDER.proton);
    assert.equal(controller.snapshot().endpoint, null);
  });

  test("connecting with no endpoint says so instead of failing vaguely", async () => {
    const { controller } = build();
    await controller.setProvider(PROVIDER.manual);
    const snapshot = await controller.connect();
    assert.equal(snapshot.status, STATUS.error);
    assert.equal(snapshot.error.code, ERROR.NO_ENDPOINT);
    // The user asked for protection, so enforcement keeps holding traffic.
    assert.equal(snapshot.enabled, true);
  });

  test("a stored endpoint connects without consulting a vendor account", async () => {
    const { controller, tunnelParts } = build();
    await controller.saveEndpoint(ENDPOINT);
    const snapshot = await controller.connect();

    assert.equal(snapshot.status, STATUS.connected);
    assert.equal(snapshot.provider, PROVIDER.manual);
    assert.equal(snapshot.server.name, "CrystalVPN — Frankfurt");
    assert.equal(snapshot.server.proxyHost, "proxy.example.net");
    assert.equal(snapshot.server.proxyPort, 8443);
    assert.equal(snapshot.verified.tunnel.ok, true);

    // The CONNECT proof went to the endpoint the user named, and nowhere else.
    assert.equal(tunnelParts.opened.length, 1);
    assert.equal(tunnelParts.opened[0].proxy.host, "proxy.example.net");
    assert.equal(
      tunnelParts.opened[0].proxy.authorization,
      `Basic ${Buffer.from("crystalvpn-user:crystalvpn-token").toString("base64")}`,
    );
  });

  test("an endpoint with no credentials sends no Proxy-Authorization header", async () => {
    const { controller, tunnelParts } = build();
    await controller.saveEndpoint({ ...ENDPOINT, username: "", password: "" });
    await controller.connect();
    assert.equal(tunnelParts.opened[0].proxy.authorization, null);
  });

  test("routed traffic is dialled through the endpoint", async () => {
    const { controller } = build();
    await controller.saveEndpoint(ENDPOINT);
    await controller.connect();
    const decision = await controller.decideRoute("example.com", 443);
    assert.equal(decision.mode, "proxy");
    assert.equal(decision.proxy.host, "proxy.example.net");
    assert.equal(decision.proxy.scheme, "https");
  });

  test("the proxy itself is never routed through the proxy", async () => {
    const { controller } = build();
    await controller.saveEndpoint(ENDPOINT);
    await controller.connect();
    assert.equal((await controller.decideRoute("proxy.example.net", 8443)).mode, "direct");
  });

  test("vendor domains are ordinary destinations under a custom endpoint", async () => {
    const { controller } = build();
    await controller.saveEndpoint(ENDPOINT);
    await controller.connect();
    // Excluding them here would be a leak the coverage report does not mention:
    // under a custom proxy, account.proton.me is just another site.
    assert.equal((await controller.decideRoute("account.proton.me", 443)).mode, "proxy");
  });

  test("a rejected handshake is an error, not a connection", async () => {
    const { controller } = build({
      tunnel: fakeTunnel({ handshakeError: new Error("the proxy rejected these credentials (407)") }),
    });
    await controller.saveEndpoint(ENDPOINT);
    const snapshot = await controller.connect();
    assert.equal(snapshot.status, STATUS.error);
    assert.equal(snapshot.error.code, ERROR.CREDENTIALS_REJECTED);
    assert.equal(snapshot.server, null);
  });

  test("an endpoint that cannot carry a verified TLS session is an error, not a connection", async () => {
    // A CONNECT would succeed — this is the man-in-the-middle / black-hole case —
    // but the verified TLS proof fails, so no connection may be claimed.
    const tunnel = {
      verifyTls: async () => {
        throw new Error("self-signed certificate in certificate chain");
      },
      openConnectTunnel: async () => ({ socket: { destroy() {} }, reader: { takeRest() {} } }),
      requestThroughTunnel: async () => ({ status: 200, headers: {}, body: '{"ip":"203.0.113.9"}' }),
    };
    const { controller } = build({ tunnel: { tunnel } });
    await controller.saveEndpoint({ ...ENDPOINT, checkUrl: "" });
    const snapshot = await controller.connect();
    assert.equal(snapshot.status, STATUS.error);
    assert.equal(snapshot.server, null);
  });

  test("when the transport can prove TLS, the tunnel verification says exactly that", async () => {
    let probed = null;
    const tunnel = {
      verifyTls: async (options) => {
        probed = options;
        return { subject: "example.com" };
      },
      requestThroughTunnel: async () => ({ status: 200, headers: {}, body: '{"ip":"203.0.113.9"}' }),
    };
    const { controller } = build({ tunnel: { tunnel } });
    await controller.saveEndpoint({ ...ENDPOINT, checkUrl: "" });
    const snapshot = await controller.connect();
    assert.equal(snapshot.status, STATUS.connected);
    assert.equal(probed.target.host, "example.com");
    assert.match(snapshot.verified.tunnel.detail, /verified TLS session/i);
  });

  test("the snapshot never carries a username, a password or a check URL", async () => {
    const { controller } = build();
    await controller.saveEndpoint(ENDPOINT);
    await controller.connect();
    const serialised = JSON.stringify(controller.snapshot());
    assert.ok(!serialised.includes("crystalvpn-user"), "the username leaked into the snapshot");
    assert.ok(!serialised.includes("crystalvpn-token"), "the password leaked into the snapshot");
    assert.ok(!serialised.includes("check.example.net"), "the check URL leaked into the snapshot");
    assert.equal(controller.snapshot().endpoint.authenticated, true);
  });

  test("with no check URL the exit address is unknown, and the connection still stands", async () => {
    const { controller } = build();
    await controller.saveEndpoint({ ...ENDPOINT, checkUrl: "" });
    await controller.connect();
    const ok = await settle(() => controller.snapshot().verified.egress !== null);
    assert.ok(ok, "the egress check never recorded a result");
    const egress = controller.snapshot().verified.egress;
    assert.equal(egress.conclusive, false);
    assert.equal(egress.matches, null);
    assert.match(egress.reason, /no exit check URL/i);
    assert.equal(controller.snapshot().status, STATUS.connected);
  });

  test("clearing the endpoint leaves the VPN ready for automatic selection again", async () => {
    const { controller } = build();
    await controller.saveEndpoint(ENDPOINT);
    await controller.connect();
    const snapshot = await controller.clearEndpoint();
    assert.equal(snapshot.provider, PROVIDER.proton);
    assert.equal(snapshot.endpoint, null);
    assert.equal(snapshot.status, STATUS.disconnected);
    assert.equal(snapshot.server, null);
  });

  test("saving a new endpoint drops a connection built through the old one", async () => {
    const { controller } = build();
    await controller.saveEndpoint(ENDPOINT);
    await controller.connect();
    assert.equal(controller.snapshot().status, STATUS.connected);
    const snapshot = await controller.saveEndpoint({ ...ENDPOINT, host: "other.example.net" });
    assert.equal(snapshot.status, STATUS.disconnected);
    assert.equal(snapshot.server, null);
  });

  test("switching the stored transport tears the connection down rather than relabelling it", async () => {
    const { controller } = build();
    await controller.saveEndpoint(ENDPOINT);
    await controller.connect();
    const snapshot = await controller.setProvider(PROVIDER.proton);
    assert.equal(snapshot.provider, PROVIDER.proton);
    assert.equal(snapshot.status, STATUS.disconnected);
    assert.equal(snapshot.enabled, false);
  });

  test("an invalid endpoint is refused and nothing is stored", async () => {
    const store = memoryEndpointStore();
    const { controller } = build({ endpointStore: store });
    await assert.rejects(
      () => controller.saveEndpoint({ ...ENDPOINT, host: "https://proxy.example.net/" }),
      EndpointError,
    );
    assert.equal(store.current(), null);
    assert.equal(controller.snapshot().endpoint, null);
  });
});

describe("the account-free provider across a restart", () => {
  const directories = [];
  after(async () => {
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function tempStore() {
    const directory = await mkdtemp(join(tmpdir(), "crescent-vpn-"));
    directories.push(directory);
    return createEndpointStore({ file: join(directory, "endpoint.json") });
  }

  test("the provider and endpoint survive a restart, and the credentials are not readable back", async () => {
    const file = await tempStore();
    const first = build({ endpointStore: file });
    await first.controller.saveEndpoint(ENDPOINT);
    await first.controller.connect();
    assert.equal(first.controller.snapshot().status, STATUS.connected);

    const second = build({ endpointStore: createEndpointStore({ file: file.file }) });
    const snapshot = await second.controller.hydrate();
    assert.equal(snapshot.provider, PROVIDER.manual);
    assert.equal(snapshot.endpoint.host, "proxy.example.net");
    assert.equal(snapshot.endpoint.authenticated, true);
    // A restart is not a connection: the tunnel is gone and must be re-proven.
    assert.equal(snapshot.status, STATUS.disconnected);

    await second.controller.connect();
    assert.equal(second.controller.snapshot().status, STATUS.connected);

    const onDisk = JSON.parse(await readFile(file.file, "utf8"));
    assert.equal(onDisk.provider, PROVIDER.manual);
    assert.equal(onDisk.endpoint.host, "proxy.example.net");
    assert.ok(!JSON.stringify(second.controller.snapshot()).includes("crystalvpn-token"));
  });

  test("a hand-edited endpoint file degrades to no endpoint rather than crashing the backend", async () => {
    const store = await tempStore();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(store.file, "{ this is not json", "utf8");
    const { controller } = build({ endpointStore: createEndpointStore({ file: store.file }) });
    const snapshot = await controller.hydrate();
    assert.equal(snapshot.provider, PROVIDER.proton);
    assert.equal(snapshot.endpoint, null);
  });
});

/* --------------------------------------------------------- the real wire */

/**
 * A real HTTP CONNECT proxy.
 *
 * `stub` answers the CONNECT without dialling anything, which keeps the
 * handshake tests offline — the request line and the credentials on the wire are
 * the whole subject, and a real upstream would only add a network dependency.
 *
 * `setRedirect` exists so the egress test can be conclusive on one machine: the
 * proxy answers a CONNECT to the check host by dialling a *different* origin,
 * which is what a real VPN exit looks like from the client's side. Without it
 * both readings would come from loopback and the test could only ever prove that
 * the addresses match.
 */
function startFakeProxy({ credentials = null, stub = false } = {}) {
  const seen = [];
  const server = createNetServer();
  let redirect = null;

  server.on("connection", (socket) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      socket.removeListener("data", onData);
      const head = buffer.slice(0, end).toString("latin1");
      const rest = buffer.slice(end + 4);
      const [requestLine, ...headerLines] = head.split("\r\n");
      const [method, target] = requestLine.split(" ");
      const headers = {};
      for (const line of headerLines) {
        const index = line.indexOf(":");
        if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
      }
      seen.push({ method, target, headers });

      if (method !== "CONNECT") {
        socket.end("HTTP/1.1 405 Method Not Allowed\r\n\r\n");
        return;
      }

      if (credentials) {
        const expected = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
        if (headers["proxy-authorization"] !== expected) {
          socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\n\r\n");
          return;
        }
      }

      if (stub) {
        socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
        socket.on("error", () => socket.destroy());
        return;
      }

      const [host, portText] = target.split(":");
      const port = Number(portText);
      const via = redirect && redirect.originalPort === port ? redirect : null;
      const upstream = netConnect({ host: via?.host ?? host, port: via?.port ?? port });
      upstream.once("error", () => socket.destroy());
      upstream.once("connect", () => {
        socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
        if (rest.length > 0) upstream.write(rest);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
    };
    socket.on("data", onData);
    socket.once("error", () => socket.destroy());
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        seen,
        setRedirect: (value) => {
          redirect = value;
        },
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

/** A tiny origin that reports a fixed address, standing in for an echo service. */
function startOrigin(address) {
  const server = createHttpServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ip: address }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        url: `http://127.0.0.1:${server.address().port}/ip`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

describe("the account-free provider against a real proxy", () => {
  const cleanup = [];
  after(async () => {
    await Promise.all(cleanup.map((close) => close()));
  });

  test("the CONNECT carries the right target and Basic credentials on the wire", async () => {
    const proxy = await startFakeProxy({
      credentials: { username: "crystalvpn-user", password: "crystalvpn-token" },
      stub: true,
    });
    cleanup.push(proxy.close);

    const { controller } = build({ tunnel: realTunnel() });
    await controller.saveEndpoint({
      scheme: "http",
      host: "127.0.0.1",
      port: proxy.port,
      username: "crystalvpn-user",
      password: "crystalvpn-token",
      name: "Loopback proxy",
    });
    const snapshot = await controller.connect();

    assert.equal(snapshot.status, STATUS.connected, JSON.stringify(snapshot.error));
    assert.equal(proxy.seen.length, 1);
    assert.equal(proxy.seen[0].method, "CONNECT");
    assert.equal(proxy.seen[0].target, "example.com:443");
    assert.equal(
      proxy.seen[0].headers["proxy-authorization"],
      `Basic ${Buffer.from("crystalvpn-user:crystalvpn-token").toString("base64")}`,
    );
  });

  test("wrong credentials are refused by the proxy and reported as refused", async () => {
    const proxy = await startFakeProxy({
      credentials: { username: "right", password: "right" },
      stub: true,
    });
    cleanup.push(proxy.close);

    const { controller } = build({ tunnel: realTunnel() });
    await controller.saveEndpoint({
      scheme: "http",
      host: "127.0.0.1",
      port: proxy.port,
      username: "wrong",
      password: "wrong",
    });
    const snapshot = await controller.connect();

    assert.equal(snapshot.status, STATUS.error);
    assert.equal(snapshot.server, null);
    assert.match(snapshot.error.message, /407|credential|authenticat/i);
  });

  test("a proxy that is not there is unreachable, not disconnected", async () => {
    const proxy = await startFakeProxy({ stub: true });
    const port = proxy.port;
    await proxy.close();

    const { controller } = build({ tunnel: realTunnel() });
    await controller.saveEndpoint({ scheme: "http", host: "127.0.0.1", port });
    const snapshot = await controller.connect();
    assert.equal(snapshot.status, STATUS.error);
    assert.equal(snapshot.enabled, true, "a failed connect must not silently turn the VPN off");
  });

  test("the egress check really travels through the tunnel and proves a different exit", async () => {
    const directOrigin = await startOrigin("198.51.100.7");
    const exitOrigin = await startOrigin("203.0.113.9");
    cleanup.push(directOrigin.close, exitOrigin.close);

    const proxy = await startFakeProxy({});
    cleanup.push(proxy.close);
    // A CONNECT to the direct origin's port is answered from the exit origin,
    // which is the only way one machine can produce two different addresses.
    proxy.setRedirect({ host: "127.0.0.1", port: exitOrigin.port, originalPort: directOrigin.port });

    const { controller } = build({ tunnel: realTunnel() });
    await controller.saveEndpoint({
      scheme: "http",
      host: "127.0.0.1",
      port: proxy.port,
      name: "Loopback proxy",
      checkUrl: directOrigin.url,
    });
    const snapshot = await controller.connect();
    assert.equal(snapshot.status, STATUS.connected, JSON.stringify(snapshot.error));

    const settled = await settle(() => controller.snapshot().verified.egress?.conclusive === true);
    assert.ok(settled, "the egress check never became conclusive");
    const egress = controller.snapshot().verified.egress;
    assert.equal(egress.matches, false);
    assert.equal(egress.ok, true);
    assert.equal(egress.directIp, "198.51.100.7");
    assert.equal(egress.exitIp, "203.0.113.9");
    assert.equal(controller.snapshot().status, STATUS.connected);
  });

  test("an exit that is this machine's own address is a conclusive failure, not a warning", async () => {
    const origin = await startOrigin("198.51.100.7");
    cleanup.push(origin.close);

    const proxy = await startFakeProxy({});
    cleanup.push(proxy.close);

    const { controller } = build({ tunnel: realTunnel() });
    await controller.saveEndpoint({
      scheme: "http",
      host: "127.0.0.1",
      port: proxy.port,
      checkUrl: origin.url,
    });
    await controller.connect();

    // Both readings come from the same origin here, so the tunnel demonstrably
    // did not change where the traffic exits.
    const settled = await settle(() => controller.snapshot().status === STATUS.error);
    assert.ok(settled, "a detected leak was not treated as a failure");
    assert.equal(controller.snapshot().error.code, ERROR.EXIT_NOT_VPN);
    assert.equal(controller.snapshot().server, null, "a leaked connection must stop claiming a server");
  });

  test("a bare-address check URL is read as well as a JSON one", async () => {
    const server = createHttpServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("203.0.113.9\n");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanup.push(() => new Promise((resolve) => server.close(resolve)));
    const port = server.address().port;

    const proxy = await startFakeProxy({});
    cleanup.push(proxy.close);

    const { controller } = build({ tunnel: realTunnel() });
    await controller.saveEndpoint({
      scheme: "http",
      host: "127.0.0.1",
      port: proxy.port,
      checkUrl: `http://127.0.0.1:${port}/`,
    });
    await controller.connect();
    const settled = await settle(() => controller.snapshot().verified.egress?.conclusive === true);
    assert.ok(settled, "a bare address was not understood");
    assert.equal(controller.snapshot().verified.egress.exitIp, "203.0.113.9");
  });
});
