-- =============================================================================
-- ONE IDENTITY: display_name and username merge into `username`.
--
-- The account had two names: `display_name` (free-form, what buyers saw) and
-- `username` (the sign-in handle). Two names for one account is one too many —
-- it splits "who is this" across two columns, lets them disagree, and makes
-- "is this taken?" two different questions. From here there is one field, and
-- it is `username`.
--
-- It keeps the HANDLE's rules rather than the display name's, because this
-- value is now half of a credential: lowercase a-z0-9_ , 3 to 30 characters,
-- case-insensitively unique. Free-form Unicode with spaces cannot be a login
-- identifier without inviting look-alike accounts.
--
-- Safe across the estate: the marketplace app references neither column, and
-- the curation app already uses `username` exclusively. This migration moves
-- the store app onto the same column the curation app was always using.
-- =============================================================================

-- ---- backfill ----------------------------------------------------------------
-- Every existing display_name becomes a handle. Slugified rather than dropped,
-- so nobody loses the name they chose: lowercased, runs of anything outside
-- [a-z0-9_] collapsed to a single underscore, trimmed of leading/trailing
-- underscores ("Adrian Edwards" -> "adrian_edwards").
--
-- Then padded/truncated into the 3..30 the constraint requires, and finally
-- de-duplicated against the unique index by suffixing a counter. Done in one
-- statement per row via a DO block so collisions can be resolved as we go.
do $$
declare
  r record;
  base text;
  candidate text;
  n integer;
begin
  for r in
    select id, display_name
    from public.profiles
    where username is null
      and nullif(btrim(display_name), '') is not null
    order by created_at
  loop
    base := regexp_replace(lower(btrim(r.display_name)), '[^a-z0-9_]+', '_', 'g');
    base := btrim(base, '_');
    -- Too short to be a handle: pad rather than invent something unrelated.
    if length(base) < 3 then
      base := rpad(coalesce(nullif(base, ''), 'user'), 3, '0');
    end if;
    base := left(base, 30);

    candidate := base;
    n := 1;
    while exists (
      select 1 from public.profiles p where lower(p.username) = candidate
    ) loop
      n := n + 1;
      -- Keep room for the suffix inside the 30-character ceiling.
      candidate := left(base, 30 - length(n::text) - 1) || '_' || n::text;
    end loop;

    update public.profiles set username = candidate where id = r.id;
  end loop;
end $$;

-- ---- dependents of the column -------------------------------------------------
-- Two views project display_name, and an RLS policy on artifacts reads one of
-- them, so the column cannot be dropped until all three are rebuilt. Dropping
-- a view cascades to that policy, hence the explicit recreate below: the
-- cascade is deliberate and accounted for, not discovered later.
--
-- Both views keep security_invoker=false (the default they already had). That
-- matters for public_profiles: the artifacts policy consults it on behalf of
-- ANONYMOUS readers, and profiles has no anon select policy, so an invoker-
-- rights view would evaluate against an empty set and silently hide every
-- public artifact.
drop view if exists public.public_profiles cascade;
drop view if exists public.admin_user_directory;

-- ---- the store's own reads move to username ----------------------------------
-- team_roster/team_my_accounts/team_my_pending_invites all surfaced the
-- account's name from display_name. Their RETURNS TABLE shape changes, so they
-- must be dropped and recreated rather than replaced, and their grants restated
-- (a new function does not inherit them).

drop function if exists public.team_roster(uuid, integer, integer);

create function public.team_roster(
  account uuid,
  page_limit integer default 50,
  page_offset integer default 0
)
returns table (
  id uuid,
  member_user_id uuid,
  invited_email text,
  role team_role,
  status team_member_status,
  invited_at timestamptz,
  accepted_at timestamptz,
  username text,
  avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.id, tm.member_user_id, tm.invited_email, tm.role, tm.status,
         tm.invited_at, tm.accepted_at, p.username, p.avatar_url
  from public.team_members tm
  left join public.profiles p on p.id = tm.member_user_id
  where tm.account_owner_id = account
    and public.team_role_can(public.team_actor_role(account), 'team.read')
  order by public.team_role_rank(tm.role) desc, tm.invited_at asc, tm.id asc
  limit least(greatest(coalesce(page_limit, 50), 1), 100)
  offset greatest(coalesce(page_offset, 0), 0)
$$;

revoke execute on function public.team_roster(uuid, integer, integer) from public, anon;
grant execute on function public.team_roster(uuid, integer, integer) to authenticated, service_role;

drop function if exists public.team_my_accounts();

create function public.team_my_accounts()
returns table (
  account_owner_id uuid,
  role team_role,
  store_name text,
  is_self boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    tm.account_owner_id,
    tm.role,
    coalesce(nullif(btrim(p.username), ''), 'A SquareShare store') as store_name,
    (tm.account_owner_id = (select auth.uid())) as is_self
  from public.team_members tm
  left join public.profiles p on p.id = tm.account_owner_id
  where tm.member_user_id = (select auth.uid())
    and tm.status = 'active'
  order by (tm.account_owner_id = (select auth.uid())) desc, store_name asc
$$;

revoke execute on function public.team_my_accounts() from public, anon;
grant execute on function public.team_my_accounts() to authenticated, service_role;

drop function if exists public.team_my_pending_invites();

create function public.team_my_pending_invites()
returns table (
  id uuid,
  account_owner_id uuid,
  role team_role,
  invited_at timestamptz,
  store_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.id, tm.account_owner_id, tm.role, tm.invited_at,
         coalesce(p.username, 'A SquareShare store')
  from public.team_members tm
  left join public.profiles p on p.id = tm.account_owner_id
  where tm.status = 'invited'
    and lower(tm.invited_email) = (select public.team_jwt_email())
  order by tm.invited_at desc
  limit 50
$$;

revoke execute on function public.team_my_pending_invites() from public, anon;
grant execute on function public.team_my_pending_invites() to authenticated, service_role;

-- ---- signup writes one name --------------------------------------------------
-- An OAuth signup brings a human name ("Adrian Edwards") rather than a handle,
-- so the same slug rule used for the backfill runs here: the account still gets
-- a usable handle instead of failing the format check or landing with none.
-- A collision is left to the unique index, which aborts the signup rather than
-- silently handing out someone else's identity.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw text;
  slug text;
begin
  raw := coalesce(
    new.raw_user_meta_data ->> 'username',
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name'
  );
  slug := btrim(regexp_replace(lower(btrim(coalesce(raw, ''))), '[^a-z0-9_]+', '_', 'g'), '_');
  if length(slug) < 3 then
    slug := null;  -- nothing usable; the account claims a handle later
  else
    slug := left(slug, 30);
  end if;

  insert into public.profiles (id, username, avatar_url)
  values (
    new.id,
    slug,
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---- retire display_name ------------------------------------------------------
-- Its availability check goes with it; is_username_available's job is done by
-- username_taken (service_role-only, see the username sign-in migration).
drop function if exists public.is_display_name_available(text);
drop index if exists public.profiles_display_name_lower_idx;

alter table public.profiles drop column if exists display_name;

-- ---- rebuild the dependents on the surviving column ---------------------------
create view public.public_profiles as
  select id, username, avatar_url
  from public.profiles
  where is_public = true
    and username is not null;

-- READ ONLY, explicitly. A recreated view inherits this schema's default-
-- privileges rule exactly as a new function does, so anon and authenticated
-- are auto-granted INSERT/UPDATE/DELETE as well as SELECT. That matters here:
-- a simple view is automatically UPDATABLE, and this one runs with definer
-- rights (security_invoker off, which it must stay so the artifacts policy can
-- consult it for anonymous readers). Left alone, a PostgREST write through the
-- view would reach profiles with RLS bypassed.
revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to anon, authenticated, service_role;

-- Restored verbatim apart from the view it reads, which no longer carries a
-- display_name. The policy only ever matched on pp.id, so nothing about its
-- meaning changes.
create policy artifacts_public_read on public.artifacts
  for select to anon, authenticated
  using (
    (collection_id is not null and exists (
      select 1 from public.collections c
      where c.id = artifacts.collection_id and c.is_public = true
    ))
    or
    (collection_id is null and exists (
      select 1 from public.public_profiles pp where pp.id = artifacts.owner_id
    ))
  );

-- Admin directory: same shape, one name. The metadata fallbacks stay, since an
-- account that never claimed a handle still has whatever its provider sent.
create view public.admin_user_directory as
  select
    u.id,
    u.email::text as email,
    coalesce(
      p.username,
      u.raw_user_meta_data ->> 'username',
      u.raw_user_meta_data ->> 'name',
      u.raw_user_meta_data ->> 'full_name'
    ) as username,
    u.created_at,
    u.banned_until,
    u.email_confirmed_at,
    p.id is not null as is_seller
  from auth.users u
  left join public.profiles p on p.id = u.id;

-- Same trap, higher stakes: this view reads auth.users, so an inherited anon
-- grant would publish every email, ban state and confirmation timestamp
-- through PostgREST.
revoke all on public.admin_user_directory from anon, authenticated;
grant select on public.admin_user_directory to service_role;

comment on column public.profiles.username is
  'The account''s ONE identifier: sign-in handle and the name shown to buyers. Lowercase a-z0-9_, 3-30 chars, case-insensitively unique via profiles_username_lower_idx. Resolved to an email by email_by_username() for the password grant.';
