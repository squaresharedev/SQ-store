-- =============================================================================
-- Object keys are judged wherever they sit in a row, and on App's artifacts
-- (security audit 2026-11-05, docs/security-audit-2026-11.md 1.8 and 1.9).
--
-- WHAT WAS OPEN. Two ways to make the platform delete someone else's file
-- from the shared R2 bucket (squareshare-products), with keys anyone can read
-- in the presigned URLs on a public page:
--
-- 1. The account-deletion job (src/lib/account-deletion) finds a store's files
--    BY SHAPE: every string anywhere in a product or storefront row that looks
--    like an object key (collectObjectKeys). guard_object_keys (20261021) only
--    judged the named columns and `key` properties, and only fired when those
--    columns changed. A seller could put other sellers' keys into
--    products.details, option_groups, title or description, or under any other
--    property of a storefront config, then delete their own account: 14 days
--    later the job removed those sellers' photos and paid downloads.
--
-- 2. App (app.squareshare.eu, not live yet) keeps artifacts.image_key, and
--    DELETE /api/artifacts/:id evicts the deleted row's key from the same
--    bucket. artifacts had no key guard, so an App user could insert an
--    artifact naming any object in the bucket, then delete it.
--
-- THE FIX. guard_object_keys now also judges every string ANYWHERE in the row
-- that has the object-key shape, and fires on every insert and update. A new
-- trigger does the same for artifacts.image_key, in App's own key shape. The
-- rule is the one from 20261021: a key new to the row must be the writer's
-- own upload; keys already on the row stay valid whoever uploaded them.
--
-- No production row held a key from outside its store (checked 2026-11-05),
-- and production held no artifacts, so nothing existing is affected.
-- =============================================================================

-- Every string anywhere in a document that has the object-key shape: what the
-- deletion job's collectObjectKeys would collect from it, and a little more
-- (a name up to 200 characters, like the guard below, where the job stops at
-- 120), so the guard always sees at least what the job would delete.
create or replace function public.object_key_strings_in(p_doc jsonb)
returns setof text
language sql
immutable
set search_path = ''
as $$
  select v #>> '{}'
    from jsonb_path_query(coalesce(p_doc, 'null'::jsonb), 'strict $.**') as v
   where jsonb_typeof(v) = 'string'
     and (v #>> '{}') ~ '^(images|files|fonts|elements|documents)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,200}$'
$$;

revoke execute on function public.object_key_strings_in(jsonb) from public, anon;
grant execute on function public.object_key_strings_in(jsonb) to authenticated, service_role;

create or replace function public.guard_object_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  uid      uuid := (select auth.uid());
  new_keys text[];
  old_keys text[] := '{}';
  k        text;
begin
  if coalesce((select auth.role()), '') <> 'authenticated' then
    return new;
  end if;

  -- The places that must hold an object key (anything else there is refused),
  -- and every string elsewhere in the row that is shaped like one.
  if tg_table_name = 'products' then
    new_keys := array(
      select x from (
        select new.image_key as x
        union all select new.digital_file_key
        union all select public.object_keys_in(new.gallery)
        union all select public.object_keys_in(new.documents)
        union all select public.object_key_strings_in(to_jsonb(new))
      ) s where x is not null
    );
    if tg_op = 'UPDATE' then
      old_keys := array(
        select x from (
          select old.image_key as x
          union all select old.digital_file_key
          union all select public.object_keys_in(old.gallery)
          union all select public.object_keys_in(old.documents)
          union all select public.object_key_strings_in(to_jsonb(old))
        ) s where x is not null
      );
    end if;
  else
    new_keys := array(
      select public.object_keys_in(new.config)
      union all select public.object_key_strings_in(to_jsonb(new))
    );
    if tg_op = 'UPDATE' then
      old_keys := array(
        select public.object_keys_in(old.config)
        union all select public.object_key_strings_in(to_jsonb(old))
      );
    end if;
  end if;

  foreach k in array new_keys loop
    continue when k = any (old_keys);
    if uid is null
       or k !~ '^(images|files|fonts|elements|documents)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,200}$'
       or split_part(k, '/', 2) <> uid::text then
      raise exception 'A file is added by uploading it, not by naming it (%).', left(k, 120)
        using errcode = '42501';
    end if;
  end loop;

  return new;
end
$$;

revoke execute on function public.guard_object_keys() from public, anon, authenticated;

-- Every column now, not only the named ones: a key can sit in any of them.
drop trigger if exists guard_object_keys on public.products;
create trigger guard_object_keys
  before insert or update on public.products
  for each row execute function public.guard_object_keys();

drop trigger if exists guard_object_keys on public.storefronts;
create trigger guard_object_keys
  before insert or update on public.storefronts
  for each row execute function public.guard_object_keys();

-- App's artifacts: the key App's upload route mints,
-- artifacts/{uploader uuid}/{uuid}-{name} (App worker/lib/r2.ts isOwnObjectKey).
create or replace function public.guard_artifact_image_key()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if coalesce((select auth.role()), '') <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.image_key is not distinct from old.image_key then
    return new;
  end if;
  if uid is null
     or new.image_key !~ '^artifacts/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$'
     or split_part(new.image_key, '/', 2) <> uid::text then
    raise exception 'A picture is added by uploading it, not by naming it (%).', left(new.image_key, 120)
      using errcode = '42501';
  end if;
  return new;
end
$$;

revoke execute on function public.guard_artifact_image_key() from public, anon, authenticated;

drop trigger if exists guard_artifact_image_key on public.artifacts;
create trigger guard_artifact_image_key
  before insert or update of image_key on public.artifacts
  for each row execute function public.guard_artifact_image_key();

notify pgrst, 'reload schema';
