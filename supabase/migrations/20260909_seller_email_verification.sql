-- The seller's buyer-facing contact address becomes PROVEN, not just typed.
--
-- THE PROBLEM. `profiles.seller_email` (20260905_seller_identity_on_profile) is
-- printed on every hosted product page as the way a buyer reaches the trader,
-- and the publish gate (lib/settings/trader-identity.ts) refuses to let anything
-- go on sale without it. Everything up to now checks the address's SHAPE: it
-- parses, it is not a throwaway provider, it is not a placeholder, and its
-- domain answers DNS for mail (lib/validation/email-quality.ts and
-- email-domain.ts). None of that proves a mailbox exists, and none of it proves
-- the seller can read it. A buyer writing to a valid-looking address nobody
-- collects is exactly the failure the required field exists to prevent.
--
-- THE FIX. Double opt-in, the only check that actually settles the question:
-- send a link to the address and see it clicked. `seller_email_verified_at`
-- records when that happened; `seller_email_verifications` holds the pending
-- tokens.
--
-- WHY A TABLE RATHER THAN MORE COLUMNS ON `profiles`. A pending verification is
-- a short-lived fact with its own lifecycle (issued, expires, consumed), and it
-- names an address that is NOT yet the profile's — a seller who mistypes and
-- corrects has two of them in flight. Four more nullable columns on an already
-- wide `profiles` would model that badly, and would put a credential-grade
-- secret on a row the account itself can select. Which is the real reason:
--
-- SECURITY. A token here is a bearer credential for "this address is mine", so
-- the table stores only its SHA-256 HASH, exactly as no password is ever stored
-- in plaintext, and RLS is on with NO POLICY AT ALL. That is deliberate and is
-- not an oversight: RLS with no policy denies every anon and authenticated read
-- and write, so the only way in is the service role (lib/settings/
-- seller-email-verification.ts). The explicit REVOKEs below are belt and braces
-- against PostgREST's auto-grant, which has published new objects to `anon` in
-- this schema before.
--
-- WHY THE BACKFILL. Every profile that already carries a `seller_email` is
-- marked verified as of this migration. Those addresses were never confirmed,
-- so this is GRANDFATHERING, not verification, and it is here so that shipping
-- the requirement does not black out every live storefront on deploy — the
-- read-side gate would 404 them all at once. The moment such a seller edits
-- their contact address it goes through the real flow like any other. To force
-- everyone through it instead, delete the backfill statement before applying,
-- or run `update public.profiles set seller_email_verified_at = null;` after.

alter table public.profiles
  add column seller_email_verified_at timestamptz;

comment on column public.profiles.seller_email_verified_at is
  'When the buyer-facing seller_email was proven by a clicked verification link. Null = unproven; the publish gate treats that as "cannot sell" while verification is switched on (see lib/email/send.ts for the switch).';

create table if not exists public.seller_email_verifications (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid        not null references auth.users (id) on delete cascade,
  -- The address being proven. Kept beside the token because the profile's
  -- seller_email can change while a link is in flight, and a token must only
  -- ever verify the address it was actually sent to.
  email        text        not null,
  token_hash   text        not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz
);

comment on table public.seller_email_verifications is
  'Pending double opt-in tokens for profiles.seller_email. Service-role only: RLS is enabled with no policy, and only the SHA-256 hash of each token is stored.';

alter table public.seller_email_verifications
  add constraint seller_email_verifications_email_shape
    check (
      char_length(email) <= 254
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ),
  -- 64 lowercase hex characters: a SHA-256 digest and nothing else. A raw
  -- token reaching this column would be a plaintext-credential bug, and this
  -- is the fence that catches it.
  add constraint seller_email_verifications_token_hash_shape
    check (token_hash ~ '^[0-9a-f]{64}$'),
  add constraint seller_email_verifications_expiry_after_issue
    check (expires_at > created_at);

-- Every read is "find the row for this hash"; every cleanup is "this owner's
-- outstanding links". The unique constraint on token_hash already indexes the
-- first, so only the owner lookup needs one.
create index if not exists seller_email_verifications_owner_idx
  on public.seller_email_verifications (owner_id);

alter table public.seller_email_verifications enable row level security;

-- No policy on purpose. See the header: RLS with no policy is a total deny for
-- anon and authenticated, which is the correct posture for a token store.
revoke all on public.seller_email_verifications from anon;
revoke all on public.seller_email_verifications from authenticated;
grant all on public.seller_email_verifications to service_role;

-- Grandfathering, not verification. See the header.
update public.profiles
   set seller_email_verified_at = now()
 where seller_email is not null
   and seller_email_verified_at is null;
