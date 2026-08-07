-- =============================================================================
-- PASSWORD SECURITY: an honest has-password signal, and a record of every
-- credential-level event.
--
-- Two problems this fixes.
--
-- 1. The app asked the wrong question. It decided an account had a password by
--    looking for an `email` row in auth.identities. Setting a password on an
--    OAuth account through the recovery flow writes auth.users.encrypted_password
--    but does NOT create that identity row, so an account with a real password
--    read as having none. That hid the password card, and worse, it let
--    requestEmailChange skip re-authentication entirely: a hijacked session
--    could move the account's address without proving anything and then request
--    a reset to the new inbox. user_has_password() asks the real question.
--
-- 2. Nothing recorded a credential change. There was no way to see, after the
--    fact, that a password was changed or a reset requested, or from where.
-- =============================================================================

-- ---- does this account actually have a password? ------------------------------
-- SECURITY DEFINER so it can read auth.users, which no client role may touch.
-- service_role ONLY: the answer is about a specific account, and while a caller
-- learning it about THEMSELVES is harmless, the argument is a caller-supplied
-- id, so exposing it would answer the question about anyone.
--
-- The plain revoke from `public` does NOT reach anon and authenticated: this
-- schema auto-grants EXECUTE on every new function to both. Same trap
-- documented on email_by_username and user_id_by_email.
create or replace function public.user_has_password(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(u.encrypted_password, '') <> ''
  from auth.users u
  where u.id = p_user_id
$$;

revoke execute on function public.user_has_password(uuid) from public, anon, authenticated;
grant execute on function public.user_has_password(uuid) to service_role;

comment on function public.user_has_password(uuid) is
  'True when the account has a password hash, regardless of whether an `email` identity row exists. Setting a password on an OAuth account writes the hash without the identity, so identities is not a reliable signal.';

-- ---- credential event log ------------------------------------------------------
-- Append-only from the server's point of view: RLS carries a SELECT policy for
-- the owner and NOTHING else, so there is no insert, update or delete path for
-- any client. Writes go through the service-role recorder in lib/security/events.ts,
-- exactly like notifications.
create table if not exists public.security_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- A closed vocabulary of slugs ("password.changed"), so the log stays
  -- groupable instead of drifting into free text.
  event      text not null check (event ~ '^[a-z][a-z_.]{2,63}$'),
  -- HASHED, never the raw address. An audit log that quietly becomes a record
  -- of where someone lives is a liability, and equality is all this needs.
  ip_hash    text,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.security_events is
  'Credential-level events per user (password changed, reset requested, email change requested). Written server-side by service_role only; the owner may read their own. IP is stored as a SHA-256 hash, never raw.';

-- Newest-first per user is the only read pattern.
create index if not exists security_events_user_created_idx
  on public.security_events (user_id, created_at desc);

alter table public.security_events enable row level security;

drop policy if exists "Users read their own security events" on public.security_events;
create policy "Users read their own security events"
  on public.security_events
  for select
  to authenticated
  using ( (select auth.uid()) = user_id );

-- A NEW TABLE is auto-granted INSERT/UPDATE/DELETE to anon and authenticated by
-- this schema's default privileges. Without this revoke the owner-read policy
-- above would sit on top of a table any signed-in caller could write to, and an
-- audit log a suspect can forge is worse than none.
revoke all on public.security_events from anon, authenticated;
grant select on public.security_events to authenticated;

-- ---- notification vocabulary ---------------------------------------------------
-- The type list lives in TWO places: NOTIFICATION_TYPES in
-- lib/notifications/types.ts and this CHECK. Adding "security" to the TypeScript
-- enum alone made createNotification fail the insert, and because notification
-- creation is best-effort by contract it failed SILENTLY: the password change
-- succeeded and the alert simply never arrived. Exactly the sort of quiet gap a
-- security alert must not have.
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type = any (array['team','payment','stock','order','system','security']));

comment on constraint notifications_type_check on public.notifications is
  'Mirror of NOTIFICATION_TYPES in lib/notifications/types.ts. Update both together: a type present in one and not the other fails the insert silently.';
