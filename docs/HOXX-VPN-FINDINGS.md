# Hoxx VPN extension — reverse-engineering findings

**Status: the mechanism is fully understood; Hoxx's own guest/credential flow
cannot be driven by a third-party client. Crescent therefore ships a separate
"Hoxx VPN" application that drives the account-free proxy transport directly
(the `manual` provider in `server/vpn/`) and the Crescent Browser integrates with
it by default. No part of Hoxx's obfuscated client was vendored, and its paid
tier is not unlocked — see §4 and §5.**

This records what was reverse engineered from `hoxxvpn/` (Hoxx VPN Proxy
3.50.6, MV3), with the commands that produced each result, so the conclusions
can be re-checked rather than taken on trust.

---

## 1. What the extension actually is

| Piece | Finding |
| --- | --- |
| Proxy model | `chrome.proxy.settings.set({mode:"fixed_servers", rules:{singleProxy:{scheme,host,port}, bypassList}})` — an ordinary HTTP(S) proxy, not a tunnelling driver. (`service-worker.js` @161006) |
| Proxy auth | `chrome.webRequest.onAuthRequired` supplies `authCredentials: {username: config.p_login, password: config.p_token}` — Basic auth with short-lived credentials from the server config. (@220407) |
| Fail-closed state | When locked, it points the proxy at `127.0.0.1:65534`, i.e. a dead port. (`TIMEOUT.PROXYSETTING`, @92517) |
| Premium gate | `isPremium(t) = t.config.user_premium !== 0 && t.config.user_premium > t.config.time` — a **server-issued** field, not a client flag. (@80342) |
| Free tier | An anonymous **guest account**: `POST /api3/r/guest` creates it server-side; there is no user login required to obtain one. (`GUEST:{endpoint:"/api3/r/guest"}`) |
| API hosts | `/api3/*` and `/api2/*` on a rotating base chosen from `uibase` (account1–15.hoxx.com), `mainbase` (12 hosts) and `tierbase` (9 hosts) — all listed in `assets/servers.json`. |

So the user's "doesn't really need authentication" is accurate: the *user* does
not sign in. But a guest account is still minted by Hoxx's server, and the proxy
credentials come from that account.

## 2. The wire format (recovered, and verified working)

From the service worker's own client (@91527):

* key `f` = random 3–64 alphanumeric characters, generated **per request**
* request headers: `Content-Type: text/plain` +
  `Authorization: Basic base64(f + ":" + <random 3–8 chars>)`
* request body: `base64(xor(bodyString, f))`
* response: `xor(base64decode(text), f)` then `JSON.parse`

I reimplemented this in plain Node (`.tmp-hoxx-api2.mjs`) and it **works**:

```
OK   https://nvne.spoken.fun     /api2/p  200 {"retcode":200,"weight":1.6129032258064515}
OK   https://nytw.chester.run    /api2/p  200 {"retcode":200,"weight":1.5873015873015872}
OK   https://okog.chester.run    /api2/p  200 {"retcode":200,"weight":4.166666666666666}
OK   https://account1.hoxx.com   /api2/p  200 {"retcode":200,"weight":1.3157894736842105}
OK   https://nytw.chester.run    /api2/t/u 200 {…the whole server catalogue…}
```

`/api2/p` is the extension's own "is this base alive" probe, and `/api2/t/u`
returns the same catalogue that is bundled as `assets/servers.json`. Both are
reachable unauthenticated with the format above.

## 3. Why the guest flow cannot be reproduced

Every `/api3/*` call — including `/api3/r/guest` and the config call `/api3/c/4`
that carries `p_login`/`p_token` — is refused:

* **urlencoded body** → `403 please use latest version....`
* **JSON body** → `200 {"retcode":-50}`

`-50` is returned *before* routing (an unknown action like `/api3/nope` returns
the same code), so it is a request-validity gate, not an endpoint error. Swept
and rejected: `v` (as `4` and as `"3.50.6"`), `post` (object and string),
`defaults` nested, `iid`, `id`, `extid`, `t` (seconds and millis), `e2`/`e3`
(empty plus sha512/hmac/sha256 derivations), and both JSON envelopes implied by
the client's own struct tags (`v`, `post`, `defaults`, `e2`, `id`, `t`, `e3`).
All `-50`.

The signing is done inside the extension's **obfuscated TinyGo WebAssembly
module** (`js/main.wasm`, 454 KB, imported as `vc/vwasm`), which the service
worker drives through a `__gobridge__` proxy: `oa.doRequest({endpoint, params,
state})` → a Go function. Recovered from that module:

* struct tags: `cv brand platform os e2 v post defaults iid id t e3`
* `vc/vwasm/aes` exports `Xor`, `NewAES`, `addRoundKey`, `subBytes`, `shiftRow`
  — i.e. a bespoke AES + XOR layer
* a hardcoded constant `RDQ1l9e5OMvYkpEKha0vZ5b4pXRsxqSKXdeiIsm` next to
  `extid`, and an entropy path using `browser.runtime.getBrowserInfo()`
  (Firefox) or `navigator.userAgentData.getHighEntropyValues()` (Chrome)
* the redux keys it reads are lowercase: `serversjson`, `baselink.link`,
  `defaults`, `iid` (they match `jr="configdata"`, `Dr="serversjson"`,
  `Ir="baselink"` in the bundle)

I booted that real WASM in Node (`.tmp-hoxx-run.mjs`, which loads the bundle with
stubbed `chrome.*` and logs every property Go reads and every JS method it
calls). It reaches the request-building code, reads
`endpoint → params → state → state.serversjson → state.baselink.link →
state.defaults → state.iid`, stringifies three payloads, and then returns
`false` without ever calling `fetch`. Two shape fixes were needed to get that
far (lowercase state keys; `defaults.os` must be present, otherwise Go panics
with `syscall/js: call of Value.Float on undefined`); the remaining stop
condition is inside the obfuscated code.

Conclusion: **the free tier is gated by a per-request signature generated by the
vendor's obfuscated client. A reimplementation cannot produce it, and reusing
the blob means shipping a proprietary 454 KB binary that its own author
deliberately obfuscated.**

## 4. Not attempted

* Defeating the `user_premium` entitlement. It is a server-issued field: the
  proxy credentials the server hands out are what they are, so "premium for
  free" would mean forging entitlement against Hoxx's servers, not flipping a
  client flag. Declined — and stated plainly in the shipped app's "How this
  works" section.
* Shipping `main.wasm`. It is obfuscated on purpose; vendoring it would make
  the free tier depend on a proprietary blob that Hoxx can invalidate at will
  (as `-50` already demonstrates) and that we could not maintain.

## 5. What shipped instead

The one part of the request that *is* achievable — a VPN with no account at all
— comes from something other than Hoxx's API, and is now live:

1. **A user-supplied proxy endpoint.** `server/vpn/tunnel.mjs` is a generic,
   certificate-verified HTTPS CONNECT client, and the provider layer
   (`server/vpn/endpoint.mjs`, `controller.mjs`, `api.mjs`) accepts a manual
   `host:port` endpoint with optional Basic credentials. This is the account-free
   path, and it carries the enforcement, coverage and diagnostics already built.
   It is what the **Hoxx VPN** app (`src/apps/hoxx/HoxxVpn.tsx`) presents: the
   endpoint the user names *is* the server, so the app's "test connection" is a
   real `POST /api/vpn/endpoint/test` CONNECT probe rather than a catalogue fetch.
2. **Zero-config connect, with a country picker.** Requiring a student to find a
   host and a port is the wrong UX for a "no account" claim, so
   `server/vpn/proxies.mjs` adds an automatic pool: it fetches several public
   lists of free HTTP CONNECT proxies, de-duplicates them, and **proves each
   candidate with a real, certificate-verified TLS handshake** before offering it
   — a list entry is a claim, not a fact, and a bare CONNECT is not proof either
   (a dead exit or a man-in-the-middle proxy answers a CONNECT just as readily).
   `server/vpn/countries.mjs` plus country-filtered sources let the user pick an
   **exit country** (`GET /api/vpn/countries`, the Hoxx app's picker) instead of
   typing an address; the pool asks the sources for that country's proxies and
   the chosen endpoint records the country it came from. The fastest surviving
   proxy is stored as the active endpoint and connected, exactly as if it had been
   typed, so every existing surface keeps working with no second code path.
   Because public proxies die between the health test and the real connect,
   `controller.quickConnect()` keeps the ranked survivors and falls through to
   the next one on failure, and a stored endpoint that no longer answers triggers
   a fresh scan rather than an error. It is reachable three ways: the Hoxx app's
   connect button, `POST /api/vpn/quick-connect`, and `npm run vpn`
   (`server/vpn/cli.mjs`, with `-- --status` / `-- --off`).
3. **The Crescent Browser uses Hoxx by default.** When no provider has been
   chosen, the browser's VPN surfaces (`providerAppId(null)` → `"hoxx"`) and the
   Quick Settings tile, Settings → VPN page and toolbar button all name Hoxx and
   open the Hoxx app. Selecting Proton from the Proton VPN app — or clearing the
   endpoint — returns the browser to the Proton path.
4. **Premium is not unlocked, and the app says so.** Hoxx's paid tier is an
   entitlement its server issues; the shipped app drives the free, account-free
   transport honestly and does not pretend otherwise.

### What the public pool is, honestly

These are *public* proxies, not a vendor's servers, so the app and the CLI both
state the trade: an exit can see *which* hosts a user visits. What it cannot do
is read or forge a site's traffic, because Crescent opens opaque CONNECT tunnels
and never terminates the session — the site's own TLS is verified end-to-end by
the browser. That is the same posture as `manual`: a real measurement of the exit
address (`verified.egress`) or an honest *unknown*, never a claimed pass.

The pool also screens out proxies that *do* try to intercept TLS. A CONNECT reply
of `200` proves nothing on its own: a live measurement found a free proxy
(`47.91.65.23:3128`) that accepted the CONNECT and then answered with a
self-signed certificate chain — a man-in-the-middle — while the same site was
validly certified on a direct connection. The health check is therefore a full
**verified TLS handshake** through the tunnel (`verifyTlsThroughProxy`,
`rejectUnauthorized: true`), so a proxy that cannot carry a genuine certificate is
never offered, and neither is one that black-holes the site. The connect canary
(the browser's search engine) is checked the same way, which is what keeps a
search from landing on a blank page.

Hoxx's own extension remains the only way to use Hoxx's *servers and credentials*;
that was not reimplemented, for the reasons in §3.

## 6. Commands used

```bash
node .tmp-hoxx-api2.mjs  # replays the recovered client against /api2/* and /api3/*
node .tmp-hoxx-run.mjs   # boots the extension's Go WASM and logs the bridge
```
