/*
 * CrystalOS — the automatic free-proxy pool
 *
 * ## Why this exists
 *
 * The account-free provider (`endpoint.mjs`) needs a proxy the user names. That
 * is fine for someone who has one, but a student should not have to find a
 * host, a port and credentials before a VPN works at all. This module is the
 * zero-config half: it fetches public lists of HTTP CONNECT proxies, proves each
 * candidate really accepts a CONNECT, and hands back the fastest working one —
 * optionally restricted to a country the user picked.
 *
 * ## What it is, honestly
 *
 * These are *public* proxies, not a vendor's servers. They are unaccountable and
 * they come and go, so:
 *
 *   • every candidate is proven with a real, certificate-verified TLS handshake
 *     through the tunnel before it is offered — not merely a CONNECT, which a
 *     dead exit or a man-in-the-middle proxy accepts just as readily;
 *   • a candidate is not good enough just because it connects to *something*.
 *     Many public proxies carry some destinations and silently black-hole
 *     others, which is exactly how a search box turns into a blank page. So the
 *     pool also tests a caller-supplied **canary** (CrystalOS passes the search
 *     engine) and ranks canary-capable proxies first, reporting honestly when
 *     none could reach it;
 *   • the traffic that reaches a site through the tunnel is still end-to-end TLS
 *     the proxy cannot read or forge (CrystalOS opens opaque CONNECT tunnels and
 *     never terminates the session), so what a hostile exit can see is the host
 *     names a user visits, not their contents;
 *   • nothing here pretends to be a commercial VPN. `snapshot()` still reports
 *     an `https` tunnel as certificate-verified and reports the exit address
 *     from a real measurement, or as unknown — never as a pass it did not take.
 *
 * ## Testability
 *
 * `fetch` and the CONNECT client are injected, so the scanner is tested against
 * a controlled list and a controlled proxy rather than the live internet.
 */

import { openConnectTunnel, verifyTlsThroughProxy } from "./tunnel.mjs";

/**
 * Public lists of plain-HTTP CONNECT proxies, for the worldwide scan.
 *
 * Deliberately several: a single list is down often enough to matter, and
 * merging them widens the pool without any one source being trusted. Each is
 * either one `host:port` per line (some carry a scheme or credentials) or the
 * GeoNode JSON shape, which `parseCandidates` also understands.
 */
export const DEFAULT_PROXY_SOURCES = [
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
  "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=all",
  "https://proxylist.geonode.com/api/proxy-list?limit=200&page=1&sort_by=lastChecked&sort_type=desc&protocols=http",
];

/**
 * Country-filtered sources.
 *
 * proxyscrape takes any ISO-3166 alpha-2 code and answers with just that
 * country's proxies; GeoNode carries the same code in a JSON envelope. Both are
 * queried so one being down does not empty a country.
 */
export function countrySources(country) {
  const code = String(country).toUpperCase();
  return [
    `https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=5000&country=${code}`,
    `https://proxylist.geonode.com/api/proxy-list?limit=200&page=1&sort_by=lastChecked&sort_type=desc&protocols=http&country=${code}`,
  ];
}

/**
 * Where the exit address is read from.
 *
 * A plain-HTTP echo service, chosen because it returns a bare address that
 * `readAddress` in the controller already understands. It is only contacted to
 * compare the direct address with the tunnelled one, and only when an exit check
 * is actually run — never as a side effect of connecting.
 */
export const DEFAULT_EXIT_CHECK_URL = "http://api.ipify.org/";

/** The undocumented upper bound on how many candidates one scan will try. */
export const DEFAULT_MAX_CANDIDATES = 60;

/** What a proxy must carry a verified TLS session to before it is considered. */
export const DEFAULT_PROBE_TARGET = { host: "example.com", port: 443 };

/**
 * Parses one line of a public proxy list into `{ host, port, username, password }`.
 *
 * Returns `null` for anything that is not a usable `host:port`, so a comment, a
 * header row or a malformed entry is skipped rather than turned into a
 * connection attempt. Boundaries are deliberately narrow: a value that is not
 * obviously a host and a port is dropped, never guessed at.
 */
export function parseProxyLine(line) {
  let text = String(line ?? "").trim();
  if (!text || text.startsWith("#")) return null;

  // Some lists prefix a scheme (`http://1.2.3.4:8080`) and some a path.
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  text = text.split(/[\s/]/, 1)[0];

  // Optional `user:pass@` credentials.
  let username = "";
  let password = "";
  const at = text.lastIndexOf("@");
  if (at !== -1) {
    const credentials = text.slice(0, at);
    text = text.slice(at + 1);
    const separator = credentials.indexOf(":");
    username = separator === -1 ? credentials : credentials.slice(0, separator);
    password = separator === -1 ? "" : credentials.slice(separator + 1);
  }

  let host;
  let portText;
  if (text.startsWith("[")) {
    const close = text.indexOf("]");
    if (close === -1) return null;
    host = text.slice(1, close);
    const rest = text.slice(close + 1);
    if (!rest.startsWith(":")) return null;
    portText = rest.slice(1);
  } else {
    const separator = text.lastIndexOf(":");
    if (separator === -1) return null;
    host = text.slice(0, separator);
    portText = text.slice(separator + 1);
  }

  host = host.trim().toLowerCase();
  const port = Number(portText);
  if (!host || /[\s/@]/.test(host)) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  return { scheme: "http", host, port, username: username.trim(), password };
}

/**
 * Turns one source's body into candidates.
 *
 * Handles both shapes the sources use: one `host:port` per line, and GeoNode's
 * `{ data: [{ ip, port, ... }] }`. A body that is neither is treated as empty,
 * because a source that changed its format is a source that contributed nothing
 * — not a reason to fail the whole scan.
 */
export function parseCandidates(body) {
  const text = String(body ?? "").trim();
  if (!text) return [];

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : [];
      return rows
        .map((row) => {
          const host = String(row?.ip ?? row?.host ?? "").trim().toLowerCase();
          const port = Number(row?.port);
          if (!host || /[\s/@]/.test(host)) return null;
          if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
          return { scheme: "http", host, port, username: "", password: "" };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  return text.split(/\r?\n/).map(parseProxyLine).filter(Boolean);
}

/** Runs `worker` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * The scanner.
 *
 * `findBest()` fetches the relevant sources, deduplicates on `host:port`, and
 * CONNECT-tests candidates in batches — stopping as soon as `count` good ones
 * have been found. Survivors are then tested against the caller's `canary`
 * targets and ranked: a proxy that can also reach the canary (the search engine)
 * beats one that merely connects. The fastest survivor among the best tier wins.
 */
export function createProxyPool({
  /**
   * The whole health check, injectable as one unit. Defaults to a *verified TLS*
   * probe (`verifyTlsThroughProxy`): a proxy is only good if it can carry a real,
   * certificate-checked TLS session to the target. A CONNECT-only probe would
   * happily accept a proxy that black-holes the site or intercepts TLS — the two
   * ways a proxied page goes blank or shows a certificate error.
   */
  probe = null,
  tunnel = { openConnectTunnel },
  verifyTls = verifyTlsThroughProxy,
  fetchImpl = (...args) => fetch(...args),
  sources = DEFAULT_PROXY_SOURCES,
  /** Accepts `{host, port}` or `{hosts: [...]}`; all must answer a CONNECT. */
  probeTarget = DEFAULT_PROBE_TARGET,
  probeTargets = null,
  checkUrl = DEFAULT_EXIT_CHECK_URL,
  timeoutMs = 4_000,
  sourceTimeoutMs = 8_000,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  concurrency = 24,
  targetWorking = 5,
  log = () => undefined,
} = {}) {
  let lastScan = null;

  const baseTargets = probeTargets ?? (probeTarget ? [probeTarget] : []);

  /**
   * One proven target. A TLS port gets the full handshake proof; anything else
   * (there is nothing else in practice) falls back to a bare CONNECT, because
   * plaintext has no certificate to verify.
   */
  const probeOne =
    probe ??
    (async ({ proxy, target, timeoutMs: budget }) => {
      if (target.port === 443) {
        await verifyTls({ proxy, target, timeoutMs: budget });
        return;
      }
      const opened = await tunnel.openConnectTunnel({ proxy, target, timeoutMs: budget });
      opened.socket.destroy();
    });

  async function fetchSource(url) {
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(sourceTimeoutMs),
        headers: { accept: "text/plain, application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        log(`proxy source ${url} answered ${response.status}`);
        return [];
      }
      return parseCandidates(await response.text());
    } catch (error) {
      // A dead source is not a failed scan: the others still contribute.
      log(`proxy source ${url} failed: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }

  /** Fetches and merges every source into a bounded, de-duplicated candidate list. */
  async function discover({ country = null } = {}) {
    const list = country ? countrySources(country) : sources;
    const pages = await Promise.all(list.map(fetchSource));
    const seen = new Set();
    const candidates = [];
    for (const page of pages) {
      for (const parsed of page) {
        const key = `${parsed.host}:${parsed.port}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(parsed);
        if (candidates.length >= maxCandidates) return candidates;
      }
    }
    return candidates;
  }

  /**
   * One proven target. A candidate survives only if the probe succeeds against
   * every target; a resolved round-trip in ms is the score, `null` is a reject.
   */
  async function test(candidate, targets) {
    const startedAt = Date.now();
    const proxy = {
      host: candidate.host,
      port: candidate.port,
      scheme: candidate.scheme ?? "http",
      authorization: candidate.username
        ? `Basic ${Buffer.from(`${candidate.username}:${candidate.password}`).toString("base64")}`
        : null,
    };
    for (const target of targets) {
      try {
        await probeOne({ proxy, target, timeoutMs });
      } catch {
        return null;
      }
    }
    return Date.now() - startedAt;
  }

  /**
   * Scans and returns working endpoints, best first.
   *
   * Resolves to `{ endpoints, endpoint, ms, tested, working, canaryOk, reason }`:
   * `endpoints` is the ranked list (up to `count`) so a caller can fall back to
   * the next one when a proxy dies between the test and the real connect — a
   * thing public proxies do constantly. `canaryOk` counts how many could also
   * reach the canary. When nothing works, `endpoint` is `null` and `reason` says
   * so — never an invented server.
   */
  async function findBest({ count = targetWorking, country = null, canary = [] } = {}) {
    const wanted = Math.max(1, count);
    const canaryTargets = (Array.isArray(canary) ? canary : [canary])
      .filter((t) => t && t.host)
      .map((t) => ({ host: t.host, port: Number(t.port) || 443 }));

    const candidates = await discover({ country });
    if (candidates.length === 0) {
      lastScan = { at: Date.now(), tested: 0, working: 0, canaryOk: 0 };
      return {
        endpoints: [],
        endpoint: null,
        canaryOk: 0,
        reason: country
          ? `No public proxies for ${country} could be reached, so there was nothing to try.`
          : "No proxy lists could be reached, so there was nothing to try.",
      };
    }

    const working = [];
    for (let start = 0; start < candidates.length; start += concurrency) {
      const batch = candidates.slice(start, start + concurrency);
      const measured = await mapWithConcurrency(batch, concurrency, async (candidate) => ({
        candidate,
        ms: await test(candidate, baseTargets),
      }));
      for (const result of measured) {
        if (result.ms !== null) working.push({ ...result.candidate, ms: result.ms });
      }
      if (working.length >= wanted) break;
    }

    if (working.length === 0) {
      lastScan = { at: Date.now(), tested: candidates.length, working: 0, canaryOk: 0 };
      return {
        endpoints: [],
        endpoint: null,
        canaryOk: 0,
        reason: country
          ? `${candidates.length} public proxies in ${country} were tried and none could carry a verified TLS connection.`
          : `${candidates.length} public proxies were tried and none could carry a verified TLS connection.`,
        tested: candidates.length,
      };
    }

    // Phase two: only the survivors are tested against the canary, so the extra
    // cost is bounded by how many already work — usually a handful.
    let canaryOk = 0;
    if (canaryTargets.length > 0) {
      for (const survivor of working) {
        const ms = await test(survivor, canaryTargets);
        survivor.canary = ms !== null;
        if (survivor.canary) canaryOk += 1;
      }
    } else {
      for (const survivor of working) survivor.canary = null;
    }

    // Canary-capable first, then fastest. `null` (no canary asked for) sorts
    // with the capable group so a caller without a canary sees everyone.
    working.sort((a, b) => {
      const tier = (item) => (item.canary === false ? 1 : 0);
      return tier(a) - tier(b) || a.ms - b.ms;
    });
    lastScan = { at: Date.now(), tested: candidates.length, working: working.length, canaryOk };

    const endpoints = working.map((best) => ({
      scheme: "http",
      host: best.host,
      port: best.port,
      name: `${best.host}:${best.port}`,
      username: best.username,
      password: best.password,
      checkUrl,
      country: country ?? null,
      /** Not part of the endpoint shape; carried for logging and selection. */
      ms: best.ms,
      canary: best.canary,
    }));

    return {
      endpoints,
      endpoint: endpoints[0],
      ms: working[0].ms,
      tested: candidates.length,
      working: working.length,
      canaryOk,
    };
  }

  return {
    discover,
    test: (candidate) => test(candidate, baseTargets),
    findBest,
    /** Facts from the last scan, for diagnostics — never a claimed server. */
    stats: () => (lastScan ? { ...lastScan } : null),
  };
}
