-- ==========================================================================
-- CrystalOS · Supabase migration 0001
--
-- Run once in the Supabase SQL editor (Database → SQL). Everything is
-- idempotent: guarded with IF NOT EXISTS / IF EXISTS, so rerunning never
-- drops or overwrites existing data.
--
-- Created here:
--   profiles            one row per authenticated user (owner-only write)
--   avatars bucket      profile pictures & profile images (Storage)
--
-- CrystalOS's friend/messages/social data continues to live in the OS's own
-- account server (SQLite, docs/DEPLOYMENT.md); these tables pair with that
-- server: auth identity belongs to Supabase, OS features to the server.
--
-- Ids: auth.uid() (uuid, not null in every policy) is the key everywhere, so
-- no row exists out at all without an authenticated user.
-- ==========================================================================

-- ---- profiles ------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text,
  display_name text,
  avatar_url   text,
  bio          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Read/unread and preference flags the shell may add without migrations:
  -- anything not in this column set lives here as JSONB, no schema change.
  extra        jsonb not null default '{}'::jsonb
);

comment on table public.profiles is
  'One row per Supabase user; the row is written by its owner (RLS) and read by anyone.';

create index if not exists profiles_username on public.profiles (lower(username));

-- Updates the row's `updated_at`; created in the same guarded style.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---- row level security ---------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles are public to read"        on public.profiles;
drop policy if exists "profiles: owner writes"             on public.profiles;
drop policy if exists "profiles: owner inserts own row"    on public.profiles;

-- Profile existence is not a secret: the shell uses it to draw names,
-- avatars and bios.
create policy "profiles are public to read"
  on public.profiles for select
  using (true);

-- The row must identify its owner: an id other than auth.uid() cannot pass
-- this check, so nobody creates a profile on another user's behalf (unless
-- the server does so with the service role, which bypasses RLS by design).
create policy "profiles: owner inserts own row"
  on public.profiles for insert
  with check (id = auth.uid());

create policy "profiles: owner writes"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---- avatar storage -------------------------------------------------------
-- The avatars bucket holds profile pictures. Public read (a profile picture
-- is public by definition), writes under the owner path only. Files live at
-- {uid}/avatar.{ext} etc.; nobody can write into another user's prefix.
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

drop policy if exists "avatars: public read"                    on storage.objects;
drop policy if exists "avatars: owner writes own prefix"       on storage.objects;
drop policy if exists "avatars: owner updates own prefix"      on storage.objects;
drop policy if exists "avatars: owner removes own prefix"      on storage.objects;

create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: owner writes own prefix"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: owner updates own prefix"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars: owner removes own prefix"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
