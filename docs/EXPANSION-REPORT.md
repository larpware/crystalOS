# Crystal OS — Expansion Report

Status of the expansion work, what is verified, what is partial, and what remains.
Verification was done by running the code: typecheck, the full test suite, live
multi-user API flows against the real dev server, and in-OS UI walkthroughs in the
preview browser.

## 1. Fully implemented and verified

### Crystal AI (Puter streaming assistant)
- Streaming chat over Puter.js (`puter.ai.chat`, streaming + non-streaming paths),
  model selector (nano/plus with a "load all models" probe), stop/abort control,
  conversation persistence in local storage, honest empty/stop/error states.
- Verified: UI send flow, spinner, Stop/abort (including stopping before any
  content, which renders a clear message), only-the-last-turn spinner fix.
- Not verified end-to-end: a completed assistant reply — this sandbox suppresses
  Puter's sign-in popup, so the request stays pending here. See Limitations.

### Accounts backend (server/accounts)
- Registration/login/sessions, friend codes + rarity rolls, friends with
  accept/decline, DMs delivered by a sync poller, profile updates incl. avatar,
  bio, privacy (`private_account`), account deletion with cascade.
- Moderation authority: the first account on a fresh database becomes admin;
  `CRESCENT_ADMINS` names more by username. `isAdmin()` gates every mod tool.
- Rate limits per action class; input validation in `security.mjs`; `ServerError`
  translated to structured404/403/400 responses.

### Crystal Social (separate app, backend-backed)
- Posts (text/image), likes, comments with replies, bookmarks, follows with
  counts, notifications (like/comment/follow), reports + admin report queue,
  private accounts (followers-only visibility enforced server-side).
- Verified: multi-user curl flows (post → feed → like → comment → notify →
  follow) and the UI (feed renders server data, comment threads open).

### Crystal Chat — Communities (real servers, not local mesh)
- Servers with channels, categories, per-channel permission requirements,
  roles with7 permission bits, escalation guards (cannot grant/assign above your
  own rank), owner role untouchable, invites with expiry/max-uses/revoke,
  member kick, ownership transfer, deletion safeguards, audit log, message
  edit/delete with moderator override.
- UI: Direct | Communities switcher in Chat; community rail, channel list,
  message stream with inline editing, member list, and a full settings dialog
  (general / members / roles with permission checkboxes / invites / audit).
- Verified: all31→34 API tests, plus a complete live UI walkthrough — create
  server, post, edit (with "(edited)" marker), create a role with three
  permissions, create + revoke an invite, read the audit log, rename, and
  type-to-confirm delete. An expiry-rendering bug (past-only formatter used for
  a future date) was found live and fixed with a future-aware `formatExpiry`.

### Crystal Store — community submissions + moderation
- Server-backed submissions (`store_submissions` table): members propose a web
  application (name, description, category, http(s) URL); moderators approve or
  reject with a note. Approved apps appear in the public Community tab; every
  decision is visible to its submitter.
- Store UI: new Community / Submit / Mine sections, plus a Review tab that only
  appears for admins (role threaded through the account profile).
- Security choice: submissions are URLs, never uploaded code — approval lists a
  link the Browser opens, so review is a real gate without an execution surface.
- Verified live: submit (pending, private) → admin queue → approve with note →
  public listing with submitter; non-admin gets403 on queue and review; signed-out
  gets401; validation rejects `javascript:` URLs and thin descriptions; Mine
  shows both decisions; lists refetch on tab re-entry (staleness fix found and
  fixed during testing).

### Built-in games (Crystal Games expansion)
- Crystal Snake and Crystal Breakout: full canvas games shipped with the OS,
  registered in the catalogue as `builtin` entries, rendered by the player frame
  instead of an iframe (play with the proxy off, no host, no embed permissions).
- Snake verified end-to-end live: ticks, steers, scores, dies on wall/self,
  persists its high score to profile storage, restart resets score and keeps best.
- Breakout verified to render and draw its board (HUD, bricks, paddle, ball);
  its runtime could not be exercised in the preview webview — see Limitations.

### Mobile / TV alpha
- Mobile: no horizontal overflow at390px; Communities rebuilt for phones
  (rail becomes a horizontal strip, the channel list is preserved at every
  width — the earlier rule hid it entirely, which was a real bug); store
  review/wrap rows flex safely; permission grid drops to one column.
- TV (alpha): a persisted `tvMode` in Appearance raises the OS scale to1.4,
  marks `<html data-tv>`, paints remote-grade focus rings, and the launcher's
  existing arrow-key/Enter/Esc navigation drives it. Verified live including
  persistence across reload.

### Fonts
- Pre-existing font system verified: Settings → Appearance → Fonts changes the
  interface/mono/display fonts, restyles via `--font-ui` and friends, and
  persists (verified live, then restored).

### Plugin SDK (earlier phase)
- Manifest schema + validation, permission lists, registry (install/enable/
  disable/uninstall with compatibility checks), persistent store, bundled
  example plugins that are ordinary users of the same API, Settings page, and
  passing tests (`manifest.test.mjs`, `registry.test.mjs`).

## 2. Backend and database changes

New modules (all under `server/accounts/`):
- `social.mjs` — posts, comments, likes, bookmarks, follows, notifications, reports.
- `servers.mjs` — servers, channels, roles, permissions, invites, messages, audit.
- `store.mjs` — `store_submissions` table and moderation operations.

Changed:
- `db.mjs` — attaches the three stores; adds `users.role`, `users.private_account`;
  profile update support.
- `security.mjs` — validators for post/comment bodies, report reasons, store
  submissions and reviews.
- `api.mjs` — social + servers + store route families, admin bootstrap,
  `ServerError` translation, PUT member-role route.
- `api.test.mjs` — grows from the original suite to34 passing tests (social,
  servers/permissions/escalation/invites, store moderation).

## 3. Tests and builds (actual results)

- `npx tsc --noEmit` — clean, no errors.
- `npm test` — **589 pass,0 fail,128 suites** (server API, plugin SDK, window
  geometry, games state, themes, wallpapers, boot, browser state, …).
- Live flows against the dev server: multi-user social, communities (full UI
  walkthrough), store submissions (submit → moderate → publish), TV toggle and
  persistence, font change and persistence, built-in Snake gameplay.

## 4. Partially implemented / not verified here

- **Crystal AI round-trip**: code is complete; a finished reply could not be
  observed because this sandbox blocks Puter's sign-in popup (environment
  limitation, same class as its iframe restrictions).
- **Crystal Breakout gameplay**: renders and draws; `requestAnimationFrame`
  never fires in the preview webview (it produces no composited frames — the
  same reason screenshots fail there), so stepping/paddle could not run here.
  The loop mirrors Snake's verified structure.
- **"Open in Browser" from the Store**: tab creation is verified
  (`newTab` records the URL; the call path is the terminal's proven one), but a
  full page load stalls — the Scramjet proxy transport cannot complete loads in
  this webview.
- **DMs**: poller-based delivery (the sync endpoint), not a push channel —
  real across sessions, but latency is the poll interval.

## 5. Known limitations

- Browser-based OS: the "sandbox" for plugins is permission-gating plus
  error-containment, not an OS process boundary; a native desktop OS would
  isolate plugins in processes.
- Store submissions are URL listings by design; there is no code-upload path.
- The admin bootstrap only fires on a fresh database; existing databases need
  `CRESCENT_ADMINS` (documented in code and this report).
- Preview-webview quirks (environment, not app bugs): CDP clicks swallowed
  (DOM clicks work), no frame compositing (screenshots fail, rAF paused),
  external proxy loads stall, Puter popups suppressed.

## 6. External services and credentials

- **Crystal AI** uses Puter.js (free, no API key; sign-in happens in a Puter
  popup on first use). Nothing else requires credentials; the accounts server,
  VPN/proxy stack and all social/chat/store features are self-hosted.

## 7. Manual steps

1. `npm run dev` (starts the accounts/scramjet backend + Vite; default ports8787/5273).
2. To grant moderation on an existing database: set `CRESCENT_ADMINS=username`.
3. For Crystal AI, complete the Puter sign-in popup once on a normal browser.

## 8. File inventory (this expansion)

New: `server/accounts/{social,servers,store}.mjs`, `src/apps/ai/`, `src/apps/social/`,
`src/apps/messages/Communities.tsx`, `src/apps/games/builtins/{Snake,Breakout}.tsx`,
`src/services/{ai,appStore,communities,feed}.ts`,
`src/styles/apps/{ai,social,communities}.css`, `docs/{CRYSTAL-AI,SHIELD}.md`,
`docs/EXPANSION-REPORT.md`.

Modified: `server/accounts/{api,db,security}.mjs` + `api.test.mjs`, `src/App.tsx`,
`src/apps/{catalog.ts,registry.tsx}`, `src/apps/games/{catalogue.ts,parts.tsx}`,
`src/apps/messages/Messages.tsx`, `src/apps/settings/pages/appearance.tsx`,
`src/apps/store/Store.tsx`, `src/main.tsx`, `src/services/{api,auth}.ts`,
`src/state/appearance.ts`, `src/types/index.ts`,
`src/styles/{apps/games.css,apps/store.css,system.css}`.

(Plus the earlier-phase shield/proxy/VPN work already present in the tree:
`ShieldPanel.tsx`, `services/shield/`, scramjet frame plumbing, VPN controller
changes, and the bundled `popup-blocker-master/` extension sources.)
