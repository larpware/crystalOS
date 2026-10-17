/*
 * CrystalOS — a proxy endpoint the user supplies
 *
 * ## Why this exists
 *
 * CrystalOS's tunnel is a plain HTTPS CONNECT client (`tunnel.mjs`). Proton is
 * only one thing that can sit at the other end of it: any HTTP proxy is the
 * same protocol, and many of them need no account at all. This module is the
 * account-free path — the user names an endpoint, and CrystalOS speaks CONNECT
 * to it, with no vendor, no session and no credential minting involved.
 *
 * ## What it never does
 *
 *   * It does not invent an endpoint, a default host, or a "free proxy" list.
 *     A tunnel is only ever built to something the user typed.
 *   * It does not accept a URL where a host belongs. `http://x/`, `user@host`
 *     and anything containing a space or a slash are rejected with a message
 *     that says so, because silently repairing them produces a connection the
 *     user did not ask for.
 *   * It does not accept a path, a query or a fragment on the endpoint. Those
 *     belong to a URL; a proxy is a host and a port.
 *   * It does not keep credentials in a log, an error message or an API
 *     response. Only `hasCredentials` is ever surfaced.
 *
 * The stored file is owner-only (0600 where the platform honours it), lives
 * under `server/vpn/data/`, and is never served by the HTTP layer.
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

/** Where the endpoint lives. Overridable so tests never touch the real file. */
export function defaultEndpointFile() {
  return resolve(process.env.CRESCENT_VPN_ENDPOINT_FILE ?? join(here, "data", "endpoint.json"));
}

/** A rejected endpoint, with a message written for the person who typed it. */
export class EndpointError extends Error {
  constructor(message) {
    super(message);
    this.name = "EndpointError";
  }
}

/** The two providers. `manual` is the account-free one. */
export const PROVIDER = { proton: "proton", manual: "manual" };

/** Conventional ports, used only when the user leaves the port blank. */
export const DEFAULT_PORT = { https: 443, http: 80 };

export const SCHEMES = ["https", "http"];

const MAX_HOST = 253;
const MAX_NAME = 60;
const MAX_CREDENTIAL = 200;
const MAX_CHECK_URL = 500;

/**
 * Splits `host:port` when the user pasted both into one field.
 *
 * Deliberately narrow: a bracketed IPv6 literal keeps its brackets and its own
 * colons, and anything with more than one colon that is not bracketed is
 * rejected rather than guessed at.
 */
function splitHostPort(value) {
  const input = value.trim();
  if (input.startsWith("[")) {
    const close = input.indexOf("]");
    if (close === -1) throw new EndpointError("That looks like an unfinished IPv6 address.");
    const host = input.slice(1, close);
    const rest = input.slice(close + 1);
    if (rest === "") return { host, port: null };
    if (!rest.startsWith(":")) throw new EndpointError("That endpoint is not a host, or a host and a port.");
    return { host, port: rest.slice(1) };
  }
  const parts = input.split(":");
  if (parts.length === 1) return { host: parts[0], port: null };
  if (parts.length === 2) return { host: parts[0], port: parts[1] };
  throw new EndpointError("That looks like a bare IPv6 address. Wrap it in [ ] to use it.");
}

function readPort(value, scheme) {
  if (value === null || value === undefined || value === "" || value === "default") {
    return DEFAULT_PORT[scheme];
  }
  const port = Number(String(value).trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EndpointError("The port must be a whole number between 1 and 65535.");
  }
  return port;
}

function readOptionalString(value, { max, label }) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new EndpointError(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new EndpointError(`${label} is too long (${max} characters at most).`);
  return trimmed;
}

/**
 * Validates what the user entered and returns the one canonical shape the rest
 * of the VPN layer uses. Throws `EndpointError` with something actionable.
 */
export function normaliseEndpoint(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new EndpointError("An endpoint needs a host.");
  }

  const scheme = String(input.scheme ?? "https").trim().toLowerCase();
  if (!SCHEMES.includes(scheme)) {
    throw new EndpointError('The scheme must be either "https" (a TLS proxy) or "http" (a plain proxy).');
  }

  const rawHost = typeof input.host === "string" ? input.host.trim() : "";
  if (!rawHost) throw new EndpointError("Enter the proxy's host name or IP address.");
  if (/[\s/@]/.test(rawHost) || rawHost.includes("://")) {
    throw new EndpointError(
      "Enter only the proxy's host, not a URL — for example proxy.example.com, not https://proxy.example.com/.",
    );
  }

  const { host: hostPart, port: portPart } = splitHostPort(rawHost);
  const host = hostPart.trim().toLowerCase();
  if (!host) throw new EndpointError("Enter the proxy's host name or IP address.");
  if (host.length > MAX_HOST) throw new EndpointError(`That host name is too long (${MAX_HOST} characters at most).`);
  if (/[\s/@]/.test(host)) throw new EndpointError("Enter only the proxy's host, not a URL.");

  const port = readPort(portPart ?? input.port ?? null, scheme);
  const username = readOptionalString(input.username, { max: MAX_CREDENTIAL, label: "The username" });
  const password = readOptionalString(input.password, { max: MAX_CREDENTIAL, label: "The password" });
  const name = readOptionalString(input.name, { max: MAX_NAME, label: "The name" }) || host;

  /*
   * The country is provenance, not configuration: it records which country the
   * automatic pool was asked for when it chose this endpoint. It is what lets a
   * later "connect to Japan" decide whether the stored endpoint already answers
   * that request or whether a fresh scan is owed. Empty means "not a country
   * choice" — a user-typed endpoint, or a worldwide scan.
   */
  let country = "";
  if (input.country !== undefined && input.country !== null && String(input.country).trim() !== "") {
    country = String(input.country).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) {
      throw new EndpointError("The country must be a two-letter code such as US or DE.");
    }
  }

  /*
   * The exit check URL has to be plain HTTP, and the reason is the transport
   * rather than a preference: the request to it is written *inside* the CONNECT
   * tunnel (`requestThroughTunnel`), where CrystalOS speaks unencrypted HTTP to
   * whatever the proxy connected to. An https URL would be a TLS port, so the
   * request would be plaintext at a handshake and fail with a message no one
   * could act on. Accepting it and failing later would be worse than saying so
   * here.
   */
  let checkUrl = "";
  if (input.checkUrl !== undefined && input.checkUrl !== null && String(input.checkUrl).trim() !== "") {
    checkUrl = readOptionalString(input.checkUrl, { max: MAX_CHECK_URL, label: "The exit check URL" });
    let parsed;
    try {
      parsed = new URL(checkUrl);
    } catch {
      throw new EndpointError("Enter a full http:// address that returns your address, for example http://check.example.net/ip.");
    }
    if (parsed.protocol !== "http:") {
      throw new EndpointError(
        "The exit check URL must start with http:// — it is fetched through the tunnel, so it cannot be a TLS address.",
      );
    }
  }

  return { host, port, scheme, name, username, password, checkUrl, country };
}

/** The non-secret view. Never carries a username, a password or a check URL. */
export function describeEndpoint(endpoint) {
  if (!endpoint) return null;
  return {
    name: endpoint.name,
    host: endpoint.host,
    port: endpoint.port,
    scheme: endpoint.scheme,
    authenticated: Boolean(endpoint.username),
    hasCheckUrl: Boolean(endpoint.checkUrl),
    country: endpoint.country || null,
  };
}

function normaliseStored(value) {
  const provider = value?.provider === PROVIDER.manual ? PROVIDER.manual : PROVIDER.proton;
  let endpoint = null;
  if (value?.endpoint) {
    try {
      endpoint = normaliseEndpoint(value.endpoint);
    } catch {
      // A file edited by hand into something invalid means "no endpoint",
      // which is recoverable from the UI. It must never stop the backend.
      endpoint = null;
    }
  }
  return { provider, endpoint, updatedAt: Number(value?.updatedAt) || Date.now() };
}

/**
 * The stored provider choice and endpoint.
 *
 * `save` validates before writing, so an invalid endpoint can never reach the
 * disk and come back at boot as a confusing failure.
 */
export function createEndpointStore({ file = defaultEndpointFile() } = {}) {
  let cached = null;
  let loaded = false;
  const empty = { provider: PROVIDER.proton, endpoint: null, updatedAt: null };

  async function load() {
    if (loaded) return cached;
    loaded = true;
    try {
      cached = normaliseStored(JSON.parse(await readFile(file, "utf8")));
    } catch {
      cached = { ...empty };
    }
    return cached;
  }

  async function save(next) {
    const provider = next?.provider === PROVIDER.manual ? PROVIDER.manual : PROVIDER.proton;
    const endpoint = next?.endpoint ? normaliseEndpoint(next.endpoint) : null;
    const value = { provider, endpoint, updatedAt: Date.now() };
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temporary, file);
    // Windows ignores mode on create; chmod is best-effort there and exact on
    // POSIX, where this file would otherwise be world-readable.
    await chmod(file, 0o600).catch(() => undefined);
    cached = value;
    loaded = true;
    return value;
  }

  async function clear() {
    cached = { ...empty };
    loaded = true;
    await rm(file, { force: true }).catch(() => undefined);
  }

  return {
    file,
    load,
    save,
    clear,
    current: () => cached,
    /** Non-secret facts, safe for an API response. */
    async describe() {
      const value = await load();
      return {
        provider: value.provider,
        endpoint: describeEndpoint(value.endpoint),
        hasEndpoint: Boolean(value.endpoint),
        updatedAt: value.updatedAt,
      };
    },
  };
}
