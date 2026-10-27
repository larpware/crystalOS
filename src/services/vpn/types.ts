/* ==========================================================================
   VPN types

   These mirror `server/vpn/controller.mjs`'s `snapshot()` and the API's
   `statusPayload()` exactly. They are a contract, not a model: nothing here is
   computed on the client except where `coverage.ts` says so. If a field is
   missing from the backend payload, the UI must show it as unknown rather than
   substituting a plausible value.
   ========================================================================== */

export type VpnStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnecting"
  | "error";

/**
 * Which proxy a connect attempt uses.
 *
 * CrystalVPN ships one transport: `manual` speaks CONNECT to an endpoint the
 * user named, or one Quick connect found. The name is kept because it is the
 * backend's wire value.
 */
export type VpnProvider = "manual";

/** The endpoint the account-free provider dials, described without secrets. */
export interface VpnEndpointSummary {
  name: string;
  host: string;
  port: number;
  scheme: string;
  /** True when a username is stored; never the username or password itself. */
  authenticated: boolean;
  hasCheckUrl: boolean;
  /** The country the pool was asked for when it chose this endpoint, or null. */
  country: string | null;
}

/** What the user asked for. `country` also drives the automatic pool. */
export interface VpnPreference {
  serverId?: string;
  country?: string;
  city?: string;
}

/** One entry in the exit-country picker. An empty code means "anywhere". */
export interface VpnCountry {
  code: string;
  name: string;
}

/** What the user types into the endpoint form. */
export interface VpnEndpointInput {
  scheme?: string;
  host: string;
  port?: number | string;
  username?: string;
  password?: string;
  name?: string;
  checkUrl?: string;
}

/** The result of the real CONNECT probe behind `POST /api/vpn/endpoint/test`. */
export interface VpnEndpointTest {
  ok: boolean;
  ms: number;
  detail: string;
  checkedAt: number;
}

export interface VpnServerSummary {
  /** Logical server id issued by the backend. */
  id: string;
  name: string;
  tier: number;
  entryCountry: string | null;
  exitCountry: string | null;
  city: string | null;
  secureCore: boolean;
  p2p: boolean;
  streaming: boolean;
  serverCount: number;
  /** Present only on the connected server. */
  exitIp?: string | null;
  physicalLabel?: string | null;
  proxyHost?: string | null;
  proxyPort?: number | null;
}

export interface VpnTunnelVerification {
  ok: boolean;
  checkedAt: number;
  detail: string;
}

export interface VpnEgressVerification {
  /** True only when the exit address was proven different from the direct one. */
  ok: boolean;
  /** False when the check could not be completed — an unknown, not a failure. */
  conclusive: boolean;
  /** True when the tunnel exits from this machine's own address. */
  matches: boolean | null;
  exitIp: string | null;
  directIp: string | null;
  country: string | null;
  isp: string | null;
  checkedAt: number;
  reason: string | null;
}

export interface VpnError {
  code: string;
  message: string;
}

/** What the backend reports about the transport in use. */
export interface VpnTransport {
  kind: string;
  scheme: string;
  protocol: string;
  scope: string;
  serverHost: string | null;
  serverPort: number | null;
  /** Present only when the account-free provider is active. */
  endpoint?: VpnEndpointSummary | null;
}

export interface VpnServerCoverage {
  scramjetTraffic: string;
  directBrowserTabs: string;
  shellRequests: string;
  hostApplications: string;
}

export interface VpnSnapshot {
  status: VpnStatus;
  /** The user's intent: the VPN is wanted. */
  enabled: boolean;
  /** Block unprotected traffic while `enabled`. */
  enforce: boolean;
  signedIn: boolean;
  uid: string | null;
  /** Which proxy a connect attempt uses; a stored choice that survives a restart. */
  provider: VpnProvider;
  /** What the user asked for: a server, a country or a city; null when unset. */
  preference: VpnPreference | null;
  /** The configured endpoint, described without secrets. */
  endpoint: VpnEndpointSummary | null;
  /**
   * How many proved exits this connection holds, including the preferred one.
   *
   * `1` is a single endpoint — typed by hand, or a scan that found exactly one —
   * and anything above that is what an automatic connection actually is: a ranked
   * set whose streams move to the next exit when the preferred one cannot carry a
   * host. Nothing on screen should describe such a connection as "the exit".
   */
  poolSize: number;
  server: VpnServerSummary | null;
  verified: {
    tunnel: VpnTunnelVerification | null;
    egress: VpnEgressVerification | null;
  };
  /** Epoch ms the proxy credentials expire. Never the credentials themselves. */
  credentialsExpireAt: number | null;
  error: VpnError | null;
  attempts: number;
  connectedSince: number | null;
  lastTransitionAt: number;
  coverage: VpnServerCoverage;
  transport: VpnTransport;
}
