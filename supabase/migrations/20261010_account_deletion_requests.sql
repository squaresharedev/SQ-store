-- Account deletion requests: the record a deletion is carried out from.
--
-- WHY. "Delete my account" set a flag on the seller's own profile row
-- (profiles.deletion_requested_at) and nothing ever acted on it. Now something
-- does (src/lib/account-deletion/run.ts), and what it acts on has to be a
-- record only the server can write. The profile flag is not: a seller may
-- update their own profile row, so a hijacked session could write the flag
-- directly, with a date in the past, and skip both the two-factor step the
-- Settings page asks for and the days a seller has to change their mind.
--
-- WHAT THIS ADDS. One table, account_deletion_requests: one row per account
-- whose owner asked for it to be deleted, written by the server action after
-- its checks (src/lib/settings/actions.ts) and removed when they change their
-- mind. `requested_at` is the server's clock, and it is what the waiting
-- period is counted from.
--
-- The profile flag stays, as what it always was: something the seller's own
-- pages can read. Nothing is deleted because of it.
--
-- TRUST. Service role only: RLS on with no policies, no grant to the API
-- roles. The Settings page reads the row for the signed-in person on the
-- server.
--
-- Gone with the account (on delete cascade), which is how a finished deletion
-- clears its own request.
--
-- DEPLOY ORDER: this migration first, then the app. Additive; the released
-- app does not know the table exists.
--
-- Apply via the Management API query endpoint or the SQL editor.

create table if not exists public.account_deletion_requests (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  requested_at     timestamptz not null default now(),
  -- When the deletion BEGAN. From here there is no changing one's mind: the
  -- account's products and files go a few at a time, and a request withdrawn
  -- halfway would leave a seller with an account and half a shop. The server
  -- only withdraws a request whose started_at is still null.
  started_at       timestamptz,
  -- The last time the deletion was tried and could not be finished, and a
  -- short code for why. Null for a request that is simply waiting its turn.
  last_attempt_at  timestamptz,
  last_error       text,

  constraint account_deletion_requests_error_length
    check (last_error is null or char_length(last_error) <= 200)
);

comment on table public.account_deletion_requests is
  'An account whose owner asked for it to be deleted, and when. Written only by the server after its checks; the deletion job reads this, never profiles.deletion_requested_at (which the seller can write). Service role only.';
comment on column public.account_deletion_requests.requested_at is
  'When the request was made, by the server''s clock. The waiting period before deletion is counted from here.';

alter table public.account_deletion_requests enable row level security;
revoke all on table public.account_deletion_requests from public, anon, authenticated;
grant all on table public.account_deletion_requests to service_role;

-- Requests made before this table existed keep standing, and their waiting
-- period starts now: the old flag was writable by the seller, so its date is
-- not one to count from.
insert into public.account_deletion_requests (user_id, requested_at)
select id, now()
  from public.profiles
 where deletion_requested_at is not null
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';
