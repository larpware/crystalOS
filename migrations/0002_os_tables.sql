-- ==========================================================================
-- CrystalOS · Supabase migration 0002 — the OS schema
--
-- Run once in the Supabase SQL editor (Database → SQL), after 0001.
-- Idempotent throughout: IF NOT EXISTS / IF EXISTS guards, policies dropped
-- then recreated, and no statement deletes or rewrites an existing row.
--
-- Laid out in the order Postgres needs: tables, then the SECURITY DEFINER
-- helpers they are checked against, then the policies, then grants.
--
-- Tables:
--   profiles        + friend_code, rarity, role, tags, privacy, presence
--   friendships     canonical (a,b) pairs
--   friend_requests pending/accepted/declined edges
--   messages        direct messages between two friends
--   notifications   one inbox row per user
--   follows/blocks  Crystal Social's privacy graph
--   posts, post_likes, post_comments, comment_likes, bookmarks, post_reports
--   servers, server_roles, server_members, channels, server_messages
--   invites, server_audit, store_submissions
--
-- Security model — read this before adding a table:
--
--   1. The Worker NEVER holds a service-role key. Every write goes through
--      PostgREST carrying the caller's Supabase access token, so auth.uid()
--      inside a policy is a user proven by Supabase, not a value anyone sent.
--   2. Every policy is therefore written in terms of auth.uid(): a client can
--      only ever name itself. No policy treats a client-supplied id as
--      authority.
--   3. Cross-user effects (redeeming an invite, notifying someone else) are
--      impossible under plain RLS, so they live in SECURITY DEFINER
--      functions (join_by_invite, notify): both re-check their inputs and
--      both are granted only to `authenticated`.
--   4. Server authority is a bitmask checked in SQL (server_can), so a
--      permission cannot be turned on by a request body.
--   5. No table gets a `using (true)` policy except the profile directory,
--      and nothing here drops a table, sequence or row.
-- ==========================================================================

-- ==========================================================================
-- Phase 1 — tables
-- ==========================================================================

-- ---- profiles --------------------------------------------------------------
-- 0001 may already have created this; the create is a no-op then and every
-- alter below is guarded, so the file runs against either state.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text,
  display_name text,
  avatar_url   text,
  bio          text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  extra        jsonb not null default '{}'::jsonb
);

alter table public.profiles add column if not exists friend_code     text;
alter table public.profiles add column if not exists rarity          text;
alter table public.profiles add column if not exists rarity_roll     integer;
alter table public.profiles add column if not exists role            text not null default 'user';
alter table public.profiles add column if not exists tags            text[] not null default '{}';
alter table public.profiles add column if not exists private_account boolean not null default false;
alter table public.profiles add column if not exists last_seen_at    timestamptz;
alter table public.profiles add column if not exists supabase_id     uuid;

-- The constraint NAMES matter: worker/accounts.ts matches PostgREST's
-- uniqueness errors on these exact names to answer USERNAME_TAKEN and to
-- retry the friend-code draw.
create unique index if not exists profiles_username_key    on public.profiles (username);
create unique index if not exists profiles_friend_code_key on public.profiles (friend_code);
create unique index if not exists profiles_supabase_id_key on public.profiles (supabase_id)
  where supabase_id is not null;

-- ---- friends ---------------------------------------------------------------
create table if not exists public.friendships (
  a_id       uuid not null references public.profiles (id) on delete cascade,
  b_id       uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (a_id, b_id),
  -- Canonical order: the Worker always writes (lower, upper), so one pair can
  -- never exist twice in the two possible directions.
  constraint friendships_ordered check (a_id < b_id)
);

create index if not exists friendships_b on public.friendships (b_id);

create table if not exists public.friend_requests (
  id         uuid primary key default gen_random_uuid(),
  sender_id  uuid not null references public.profiles (id) on delete cascade,
  target_id  uuid not null references public.profiles (id) on delete cascade,
  status     text not null default 'pending'
             check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_requests_distinct check (sender_id <> target_id)
);

create index if not exists friend_requests_target on public.friend_requests (target_id, status);
create index if not exists friend_requests_sender on public.friend_requests (sender_id, status);

-- ---- direct messages -------------------------------------------------------
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 2000),
  client_id    text,
  created_at   timestamptz not null default now(),
  constraint messages_distinct check (sender_id <> recipient_id)
);

create index if not exists messages_pair_time
  on public.messages (sender_id, recipient_id, created_at desc);
create index if not exists messages_recipient_time
  on public.messages (recipient_id, created_at desc);

-- ---- notifications ---------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  kind       text not null,
  post_id    uuid,
  body       text,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index if not exists notifications_inbox
  on public.notifications (user_id, created_at desc);

-- ---- privacy graph ---------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'accepted' check (status in ('accepted', 'pending')),
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_distinct check (follower_id <> followee_id)
);

create index if not exists follows_followee on public.follows (followee_id, status);

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_distinct check (blocker_id <> blocked_id)
);

-- ---- feed ------------------------------------------------------------------
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 5000),
  image      text,
  topic      text not null default 'general'
             check (topic in ('general', 'gaming', 'development', 'customization', 'questions')),
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);

create index if not exists posts_author_time  on public.posts (author_id, created_at desc);
create index if not exists posts_topic_time   on public.posts (topic, created_at desc);
create index if not exists posts_created_time on public.posts (created_at desc);

create table if not exists public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists post_comments_post on public.post_comments (post_id, created_at);

create table if not exists public.comment_likes (
  comment_id uuid not null references public.post_comments (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create table if not exists public.bookmarks (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.post_reports (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason      text not null check (char_length(reason) between 1 and 500),
  created_at  timestamptz not null default now(),
  unique (post_id, reporter_id)
);

-- ---- communities -----------------------------------------------------------
create table if not exists public.servers (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  description text check (char_length(description) <= 500),
  icon        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.server_roles (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references public.servers (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  color       text,
  position    integer not null default 0,
  permissions integer not null default 0,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (server_id, name)
);

create table if not exists public.server_members (
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role_id   uuid references public.server_roles (id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create index if not exists server_members_user on public.server_members (user_id);

create table if not exists public.channels (
  id                  uuid primary key default gen_random_uuid(),
  server_id           uuid not null references public.servers (id) on delete cascade,
  category            text,
  name                text not null check (char_length(name) between 1 and 60),
  description         text,
  position            integer not null default 0,
  requires_permission integer,
  created_at          timestamptz not null default now()
);

create index if not exists channels_server on public.channels (server_id, position);

create table if not exists public.server_messages (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 4000),
  client_id  text,
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);

create index if not exists server_messages_channel
  on public.server_messages (channel_id, created_at desc);

create table if not exists public.invites (
  code       text primary key,
  server_id  uuid not null references public.servers (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  max_uses   integer,
  uses       integer not null default 0,
  revoked    boolean not null default false,
  constraint invites_uses_check check (uses >= 0 and (max_uses is null or uses <= max_uses))
);

create index if not exists invites_server on public.invites (server_id);

create table if not exists public.server_audit (
  id         uuid primary key default gen_random_uuid(),
  server_id  uuid not null references public.servers (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,
  detail     text,
  created_at timestamptz not null default now()
);

create index if not exists server_audit_server on public.server_audit (server_id, created_at desc);

-- ---- store -----------------------------------------------------------------
create table if not exists public.store_submissions (
  id           uuid primary key default gen_random_uuid(),
  submitter_id uuid not null references public.profiles (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  description  text not null check (char_length(description) <= 500),
  category     text not null check (char_length(category) <= 40),
  url          text not null check (url ~* '^https?://'),
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected')),
  review_note  text,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid references public.profiles (id) on delete set null
);

create index if not exists store_submissions_status
  on public.store_submissions (status, created_at desc);

-- ==========================================================================
-- Phase 2 — SECURITY DEFINER helpers
-- Each one is definer so a policy on one table can consult another without
-- the caller's own RLS view of that table making the check recurse or lie.
-- ==========================================================================

create or replace function public.is_server_owner(sid uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.servers s where s.id = sid and s.owner_id = auth.uid()
  );
$$;

-- Permission bitmask. The owner always holds every bit.
--   1 MANAGE_SERVER · 2 MANAGE_CHANNELS · 4 MANAGE_ROLES · 8 KICK
--  16 MANAGE_MESSAGES · 32 SEND_MESSAGES · 64 INVITE
create or replace function public.server_can(sid uuid, required integer)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (
      select 1 from public.servers s where s.id = sid and s.owner_id = auth.uid()
    ) then true
    else exists (
      select 1
        from public.server_members m
        join public.server_roles r on r.id = m.role_id
       where m.server_id = sid
         and m.user_id = auth.uid()
         and (r.permissions & required) = required
    )
  end;
$$;

create or replace function public.is_server_member(sid uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.server_members m
     where m.server_id = sid and m.user_id = auth.uid()
  );
$$;

create or replace function public.channel_server(cid uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select server_id from public.channels where id = cid;
$$;

-- Read this author's posts? Own posts always; otherwise the author must not
-- be private, or the caller must be an accepted follower.
create or replace function public.can_view_posts(author uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when author = auth.uid() then true
    when author is null then false
    else (
      not exists (
        select 1 from public.profiles p
         where p.id = author and p.private_account
      )
      or exists (
        select 1 from public.follows f
         where f.followee_id = author
           and f.follower_id = auth.uid()
           and f.status = 'accepted'
      )
    )
  end;
$$;

create or replace function public.are_friends(x uuid, y uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.friendships fr
     where (fr.a_id = x and fr.b_id = y) or (fr.a_id = y and fr.b_id = x)
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- Notify another user. Impossible through plain RLS (there is no insert
-- policy on notifications), so this is the only way in — and the actor is
-- always auth.uid(), never a parameter. The relationship pre-check stops a
-- publishable-key holder from using it as a spam gun.
create or replace function public.notify(
  p_user_id  uuid,
  p_kind     text,
  p_actor_id uuid default null,
  p_post_id  uuid default null,
  p_body     text default null
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    return null;  -- nobody is notified about themselves
  end if;
  if char_length(coalesce(p_body, '')) > 500 then
    raise exception 'notification too long';
  end if;

  if not (
    public.are_friends(auth.uid(), p_user_id)
    or exists (
      select 1 from public.follows f
       where (f.follower_id = p_user_id   and f.followee_id = auth.uid())
          or (f.follower_id = auth.uid()  and f.followee_id = p_user_id)
    )
    or exists (
      select 1 from public.server_members a
        join public.server_members b on b.server_id = a.server_id
       where a.user_id = auth.uid() and b.user_id = p_user_id
    )
    or exists (
      select 1 from public.posts p where p.id = p_post_id and p.author_id = p_user_id
    )
  ) then
    return null;
  end if;

  insert into public.notifications (user_id, actor_id, kind, post_id, body)
  values (p_user_id, coalesce(p_actor_id, auth.uid()), p_kind, p_post_id, p_body)
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.notify(uuid, text, uuid, uuid, text) from public;
grant execute on function public.notify(uuid, text, uuid, uuid, text) to authenticated;

-- Redeem an invite: the code is a secret, so it is read and the roster row
-- written inside definer rights — the caller never sees either, and the
-- membership insert is the one door that bypasses the members policy.
-- Returns {server_id, already_member} so the Worker can answer honestly
-- without being able to read the invite row itself.
drop function if exists public.join_by_invite(text);
create or replace function public.join_by_invite(p_code text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_server  uuid;
  v_uses    integer;
  v_max     integer;
  v_exp     timestamptz;
  v_revoked boolean;
  v_code    text;
  v_joined  boolean := false;
  v_role    uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  v_code := upper(trim(coalesce(p_code, '')));

  select server_id, uses, max_uses, expires_at, revoked
    into v_server, v_uses, v_max, v_exp, v_revoked
    from public.invites
   where code = v_code;

  if v_server is null then
    raise exception 'invite not found';
  end if;
  if v_revoked then
    raise exception 'invite revoked';
  end if;
  if v_exp is not null and v_exp < now() then
    raise exception 'invite expired';
  end if;
  if v_max is not null and v_uses >= v_max then
    raise exception 'invite exhausted';
  end if;

  if exists (
    select 1 from public.server_members
     where server_id = v_server and user_id = auth.uid()
  ) then
    -- idempotent: a second redeem neither burns a use nor re-adds
    return jsonb_build_object('server_id', v_server, 'already_member', true);
  end if;

  -- New members land in the server's default role, so the permissions the
  -- server chose for everyone apply from the first message.
  select id into v_role
    from public.server_roles
   where server_id = v_server and is_default
   order by position limit 1;

  insert into public.server_members (server_id, user_id, role_id)
  values (v_server, auth.uid(), v_role);

  update public.invites set uses = uses + 1 where code = v_code;

  insert into public.server_audit (server_id, actor_id, action, detail)
  values (v_server, auth.uid(), 'member.join', 'joined by invite');

  v_joined := true;
  return jsonb_build_object('server_id', v_server, 'already_member', not v_joined);
end;
$$;

revoke all on function public.join_by_invite(text) from public;
grant execute on function public.join_by_invite(text) to authenticated;

-- ==========================================================================
-- Phase 3 — row level security
-- ==========================================================================

-- ---- profiles --------------------------------------------------------------
-- Identity (name, avatar, friend code, rarity) is directory information: it
-- is how people find each other, and 0001 already published it. What private
-- accounts actually hide — their posts — is gated by can_view_posts below.
alter table public.profiles enable row level security;

drop policy if exists "profiles are public to read" on public.profiles;
create policy "profiles are public to read"
  on public.profiles for select
  using (true);

drop policy if exists "profiles: owner inserts own row" on public.profiles;
create policy "profiles: owner inserts own row"
  on public.profiles for insert
  with check (id = auth.uid());

drop policy if exists "profiles: owner writes" on public.profiles;
create policy "profiles: owner writes"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- No DELETE policy: an account row leaves with its auth user, never by request.

-- ---- friendships -----------------------------------------------------------
alter table public.friendships enable row level security;

drop policy if exists "friendships: parties read" on public.friendships;
create policy "friendships: parties read"
  on public.friendships for select
  using (a_id = auth.uid() or b_id = auth.uid());

drop policy if exists "friendships: a party inserts the pair" on public.friendships;
create policy "friendships: a party inserts the pair"
  on public.friendships for insert
  with check (a_id = auth.uid() or b_id = auth.uid());

drop policy if exists "friendships: a party removes the pair" on public.friendships;
create policy "friendships: a party removes the pair"
  on public.friendships for delete
  using (a_id = auth.uid() or b_id = auth.uid());

-- ---- friend requests -------------------------------------------------------
alter table public.friend_requests enable row level security;

drop policy if exists "friend_requests: parties read" on public.friend_requests;
create policy "friend_requests: parties read"
  on public.friend_requests for select
  using (sender_id = auth.uid() or target_id = auth.uid());

drop policy if exists "friend_requests: sender inserts" on public.friend_requests;
create policy "friend_requests: sender inserts"
  on public.friend_requests for insert
  with check (sender_id = auth.uid());

drop policy if exists "friend_requests: target decides" on public.friend_requests;
create policy "friend_requests: target decides"
  on public.friend_requests for update
  using (target_id = auth.uid())
  with check (target_id = auth.uid());

drop policy if exists "friend_requests: parties remove" on public.friend_requests;
create policy "friend_requests: parties remove"
  on public.friend_requests for delete
  using (sender_id = auth.uid() or target_id = auth.uid());

-- ---- messages --------------------------------------------------------------
alter table public.messages enable row level security;

-- A row is visible only to its two participants. Nothing widens that.
drop policy if exists "messages: participants read" on public.messages;
create policy "messages: participants read"
  on public.messages for select
  using (sender_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists "messages: sender writes to a friend" on public.messages;
create policy "messages: sender writes to a friend"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and recipient_id <> auth.uid()
    and public.are_friends(auth.uid(), recipient_id)
  );

-- No UPDATE (history is not editable) and no DELETE from the client: the
-- conversation belongs to both sides.

-- ---- notifications ---------------------------------------------------------
alter table public.notifications enable row level security;

drop policy if exists "notifications: owner reads" on public.notifications;
create policy "notifications: owner reads"
  on public.notifications for select
  using (user_id = auth.uid());

drop policy if exists "notifications: owner marks read" on public.notifications;
create policy "notifications: owner marks read"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "notifications: owner clears" on public.notifications;
create policy "notifications: owner clears"
  on public.notifications for delete
  using (user_id = auth.uid());

-- Deliberately no INSERT policy: nobody writes into someone else's inbox
-- through PostgREST. notify() above is the only way in.

-- ---- follows ---------------------------------------------------------------
alter table public.follows enable row level security;

drop policy if exists "follows: parties read" on public.follows;
create policy "follows: parties read"
  on public.follows for select
  using (follower_id = auth.uid() or followee_id = auth.uid());

drop policy if exists "follows: follower inserts" on public.follows;
create policy "follows: follower inserts"
  on public.follows for insert
  with check (follower_id = auth.uid());

drop policy if exists "follows: followee decides" on public.follows;
create policy "follows: followee decides"
  on public.follows for update
  using (followee_id = auth.uid())
  with check (followee_id = auth.uid());

drop policy if exists "follows: either side unfollows" on public.follows;
create policy "follows: either side unfollows"
  on public.follows for delete
  using (follower_id = auth.uid() or followee_id = auth.uid());

-- ---- blocks ----------------------------------------------------------------
alter table public.blocks enable row level security;

drop policy if exists "blocks: blocker reads" on public.blocks;
create policy "blocks: blocker reads"
  on public.blocks for select
  using (blocker_id = auth.uid() or blocked_id = auth.uid());

drop policy if exists "blocks: blocker inserts" on public.blocks;
create policy "blocks: blocker inserts"
  on public.blocks for insert
  with check (blocker_id = auth.uid());

drop policy if exists "blocks: blocker removes" on public.blocks;
create policy "blocks: blocker removes"
  on public.blocks for delete
  using (blocker_id = auth.uid());

-- ---- feed ------------------------------------------------------------------
alter table public.posts enable row level security;

drop policy if exists "posts: readable where the author allows" on public.posts;
create policy "posts: readable where the author allows"
  on public.posts for select
  using (public.can_view_posts(author_id));

drop policy if exists "posts: author inserts" on public.posts;
create policy "posts: author inserts"
  on public.posts for insert
  with check (author_id = auth.uid());

drop policy if exists "posts: author edits" on public.posts;
create policy "posts: author edits"
  on public.posts for update
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "posts: author removes" on public.posts;
create policy "posts: author removes"
  on public.posts for delete
  using (author_id = auth.uid());

alter table public.post_likes enable row level security;

drop policy if exists "post_likes: visible with the post" on public.post_likes;
create policy "post_likes: visible with the post"
  on public.post_likes for select
  using (exists (
    select 1 from public.posts p
     where p.id = post_id and public.can_view_posts(p.author_id)
  ));

drop policy if exists "post_likes: self" on public.post_likes;
create policy "post_likes: self"
  on public.post_likes for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.posts p
       where p.id = post_id and public.can_view_posts(p.author_id)
    )
  );

drop policy if exists "post_likes: self removes" on public.post_likes;
create policy "post_likes: self removes"
  on public.post_likes for delete
  using (user_id = auth.uid());

alter table public.post_comments enable row level security;

drop policy if exists "comments: visible with the post" on public.post_comments;
create policy "comments: visible with the post"
  on public.post_comments for select
  using (exists (
    select 1 from public.posts p
     where p.id = post_id and public.can_view_posts(p.author_id)
  ));

drop policy if exists "comments: author writes where visible" on public.post_comments;
create policy "comments: author writes where visible"
  on public.post_comments for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.posts p
       where p.id = post_id and public.can_view_posts(p.author_id)
    )
  );

drop policy if exists "comments: author removes" on public.post_comments;
create policy "comments: author removes"
  on public.post_comments for delete
  using (author_id = auth.uid());

alter table public.comment_likes enable row level security;

drop policy if exists "comment_likes: visible" on public.comment_likes;
create policy "comment_likes: visible"
  on public.comment_likes for select
  using (exists (
    select 1 from public.post_comments c
      join public.posts p on p.id = c.post_id
     where c.id = comment_id and public.can_view_posts(p.author_id)
  ));

drop policy if exists "comment_likes: self" on public.comment_likes;
create policy "comment_likes: self"
  on public.comment_likes for insert
  with check (user_id = auth.uid());

drop policy if exists "comment_likes: self removes" on public.comment_likes;
create policy "comment_likes: self removes"
  on public.comment_likes for delete
  using (user_id = auth.uid());

alter table public.bookmarks enable row level security;

-- A bookmark list is private reading: only its owner ever sees its rows.
drop policy if exists "bookmarks: owner reads" on public.bookmarks;
create policy "bookmarks: owner reads"
  on public.bookmarks for select
  using (user_id = auth.uid());

drop policy if exists "bookmarks: owner writes" on public.bookmarks;
create policy "bookmarks: owner writes"
  on public.bookmarks for insert
  with check (user_id = auth.uid());

drop policy if exists "bookmarks: owner removes" on public.bookmarks;
create policy "bookmarks: owner removes"
  on public.bookmarks for delete
  using (user_id = auth.uid());

alter table public.post_reports enable row level security;

drop policy if exists "reports: reporter or admin reads" on public.post_reports;
create policy "reports: reporter or admin reads"
  on public.post_reports for select
  using (reporter_id = auth.uid() or public.is_admin());

drop policy if exists "reports: reporter files" on public.post_reports;
create policy "reports: reporter files"
  on public.post_reports for insert
  with check (reporter_id = auth.uid());

-- ---- communities -----------------------------------------------------------
alter table public.servers enable row level security;

drop policy if exists "servers: members read" on public.servers;
create policy "servers: members read"
  on public.servers for select
  using (owner_id = auth.uid() or public.is_server_member(id));

drop policy if exists "servers: creator owns" on public.servers;
create policy "servers: creator owns"
  on public.servers for insert
  with check (owner_id = auth.uid());

-- `using` decides which rows a manager may touch; `with check` decides what
-- the row may become. Ownership is allowed to MOVE (that is what a transfer
-- is), so the post-update check asks only that the caller is still inside the
-- server — the Worker separately requires MANAGE_SERVER for the transfer.
drop policy if exists "servers: managers update" on public.servers;
create policy "servers: managers update"
  on public.servers for update
  using (owner_id = auth.uid() or public.server_can(id, 1))
  with check (owner_id = auth.uid() or public.is_server_member(id));

drop policy if exists "servers: owner deletes" on public.servers;
create policy "servers: owner deletes"
  on public.servers for delete
  using (owner_id = auth.uid());

alter table public.server_roles enable row level security;

drop policy if exists "roles: members read" on public.server_roles;
create policy "roles: members read"
  on public.server_roles for select
  using (public.is_server_member(server_id) or public.is_server_owner(server_id));

drop policy if exists "roles: managers create" on public.server_roles;
create policy "roles: managers create"
  on public.server_roles for insert
  with check (public.server_can(server_id, 4));

drop policy if exists "roles: managers update" on public.server_roles;
create policy "roles: managers update"
  on public.server_roles for update
  using (public.server_can(server_id, 4))
  with check (public.server_can(server_id, 4));

-- Only a manager with MANAGE_ROLES may remove one; members pointing at it
-- are nulled by the foreign key's ON DELETE SET NULL.
drop policy if exists "roles: managers remove" on public.server_roles;
create policy "roles: managers remove"
  on public.server_roles for delete
  using (public.server_can(server_id, 4));


alter table public.server_members enable row level security;

drop policy if exists "members: server members read roster" on public.server_members;
create policy "members: server members read roster"
  on public.server_members for select
  using (public.is_server_member(server_id) or public.is_server_owner(server_id));

-- Two doors in: the owner bootstrapping their own membership, or a manager
-- with KICK adding someone. Ordinary joins go through join_by_invite(), which
-- runs with definer rights and is not subject to this policy.
drop policy if exists "members: owner or manager adds" on public.server_members;
create policy "members: owner or manager adds"
  on public.server_members for insert
  with check (
    (user_id = auth.uid() and public.is_server_owner(server_id))
    or public.server_can(server_id, 8)
  );

-- Deliberately NOT "or user_id = auth.uid()": a member who could edit their
-- own row could give themselves a better role_id. Role assignment belongs to
-- someone holding MANAGE_ROLES, or the role_id is left alone.
drop policy if exists "members: managers change roles" on public.server_members;
create policy "members: managers change roles"
  on public.server_members for update
  using (public.server_can(server_id, 4))
  with check (public.server_can(server_id, 4));

drop policy if exists "members: leave or kick" on public.server_members;
create policy "members: leave or kick"
  on public.server_members for delete
  using (user_id = auth.uid() or public.server_can(server_id, 8));

alter table public.channels enable row level security;

drop policy if exists "channels: members read" on public.channels;
create policy "channels: members read"
  on public.channels for select
  using (public.is_server_member(server_id) or public.is_server_owner(server_id));

drop policy if exists "channels: managers create" on public.channels;
create policy "channels: managers create"
  on public.channels for insert
  with check (public.server_can(server_id, 2));

drop policy if exists "channels: managers update" on public.channels;
create policy "channels: managers update"
  on public.channels for update
  using (public.server_can(server_id, 2))
  with check (public.server_can(server_id, 2));

drop policy if exists "channels: managers remove" on public.channels;
create policy "channels: managers remove"
  on public.channels for delete
  using (public.server_can(server_id, 2));

alter table public.server_messages enable row level security;

drop policy if exists "server_messages: members read" on public.server_messages;
create policy "server_messages: members read"
  on public.server_messages for select
  using (public.is_server_member(public.channel_server(channel_id)));

drop policy if exists "server_messages: members with SEND_MESSAGES write" on public.server_messages;
create policy "server_messages: members with SEND_MESSAGES write"
  on public.server_messages for insert
  with check (
    author_id = auth.uid()
    and public.server_can(public.channel_server(channel_id), 32)
  );

drop policy if exists "server_messages: author or MANAGE_MESSAGES edits" on public.server_messages;
create policy "server_messages: author or MANAGE_MESSAGES edits"
  on public.server_messages for update
  using (
    author_id = auth.uid()
    or public.server_can(public.channel_server(channel_id), 16)
  )
  with check (
    author_id = auth.uid()
    or public.server_can(public.channel_server(channel_id), 16)
  );

drop policy if exists "server_messages: author or MANAGE_MESSAGES removes" on public.server_messages;
create policy "server_messages: author or MANAGE_MESSAGES removes"
  on public.server_messages for delete
  using (
    author_id = auth.uid()
    or public.server_can(public.channel_server(channel_id), 16)
  );

alter table public.invites enable row level security;

-- Codes are secrets: only the server's own inviters can list them. Redemption
-- goes through join_by_invite(), which never exposes the row.
drop policy if exists "invites: inviters read" on public.invites;
create policy "invites: inviters read"
  on public.invites for select
  using (public.server_can(server_id, 64));

drop policy if exists "invites: inviters create" on public.invites;
create policy "invites: inviters create"
  on public.invites for insert
  with check (created_by = auth.uid() and public.server_can(server_id, 64));

drop policy if exists "invites: inviters manage" on public.invites;
create policy "invites: inviters manage"
  on public.invites for update
  using (public.server_can(server_id, 64))
  with check (public.server_can(server_id, 64));

drop policy if exists "invites: inviters revoke" on public.invites;
create policy "invites: inviters revoke"
  on public.invites for delete
  using (public.server_can(server_id, 64));

alter table public.server_audit enable row level security;

drop policy if exists "audit: managers read" on public.server_audit;
create policy "audit: managers read"
  on public.server_audit for select
  using (public.server_can(server_id, 1));

-- Append-only for members: there is no UPDATE or DELETE policy at all.
drop policy if exists "audit: members append" on public.server_audit;
create policy "audit: members append"
  on public.server_audit for insert
  with check (actor_id = auth.uid() and public.is_server_member(server_id));

-- ---- store -----------------------------------------------------------------
alter table public.store_submissions enable row level security;

drop policy if exists "store: approved or own are readable" on public.store_submissions;
create policy "store: approved or own are readable"
  on public.store_submissions for select
  using (status = 'approved' or submitter_id = auth.uid() or public.is_admin());

drop policy if exists "store: signed in submits as themselves" on public.store_submissions;
create policy "store: signed in submits as themselves"
  on public.store_submissions for insert
  with check (submitter_id = auth.uid() and status = 'pending' and reviewed_at is null);

drop policy if exists "store: admins review" on public.store_submissions;
create policy "store: admins review"
  on public.store_submissions for update
  using (public.is_admin())
  with check (public.is_admin());

-- ==========================================================================
-- Phase 4 — storage + grants
-- ==========================================================================

insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

-- PostgREST speaks as `anon` or `authenticated`. `anon` gets no table access
-- at all: an unauthenticated publishable key can reach the API's health probe
-- and nothing else. `authenticated` gets the verbs, and RLS decides which of
-- them may actually apply to which rows.
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
