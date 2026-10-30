import { Readable } from "node:stream";

const ALLOWED_DOMAINS = ["duckduckgo.com", "duck.com"];
const BLOCKED_HEADERS = new Set([
  "accept-encoding",
  "connection",
  "content-length",
  "cookie",
  "host",
  "transfer-encoding",
]);

function isAllowedHost(hostname) {
  const host = String(hostname).toLowerCase();
  return ALLOWED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function jsonError(res, status, error) {
  const body = JSON.stringify({ ok: false, error });
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Same-origin fallback for DuckDuckGo when the Render Wisp TCP route cannot
 * complete its TLS handshake. The host allowlist keeps this from being an
 * open proxy; upstream cookies are passed only when Scramjet supplies them.
 */
export async function handleDuckDuckGoRelay(req, res, url) {
  const method = String(req.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "POST"].includes(method)) {
    jsonError(res, 405, "METHOD_NOT_ALLOWED");
    return true;
  }

  let target;
  try {
    const raw = url.searchParams.get("url") ?? "";
    if (!raw || raw.length > 12_000) throw new Error("invalid URL length");
    target = new URL(raw);
  } catch {
    jsonError(res, 400, "INVALID_TARGET");
    return true;
  }
  if (
    target.protocol !== "https:" ||
    !isAllowedHost(target.hostname) ||
    target.username ||
    target.password ||
    (target.port && target.port !== "443")
  ) {
    jsonError(res, 403, "TARGET_NOT_ALLOWED");
    return true;
  }

  const headers = new Headers();
  const upstreamCookie = req.headers["x-crystal-upstream-cookie"];
  const upstreamUserAgent = req.headers["x-crystal-upstream-user-agent"];
  for (const [name, rawValue] of Object.entries(req.headers)) {
    if (rawValue === undefined) continue;
    const key = name.toLowerCase();
    if (
      BLOCKED_HEADERS.has(key) ||
      key.startsWith("cf-") ||
      key.startsWith("x-forwarded-") ||
      key.startsWith("x-crystal-upstream-") ||
      key === "x-real-ip"
    ) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) headers.append(name, String(value));
  }
  if (upstreamCookie) headers.set("cookie", String(upstreamCookie));
  if (upstreamUserAgent) headers.set("user-agent", String(upstreamUserAgent));

  try {
    const init = { method, headers, redirect: "manual" };
    if (method !== "GET" && method !== "HEAD") {
      init.body = Readable.toWeb(req);
      init.duplex = "half";
    }
    const upstream = await fetch(target, init);
    const cookies = upstream.headers.getSetCookie?.() ?? [];
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("set-cookie");
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.delete("transfer-encoding");
    if (cookies.length) responseHeaders.set("x-crystal-upstream-set-cookie", JSON.stringify(cookies));
    responseHeaders.set("cache-control", "no-store");

    res.writeHead(upstream.status, upstream.statusText, Object.fromEntries(responseHeaders));
    if (method === "HEAD" || !upstream.body) {
      res.end();
      return true;
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch {
    jsonError(res, 502, "DUCKDUCKGO_UPSTREAM_FAILED");
  }
  return true;
}
