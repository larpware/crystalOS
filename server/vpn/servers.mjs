/*
 * CrystalOS — Proton server selection
 *
 * The extension's rules, restated here in one place:
 *
 *   • `isLogicalConnectable` — only tiers 0–2, no TOR, no RESTRICTED. Proton
 *     serves the HTTP proxy for those; a higher tier would be offered and then
 *     refused by the proxy itself.
 *   • `pickServerInLogical` — the physical server inside a logical, preferring
 *     ones that are up.
 *   • `connectLogical` — the proxy endpoint is the physical server's `Domain`
 *     on port 4443, or 443 for a Secure Core logical. When the deployment
 *     allows a port range (`singleProxyPort: false`), the offset is the
 *     physical server's numeric label, capped.
 *
 * Nothing here invents a server, a load figure or a latency number. If Proton
 * does not report a value, CrystalOS reports that it is unknown.
 */

import { FEATURE, MAX_PROXY_TIER, PROTON } from "./config.mjs";

export function isLogicalConnectable(logical) {
  if (!logical || typeof logical !== "object") return false;
  if ((logical.Features & (FEATURE.TOR | FEATURE.RESTRICTED)) !== 0) return false;
  const tier = Number(logical.Tier);
  return Number.isFinite(tier) && tier <= MAX_PROXY_TIER;
}

function isServerUp(server) {
  return server && (server.Status === 1 || server.Enabled === true);
}

/** The proxy port for a physical server, following the extension's rule. */
export function proxyPortFor({ secureCore, label }) {
  if (secureCore) return PROTON.secureCoreProxyPort;
  const numeric = /^(\d+)$/.exec(String(label ?? "").trim());
  const offset = numeric ? Math.min(PROTON.proxyPortSpread, Number(numeric[1])) : 0;
  return PROTON.proxyPort + offset;
}

/**
 * Picks a physical server inside a logical.
 *
 * The extension picks at random among the servers that are up, falling back to
 * all of them. CrystalOS picks the least loaded up server instead: with no user
 * watching a server list, a deterministic choice is easier to explain and to
 * reproduce in a bug report than a random one. Load is `null` when Proton does
 * not report it, and an unknown load never wins over a known-good one.
 */
export function pickServer(logical) {
  const all = Array.isArray(logical?.Servers) ? logical.Servers.filter(Boolean) : [];
  const up = all.filter(isServerUp);
  const pool = up.length > 0 ? up : all;
  if (pool.length === 0) return null;
  return pool.reduce((best, candidate) => {
    const bestLoad = Number.isFinite(best.Load) ? best.Load : Number.POSITIVE_INFINITY;
    const candidateLoad = Number.isFinite(candidate.Load) ? candidate.Load : Number.POSITIVE_INFINITY;
    return candidateLoad < bestLoad ? candidate : best;
  });
}

/** A stable, UI-safe summary of a logical. No hostnames of physical servers. */
export function describeLogical(logical) {
  return {
    id: String(logical.ID),
    name: logical.Name,
    tier: Number(logical.Tier) || 0,
    entryCountry: logical.EntryCountry ?? null,
    exitCountry: logical.ExitCountry ?? null,
    city: logical.Translations?.City ?? logical.City ?? null,
    secureCore: (logical.Features & FEATURE.SECURE_CORE) !== 0,
    p2p: (logical.Features & FEATURE.P2P) !== 0,
    streaming: (logical.Features & FEATURE.STREAMING) !== 0,
    serverCount: Array.isArray(logical.Servers) ? logical.Servers.length : 0,
  };
}

/**
 * Resolves a logical plus physical server into the proxy endpoint the tunnel
 * dials. Returns null with a reason when nothing connectable was found, so the
 * caller can tell the user *why* rather than producing a generic failure.
 */
export function resolveEndpoint(logical) {
  if (!isLogicalConnectable(logical)) {
    return {
      endpoint: null,
      reason:
        (logical?.Features & FEATURE.RESTRICTED) !== 0
          ? "That server is restricted for this account."
          : (logical?.Features & FEATURE.TOR) !== 0
            ? "TOR servers are not available over Proton's browser proxy."
            : Number(logical?.Tier) > MAX_PROXY_TIER
              ? "Proton's browser proxy is offered for free and tier-1/2 servers only."
              : "That server is not available over Proton's browser proxy.",
    };
  }

  const physical = pickServer(logical);
  const host = physical?.Domain ?? logical.Domain;
  if (!host || typeof host !== "string") {
    return { endpoint: null, reason: "Proton did not report a proxy hostname for that server." };
  }

  const secureCore = (logical.Features & FEATURE.SECURE_CORE) !== 0;
  return {
    endpoint: {
      host,
      port: proxyPortFor({ secureCore, label: physical?.Label }),
      secureCore,
      exitIp: physical?.ExitIP ?? null,
      physicalLabel: physical?.Label ?? null,
      logicalId: String(logical.ID),
      logicalName: logical.Name,
    },
    reason: null,
  };
}

/**
 * Chooses a logical from the full list.
 *
 * Preference order is deliberately narrow and explainable:
 *   1. an explicit logical id or name the user asked for,
 *   2. the requested country (and city, when given),
 *   3. anything connectable, least loaded first.
 *
 * When Proton reports no load, "least loaded" degenerates to the first
 * connectable entry — there is no invented score and no invented latency.
 */
export function selectLogical(logicals, { id, name, country, city } = {}) {
  const connectable = (Array.isArray(logicals) ? logicals : []).filter(isLogicalConnectable);
  if (connectable.length === 0) {
    return { logical: null, reason: "This Proton account can reach no server that offers the browser proxy." };
  }

  const wantedId = id === undefined || id === null ? null : String(id);
  const wantedName = typeof name === "string" ? name.trim().toUpperCase() : null;

  let pool = connectable;
  if (wantedId) {
    pool = connectable.filter((logical) => String(logical.ID) === wantedId);
    if (pool.length === 0) return { logical: null, reason: `No Proton server has the id ${wantedId}.` };
  } else if (wantedName) {
    pool = connectable.filter((logical) => String(logical.Name).toUpperCase() === wantedName);
    if (pool.length === 0) return { logical: null, reason: `No Proton server is called ${wantedName}.` };
  }

  if (!wantedId && !wantedName && (country || city)) {
    const byCountry = country
      ? pool.filter((logical) => String(logical.ExitCountry).toUpperCase() === String(country).toUpperCase())
      : pool;
    const byCity = city
      ? byCountry.filter(
          (logical) =>
            String(logical.Translations?.City ?? logical.City ?? "").toLowerCase() ===
            String(city).toLowerCase(),
        )
      : byCountry;
    const narrowed = byCity.length > 0 ? byCity : byCountry;
    if (narrowed.length === 0) {
      return { logical: null, reason: `Proton offers no connectable server in ${city || country}.` };
    }
    pool = narrowed;
  }

  const best = pool.reduce((current, candidate) => {
    const currentLoad = Number.isFinite(current?.StatusReference?.Cost) ? current.StatusReference.Cost : 0;
    const candidateLoad = Number.isFinite(candidate?.StatusReference?.Cost) ? candidate.StatusReference.Cost : 0;
    return candidateLoad < currentLoad ? candidate : current;
  });
  return { logical: best, reason: null };
}

/** The full catalogue the UI may show. Only connectable servers are listed. */
export function listConnectable(logicals) {
  return (Array.isArray(logicals) ? logicals : [])
    .filter(isLogicalConnectable)
    .filter((logical) => (Array.isArray(logical.Servers) ? logical.Servers.length > 0 : Boolean(logical.Domain)))
    .map(describeLogical)
    .sort((a, b) => a.name.localeCompare(b.name));
}
