-- =============================================================================
-- public_profiles: no longer a SECURITY DEFINER view
-- =============================================================================
-- WHAT THE ADVISOR SAID. Supabase's linter reports public.public_profiles as
-- CRITICAL (0010_security_definer_view): a view that runs with its owner's
-- rights, readable by anon, over public.profiles.
--
-- WHY IT WAS DEFINER. 20260807_db_hygiene section 4 kept it that way on
-- purpose, and the reasoning held: an invoker view reads `profiles` as the
-- caller, `profiles` has no anon select policy, and adding one would publish
-- tax_vat_id, the trader address and the rest of that row to the internet.
--
-- WHAT THIS DOES INSTEAD. The public surface stops reading `profiles` at all.
--
--   * public.profile_directory is a table holding exactly the public part:
--     id, username, avatar_url, and only for profiles that opted in
--     (is_public and a username). No other column exists on it to leak.
--   * A trigger on profiles keeps it in step, in the same transaction as the
--     change, so it can never show a profile that has gone private.
--   * The view keeps its name, columns and OID (CREATE OR REPLACE), and now
--     reads the directory as the CALLER (security_invoker = true). SQ-app's
--     .from("public_profiles") and the two policies that consult the view
--     (artifacts_public_read, follows_visible_read) are unchanged, because a
--     policy references the view by OID, not by name.
--
-- This is safer than before, not just quieter: widening the view can no
-- longer expose a profiles column (the "standing footgun" in SQ-app's
-- RISKS.md section 3), and nothing a client can reach runs with definer rights
-- over profiles any more.
--
-- Run it in one go: the SQL editor runs a script as a single transaction, and
-- step 0 aborts the whole thing, changing nothing, if production's view is not
-- the one this was written against.

-- ---- 0. Refuse to run against a view that has drifted ------------------------
-- The directory copies what the view exposes. If production's view has another
-- column or another filter, copying the replica's version would silently change
-- who is public, so stop and show what is there instead. Already migrated
-- (reads profile_directory) is accepted, so a re-run is harmless.
do $preflight$
declare
  cols text;
  shape text;
begin
  select string_agg(a.attname, ',' order by a.attnum)
    into cols
    from pg_attribute a
   where a.attrelid = 'public.public_profiles'::regclass
     and a.attnum > 0
     and not a.attisdropped;

  -- pg_get_viewdef qualifies names differently across Postgres versions and
  -- search_paths, so compare on a normalised form: lower case, no whitespace,
  -- brackets, semicolons or schema/table qualifiers.
  shape := lower(pg_get_viewdef('public.public_profiles'::regclass));
  shape := regexp_replace(shape, '[\s();]', '', 'g');
  shape := replace(shape, 'public.', '');
  shape := replace(shape, 'profile_directory.', '');
  shape := replace(shape, 'profiles.', '');

  if cols is distinct from 'id,username,avatar_url'
     or shape not in (
       'selectid,username,avatar_urlfromprofileswhereis_public=trueandusernameisnotnull',
       'selectid,username,avatar_urlfromprofile_directory'
     ) then
    raise exception
      'public_profiles is not the view this migration was written for. Nothing was changed. Columns: %. Definition: %',
      cols, pg_get_viewdef('public.public_profiles'::regclass);
  end if;
end
$preflight$;

-- ---- 1. The directory ---------------------------------------------------------
create table if not exists public.profile_directory (
  id uuid primary key references public.profiles (id) on delete cascade,
  username text not null,
  avatar_url text
);

comment on table public.profile_directory is
  'The public part of opted-in profiles (is_public and a username): id, username, avatar_url, nothing else. Written only by the sync_profile_directory trigger on profiles; read through the public_profiles view. Never add a column here that is not meant for the whole internet.';

-- RLS on (the rls_auto_enable event trigger would do it too, but a table's
-- security should not depend on an event trigger someone might drop). Readable
-- by everyone, because that is its whole job; writable by no client role at
-- all. The explicit revokes undo the schema's default grants, which hand every
-- new table to anon and authenticated with INSERT/UPDATE/DELETE included.
alter table public.profile_directory enable row level security;

revoke all on public.profile_directory from public, anon, authenticated, service_role;
grant select on public.profile_directory to anon, authenticated, service_role;

drop policy if exists "Public directory is readable by everyone" on public.profile_directory;
create policy "Public directory is readable by everyone"
  on public.profile_directory
  for select to anon, authenticated
  using (true);

-- ---- 2. Keep it in step with profiles ----------------------------------------
-- SECURITY DEFINER because the person changing their own profile has no write
-- grant on the directory, and must not. It writes only the row of the profile
-- that fired it, with values taken from that row. Nobody can call it directly:
-- it returns `trigger`, and execute is revoked below regardless.
create or replace function public.sync_profile_directory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_public is true and new.username is not null then
    insert into public.profile_directory (id, username, avatar_url)
    values (new.id, new.username, new.avatar_url)
    on conflict (id) do update
      set username = excluded.username,
          avatar_url = excluded.avatar_url;
  else
    delete from public.profile_directory where id = new.id;
  end if;
  return null;
end;
$$;

revoke execute on function public.sync_profile_directory() from public, anon, authenticated;

-- AFTER, so it sees the final values from any BEFORE trigger. A deleted
-- profile needs no branch: the foreign key cascades.
drop trigger if exists profiles_sync_directory on public.profiles;
create trigger profiles_sync_directory
  after insert or update of is_public, username, avatar_url on public.profiles
  for each row execute function public.sync_profile_directory();

-- ---- 3. Backfill (and prune, so a re-run converges) ---------------------------
insert into public.profile_directory (id, username, avatar_url)
select p.id, p.username, p.avatar_url
  from public.profiles p
 where p.is_public = true
   and p.username is not null
on conflict (id) do update
  set username = excluded.username,
      avatar_url = excluded.avatar_url;

delete from public.profile_directory d
 where not exists (
   select 1 from public.profiles p
    where p.id = d.id
      and p.is_public = true
      and p.username is not null
 );

-- ---- 4. The view reads the directory, as the caller -----------------------------
create or replace view public.public_profiles
with (security_invoker = true) as
  select id, username, avatar_url
  from public.profile_directory;

-- Stated again rather than trusted to CREATE OR REPLACE: the options, and
-- the grants (SELECT only; the view is auto-updatable, and although the
-- directory refuses client writes anyway, the view should not offer them).
alter view public.public_profiles set (security_invoker = true);
revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated, service_role;

comment on view public.public_profiles is
  'Opt-in public directory: id, username, avatar_url for is_public profiles. Reads public.profile_directory as the caller (security_invoker); it no longer touches profiles, which holds tax data and must never carry an anon select policy.';

notify pgrst, 'reload schema';
