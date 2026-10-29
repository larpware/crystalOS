# Deploying CrystalOS

CrystalOS is two halves that talk over HTTP:

| Half | What it is | Where it runs |
| --- | --- | --- |
| **Shell** | the static React build in `dist/` | any static host (Netlify, Cloudflare Pages, GitHub Pages, S3, nginx, …) |
| **Backend** | `server/scramjet/index.js` — accounts API + SQLite, Scramjet proxy assets, Wisp transport, VPN control | anywhere Node 22+ runs (a PaaS service, a VM, a container) |

The account database is **one SQLite file owned by the backend**
(`server/accounts/data/accounts.db`, moved with `CRESCENT_ACCOUNTS_DB`). It is
the single source of truth for every deployment: a user who registers on one
site signs in on any other, because they all reach the same backend.

The shell never assumes it shares a host with that backend — see
[src/services/api.ts](../src/services/api.ts), which resolves the backend
origin at runtime.

---

## 1. The two deployment shapes

### A. The host can reverse-proxy (preferred)

The browser calls `/api/*` on its own host; the host forwards those paths to
the backend. Same-origin cookies, no CORS, and the full feature set — including
the Browser app's proxy transport, which needs the Wisp WebSocket on the page's
own origin.

Set the build variable:

```
CRESCENT_BACKEND_URL=https://your-backend.example.com
```

`npm run build` then writes `dist/_redirects`:

```
/api/*               https://your-backend.example.com/api/:splat           200
/bootstrap-init.js   https://your-backend.example.com/bootstrap-init.js    200
/scram/*             https://your-backend.example.com/scram/:splat         200
/controller/*        https://your-backend.example.com/controller/:splat    200
/clients/*           https://your-backend.example.com/clients/:splat       200
/wisp/*              https://your-backend.example.com/wisp/:splat          200
```

`_redirects` is a Netlify convention. On another host, forward the same six
paths yourself — e.g. nginx:

```nginx
location ~ ^/(api|scram|controller|clients|wisp)/ { proxy_pass https://your-backend.example.com; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_set_header Host $host; }
```

or Vercel (`vercel.json`):

```json
{ "rewrites": [
  { "source": "/api/:path*", "destination": "https://your-backend.example.com/api/:path*" },
  { "source": "/scram/:path*", "destination": "https://your-backend.example.com/scram/:path*" },
  { "source": "/controller/:path*", "destination": "https://your-backend.example.com/controller/:path*" },
  { "source": "/clients/:path*", "destination": "https://your-backend.example.com/clients/:path*" },
  { "source": "/bootstrap-init.js", "destination": "https://your-backend.example.com/bootstrap-init.js" }
] }
```

WebSocket forwarding is required for `/wisp/`; if the host cannot forward
WebSocket upgrades, proxied pages will not load (accounts are unaffected).

### B. The host cannot proxy at all (GitHub Pages, S3, …)

The browser calls the backend directly, cross-origin. Set the build variable:

```
CRESCENT_API_ORIGIN=https://your-backend.example.com
```

`npm run build` writes that origin into `dist/config.json`, which the shell
reads at runtime (no rebuild needed to change it later — you can edit
`config.json` on the host, or serve your own).

Then tell the backend which site may call it:

```
CRESCENT_PUBLIC_ORIGINS=https://your-site.example.com
```

Cross-origin sessions work: the API answers preflight requests, sends CORS
headers only to allow-listed origins, and issues the session cookie as
`SameSite=None; Secure` for those exchanges.

**What does not work in shape B:** the Browser app's Scramjet transport. It
needs the service worker and the Wisp WebSocket to share the page's origin, so
it only works on a proxying host (shape A). The app says so plainly instead of
showing a blank frame. Accounts, sign-in, friends, social, chat, settings and
persistence are unaffected.

### C. Deliberately static-only

```
CRESCENT_ALLOW_NO_BACKEND=1
```

Silences the build error when neither variable is set. The shell then runs, but
sign-in reports that no account server is reachable.

---

## 2. Environment variables

### Backend (the Node service)

| Variable | Default | Meaning |
| --- | --- | --- |
| `CRESCENT_PORT` | `8787` | port to listen on |
| `CRESCENT_HOST` | `127.0.0.1` | interface to bind (`0.0.0.0` behind a platform proxy) |
| `CRESCENT_ACCOUNTS_DB` | `server/accounts/data/accounts.db` | the authoritative SQLite file; put it on a persistent volume |
| `CRESCENT_PUBLIC_ORIGINS` | *(empty)* | comma-separated origins/bare hosts allowed to call cross-origin and receive CORS |
| `CRESCENT_TRUST_PROXY` | *auto* | `1` trust `X-Forwarded-For` always, `0` never, unset = only from loopback/private peers (keeps rate limits correct behind a proxy) |
| `CRESCENT_SECURE_COOKIES` | `0` | `1` forces the `Secure` attribute on the session cookie (recommended behind https) |
| `CRESCENT_SESSION_DAYS` | `30` | session lifetime |
| `CRESCENT_ADMINS` | *(empty)* | comma-separated usernames with moderation rights (the first account is always an admin) |
| `CRESCENT_TRANSPORT` | `libcurl` | `libcurl` or `epoxy` — the Scramjet client transport |
| `CRESCENT_PUBLIC_WISP_URL` | *(empty)* | `wss://…` endpoint for the Wisp transport when it is not on the page's own host |
| `CRESCENT_ALLOW_PRIVATE_IPS` | `0` | `1` lets the proxy dial loopback/private addresses (needed only for local apps such as QMovies) |
| `CRESCENT_VPN_SESSION_FILE`, `CRESCENT_VPN_ENDPOINT_FILE` | *(under `server/vpn/data/`)* | Proton VPN state; only if you use CrystalVPN |

### Build (the static host's build environment)

| Variable | Meaning |
| --- | --- |
| `CRESCENT_BACKEND_URL` | host can proxy: writes `dist/_redirects` |
| `CRESCENT_API_ORIGIN` | host cannot proxy: writes `dist/config.json` (wins over `CRESCENT_BACKEND_URL`) |
| `CRESCENT_ALLOW_NO_BACKEND` | `1` allows building with neither |
| `VITE_API_ORIGIN` | build-time override of the backend origin (baked into the bundle; usually unnecessary — prefer `CRESCENT_API_ORIGIN`) |

No secrets are needed to build or run CrystalOS. The backend has no API keys,
no third-party auth and no external database.

---

## 3. Commands

```bash
npm ci                 # install (Node 22+; uses the built-in node:sqlite)
npm run dev            # backend + Vite dev server (http://127.0.0.1:5273)
npm test               # full test suite (server, app, scripts)
npm run typecheck      # tsc --noEmit
npm run build          # typecheck + vite build + deployment wiring
npm start              # serve the built shell and the API from one process
```

Backend-only, without the shell: `npm run scramjet`.

---

## 4. Moving the existing accounts (migration)

The accounts that exist today live in the local SQLite file
`server/accounts/data/accounts.db`. They move with
[scripts/migrate-accounts.mjs](../scripts/migrate-accounts.mjs), which imports
them into the production database: same ids, same usernames, same friend codes,
same scrypt password hashes (so **existing passwords keep working**), same
profiles, plus the accounts' messages, friendships, posts and comments.
Sessions are deliberately not migrated.

```bash
# 1. Take the source file off the machine that has it (server/accounts/data/accounts.db)
# 2. Plan first — this writes nothing:
npm run migrate:accounts -- --from ./accounts.db --to /path/to/production.db --dry-run

# 3. Import:
npm run migrate:accounts -- --from ./accounts.db --to /path/to/production.db
```

Guarantees:

* **Idempotent** — rerunning imports nothing twice.
* **Transactional** — the whole run lands or none of it does.
* **Reversible** — a `VACUUM INTO` snapshot is taken first
  (`<db>.pre-migration-<timestamp>.bak`); to roll back, stop the backend and
  restore that file.
* **Never overwrites** — an id or username the target already holds is reported
  and skipped; nothing in production is replaced silently.
* **Never invents passwords** — a record without a compatible password hash is
  skipped with a reason unless you pass `--adopt-passwordless`, and even then
  the credentials are random and unusable until an administrator resets them.

Browser-local profiles from builds that stored accounts in `localStorage` can
be migrated too: in the source browser open the CrystalOS origin, then

```js
copy(JSON.stringify(localStorage.getItem("crescent.accounts")))
```

Save that string to a `.json` file and pass it to `--from`. Those records only
import when they carry a compatible password hash; profiles without one are
reported, never given an invented password.

### Where the migrated database goes

* **A platform service (Render, Railway, Fly, a VM):** point
  `CRESCENT_ACCOUNTS_DB` at a persistent disk path and copy the file there.
* **Anywhere else:** run the migration on the machine that will host the
  backend, into its configured path, then start it.

Afterwards the backend prints the number of registered accounts at boot — a
quick confirmation that the right database is mounted:

```
accounts:  /api/accounts/* · 14 registered
```

---

## 5. Netlify, step by step

1. Deploy the backend somewhere with a stable https URL (see §3). Confirm
   `https://your-backend.example.com/api/accounts/me` answers JSON.
2. In Netlify: *Add new site → Import an existing project*, this repository.
   Build command `npm run build`, publish directory `dist`.
3. Site settings → Environment → add `CRESCENT_BACKEND_URL=https://your-backend.example.com`.
4. On the backend, set `CRESCENT_PUBLIC_ORIGINS=https://your-site.netlify.app`
   (add your custom domain too) and, if it is behind a TLS-terminating proxy,
   `CRESCENT_SECURE_COOKIES=1`.
5. Deploy. Netlify processes the generated `_redirects` **before** the
   `netlify.toml` SPA fallback, so `/api/*` is never answered with `index.html`.

A build without either `CRESCENT_BACKEND_URL` or `CRESCENT_API_ORIGIN` fails on
purpose: a site whose `/api/*` has nowhere to go would deploy with a dead
account system.

---

## 6. Production checklist

Localhost working proves nothing about a host. Before calling a deployment
live:

- [ ] `GET https://backend/api/accounts/me` returns JSON (not the shell's HTML)
- [ ] Register → sign in → reload → still signed in (the cookie survives)
- [ ] Sign in from the deployed site, not just from the backend's own URL
- [ ] The backend's boot line shows the expected account count
- [ ] The database file is on a **persistent** disk, not the container's overlay
- [ ] The backend restarts clean (WAL sidecars `-wal`/`-shm` travel with it)
