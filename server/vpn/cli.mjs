#!/usr/bin/env node
/*
 * CrystalOS — `npm run vpn`
 *
 * The zero-config entry point. It talks to the running CrystalOS backend (the
 * same one `npm run dev` starts), asks it to find a working public proxy and
 * connect, then prints exactly what the backend observed — the exit address it
 * really measured, or that it could not measure one.
 *
 * It deliberately does not start a second backend or invent a server: the VPN
 * lives in the backend that is already serving the OS, because that is where
 * CrystalOS's proxied traffic leaves from.
 *
 *   npm run vpn                     find a server and connect
 *   npm run vpn -- --country DE     connect through a specific country
 *   npm run vpn -- --canary host    prefer exits that can reach `host` (default: the
 *                                   search engine, so search never lands on a blank page)
 *   npm run vpn -- --off            disconnect
 *   npm run vpn -- --status
 */

import process from "node:process";
import { backendOrigin, probeBackend } from "../health.mjs";

const ORIGIN = backendOrigin();
const argv = process.argv.slice(2);
const wantsOff = argv.includes("--off") || argv.includes("disconnect");
const wantsStatus = argv.includes("--status");

/** `--name value` or `--name=value`. */
function readOption(name) {
  const withEquals = argv.find((argument) => argument.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  const index = argv.indexOf(`--${name}`);
  const next = index === -1 ? null : argv[index + 1];
  return next && !next.startsWith("--") ? next : null;
}

const country = (readOption("country") ?? "").trim().toUpperCase();
/** The default canary is the browser's default search engine. */
const canary = readOption("canary") ? [readOption("canary")] : ["duckduckgo.com"];

const bold = (text) => `\u001b[1m${text}\u001b[22m`;
const dim = (text) => `\u001b[2m${text}\u001b[22m`;
const green = (text) => `\u001b[32m${text}\u001b[39m`;
const yellow = (text) => `\u001b[33m${text}\u001b[39m`;
const red = (text) => `\u001b[31m${text}\u001b[39m`;

function say(message = "") {
  process.stdout.write(`${message}\n`);
}

async function callBackend(path, { method = "GET", body = null } = {}) {
  const response = await fetch(`${ORIGIN}${path}`, {
    method,
    headers: method === "POST" ? { "content-type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message ?? `The backend answered ${response.status}.`;
    throw new Error(message);
  }
  return payload;
}

function describe(payload) {
  const status = payload?.status ?? "unknown";
  const provider = payload?.provider ?? "unknown";
  const server = payload?.server;
  const tunnel = payload?.verified?.tunnel;
  const egress = payload?.verified?.egress;

  say(`${bold("Status:")}   ${status === "connected" ? green(status) : status}`);
  say(`${bold("Provider:")} ${provider === "manual" ? "automatic public proxy" : provider}`);
  if (server) {
    const where = server.exitCountry ? ` ${dim(`(${server.exitCountry})`)}` : "";
    say(`${bold("Server:")}   ${server.proxyHost}:${server.proxyPort}${where}`);
  }
  if (tunnel) {
    say(`${bold("Tunnel:")}   ${tunnel.ok ? green("confirmed") : red("not established")} — ${tunnel.detail ?? ""}`);
  }
  if (egress) {
    if (egress.conclusive && egress.ok) {
      say(`${bold("Exit IP:")}  ${green(egress.exitIp ?? "unknown")} ${dim(`(direct was ${egress.directIp})`)}`);
    } else if (egress.conclusive) {
      say(`${bold("Exit IP:")}  ${red("unchanged")} ${dim(egress.reason ?? "")}`);
    } else {
      say(`${bold("Exit IP:")}  ${yellow("not measured")} ${dim(egress.reason ?? "")}`);
    }
  }
  if (payload?.error) {
    say(`${bold("Error:")}    ${red(payload.error.code)} — ${payload.error.message}`);
  }
}

const WARNING = [
  dim("  Heads up: these are public proxies, not a vendor's VPN servers. CrystalOS"),
  dim("  tunnels them as opaque CONNECT tunnels, so a site's own TLS is never"),
  dim("  readable or forgeable by the exit — but a hostile exit can still see which"),
  dim("  host names you visit, and public proxies are unreliable. For anything"),
  dim("  sensitive, use Proton VPN or an endpoint you control."),
].join("\n");

async function main() {
  const backend = await probeBackend(ORIGIN);
  if (!backend) {
    say(red(`No CrystalOS backend is answering on ${ORIGIN}.`));
    say(dim("Start the OS first with `npm run dev`, then run `npm run vpn` again."));
    process.exitCode = 1;
    return;
  }

  if (wantsStatus) {
    describe(await callBackend("/api/vpn"));
    return;
  }

  if (wantsOff) {
    describe(await callBackend("/api/vpn/disconnect", { method: "POST" }));
    say(green("Disconnected."));
    return;
  }

  if (country && !/^[A-Z]{2}$/.test(country)) {
    say(red(`"${country}" is not a two-letter country code (for example DE or US).`));
    process.exitCode = 1;
    return;
  }

  say(
    dim(
      country
        ? `Finding a working public proxy in ${country} that can reach ${canary.join(", ")}…`
        : `Finding a working public proxy that can reach ${canary.join(", ")}…`,
    ),
  );
  const body = { canary };
  if (country) body.country = country;
  const payload = await callBackend("/api/vpn/quick-connect", { method: "POST", body });
  say();
  describe(payload);
  say();
  if (payload?.status === "connected") {
    say(green("Connected. CrystalOS's proxied browsing now exits through it."));
  } else {
    say(yellow("Not connected — see the error above."));
  }
  say();
  say(WARNING);
}

try {
  await main();
} catch (error) {
  say(red(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
