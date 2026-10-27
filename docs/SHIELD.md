# CrystalOS Shield

Shield is CrystalOS's ad, tracker and popup blocking. It lives in
`src/services/shield/` and is enforced inside the Scramjet proxy path — the
same place every proxied request already passes through — via the supported
Scramjet plugin API (`window.$scramjetUtils.ManagedPlugin`). No Scramjet
source is patched and no browser-extension code is executed.

## What it is made of

| Part | File | Role |
| --- | --- | --- |
| Rule engine | `filter.ts` | Parses filter rules (hostnames, `||host^` network filters, exceptions `@@`) and matches requests against them. Cosmetic rules (`##`, `#@#`, `#?#`), scriptlets and filter options it does not implement are **reported as unsupported**, never applied silently |
| OS list | `list.ts` | The ad/analytics/telemetry/popunder hosts that ship enabled |
| Decisions | `decision.ts` | Turns a rule match into one honest outcome: block, placeholder, allow, popup allow/block |
| Enforcement | `plugin.ts` | A Scramjet plugin: `fetch.intercept` short-circuits blocked requests before they leave the page; `init.post` shadows `window.open` for popup control |
| Remembered state | `state.ts` | Settings, per-site allowlists, per-tab blocked counts, recent blocked popups — persisted in the browser's local storage |
| UI | `ShieldPanel.tsx` (browser toolbar popover), Settings → Proxy | Per-page counts, per-site toggles, the popup log, and the switches for blocking and the alpha data saver |

## What it can block

- Advertising, ad-tracking and analytics **requests made by proxied pages**
  (the browser app's tabs). Blocked requests never leave the machine: the
  plugin answers them locally.
- `window.open` popups spawned by proxied pages, including the pop-under
  pattern, with a gesture window (a click within the last few seconds allows
  legitimate "open in new tab" links).
- In low-data mode ("faster on slow connections"): images are answered with a
  1×1 pixel and audio/video/font/beacon requests are not downloaded at all.

## What it cannot block — stated plainly

- **Requests made outside a proxied frame.** CrystalOS is a web application.
  It cannot see or intercept traffic of other browser tabs, native desktop
  applications, system services, or encrypted DNS. When the browser's proxy
  is off, pages load directly and Shield's network filtering is not in the
  request path at all (popup shadowing still applies inside the frame).
- **Server-side ad placement.** Ads served from the same host as the content
  (first-party, e.g. `/ads/` paths on the site's own domain) are not blocked by
  host-based rules without breaking the site. **Cosmetic filtering (element
  hiding) is not implemented**: a `##` rule in a list is parsed, reported as
  unsupported and skipped, so it hides nothing. Filters with the same
  treatment are scriptlets (`#%#`, `+js(...)`) and the `$` options the engine
  does not understand.
- **Compared with uBlock Origin + EasyList, this blocks far less.** EasyList,
  EasyPrivacy and uBlock's own lists are published under GPL-3.0 / CC BY-SA
  licences that do not belong in this repository (the same reason the vendored
  extensions were removed in v1.3.0). The OS list was therefore written from
  scratch: the well-known, checkable ad/tracking infrastructure, as readable
  hostnames. **There is no custom-rule editor yet**: the engine can parse
  additional rules and the tests feed it its own, but the shipped list is the
  only list the app loads, and nothing in the interface invites a person to
  paste a list that would then be ignored.

## Third-party sources used as reference

- **uBlock Origin** (`https://github.com/gorhill/uBlock`, GPL-3.0): consulted
  as public documentation of the problem domain. No uBlock code or list
  content is redistributed here.
- **Strict Popup Blocker** (`popup-blocker-master/` in this repository,
  MPL-2.0, by schomery): the original unmodified source is kept in the repo
  with its licence and README intact, preserving the MPL-2.0 source
  distribution and attribution obligations. Shield's popup logic (`decidePopup`,
  `POPUP_GESTURE_WINDOW_MS`) is an original implementation of the same idea —
  user-gesture-window popup suppression with per-site exceptions — not a port
  of its code.

## Honest counters

The badge on the browser toolbar shows the number of requests blocked **in
the current page load of the current tab**. It resets on navigation. It never
counts requests the engine did not actually intercept, and the popup log only
records popups the plugin actually refused to open.
