-- =============================================================================
-- USERNAME SIGN-IN: let people sign in with their handle instead of their email.
--
-- Adds the server-side resolver, and teaches the signup trigger to claim a
-- handle in the SAME TRANSACTION as the auth.users insert. Email is untouched:
-- it stays the account's real address for confirmation, recovery and OAuth.
--
-- profiles.username already exists (see the curation-foundation migration): it
-- is nullable, case-insensitively unique via profiles_username_lower_idx, and
-- format-checked by profiles_username_format. Nothing here redefines those; the
-- column is shared with the curation app, which owns its format rule.
-- =============================================================================

-- ---- username -> email resolver ---------------------------------------------
-- Resolve a sign-in handle to the account's email so it can be handed to
-- GoTrue's password grant, which only ever accepts an email.
--
-- SECURITY DEFINER so it can read auth.users and see past the owner-only RLS on
-- profiles, but EXECUTE is granted to service_role ONLY. It is never exposed on
-- the client RPC surface, so it cannot be used as a handle-enumeration oracle:
-- the one caller is the service-role admin client behind the sign-in action,
-- which rate limits the resolve step and returns the same generic error whether
-- the handle is unknown or the password is wrong.
--
-- Matching is case-insensitive on both sides, so it agrees exactly with
-- profiles_username_lower_idx: whatever that index treats as one handle, this
-- resolves as one account.
create or replace function public.email_by_username(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username is not null
    and lower(p.username) = lower(btrim(p_username))
  limit 1
$$;

-- The plain revoke from `public` does NOT reach anon and authenticated: this
-- schema has a default-privileges rule that auto-grants EXECUTE on every new
-- function to both, so without naming them the resolver would be reachable
-- straight through PostgREST and the rate limiting above would be moot. Same
-- trap documented on is_display_name_available and user_id_by_email.
revoke execute on function public.email_by_username(text) from public, anon, authenticated;
grant execute on function public.email_by_username(text) to service_role;

-- ---- availability ------------------------------------------------------------
-- "Does anyone already hold this handle?", backing the checkmark on the settings
-- field and the readable "that one is taken" at sign-up.
--
-- service_role ONLY, exactly like the resolver: it answers the same question the
-- resolver does, so exposing it to anon or authenticated would hand back the
-- enumeration oracle that keeping the resolver private is meant to deny. Both
-- callers are server-side and rate limited.
--
-- p_except is the caller's own id, so re-saving the handle you already hold
-- reads as available. Passing a caller-supplied id is only safe BECAUSE this is
-- service_role-only and our own server code supplies the session's id; it is
-- deliberately not the auth.uid() pattern used by is_display_name_available,
-- which is reachable by authenticated callers and therefore must not trust an
-- argument for that.
--
-- Matching is a plain lower() equality rather than ILIKE: `_` is legal in a
-- handle and is a LIKE wildcard, so a pattern match would report `a_b` as
-- colliding with `axb`.
create or replace function public.username_taken(p_username text, p_except uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.username is not null
      and lower(p.username) = lower(btrim(p_username))
      and (p_except is null or p.id <> p_except)
  );
$$;

revoke execute on function public.username_taken(text, uuid) from public, anon, authenticated;
grant execute on function public.username_taken(text, uuid) to service_role;

-- ---- claim the handle at signup ---------------------------------------------
-- The username now rides in on raw_user_meta_data (set from signUp's
-- options.data) so the profile row claims it in the same transaction that
-- creates the auth user. This is what keeps duplicates impossible:
--
--   * A collision raises on profiles_username_lower_idx and aborts the WHOLE
--     insert, so there is never an auth user left holding a half-claimed
--     handle, and never an auth user with no profile.
--   * When the email already exists GoTrue does not insert at all, so this
--     trigger never runs and the submitted handle is silently discarded. A
--     post-signup UPDATE would instead let someone staple their handle onto an
--     account they do not control.
--
-- raw_user_meta_data is caller-supplied, so the format CHECK and unique index
-- on the column are the real gate; the sign-up action's validation is only
-- there to turn a rejection into readable copy.
--
-- Stored lowercase. Lookup already folds case, so this is purely about having
-- one canonical form for the handles this app writes.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, username)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    ),
    nullif(btrim(lower(new.raw_user_meta_data ->> 'username')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- create or replace keeps the existing grants on this function, but restate the
-- lockdown so a future replay of this file alone still lands hardened. Only the
-- on_auth_user_created trigger may run it; it is not an RPC.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

comment on column public.profiles.username is
  'Sign-in handle, distinct from display_name (which is the free-form public name buyers see). Nullable: accounts have none until they claim one. Case-insensitively unique; resolved to an email by email_by_username() for the password grant.';
