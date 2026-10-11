-- ====================================================================
-- AUTOMATIC MODERATION, THE MARKETPLACE'S HALF.
--
-- 20261012_auto_moderation put products, storefronts and artifacts behind the
-- wall: a row is 'ok' only while every part of its content is approved. For
-- the dashboard that was enough, because its public pages are built on the
-- server and ask isContentVisible() before showing anything.
--
-- The marketplace is different in two ways, and this closes both.
--
--   1. ITS PUBLIC READS GO THROUGH RLS. An anonymous visitor reads artifacts
--      straight from the database, and the policy that lets them never asked
--      about moderation: a removed artifact, or one nobody had checked yet,
--      was one REST call away whatever the app chose to display. The takedown
--      gate belongs in the policy, where it cannot be forgotten.
--
--   2. ITS PUBLIC WORDS ARE NOT ALL ON A MODERATED ROW. A handle, a profile
--      picture and a collection's name are shown to everyone and live on rows
--      with no moderation state.
--
--      The handle and the picture reach the public through exactly one door,
--      the profile directory, so the door is where they are checked: it
--      admits a handle, and shows a picture, only when that exact value is on
--      the approved list. Who wrote the value does not matter, which is the
--      point. Sign-up writes both from metadata the person signing up controls
--      (and GoTrue can be called directly), so "only the server may write
--      this column" would have left the front door open.
--
--      A collection has no such door (its rows are read through RLS), so its
--      name takes the rule the trader name already does (guard_seller_text):
--      the server has it checked first and then writes it, and nobody else may.
--
-- DEPLOY ORDER, as for the wall itself: SQ-app must be live with the code that
-- names collections through the service role BEFORE this is applied, or those
-- saves are refused.
--
-- ON APPLYING IT: every profile leaves the public directory, because no handle
-- has been approved yet. Each comes back the next time its owner saves their
-- profile in an app, which is when the handle is checked. The marketplace is
-- not live, so nobody is looking.
--
-- Apply via Supabase MCP (apply_migration) or the SQL editor, after
-- 20261012_auto_moderation.
-- ====================================================================

-- ---- 1. A marketplace item is public only once approved ---------------------
-- Same two branches as before (in a public collection, or loose on a public
-- profile), now behind the one question every other surface already asks.

drop policy if exists artifacts_public_read on public.artifacts;
create policy artifacts_public_read on public.artifacts
  for select to anon, authenticated
  using (
    moderation_status = 'ok'
    and (
      (collection_id is not null and exists (
        select 1 from public.collections c
        where c.id = artifacts.collection_id and c.is_public = true
      ))
      or
      (collection_id is null and exists (
        select 1 from public.public_profiles pp where pp.id = artifacts.owner_id
      ))
    )
  );

-- ---- 2. The handle and the profile picture ------------------------------------
-- The directory's one writer (20260924_public_profiles_invoker), now asking
-- the approved list first. The subjects are worked out from the stored value
-- itself, so an approval is for exactly these characters and exactly this URL:
--
--   handle:<lowercased handle>     recorded by the app that checked it
--   avatar:<avatar_url, verbatim>  recorded for a picture the platform stored
--                                  (a URL nobody else can change the bytes of)
--
-- No approved handle: the profile is not in the directory, so it is not public
-- and its loose artifacts are not either (artifacts_public_read above).
-- No approved picture: the profile is listed without one.

create or replace function public.sync_profile_directory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_avatar text;
begin
  if new.is_public is true
     and new.username is not null
     and exists (
       select 1 from public.moderation_checks k
        where k.subject = 'handle:' || lower(new.username)
          and k.verdict = 'clean'
     ) then
    select new.avatar_url into v_avatar
     where new.avatar_url is not null
       and exists (
         select 1 from public.moderation_checks k
          where k.subject = 'avatar:' || new.avatar_url
            and k.verdict = 'clean'
       );
    insert into public.profile_directory (id, username, avatar_url)
    values (new.id, new.username, v_avatar)
    on conflict (id) do update
      set username = excluded.username,
          avatar_url = excluded.avatar_url;
  else
    delete from public.profile_directory where id = new.id;
  end if;
  return null;
end;
$$;

comment on function public.sync_profile_directory() is
  'The public directory''s only writer. Admits a profile when it is public AND its handle is approved (moderation_checks, handle:<lowercased>), and carries its picture only when that URL is approved (avatar:<url>).';

revoke execute on function public.sync_profile_directory() from public, anon, authenticated;

-- What is already listed was never checked: out it goes, until it is.
delete from public.profile_directory d
 where not exists (
   select 1 from public.moderation_checks k
    where k.subject = 'handle:' || lower(d.username) and k.verdict = 'clean'
 );

update public.profile_directory d
   set avatar_url = null
 where d.avatar_url is not null
   and not exists (
     select 1 from public.moderation_checks k
      where k.subject = 'avatar:' || d.avatar_url and k.verdict = 'clean'
   );

-- A policy change re-judges rows, because the sweep can find them again. A
-- handle or a picture has no row to find, so its approval stays: forgetting it
-- would not get it looked at, only drop the profile out of the directory at
-- its owner's next save.
create or replace function public.moderation_recheck_all()
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.moderation_checks
   where source = 'model'
     and subject not like 'handle:%'
     and subject not like 'avatar:%';
  update public.products set moderation_checked_at = null where moderation_status = 'ok';
  update public.storefronts set moderation_checked_at = null where moderation_status = 'ok';
  update public.artifacts set moderation_checked_at = null where moderation_status = 'ok';
end;
$$;

revoke execute on function public.moderation_recheck_all() from public, anon, authenticated;
grant execute on function public.moderation_recheck_all() to service_role;

-- ---- 3. A collection's name -----------------------------------------------------
-- The one piece of free text on a collection, shown on the public grid and in
-- search. A client may still reorder a collection or flip it between public
-- and private; naming one is the server's, after the name has been checked.

create or replace function public.guard_collection_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' or new.name is distinct from old.name then
    raise exception 'A collection''s name is checked before it is saved, not set directly.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_collection_name() is
  'Only the service role may create a collection or rename one: the server has the name checked first. Attached to collections.';

drop trigger if exists collections_guard_name on public.collections;
create trigger collections_guard_name
  before insert or update on public.collections
  for each row execute function public.guard_collection_name();

revoke execute on function public.guard_collection_name() from public, anon, authenticated;

notify pgrst, 'reload schema';
