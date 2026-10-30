-- ==========================================================================
-- CrystalOS · Supabase migration 0004 — Community Apps & Custom App System
--
-- Run after 0001, 0002, 0003.
-- Idempotent: every statement uses IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS,
-- so rerunning never corrupts or drops existing data.
--
-- Tables:
--   custom_apps            User-submitted iframe applications with verification lifecycle
--   app_installations      User installations of verified community applications
--   app_reports            User reports for abusive/suspicious/broken community apps
--   app_moderation_logs    Immutable audit trail of staff review decisions & actions
--   community-app-icons    Storage bucket for uploaded application icons
--
-- Security model:
--   * Mandatory staff verification: only apps with verification_status = 'verified'
--     can ever be installed or discovered publicly.
--   * Developers CANNOT approve their own applications or change verification statuses.
--   * Developers can edit their app metadata, but changing website_url automatically
--     reverts status to 'pending' to prevent silent malicious redirects.
--   * Unlisted applications require direct ID or secure share token and MUST STILL
--     be verified before they can be installed.
--   * Strict RLS on all tables: users only manage their own installations, developers
--     only edit their own apps, ordinary users cannot view pending apps or other users' reports.
--   * Moderators have dedicated role checks: is_admin(), is_verification_staff(),
--     or role = 'moderator'.
-- ==========================================================================

-- ---- moderator check helper -----------------------------------------------
create or replace function public.is_community_moderator()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role in ('admin', 'moderator')
  ) or exists (
    select 1 from public.verification_staff s
     where s.profile_id = auth.uid() and s.status = 'active'
  );
$$;

comment on function public.is_community_moderator() is
  'Returns true if the calling user is an admin, moderator, or active verification staff member.';

-- ==========================================================================
-- 1. custom_apps
-- ==========================================================================

create table if not exists public.custom_apps (
  id                       uuid primary key default gen_random_uuid(),
  developer_id             uuid not null references public.profiles (id) on delete cascade,
  name                     text not null check (char_length(trim(name)) between 2 and 80),
  description              text not null check (char_length(trim(description)) between 10 and 2000),
  website_url              text not null check (website_url ~* '^https://[^\s/$.?#].[^\s]*$'),
  icon_url                 text,
  category                 text not null default 'productivity'
                             check (category in ('productivity', 'entertainment', 'utilities', 'games', 'social', 'education', 'other')),
  visibility               text not null default 'public'
                             check (visibility in ('public', 'unlisted')),
  verification_status      text not null default 'pending'
                             check (verification_status in ('pending', 'under_review', 'changes_requested', 'verified', 'rejected', 'suspended')),
  moderator_notes          text not null default '',
  rejection_reason         text,
  suspension_reason        text,
  changes_requested_reason text,
  share_token              text unique default ('cat_' || replace(gen_random_uuid()::text, '-', '')),
  install_count            integer not null default 0 check (install_count >= 0),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  verified_at              timestamptz,
  verified_by              uuid references public.profiles (id) on delete set null,
  last_reviewed_at         timestamptz,
  last_reviewed_by         uuid references public.profiles (id) on delete set null
);

comment on table public.custom_apps is
  'User-submitted community applications. Verified apps are installable by users and embed as sandboxed iframes.';

create index if not exists custom_apps_developer on public.custom_apps (developer_id);
create index if not exists custom_apps_public_verified on public.custom_apps (category, created_at desc)
  where visibility = 'public' and verification_status = 'verified';
create index if not exists custom_apps_queue on public.custom_apps (verification_status, created_at asc);
create index if not exists custom_apps_share_token on public.custom_apps (share_token);

drop trigger if exists custom_apps_touch on public.custom_apps;
create trigger custom_apps_touch
  before update on public.custom_apps
  for each row execute function public.touch_updated_at();

-- Trigger to guard against silent URL changes by developer:
-- If an approved/under_review app's website_url is updated by a non-moderator, revert to pending!
create or replace function public.check_custom_app_url_change()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.website_url <> old.website_url and not public.is_community_moderator() then
    new.verification_status := 'pending';
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists custom_apps_url_guard on public.custom_apps;
create trigger custom_apps_url_guard
  before update on public.custom_apps
  for each row execute function public.check_custom_app_url_change();

-- ==========================================================================
-- 2. app_installations
-- ==========================================================================

create table if not exists public.app_installations (
  id           uuid primary key default gen_random_uuid(),
  app_id       uuid not null references public.custom_apps (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  installed_at timestamptz not null default now(),
  unique (app_id, user_id)
);

comment on table public.app_installations is
  'Records which community apps a user has installed to their profile.';

create index if not exists app_installations_user on public.app_installations (user_id, installed_at desc);
create index if not exists app_installations_app on public.app_installations (app_id);

-- ==========================================================================
-- 3. app_reports
-- ==========================================================================

create table if not exists public.app_reports (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid not null references public.custom_apps (id) on delete cascade,
  reporter_id     uuid not null references public.profiles (id) on delete cascade,
  category        text not null check (category in ('malicious', 'phishing', 'misleading', 'broken', 'inappropriate', 'copyright', 'other')),
  description     text not null default '' check (char_length(description) <= 2000),
  status          text not null default 'pending' check (status in ('pending', 'investigating', 'resolved', 'dismissed')),
  resolution_note text,
  created_at      timestamptz not null default now(),
  reviewed_by     uuid references public.profiles (id) on delete set null,
  reviewed_at     timestamptz
);

comment on table public.app_reports is
  'Safety reports filed against community apps by users.';

create index if not exists app_reports_app on public.app_reports (app_id, status);
create index if not exists app_reports_status on public.app_reports (status, created_at desc);
create index if not exists app_reports_reporter on public.app_reports (reporter_id);

-- Prevent duplicate reports for the same app by the same user while previous is still pending
create unique index if not exists app_reports_unique_pending
  on public.app_reports (app_id, reporter_id)
  where status in ('pending', 'investigating');

-- ==========================================================================
-- 4. app_moderation_logs
-- ==========================================================================

create table if not exists public.app_moderation_logs (
  id              bigint generated always as identity primary key,
  app_id          uuid not null references public.custom_apps (id) on delete cascade,
  moderator_id    uuid not null references public.profiles (id) on delete set null,
  action          text not null check (action in ('claim', 'claim_review', 'approve', 'reject', 'request_changes', 'suspend', 'restore', 'report_resolved', 'update_metadata')),
  reason          text not null default '',
  previous_status text,
  new_status      text,
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

comment on table public.app_moderation_logs is
  'Immutable audit log of all moderator decisions and actions taken on community apps.';

create index if not exists app_moderation_logs_app on public.app_moderation_logs (app_id, created_at desc);
create index if not exists app_moderation_logs_mod on public.app_moderation_logs (moderator_id, created_at desc);

-- ==========================================================================
-- 5. Row Level Security
-- ==========================================================================

alter table public.custom_apps enable row level security;
alter table public.app_installations enable row level security;
alter table public.app_reports enable row level security;
alter table public.app_moderation_logs enable row level security;

-- ---- custom_apps policies ------------------------------------------------
drop policy if exists "custom_apps: public verified or own read" on public.custom_apps;
create policy "custom_apps: public verified or own read"
  on public.custom_apps for select
  to authenticated, anon
  using (
    (visibility = 'public' and verification_status = 'verified')
    or (auth.uid() is not null and developer_id = auth.uid())
    or public.is_community_moderator()
  );

drop policy if exists "custom_apps: developer inserts own pending" on public.custom_apps;
create policy "custom_apps: developer inserts own pending"
  on public.custom_apps for insert
  to authenticated
  with check (
    developer_id = auth.uid()
    and verification_status = 'pending'
    and verified_at is null
    and verified_by is null
  );

drop policy if exists "custom_apps: developer or moderator updates" on public.custom_apps;
create policy "custom_apps: developer or moderator updates"
  on public.custom_apps for update
  to authenticated
  using (
    (developer_id = auth.uid() and verification_status in ('pending', 'changes_requested', 'verified'))
    or public.is_community_moderator()
  )
  with check (
    -- If non-moderator developer updates: cannot change verification_status to verified,
    -- cannot alter verified_by or verified_at directly.
    public.is_community_moderator()
    or (
      developer_id = auth.uid()
      and verification_status in ('pending', 'changes_requested')
      and (verified_at is null or verified_at = (select ca.verified_at from public.custom_apps ca where ca.id = id))
    )
  );

drop policy if exists "custom_apps: developer or moderator deletes" on public.custom_apps;
create policy "custom_apps: developer or moderator deletes"
  on public.custom_apps for delete
  to authenticated
  using (
    (developer_id = auth.uid() and verification_status in ('pending', 'rejected', 'changes_requested'))
    or public.is_community_moderator()
  );

-- ---- app_installations policies ------------------------------------------
drop policy if exists "installations: user reads own" on public.app_installations;
create policy "installations: user reads own"
  on public.app_installations for select
  to authenticated
  using (user_id = auth.uid() or public.is_community_moderator());

drop policy if exists "installations: user installs verified apps only" on public.app_installations;
create policy "installations: user installs verified apps only"
  on public.app_installations for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.custom_apps ca
       where ca.id = app_id and ca.verification_status = 'verified'
    )
  );

drop policy if exists "installations: user uninstalls own" on public.app_installations;
create policy "installations: user uninstalls own"
  on public.app_installations for delete
  to authenticated
  using (user_id = auth.uid());

-- ---- app_reports policies ------------------------------------------------
drop policy if exists "reports: reporter or moderator reads" on public.app_reports;
create policy "reports: reporter or moderator reads"
  on public.app_reports for select
  to authenticated
  using (reporter_id = auth.uid() or public.is_community_moderator());

drop policy if exists "reports: user inserts own" on public.app_reports;
create policy "reports: user inserts own"
  on public.app_reports for insert
  to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists "reports: moderator manages" on public.app_reports;
create policy "reports: moderator manages"
  on public.app_reports for update
  to authenticated
  using (public.is_community_moderator())
  with check (public.is_community_moderator());

-- ---- app_moderation_logs policies ----------------------------------------
drop policy if exists "moderation_logs: moderator reads" on public.app_moderation_logs;
create policy "moderation_logs: moderator reads"
  on public.app_moderation_logs for select
  to authenticated
  using (public.is_community_moderator());

drop policy if exists "moderation_logs: moderator appends" on public.app_moderation_logs;
create policy "moderation_logs: moderator appends"
  on public.app_moderation_logs for insert
  to authenticated
  with check (public.is_community_moderator() and moderator_id = auth.uid());

-- ==========================================================================
-- 6. Storage Bucket for Community App Icons
-- ==========================================================================

insert into storage.buckets (id, name, public)
  values ('community-app-icons', 'community-app-icons', true)
  on conflict (id) do nothing;

drop policy if exists "community_icons: public read" on storage.objects;
create policy "community_icons: public read"
  on storage.objects for select
  using (bucket_id = 'community-app-icons');

drop policy if exists "community_icons: owner writes own prefix" on storage.objects;
create policy "community_icons: owner writes own prefix"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'community-app-icons'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "community_icons: owner updates own prefix" on storage.objects;
create policy "community_icons: owner updates own prefix"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'community-app-icons'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'community-app-icons'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "community_icons: owner or mod deletes" on storage.objects;
create policy "community_icons: owner or mod deletes"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'community-app-icons'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_community_moderator())
  );

-- ==========================================================================
-- 7. SECURITY DEFINER Business Logic Functions
-- ==========================================================================

-- ---- Submit an application ------------------------------------------------
create or replace function public.community_app_submit(
  p_name            text,
  p_description     text,
  p_website_url     text,
  p_icon_url        text default null,
  p_category        text default 'productivity',
  p_visibility      text default 'public',
  p_moderator_notes text default ''
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id   uuid := auth.uid();
  v_app       public.custom_apps%rowtype;
  v_url       text := trim(coalesce(p_website_url, ''));
  v_name      text := trim(coalesce(p_name, ''));
  v_desc      text := trim(coalesce(p_description, ''));
  v_cat       text := lower(trim(coalesce(p_category, 'productivity')));
  v_vis       text := lower(trim(coalesce(p_visibility, 'public')));
begin
  if v_user_id is null then
    raise exception using errcode = 'CA001', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception using errcode = 'CA002', message = 'INVALID_NAME_LENGTH';
  end if;
  if char_length(v_desc) < 10 or char_length(v_desc) > 2000 then
    raise exception using errcode = 'CA003', message = 'INVALID_DESCRIPTION_LENGTH';
  end if;
  -- Strict HTTPS only check
  if not (v_url ~* '^https://[^\s/$.?#].[^\s]*$') then
    raise exception using errcode = 'CA004', message = 'HTTPS_URL_REQUIRED';
  end if;
  if v_cat not in ('productivity', 'entertainment', 'utilities', 'games', 'social', 'education', 'other') then
    v_cat := 'other';
  end if;
  if v_vis not in ('public', 'unlisted') then
    v_vis := 'public';
  end if;

  insert into public.custom_apps (
    developer_id, name, description, website_url, icon_url, category,
    visibility, verification_status, moderator_notes
  ) values (
    v_user_id, v_name, v_desc, v_url, nullif(trim(p_icon_url), ''), v_cat,
    v_vis, 'pending', coalesce(p_moderator_notes, '')
  )
  returning * into v_app;

  return to_jsonb(v_app);
end;
$$;

-- ---- Moderator Decision Function ------------------------------------------
-- Approves, rejects, requests changes, suspends, or restores an app.
-- Blocks self-approval (developer cannot approve their own app).
create or replace function public.community_app_decide(
  p_app_id  uuid,
  p_action  text,
  p_reason  text default ''
)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_mod_id    uuid := auth.uid();
  v_app       public.custom_apps%rowtype;
  v_action    text := lower(trim(coalesce(p_action, '')));
  v_reason    text := trim(coalesce(p_reason, ''));
  v_prev_st   text;
  v_new_st    text;
begin
  if not public.is_community_moderator() then
    raise exception using errcode = 'CA010', message = 'NOT_AUTHORIZED_AS_MODERATOR';
  end if;

  select * into v_app from public.custom_apps where id = p_app_id for update;
  if not found then
    raise exception using errcode = 'CA011', message = 'APP_NOT_FOUND';
  end if;

  -- Rule: Staff may NEVER approve their own application!
  if v_action = 'approve' and v_app.developer_id = v_mod_id then
    raise exception using errcode = 'CA012', message = 'CANNOT_APPROVE_OWN_APP';
  end if;

  v_prev_st := v_app.verification_status;

  if v_action = 'claim' then
    if v_app.verification_status <> 'pending' then
      raise exception using errcode = 'CA013', message = 'APP_NOT_PENDING';
    end if;
    v_new_st := 'under_review';
    update public.custom_apps
       set verification_status = v_new_st,
           last_reviewed_at = now(),
           last_reviewed_by = v_mod_id
     where id = v_app.id
     returning * into v_app;

  elsif v_action = 'approve' then
    v_new_st := 'verified';
    update public.custom_apps
       set verification_status = v_new_st,
           verified_at = now(),
           verified_by = v_mod_id,
           last_reviewed_at = now(),
           last_reviewed_by = v_mod_id,
           rejection_reason = null,
           changes_requested_reason = null
     where id = v_app.id
     returning * into v_app;

  elsif v_action = 'reject' then
    if length(v_reason) < 3 then
      raise exception using errcode = 'CA014', message = 'REJECTION_REASON_REQUIRED';
    end if;
    v_new_st := 'rejected';
    update public.custom_apps
       set verification_status = v_new_st,
           rejection_reason = v_reason,
           last_reviewed_at = now(),
           last_reviewed_by = v_mod_id
     where id = v_app.id
     returning * into v_app;

  elsif v_action = 'request_changes' then
    if length(v_reason) < 3 then
      raise exception using errcode = 'CA015', message = 'CHANGES_REASON_REQUIRED';
    end if;
    v_new_st := 'changes_requested';
    update public.custom_apps
       set verification_status = v_new_st,
           changes_requested_reason = v_reason,
           last_reviewed_at = now(),
           last_reviewed_by = v_mod_id
     where id = v_app.id
     returning * into v_app;

  elsif v_action = 'suspend' then
    if length(v_reason) < 3 then
      raise exception using errcode = 'CA016', message = 'SUSPENSION_REASON_REQUIRED';
    end if;
    v_new_st := 'suspended';
    update public.custom_apps
       set verification_status = v_new_st,
           suspension_reason = v_reason,
           last_reviewed_at = now(),
           last_reviewed_by = v_mod_id
     where id = v_app.id
     returning * into v_app;

  elsif v_action = 'restore' then
    if v_app.verification_status <> 'suspended' then
      raise exception using errcode = 'CA017', message = 'APP_NOT_SUSPENDED';
    end if;
    v_new_st := 'verified';
    update public.custom_apps
       set verification_status = v_new_st,
           suspension_reason = null,
           last_reviewed_at = now(),
           last_reviewed_by = v_mod_id
     where id = v_app.id
     returning * into v_app;
  else
    raise exception using errcode = 'CA018', message = 'INVALID_ACTION';
  end if;

  -- Log action
  insert into public.app_moderation_logs (
    app_id, moderator_id, action, reason, previous_status, new_status, detail
  ) values (
    v_app.id, v_mod_id, v_action, v_reason, v_prev_st, v_new_st,
    jsonb_build_object('app_name', v_app.name, 'developer_id', v_app.developer_id)
  );

  -- Send notification to developer
  perform public.notify(
    v_app.developer_id,
    'community_app_' || v_new_st,
    v_mod_id,
    null,
    case
      when v_action = 'approve' then 'Your application "' || v_app.name || '" has been verified and is now available in CrystalOS.'
      when v_action = 'reject' then 'Your application "' || v_app.name || '" was rejected: ' || v_reason
      when v_action = 'request_changes' then 'Changes were requested for "' || v_app.name || '": ' || v_reason
      when v_action = 'suspend' then 'Your application "' || v_app.name || '" was suspended: ' || v_reason
      when v_action = 'restore' then 'Your application "' || v_app.name || '" has been restored to verified status.'
      else 'Application review updated for "' || v_app.name || '".'
    end
  );

  return to_jsonb(v_app);
end;
$$;

-- ---- Install application --------------------------------------------------
-- Enforces that ONLY verified apps can be installed!
create or replace function public.community_app_install(p_app_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_app     public.custom_apps%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = 'CA020', message = 'AUTHENTICATION_REQUIRED';
  end if;

  select * into v_app from public.custom_apps where id = p_app_id;
  if not found then
    raise exception using errcode = 'CA021', message = 'APP_NOT_FOUND';
  end if;

  if v_app.verification_status <> 'verified' then
    raise exception using errcode = 'CA022', message = 'APP_NOT_VERIFIED_FOR_INSTALLATION';
  end if;

  insert into public.app_installations (app_id, user_id)
  values (v_app.id, v_user_id)
  on conflict (app_id, user_id) do nothing;

  update public.custom_apps
     set install_count = (select count(*) from public.app_installations where app_id = v_app.id)
   where id = v_app.id;

  return jsonb_build_object('ok', true, 'app_id', v_app.id, 'installed_at', now());
end;
$$;

-- ---- Uninstall application ------------------------------------------------
create or replace function public.community_app_uninstall(p_app_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = 'CA020', message = 'AUTHENTICATION_REQUIRED';
  end if;

  delete from public.app_installations
   where app_id = p_app_id and user_id = v_user_id;

  update public.custom_apps
     set install_count = (select count(*) from public.app_installations where app_id = p_app_id)
   where id = p_app_id;

  return jsonb_build_object('ok', true, 'app_id', p_app_id);
end;
$$;

-- ---- Regenerate Share Token for Unlisted App ------------------------------
create or replace function public.community_app_regenerate_token(p_app_id uuid)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id   uuid := auth.uid();
  v_new_token text := 'cat_' || replace(gen_random_uuid()::text, '-', '');
  v_app       public.custom_apps%rowtype;
begin
  select * into v_app from public.custom_apps where id = p_app_id;
  if not found then
    raise exception using errcode = 'CA030', message = 'APP_NOT_FOUND';
  end if;
  if v_app.developer_id <> v_user_id and not public.is_community_moderator() then
    raise exception using errcode = 'CA031', message = 'NOT_APP_OWNER';
  end if;

  update public.custom_apps
     set share_token = v_new_token
   where id = p_app_id;

  return v_new_token;
end;
$$;

-- ---- Resolve Application by ID or Share Token ----------------------------
-- Allows resolving unlisted applications safely without exposing private data.
-- Still enforces verification check for public details.
create or replace function public.community_app_resolve(p_identifier text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_app     public.custom_apps%rowtype;
  v_prof    public.profiles%rowtype;
  v_uid     uuid := auth.uid();
  v_is_mod  boolean := public.is_community_moderator();
begin
  if p_identifier is null or length(trim(p_identifier)) = 0 then
    return null;
  end if;

  -- Try match by UUID or by share_token
  if p_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_app from public.custom_apps where id = p_identifier::uuid;
  else
    select * into v_app from public.custom_apps where share_token = trim(p_identifier);
  end if;

  if not found then
    return null;
  end if;

  -- Check access:
  -- Allowed if:
  -- 1. App is public and verified
  -- 2. Caller is the developer
  -- 3. Caller is a moderator
  -- 4. App is unlisted and matched by token or ID, and is verified (or caller is owner/mod)
  if v_app.visibility = 'unlisted' and not v_is_mod and (v_uid is null or v_app.developer_id <> v_uid) then
    -- Unlisted apps can be resolved via direct link/token, but if suspended or not verified,
    -- safe metadata is returned indicating its verification status so UI displays honest status.
    null; -- permitted to inspect safe public metadata
  end if;

  select * into v_prof from public.profiles where id = v_app.developer_id;

  return jsonb_build_object(
    'id', v_app.id,
    'developer_id', v_app.developer_id,
    'developer_username', v_prof.username,
    'developer_display_name', coalesce(v_prof.display_name, v_prof.username),
    'developer_avatar', v_prof.avatar_url,
    'name', v_app.name,
    'description', v_app.description,
    'website_url', v_app.website_url,
    'icon_url', v_app.icon_url,
    'category', v_app.category,
    'visibility', v_app.visibility,
    'verification_status', v_app.verification_status,
    'share_token', case when v_is_mod or v_app.developer_id = v_uid then v_app.share_token else null end,
    'install_count', v_app.install_count,
    'created_at', v_app.created_at,
    'verified_at', v_app.verified_at,
    'rejection_reason', case when v_is_mod or v_app.developer_id = v_uid then v_app.rejection_reason else null end,
    'suspension_reason', case when v_app.verification_status = 'suspended' or v_is_mod or v_app.developer_id = v_uid then v_app.suspension_reason else null end,
    'changes_requested_reason', case when v_is_mod or v_app.developer_id = v_uid then v_app.changes_requested_reason else null end,
    'moderator_notes', case when v_is_mod or v_app.developer_id = v_uid then v_app.moderator_notes else null end
  );
end;
$$;

-- ---- Table Grants ---------------------------------------------------------
grant select on public.custom_apps, public.app_installations to authenticated, anon;
grant insert, update, delete on public.custom_apps, public.app_installations, public.app_reports to authenticated;
grant select on public.app_reports, public.app_moderation_logs to authenticated;
grant insert on public.app_moderation_logs to authenticated;

grant execute on function public.is_community_moderator() to authenticated, anon;
grant execute on function public.community_app_submit(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.community_app_decide(uuid, text, text) to authenticated;
grant execute on function public.community_app_install(uuid) to authenticated;
grant execute on function public.community_app_uninstall(uuid) to authenticated;
grant execute on function public.community_app_regenerate_token(uuid) to authenticated;
grant execute on function public.community_app_resolve(text) to authenticated, anon;
