/*
 * CrystalOS — VPN controller
 *
 * ## One source of truth
 *
 * Everything the UI shows about the VPN is derived from `snapshot()` below. The
 * frontend keeps a mirror of it so React can render, but it never computes a
 * second opinion: there is no "vpn on" boolean anywhere in the shell, no
 * per-window VPN state, and no component that decides on its own whether a page
 * is protected. If this controller says `connected`, traffic routed by this
 * controller is going through Proton; if it says anything else, the UI says
 * something else.
 *
 * ## What "connected" means here, precisely
 *
 * Not "a request to a server succeeded". `connected` is only reached after:
 *
 *   1. Proton issued proxy credentials for a real session
 *      (`vpn/v1/browser/token` answered `Code: 1000`);
 *   2. the selected server's proxy accepted a CONNECT with those credentials,
 *      which is a TLS session to Proton and an authenticated tunnel in one;
 *   3. the egress check either confirmed a different exit address, or was
 *      recorded as *unknown* rather than being claimed as verified.
 *
 * A conclusive failure of the egress check (the exit address is this machine's
 * own) is treated as a real failure, not a warning.
 *
 * ## Fail-closed routing
 *
 * `decideRoute()` is what the Wisp transport asks before dialling. While the
 * user has asked for protection and the connection is not up, it answers
 * `block`: proxied browsing fails visibly instead of quietly going out
 * unprotected. Choosing `enforce: false` is an explicit choice to allow direct
 * traffic while disconnected, and the UI reports that state as unprotected.
 */

import {
  CONNECT_TIMEOUT_MS,
  CREDENTIAL_REFRESH_MARGIN_MS,
  FEATURE,
  PROTON,
  isPrivateAddress,
} from "./config.mjs";
import { ProtonError } from "./proton.mjs";
import { describeEndpoint, EndpointError, normaliseEndpoint, PROVIDER } from "./endpoint.mjs";
import { countryName, normaliseCountry } from "./countries.mjs";
import { basicAuthHeader, openConnectTunnel, requestThroughTunnel, verifyTlsThroughProxy } from "./tunnel.mjs";
import { describeLogical, listConnectable, resolveEndpoint, selectLogical } from "./servers.mjs";

/** The states the UI is allowed to see. */
export const STATUS = {
  unsupported: "unsupported",
  disconnected: "disconnected",
  connecting: "connecting",
  connected: "connected",
  reconnecting: "reconnecting",
  disconnecting: "disconnecting",
  error: "error",
};

/** Errors carry a stable code so the UI can react without matching prose. */
export const ERROR = {
  SIGN_IN_REQUIRED: "SIGN_IN_REQUIRED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  NO_SERVER: "NO_SERVER",
  NO_ENDPOINT: "NO_ENDPOINT",
  NO_PROXY_FOUND: "NO_PROXY_FOUND",
  PROXY_UNREACHABLE: "PROXY_UNREACHABLE",
  CREDENTIALS_REJECTED: "CREDENTIALS_REJECTED",
  EXIT_NOT_VPN: "EXIT_NOT_VPN",
  NETWORK: "NETWORK",
  CANCELLED: "CANCELLED",
  UNKNOWN: "UNKNOWN",
};

const API_HOST = new URL(PROTON.apiBase).hostname;

function errorOf(code, message) {
  return { code, message };
}

/**
 * Raised when there is genuinely no session yet.
 *
 * Distinct from an expired one on purpose: "you have not signed in" and "your
 * session was rejected" send the user to different places, and collapsing them
 * into one ProtonError made the first report itself as the second.
 */
class SignInRequiredError extends Error {
  constructor(message = "Sign in to Proton to use the VPN.") {
    super(message);
    this.name = "SignInRequiredError";
  }
}

/**
 * Raised when the account-free provider is selected but nothing is configured.
 *
 * Its own class because "you have not added an endpoint yet" is a different
 * instruction to the user than "your session expired", and it must not be
 * reported as either.
 */
class NoEndpointError extends Error {
  constructor(message = "Add a proxy endpoint before connecting.") {
    super(message);
    this.name = "NoEndpointError";
  }
}

/**
 * Raised when automatic discovery found no working public proxy.
 *
 * Its own class because "no free server answered right now" is a transient
 * condition the user can retry, not a misconfiguration they must fix — and it
 * must not be reported as an invalid endpoint.
 */
class NoProxyError extends Error {
  constructor(message = "No working public proxy was found. Try again in a moment.") {
    super(message);
    this.name = "NoProxyError";
  }
}

/**
 * Where the CONNECT is aimed when proving a custom endpoint accepts us.
 *
 * Never requested from: the reply code of the CONNECT is the entire proof, so
 * nothing is fetched and no third party is contacted. The IANA documentation
 * domain is used because it resolves everywhere and is not somebody's product.
 */
export const MANUAL_PROBE_TARGET = { host: "example.com", port: 443 };

/**
 * How many discovered proxies one click will try before giving up.
 *
 * Public proxies routinely pass the health test and then die before the real
 * connect, so a single candidate is not enough. Each failure costs a timeout, so
 * this is deliberately small: enough to ride out a flaky pool, bounded enough
 * that a hopeless scan still ends with a message.
 */
const QUICK_CONNECT_ATTEMPTS = 5;

function classifyFailure(error) {
  if (error instanceof NoEndpointError) return errorOf(ERROR.NO_ENDPOINT, error.message);
  if (error instanceof NoProxyError) return errorOf(ERROR.NO_PROXY_FOUND, error.message);
  if (error instanceof SignInRequiredError) return errorOf(ERROR.SIGN_IN_REQUIRED, error.message);
  if (error instanceof ProtonError) {
    if (error.needsLogout) return errorOf(ERROR.SESSION_EXPIRED, error.message);
    if (error.code === 401) return errorOf(ERROR.SESSION_EXPIRED, "Proton rejected this session. Sign in again.");
    if (error.retryable) return errorOf(ERROR.NETWORK, error.message);
    return errorOf(ERROR.NETWORK, error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/credential/i.test(message)) return errorOf(ERROR.CREDENTIALS_REJECTED, message);
  if (/timed out|ETIMEDOUT|ECONN|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ECONNRESET/i.test(message)) {
    return errorOf(ERROR.PROXY_UNREACHABLE, message);
  }
  return errorOf(ERROR.UNKNOWN, message);
}

export function createVpnController({
  sessionStore,
  proton,
  endpointStore,
  proxyPool = null,
  tunnel = { openConnectTunnel, requestThroughTunnel, verifyTls: verifyTlsThroughProxy },
  now = () => Date.now(),
  log = () => undefined,
} = {}) {
  /* ------------------------------------------------------------- state */

  let state = {
    status: STATUS.disconnected,
    /** The user's intent. Turning it on is what starts a connection. */
    enabled: false,
    /** Block unprotected traffic while `enabled`. */
    enforce: true,
    /**
     * Which provider a connect attempt uses. `manual` needs no account at all:
     * it speaks CONNECT to an endpoint the user named. This is a stored user
     * choice, so it survives a restart.
     */
    provider: PROVIDER.proton,
    signedIn: false,
    uid: null,
    /** Non-secret description of the connected server. */
    server: null,
    /** What the user asked for: `{id|country|city}`. */
    preference: null,
    verified: { tunnel: null, egress: null },
    error: null,
    attempts: 0,
    connectedSince: null,
    lastTransitionAt: now(),
  };

  /** In memory only. Never persisted, never logged, never returned by a route. */
  let credentials = null;
  /**
   * The configured custom endpoint, credentials included.
   *
   * Held here rather than read from the store per request: `decideRoute` runs
   * once per stream, and a disk read on that path would put file I/O in front
   * of every page load. The store is the durable copy; this is the live one.
   */
  let manual = null;
  /** Server catalogue from the last successful fetch, for the UI list. */
  let catalogue = null;

  const listeners = new Set();
  let inflight = null;
  /** Bumped by every transition so a superseded operation cannot publish. */
  let generation = 0;

  function publish(patch) {
    state = { ...state, ...patch, lastTransitionAt: now() };
    for (const listener of listeners) listener();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /** The public, secret-free view of the controller. */
  function snapshot() {
    return {
      status: state.status,
      enabled: state.enabled,
      enforce: state.enforce,
      signedIn: state.signedIn,
      uid: state.uid,
      server: state.server ? { ...state.server } : null,
      provider: state.provider,
      /**
       * The endpoint the user configured, described without secrets.
       *
       * Separate from `server`, which describes what is *connected*. A stored
       * endpoint with nothing connected must not read as a live server.
       */
      endpoint: describeEndpoint(manual),
      /** What the user asked for: `{id|country|city}`, or null. */
      preference: state.preference ? { ...state.preference } : null,
      verified: {
        tunnel: state.verified.tunnel ? { ...state.verified.tunnel } : null,
        egress: state.verified.egress ? { ...state.verified.egress } : null,
      },
      /** Only the expiry — never the credentials themselves. */
      credentialsExpireAt: credentials?.expiresAt ?? null,
      error: state.error ? { ...state.error } : null,
      attempts: state.attempts,
      connectedSince: state.connectedSince,
      lastTransitionAt: state.lastTransitionAt,
      /** What this integration can and cannot do, stated once and centrally. */
      coverage: coverage(),
    };
  }

  /**
   * Which CrystalOS traffic categories this connection actually covers.
   *
   * Derived from the routing rule below rather than asserted: anything the
   * Scramjet path carries is proxied, the shell's own browser-originated
   * requests are not (a web page cannot set a proxy), and traffic outside
   * CrystalOS is out of scope by design.
   */
  function coverage() {
    const proxied = state.status === STATUS.connected;
    return {
      scramjetTraffic: proxied ? "protected" : state.enabled && state.enforce ? "blocked" : "unprotected",
      directBrowserTabs: "unprotected",
      shellRequests: "unprotected",
      hostApplications: "out-of-scope",
    };
  }

  /* ---------------------------------------------------------- credentials */

  async function refreshSessionIfNeeded(session, { force = false } = {}) {
    if (!session) throw new SignInRequiredError();
    if (!session.accessToken || force) {
      const refreshed = await proton.refresh(session);
      await sessionStore.save(refreshed);
      return refreshed;
    }
    return session;
  }

  async function ensureCredentials({ force = false } = {}) {
    const fresh =
      credentials &&
      !force &&
      credentials.expiresAt - CREDENTIAL_REFRESH_MARGIN_MS > now();
    if (fresh) return credentials;

    const session = await refreshSessionIfNeeded(await sessionStore.load(), { force });
    const minted = await proton.browserToken(session);
    credentials = minted;
    return credentials;
  }

  async function proxyFor(endpoint, creds) {
    return {
      host: endpoint.host,
      port: endpoint.port,
      // Proton's proxy is TLS. Stated explicitly so the transport never has to
      // infer it from the port number.
      scheme: "https",
      authorization: basicAuthHeader(creds.username, creds.password),
    };
  }

  /**
   * The proxy for a user-supplied endpoint.
   *
   * `authorization` is `null` rather than an empty header when the endpoint
   * wants no credentials: `Basic Og==` is not "no credentials", it is a
   * username and an empty password, and proxies are entitled to reject it.
   */
  function manualProxy(profile) {
    return {
      host: profile.host,
      port: profile.port,
      scheme: profile.scheme,
      authorization: profile.username ? basicAuthHeader(profile.username, profile.password) : null,
    };
  }

  /**
   * The proxy every routed stream is dialled through, for whichever provider is
   * active. Proton credentials are re-minted here because they expire; a custom
   * endpoint has none to mint, and needs no account to use.
   */
  async function currentProxy() {
    if (state.provider === PROVIDER.manual) {
      if (!manual) throw new NoEndpointError();
      return manualProxy(manual);
    }
    const creds = await ensureCredentials();
    return proxyFor(
      { host: state.server.proxyHost, port: state.server.proxyPort },
      creds,
    );
  }

  /* ------------------------------------------------------- routing */

  /**
   * Hosts that must never go through the tunnel.
   *
   * Loopback and private addresses always: they are not internet traffic and
   * sending them to a remote exit breaks the machine's own network. The proxy
   * itself always: routing the proxy through the proxy is a loop.
   *
   * Proton's own API is excluded *only while Proton is the provider*, because
   * there it is what keeps the tunnel's session alive. Under a custom endpoint
   * those domains are ordinary destinations, and routing them direct would be a
   * leak the coverage report does not mention.
   */
  function isExcluded(hostname) {
    const host = String(hostname ?? "").toLowerCase();
    if (state.server?.proxyHost && host === state.server.proxyHost.toLowerCase()) return true;
    if (manual?.host && host === manual.host.toLowerCase()) return true;
    if (state.provider !== PROVIDER.manual) {
      if (host === API_HOST) return true;
      if (host.endsWith(".proton.me") || host.endsWith(".protonvpn.com")) return true;
    }
    return isPrivateAddress(host);
  }

  /**
   * The decision the transport asks for before opening a stream.
   *
   * Called once per stream so a settings change takes effect on the next
   * request, and so a stream already in flight keeps the route it began on.
   */
  async function decideRoute(hostname, port) {
    if (isExcluded(hostname)) return { mode: "direct" };

    if (state.status === STATUS.connected) {
      try {
        return { mode: "proxy", proxy: await currentProxy() };
      } catch (error) {
        // Credentials that cannot be re-minted mean the tunnel is no longer
        // alive. Saying "connected" from here on would be a lie, so the state
        // drops to error and — with enforcement on — traffic fails closed.
        const failure = classifyFailure(error);
        if (failure.code === ERROR.SESSION_EXPIRED) {
          credentials = null;
          publish({ status: STATUS.error, error: failure, connectedSince: null, signedIn: false });
          return {
            mode: "block",
            reason: "The Proton session expired, so the VPN cannot keep this request protected.",
          };
        }
        credentials = null;
        publish({ status: STATUS.error, error: failure, connectedSince: null });
        return {
          mode: "block",
          reason:
            failure.code === ERROR.NO_ENDPOINT
              ? "The proxy endpoint is no longer configured, so this request was blocked rather than sent unprotected."
              : "The VPN connection could not be renewed, so this request was blocked rather than sent unprotected.",
        };
      }
    }

    if (state.enabled && state.enforce) {
      return {
        mode: "block",
        reason:
          state.status === STATUS.connecting
            ? "The VPN is still connecting. This request was blocked rather than sent unprotected."
            : "The VPN is not connected. This request was blocked rather than sent unprotected.",
      };
    }

    return { mode: "direct" };
  }

  /* ------------------------------------------------------ verification */

  /**
   * Asks Proton where the traffic is coming from, twice.
   *
   * Once directly and once through the tunnel we just built. `vpn/v1/location`
   * is Proton's own endpoint, so this is a real egress measurement rather than a
   * hint, and it sends nothing anywhere that already does not have the session.
   * No third-party echo service is involved.
   */
  async function measureLocation(session, proxy) {
    if (!proxy) {
      const data = await proton.location(session);
      return { ip: data?.IP ?? null, country: data?.Country ?? null, isp: data?.ISP ?? null };
    }
    const response = await tunnel.requestThroughTunnel({
      proxy,
      host: API_HOST,
      port: 443,
      path: `/api/${PROTON.locationPath}`,
      headers: {
        "x-pm-uid": session.uid,
        authorization: `Bearer ${session.accessToken}`,
        "x-pm-appversion": PROTON.appVersionHeader,
      },
      timeoutMs: CONNECT_TIMEOUT_MS,
    });
    if (response.status !== 200) {
      throw new Error(`Proton answered the exit check with ${response.status}.`);
    }
    const data = JSON.parse(response.body);
    return { ip: data?.IP ?? null, country: data?.Country ?? null, isp: data?.ISP ?? null };
  }

  /**
   * Pulls an address out of whatever the exit check URL returned.
   *
   * Both shapes are common in the wild — a JSON object with one of several key
   * names, or a bare address as the whole body — and guessing wrong would report
   * "no exit address" where there was one, which reads as a failed check.
   */
  function readAddress(body) {
    const text = String(body ?? "").trim();
    if (!text) return null;
    try {
      const data = JSON.parse(text);
      const candidate =
        data?.ip ?? data?.IP ?? data?.query ?? data?.origin ?? data?.clientIp ?? data?.ip_addr ?? null;
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
      return null;
    } catch {
      // Not JSON, so the body itself is expected to be the address.
    }
    const bare = text.split(/[\s,;]/)[0];
    return /^[0-9a-fA-F:.]{7,45}$/.test(bare) ? bare : null;
  }

  /**
   * The exit check for a user-supplied endpoint.
   *
   * Proton publishes its own location endpoint; an arbitrary proxy publishes
   * nothing, so this uses the check URL the user gave and reads it twice — once
   * directly and once through the tunnel. Without a check URL there is nothing to
   * compare against, and the result is reported as *not conclusive* rather than
   * as a pass: an unmeasured tunnel is never described as a verified one.
   */
  async function verifyManualEgress({ throwOnMismatch = false } = {}) {
    const checkedAt = now();

    if (!manual?.checkUrl) {
      const unknown = {
        ok: false,
        conclusive: false,
        matches: null,
        exitIp: null,
        directIp: null,
        country: null,
        isp: null,
        checkedAt,
        reason: "This endpoint has no exit check URL, so the exit address cannot be measured.",
      };
      publish({ verified: { ...state.verified, egress: unknown } });
      return unknown;
    }

    const target = new URL(manual.checkUrl);
    const path = `${target.pathname}${target.search}` || "/";

    let directIp;
    let exitIp;
    try {
      const directResponse = await fetch(manual.checkUrl, {
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
        redirect: "follow",
      });
      directIp = readAddress(await directResponse.text());

      const tunneled = await tunnel.requestThroughTunnel({
        proxy: manualProxy(manual),
        host: target.hostname,
        port: Number(target.port || 80),
        path,
        headers: { host: target.host, connection: "close" },
        timeoutMs: CONNECT_TIMEOUT_MS,
      });
      if (tunneled.status !== 200) {
        throw new Error(`The exit check URL answered ${tunneled.status} through the tunnel.`);
      }
      exitIp = readAddress(tunneled.body);
    } catch (error) {
      const failed = {
        ok: false,
        conclusive: false,
        matches: null,
        exitIp: null,
        directIp: null,
        country: null,
        isp: null,
        checkedAt,
        reason: error instanceof Error ? error.message : String(error),
      };
      publish({ verified: { ...state.verified, egress: failed } });
      return failed;
    }

    if (!directIp || !exitIp) {
      const inconclusive = {
        ok: false,
        conclusive: false,
        matches: null,
        exitIp,
        directIp,
        country: null,
        isp: null,
        checkedAt,
        reason: "The exit check URL did not return a readable address, so nothing could be compared.",
      };
      publish({ verified: { ...state.verified, egress: inconclusive } });
      return inconclusive;
    }

    const matches = directIp === exitIp;
    const result = {
      ok: !matches,
      conclusive: true,
      matches,
      exitIp,
      directIp,
      country: null,
      isp: null,
      checkedAt,
      reason: matches
        ? "Traffic through the tunnel still exits from this machine's own address."
        : null,
    };
    publish({ verified: { ...state.verified, egress: result } });
    if (matches && throwOnMismatch) throw new Error(result.reason);
    return result;
  }

  /**
   * Runs the egress check and records the outcome.
   *
   * Returns `{ conclusive, matches }`:
   *   • `conclusive: false` — the check could not be completed. Recorded as
   *     unknown; the connection is neither upgraded nor downgraded.
   *   • `matches: true` — traffic through the tunnel exits from the same address
   *     as direct traffic, which is a conclusive finding that it is *not* going
   *     through the VPN.
   */
  async function verifyEgress({ throwOnMismatch = false } = {}) {
    if (state.status !== STATUS.connected || !state.server) {
      throw new Error("Connect before checking the exit address.");
    }
    // The Proton path below needs a session to ask Proton where the traffic came
    // from. A custom endpoint has no such API, so it is measured differently.
    if (state.provider === PROVIDER.manual) {
      return verifyManualEgress({ throwOnMismatch });
    }
    const session = await sessionStore.load();
    if (!session) throw new SignInRequiredError();
    const creds = await ensureCredentials();
    const proxy = await proxyFor(
      { host: state.server.proxyHost, port: state.server.proxyPort },
      creds,
    );

    const checkedAt = now();

    /* The measurements are the only part that can fail *as a measurement*.
       Keeping them in their own try means a conclusive finding below is never
       caught by this handler and rewritten as "could not check" — which is
       exactly how a detected leak turns into an "unknown" if the two are
       mixed together. */
    let direct;
    let through;
    try {
      direct = await measureLocation(session, null);
      through = await measureLocation(session, proxy);
    } catch (error) {
      if (error instanceof ProtonError || error instanceof SignInRequiredError) throw error;
      const failed = {
        ok: false,
        conclusive: false,
        matches: null,
        exitIp: null,
        directIp: null,
        country: null,
        isp: null,
        checkedAt,
        reason: error instanceof Error ? error.message : String(error),
      };
      publish({ verified: { ...state.verified, egress: failed } });
      return failed;
    }

    const matches = Boolean(direct.ip && through.ip && direct.ip === through.ip);
    const result = {
      ok: !matches,
      conclusive: true,
      matches,
      exitIp: through.ip,
      directIp: direct.ip,
      country: through.country,
      isp: through.isp,
      checkedAt,
      reason: matches ? "Traffic through the tunnel still exits from this machine's own address." : null,
    };
    publish({ verified: { ...state.verified, egress: result } });
    if (matches && throwOnMismatch) throw new Error(result.reason);
    return result;
  }

  /* --------------------------------------------------------- operations */

  async function loadCatalogue({ force = false } = {}) {
    if (catalogue && !force) return catalogue;
    const session = await refreshSessionIfNeeded(await sessionStore.load());
    const logicals = await proton.logicals(session);
    catalogue = { logicals, fetchedAt: now() };
    return catalogue;
  }

  /**
   * Records a failed attempt.
   *
   * The user's intent survives: a VPN that could not connect is still a VPN the
   * user asked for, so enforcement keeps failing traffic closed rather than
   * quietly letting it out. Only the connection facts are withdrawn.
   */
  function failAttempt(error, thisGeneration) {
    // A newer attempt owns the state now; a superseded failure must not publish
    // over it, or a slow error would erase a connection that succeeded after it.
    if (thisGeneration !== generation) return snapshot();
    const failure = classifyFailure(error);
    publish({
      status: STATUS.error,
      error: failure,
      connectedSince: null,
      server: null,
      verified: { tunnel: null, egress: null },
    });
    log(`vpn: connection failed (${failure.code}): ${failure.message}`);
    return snapshot();
  }

  /** Shared by both providers: the intent, the generation guard and the counters. */
  function beginAttempt({ quiet = false, preference = null } = {}) {
    const thisGeneration = ++generation;
    publish({
      status: quiet ? STATUS.reconnecting : STATUS.connecting,
      enabled: true,
      error: null,
      preference: preference ?? state.preference,
      verified: { tunnel: null, egress: null },
      attempts: quiet ? state.attempts : state.attempts + 1,
    });
    return thisGeneration;
  }

  /**
   * Starts an attempt through whichever provider is selected.
   *
   * The two differ only in where the proxy comes from: Proton mints one for a
   * session, a custom endpoint is one the user named. Everything else — the
   * CONNECT proof, the egress check, the failure reporting — is shared.
   */
  async function performConnect({ preference, quiet = false } = {}) {
    return state.provider === PROVIDER.manual
      ? connectManual({ quiet })
      : connectProton({ preference, quiet });
  }

  /**
   * Connects through an endpoint the user supplied.
   *
   * There is no account, no session and no credential minting, so the proof of
   * a working connection is the CONNECT reply itself: the probe target is never
   * requested from, and nothing is fetched from any third party.
   */
  async function connectManual({ quiet = false } = {}) {
    const thisGeneration = beginAttempt({ quiet });
    try {
      if (!manual) throw new NoEndpointError();
      const proxy = manualProxy(manual);

      /*
       * Prove the endpoint can carry a *verified TLS* session, not merely answer
       * a CONNECT. A proxy that black-holes the target, or intercepts TLS with a
       * certificate it cannot make the browser trust, answers the CONNECT just as
       * happily — and that is precisely how a proxied page goes blank. When the
       * injected tunnel offers no TLS probe (the test doubles), this degrades to
       * the CONNECT check it has always done.
       */
      const usedTlsProof = Boolean(tunnel.verifyTls);
      if (tunnel.verifyTls) {
        await tunnel.verifyTls({
          proxy,
          target: MANUAL_PROBE_TARGET,
          timeoutMs: CONNECT_TIMEOUT_MS,
        });
      } else {
        const probe = await tunnel.openConnectTunnel({
          proxy,
          target: MANUAL_PROBE_TARGET,
          timeoutMs: CONNECT_TIMEOUT_MS,
        });
        probe.socket.destroy();
      }

      if (thisGeneration !== generation) return snapshot();

      publish({
        status: STATUS.connected,
        error: null,
        connectedSince: now(),
        server: {
          id: `custom:${manual.host}:${manual.port}`,
          name: manual.name,
          /*
           * These fields describe a Proton logical server. A custom endpoint has
           * no tier, no country and no feature flags, so they stay null/false
           * rather than being filled in with something plausible.
           */
          tier: 0,
          /*
           * `entryCountry`/`exitCountry` carry the country the pool was asked
           * for, when there was one: it is real provenance from the source that
           * listed the proxy, not a guess. Everything a Proton logical server
           * has that a public proxy does not stays null/false rather than being
           * filled in with something plausible.
           */
          entryCountry: manual.country || null,
          exitCountry: manual.country || null,
          city: null,
          secureCore: false,
          p2p: false,
          streaming: false,
          serverCount: 1,
          exitIp: null,
          physicalLabel: null,
          proxyHost: manual.host,
          proxyPort: manual.port,
        },
        verified: {
          tunnel: {
            ok: true,
            checkedAt: now(),
            detail: `The proxy at ${manual.host}:${manual.port} ${
              usedTlsProof ? "carried a verified TLS session" : "accepted a CONNECT"
            }.`,
          },
          egress: null,
        },
      });

      verifyEgress({ throwOnMismatch: true }).catch((error) => {
        if (thisGeneration !== generation) return;
        publish({
          status: STATUS.error,
          connectedSince: null,
          server: null,
          error: errorOf(ERROR.EXIT_NOT_VPN, error instanceof Error ? error.message : String(error)),
        });
      });

      log(`vpn: connected through the custom endpoint ${manual.host}:${manual.port}`);
      return snapshot();
    } catch (error) {
      return failAttempt(error, thisGeneration);
    }
  }

  async function connectProton({ preference, quiet = false } = {}) {
    const thisGeneration = beginAttempt({ quiet, preference });

    try {
      const session = await sessionStore.load();
      if (!session) throw new SignInRequiredError();
      const active = await refreshSessionIfNeeded(session);

      // The whole attempt is bounded. A blocked or unreachable Proton must not
      // leave the controller in `connecting` indefinitely, and the remaining
      // budget also caps the tunnel handshake below.
      const deadline = now() + CONNECT_TIMEOUT_MS;
      const remainingMs = () => {
        const remaining = deadline - now();
        if (remaining <= 0) throw new Error("The connection attempt took too long.");
        return remaining;
      };

      const { logicals } = await loadCatalogue();
      const wanted = preference ?? state.preference ?? {};
      const { logical, reason } = selectLogical(logicals, wanted);
      if (!logical) throw new Error(reason ?? "No Proton server is available.");

      const { endpoint, reason: endpointReason } = resolveEndpoint(logical);
      if (!endpoint) throw new Error(endpointReason ?? "That server cannot be reached over Proton's proxy.");

      const creds = await ensureCredentials({ force: true });
      const proxy = await proxyFor(endpoint, creds);

      // The authenticated-handshake check from the module comment: a TLS
      // session to Proton's proxy, accepted for these exact credentials.
      const probe = await tunnel.openConnectTunnel({
        proxy,
        target: { host: API_HOST, port: 443 },
        timeoutMs: Math.max(1_000, Math.min(CONNECT_TIMEOUT_MS, remainingMs())),
      });
      probe.socket.destroy();

      if (thisGeneration !== generation) return snapshot();

      const summary = describeLogical(logical);
      publish({
        status: STATUS.connected,
        error: null,
        signedIn: true,
        uid: active.uid,
        connectedSince: now(),
        server: {
          ...summary,
          exitIp: endpoint.exitIp,
          physicalLabel: endpoint.physicalLabel,
          proxyHost: endpoint.host,
          proxyPort: endpoint.port,
        },
        verified: {
          tunnel: { ok: true, checkedAt: now(), detail: `Authenticated tunnel to ${endpoint.host}.` },
          egress: null,
        },
      });

      // Run the egress check after the connection is usable, so a slow check
      // does not delay the user. A conclusive mismatch is a real failure.
      verifyEgress({ throwOnMismatch: true }).catch((error) => {
        if (thisGeneration !== generation) return;
        credentials = null;
        // A conclusive mismatch is a detected leak, not a warning: the tunnel
        // handshake may have succeeded, but traffic demonstrably did not travel
        // through it, so the connected state and its server both go away.
        publish({
          status: STATUS.error,
          connectedSince: null,
          server: null,
          error: errorOf(ERROR.EXIT_NOT_VPN, error instanceof Error ? error.message : String(error)),
        });
      });

      log(`vpn: connected through ${endpoint.host}:${endpoint.port} (${summary.name})`);
      return snapshot();
    } catch (error) {
      return failAttempt(error, thisGeneration);
    }
  }

  /** Serialises operations so two clicks cannot interleave state. */
  function run(operation) {
    if (inflight) return inflight;
    inflight = operation().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return {
    subscribe,
    snapshot,
    decideRoute,
    coverage,

    /** Turns the VPN on: a real connect attempt, or the reason it could not run. */
    connect(preference) {
      return run(() => performConnect({ preference }));
    },

    /**
     * One-click connect: find a working public proxy and dial it.
     *
     * A stored endpoint is reused only when it already answers this exact
     * request — same country — so asking for Japan after connecting to the US
     * rescans instead of quietly handing back the US. Otherwise automatic
     * discovery runs and the ranked working proxies are tried in order. Public
     * proxies die between the health test and the real connect, so one failure
     * falls through to the next candidate instead of leaving the user with an
     * error. The endpoint that finally works is stored exactly as if it had been
     * typed, so every existing surface keeps working.
     *
     * `canary` is a list of `{host, port}` the caller treats as "must work"
     * (CrystalOS passes the search engine): proxies that reach it are preferred,
     * and the result reports how many could, so a search box that would go blank
     * is chosen against rather than into.
     */
    quickConnect({ country = null, canary = [] } = {}) {
      return run(async () => {
        let wantedCountry;
        try {
          wantedCountry = normaliseCountry(country);
        } catch (error) {
          return failAttempt(error, ++generation);
        }

        // Record the intent before anything can fail, so the picker keeps
        // showing what was asked for even when nothing could be found.
        publish({ preference: wantedCountry ? { country: wantedCountry } : null });

        // Reuse the stored endpoint only when it is the same request. A typed
        // endpoint (no country) is reused for "anywhere" scans; asking for a
        // country the stored endpoint is not in forces a fresh scan.
        const storedMatches = manual && (manual.country || null) === wantedCountry;
        if (storedMatches) {
          const attempt = await connectManual();
          if (attempt.status === STATUS.connected) return attempt;
          // A dead stored endpoint — common for a year-old public proxy — must
          // not end the click with an error. Fall through and scan again.
          log(`vpn: stored endpoint ${manual.host}:${manual.port} did not connect; searching for another`);
          if (!proxyPool) return attempt;
        }

        if (!proxyPool) {
          return failAttempt(
            new NoProxyError("Automatic server discovery is not available in this build."),
            ++generation,
          );
        }

        publish({
          status: STATUS.connecting,
          enabled: true,
          error: null,
          verified: { tunnel: null, egress: null },
        });

        let found;
        try {
          found = await proxyPool.findBest({
            count: QUICK_CONNECT_ATTEMPTS,
            country: wantedCountry,
            canary,
          });
        } catch (error) {
          return failAttempt(
            new NoProxyError(error instanceof Error ? error.message : String(error)),
            ++generation,
          );
        }

        const candidates = found?.endpoints ?? (found?.endpoint ? [found.endpoint] : []);
        if (candidates.length === 0) {
          return failAttempt(new NoProxyError(found?.reason), ++generation);
        }
        log(
          `vpn: ${found.working} working ${wantedCountry ? `in ${wantedCountry}` : "worldwide"}, ` +
            `${found.canaryOk ?? 0} reach the canary`,
        );

        let last = snapshot();
        for (const candidate of candidates) {
          try {
            manual = normaliseEndpoint({
              ...candidate,
              country: candidate.country || wantedCountry || "",
            });
          } catch {
            continue;
          }
          if (endpointStore) await endpointStore.save({ provider: PROVIDER.manual, endpoint: manual });
          publish({ provider: PROVIDER.manual, error: null });

          const attempt = await connectManual();
          if (attempt.status === STATUS.connected) {
            log(
              `vpn: auto-selected ${manual.host}:${manual.port}` +
                (manual.country ? ` in ${countryName(manual.country)}` : "") +
                (candidate.canary === false ? " (could not reach the canary)" : ""),
            );
            return attempt;
          }
          last = attempt;
          log(
            `vpn: auto endpoint ${manual.host}:${manual.port} did not connect (${attempt.error?.code}); trying the next`,
          );
          // Reset to a connecting state so the next attempt is not read as the
          // end of the line, and so enforcement keeps failing traffic closed.
          publish({
            status: STATUS.connecting,
            enabled: true,
            error: null,
            verified: { tunnel: null, egress: null },
          });
        }

        return failAttempt(
          new NoProxyError(`${candidates.length} working proxies stopped responding before connecting.`),
          ++generation,
        );
      });
    },

    /** Reconnects through the same server without changing the user's intent. */
    reconnect(preference) {
      return run(async () => {
        const target = preference ?? state.preference;
        credentials = null;
        publish({ status: STATUS.disconnecting, verified: { tunnel: null, egress: null } });
        return performConnect({ preference: target, quiet: true });
      });
    },

    disconnect() {
      return run(async () => {
        generation += 1;
        credentials = null;
        catalogue = null;
        publish({
          status: STATUS.disconnected,
          enabled: false,
          connectedSince: null,
          server: null,
          error: null,
          verified: { tunnel: null, egress: null },
        });
        log("vpn: disconnected");
        return snapshot();
      });
    },

    /** On-demand exit check. Never fakes a result when it cannot complete. */
    async verify() {
      return verifyEgress();
    },

    async listServers({ force = false } = {}) {
      const { logicals } = await loadCatalogue({ force });
      return listConnectable(logicals);
    },

    setPreference(preference) {
      const next = preference && typeof preference === "object" ? { ...preference } : null;
      publish({ preference: next });
      return snapshot();
    },

    /** Enforcement is only meaningful while the VPN is wanted. */
    setEnforce(enforce) {
      publish({ enforce: Boolean(enforce), error: Boolean(enforce) ? state.error : null });
      return snapshot();
    },

    /**
     * Selects which provider a connect attempt uses.
     *
     * A stored choice, so it survives a restart. Switching while connected tears
     * the connection down first: a tunnel built to one proxy is not a tunnel to
     * another, and leaving it up would report the new provider over the old
     * connection — exactly the disagreement this controller exists to prevent.
     */
    async setProvider(provider) {
      const next = provider === PROVIDER.manual ? PROVIDER.manual : PROVIDER.proton;
      if (next !== state.provider) {
        generation += 1;
        credentials = null;
        publish({
          provider: next,
          status: STATUS.disconnected,
          enabled: false,
          connectedSince: null,
          server: null,
          error: null,
          verified: { tunnel: null, egress: null },
        });
      }
      if (endpointStore) await endpointStore.save({ provider: next, endpoint: manual });
      log(`vpn: provider is now ${next}`);
      return snapshot();
    },

    /**
     * Stores the endpoint the account-free provider connects through.
     *
     * Validation happens before anything is written, so an endpoint that cannot
     * be dialled never reaches the disk and come back at boot as a mystery
     * failure. Selecting a new endpoint invalidates a connection built through
     * the old one.
     */
    async saveEndpoint(input) {
      const next = normaliseEndpoint(input);
      manual = next;
      const wasLive = state.status === STATUS.connected || state.status === STATUS.reconnecting;
      if (wasLive) generation += 1;
      publish(
        wasLive
          ? {
              provider: PROVIDER.manual,
              status: STATUS.disconnected,
              enabled: false,
              connectedSince: null,
              server: null,
              error: null,
              verified: { tunnel: null, egress: null },
            }
          : { provider: PROVIDER.manual },
      );
      if (endpointStore) await endpointStore.save({ provider: PROVIDER.manual, endpoint: next });
      return snapshot();
    },

    /** Removes the custom endpoint and returns the VPN to the legacy provider. */
    async clearEndpoint() {
      manual = null;
      generation += 1;
      credentials = null;
      publish({
        provider: PROVIDER.proton,
        status: STATUS.disconnected,
        enabled: false,
        connectedSince: null,
        server: null,
        error: null,
        verified: { tunnel: null, egress: null },
      });
      if (endpointStore) await endpointStore.clear();
      return snapshot();
    },

    async signIn(session) {
      const saved = await sessionStore.save(session);
      credentials = null;
      const described = await sessionStore.describe();
      publish({ signedIn: described.signedIn, uid: saved.uid, error: null });
      return snapshot();
    },

    async signOut() {
      generation += 1;
      credentials = null;
      catalogue = null;
      await sessionStore.clear();
      publish({
        status: STATUS.disconnected,
        enabled: false,
        signedIn: false,
        uid: null,
        server: null,
        preference: null,
        connectedSince: null,
        error: null,
        verified: { tunnel: null, egress: null },
      });
      return snapshot();
    },

    /** Restores non-secret state at boot; credentials are re-minted lazily. */
    async hydrate() {
      const described = await sessionStore.describe();
      const stored = endpointStore ? await endpointStore.load() : null;
      if (stored?.endpoint) manual = stored.endpoint;
      publish({
        signedIn: described.signedIn,
        uid: described.uid,
        status: STATUS.disconnected,
        provider: stored?.provider === PROVIDER.manual ? PROVIDER.manual : PROVIDER.proton,
      });
      return snapshot();
    },

    /** Test and diagnostics hook: the configured feature bits, without secrets. */
    features: { ...FEATURE },
  };
}
