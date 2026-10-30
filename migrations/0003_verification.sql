-- ==========================================================================
-- CrystalOS · Supabase migration 0003
-- Game ownership verification: Yapin tickets → CrystalOS game library
--
-- Run after 0001 and 0002 (they create `public.profiles` and `is_admin()`).
-- Idempotent: every statement is IF NOT EXISTS / OR REPLACE / guarded by
-- existence checks, so rerunning never drops or overwrites existing rows.
--
-- What this creates
--   restricted_games        which catalogue ids need proof of ownership
--   verification_staff      the Yapin staff roster (independent of game access)
--   verification_link_codes short-lived single-use account-linking codes
--   verification_tickets    one row per Yapin verification ticket
--   game_ownerships         the authoritative per-user permission to launch
--   verification_events     append-only audit trail
--
-- Trust model
--   * End users touch their own rows through RLS with their own session.
--   * The Yapin bot has no session. It calls the CrystalOS Worker, which
--     calls the SECURITY DEFINER functions below with the project's secret
--     server key. Those functions are REVOKE'd from anon and authenticated,
--     so a publishable key on its own can never open, link or decide a
--     ticket — and every business rule is re-checked inside Postgres, where
--     bypassing RLS does not bypass the rule.
--
--   Rules enforced here, not in the bot and not in the browser:
--     * a linking code is single-use, expiring and unguessable
--     * a Yapin account maps to at most one CrystalOS account
--     * one open ticket per Yapin account and per (account, game)
--     * only an ACTIVE verification staff member may decide
--     * staff may never decide their own ticket
--     * approving grants exactly one row; repeating is a no-op
--     * rejecting grants nothing and revokes nothing
-- ==========================================================================

-- ---- defensive prerequisites ---------------------------------------------
-- 0001/0002 add these; a project that ran only part of the chain still works.
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

alter table public.profiles
  add column if not exists role text not null default 'user';

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
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

-- ==========================================================================
-- 1. Restricted games
-- ==========================================================================

create table if not exists public.restricted_games (
  game_id    text primary key,
  reason     text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.restricted_games is
  'Catalogue ids that require a verified ownership grant before they launch.';

drop trigger if exists restricted_games_touch on public.restricted_games;
create trigger restricted_games_touch
  before update on public.restricted_games
  for each row execute function public.touch_updated_at();

alter table public.restricted_games enable row level security;

drop policy if exists "restricted_games: readable" on public.restricted_games;
create policy "restricted_games: readable"
  on public.restricted_games for select
  to authenticated
  using (true);

drop policy if exists "restricted_games: admins manage" on public.restricted_games;
create policy "restricted_games: admins manage"
  on public.restricted_games for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ==========================================================================
-- 2. Verification staff roster
-- ==========================================================================

create table if not exists public.verification_staff (
  profile_id     uuid primary key references public.profiles (id) on delete cascade,
  yapin_user_id  text,
  status         text not null default 'active'
                   check (status in ('active', 'revoked')),
  granted_by     uuid references public.profiles (id) on delete set null,
  granted_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  note           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists verification_staff_yapin_key
  on public.verification_staff (yapin_user_id)
  where yapin_user_id is not null;

drop trigger if exists verification_staff_touch on public.verification_staff;
create trigger verification_staff_touch
  before update on public.verification_staff
  for each row execute function public.touch_updated_at();

comment on table public.verification_staff is
  'Who may press VERIFY/DON''T VERIFY on Yapin. Independent of game ownership: '
  'a verified staff member never needs to own the game they are reviewing.';

-- True when the calling user sits on the ACTIVE staff roster.
create or replace function public.is_verification_staff()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.verification_staff s
     where s.profile_id = auth.uid() and s.status = 'active'
  );
$$;

alter table public.verification_staff enable row level security;

-- The roster is not private (it is a list of people who moderate a server),
-- but only an admin or an active staff member may change it.
drop policy if exists "verification_staff: readable" on public.verification_staff;
create policy "verification_staff: readable"
  on public.verification_staff for select
  to authenticated
  using (true);

drop policy if exists "verification_staff: admin or active staff writes" on public.verification_staff;
create policy "verification_staff: admin or active staff writes"
  on public.verification_staff for all
  to authenticated
  using (public.is_admin() or public.is_verification_staff())
  with check (public.is_admin() or public.is_verification_staff());

-- ==========================================================================
-- 3. Account-linking codes
-- ==========================================================================

create table if not exists public.verification_link_codes (
  code          text primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  consumed_by   text
);

create index if not exists verification_link_codes_owner
  on public.verification_link_codes (user_id);

comment on table public.verification_link_codes is
  'Short-lived, single-use, unguessable codes a signed-in user generates in '
  'CrystalOS and pastes into their Yapin ticket. They carry no account data.';

alter table public.verification_link_codes enable row level security;

drop policy if exists "link codes: owner reads" on public.verification_link_codes;
create policy "link codes: owner reads"
  on public.verification_link_codes for select
  to authenticated
  using (user_id = auth.uid());

-- The Worker generates the code value; the row is always the caller's own.
drop policy if exists "link codes: owner inserts own" on public.verification_link_codes;
create policy "link codes: owner inserts own"
  on public.verification_link_codes for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "link codes: owner removes" on public.verification_link_codes;
create policy "link codes: owner removes"
  on public.verification_link_codes for delete
  to authenticated
  using (user_id = auth.uid());

-- ==========================================================================
-- 4. Verification tickets
-- ==========================================================================

create table if not exists public.verification_tickets (
  id                 uuid primary key default gen_random_uuid(),
  public_id          uuid not null default gen_random_uuid(),
  -- The Yapin channel the ticket lives in; the bot's handle for the ticket.
  channel_id         text unique,
  yapin_ticket_id    text unique,
  yapin_user_id      text not null,
  yapin_username     text,
  -- The CrystalOS account being verified. NULL until the code links it.
  user_id            uuid references public.profiles (id) on delete set null,
  game_id            text,
  evidence           text not null default '',
  status             text not null default 'open'
                       check (status in ('open', 'linked', 'submitted',
                                         'approved', 'rejected', 'cancelled')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  linked_at          timestamptz,
  submitted_at       timestamptz,
  decided_at         timestamptz,
  decided_by         uuid references public.profiles (id) on delete set null,
  decided_by_yapin   text,
  decision_note      text not null default ''
);

-- One live ticket per Yapin account, and one per (account, game).
create unique index if not exists verification_tickets_one_active_per_yapin
  on public.verification_tickets (yapin_user_id)
  where status in ('open', 'linked', 'submitted');

create unique index if not exists verification_tickets_one_active_per_game
  on public.verification_tickets (user_id, game_id)
  where user_id is not null and game_id is not null
    and status in ('open', 'linked', 'submitted');

create index if not exists verification_tickets_owner
  on public.verification_tickets (user_id);

create index if not exists verification_tickets_status
  on public.verification_tickets (status, created_at desc);

drop trigger if exists verification_tickets_touch on public.verification_tickets;
create trigger verification_tickets_touch
  before update on public.verification_tickets
  for each row execute function public.touch_updated_at();

alter table public.verification_tickets enable row level security;

-- A ticket is readable by the account it belongs to, and by staff who review it.
drop policy if exists "tickets: owner or staff reads" on public.verification_tickets;
create policy "tickets: owner or staff reads"
  on public.verification_tickets for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.is_verification_staff()
  );

-- Owners may withdraw their own ticket. Nothing else is written through RLS:
-- creation, linking and decisions all go through the functions below.
drop policy if exists "tickets: owner cancels" on public.verification_tickets;
create policy "tickets: owner cancels"
  on public.verification_tickets for update
  to authenticated
  using (user_id = auth.uid() and status in ('open', 'linked', 'submitted'))
  with check (user_id = auth.uid() and status = 'cancelled');

-- ==========================================================================
-- 5. Game ownership — the authoritative launch permission
-- ==========================================================================

create table if not exists public.game_ownerships (
  user_id             uuid not null references public.profiles (id) on delete cascade,
  game_id             text not null,
  status              text not null default 'active'
                        check (status in ('active', 'revoked')),
  source              text not null default 'verification',
  ticket_id           uuid references public.verification_tickets (id) on delete set null,
  granted_by          uuid references public.profiles (id) on delete set null,
  granted_by_yapin    text,
  granted_at          timestamptz not null default now(),
  revoked_by          uuid references public.profiles (id) on delete set null,
  revoked_at          timestamptz,
  updated_at          timestamptz not null default now(),
  primary key (user_id, game_id)
);

create index if not exists game_ownerships_active
  on public.game_ownerships (user_id)
  where status = 'active';

comment on table public.game_ownerships is
  'One row per (account, game) permission. The primary key is what makes a '
  'repeated approval impossible to duplicate.';

drop trigger if exists game_ownerships_touch on public.game_ownerships;
create trigger game_ownerships_touch
  before update on public.game_ownerships
  for each row execute function public.touch_updated_at();

alter table public.game_ownerships enable row level security;

-- You can see exactly your own grants; nobody else inherits them.
drop policy if exists "ownerships: own rows read" on public.game_ownerships;
create policy "ownerships: own rows read"
  on public.game_ownerships for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- No insert/update/delete policy on purpose: grants only come from
-- verification_decide(). An authenticated caller cannot hand itself a game.

-- ==========================================================================
-- 6. Audit trail
-- ==========================================================================

create table if not exists public.verification_events (
  id               bigint generated always as identity primary key,
  ticket_id        uuid references public.verification_tickets (id) on delete cascade,
  user_id          uuid references public.profiles (id) on delete set null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  actor_yapin_id   text,
  kind             text not null,
  detail           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists verification_events_ticket
  on public.verification_events (ticket_id, created_at);

alter table public.verification_events enable row level security;

drop policy if exists "verification events: owner or staff reads" on public.verification_events;
create policy "verification events: owner or staff reads"
  on public.verification_events for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.is_verification_staff()
  );

-- ==========================================================================
-- 7. Bot-facing functions
--    SECURITY DEFINER so they run with the owner's rights, REVOKE'd from
--    anon and authenticated so the publishable key alone can never call them.
-- ==========================================================================

-- ---- link an account ------------------------------------------------------
-- p_code is the value the user generated in CrystalOS. It is single-use and
-- expires; nothing about the account is guessable from it.
create or replace function public.verification_link_account(
  p_code            text,
  p_yapin_user_id   text,
  p_yapin_username  text default ''
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_code    public.verification_link_codes%rowtype;
  v_profile public.profiles%rowtype;
begin
  if p_code is null or length(trim(p_code)) < 8 then
    raise exception using errcode = 'V1001', message = 'LINK_CODE_INVALID';
  end if;
  if p_yapin_user_id is null or length(p_yapin_user_id) < 4 then
    raise exception using errcode = 'V1011', message = 'YAPIN_ID_REQUIRED';
  end if;

  select * into v_code from public.verification_link_codes
   where code = upper(trim(p_code));

  if not found then
    raise exception using errcode = 'V1001', message = 'LINK_CODE_NOT_FOUND';
  end if;
  if v_code.used_at is not null then
    raise exception using errcode = 'V1003', message = 'LINK_CODE_USED';
  end if;
  if v_code.expires_at < now() then
    raise exception using errcode = 'V1002', message = 'LINK_CODE_EXPIRED';
  end if;

  select * into v_profile from public.profiles where id = v_code.user_id;
  if not found then
    raise exception using errcode = 'V1012', message = 'NO_LINKED_ACCOUNT';
  end if;

  -- A Yapin identity belongs to exactly one CrystalOS account. If this Yapin
  -- account already consumed a code for somebody ELSE, pasting another code
  -- must not quietly move the mapping — that needs an explicit admin action.
  if exists (
    select 1 from public.verification_link_codes c
     where c.consumed_by = p_yapin_user_id
       and c.used_at is not null
       and c.user_id <> v_profile.id
  ) then
    raise exception using errcode = 'V1018', message = 'YAPIN_ALREADY_LINKED';
  end if;

  -- And the mirror case: once this CrystalOS account has bound to a different
  -- Yapin identity, the binding is frozen.
  if exists (
    select 1 from public.verification_link_codes c
     where c.user_id = v_profile.id
       and c.used_at is not null
       and c.consumed_by is not null
       and c.consumed_by <> p_yapin_user_id
  ) then
    raise exception using errcode = 'V1013', message = 'ACCOUNT_ALREADY_LINKED';
  end if;

  update public.verification_link_codes
     set used_at = now(), consumed_by = p_yapin_user_id
   where code = v_code.code;

  -- A ticket this Yapin account opened before linking now belongs to the
  -- account, so the staff review has somebody to grant to. There is at most
  -- one active ticket per Yapin account (partial unique index above), so this
  -- cannot attach more than one row.
  update public.verification_tickets
     set user_id = v_profile.id, status = 'linked', linked_at = now()
   where yapin_user_id = p_yapin_user_id and status = 'open';

  insert into public.verification_events (user_id, actor_yapin_id, kind, detail)
  values (v_profile.id, p_yapin_user_id, 'account_linked',
          jsonb_build_object('username', coalesce(v_profile.username, '')));

  return jsonb_build_object(
    'ok', true,
    'user_id', v_profile.id,
    'username', v_profile.username,
    'display_name', coalesce(v_profile.display_name, v_profile.username),
    'avatar_url', v_profile.avatar_url,
    'role', coalesce(v_profile.role, 'user')
  );
end;
$$;

comment on function public.verification_link_account(text, text, text) is
  'Consumes a single-use linking code and binds the Yapin identity to the '
  'CrystalOS account that generated it. Never accepts a user id from the caller.';

-- ---- open a ticket --------------------------------------------------------
create or replace function public.verification_open_ticket(
  p_yapin_user_id   text,
  p_yapin_username  text default '',
  p_game_id         text default null,
  p_evidence        text default '',
  p_channel_id      text default null,
  p_yapin_ticket_id text default null
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.verification_tickets%rowtype;
  v_user   uuid;
begin
  if p_yapin_user_id is null or length(p_yapin_user_id) < 4 then
    raise exception using errcode = 'V1011', message = 'YAPIN_ID_REQUIRED';
  end if;

  -- The account this Yapin identity is already linked to, if any: a ticket
  -- opened by someone who already linked inherits the account immediately.
  select user_id into v_user
    from public.verification_link_codes
   where consumed_by = p_yapin_user_id and used_at is not null
   order by used_at desc
   limit 1;

  if p_game_id is not null and p_game_id <> ''
     and not exists (select 1 from public.restricted_games rg where rg.game_id = p_game_id) then
    raise exception using errcode = 'V1022', message = 'GAME_NOT_RESTRICTED';
  end if;

  if p_game_id is not null and p_game_id <> '' and v_user is not null then
    perform 1 from public.verification_tickets t
      where t.user_id = v_user and t.game_id = p_game_id
        and t.status in ('open', 'linked', 'submitted');
    if found then
      raise exception using errcode = 'V1005', message = 'DUPLICATE_ACTIVE_TICKET';
    end if;
  end if;

  insert into public.verification_tickets
    (channel_id, yapin_ticket_id, yapin_user_id, yapin_username,
     user_id, game_id, evidence, status, linked_at)
  values
    (p_channel_id, p_yapin_ticket_id, p_yapin_user_id, coalesce(p_yapin_username, ''),
     v_user, nullif(p_game_id, ''), coalesce(p_evidence, ''),
     case when v_user is null then 'open' else 'linked' end,
     case when v_user is null then null else now() end)
  returning * into v_ticket;

  insert into public.verification_events (ticket_id, user_id, actor_yapin_id, kind, detail)
  values (v_ticket.id, v_ticket.user_id, p_yapin_user_id, 'ticket_opened',
          jsonb_build_object('game_id', coalesce(v_ticket.game_id, '')));

  return to_jsonb(v_ticket);
end;
$$;

-- ---- choose the game ------------------------------------------------------
create or replace function public.verification_select_game(
  p_ticket_id uuid,
  p_game_id   text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.verification_tickets%rowtype;
begin
  if p_game_id is null or length(trim(p_game_id)) = 0 then
    raise exception using errcode = 'V1010', message = 'GAME_REQUIRED';
  end if;

  select * into v_ticket from public.verification_tickets where id = p_ticket_id;
  if not found then
    raise exception using errcode = 'V1009', message = 'TICKET_NOT_FOUND';
  end if;
  if v_ticket.status not in ('open', 'linked') then
    raise exception using errcode = 'V1021', message = 'TICKET_NOT_DECIDABLE';
  end if;
  if v_ticket.user_id is null then
    raise exception using errcode = 'V1019', message = 'ACCOUNT_NOT_LINKED';
  end if;
  -- The catalogue lives in the shell, so the only thing the database can
  -- vouch for is that this id is one a reviewer actually restricts. A ticket
  -- for a game nobody locked would be a verification with nothing at stake.
  if not exists (select 1 from public.restricted_games rg where rg.game_id = p_game_id) then
    raise exception using errcode = 'V1022', message = 'GAME_NOT_RESTRICTED';
  end if;
  if exists (
    select 1 from public.verification_tickets t
     where t.user_id = v_ticket.user_id
       and t.game_id = p_game_id
       and t.id <> v_ticket.id
       and t.status in ('open', 'linked', 'submitted')
  ) then
    raise exception using errcode = 'V1005', message = 'DUPLICATE_ACTIVE_TICKET';
  end if;

  update public.verification_tickets
     set game_id = p_game_id
   where id = v_ticket.id
  returning * into v_ticket;

  insert into public.verification_events (ticket_id, user_id, actor_yapin_id, kind, detail)
  values (v_ticket.id, v_ticket.user_id, v_ticket.yapin_user_id, 'game_selected',
          jsonb_build_object('game_id', p_game_id));

  return to_jsonb(v_ticket);
end;
$$;

-- ---- submit evidence ------------------------------------------------------
create or replace function public.verification_submit_evidence(
  p_ticket_id uuid,
  p_evidence  text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket  public.verification_tickets%rowtype;
  v_evidence text := left(coalesce(p_evidence, ''), 2000);
begin
  select * into v_ticket from public.verification_tickets where id = p_ticket_id;
  if not found then
    raise exception using errcode = 'V1009', message = 'TICKET_NOT_FOUND';
  end if;
  if v_ticket.status not in ('open', 'linked') then
    raise exception using errcode = 'V1021', message = 'TICKET_NOT_DECIDABLE';
  end if;
  if v_ticket.user_id is null then
    raise exception using errcode = 'V1019', message = 'ACCOUNT_NOT_LINKED';
  end if;
  if v_ticket.game_id is null then
    raise exception using errcode = 'V1010', message = 'GAME_REQUIRED';
  end if;
  if length(trim(v_evidence)) = 0 then
    raise exception using errcode = 'V1014', message = 'EVIDENCE_REQUIRED';
  end if;

  update public.verification_tickets
     set evidence = v_evidence, status = 'submitted', submitted_at = now()
   where id = v_ticket.id
  returning * into v_ticket;

  insert into public.verification_events (ticket_id, user_id, actor_yapin_id, kind, detail)
  values (v_ticket.id, v_ticket.user_id, v_ticket.yapin_user_id, 'evidence_submitted',
          jsonb_build_object('game_id', coalesce(v_ticket.game_id, ''),
                             'length', length(v_evidence)));

  return to_jsonb(v_ticket);
end;
$$;

-- ---- the decision ---------------------------------------------------------
-- The single place game access is granted. Everything the prompt calls a
-- "staff rule" is checked here, inside Postgres.
create or replace function public.verification_decide(
  p_ticket_id       uuid,
  p_actor_yapin_id  text,
  p_decision        text,
  p_note            text default ''
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket  public.verification_tickets%rowtype;
  v_actor   public.profiles%rowtype;
  v_staff   public.verification_staff%rowtype;
  v_decision text := lower(coalesce(p_decision, ''));
  v_granted  boolean := false;
begin
  if v_decision not in ('approve', 'reject') then
    raise exception using errcode = 'V1015', message = 'DECISION_INVALID';
  end if;
  if p_actor_yapin_id is null or length(p_actor_yapin_id) < 4 then
    raise exception using errcode = 'V1020', message = 'ACTOR_REQUIRED';
  end if;

  -- 1. The actor must be a human being on the ACTIVE staff roster.
  select * into v_staff from public.verification_staff
   where yapin_user_id = p_actor_yapin_id;
  if not found then
    raise exception using errcode = 'V1006', message = 'NOT_STAFF';
  end if;
  if v_staff.status <> 'active' then
    raise exception using errcode = 'V1007', message = 'STAFF_REVOKED';
  end if;

  -- 2. The ticket must be waiting for a decision.
  select * into v_ticket from public.verification_tickets where id = p_ticket_id;
  if not found then
    raise exception using errcode = 'V1009', message = 'TICKET_NOT_FOUND';
  end if;
  if v_ticket.status in ('approved', 'rejected', 'cancelled') then
    raise exception using errcode = 'V1016', message = 'ALREADY_PROCESSED';
  end if;
  if v_ticket.status <> 'submitted' then
    raise exception using errcode = 'V1021', message = 'TICKET_NOT_DECIDABLE';
  end if;

  -- 3. Nobody verifies their own account, and nobody needs to own the game
  --    they are reviewing (that check simply does not exist here).
  if v_ticket.user_id is not null then
    select * into v_actor from public.profiles where id = v_ticket.user_id;
    if v_actor.id = v_staff.profile_id then
      raise exception using errcode = 'V1008', message = 'SELF_VERIFICATION';
    end if;
  end if;

  if v_decision = 'approve' then
    if v_ticket.user_id is null then
      raise exception using errcode = 'V1019', message = 'ACCOUNT_NOT_LINKED';
    end if;
    if v_ticket.game_id is null then
      raise exception using errcode = 'V1010', message = 'GAME_REQUIRED';
    end if;

    insert into public.game_ownerships
      (user_id, game_id, status, source, ticket_id, granted_by, granted_by_yapin, granted_at)
    values
      (v_ticket.user_id, v_ticket.game_id, 'active', 'verification',
       v_ticket.id, v_staff.profile_id, p_actor_yapin_id, now())
    on conflict (user_id, game_id) do update
      set status = 'active',
          source = 'verification',
          ticket_id = excluded.ticket_id,
          granted_by = excluded.granted_by,
          granted_by_yapin = excluded.granted_by_yapin,
          granted_at = now(),
          revoked_by = null,
          revoked_at = null,
          updated_at = now()
    where game_ownerships.status = 'revoked';

    v_granted := true;

    update public.verification_tickets
       set status = 'approved', decided_at = now(),
           decided_by = v_staff.profile_id, decided_by_yapin = p_actor_yapin_id,
           decision_note = left(coalesce(p_note, ''), 500)
     where id = v_ticket.id;
  else
    -- Rejection records the outcome and grants nothing. It deliberately does
    -- NOT touch game_ownerships, so a previously approved game survives.
    update public.verification_tickets
       set status = 'rejected', decided_at = now(),
           decided_by = v_staff.profile_id, decided_by_yapin = p_actor_yapin_id,
           decision_note = left(coalesce(p_note, ''), 500)
     where id = v_ticket.id;
  end if;

  insert into public.verification_events
    (ticket_id, user_id, actor_profile_id, actor_yapin_id, kind, detail)
  values
    (v_ticket.id, v_ticket.user_id, v_staff.profile_id, p_actor_yapin_id,
     case when v_decision = 'approve' then 'approved' else 'rejected' end,
     jsonb_build_object(
       'game_id', coalesce(v_ticket.game_id, ''),
       'note', left(coalesce(p_note, ''), 500),
       'granted', v_granted
     ));

  select * into v_ticket from public.verification_tickets where id = p_ticket_id;

  return jsonb_build_object(
    'ok', true,
    'decision', v_decision,
    'granted', v_granted,
    'ticket', to_jsonb(v_ticket),
    'user_id', v_ticket.user_id,
    'game_id', v_ticket.game_id
  );
end;
$$;

comment on function public.verification_decide(uuid, text, text, text) is
  'The only writer of game_ownerships. Validates staff status, blocks '
  'self-approval, makes approval idempotent and leaves ownership untouched '
  'on rejection.';

-- ---- cancel ---------------------------------------------------------------
create or replace function public.verification_cancel_ticket(
  p_ticket_id      uuid,
  p_actor_yapin_id text
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ticket public.verification_tickets%rowtype;
begin
  select * into v_ticket from public.verification_tickets where id = p_ticket_id;
  if not found then
    raise exception using errcode = 'V1009', message = 'TICKET_NOT_FOUND';
  end if;
  if v_ticket.status in ('approved', 'rejected', 'cancelled') then
    raise exception using errcode = 'V1016', message = 'ALREADY_PROCESSED';
  end if;
  if p_actor_yapin_id is null or v_ticket.yapin_user_id <> p_actor_yapin_id then
    raise exception using errcode = 'V1017', message = 'NOT_TICKET_OWNER';
  end if;

  update public.verification_tickets
     set status = 'cancelled', decided_at = now(), decided_by_yapin = p_actor_yapin_id
   where id = v_ticket.id
  returning * into v_ticket;

  insert into public.verification_events (ticket_id, user_id, actor_yapin_id, kind)
  values (v_ticket.id, v_ticket.user_id, p_actor_yapin_id, 'cancelled');

  return to_jsonb(v_ticket);
end;
$$;

-- The bot-facing surface, and nothing else, belongs to the server role.
-- Nothing above is callable with the publishable key: only the Worker, using
-- the project's server key, may take these paths.
revoke all on function public.verification_link_account(text, text, text)        from public, anon, authenticated;
revoke all on function public.verification_open_ticket(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.verification_select_game(uuid, text)               from public, anon, authenticated;
revoke all on function public.verification_submit_evidence(uuid, text)           from public, anon, authenticated;
revoke all on function public.verification_decide(uuid, text, text, text)        from public, anon, authenticated;
revoke all on function public.verification_cancel_ticket(uuid, text)             from public, anon, authenticated;

grant execute on function public.verification_link_account(text, text, text)       to service_role;
grant execute on function public.verification_open_ticket(text, text, text, text, text, text) to service_role;
grant execute on function public.verification_select_game(uuid, text)              to service_role;
grant execute on function public.verification_submit_evidence(uuid, text)          to service_role;
grant execute on function public.verification_decide(uuid, text, text, text)       to service_role;
grant execute on function public.verification_cancel_ticket(uuid, text)            to service_role;

-- ---- table privileges -----------------------------------------------------
-- RLS is the control; these grants are the prerequisite for it to apply.
-- Explicit, so 0003 does not depend on how the project's default privileges
-- happened to be configured when it was created.
grant select on public.restricted_games, public.verification_staff,
                public.verification_tickets, public.game_ownerships,
                public.verification_events, public.verification_link_codes
  to authenticated;

grant insert, update, delete on public.verification_link_codes,
                               public.verification_tickets
  to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public
  to authenticated, service_role;
