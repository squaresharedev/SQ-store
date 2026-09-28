-- ====================================================================
-- CONTACT VERIFICATION: a seller proves they OWN the email address and phone
-- number buyers are shown, by typing back a code sent to it.
--
-- WHAT WAS WRONG WITH WHAT CAME BEFORE (20260909_seller_email_verification):
--
--   1. The proof could be forged. `profiles` is update-your-own-row for the
--      seller, and nothing guarded `seller_email_verified_at`. Anyone holding
--      their own session token could PATCH the column over PostgREST and be
--      "verified", or verify their own address and then PATCH `seller_email`
--      to somebody else's: the flag survived, because only the app's save
--      action ever cleared it. The app is not the only client of this
--      database, so a rule the app keeps is not a rule.
--
--   2. A click is not proof of ownership. The old flow mailed a link that
--      verified the address the moment it was OPENED, by anyone, signed in or
--      not. Corporate mail scanners (Safe Links, Mimecast and friends) open
--      every link in an incoming message, and a stranger who receives an
--      unexpected "confirm your address" mail may well click it. Either way a
--      seller could claim an address they have never read.
--
-- WHAT THIS DOES:
--
--   * A CODE, not a link. The seller types it into their own signed-in session,
--     so the only person who can complete a verification is someone who can
--     read the mailbox or the phone AND holds the account. A scanner or the
--     real owner of a mistyped address cannot finish it for them.
--   * One table for both channels, service-role only, storing an HMAC of the
--     code under a Worker-only key (never the code). A dump of the table cannot
--     be brute-forced offline, because the 10^8 guesses need the key.
--   * Issuing and redeeming are single SQL functions, so the attempt counter,
--     the single live code per channel and "the value is still the one the code
--     was sent to" are decided under one row lock, not across round trips.
--   * A guard trigger on `profiles`: only the service role can grant a proof,
--     and any change to the email or phone drops its proof, whoever wrote it.
--
-- WHY A TRIGGER AND NOT A COLUMN GRANT. Same reason as the moderation guard
-- (20260918_content_moderation): a column-level REVOKE cannot cut into the
-- table-level UPDATE Supabase grants to `authenticated`, and grants here get
-- rebuilt as a side effect of recreating objects. A trigger fires on every
-- write regardless.
--
-- Apply via Supabase MCP (apply_migration), the Management API, or the SQL
-- editor.
-- ====================================================================

-- ---- 1. The phone gets a proof of its own -----------------------------------

alter table public.profiles
  add column if not exists seller_phone_verified_at timestamptz;

comment on column public.profiles.seller_phone_verified_at is
  'When the buyer-facing seller_phone was proven by a code texted to it and typed back by the account holder. Null = unproven, and an unproven number is never shown to buyers (lib/settings/seller-identity.ts). Only the service role can set it (guard_contact_proof).';

comment on column public.profiles.seller_email_verified_at is
  'When the buyer-facing seller_email was proven by a code emailed to it and typed back by the account holder. Null = unproven; the publish gate refuses while email proof is switched on. Only the service role can set it (guard_contact_proof).';

-- ---- 2. No proof survives that this mechanism did not issue ------------------
-- Every stored email proof predates this migration, and none of them is real:
-- 20260909 GRANDFATHERED every address that existed that day, and production
-- never had a mail sender bound, so no link was ever actually clicked. Keeping
-- them would mean the one guarantee this migration exists to give ("a proven
-- address was proven") is false for exactly the sellers who have been here
-- longest.
--
-- While the platform cannot send mail this changes nothing a buyer or seller
-- sees: the publish gate only asks for a proof when mail is switched on
-- (lib/contact-verification/availability.ts). The day it is switched on, every
-- seller is asked for a code once, which is the point.
update public.profiles
   set seller_email_verified_at = null
 where seller_email_verified_at is not null;

-- ---- 3. The link flow's token store goes ------------------------------------
drop table if exists public.seller_email_verifications;

-- ---- 4. Pending codes -------------------------------------------------------

create table if not exists public.contact_verifications (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid        not null references auth.users (id) on delete cascade,
  channel     text        not null,
  -- The exact value the code was sent to, copied from the profile when the code
  -- was issued. Redemption only proves the profile if it STILL holds this.
  target      text        not null,
  -- HMAC-SHA256 of the code under a Worker secret (CONTACT_VERIFICATION_KEY),
  -- bound to the owner and channel. Never the code itself.
  code_hash   text        not null,
  attempts    integer     not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  consumed_at timestamptz,

  constraint contact_verifications_channel check (channel in ('email', 'phone')),
  constraint contact_verifications_target_shape
    check (char_length(target) between 3 and 254),
  -- 64 lowercase hex characters: a digest and nothing else. A raw code
  -- reaching this column would be a plaintext-credential bug; this is the
  -- fence that catches it.
  constraint contact_verifications_code_hash_shape
    check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint contact_verifications_attempts_range
    check (attempts between 0 and 100),
  constraint contact_verifications_expiry_after_issue
    check (expires_at > created_at)
);

comment on table public.contact_verifications is
  'Pending one-time codes proving a seller owns their buyer-facing email/phone. Service-role only (RLS on, no policy, revoked from client roles); only an HMAC of each code is stored. Written and read through issue_contact_verification / redeem_contact_verification.';

-- At most ONE live code per account and channel. Issuing replaces; the unique
-- index is what makes "replaces" true under concurrency as well.
create unique index if not exists contact_verifications_one_live_idx
  on public.contact_verifications (owner_id, channel)
  where consumed_at is null;

alter table public.contact_verifications enable row level security;
-- No policy on purpose: RLS with no policy is a total deny for anon and
-- authenticated. The revokes are the part that matters (new objects in this
-- schema are auto-granted to the client roles); RLS is the second lock.
revoke all on public.contact_verifications from anon, authenticated;
grant all on public.contact_verifications to service_role;

-- ---- 5. Issuing a code ------------------------------------------------------
-- Binds a fresh code to the value the profile holds RIGHT NOW and returns that
-- value, which is the only address the caller may send the code to. The
-- recipient is therefore never something a request can name.
--
-- Returns null when there is nothing to prove: no value on file, or the value
-- on file is already proven.

create or replace function public.issue_contact_verification(
  p_owner       uuid,
  p_channel     text,
  p_code_hash   text,
  p_ttl_seconds integer
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_value text;
  proven_at     timestamptz;
begin
  if p_channel not in ('email', 'phone') then
    raise exception 'unknown contact channel %', p_channel using errcode = '22023';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 3600 then
    raise exception 'code lifetime out of range' using errcode = '22023';
  end if;

  -- Two sends racing for the same account and channel queue here rather than
  -- both inserting and one of them tripping the unique index.
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || ':' || p_channel, 0));

  if p_channel = 'email' then
    select seller_email, seller_email_verified_at into current_value, proven_at
      from public.profiles where id = p_owner;
  else
    select seller_phone, seller_phone_verified_at into current_value, proven_at
      from public.profiles where id = p_owner;
  end if;

  if current_value is null or proven_at is not null then
    return null;
  end if;

  -- Every earlier code for this channel dies, consumed or not: a resend must
  -- never leave a second working code behind, and the table stays one row
  -- per account and channel.
  delete from public.contact_verifications
   where owner_id = p_owner and channel = p_channel;

  insert into public.contact_verifications (owner_id, channel, target, code_hash, expires_at)
  values (p_owner, p_channel, current_value, p_code_hash, now() + make_interval(secs => p_ttl_seconds));

  return current_value;
end;
$$;

comment on function public.issue_contact_verification(uuid, text, text, integer) is
  'Replace the live code for (owner, channel) with a new one bound to the profile''s current value, and return that value (the only recipient the code may go to). Null when there is nothing to prove. Service role only.';

-- ---- 6. Redeeming a code ----------------------------------------------------
-- One call, one row lock, one answer:
--   none     no live code (never sent, or already used)
--   expired  the live code is past its lifetime
--   locked   too many wrong guesses on this code; a new one must be sent
--   mismatch wrong code (the guess still counts)
--   stale    right code, but the profile no longer holds the value it was
--            sent to, so there is nothing to prove any more
--   verified the profile's value is now proven
--
-- Deliberately RETURNS rather than raises on every failure: raising would roll
-- back the attempt counter, and an attempt that does not count is a free guess.

create or replace function public.redeem_contact_verification(
  p_owner        uuid,
  p_channel      text,
  p_code_hash    text,
  p_max_attempts integer
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pending public.contact_verifications%rowtype;
  proven  integer;
begin
  if p_channel not in ('email', 'phone') then
    raise exception 'unknown contact channel %', p_channel using errcode = '22023';
  end if;
  if p_max_attempts is null or p_max_attempts < 1 or p_max_attempts > 100 then
    raise exception 'attempt ceiling out of range' using errcode = '22023';
  end if;

  select * into pending
    from public.contact_verifications
   where owner_id = p_owner and channel = p_channel and consumed_at is null
   for update;

  if not found then return 'none'; end if;
  if pending.expires_at <= now() then return 'expired'; end if;
  if pending.attempts >= p_max_attempts then return 'locked'; end if;

  update public.contact_verifications
     set attempts = attempts + 1
   where id = pending.id;

  if pending.code_hash <> p_code_hash then
    return case when pending.attempts + 1 >= p_max_attempts then 'locked' else 'mismatch' end;
  end if;

  update public.contact_verifications
     set consumed_at = now()
   where id = pending.id;

  -- Re-checked at the write: only the exact value the code was sent to is
  -- proven. A change that landed after the code went out matches no row.
  if p_channel = 'email' then
    update public.profiles
       set seller_email_verified_at = now()
     where id = p_owner and seller_email = pending.target;
  else
    update public.profiles
       set seller_phone_verified_at = now()
     where id = p_owner and seller_phone = pending.target;
  end if;
  get diagnostics proven = row_count;

  return case when proven = 1 then 'verified' else 'stale' end;
end;
$$;

comment on function public.redeem_contact_verification(uuid, text, text, integer) is
  'Check a typed code against the live one for (owner, channel), counting the attempt, and prove the profile''s value if it matches and is unchanged. Returns none/expired/locked/mismatch/stale/verified. Service role only.';

-- Functions are executable by PUBLIC by default. These two run as the caller
-- (security invoker), so a client role would hit the table's deny-all anyway,
-- but a function a client cannot call at all is one fewer thing to reason
-- about.
revoke all on function public.issue_contact_verification(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.redeem_contact_verification(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.issue_contact_verification(uuid, text, text, integer) to service_role;
grant execute on function public.redeem_contact_verification(uuid, text, text, integer) to service_role;

-- ---- 7. The guard -----------------------------------------------------------
-- Two rules, enforced on every write to `profiles` however it arrives:
--
--   * A proof is GRANTED only by a trusted writer (the service role, which is
--     what redeem_contact_verification runs as). A client may clear its own
--     proof, never set one.
--   * A proof belongs to the VALUE it was granted for. Changing the email or
--     phone drops its proof in the same statement, unless a trusted writer set
--     both together (fixtures seeding a verified seller).
--
-- `current_user` is set by PostgREST's SET ROLE and cannot be influenced by
-- anything in the request body. The function is SECURITY INVOKER on purpose:
-- as a definer it would always see its owner and trust everyone.

create or replace function public.guard_contact_proof()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  trusted boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
begin
  if tg_op = 'INSERT' then
    if not trusted
       and (new.seller_email_verified_at is not null or new.seller_phone_verified_at is not null) then
      raise exception 'Contact details are confirmed with a code, not set directly.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if not trusted then
    if new.seller_email_verified_at is not null
       and new.seller_email_verified_at is distinct from old.seller_email_verified_at then
      raise exception 'Contact details are confirmed with a code, not set directly (column seller_email_verified_at).'
        using errcode = '42501';
    end if;
    if new.seller_phone_verified_at is not null
       and new.seller_phone_verified_at is distinct from old.seller_phone_verified_at then
      raise exception 'Contact details are confirmed with a code, not set directly (column seller_phone_verified_at).'
        using errcode = '42501';
    end if;
  end if;

  if new.seller_email is distinct from old.seller_email
     and new.seller_email_verified_at is not distinct from old.seller_email_verified_at then
    new.seller_email_verified_at := null;
  end if;
  if new.seller_phone is distinct from old.seller_phone
     and new.seller_phone_verified_at is not distinct from old.seller_phone_verified_at then
    new.seller_phone_verified_at := null;
  end if;

  return new;
end;
$$;

comment on function public.guard_contact_proof() is
  'Only the service role may prove seller_email/seller_phone, and changing either drops its proof. Attached to profiles.';

drop trigger if exists profiles_guard_contact_proof on public.profiles;
create trigger profiles_guard_contact_proof
  before insert or update on public.profiles
  for each row execute function public.guard_contact_proof();

notify pgrst, 'reload schema';
