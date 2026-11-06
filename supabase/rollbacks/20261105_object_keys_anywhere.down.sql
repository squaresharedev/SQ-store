-- Undo 20261105_object_keys_anywhere: back to the 20261021 guard (named
-- columns and `key` properties only, fired when those columns change), and no
-- guard on artifacts.image_key. That reopens docs/security-audit-2026-11.md
-- 1.8 and 1.9.

drop trigger if exists guard_artifact_image_key on public.artifacts;
drop function if exists public.guard_artifact_image_key();

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

revoke execute on function public.guard_object_keys() from public, anon, authenticated;

drop trigger if exists guard_object_keys on public.products;
create trigger guard_object_keys
  before insert or update of image_key, digital_file_key, gallery, documents on public.products
  for each row execute function public.guard_object_keys();

drop trigger if exists guard_object_keys on public.storefronts;
create trigger guard_object_keys
  before insert or update of config on public.storefronts
  for each row execute function public.guard_object_keys();

drop function if exists public.object_key_strings_in(jsonb);

notify pgrst, 'reload schema';
