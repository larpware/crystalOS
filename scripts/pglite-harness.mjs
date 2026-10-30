/**
 * Local Postgres harness for CrystalOS migrations.
 *
 * The real database is a Supabase project, and its DDL lives in `migrations/`.
 * This harness runs those exact files against an embedded Postgres (PGlite)
 * so the schema, the SECURITY DEFINER rules and Row Level Security can be
 * executed and asserted on, instead of being reasoned about.
 *
 * Supabase-specific pieces are shimmed, faithfully enough to be meaningful:
 *   - roles `anon`, `authenticated`, `service_role`
 *   - `auth.users` + `auth.uid()` (fed from the `app.uid` setting)
 *   - `storage.buckets`, `storage.objects`, `storage.foldername()`
 *   - the default grants Supabase applies to new tables in `public`
 *
 * `service_role` gets BYPASSRLS, matching Supabase, so the two trust tiers
 * behave the same here as they do in production.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const migrationsDir = join(root, "migrations");

const SHIM = /* sql */ `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants table privileges to these roles on every new public table.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

create schema if not exists auth;

create table if not exists auth.users (
  id     uuid primary key,
  email  text,
  instance_id text,
  aud     text,
  role    text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Supabase's auth.uid(): the sub of the request's JWT. Here it is whatever
-- the test set with select set_config('app.uid', '<uuid>', false).
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.uid', true), '')::uuid
$$;

create schema if not exists storage;

create table if not exists storage.buckets (
  id     text primary key,
  name   text,
  public boolean not null default false
);

create table if not exists storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets (id) on delete cascade,
  name        text,
  owner       uuid,
  created_at  timestamptz not null default now()
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;

grant usage on schema auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
grant select on storage.buckets, storage.objects to anon, authenticated, service_role;
grant insert, update, delete on storage.objects to authenticated;
`;

/** The migration files, in the order Supabase must run them. */
export function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** Opens a fresh embedded Postgres with every migration applied. */
export async function createDatabase({ migrations = true } = {}) {
  const db = new PGlite();
  await db.exec(SHIM);

  if (migrations) {
    for (const file of migrationFiles()) {
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      try {
        await db.exec(sql);
      } catch (error) {
        error.message = `${file}: ${error.message}`;
        throw error;
      }
    }
  }
  return db;
}

/** Runs `sql` and returns the rows of the first result set. */
export async function query(db, sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows;
}

/** Acts as the given Supabase role for the duration of `fn`. */
export async function asRole(db, role, fn) {
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
  }
}

/** Acts as a signed-in user: role `authenticated` with `auth.uid()` = id. */
export async function asUser(db, userId, fn) {
  await db.query(`select set_config('app.uid', $1, false)`, [userId ?? ""]);
  return asRole(db, "authenticated", fn);
}

/** Acts as the Worker's server key: role `service_role` with no user. */
export async function asService(db, fn) {
  await db.query(`select set_config('app.uid', '', false)`);
  return asRole(db, "service_role", fn);
}

/** Creates an auth user + profile row, returning the profile id. */
export async function makeUser(db, { username, role = "user" } = {}) {
  const id = crypto.randomUUID();
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [
    id,
    `${username}@example.test`,
  ]);
  await asService(db, async () => {
    await db.query(
      `insert into public.profiles (id, username, display_name, role)
       values ($1, $2, $2, $3)`,
      [id, username, role],
    );
  });
  return id;
}
