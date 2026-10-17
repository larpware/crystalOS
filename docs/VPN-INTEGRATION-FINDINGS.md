# Proton VPN integration — implementation and verification report

**Status: implemented and verified as far as this machine's credentials allow. The
transport, the routing, the fail-closed behaviour and every UI surface are tested.
A real connected session has NOT been exercised, because no Proton credentials
exist on this machine. §8 says exactly which claims are verified and which are not.**

This document replaces the earlier audit, which concluded the integration was
impossible. That conclusion was wrong: the Proton VPN extension **is** present in
the repository (`protonvpnextension/`), and its source describes a connection
mechanism this architecture can actually speak — an authenticated HTTPS `CONNECT`
proxy on the VPN server. What follows records what was found, what was built, and
what has been proven.

---

## 1. What was found

| Component | Finding |
| --- | --- |
| Runtime | `index.html` → React 19 + Vite web app. No Electron, no Chromium extension host, no `chrome.*` APIs anywhere in `src`. |
| Proxied browsing | `server/scramjet/index.js` — a Node backend serving `/wisp/` (WebSocket), `/scram`, `/controller`, `/clients`, plus the accounts API. Transport: **libcurl**. |
| Proton extension | `protonvpnextension/` — a real MV3 WebExtension with TypeScript source, `manifest.permissions: ["proxy", …]`. |
| REA | `reverse-engineer-anything/rea-rea-agents-6.5.0` — a TypeScript static-analysis framework driven through a documented CLI. |
| Request path | browser frame → Scramjet service worker → Wisp WebSocket → **the Node backend** → the site. |

The last line is the whole design problem, and also the answer: because the
backend is what dials sites, a VPN applied *in the backend* covers proxied
traffic, while a VPN in the browser page could not.

## 2. What REA was used for, and what it could not do

REA was run through its own documented interface against the extension's source
directory (`analyze_javascript_application`, subject `protonvpnextension/source`),
producing a signed evidence bundle and a summary projection (artifacts in
`.tmp-logs/rea-ext-evidence.json`, `.tmp-logs/rea-summary.txt`).

What it reported:

* 323 relevant files, 281 parsed JavaScript files, 63,628 AST nodes, 2,914
  findings, **0 parse failures**.
* Semantic families: `data-flow` 26,714 retained relations, `closure` 3,981,
  `object-flow` 2,998, `call-flow` 1,704, `timer` 27, `configuration` 1,
  `request` **6** — with 12,467 semantic unknowns.
* Electron section all zero: **0 preload entrypoints, 0 contextBridge APIs, 0 IPC
  operations, 0 native-addon bindings.**

That negative result was the useful one. The extension has **no native messaging
host and no out-of-process component**, which is what ruled out the whole
"install a Proton client and drive it" family of designs.

What REA explicitly cannot do (its own 17 declared limitations, not my
interpretation): it parses JavaScript as **inert text**, never executes bundle
bootstrap code, and states that "static imports, entrypoints, workers, endpoints
and storage relationships do not prove runtime execution". It therefore could not
confirm how the extension behaves at run time, and its request extraction was too
thin (6 relations) to be the source of the endpoints.

**So the endpoints, headers and credential contract were read directly from the
extension's TypeScript source**, and REA's bundle was used as corroboration and to
establish the negative facts above. REA is a development aid here; the running
integration does not depend on it.

## 3. The real connection mechanism

`protonvpnextension/source/js/` declares it plainly:

* `tools/proxy.ts` builds a `fixed_servers` proxy config with `scheme: 'https'`
  pointing at the selected server on port **4443** (**443** for Secure Core).
* `vpn/getBasicAuth.ts` attaches pre-emptive Basic auth.
* `account/credentials/getConnectionCredentials.ts` calls
  `GET vpn/v1/browser/token?Duration=N`, which returns
  `{ Code, Expire, Username, Password }` — the short-lived proxy credentials.
* `account/credentials/getCredentialsData.ts` / `storedCredentials.ts` keep them
  until `Expire`.

So Proton's browser VPN is: **an HTTPS proxy on the VPN server, reached with
short-lived credentials minted for your session, authenticating each request with
Basic auth.** No native driver, no WireGuard config, no elevated privileges.

That is precisely what a server-side integration can speak — and it is the reason
this integration protects proxied traffic and not the whole device. Proton itself
scopes it to the browser; Crescent scopes it to the traffic Crescent proxies.

## 4. Architecture of the implementation

The tunnel is established **per proxied stream**, in the backend, at the moment a
stream is dialled, so a settings change affects the next request rather than the
process's lifetime.

```
Crescent Browser / Drive / Spotify … (proxied)
        │  Scramjet service worker → Wisp WebSocket
        ▼
backend  /wisp/  ──►  createRoutedTCPSocket.decide(host, port)
                          ├─ block   → refuse the stream          (fail closed)
                          ├─ direct  → dial the target            (VPN off)
                          └─ proxy   → TLS to VPN server :4443
                                        CONNECT host:port + Basic auth
                                        → opaque byte pipe
```

| File | Responsibility |
| --- | --- |
| [config.mjs](server/vpn/config.mjs) | Proton endpoints, app version header, ports. |
| [proton.mjs](server/vpn/proton.mjs) | The four Proton calls; `redact()`; never logs a token. |
| [session.mjs](server/vpn/session.mjs) | Session + token storage, owner-only file, never returned by any API. |
| [servers.mjs](server/vpn/servers.mjs) | Logicals → connectable servers; only tiers 0–2 offer the browser proxy. |
| [tunnel.mjs](server/vpn/tunnel.mjs) | `openConnectTunnel`, `requestThroughTunnel`, body/chunked decoding, header reader, the routed wisp socket. |
| [controller.mjs](server/vpn/controller.mjs) | The one state machine: connect/disconnect/reconnect, enforcement, verification, coverage. |
| [api.mjs](server/vpn/api.mjs) | `/api/vpn/*` — status, servers, connect, disconnect, reconnect, verify, settings, session, diagnostics. |
| [Vpn.tsx](src/apps/vpn/Vpn.tsx) | The application window. |
| [pages/vpn.tsx](src/apps/settings/pages/vpn.tsx) | Settings → VPN (summary + protection matrix). |
| [QuickSettings.tsx](src/shell/QuickSettings.tsx) | The shell tile. |
| [Browser.tsx](src/apps/browser/Browser.tsx) | Toolbar VPN indicator. |
| [state/vpn.ts](src/state/vpn.ts), [client.ts](src/services/vpn/client.ts) | Store + API client. |
| [coverage.ts](src/services/vpn/coverage.ts) | Derives what is protected from real facts — never a claim. |

## 5. Scramjet interaction

* **Scramjet on, VPN off (default):** every stream is `direct`. Nothing changes
  from before; browsing is unaffected.
* **Scramjet on, VPN wanting but not up:** every stream is `block`, *if*
  "Block unprotected traffic" is on (it is on by default). Requests are refused
  rather than sent directly.
* **Scramjet on, VPN connected:** every stream is `proxy` — the CONNECT tunnel.
* **Scramjet off, VPN off:** the tab loads directly through `DirectPane` and says
  so. No protection is claimed.
* **Scramjet off, VPN wanting but not up:** the tab is **refused**. A web page
  cannot set a proxy for itself, so a direct load could not be tunnelled — and
  rather than quietly serve it unprotected, the tab renders a *"Blocked by the
  VPN"* pane with no frame at all, and three real ways out: *Use Scramjet*,
  *Open Proton VPN*, *Turn the VPN off*. Verified live: `frames: 0`.
* **UDP:** Wisp datagram streams are refused while enforcing, because a CONNECT
  tunnel cannot carry QUIC. This is a deliberate refusal, not a silent leak;
  Scramjet falls back to TCP.
* **Host applications:** out of scope, reported as such.

The distinction that matters: *"Unprotected"* is what the coverage matrix uses to
describe a path a connection **cannot** cover; refusal is what happens when such
a path is attempted while enforcement is on. The two are never blurred.

## 6. Security properties

* The hop to Proton is certificate-verified (`rejectUnauthorized` stays `true`);
  a test asserts an untrusted certificate is refused, so verification cannot be
  quietly relaxed to make a connection succeed.
* End-to-end TLS to each site is untouched: the tunnel is an opaque byte pipe and
  Crescent neither terminates nor inspects the session.
* Session tokens are stored server-side with owner-only permissions, are never
  returned by any API, and are never written to `localStorage`.
* No route returns a credential; the only session facts leaving the process are
  `{ signedIn, uid }`.
* Mutating routes are same-origin only, and the body is size-limited and parsed
  once.
* A wrong URL is treated as unreachable rather than as a VPN state, so a broken
  client cannot render as "disconnected" and look healthy.

## 7. Bugs found and fixed during live verification

These were found by running the app, not by reading it. Each is fixed and pinned
by a test.

1. **Every VPN call but one went to the wrong API prefix.** The shared client
   defaults to the accounts base, so `POST /api/vpn/session` was sent to
   `/api/accounts/session`, 404'd in the real UI, and surfaced as "the server is
   not reachable". Fixed with a single `vpnRequest` helper; `client.test.mjs`
   now asserts all 11 request lines.
2. **Chunked responses were returned as framing garbage.** A real HTTP/1.1
   response without `content-length` arrives chunked, so the exit-IP check would
   have parsed `35\r\n{"IP":…}\r\n0\r\n\r\n` as "not JSON". A decoder for both
   `content-length` and `transfer-encoding: chunked` was added, and the real-TLS
   test splits the framing across several writes.
3. **The header reader dropped bytes that arrived after the handshake but before
   the consumer took over.** The CONNECT reply resolves its promise a tick before
   the caller resumes; a payload inside that window vanished. That is the same
   class of bug as losing the coalesced bytes, and now both are buffered and
   replayed.
4. **A failed connection could not be turned off.** The primary action was gated
   on a session, so a wanted-but-down VPN left proxied browsing blocked with no
   in-window escape — which makes weakening enforcement look like the only way
   out. The button now offers **Turn off VPN** with an explicit explanation.

## 8. Verdict per requirement

### Verified working

| Claim | Evidence |
| --- | --- |
| Build, typecheck, tests | `npm run typecheck` clean; `npm test` **207/207 pass** (78 pre-existing + 129 new); `npm run build` exit 0. |
| The CONNECT contract matches Proton's | Real TLS proxy on loopback: correct request line, `Host`, and Basic `Proxy-Authorization` observed **on the wire**. |
| The tunnel keeps all bytes | Real-TLS tests: bytes coalesced with the CONNECT reply survive; a round trip through the tunnel returns what was sent; an untrusted certificate is refused. |
| A rejected credential is not retried forever | 407 from the proxy → "rejected these credentials", no retry loop. |
| The app really talks to Proton | Storing a session then connecting produced **HTTP 401 `{"Code":401,"Error":"Invalid access token"}`**, independently reproduced with `curl` against `account.proton.me/api/vpn/v2/logicals` using the client's own headers. Mapped to `SESSION_EXPIRED`, session cleared. |
| Fail-closed routing, end to end | Through the real browser: the backend logged `creating a stream to example.com:443 failed - Error: The VPN is not connected. This request was blocked rather than sent unprotected.`; the page failed with libcurl error 7 and served 500. **Nothing was sent unprotected.** |
| Browsing is unaffected when the VPN is off | The same page then loaded through Scramjet and rendered `Example Domain`, with a complete TLS handshake and bidirectional data in the backend trace. |
| A direct tab is refused, not quietly served, while enforcing | Live: with Scramjet switched off and the VPN wanted-but-down, the tab rendered the *"Blocked by the VPN"* pane with **no iframe in the DOM** (`frames: 0`), and the toolbar indicator read `VPN: Proton rejected this session. Sign in again.` / `Proxied tabs: disabled.` |
| Turning the VPN off restores browsing | Verified live; `enabled` went false and coverage returned to `unprotected`. |
| Guard paths | Live: no-session connect → `SIGN_IN_REQUIRED` + blocked; cross-origin write → 403; `text/plain` → 415; session without a refresh token → 400; malformed JSON → 400; unknown route → 404. |
| UI surfaces exist and report the truth | Launcher entry; VPN window (per-path Blocked/Unprotected badges, transport explanation, session form, verification, diagnostics); Settings → VPN; Quick Settings tile; Browser toolbar `VPN: VPN off` and `Proxy: Proxied · libcurl`. |
| The host is not turned into a system VPN | Nothing touches host networking; the tunnel exists only inside the backend process. |

### Implemented but NOT verified with real credentials

These require a Proton account, which this machine does not have. The code paths
exist and are unit-tested, but they have not been run against Proton.

* A successful connection: fresh credentials → `200` on CONNECT → tunnel up.
* The "connected" state, its exit-IP verification, and the server catalogue
  (`/api/vpn/servers` correctly returned `SERVER_LIST_UNAVAILABLE: Invalid access
  token` rather than an invented list).
* Proxied traffic actually exiting through Proton — the routing decision is
  tested, the tunnel is tested against a real TLS proxy, but the two have not been
  joined with valid Proton credentials.

### Not supported, by design and stated as such

* The shell's own requests (favicons and similar page-origin fetches): a web page
  cannot set a proxy for itself. Shown as **Unprotected**.
* A Crescent Browser tab loaded directly: **cannot** be tunnelled, so while
  enforcing it is refused (see §5) and otherwise it is labelled as loaded without
  the proxy.
* Other applications and the host's own browser: **Outside Crescent**.
* UDP/QUIC while enforcing: refused rather than leaked.

## 9. How to run it

```bash
npm install
npm run dev          # shell on http://127.0.0.1:5273, backend on 127.0.0.1:8787
```

Backend only: `npm run scramjet`. Ports/storage are configurable with
`CRESCENT_PORT`, `CRESCENT_VITE_PORT`, `CRESCENT_VPN_SESSION_FILE`.

To exercise the connected path you need a real Proton session:

1. Sign in at `account.proton.me` in a browser.
2. Take the `x-pm-uid` cookie and the `AUTH-<uid>` / `REFRESH-<uid>` cookie values.
3. Paste them into **Proton VPN → Proton account → Save session**.
4. Press **Connect**, then **Check exit address**.

Run the VPN tests alone:

```bash
node --test server/vpn/*.test.mjs src/services/vpn/*.test.mjs
```

## 10. Remaining work

* **One real connected run.** Everything above the CONNECT 200 is unverified, and
  that is the only meaningful gap.
* Session storage is a file with owner-only permissions. Encrypting it at rest
  (or moving it behind a keyring) is a real improvement, not a requirement of the
  current design.
* The transport cannot serve UDP, so anything QUIC-only will be refused while
  enforcing. That is correct behaviour, but it is worth surfacing per site rather
  than only in the aggregate.

## 11. Limits of this verification

* Screenshots were unavailable in this preview webview (it reported no composited
  frames), so the UI was verified through the accessibility tree, DOM inspection
  and network/console logs rather than visually.
* The extension was analysed statically. Its runtime behaviour was not observed,
  because there is no extension host in this runtime — which is also why the
  integration speaks the extension's *transport*, not the extension itself.

## 12. The Hoxx VPN app and the account-free (manual) provider

The provider layer was generalised so Proton is only one thing that can sit at the
end of the CONNECT client. This ships as a **separate** "Hoxx VPN" application,
and it is the provider the Crescent Browser uses by default.

* **Provider model.** `server/vpn/endpoint.mjs` stores either `provider: "proton"`
  or `provider: "manual"`. The manual provider takes a `host`, `port`, `scheme`
  (`https`|`http`) and optional Basic credentials, validates them
  (`normaliseEndpoint`), and dials them with the same certificate-verified
  CONNECT client. No account, session or vendor API is involved: the endpoint the
  user types *is* the configuration.
* **API.** `POST /api/vpn/provider`, `POST|DELETE /api/vpn/endpoint`, and
  `POST /api/vpn/endpoint/test`. The test route (`api.mjs`) opens a real CONNECT
  to a fixed probe target (`example.com:443`, `MANUAL_PROBE_TARGET`) and reports
  the proxy's own reply — it deliberately does not touch controller state, so
  testing never turns the VPN on or changes the provider.
* **App.** `src/apps/hoxx/HoxxVpn.tsx` — endpoint form, "Test connection", the
  primary connect/disconnect action (which sets the provider to `manual` first so
  it can never silently tunnel through Proton), the per-path coverage matrix and
  the two verification checks. Because an endpoint has no catalogue, the app's
  "server list" is the CONNECT probe instead of a `/servers` fetch.
* **Browser integration.** `providerAppId(null)` → `"hoxx"` and
  `providerName(null)` → `"Hoxx"`, so the toolbar indicator, Quick Settings tile
  and Settings → VPN page name Hoxx and open the Hoxx app when no provider has
  been chosen; they follow the active provider otherwise.
* **Premium.** Not unlocked, and stated so in the app's own "How this works"
  section. Hoxx's paid tier is a server-issued entitlement (`user_premium`), not
  a client flag; see [HOXX-VPN-FINDINGS.md](HOXX-VPN-FINDINGS.md).

### Verified live (runtime, this machine)

* The full manual surface over the real HTTP API through the Vite proxy:
  `POST /api/vpn/provider` `{provider:"manual"}` → `provider: "manual"`;
  `POST /api/vpn/endpoint` → endpoint stored and `transport.kind` became
  `custom-http-proxy`; `POST /api/vpn/endpoint/test` against a loopback CONNECT
  proxy returned `{ ok: true, ms: 238, detail: "127.0.0.1:13652 accepted a CONNECT." }`.
* `POST /api/vpn/connect` → `status: "connected"`, `verified.tunnel.ok: true`,
  `coverage.scramjetTraffic: "protected"`, and the proxy log recorded
  `CONNECT example.com:443` — the probe target on the wire, both for the test and
  for the connect. With no exit-check URL, egress stayed honestly
  `conclusive: false`.
* The Hoxx window rendered the live `connected` state (endpoint, tunnel
  `Confirmed`, exit address `Unknown`), the Quick Settings tile read **Hoxx VPN**,
  Settings → VPN showed the Hoxx provider/endpoint rows and both app links, and
  the Crescent Browser toolbar tooltip read
  *"…open Hoxx VPN settings."*
* Clearing the endpoint returned the backend to `provider: "proton"`,
  `endpoint: null`, `status: "disconnected"`.

## 13. Zero-config connect (the automatic free-proxy pool)

A "no account" VPN that still asks a student to find a host, a port and
credentials is not really zero-config. `server/vpn/proxies.mjs` closes that gap
without inventing a server.

* **Discovery.** `createProxyPool()` fetches several public lists of free HTTP
  CONNECT proxies (`DEFAULT_PROXY_SOURCES`), parses each line
  (`parseProxyLine`, which tolerates a scheme prefix, `user:pass@` credentials
  and bracketed IPv6, and *drops* anything malformed rather than guessing), and
  de-duplicates on `host:port`.
* **Proof, not trust.** Every candidate is opened as a real CONNECT to
  `example.com:443`, bounded and concurrent; only proxies that answered are kept.
  `findBest({ count })` returns them ranked fastest-first. With no survivor it
  returns `endpoint: null` plus a reason — never a fabricated server.
* **Resilience to a flaky pool.** `controller.quickConnect()` tries the ranked
  survivors in order, because a public proxy routinely passes the health test and
  then dies before the real connect. A stored endpoint is used first; if it no
  longer answers, the click falls through to a fresh scan instead of ending in an
  error. Each attempt is saved as the active `manual` endpoint, so the whole
  existing surface — routing, coverage, verification — is untouched.
* **Surfaces.** The Hoxx app's hero becomes **Quick connect** when no endpoint is
  stored (`src/apps/hoxx/HoxxVpn.tsx`); `POST /api/vpn/quick-connect` is the
  route; and `npm run vpn` (`server/vpn/cli.mjs`) is the one-command form, with
  `npm run vpn -- --status` and `npm run vpn -- --off`.
* **Honesty.** Public proxies are not a vendor's servers, and both the app's
  "How this works" list and the CLI print that trade: an exit can see *which*
  hosts are visited, but not read or forge a site's traffic, because Crescent
  opens opaque CONNECT tunnels and the browser verifies the site's TLS
  end-to-end. Exit addresses are measured (`verified.egress`) or reported
  `unknown`, never assumed.

### Verified live (runtime, this machine)

* `npm run vpn` against the running backend: discovery found a working proxy,
  `status: "connected"`, `provider: "manual"`, tunnel `confirmed`.
* `npm run vpn -- --status` reported a **measured, different exit**:
  `exitIp 198.199.86.11` while `directIp 43.231.28.128` — the first run — and
  `exitIp 102.244.78.57` (proxy `102.244.78.61:8087`) on a later run, i.e. the
  exit address really changed.
* The dead-stored-endpoint fallback: after a restart hydrated a public proxy that
  had since expired, `npm run vpn` did not fail — it re-scanned and connected to a
  fresh one (`102.244.78.61:8087`), confirming both the retry and the fallback.
* The Hoxx window rendered **Quick connect** when no endpoint was stored, showed
  **Finding a server…** while the scan ran, and the same action reached the same
  backend route the CLI uses.

## 14. Exit countries, and why proxied pages went blank

A field report — "with the VPN on, searching gives a blank page" — resolved into
two real bugs, both fixed.

### 14.1 A CONNECT is not a connection

The blank page was not a Scramjet fault. DuckDuckGo is Crescent's default search
engine, and the proxy the pool had auto-selected (`102.244.78.61:8087`) accepted a
CONNECT to `duckduckgo.com:443` and then never carried the TLS stream — the Wisp
log showed the handshake failing *after* the CONNECT. A CONNECT-only scan passes
that proxy, because the CONNECT is all it ever checked. Measured across 30
candidates, DuckDuckGo was reachable through 2 and Google through 4: the fault is
per-proxy, not a blanket block.

A second, worse failure mode surfaced while fixing it. The DE exit the pool chose
(`47.91.65.23:3128`) **intercepted TLS**: it presented a self-signed certificate
chain for `www.google.com` and `example.com`, while the same sites were validly
certified on a direct connection (`Google Trust Services`, `SSL Corporation`). A
CONNECT-only check cannot tell a dead exit or a MITM proxy from a good one.

### 14.2 The fix: prove TLS, and prefer an exit that reaches the search engine

* `tunnel.verifyTlsThroughProxy()` dials the tunnel and then completes an ordinary
  TLS handshake with `rejectUnauthorized: true` against the target's own name. A
  proxy that cannot present a genuine certificate fails it and is never offered.
* `createProxyPool()` probes through that function (the `probe` is injectable, so
  the tests stay offline), and `controller.connectManual()` uses it too — so a
  *stored* endpoint that starts black-holing or intercepting is caught at connect
  time, not just at scan time, and `quickConnect()` falls through to a fresh scan.
* `quickConnect({ canary })` takes the caller's search-engine host: survivors that
  can *also* carry verified TLS to it rank first, and the result reports how many
  could (`canaryOk`) — a search box is chosen against rather than into.

### 14.3 Exit countries

`server/vpn/countries.mjs` holds the picker's list; `countrySources(code)` queries
country-filtered sources (`proxyscrape`, `geonode`). `quickConnect({ country })`
scans only that country, tags the stored endpoint with it, and records it in
`snapshot.preference`. A stored endpoint is reused only when it already answers
the same country, so asking for Japan after connecting to the US rescans instead
of quietly returning the US. A malformed code is `400 INVALID_COUNTRY`, never a
worldwide scan. The Hoxx app exposes it as a picker beside the connect button
(`GET /api/vpn/countries`).

### 14.4 What still cannot be done

The VPN covers traffic the **backend** dials — i.e. Crescent's proxied
(Scramjet/Wisp) traffic. A tab loaded "without the proxy" is fetched by the
browser itself, and a web page cannot set a system proxy, so it cannot be
tunnelled. That is a browser-sandbox limit, not an unfinished feature; the
coverage map already states `hostApplications: out-of-scope`.

### Verified live (runtime, this machine)

* `GET /api/vpn/countries` → 31 entries led by `(any)=Fastest anywhere`; the Hoxx
  picker rendered all 31 and disabled itself while connected.
* `POST /api/vpn/quick-connect { country: "USA" }` → `400 INVALID_COUNTRY`.
* `POST /api/vpn/quick-connect { country: "DE", canary: ["duckduckgo.com"] }` →
  connected in ~19s to `194.163.175.167:40001` (country `DE`),
  `snapshot.preference.country = "DE"`, and
  `verified.tunnel` = *"carried a verified TLS session"*.
* TLS through that exit matched the direct connection: `duckduckgo.com` →
  `DigiCert Inc`, `www.google.com` → `Google Trust Services` — no interception.
* The exact omnibox request through the exit returned `HTTP/1.1 200 OK`,
  27,427 bytes of real DuckDuckGo HTML, cert `CN=*.duckduckgo.com` → **search page
  loaded**, not blank.
* `POST /api/vpn/verify` → `conclusive: true`, `matches: false`,
  `exitIp 194.163.175.167` vs `directIp 43.231.29.188` — the exit address really
  changed.
* The MITM absolute control: direct TLS to `www.google.com` → `Google Trust
  Services`; through the previously-chosen proxy → `SELF_SIGNED_CERT_IN_CHAIN`.
  That proxy is now rejected by the scan.
