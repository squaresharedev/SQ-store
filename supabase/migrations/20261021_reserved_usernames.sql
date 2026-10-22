-- Reserved handles are refused by the database, not only by the sign-up form.
--
-- THE HOLE (security audit 2026-10-20). RESERVED_USERNAMES
-- (src/lib/validation/auth.ts) was enforced only by usernameSchema in the app.
-- Two writers reach profiles.username without it:
--   - the owner's own UPDATE through PostgREST ("Users can update their own
--     profile" allows every column of their row), and
--   - handle_new_user, which copies whatever username/name the signer put in
--     the signup metadata (a direct call to Supabase's signup endpoint picks
--     its own).
-- So anyone could hold `support`, `security` or `squareshare`, the phishing
-- head start the list exists to deny.
--
-- THE FIX. One SQL predicate, public.username_is_reserved, used by
--   - a CHECK on profiles.username, which every writer meets, and
--   - handle_new_user, which now drops a reserved slug (the account is created
--     without a handle, as for a slug under 3 characters) instead of letting
--     the CHECK abort the signup. That matters for Google sign-up: a Google
--     profile named "Admin" must still get an account.
--
-- KEEP IN STEP with RESERVED_USERNAMES: tests/unit/reserved-usernames-sql.test.ts
-- reads the list below and fails when the two differ.
-- No production row held a reserved handle when this was written (checked
-- 2026-10-21), so the constraint validates immediately.

create or replace function public.username_is_reserved(p_username text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(p_username) = any (array[
    'admin',
    'administrator',
    'api',
    'auth',
    'billing',
    'checkout',
    'dashboard',
    'help',
    'login',
    'logout',
    'moderator',
    'orders',
    'owner',
    'products',
    'root',
    'security',
    'settings',
    'signin',
    'signup',
    'squareshare',
    'storefront',
    'support',
    'system',
    'team'
  ])
$$;

comment on function public.username_is_reserved(text) is
  'True for handles no account may hold. Mirrors RESERVED_USERNAMES in src/lib/validation/auth.ts (unit test keeps them equal).';

-- The CHECK below runs as whoever writes the row, so the roles that write
-- profiles need EXECUTE. anon never writes a profile.
revoke execute on function public.username_is_reserved(text) from public, anon;
grant execute on function public.username_is_reserved(text) to authenticated, service_role;

alter table public.profiles
  drop constraint if exists profiles_username_not_reserved;
alter table public.profiles
  add constraint profiles_username_not_reserved
  check (username is null or not public.username_is_reserved(username));

-- handle_new_user as live on 2026-10-21, with one change: a reserved slug is
-- dropped like a too-short one.
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
    slug := null;
  else
    slug := left(slug, 30);
  end if;
  -- A reserved handle is never claimed, whoever asked for it.
  if slug is not null and public.username_is_reserved(slug) then
    slug := null;
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

-- Recreating a function re-opens it to client roles in this schema. A trigger
-- function is never called directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

notify pgrst, 'reload schema';
