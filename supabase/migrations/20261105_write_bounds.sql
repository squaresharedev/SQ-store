-- =============================================================================
-- Bounds on what a client can write straight through PostgREST
-- (security audit 2026-11-05, docs/security-audit-2026-11.md 1.10 and 1.11).
--
-- WHAT WAS OPEN. Supabase's API gateway took a 32 MB request body (tested
-- 2026-11-05), so on a direct write the database is the only size limit, and
-- some client-writable columns had none: products.title and description,
-- storefronts.config and brief, profiles.avatar_url, and rate_limits.action
-- (rl_take's caller-chosen name: every new name is a new row). Nothing caps
-- how many products or storefronts an account holds while the plan switch is
-- off, and Pro storefronts are unlimited when it is on. One free account could
-- add gigabytes in a few hundred requests. waitlist_signups and consent_logs
-- take anonymous inserts with the public key, at the Supabase host, where no
-- squareshare.eu edge rule applies: small rows, but no end to them.
--
-- And profiles.avatar_url took any text. The team page draws a member's as an
-- <img> for the owner, so a member could point it at their own server and see
-- when, and from where, the owner opened the page.
--
-- THE FIX.
--   * Size checks, each far above what the app accepts (named beside each), so
--     they only ever refuse a write that skipped the app.
--   * A ceiling per account for client writers, plan switch or not: 2000
--     products (product import's own ceiling, four times Pro's 500) and 200
--     storefronts. The service role is not counted against it.
--   * A platform-wide cap on anonymous inserts per minute, with the row's time
--     forced to now() so a backdated row cannot slip past the window: 120
--     consent records and 60 waitlist sign-ups. Under a flood, real ones are
--     refused for that minute too; the table no longer grows without end.
--   * A profile picture a client writes must be one moderation approved: the
--     record both upload paths write before they set the URL (Store
--     lib/settings/avatar.ts via checkAvatar, App worker/routes/profiles.ts).
-- =============================================================================

-- ---- Sizes -------------------------------------------------------------------

-- The app: 200 characters (lib/validation/product.ts).
alter table public.products drop constraint if exists products_title_length;
alter table public.products add constraint products_title_length
  check (char_length(title) <= 500);

-- The app: 5000 characters.
alter table public.products drop constraint if exists products_description_length;
alter table public.products add constraint products_description_length
  check (description is null or char_length(description) <= 20000);

-- The app: at most MAX_BLOCKS (120) blocks of bounded fields; the largest live
-- config was under 2 KB on 2026-11-05.
alter table public.storefronts drop constraint if exists storefronts_config_size;
alter table public.storefronts add constraint storefronts_config_size
  check (pg_column_size(config) <= 1048576);

alter table public.storefronts drop constraint if exists storefronts_brief_size;
alter table public.storefronts add constraint storefronts_brief_size
  check (brief is null or pg_column_size(brief) <= 16384);

-- A storage or Google URL is under 300 characters.
alter table public.profiles drop constraint if exists profiles_avatar_url_length;
alter table public.profiles add constraint profiles_avatar_url_length
  check (avatar_url is null or char_length(avatar_url) <= 2048);

-- The app's names are under 30 characters.
alter table public.rate_limits drop constraint if exists rate_limits_action_length;
alter table public.rate_limits add constraint rate_limits_action_length
  check (char_length(action) between 1 and 64);

-- ---- How many rows one account holds -----------------------------------------

create or replace function public.guard_account_ceiling()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ceiling integer := tg_argv[0]::integer;
  used    integer;
begin
  if coalesce((select auth.role()), '') <> 'authenticated' then
    return new;
  end if;
  -- An update only counts when the row moves into another account.
  if tg_op = 'UPDATE' and new.owner_id is not distinct from old.owner_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('account_ceiling:' || tg_table_name || ':' || new.owner_id::text, 0));

  if tg_table_name = 'products' then
    select count(*) into used from public.products where owner_id = new.owner_id;
  elsif tg_table_name = 'storefronts' then
    select count(*) into used from public.storefronts where owner_id = new.owner_id;
  else
    raise exception 'guard_account_ceiling: unsupported table %', tg_table_name;
  end if;

  if used >= ceiling then
    raise exception 'account_ceiling_reached:%', tg_table_name using errcode = '23514';
  end if;
  return new;
end
$$;

revoke execute on function public.guard_account_ceiling() from public, anon, authenticated;

drop trigger if exists products_account_ceiling on public.products;
create trigger products_account_ceiling
  before insert or update of owner_id on public.products
  for each row execute function public.guard_account_ceiling('2000');

drop trigger if exists storefronts_account_ceiling on public.storefronts;
create trigger storefronts_account_ceiling
  before insert or update of owner_id on public.storefronts
  for each row execute function public.guard_account_ceiling('200');

-- ---- Anonymous inserts --------------------------------------------------------

create index if not exists consent_logs_received_at_idx on public.consent_logs (received_at);
create index if not exists waitlist_signups_created_at_idx on public.waitlist_signups (created_at);

create or replace function public.guard_anonymous_insert_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  per_minute integer := tg_argv[0]::integer;
  recent     integer;
begin
  if coalesce((select auth.role()), '') not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_table_name = 'consent_logs' then
    new.received_at := now();
    select count(*) into recent from public.consent_logs where received_at > now() - interval '1 minute';
  elsif tg_table_name = 'waitlist_signups' then
    new.created_at := now();
    select count(*) into recent from public.waitlist_signups where created_at > now() - interval '1 minute';
  else
    raise exception 'guard_anonymous_insert_rate: unsupported table %', tg_table_name;
  end if;

  if recent >= per_minute then
    raise exception 'Too many at once. Try again in a minute.' using errcode = '54000';
  end if;
  return new;
end
$$;

revoke execute on function public.guard_anonymous_insert_rate() from public, anon, authenticated;

drop trigger if exists consent_logs_insert_rate on public.consent_logs;
create trigger consent_logs_insert_rate
  before insert on public.consent_logs
  for each row execute function public.guard_anonymous_insert_rate('120');

drop trigger if exists waitlist_signups_insert_rate on public.waitlist_signups;
create trigger waitlist_signups_insert_rate
  before insert on public.waitlist_signups
  for each row execute function public.guard_anonymous_insert_rate('60');

-- ---- Profile pictures ----------------------------------------------------------

-- Definer: moderation_checks is service-role only.
create or replace function public.guard_avatar_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'authenticated' then
    return new;
  end if;
  if new.avatar_url is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.avatar_url is not distinct from old.avatar_url then
    return new;
  end if;
  if not exists (
    select 1 from public.moderation_checks k
     where k.subject = 'avatar:' || new.avatar_url
       and k.verdict = 'clean'
  ) then
    raise exception 'A profile picture is added by uploading it, not by naming it.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

revoke execute on function public.guard_avatar_url() from public, anon, authenticated;

drop trigger if exists profiles_guard_avatar_url on public.profiles;
create trigger profiles_guard_avatar_url
  before insert or update of avatar_url on public.profiles
  for each row execute function public.guard_avatar_url();

notify pgrst, 'reload schema';
