/*
 * CrystalOS — Proton VPN integration constants
 *
 * Every value here was read out of the Proton VPN browser extension that ships
 * with this repository (protonvpnextension/config.js and
 * protonvpnextension/source/js/config.ts), not invented. The extension is an
 * MV3 WebExtension whose entire transport is `chrome.proxy` pointed at an
 * **HTTPS CONNECT proxy** run by the selected Proton VPN server, authenticated
 * with short-lived credentials minted by Proton's own API. None of that needs a
 * Chromium extension host — a CONNECT proxy is ordinary TCP — so the same
 * mechanism is what CrystalOS's backend speaks.
 *
 * Keep these aligned with the extension: a proxy port or path that drifts from
 * what Proton actually serves produces a connection that fails for no visible
 * reason.
 */

/** Endpoints and ports, taken from the extension's `config.js`. */
export const PROTON = {
  /** `baseDomainURL` in the extension config. */
  accountURL: "https://account.proton.me",
  /** `baseAPIURL` = `${baseDomainURL}/api/`. */
  apiBase: "https://account.proton.me/api/",
  /** Where a person creates or reads their own Proton session. */
  dashboardURL: "https://account.proton.me/vpn/dashboard",
  /** `getFullAppVersion()` in the extension config. */
  appVersionHeader: "browser-vpn@1.3.6",
  /** `tokenDuration` — the lifetime the extension asks for, in seconds. */
  tokenDurationSeconds: 1200,

  /* Proxy transport (`scheme`, `proxyPort`, `proxySecureCorePort`). */
  proxyScheme: "https",
  proxyPort: 4443,
  secureCoreProxyPort: 443,
  /** `singleProxyPort: false` — the extension spreads over proxyPort + 0..11. */
  proxyPortSpread: 11,

  /** `vpn/v1/browser/token` — the proxy credential endpoint. */
  browserTokenPath: "vpn/v1/browser/token",
  /** `vpn/v2/logicals` — the server list the extension prefers. */
  logicalsPath: "vpn/v2/logicals",
  /** `vpn/v1/logicals` — the V1 fallback list. */
  logicalsV1Path: "vpn/v1/logicals",
  /** `vpn/v1/location` — Proton's own "what IP do we see you from". */
  locationPath: "vpn/v1/location",
  /** `auth/refresh`. */
  refreshPath: "auth/refresh",
};

/**
 * Hosts that must never be sent through the VPN tunnel.
 *
 * `account.proton.me` is the extension's `apiDomainsExclusion`: routing Proton's
 * own API through Proton's proxy would mean the API call that refreshes the
 * session depends on the session's own credentials. Loopback and RFC1918
 * addresses are the extension's `proxyLocalNetworkExclusion`: CrystalOS's own
 * backend, dev servers and LAN devices are not internet traffic, and sending
 * them to a VPN exit would break them.
 */
export const LOCAL_EXCLUSIONS = [
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
];

/** Private address literals, by IPv4 first octet pair plus named prefixes. */
export const PRIVATE_IPV4_PREFIXES = ["10.", "192.168.", "169.254."];

/** RFC1918 172.16.0.0/12 — the second octet is what decides. */
export function isPrivateAddress(hostname) {
  const host = String(hostname ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  if (LOCAL_EXCLUSIONS.includes(host)) return true;
  if (PRIVATE_IPV4_PREFIXES.some((prefix) => host.startsWith(prefix))) return true;
  const match = /^172\.(\d{1,2})\./.exec(host);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  // Any IPv6 link-local or unique-local address.
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true;
  return false;
}

/**
 * Feature bits, copied from the extension's `vpn/Feature.ts`.
 *
 * Kept as plain numbers so the V2 logical payload can be read without a schema
 * dependency, exactly as the extension reads it.
 */
export const FEATURE = {
  SECURE_CORE: 1,
  TOR: 2,
  P2P: 4,
  STREAMING: 8,
  IPV6: 16,
  RESTRICTED: 32,
  PARTNER: 64,
};

/**
 * Tiers Proton serves over the HTTP proxy.
 *
 * The extension's `isLogicalAuthorized` is `logical.Tier <= 2`: Proton's proxy
 * transport is offered for tiers 0–2 only, whatever the account can reach over
 * WireGuard. Offering a higher tier here would produce a connection Proton
 * never accepts.
 */
export const MAX_PROXY_TIER = 2;

/* ---------------------------------------------------------------- tunables */

/** Total time a single connect attempt may take before it is abandoned. */
export const CONNECT_TIMEOUT_MS = 25_000;

/** Socket handshake timeouts. */
export const PROXY_HANDSHAKE_TIMEOUT_MS = 15_000;

/** How long a failed connection is remembered before a retry is allowed. */
export const RETRY_BACKOFF_MS = [1_000, 3_000, 8_000];

/** Credentials are refreshed this long before Proton expires them. */
export const CREDENTIAL_REFRESH_MARGIN_MS = 120_000;
