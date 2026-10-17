# Hoxx VPN — why CrystalOS does not use it

**Status: Hoxx is not part of CrystalOS, and none of its code, servers or
credentials are used. The vendored extension and the capture scripts were
removed from this repository on 2026-10-17 for licence compliance (see
"Removed" below).**

## What the investigation concluded

Hoxx VPN Proxy (3.50.6, MV3) is an ordinary HTTP proxy driven by
`chrome.proxy.settings`, authenticated with short-lived credentials
(`p_login`/`p_token`) that its server mints per account.

* **The account-free path is a guest account, and it is server-minted.**
  `POST /api3/r/guest` creates one. Every `/api3/*` call is gated by a
  per-request signature produced inside the extension's obfuscated TinyGo
  WebAssembly module; a third-party client cannot produce that signature.
* **The paid tier is a server-issued entitlement** (`config.user_premium`, a
  timestamp compared against the server's clock), not a client flag. It is not
  unlocked here, and unlocking it was never attempted — doing so would mean
  forging entitlement against Hoxx's servers rather than changing a local
  setting.
* **No part of Hoxx's client was vendored.** Shipping `js/main.wasm` would have
  made the transport depend on a deliberately obfuscated binary that its author
  can invalidate at will.

The account-free transport CrystalOS actually ships comes from somewhere else
entirely: a user-supplied HTTPS CONNECT endpoint, plus an automatically
scanned pool of *public* proxies (`server/vpn/proxies.mjs`), each proven with a
real certificate-verified TLS handshake before it is offered. That work is
unrelated to Hoxx and is described in
[VPN-INTEGRATION-FINDINGS.md](VPN-INTEGRATION-FINDINGS.md).

## Removed, and why

The Hoxx End-User License Agreement states, at 2:

> you are not permitted to distribute, transmit, sublicense, permitted to
> tamper with or attempt to bypass, modify, defeat or otherwise circumvent the
> operation of the software or alter, adapt, translate, reverse engineer,
> decompile, disassemble or otherwise attempt to discover or disclose the
> source code or underlying programming or architecture.

and, under "Restrictions and Prohibition", prohibits distribution of the
Software and of "content associated with the Software".

Keeping the extracted extension, the captured server catalogue and the
reverse-engineering scripts in this repository is therefore not permitted,
whether or not any of it is executed. The following were deleted:

* `hoxxvpn/` — the extracted proprietary extension, including
  `assets/servers.json` (its base-host catalogue) and the obfuscated
  `js/main.wasm`.
* `.tmp-hoxx-*.mjs` and `.tmp-hoxx-*.json` — the recovered wire-format
  reimplementation, the captured live API responses and the catalogue dumps.

This changes no behaviour: no shipped file imported or executed any of it. The
removal is recorded in the git history, which is where the reasoning above
lives now.
