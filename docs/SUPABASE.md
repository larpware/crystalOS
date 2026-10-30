# CrystalOS × Supabase

How Supabase fits into CrystalOS, who owns which piece of data, and what you
need to do once in the Supabase dashboard and in your deploy targets.

## Architecture in one paragraph

Supabase is the **identity and user-owned-data layer**: accounts sign in with
email + password through Supabase Auth, the browser holds the resulting
session, and each user gets owner-protected rows (`profiles`) and files
(`avatars` bucket) in Postgres Storage. The **Node backend stays exactly as it
was** — session cookies, friend codes, friends, DMs, social posts, community
servers all keep living in its SQLite store, with all its server-side
authorization untouched. When a browser signs in through Supabase, the backend
*verifies the presented access token against the project itself* and mints its
own cookie session for the linked OS account. There is one identity per
person, not two auth systems: a linked account row is found by its
`supabase_id`, and its password lives only in Supabase.

```
Browser                     Account server                Supabase project
──────                      ──────────────                ────────────────
signUp/signInWithPassword ────────────────────────────▶ /auth/v1/*
        access token ──▶ POST /api/accounts/register
                         header or body.supabaseToken
                         verify token (GET auth/v1/user
                         with the project key) ─────────▶/auth/v1/user
                         link account row (supabase_id)
                         mint HttpOnly cookie ◀── 201
every OS feature ──────▶ same cookie as always
profile edits ──▶ PATCH /me (canonical)  +  upsert profiles (RLS, own row)
avatar pick   ──▶ storage.upload avatars/{uid}/…  → URL stored as avatar
```

## Environment variables

| Where | Name | Used for |
| --- | --- | --- |
| Frontend (Vite build / Netlify) | `VITE_SUPABASE_URL` | the project URL for `src/lib/supabase.ts` |
| Frontend | `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key — safe in the browser, authority comes from RLS |
| Backend (Node host) | `SUPABASE_URL` (or `VITE_SUPABASE_URL`) | verifying presented access tokens |
| Backend | `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY`) | same verification call |

Notes:

- The frontend degrades gracefully: without the two `VITE_` values the shell
  shows the classic username form only, and everything keeps working off the
  account server. No code path *requires* Supabase.
- The backend likewise answers `NOT_CONFIGURED` (503) honestly if it is asked
  to verify a token it has no project for.
- **No service-role key exists anywhere in this repo's code.** Ownership is
  enforced by RLS, and token verification uses the publishable key.

## One-time setup (your dashboard, not this repo)

1. **Run the migration** `migrations/0001_profiles_and_storage.sql` in the
   Supabase SQL editor. It is idempotent (safe to re-run): creates
   `public.profiles` with RLS, and the public `avatars` bucket with
   owner-prefix write policies.
2. Confirm **email confirmations** behave the way you want
   (Auth → Providers → Email). If confirmations are on, a fresh sign-up
   becomes usable only after the inbox link — the desktop shows a
   "check your inbox" state.
3. Set the four env variables above in the right places
   (Netlify → Site settings → Environment; Northflank → your backend
   service → Environment), then redeploy/restart.

## What each piece owns

| Data | Owner | Authorisation |
| --- | --- | --- |
| OS account row, friend code, rarity | account server (SQLite) | session cookie; server-side checks |
| Sign-in credential | Supabase Auth | verified token minted into the OS cookie |
| `profiles` (display name, bio, avatar URL mirror) | Supabase Postgres | RLS: everyone reads, only the owner writes |
| Avatar files | Supabase Storage `avatars` | public read; writes only under the owner's `{uid}/` prefix |
| Messages, friends, social | account server | unchanged (unchanged on purpose — see below) |

### Why messages/friends stayed on the backend

The account server already enforces conversation membership, blocking,
friend-request state machines, rate limits and pagination server-side
(`server/accounts/api.mjs`, tested end to end). Moving those tables to
Postgres would mean a second, parallel implementation of the same rules
migrating mid-flight — the prompt's own no-duplication rule. The `profiles`
mirror plus token-verified auth is the seam: when a feature genuinely needs
Realtime (e.g. shared canvases), it can key off `profiles` + Supabase
Realtime without touching the OS's history stores.

## Files

- `src/lib/supabase.ts` — the one client; config resolution + `getSupabase()`.
- `src/services/auth.ts` — email sign-up/sign-in, password recovery, password
  change, `supabaseLinked` on profiles, best-effort `profiles` mirror.
- `src/services/supabaseStorage.ts` — `uploadAvatar()` with type/size checks.
- `src/shell/AccountForm.tsx` — email field, email sign-in, forgot-password.
- `server/accounts/supabase.mjs` — token verification against the project.
- `server/accounts/api.mjs` — register/login grafts, password-change guard.
- `server/accounts/db.mjs` — `supabase_id` column + partial unique index.
- `server/accounts/security.mjs` — avatars accept project-storage URLs too.
- `server/accounts/supabase.test.mjs` — the whole flow against a mock project.
- `migrations/0001_profiles_and_storage.sql` — tables, RLS, bucket, policies.

## Testing done

- `node --test server/accounts/supabase.test.mjs` — 14 tests: token
  verification (valid/rejected/malformed), register via token (creates link,
  no local password, repeat = sign-in), login via body/header token,
  `NO_LINKED_ACCOUNT` 404, linked-password guard, legacy flows intact.
- `npm test` — full suite green (677 pass / 0 fail, 13 skipped).
- `npx tsc --noEmit` and `npm run build` clean.

Not verifiable from here: live sign-in against the real project (needs the
env values present at runtime — they are read from the environment, never
from this repo's files) and the SQL migration itself (needs dashboard access).
