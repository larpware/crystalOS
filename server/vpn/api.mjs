/*
 * CrystalOS — VPN API
 *
 * The HTTP surface the shell talks to. It is deliberately thin: every route
 * forwards to the controller and returns whatever the controller actually
 * knows, including its failures. No route invents a success, and no route
 * returns credentials — `snapshot()` never carries them, and the only session
 * fact that leaves this process is `{ signedIn, uid }`.
 *
 * Conventions match `server/accounts/api.mjs`: `handle()` claims its own prefix
 * and returns whether it answered, mutations are same-origin, bodies are read
 * once at the top, and errors use the `{ error: { code, message } }` shape the
 * frontend's `apiRequest` already understands.
 */

import { createVpnController, ERROR, MANUAL_PROBE_TARGET, STATUS } from "./controller.mjs";
import { CONNECT_TIMEOUT_MS } from "./config.mjs";
import { createProtonClient } from "./proton.mjs";
import { createSessionStore } from "./session.mjs";
import { createEndpointStore, EndpointError, normaliseEndpoint, PROVIDER } from "./endpoint.mjs";
import { listCountries, normaliseCountry } from "./countries.mjs";
import { createProxyPool } from "./proxies.mjs";
import { basicAuthHeader, openConnectTunnel, requestThroughTunnel, verifyTlsThroughProxy } from "./tunnel.mjs";

const API_PREFIX = "/api/vpn";
/** Sessions are tiny; anything bigger is not a request this API accepts. */
const BODY_LIMIT = 8 * 1024;

function send(res, status, payload) {
  const body = JSON.stringify(payload ?? {});
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function fail(res, status, code, message) {
  send(res, status, { error: { code, message } });
}

/** Blocks cross-site writes, the same rule the accounts API applies. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function readJson(req, res) {
  const length = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(length) && length > BODY_LIMIT) {
    fail(res, 413, "BODY_TOO_LARGE", "That request is too large.");
    return { handled: true };
  }
  const type = String(req.headers["content-type"] ?? "");
  if (!type.includes("application/json")) {
    fail(res, 415, "UNSUPPORTED_MEDIA_TYPE", "Requests must be sent as application/json.");
    return { handled: true };
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      fail(res, 413, "BODY_TOO_LARGE", "That request is too large.");
      return { handled: true };
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return { body: {} };
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(res, 400, "INVALID_BODY", "Expected a JSON object.");
      return { handled: true };
    }
    return { body: parsed };
  } catch {
    fail(res, 400, "INVALID_JSON", "That request body is not valid JSON.");
    return { handled: true };
  }
}

/**
 * Reads a proxy endpoint payload.
 *
 * Every field is passed through as-is to `normaliseEndpoint`, which owns the
 * rules — this only refuses a body that is not an object at all, so that a
 * validation message always comes from the one place that knows the shape.
 */
function readEndpointPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "An endpoint needs a host." };
  }
  return {
    value: {
      scheme: body.scheme,
      host: body.host,
      port: body.port,
      username: body.username,
      password: body.password,
      name: body.name,
      checkUrl: body.checkUrl,
    },
  };
}

/** A session payload is only accepted in a shape Proton itself issues. */
function readSessionPayload(body) {  const uid = typeof body?.uid === "string" ? body.uid.trim() : "";
  const accessToken = typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
  const refreshToken = typeof body?.refreshToken === "string" ? body.refreshToken.trim() : "";
  if (!uid) return { error: "That Proton session is missing its uid." };
  if (!refreshToken) {
    return {
      error:
        "A refresh token is required. Proton rotates it on every use, so without one the session would expire within the hour.",
    };
  }
  if (accessToken.length > 4096 || refreshToken.length > 4096 || uid.length > 128) {
    return { error: "That does not look like a Proton session." };
  }
  return { value: { uid, accessToken, refreshToken } };
}

function readPreference(body) {
  const preference = {};
  if (typeof body?.serverId === "string" || typeof body?.serverId === "number") {
    preference.id = String(body.serverId);
  }
  if (typeof body?.country === "string" && body.country.trim()) {
    preference.country = body.country.trim().toUpperCase();
  }
  if (typeof body?.city === "string" && body.city.trim()) {
    preference.city = body.city.trim();
  }
  return Object.keys(preference).length > 0 ? preference : null;
}

/**
 * Reads the caller's "must work" hosts for automatic discovery.
 *
 * The shell passes its search engine here so the pool can prefer exits that can
 * actually reach it — the difference between a search that loads and a blank
 * page. Only hosts are taken, never ports the caller guessed: the port defaults
 * to 443, because a search engine is a TLS address and nothing else is being
 * probed.
 */
function readCanary(body) {
  const raw = body?.canary;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const targets = [];
  for (const entry of list) {
    const host =
      typeof entry === "string" ? entry : typeof entry?.host === "string" ? entry.host : "";
    const clean = host.trim().toLowerCase();
    if (!clean || /[\s/@]/.test(clean)) continue;
    const port = Number(entry?.port) || 443;
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    targets.push({ host: clean, port });
  }
  return targets;
}

export function createVpnApi(options = {}) {
  const sessionStore = options.sessionStore ?? createSessionStore();
  const endpointStore = options.endpointStore ?? createEndpointStore();
  const proton = options.proton ?? createProtonClient();
  const proxyPool = options.proxyPool ?? createProxyPool();
  const controller =
    options.controller ??
    createVpnController({
      sessionStore,
      endpointStore,
      proton,
      proxyPool,
      tunnel: { openConnectTunnel, requestThroughTunnel, verifyTls: verifyTlsThroughProxy },
    });

  /*
   * Boot hydration: the stored provider, endpoint and session facts are read
   * once here rather than per request, because `decideRoute` runs in front of
   * every proxied stream and must not do file I/O. `handle` awaits this, so no
   * route can answer from an unhydrated controller and report a state that the
   * disk disagrees with.
   */
  const booted = controller.hydrate().catch((error) => {
    process.stderr.write(`[crescent] vpn: could not restore stored state: ${error?.message ?? error}\n`);
  });

  /**
   * The mechanism, stated plainly and per provider, so the UI never has to
   * guess which proxy is carrying its traffic.
   */
  function transportFor(snapshot) {
    const custom = snapshot.provider === PROVIDER.manual;
    return {
      kind: custom ? "custom-http-proxy" : "proton-browser-proxy",
      scheme: snapshot.endpoint?.scheme ?? "https",
      protocol: "CONNECT",
      /** Either proxy carries CrystalOS's proxied traffic, not the whole device. */
      scope: "crescent-scramjet-traffic",
      serverHost: snapshot.server?.proxyHost ?? snapshot.endpoint?.host ?? null,
      serverPort: snapshot.server?.proxyPort ?? snapshot.endpoint?.port ?? null,
      /** What the user configured, described without secrets. */
      endpoint: custom ? snapshot.endpoint : null,
    };
  }

  /** Everything the UI needs, in one cached read. */
  function statusPayload() {
    const snapshot = controller.snapshot();
    return { ...snapshot, transport: transportFor(snapshot) };
  }

  async function handle(req, res, url) {
    const path = url.pathname;
    if (path !== API_PREFIX && !path.startsWith(`${API_PREFIX}/`)) return false;

    await booted;

    const segments = path.slice(API_PREFIX.length).split("/").filter(Boolean);
    const method = req.method ?? "GET";

    if (method !== "GET" && method !== "HEAD" && !sameOrigin(req)) {
      fail(res, 403, "CROSS_ORIGIN", "Cross-origin requests are not allowed.");
      return true;
    }

    try {
      // The body is read once, up front, for every mutating route: answering
      // before consuming the request stream leaves keep-alive connections
      // unusable, and every route here validates the body before acting.
      let body = {};
      if (method !== "GET" && method !== "HEAD") {
        const hasBody =
          Number(req.headers["content-length"] ?? 0) > 0 || Boolean(req.headers["transfer-encoding"]);
        if (hasBody) {
          const parsed = await readJson(req, res);
          if (parsed.handled) return true;
          body = parsed.body;
        }
      }

      if (segments.length === 0 && method === "GET") {
        send(res, 200, statusPayload());
        return true;
      }

      // GET /api/vpn/servers — the connectable catalogue.
      if (segments.length === 1 && segments[0] === "servers" && method === "GET") {
        const snapshot = controller.snapshot();
        // A custom endpoint has no catalogue: it *is* the server. Saying so is
        // the honest answer, where an empty list would read as "your plan has no
        // servers" — a different claim about the user's account.
        if (snapshot.provider === PROVIDER.manual) {
          send(res, 200, {
            servers: [],
            reason: "A custom endpoint is the server itself, so there is no list to load.",
          });
          return true;
        }
        if (!snapshot.signedIn) {
          send(res, 200, { servers: [], reason: "Sign in to Proton to load the server list." });
          return true;
        }
        try {
          send(res, 200, { servers: await controller.listServers({ force: url.searchParams.has("refresh") }) });
        } catch (error) {
          // An unreachable Proton must not look like an empty plan.
          fail(res, 502, "SERVER_LIST_UNAVAILABLE", error instanceof Error ? error.message : String(error));
        }
        return true;
      }

      // GET /api/vpn/diagnostics — build facts, no secrets.
      if (segments.length === 1 && segments[0] === "diagnostics" && method === "GET") {
        const snapshot = controller.snapshot();
        const custom = snapshot.provider === PROVIDER.manual;
        send(res, 200, {
          transport: {
            ...transportFor(snapshot),
            notes: custom
              ? [
                  "CrystalOS speaks CONNECT to a proxy endpoint you supplied, authenticated with Basic auth when it asks for one.",
                  "No account, session or vendor API is involved: the endpoint is the whole configuration.",
                  "This protects traffic CrystalOS routes through its Scramjet/Wisp transport, not the whole device.",
                  "The tunnel is certificate-verified for an https endpoint; end-to-end TLS to each site stays intact.",
                ]
              : [
                  "CrystalOS speaks Proton's browser-extension proxy: an authenticated HTTPS CONNECT tunnel on the selected VPN server.",
                  "This protects traffic CrystalOS routes through its Scramjet/Wisp transport, not the whole device.",
                  "The tunnel to Proton is certificate-verified; end-to-end TLS to each site stays intact.",
                ],
          },
          provider: snapshot.provider,
          status: snapshot.status,
          enforcement: snapshot.enforce,
          coverage: snapshot.coverage,
          verification: snapshot.verified,
          error: snapshot.error,
        });
        return true;
      }

      // POST /api/vpn/connect
      if (segments.length === 1 && segments[0] === "connect" && method === "POST") {
        const preference = readPreference(body);
        const snapshot = await controller.connect(preference);
        if (preference) controller.setPreference(preference);
        send(res, 200, { ...statusPayload(), ...snapshot, transport: statusPayload().transport });
        return true;
      }

      /*
       * GET /api/vpn/countries — the exits the picker offers.
       *
       * A static, offline list: a code here means CrystalOS will ask the sources
       * for a proxy in that country, not that one is reachable right now. Saying
       * so in the payload keeps the UI from promising more than the pool can.
       */
      if (segments.length === 1 && segments[0] === "countries" && method === "GET") {
        send(res, 200, {
          countries: listCountries(),
          note: "A country is requested from the sources when you connect; availability varies.",
        });
        return true;
      }

      /*
       * POST /api/vpn/quick-connect — the zero-config path.
       *
       * Finds a working public CONNECT proxy (for the requested country, or
       * anywhere), optionally preferring exits that can reach the caller's
       * canary hosts (the search engine), stores it as the active manual
       * endpoint and connects. It answers with the same payload as /connect, so
       * the UI needs no second rendering path.
       */
      if (segments.length === 1 && segments[0] === "quick-connect" && method === "POST") {
        let country = null;
        try {
          country = normaliseCountry(body?.country);
        } catch (error) {
          fail(res, 400, "INVALID_COUNTRY", error instanceof Error ? error.message : String(error));
          return true;
        }
        const snapshot = await controller.quickConnect({ country, canary: readCanary(body) });
        send(res, 200, { ...statusPayload(), ...snapshot, transport: statusPayload().transport });
        return true;
      }

      if (segments.length === 1 && segments[0] === "disconnect" && method === "POST") {
        await controller.disconnect();
        send(res, 200, statusPayload());
        return true;
      }

      if (segments.length === 1 && segments[0] === "reconnect" && method === "POST") {
        await controller.reconnect(readPreference(body));
        send(res, 200, statusPayload());
        return true;
      }

      // POST /api/vpn/verify — the exit-address check, on demand.
      if (segments.length === 1 && segments[0] === "verify" && method === "POST") {
        const snapshot = controller.snapshot();
        if (snapshot.status !== STATUS.connected) {
          fail(res, 409, "NOT_CONNECTED", "Connect the VPN before checking the exit address.");
          return true;
        }
        const result = await controller.verify();
        send(res, 200, { ...statusPayload(), verification: result });
        return true;
      }

      // POST /api/vpn/settings — enforcement only; nothing else is a toggle.
      if (segments.length === 1 && segments[0] === "settings" && method === "POST") {
        if (typeof body?.enforce === "boolean") controller.setEnforce(body.enforce);
        send(res, 200, statusPayload());
        return true;
      }

      // POST /api/vpn/session — store an existing Proton session.
      if (segments.length === 1 && segments[0] === "session" && method === "POST") {
        const parsed = readSessionPayload(body);
        if (parsed.error) {
          fail(res, 400, "INVALID_SESSION", parsed.error);
          return true;
        }
        await controller.signIn(parsed.value);
        send(res, 200, statusPayload());
        return true;
      }

      if (segments.length === 1 && segments[0] === "session" && method === "DELETE") {
        await controller.signOut();
        send(res, 200, statusPayload());
        return true;
      }

      /* ---- the account-free provider ------------------------------------
       *
       * These routes are the whole configuration surface for a user-supplied
       * endpoint. Credentials arrive here and go no further: the store is an
       * owner-only file, `snapshot()` carries only `describeEndpoint()`, and no
       * route below ever echoes a username or a password back.
       */

      // POST /api/vpn/provider — choose which proxy a connect attempt uses.
      if (segments.length === 1 && segments[0] === "provider" && method === "POST") {
        const provider = typeof body?.provider === "string" ? body.provider.trim().toLowerCase() : "";
        if (provider !== PROVIDER.manual && provider !== PROVIDER.proton) {
          fail(res, 400, "INVALID_PROVIDER", 'The provider must be "proton" or "manual".');
          return true;
        }
        await controller.setProvider(provider);
        send(res, 200, statusPayload());
        return true;
      }

      // POST /api/vpn/endpoint — store the endpoint the manual provider dials.
      if (segments.length === 1 && segments[0] === "endpoint" && method === "POST") {
        const parsed = readEndpointPayload(body);
        if (parsed.error) {
          fail(res, 400, "INVALID_ENDPOINT", parsed.error);
          return true;
        }
        await controller.saveEndpoint(parsed.value);
        send(res, 200, statusPayload());
        return true;
      }

      if (segments.length === 1 && segments[0] === "endpoint" && method === "DELETE") {
        await controller.clearEndpoint();
        send(res, 200, statusPayload());
        return true;
      }

      /*
       * POST /api/vpn/endpoint/test — prove an endpoint accepts a CONNECT.
       *
       * Deliberately does not touch controller state: testing something must not
       * turn the VPN on, change the provider, or clear a connection the user
       * already has. The proof is the CONNECT reply alone, so the probe target
       * is never requested from and no third party learns anything about it.
       */
      if (segments.length === 2 && segments[0] === "endpoint" && segments[1] === "test" && method === "POST") {
        const parsed = readEndpointPayload(body);
        if (parsed.error) {
          fail(res, 400, "INVALID_ENDPOINT", parsed.error);
          return true;
        }
        const candidate = normaliseEndpoint(parsed.value);
        const startedAt = Date.now();
        try {
          const tunnel = await openConnectTunnel({
            proxy: {
              host: candidate.host,
              port: candidate.port,
              scheme: candidate.scheme,
              authorization: candidate.username
                ? basicAuthHeader(candidate.username, candidate.password)
                : null,
            },
            target: MANUAL_PROBE_TARGET,
            timeoutMs: CONNECT_TIMEOUT_MS,
          });
          tunnel.socket.destroy();
          send(res, 200, {
            ok: true,
            ms: Date.now() - startedAt,
            detail: `${candidate.host}:${candidate.port} accepted a CONNECT${candidate.username ? " with those credentials" : ""}.`,
          });
        } catch (error) {
          // A refusal is a result, not a server error: the user needs the reason,
          // and a 5xx would read as "CrystalOS is broken" instead of "that proxy
          // said no".
          send(res, 200, {
            ok: false,
            ms: Date.now() - startedAt,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
        return true;
      }

      fail(res, 404, "NOT_FOUND", "No such VPN route.");
      return true;
    } catch (error) {
      // A rejected endpoint is the user's input being wrong, not an upstream
      // failure, so it answers 400 with the message that says what to fix.
      if (error instanceof EndpointError) {
        fail(res, 400, "INVALID_ENDPOINT", error.message);
        return true;
      }
      const code = error?.code ?? ERROR.UNKNOWN;
      fail(res, 502, code, error instanceof Error ? error.message : "The VPN operation failed.");
      return true;
    }
  }

  return { handle, controller, sessionStore, endpointStore, statusPayload };
}
