-- =============================================================================
-- A storage key on a product or storefront must be the writer's own upload
-- (security review 2026-10-21)
-- =============================================================================
-- THE HOLE. Products and storefronts reference R2 objects by key
-- (`{images|files|fonts|elements|documents}/{uploader id}/{uuid}-{name}`): a
-- product's image_key, digital_file_key, gallery[].key and documents[].key,
-- and every `key` inside a storefront's config (background, custom font,
-- element and image blocks, product-page photos). The app only accepts a key
-- the saving user uploaded (isOwnedObjectKey in lib/validation/product.ts),
-- but owners and editors may also UPDATE these rows straight through PostgREST,
-- where that check never runs. A seller could therefore write ANOTHER seller's
-- key (readable in any presigned URL on a public page) into their own product,
-- then delete the product: the app evicts the row's objects with the service
-- role and destroyed the other seller's file. They could also write an
-- arbitrary https:// address, which /api/products/[id]/photo fetched from the
-- Worker.
--
-- THE FIX, at the one place every writer meets: a trigger on both tables.
-- For an `authenticated` writer, every key that is NEW to the row (not already
-- on it before this write) must have the object-key shape and the writer's own
-- user id as its second segment. Keys already on the row stay valid whoever
-- uploaded them (a teammate's photo, the seeded catalog's platform-storage
-- URLs), so saving, reordering and removing work as before. The service role
-- (seeding, admin tools, the deletion job) is not gated, like the other
-- triggers on these tables.
--
-- No production row held a key foreign to its store when this was written
-- (checked 2026-10-21), so nothing existing is affected.
-- =============================================================================

-- Every string at a `key` property anywhere in a document: the gallery,
-- documents and storefront config all name their object keys `key`.
create or replace function public.object_keys_in(p_doc jsonb)
returns setof text
language sql
immutable
set search_path = ''
as $$
  select v #>> '{}'
    from jsonb_path_query(coalesce(p_doc, 'null'::jsonb), 'lax $.**.key') as v
   where jsonb_typeof(v) = 'string'
$$;

revoke execute on function public.object_keys_in(jsonb) from public, anon;
grant execute on function public.object_keys_in(jsonb) to authenticated, service_role;

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

  if tg_table_name = 'products' then
    new_keys := array(
      select x from (
        select new.image_key as x
        union all select new.digital_file_key
        union all select public.object_keys_in(new.gallery)
        union all select public.object_keys_in(new.documents)
      ) s where x is not null
    );
    if tg_op = 'UPDATE' then
      old_keys := array(
        select x from (
          select old.image_key as x
          union all select old.digital_file_key
          union all select public.object_keys_in(old.gallery)
          union all select public.object_keys_in(old.documents)
        ) s where x is not null
      );
    end if;
  else
    new_keys := array(select public.object_keys_in(new.config));
    if tg_op = 'UPDATE' then
      old_keys := array(select public.object_keys_in(old.config));
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

-- A trigger function is never called directly.
revoke execute on function public.guard_object_keys() from public, anon, authenticated;

drop trigger if exists guard_object_keys on public.products;
create trigger guard_object_keys
  before insert or update of image_key, digital_file_key, gallery, documents on public.products
  for each row execute function public.guard_object_keys();

drop trigger if exists guard_object_keys on public.storefronts;
create trigger guard_object_keys
  before insert or update of config on public.storefronts
  for each row execute function public.guard_object_keys();

notify pgrst, 'reload schema';
