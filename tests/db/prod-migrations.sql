-- =============================================================================
-- PROD MIGRATION REPLAY — SQ-store (vnyfndqpdllwhvhinjoi)
--
-- Extracted from supabase_migrations.schema_migrations. Last reconciled
-- 2026-08-07 against 45 applied migrations.
--
-- HOW TO REFRESH: `pnpm check:migrations` reports which applied
-- migrations are missing here. It is a CHECK, not a generator — this
-- file is hand-curated (see the exclusion below), so a blind dump would undo
-- that. Add what it reports, in dependency order, and update the date above.
--
-- WHY THIS MATTERS: the DB integration and E2E suites build their whole
-- database from this file. Anything in prod but not here is a table the RLS
-- tests cannot see. That is not hypothetical — artifact_likes, follows and
-- reports (SQ-app, migration 20260711195645) were missing until 2026-08-07,
-- so nothing tested them despite their being reachable with this app's
-- publishable anon key.
--
-- DELIBERATE EXCLUSION: 20260801140113 demo_sales_sim / 20260801140742
-- demo_sales_sim_reconcile. They require pg_cron, which the embedded-Postgres
-- test stack does not ship, so replaying them fails the whole suite at setup.
-- The demo schema is unreachable over PostgREST and has no bearing on any
-- security invariant under test. The checker knows to skip them.
-- =============================================================================

-- ===== 20260706081542 create_profiles_with_rls ===============================
-- =============================================================================
-- profiles: one row per auth user. Buyer and seller are the SAME account;
-- `is_seller` flips true when the user sets up a store (later phase).
-- =============================================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  is_seller    boolean     not null default false,
  display_name text,
  avatar_url   text
);

comment on table public.profiles is
  'Public profile per auth user. Buyer and seller share one account; is_seller flips true when a store is created.';

-- Keep updated_at fresh on every update.
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- Auto-create a profile row whenever a new auth user signs up. SECURITY DEFINER
-- so it can insert past RLS; empty search_path per Supabase hardening guidance.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- Row-Level Security: a user can read and update ONLY their own profile.
-- Inserts happen via the SECURITY DEFINER trigger above (not from clients).
-- =============================================================================
alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by the owner" on public.profiles;
create policy "Profiles are viewable by the owner"
  on public.profiles
  for select
  to authenticated
  using ( (select auth.uid()) = id );

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

-- ===== 20260706081558 harden_profile_trigger_functions =======================
-- These are trigger functions only; they should never be callable via the REST
-- RPC surface. Revoking EXECUTE from the API roles clears the security advisor
-- warning. Triggers still fire (the trigger mechanism does not require EXECUTE).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_updated_at() from public, anon, authenticated;

-- ===== 20260706081613 profile_trigger_map_oauth_metadata =====================
-- Broaden the signup trigger to also pick up OAuth (Google) metadata keys:
-- Google returns full_name/name for the name and picture/avatar_url for the image.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
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
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- create or replace preserves grants, but re-assert the hardening to be safe.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ===== 20260706081631 create_products ========================================
-- Products a seller offers through their store/embeds.
-- Money is integer cents (never floats). File bytes live in R2; rows store keys.
create table public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'EUR' check (currency in ('EUR','USD')),
  status text not null default 'draft' check (status in ('draft','active')),
  image_key text,
  digital_file_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The list view reads "my products"; index the owner scan.
create index products_owner_id_idx on public.products (owner_id);

alter table public.products enable row level security;

-- Owner-scoped access only. (select auth.uid()) is cached per-statement,
-- avoiding a per-row re-evaluation.
create policy "products_select_own" on public.products
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "products_insert_own" on public.products
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "products_update_own" on public.products
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "products_delete_own" on public.products
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Keep updated_at current. Empty search_path so the function can't be
-- hijacked via schema resolution.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ===== 20260706081644 harden_rls_auto_enable_execute =========================
-- Security advisor fix: rls_auto_enable() is SECURITY DEFINER and was
-- executable via /rest/v1/rpc by anon + authenticated. It is an internal
-- helper; nothing client-side calls it.
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;

-- ===== 20260706081700 create_storefronts =====================================
-- One storefront (bento grid + theme) per seller. `id` is the STABLE PUBLIC
-- identifier: the future buyer-facing embed keys on it and sales will be
-- attributed to it (channel 'embed' vs 'marketplace') - never repurpose it.
-- `config` is validated by the app's Zod schema on every write.
create table public.storefronts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade unique,
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.storefronts enable row level security;

create policy "storefronts_select_own" on public.storefronts
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy "storefronts_insert_own" on public.storefronts
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "storefronts_update_own" on public.storefronts
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "storefronts_delete_own" on public.storefronts
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Reuse the shared updated_at trigger function from the products migration.
create trigger storefronts_set_updated_at
  before update on public.storefronts
  for each row execute function public.set_updated_at();

-- ===== 20260706081724 settings_profile_fields ================================
-- Settings slice: notification preferences, EU tax info (collected only, not
-- yet used downstream), legal acceptance, and an account-deletion request flag.
alter table public.profiles
  add column notify_sales boolean not null default true,
  add column notify_product_updates boolean not null default true,
  add column notify_marketing boolean not null default false,
  add column tax_business_name text
    check (tax_business_name is null or char_length(tax_business_name) between 1 and 200),
  add column tax_vat_id text
    check (tax_vat_id is null or tax_vat_id ~ '^[A-Za-z0-9 .-]{2,32}$'),
  add column tax_country text
    check (tax_country is null or tax_country ~ '^[A-Z]{2}$'),
  add column legal_accepted_at timestamptz,
  add column legal_accepted_version text
    check (legal_accepted_version is null or char_length(legal_accepted_version) <= 32),
  add column deletion_requested_at timestamptz;

comment on column public.profiles.notify_sales is
  'Email pref: alert on each sale. Default on.';
comment on column public.profiles.notify_product_updates is
  'Email pref: Square Share product/feature updates. Default on.';
comment on column public.profiles.notify_marketing is
  'Email pref: tips + marketplace news. Default off.';
comment on column public.profiles.tax_business_name is
  'Seller business name (EU tax). Collected in settings; NOT used downstream yet.';
comment on column public.profiles.tax_vat_id is
  'EU VAT ID. Collected in settings; not validated against VIES; NOT used downstream yet.';
comment on column public.profiles.tax_country is
  'ISO 3166-1 alpha-2 country code. Collected in settings; NOT used downstream yet.';
comment on column public.profiles.legal_accepted_at is
  'When the user accepted the seller agreement / terms / privacy.';
comment on column public.profiles.legal_accepted_version is
  'Version tag of the legal docs the user accepted.';
comment on column public.profiles.deletion_requested_at is
  'Soft deletion-request flag set from settings. Hard delete needs a service-role job: auth.admin.deleteUser cascades to profiles/products/storefronts, plus R2 object cleanup.';

-- ===== 20260706081743 create_orders ==========================================
-- Orders: sales records for the seller dashboard.
-- Written server-side only (future checkout webhook; dev seed via service_role).
-- End users never insert here, so there is intentionally NO public insert policy.
create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),
  seller_id           uuid not null references auth.users(id) on delete cascade,
  product_id          uuid references public.products(id) on delete set null,
  storefront_id       uuid references public.storefronts(id) on delete set null,
  channel             text not null check (channel in ('embed','marketplace')),
  status              text not null default 'paid'
                        check (status in ('paid','refunded','disputed','pending')),
  amount_cents        integer not null check (amount_cents >= 0),
  platform_fee_cents  integer not null default 0 check (platform_fee_cents >= 0),
  currency            text not null default 'EUR',
  buyer_email         text,
  -- Snapshot at time of sale: survives later product edits/deletes.
  product_title       text not null,
  product_price_cents integer not null,
  created_at          timestamptz not null default now()
);

comment on table public.orders is
  'Sales/orders written server-side (checkout webhook / dev seed via service_role). Read by the seller dashboard. Snapshot columns preserve the sale even if the product is edited or deleted.';

-- Seller can only ever read their own orders. No insert/update/delete policies:
-- writes happen via service_role (bypasses RLS); buyers get no access at all.
alter table public.orders enable row level security;

create policy "Sellers read own orders"
  on public.orders
  for select
  using (seller_id = auth.uid());

-- Dashboard query paths: revenue-over-time and channel split, both per seller.
create index if not exists orders_seller_created_idx
  on public.orders (seller_id, created_at);
create index if not exists orders_seller_channel_idx
  on public.orders (seller_id, channel);

-- ===== 20260706081759 storefronts_multiple_per_owner =========================
-- Allow multiple storefronts per seller (nested storefronts UX).
alter table public.storefronts
  drop constraint if exists storefronts_owner_id_key;

-- Keep owner-scoped lookups fast now that owner_id is no longer unique.
create index if not exists storefronts_owner_id_idx
  on public.storefronts (owner_id);

-- Human-readable name shown in the storefront list / editor.
alter table public.storefronts
  add column if not exists name text not null default 'Untitled storefront';

alter table public.storefronts
  drop constraint if exists storefronts_name_length;
alter table public.storefronts
  add constraint storefronts_name_length
  check (char_length(name) between 1 and 80);

-- Deleting a storefront should detach its orders (preserve sale history),
-- not be blocked by the FK. orders.storefront_id is nullable.
alter table public.orders
  drop constraint if exists orders_storefront_id_fkey;
alter table public.orders
  add constraint orders_storefront_id_fkey
  foreign key (storefront_id) references public.storefronts (id)
  on delete set null;

-- ===== 20260706081821 add_product_stock_tracking =============================
-- Stock / inventory tracking on products. Backward-compatible: every existing
-- row keeps working (track_stock defaults false = unlimited, quantity null).
alter table public.products
  add column track_stock boolean not null default false,
  add column stock_quantity integer
    check (stock_quantity is null or stock_quantity >= 0),
  add column low_stock_threshold integer not null default 5
    check (low_stock_threshold >= 0);

-- When tracking is on, a concrete quantity must exist (derivations stay total).
-- Old rows all have track_stock = false, so this cannot invalidate them.
alter table public.products
  add constraint products_tracked_stock_has_quantity
    check (not track_stock or stock_quantity is not null);

comment on column public.products.track_stock is
  'Opt-in per product. false = unlimited stock (no badge, no decrement).';
comment on column public.products.stock_quantity is
  'Units on hand when track_stock. Server-authoritative; changed only by owner adjust or atomic checkout decrement. Never below 0.';
comment on column public.products.low_stock_threshold is
  'At or below this remaining quantity the public badge becomes low_stock.';

-- ATOMIC oversell-proof decrement: one UPDATE whose WHERE clause is the stock
-- check, so two concurrent checkouts can never both succeed past zero.
create or replace function public.decrement_stock(
  p_product_id uuid,
  p_quantity integer
) returns boolean
language sql
security invoker
set search_path = ''
as $$
  update public.products
     set stock_quantity = stock_quantity - p_quantity,
         updated_at = now()
   where id = p_product_id
     and track_stock
     and p_quantity > 0
     and stock_quantity >= p_quantity
  returning true;
$$;

revoke execute on function public.decrement_stock(uuid, integer) from public;
revoke execute on function public.decrement_stock(uuid, integer) from anon;
revoke execute on function public.decrement_stock(uuid, integer) from authenticated;
grant execute on function public.decrement_stock(uuid, integer) to service_role;

-- ===== 20260706122746 create_team_members_with_rls ===========================
-- TEAM & ACCESS ---------------------------------------------------------------
-- Memberships on a store account ("account" = the owning user's profile id).
create type public.team_role as enum ('owner', 'editor', 'viewer');
create type public.team_member_status as enum ('invited', 'active', 'revoked');

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  account_owner_id uuid not null references public.profiles(id) on delete cascade,
  -- Null until the invite is accepted; then the member's auth uid.
  member_user_id uuid references public.profiles(id) on delete cascade,
  invited_email text not null
    check (
      invited_email = lower(btrim(invited_email))
      and invited_email like '%_@_%'
      and char_length(invited_email) <= 254
    ),
  role public.team_role not null default 'viewer',
  status public.team_member_status not null default 'invited',
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  updated_at timestamptz not null default now(),
  -- The owner row is always the account owner themselves, active from day one.
  constraint team_members_owner_is_self
    check (role <> 'owner' or (member_user_id = account_owner_id and status = 'active')),
  -- Link state must match lifecycle state.
  constraint team_members_status_link check (
    case status
      when 'invited' then member_user_id is null and accepted_at is null
      when 'active'  then member_user_id is not null and accepted_at is not null
      else true
    end
  )
);

comment on table public.team_members is
  'Team & access memberships per store account. Owner row is seeded by trigger; invites/role changes/revocations flow through server actions under RLS + guard trigger.';

-- At most one owner per account (seed trigger below guarantees at least one).
create unique index team_members_one_owner_per_account
  on public.team_members (account_owner_id) where (role = 'owner');
-- One row per invited address per account (re-invites reuse the row).
create unique index team_members_unique_invitee_email
  on public.team_members (account_owner_id, lower(invited_email));
-- One membership per linked user per account.
create unique index team_members_unique_member
  on public.team_members (account_owner_id, member_user_id) where (member_user_id is not null);
-- Roster list queries (paginated).
create index team_members_account_list
  on public.team_members (account_owner_id, status, invited_at desc);
-- Invite lookup by the invitee's email.
create index team_members_invited_email
  on public.team_members (lower(invited_email)) where (status = 'invited');
-- "Teams I belong to" lookups.
create index team_members_member_user
  on public.team_members (member_user_id) where (member_user_id is not null);

-- --- Permission model ---------------------------------------------------------
-- MIRROR of src/lib/team/permissions.ts. Edit BOTH together, in one migration.
create or replace function public.team_role_can(r public.team_role, action text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when r is null then false
    when r = 'owner'  then action in ('team.read', 'team.invite', 'team.change_role', 'team.revoke')
    when r = 'editor' then action in ('team.read', 'team.invite')
    when r = 'viewer' then action in ('team.read')
    else false
  end
$$;

-- Role hierarchy for "cannot grant above your own role" checks.
create or replace function public.team_role_rank(r public.team_role)
returns smallint
language sql immutable
set search_path = ''
as $$
  select case r when 'owner' then 3::smallint when 'editor' then 2::smallint else 1::smallint end
$$;

-- The caller's ACTIVE role on an account, null if not an active member.
create or replace function public.team_actor_role(account uuid)
returns public.team_role
language sql stable security definer
set search_path = ''
as $$
  select tm.role
  from public.team_members tm
  where tm.account_owner_id = account
    and tm.member_user_id = (select auth.uid())
    and tm.status = 'active'
  limit 1
$$;

-- Lowercased email claim of the calling JWT (null when absent).
create or replace function public.team_jwt_email()
returns text
language sql stable
set search_path = ''
as $$
  select lower(nullif(auth.jwt() ->> 'email', ''))
$$;

-- --- Guard triggers ------------------------------------------------------------

-- Normalize before constraints/policies see the row.
create or replace function public.team_members_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.invited_email := lower(btrim(new.invited_email));
  return new;
end
$$;

create trigger team_members_normalize
  before insert on public.team_members
  for each row execute function public.team_members_normalize();

-- Column-level invariants RLS cannot express.
create or replace function public.team_members_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_role public.team_role;
begin
  new.invited_email := lower(btrim(new.invited_email));
  new.updated_at := now();

  if coalesce((select auth.role()), '') <> 'authenticated' then
    return new;
  end if;

  -- Identity columns are frozen.
  if new.id <> old.id
     or new.account_owner_id <> old.account_owner_id
     or new.invited_email <> lower(old.invited_email) then
    raise exception 'team_members: identity columns are immutable';
  end if;
  -- invited_at may only move when a revoked member is re-invited.
  if new.invited_at <> old.invited_at
     and not (old.status = 'revoked' and new.status = 'invited') then
    raise exception 'team_members: invited_at is immutable';
  end if;

  -- The owner membership can never be modified, and ownership is never granted.
  if old.role = 'owner' then
    raise exception 'team_members: the owner membership cannot be modified';
  end if;
  if new.role = 'owner' then
    raise exception 'team_members: ownership cannot be granted';
  end if;

  actor_role := public.team_actor_role(old.account_owner_id);

  if old.status = 'invited' and new.status = 'active' then
    -- Accept path: only the invited email's owner may accept, binding to self.
    if public.team_jwt_email() is null
       or lower(old.invited_email) <> public.team_jwt_email() then
      raise exception 'team_members: invite email does not match the signed-in user';
    end if;
    if new.member_user_id is distinct from (select auth.uid()) then
      raise exception 'team_members: invites can only be linked to the accepting user';
    end if;
    if new.role <> old.role then
      raise exception 'team_members: role cannot change while accepting an invite';
    end if;
    if new.accepted_at is null then
      new.accepted_at := now();
    end if;
    return new;
  end if;

  -- Management paths below. Nothing else may change the linked user.
  if new.member_user_id is distinct from old.member_user_id
     and not (old.status = 'revoked' and new.status = 'invited' and new.member_user_id is null) then
    raise exception 'team_members: member link can only change on accept or re-invite';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'revoked' then
      if not public.team_role_can(actor_role, 'team.revoke') then
        raise exception 'team_members: you do not have permission to revoke access';
      end if;
    elsif old.status = 'revoked' and new.status = 'invited' then
      if not public.team_role_can(actor_role, 'team.invite') then
        raise exception 'team_members: you do not have permission to re-invite';
      end if;
      if new.accepted_at is not null then
        raise exception 'team_members: re-invites must reset acceptance';
      end if;
    else
      raise exception 'team_members: status transition % -> % is not allowed', old.status, new.status;
    end if;
  end if;

  if new.role is distinct from old.role then
    if not public.team_role_can(actor_role, 'team.change_role') then
      raise exception 'team_members: you do not have permission to change roles';
    end if;
  end if;
  -- No escalation: the resulting role can never outrank the actor.
  if public.team_role_rank(new.role) > public.team_role_rank(actor_role) then
    raise exception 'team_members: cannot grant a role above your own';
  end if;

  return new;
end
$$;

create trigger team_members_guard
  before update on public.team_members
  for each row execute function public.team_members_guard();

-- --- RLS ------------------------------------------------------------------------

alter table public.team_members enable row level security;

-- Active members read their team; invitees see their own pending invites.
create policy team_members_select_roster on public.team_members
  for select to authenticated
  using (
    public.team_role_can(public.team_actor_role(account_owner_id), 'team.read')
    or (status = 'invited' and lower(invited_email) = (select public.team_jwt_email()))
  );

-- Invites: actors holding team.invite, never at a rank above their own,
-- always least-privilege shaped (pending, unlinked, non-owner).
create policy team_members_insert_invite on public.team_members
  for insert to authenticated
  with check (
    role <> 'owner'
    and status = 'invited'
    and member_user_id is null
    and public.team_role_can(public.team_actor_role(account_owner_id), 'team.invite')
    and public.team_role_rank(role) <= public.team_role_rank(public.team_actor_role(account_owner_id))
  );

-- Management updates (role change / revoke / re-invite).
create policy team_members_update_manage on public.team_members
  for update to authenticated
  using (
    role <> 'owner'
    and (
      public.team_role_can(public.team_actor_role(account_owner_id), 'team.change_role')
      or public.team_role_can(public.team_actor_role(account_owner_id), 'team.revoke')
      or public.team_role_can(public.team_actor_role(account_owner_id), 'team.invite')
    )
  )
  with check (
    role <> 'owner'
    and public.team_role_rank(role) <= public.team_role_rank(public.team_actor_role(account_owner_id))
  );

-- Accept path: the invitee flips their own pending invite to active.
create policy team_members_update_accept on public.team_members
  for update to authenticated
  using (status = 'invited' and lower(invited_email) = (select public.team_jwt_email()))
  with check (
    role <> 'owner'
    and status = 'active'
    and member_user_id = (select auth.uid())
  );

-- No DELETE policy on purpose.

-- --- Roster RPCs (SECURITY DEFINER, self-gated) ---------------------------------
create or replace function public.team_roster(account uuid, page_limit integer default 50, page_offset integer default 0)
returns table (
  id uuid,
  member_user_id uuid,
  invited_email text,
  role public.team_role,
  status public.team_member_status,
  invited_at timestamptz,
  accepted_at timestamptz,
  display_name text
)
language sql stable security definer
set search_path = ''
as $$
  select tm.id, tm.member_user_id, tm.invited_email, tm.role, tm.status,
         tm.invited_at, tm.accepted_at, p.display_name
  from public.team_members tm
  left join public.profiles p on p.id = tm.member_user_id
  where tm.account_owner_id = account
    and public.team_role_can(public.team_actor_role(account), 'team.read')
  order by public.team_role_rank(tm.role) desc, tm.invited_at asc, tm.id asc
  limit least(greatest(coalesce(page_limit, 50), 1), 100)
  offset greatest(coalesce(page_offset, 0), 0)
$$;

-- Pending invites addressed to the calling user's verified email.
create or replace function public.team_my_pending_invites()
returns table (
  id uuid,
  account_owner_id uuid,
  role public.team_role,
  invited_at timestamptz,
  store_name text
)
language sql stable security definer
set search_path = ''
as $$
  select tm.id, tm.account_owner_id, tm.role, tm.invited_at,
         coalesce(p.display_name, 'A SquareShare store')
  from public.team_members tm
  left join public.profiles p on p.id = tm.account_owner_id
  where tm.status = 'invited'
    and lower(tm.invited_email) = (select public.team_jwt_email())
  order by tm.invited_at desc
$$;

-- --- Owner seeding ---------------------------------------------------------------
create or replace function public.team_seed_owner()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  owner_email text;
begin
  select lower(u.email) into owner_email from auth.users u where u.id = new.id;
  insert into public.team_members
    (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
  values
    (new.id, new.id, coalesce(owner_email, new.id::text || '@account.invalid'), 'owner', 'active', now())
  on conflict do nothing;
  return new;
end
$$;

create trigger team_seed_owner
  after insert on public.profiles
  for each row execute function public.team_seed_owner();

-- Backfill owner rows for existing accounts.
insert into public.team_members
  (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
select p.id, p.id, coalesce(lower(u.email), p.id::text || '@account.invalid'), 'owner', 'active', now()
from public.profiles p
left join auth.users u on u.id = p.id
on conflict do nothing;

-- --- Function grants --------------------------------------------------------------
revoke execute on all functions in schema public from public;
revoke execute on function public.team_actor_role(uuid) from anon;
revoke execute on function public.team_roster(uuid, integer, integer) from anon;
revoke execute on function public.team_my_pending_invites() from anon;
grant execute on function
  public.team_role_can(public.team_role, text),
  public.team_role_rank(public.team_role),
  public.team_actor_role(uuid),
  public.team_jwt_email(),
  public.team_roster(uuid, integer, integer),
  public.team_my_pending_invites()
to authenticated, service_role;

-- ===== 20260706125014 team_lock_down_trigger_functions =======================
revoke execute on function public.team_seed_owner() from public, anon, authenticated;
revoke execute on function public.team_members_guard() from public, anon, authenticated;
revoke execute on function public.team_members_normalize() from public, anon, authenticated;

-- team_jwt_email leaks nothing (your own claim) but anon has no use for it.
revoke execute on function public.team_jwt_email() from anon;

-- ===== 20260706130657 team_accept_invite_rpc =================================
-- Acceptance is an atomic, server-authoritative RPC.
create or replace function public.team_accept_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.team_jwt_email();
  v_uid uuid := (select auth.uid());
  v_updated uuid;
begin
  if v_uid is null or v_email is null then
    return false; -- unauthenticated or no verified email
  end if;

  update public.team_members
     set status = 'active',
         member_user_id = v_uid,
         accepted_at = now()
   where id = p_invite_id
     and status = 'invited'
     and lower(invited_email) = v_email  -- identity: this invite is addressed to me
     and role <> 'owner'
   returning id into v_updated;

  return v_updated is not null;
end
$$;

-- Direct-update acceptance is no longer a path.
drop policy if exists team_members_update_accept on public.team_members;

revoke execute on function public.team_accept_invite(uuid) from public, anon;
grant execute on function public.team_accept_invite(uuid) to authenticated, service_role;

-- ===== 20260706140056 create_notifications_with_rls_realtime =================
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null check (type in ('team','payment','stock','order','system')),
  title      text not null check (char_length(title) <= 200),
  body       text check (body is null or char_length(body) <= 1000),
  data       jsonb not null default '{}',
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'Per-user notification feed. Created server-side (service_role) only; users read own rows and mark read. Realtime-enabled, RLS-filtered.';
comment on column public.notifications.type is
  'Notification category. Extensible: add a value to this CHECK + the Zod enum in lib/notifications/validation.ts together.';

-- List query: newest-first per user.
create index notifications_user_created on public.notifications (user_id, created_at desc);
-- Unread count / unread filter per user.
create index notifications_user_read on public.notifications (user_id, read);

alter table public.notifications enable row level security;

-- Own-rows read.
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Own-rows update (mark read).
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- NO insert/delete policy on purpose: creation is service_role only.

-- Least-privilege column grants.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;

-- Realtime: FULL replica identity.
alter table public.notifications replica identity full;

alter publication supabase_realtime add table public.notifications;

-- ===== 20260706152026 user_id_by_email_resolver ==============================
create or replace function public.user_id_by_email(p_email text)
returns uuid language sql stable security definer set search_path = ''
as $$ select id from auth.users where lower(email) = lower(btrim(p_email)) limit 1 $$;
revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.user_id_by_email(text) to service_role;

-- ===== 20260706153749 add_display_name_uniqueness ============================
create unique index profiles_display_name_lower_idx
  on public.profiles (lower(display_name))
  where display_name is not null;

create or replace function public.is_display_name_available(p_display_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1 from public.profiles
    where lower(display_name) = lower(p_display_name)
      and id <> auth.uid()
  );
$$;

revoke all on function public.is_display_name_available(text) from public;
grant execute on function public.is_display_name_available(text) to authenticated;

-- ===== 20260706153835 revoke_anon_display_name_available =====================
revoke execute on function public.is_display_name_available(text) from anon;

-- ===== 20260706154640 team_store_access_rls ==================================
-- MULTI-TENANT STORE ACCESS: members read the owner's store; editors/owner write.

-- 1) Permission mirror: add the store actions to the SQL source of truth.
create or replace function public.team_role_can(r public.team_role, action text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when r is null then false
    when r = 'owner'  then action in ('team.read','team.invite','team.change_role','team.revoke','store.read','products.write','storefront.write')
    when r = 'editor' then action in ('team.read','team.invite','store.read','products.write','storefront.write')
    when r = 'viewer' then action in ('team.read','store.read')
    else false
  end
$$;

-- 2) products: members read; owner/editor write.
drop policy if exists products_select_own on public.products;
drop policy if exists products_insert_own on public.products;
drop policy if exists products_update_own on public.products;
drop policy if exists products_delete_own on public.products;

create policy products_select_member on public.products
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'store.read')
  );
create policy products_insert_writer on public.products
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'products.write')
  );
create policy products_update_writer on public.products
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'products.write')
  )
  with check (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'products.write')
  );
create policy products_delete_writer on public.products
  for delete to authenticated
  using (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'products.write')
  );

-- 3) storefronts: members read; owner/editor write.
drop policy if exists storefronts_select_own on public.storefronts;
drop policy if exists storefronts_insert_own on public.storefronts;
drop policy if exists storefronts_update_own on public.storefronts;
drop policy if exists storefronts_delete_own on public.storefronts;

create policy storefronts_select_member on public.storefronts
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'store.read')
  );
create policy storefronts_insert_writer on public.storefronts
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'storefront.write')
  );
create policy storefronts_update_writer on public.storefronts
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'storefront.write')
  )
  with check (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'storefront.write')
  );
create policy storefronts_delete_writer on public.storefronts
  for delete to authenticated
  using (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'storefront.write')
  );

-- 4) orders: members read (no client writes exist).
drop policy if exists "Sellers read own orders" on public.orders;
create policy orders_select_member on public.orders
  for select to authenticated
  using (
    seller_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(seller_id), 'store.read')
  );

-- 5) Accounts the caller can access.
create or replace function public.team_my_accounts()
returns table (
  account_owner_id uuid,
  role public.team_role,
  store_name text,
  is_self boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    tm.account_owner_id,
    tm.role,
    coalesce(nullif(btrim(p.display_name), ''), 'A SquareShare store') as store_name,
    (tm.account_owner_id = (select auth.uid())) as is_self
  from public.team_members tm
  left join public.profiles p on p.id = tm.account_owner_id
  where tm.member_user_id = (select auth.uid())
    and tm.status = 'active'
  order by (tm.account_owner_id = (select auth.uid())) desc, store_name asc
$$;

revoke execute on function public.team_my_accounts() from public, anon;
grant execute on function public.team_my_accounts() to authenticated, service_role;

-- ===== 20260706174216 avatars_storage_and_rate_limits ========================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true,
  2097152,                                   -- 2 MB hard cap, enforced by Storage
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatars');

-- GENERIC RATE LIMITER: fixed-window counter per (user, action).
create table if not exists public.rate_limits (
  user_id      uuid not null references auth.users(id) on delete cascade,
  action       text not null,
  window_start timestamptz not null default now(),
  count        integer not null default 0,
  primary key (user_id, action)
);
alter table public.rate_limits enable row level security;
-- No policies on purpose: definer function + service_role only.

create or replace function public.rl_take(
  p_action text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  new_count integer;
begin
  if uid is null then
    return false;
  end if;

  insert into public.rate_limits (user_id, action, window_start, count)
  values (uid, p_action, now(), 1)
  on conflict (user_id, action) do update set
    count = case
      when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
        then 1
      else public.rate_limits.count + 1
    end,
    window_start = case
      when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
        then now()
      else public.rate_limits.window_start
    end
  returning count into new_count;

  return new_count <= p_max;
end
$$;

revoke execute on function public.rl_take(text, integer, integer) from public, anon;
grant execute on function public.rl_take(text, integer, integer) to authenticated, service_role;

-- ===== 20260706175405 avatars_drop_listing_policy ============================
drop policy if exists "avatars public read" on storage.objects;

-- ===== 20260707102615 admin_foundation =======================================
-- Staff allowlist. Seeded MANUALLY. No self-serve path exists in any app.
create table public.admin_users (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

-- Audit log of admin actions.
create table public.admin_audit_log (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users (id) on delete restrict,
  action        text not null,
  target        text,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index admin_audit_log_admin_user_id_idx on public.admin_audit_log (admin_user_id);
create index admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);

alter table public.admin_users enable row level security;
alter table public.admin_audit_log enable row level security;

-- "Is the caller staff?" - security definer avoids RLS recursion.
create or replace function public.is_squareshare_staff()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.admin_users au
    where au.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_squareshare_staff() from public, anon;
grant execute on function public.is_squareshare_staff() to authenticated;

create policy "staff can read admin_users"
  on public.admin_users for select to authenticated
  using ((select public.is_squareshare_staff()));

create policy "staff can read audit log"
  on public.admin_audit_log for select to authenticated
  using ((select public.is_squareshare_staff()));

create policy "staff can append to audit log as themselves"
  on public.admin_audit_log for insert to authenticated
  with check (
    (select public.is_squareshare_staff())
    and admin_user_id = (
      select au.id from public.admin_users au
      where au.user_id = (select auth.uid())
    )
  );
-- Append-only: no update/delete policies.

-- ===== 20260707102622 seed_first_owner =======================================
insert into public.admin_users (user_id, role)
select id, 'owner' from auth.users where email = 'edwardsadrianj@gmail.com'
on conflict (user_id) do nothing;

-- ===== 20260707102628 waitlist_signups =======================================
create table public.waitlist_signups (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  source     text,
  owner_id   uuid,
  list_id    uuid,
  created_at timestamptz not null default now()
);
alter table public.waitlist_signups enable row level security;
create policy "public can join waitlist"
  on public.waitlist_signups for insert to anon, authenticated
  with check (true);
-- no read policies: admin reads via service_role only.

-- ===== 20260707102636 admin_user_directory_view ==============================
create or replace view public.admin_user_directory
with (security_invoker = false)
as
select
  u.id,
  u.email::text as email,
  coalesce(
    p.display_name,
    u.raw_user_meta_data ->> 'display_name',
    u.raw_user_meta_data ->> 'name',
    u.raw_user_meta_data ->> 'full_name'
  ) as display_name,
  u.created_at,
  u.banned_until,
  u.email_confirmed_at,
  (p.id is not null) as is_seller
from auth.users u
left join public.profiles p on p.id = u.id;

revoke all on public.admin_user_directory from public, anon, authenticated;
grant select on public.admin_user_directory to service_role;

-- ===== 20260707121316 waitlist_signups_unique_email ==========================
create unique index waitlist_signups_email_lower_idx on public.waitlist_signups (lower(email));

-- ===== 20260711_cost_audit_indexes ==========================================
-- Additive covering indexes for hot read paths + unindexed FKs (see the matching
-- supabase/migrations file). Result-neutral; planner options only.
create index if not exists orders_product_id_idx
  on public.orders (product_id);
create index if not exists orders_storefront_id_idx
  on public.orders (storefront_id);
create index if not exists orders_seller_status_idx
  on public.orders (seller_id, status);
create index if not exists orders_seller_amount_idx
  on public.orders (seller_id, amount_cents);
create index if not exists products_owner_created_idx
  on public.products (owner_id, created_at desc);
create index if not exists storefronts_owner_updated_idx
  on public.storefronts (owner_id, updated_at desc);

-- ===== 20260720_cost_audit_buyer_email_trgm =================================
-- Trigram index so the orders buyer_email ILIKE '%term%' search is index-backed
-- instead of scanning the seller's orders.
create extension if not exists pg_trgm;
create index if not exists orders_buyer_email_trgm_idx
  on public.orders using gin (buyer_email gin_trgm_ops);

-- ===== 20260720_cost_audit_bound_pending_invites ============================
-- Bound the pending-invites RPC (body otherwise unchanged).
create or replace function public.team_my_pending_invites()
 returns table(id uuid, account_owner_id uuid, role team_role, invited_at timestamp with time zone, store_name text)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select tm.id, tm.account_owner_id, tm.role, tm.invited_at,
         coalesce(p.display_name, 'A SquareShare store')
  from public.team_members tm
  left join public.profiles p on p.id = tm.account_owner_id
  where tm.status = 'invited'
    and lower(tm.invited_email) = (select public.team_jwt_email())
  order by tm.invited_at desc
  limit 50
$function$;

-- ===== 20260711_curation_foundation =========================================
-- =============================================================================
-- CURATION FOUNDATION (SQ-app): the content-curation SPA shares this project's
-- database and auth. Adds two profile fields (username, is_public) and two
-- net-new user-owned content tables (collections, artifacts). Additive only:
-- no existing table, policy, trigger, or function is modified.
--
-- Deliberately NOT wired into team_role_can()/team_actor_role(): the curation
-- app has no team semantics. Owner-only CRUD plus public read, nothing else.
-- =============================================================================

-- ---- profiles: login handle + public-grid visibility ------------------------
alter table public.profiles
  add column username text
    check (username is null or lower(username) ~ '^[a-z0-9_]{3,30}$'),
  add column is_public boolean not null default true;

comment on column public.profiles.username is
  'Curation-app login handle, distinct from display_name. Nullable: existing store users have none until they claim one. Case-insensitively unique.';
comment on column public.profiles.is_public is
  'Curation app: whether this profile (and its loose artifacts) shows on the public grid. Default on.';

-- Case-insensitive uniqueness, same pattern as profiles_display_name_lower_idx.
-- Partial (WHERE username IS NOT NULL) so the many store accounts without a
-- username never collide with each other.
create unique index profiles_username_lower_idx
  on public.profiles (lower(username))
  where username is not null;

-- ---- collections -------------------------------------------------------------
-- A named group of artifacts. Private by default; flipping is_public exposes
-- the collection AND its artifacts to the public read policies below.
create table public.collections (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  is_public  boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.collections is
  'Curation app: a user''s named group of artifacts. Private by default; is_public exposes it (and its artifacts) to anonymous readers.';

-- The curation app lists "my collections"; index the owner scan (also covers
-- the otherwise-unindexed FK, per the cost-audit convention).
create index collections_owner_id_idx on public.collections (owner_id);

alter table public.collections enable row level security;

-- Owner-scoped CRUD. (select auth.uid()) is cached per-statement.
create policy collections_select_own on public.collections
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy collections_insert_own on public.collections
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy collections_update_own on public.collections
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy collections_delete_own on public.collections
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Public grid: anyone (signed in or not) can read a collection its owner
-- marked public. Read-only — there are intentionally no anon write policies.
create policy collections_select_public on public.collections
  for select to anon, authenticated
  using (is_public);

-- Reuse the shared updated_at trigger function from the products migration.
create trigger collections_set_updated_at
  before update on public.collections
  for each row execute function public.set_updated_at();

-- ---- profile_is_public helper ------------------------------------------------
-- "Is this profile on the public grid?" — used by the artifacts public-read
-- policy for loose artifacts (no collection). Must be SECURITY DEFINER: profiles
-- has no anon/public select policy, so a direct subquery inside the policy
-- would evaluate against an empty set for anonymous readers. Boolean-only,
-- never row data (same shape as is_squareshare_staff / is_display_name_available).
create or replace function public.profile_is_public(p_profile_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and p.is_public
  );
$$;

-- Unlike this project's other helpers, anon KEEPS execute: the function is
-- evaluated inside an RLS policy on behalf of anonymous readers, and it only
-- reveals what the public grid reveals anyway (whether a profile is public).
revoke all on function public.profile_is_public(uuid) from public;
grant execute on function public.profile_is_public(uuid) to anon, authenticated;

-- ---- artifacts ----------------------------------------------------------------
-- A curated item on the owner's grid. Image bytes live in R2; rows store keys
-- minted by buildObjectKey (src/lib/r2.ts) — never URLs.
create table public.artifacts (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  -- Loose artifacts (null) hang directly off the profile grid.
  collection_id uuid references public.collections(id) on delete set null,
  -- Forward-compatible commerce bridge: an artifact may later point at a store
  -- product. Unused by the curation rebuild's v1; deleting a product detaches.
  product_id    uuid references public.products(id) on delete set null,
  title         text check (title is null or char_length(title) <= 200),
  description   text check (description is null or char_length(description) <= 2000),
  image_key     text not null,
  -- Bento-grid placement: cell position, span, and image focal point (%).
  grid_x        integer not null default 0 check (grid_x >= 0),
  grid_y        integer not null default 0 check (grid_y >= 0),
  span_w        integer not null default 1 check (span_w >= 1),
  span_h        integer not null default 1 check (span_h >= 1),
  img_offset_x  numeric not null default 50,
  img_offset_y  numeric not null default 50,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.artifacts is
  'Curation app: one curated grid item. image_key is an R2 object key (buildObjectKey shape), never a URL. product_id is a dormant commerce bridge.';

-- Owner grid reads + collection detail reads; product_id covered too so a
-- product delete's ON DELETE SET NULL never scans artifacts (cost-audit rule).
create index artifacts_owner_id_idx on public.artifacts (owner_id);
create index artifacts_collection_id_idx on public.artifacts (collection_id);
create index artifacts_product_id_idx on public.artifacts (product_id);

alter table public.artifacts enable row level security;

create policy artifacts_select_own on public.artifacts
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy artifacts_insert_own on public.artifacts
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy artifacts_update_own on public.artifacts
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy artifacts_delete_own on public.artifacts
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Public read: an artifact is visible when its collection is public, or — for
-- loose artifacts — when its owner's profile is public. The collections
-- subquery runs under the CALLER's RLS, where collections_select_public grants
-- exactly the public rows, so no definer helper is needed on that branch.
create policy artifacts_select_public on public.artifacts
  for select to anon, authenticated
  using (
    case
      when collection_id is null then public.profile_is_public(owner_id)
      else exists (
        select 1
        from public.collections c
        where c.id = artifacts.collection_id
          and c.is_public
      )
    end
  );

create trigger artifacts_set_updated_at
  before update on public.artifacts
  for each row execute function public.set_updated_at();

-- ===== 20260711171820 sq_app_profiles_private_by_default ====================
-- SQ-app's privacy copy promises "private by default"; this makes the column
-- default match.
--
-- MISSING from this replica until 2026-08-07, and it mattered: profiles
-- defaulted to PUBLIC here and PRIVATE in production, so every test reasoning
-- about who can see a profile, a collection, an artifact or a follow was
-- running against the opposite privacy posture from the real database.
alter table public.profiles alter column is_public set default false;
update public.profiles set is_public = false where username is null;

-- ===== 20260711195645 sq_app_likes_follows_reports ==========================
-- SQ-app social additions: likes, follows, reports. ADDITIVE ONLY — no changes
-- to existing tables or policies. These belong to the SIBLING app, which shares
-- this database; they are replayed here because they are reachable with the
-- same publishable anon key this dashboard ships, so the RLS tests must see
-- them. Do not change these policies from the Store repo without coordinating.
create table public.artifact_likes (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.artifacts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- one like per user per artifact (API maps 23505 -> idempotent 200)
  constraint artifact_likes_artifact_user_key unique (artifact_id, user_id)
);

create index artifact_likes_artifact_id_idx on public.artifact_likes (artifact_id);

alter table public.artifact_likes enable row level security;

-- Counts (and therefore rows) are public BY DESIGN — this is the like graph
-- for a public social product, not an oversight.
create policy "artifact_likes_public_read"
  on public.artifact_likes
  for select
  to anon, authenticated
  using (true);

create policy "artifact_likes_own_insert"
  on public.artifact_likes
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "artifact_likes_own_delete"
  on public.artifact_likes
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references auth.users (id) on delete cascade,
  followee_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint follows_follower_followee_key unique (follower_id, followee_id),
  constraint follows_no_self_check check (follower_id <> followee_id)
);

create index follows_follower_id_idx on public.follows (follower_id);
create index follows_followee_id_idx on public.follows (followee_id);

alter table public.follows enable row level security;

create policy "follows_public_read"
  on public.follows
  for select
  to anon, authenticated
  using (true);

create policy "follows_own_insert"
  on public.follows
  for insert
  to authenticated
  with check ((select auth.uid()) = follower_id);

create policy "follows_own_delete"
  on public.follows
  for delete
  to authenticated
  using ((select auth.uid()) = follower_id);

create table public.reports (
  -- polymorphic target: no FK on purpose (artifact rows may be deleted after
  -- reporting; profile targets live in a shared table)
  id uuid primary key default gen_random_uuid(),
  target_type text not null
    check (target_type in ('artifact', 'profile')),
  target_id uuid not null,
  reporter_id uuid references auth.users (id) on delete set null,
  reason text not null
    check (reason in ('spam', 'abuse', 'nudity', 'copyright', 'other')),
  details text not null default ''
    check (char_length(details) <= 1000),
  status text not null default 'open'
    check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

create index reports_target_idx on public.reports (target_type, target_id);
create index reports_status_idx on public.reports (status);

alter table public.reports enable row level security;

create policy "reports_own_insert"
  on public.reports
  for insert
  to authenticated
  with check ((select auth.uid()) = reporter_id);

-- Staff-only read, no UPDATE/DELETE policy: status changes are staff tooling.
create policy "reports_staff_read"
  on public.reports
  for select
  to authenticated
  using (public.is_squareshare_staff());

-- ===== 20260721_team_roster_avatar ==========================================
-- Team & Access shows real profile photos instead of initials, so the roster
-- needs each member's avatar_url alongside their display_name.
--
-- Safe to expose to fellow members: the RPC is already gated on the caller
-- holding 'team.read' for this account, and avatar_url is a URL in the PUBLIC
-- `avatars` storage bucket — it is not a secret, and the caller can already see
-- the member's name and email through this same function.
--
-- DROP + CREATE rather than CREATE OR REPLACE: Postgres cannot change a
-- function's OUT columns in place ("cannot change return type of existing
-- function"). Grants do not survive the drop, so they are re-applied below
-- exactly as the original migration set them.
drop function if exists public.team_roster(uuid, integer, integer);

create function public.team_roster(account uuid, page_limit integer default 50, page_offset integer default 0)
returns table (
  id uuid,
  member_user_id uuid,
  invited_email text,
  role public.team_role,
  status public.team_member_status,
  invited_at timestamptz,
  accepted_at timestamptz,
  display_name text,
  avatar_url text
)
language sql stable security definer
set search_path = ''
as $$
  select tm.id, tm.member_user_id, tm.invited_email, tm.role, tm.status,
         tm.invited_at, tm.accepted_at, p.display_name, p.avatar_url
  from public.team_members tm
  left join public.profiles p on p.id = tm.member_user_id
  where tm.account_owner_id = account
    and public.team_role_can(public.team_actor_role(account), 'team.read')
  order by public.team_role_rank(tm.role) desc, tm.invited_at asc, tm.id asc
  limit least(greatest(coalesce(page_limit, 50), 1), 100)
  offset greatest(coalesce(page_offset, 0), 0)
$$;

-- `from public` as well as `from anon`: CREATE FUNCTION grants PUBLIC an
-- implicit EXECUTE that anon inherits, so revoking anon alone would leave this
-- callable signed-out — a privilege the dropped function did not have.
revoke execute on function public.team_roster(uuid, integer, integer) from public, anon;
grant execute on function public.team_roster(uuid, integer, integer)
  to authenticated, service_role;

-- ===== 20260721_sliding_window_rate_limits ==================
-- Replaces the fixed-window counter with an exact sliding-window log, and
-- adds the key-based limiter for unauthenticated surfaces.
-- =============================================================================
-- Rate limiting: replace the FIXED-window counter with an EXACT SLIDING window.
--
-- WHY. The previous rl_take stored (window_start, count) and hard-reset the
-- count once window_start aged past the window. That let a caller spend a full
-- budget at the very end of one window and another full budget seconds later:
--
--   window = 1h, max = 5
--   20:00         take #1       -> window_start = 20:00, count = 1
--   20:58..20:59  takes #2..#5  -> count = 5 (budget spent)
--   21:01         window_start (20:00) is now older than 1h -> count RESETS to 1
--   21:01..21:02  4 more takes  -> count = 5
--   => 9 sends inside ~3 minutes against a "5 per hour" limit.
--
-- (The window was anchored to the FIRST take rather than the clock, so the
-- reset lands an hour after the window opened — but the burst is the same:
-- spend the budget just before the boundary, spend it again just after.)
--
-- A sliding window has no boundary to reset across: every take counts the hits
-- in the PRECEDING p_window_seconds, continuously.
--
-- HOW. Sliding window LOG: keep the timestamp of each allowed hit, prune the
-- ones older than the window, and allow only if fewer than p_max remain. This
-- is exact (no approximation), and storage is provably bounded: a timestamp is
-- appended ONLY when the take is allowed, and a take is allowed only while
-- fewer than p_max unpruned entries exist — so the array never exceeds p_max.
-- =============================================================================

-- --- Authenticated limiter (keyed on auth.uid()) -----------------------------

-- Swap the counter columns for the hit log. The old columns are dropped, not
-- left dangling: nothing outside rl_take ever read them.
alter table public.rate_limits
  add column if not exists hits timestamptz[] not null default '{}';
alter table public.rate_limits drop column if exists window_start;
alter table public.rate_limits drop column if exists count;

comment on table public.rate_limits is
  'Sliding-window rate limit state per (user, action). `hits` holds the timestamp of each ALLOWED take inside the window; entries older than the window are pruned on the next take. Written only by rl_take() (SECURITY DEFINER); RLS is on with no policies so clients can never read or forge it.';

create or replace function public.rl_take(
  p_action text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := (select auth.uid());
  cutoff timestamptz;
  kept   timestamptz[];
  allowed boolean;
begin
  -- Anonymous callers get nothing: this limiter is identity-scoped by design.
  -- Unauthenticated surfaces must use rl_take_key() instead.
  if uid is null then
    return false;
  end if;

  -- Reject nonsense budgets rather than failing open.
  if p_max is null or p_max < 1 then
    return false;
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    return false;
  end if;

  cutoff := now() - make_interval(secs => p_window_seconds);

  -- Ensure a row exists so the lock below always has one to take.
  insert into public.rate_limits (user_id, action)
  values (uid, p_action)
  on conflict (user_id, action) do nothing;

  -- Serialize concurrent takes for this (user, action) so two requests can
  -- never both read "4 hits" and both append a 5th.
  perform 1
  from public.rate_limits
  where user_id = uid and action = p_action
  for update;

  -- Prune to the trailing window, then decide.
  select coalesce(
           array(
             select t
             from unnest(r.hits) as t
             where t > cutoff
             order by t
           ),
           '{}'::timestamptz[]
         )
  into kept
  from public.rate_limits r
  where r.user_id = uid and r.action = p_action;

  allowed := coalesce(array_length(kept, 1), 0) < p_max;

  -- Only an ALLOWED take is recorded. Denied attempts must not extend the
  -- window, or a caller hammering the endpoint could lock themselves out
  -- indefinitely (and grow the array without bound).
  if allowed then
    kept := kept || now();
  end if;

  update public.rate_limits
  set hits = kept
  where user_id = uid and action = p_action;

  return allowed;
end
$$;

revoke execute on function public.rl_take(text, integer, integer) from public, anon;
grant execute on function public.rl_take(text, integer, integer) to authenticated, service_role;

-- --- Anonymous / arbitrary-key limiter ---------------------------------------
-- For surfaces with no auth.uid() yet: sending a magic link, a password-reset
-- email, or signing up. Those are the email-bombing vectors — an attacker can
-- point them at someone else's inbox — so they need a limit keyed on something
-- other than the (absent) session.
--
-- The key is supplied by the caller, so this function is SERVICE_ROLE ONLY.
-- If `authenticated`/`anon` could call it, a client would simply pass a random
-- key each time and bypass the limit entirely. Callers pass a SHA-256 hash
-- (see lib/rate-limit.ts) so raw emails and IPs are never stored here.

create table if not exists public.rate_limit_keys (
  key        text not null,
  action     text not null,
  hits       timestamptz[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (key, action)
);

comment on table public.rate_limit_keys is
  'Sliding-window rate limit state for UNAUTHENTICATED surfaces, keyed by an opaque caller-supplied hash (hashed email or IP — never the raw value). Written only by rl_take_key() (SECURITY DEFINER, service_role only).';

alter table public.rate_limit_keys enable row level security;
-- No policies on purpose: definer function + service_role only.

create index if not exists rate_limit_keys_updated_at_idx
  on public.rate_limit_keys (updated_at);

create or replace function public.rl_take_key(
  p_key text,
  p_action text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz;
  kept   timestamptz[];
  allowed boolean;
begin
  if p_key is null or length(p_key) = 0 then
    return false;
  end if;
  if p_max is null or p_max < 1 then
    return false;
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    return false;
  end if;

  cutoff := now() - make_interval(secs => p_window_seconds);

  insert into public.rate_limit_keys (key, action)
  values (p_key, p_action)
  on conflict (key, action) do nothing;

  perform 1
  from public.rate_limit_keys
  where key = p_key and action = p_action
  for update;

  select coalesce(
           array(
             select t
             from unnest(r.hits) as t
             where t > cutoff
             order by t
           ),
           '{}'::timestamptz[]
         )
  into kept
  from public.rate_limit_keys r
  where r.key = p_key and r.action = p_action;

  allowed := coalesce(array_length(kept, 1), 0) < p_max;
  if allowed then
    kept := kept || now();
  end if;

  update public.rate_limit_keys
  set hits = kept, updated_at = now()
  where key = p_key and action = p_action;

  return allowed;
end
$$;

-- service_role ONLY — see the note above about forgeable keys.
revoke execute on function public.rl_take_key(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.rl_take_key(text, text, integer, integer)
  to service_role;

-- Housekeeping: rows for keys nobody has touched in a day are dead weight
-- (the hit log inside them has long since aged out of any window we use).
create or replace function public.rl_gc_keys()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.rate_limit_keys
    where updated_at < now() - interval '1 day'
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function public.rl_gc_keys() from public, anon, authenticated;
grant execute on function public.rl_gc_keys() to service_role;

-- ===== 20260801 storefront_embed_key =========================================
-- Rotatable public identifier for embeds. Mirrors
-- supabase/migrations/20260801_storefront_embed_key.sql.

alter table public.storefronts
  add column if not exists embed_key uuid not null default gen_random_uuid();

create unique index if not exists storefronts_embed_key_key
  on public.storefronts (embed_key);

-- ===== 20260802_analytics_sql_aggregates ====================================
-- Aggregates in SQL: analytics_aggregate, dashboard_orders_aggregate,
-- product_sales_aggregate, products_ranked_by_metric + composite index.
-- SECURITY INVOKER: RLS enforces the seller boundary inside each function.
-- Mirrors supabase/migrations/20260802_analytics_sql_aggregates.sql.
-- Folded in: 20260808_recent_orders_id — dashboard_orders_aggregate's
-- recent_orders entries carry the order id, so the overview's Recent orders
-- rows can deep-link to /orders?order=<id>.

create index if not exists orders_seller_status_created_idx
  on public.orders (seller_id, status, created_at);

-- -----------------------------------------------------------------------------
-- analytics_aggregate: everything the /analytics page renders, in one call.
--
-- p_from/p_to are inclusive ISO dates (null = unbounded / today). The result
-- carries per-day series rows; the app zero-fills the calendar and re-buckets
-- monthly for long spans (presentation, cheap, already unit-tested there).
-- first_paid_date and first_order_date are both returned because the JS they
-- replace anchored the SERIES at the first paid order but the range-days
-- figure at the first order of any status.
-- -----------------------------------------------------------------------------
create or replace function public.analytics_aggregate(
  p_seller_id uuid,
  p_from date default null,
  p_to   date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with bounds as (
  -- Explicit UTC: a bare date::timestamptz would use the server timezone.
  -- Supabase runs UTC anyway, but the bound must not depend on that.
  select
    coalesce(p_from::timestamp at time zone 'UTC', '-infinity'::timestamptz) as from_ts,
    coalesce((p_to + 1)::timestamp at time zone 'UTC', 'infinity'::timestamptz) as to_ts
),
in_range as (
  select *
  from public.orders o, bounds b
  where o.seller_id = p_seller_id
    and o.currency <> 'USD'
    and o.created_at >= b.from_ts
    and o.created_at < b.to_ts
),
paid as (select * from in_range where status = 'paid'),
refunded as (select * from in_range where status = 'refunded'),
buyer_counts as (
  select count(*) as orders_n
  from paid
  where nullif(trim(lower(buyer_email)), '') is not null
  group by trim(lower(buyer_email))
)
select jsonb_build_object(
  'totals', jsonb_build_object(
    'revenue_cents', coalesce((select sum(amount_cents) from paid), 0),
    'sales', (select count(*) from paid),
    'fees_cents', coalesce((select sum(platform_fee_cents) from paid), 0),
    'refunded_count', (select count(*) from refunded),
    'refunded_cents', coalesce((select sum(amount_cents) from refunded), 0),
    'unique_buyers', (select count(*) from buyer_counts),
    'repeat_buyers', (select count(*) from buyer_counts where orders_n >= 2)
  ),
  'first_paid_date',
    (select ((min(created_at) at time zone 'UTC')::date)::text from paid),
  'first_order_date',
    (select ((min(created_at) at time zone 'UTC')::date)::text from in_range),
  'series_days', coalesce((
    select jsonb_agg(jsonb_build_object(
      'date', day, 'revenue_cents', revenue_cents, 'sales', sales
    ) order by day)
    from (
      select
        ((created_at at time zone 'UTC')::date)::text as day,
        sum(amount_cents) as revenue_cents,
        count(*) as sales
      from paid
      group by 1
    ) d
  ), '[]'::jsonb),
  'channels', coalesce((
    select jsonb_agg(jsonb_build_object(
      'channel', channel, 'revenue_cents', revenue_cents, 'sales', sales
    ))
    from (
      select channel, sum(amount_cents) as revenue_cents, count(*) as sales
      from paid
      group by channel
    ) c
  ), '[]'::jsonb),
  'top_products', coalesce((
    select jsonb_agg(jsonb_build_object(
      'title', product_title, 'revenue_cents', revenue_cents, 'sales', sales
    ) order by revenue_cents desc, product_title asc)
    from (
      select product_title, sum(amount_cents) as revenue_cents, count(*) as sales
      from paid
      group by product_title
      order by 2 desc, 1 asc
      limit 5
    ) t
  ), '[]'::jsonb),
  'weekdays', coalesce((
    select jsonb_agg(jsonb_build_object(
      'isodow', isodow, 'revenue_cents', revenue_cents, 'sales', sales
    ))
    from (
      select
        extract(isodow from created_at at time zone 'UTC')::int as isodow,
        sum(amount_cents) as revenue_cents,
        count(*) as sales
      from paid
      group by 1
    ) w
  ), '[]'::jsonb),
  'statuses', coalesce((
    select jsonb_agg(jsonb_build_object('status', status, 'count', n))
    from (
      select
        case when status in ('paid','refunded','disputed','pending')
             then status else 'pending' end as status,
        count(*) as n
      from in_range
      group by 1
    ) s
  ), '[]'::jsonb)
)
$$;

-- -----------------------------------------------------------------------------
-- dashboard_orders_aggregate: the overview page's windows and trends.
--
-- Daily trend buckets use the SAME "age in whole days relative to now" math as
-- the JS they replace (floor((now - created_at) / 86400s)), NOT calendar days,
-- so the sparkline shape is bit-identical through the swap. p_now is a
-- parameter only for tests; production callers omit it.
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_orders_aggregate(
  p_seller_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with eur as (
  select * from public.orders
  where seller_id = p_seller_id and currency <> 'USD'
),
paid as (select * from eur where status = 'paid'),
paid_30 as (select * from paid where created_at >= p_now - interval '30 days'),
paid_prev as (
  select * from paid
  where created_at >= p_now - interval '60 days'
    and created_at <  p_now - interval '30 days'
)
select jsonb_build_object(
  'all_time', jsonb_build_object(
    'revenue_cents', coalesce((select sum(amount_cents) from paid), 0),
    'sales', (select count(*) from paid)
  ),
  'last_30d', jsonb_build_object(
    'revenue_cents', coalesce((select sum(amount_cents) from paid_30), 0),
    'sales', (select count(*) from paid_30)
  ),
  'prev_30d', jsonb_build_object(
    'revenue_cents', coalesce((select sum(amount_cents) from paid_prev), 0),
    'sales', (select count(*) from paid_prev)
  ),
  'trend_days', coalesce((
    select jsonb_agg(jsonb_build_object(
      'age_days', age_days, 'revenue_cents', revenue_cents, 'sales', sales
    ) order by age_days)
    from (
      select
        floor(extract(epoch from (p_now - created_at)) / 86400)::int as age_days,
        sum(amount_cents) as revenue_cents,
        count(*) as sales
      from paid_30
      group by 1
    ) t
  ), '[]'::jsonb),
  'refunded_count', (select count(*) from eur where status = 'refunded'),
  'disputed_count', (select count(*) from eur where status = 'disputed'),
  -- created_at is passed through as a raw timestamptz: jsonb serialises it as
  -- ISO 8601 with an offset, which new Date() parses to the exact instant.
  -- Deliberately NOT to_char(): date/time formatting there consults the server
  -- locale, and a non-C locale on a non-UTF8 database (the embedded Windows
  -- test replica) makes it throw encoding errors. ::text on dates and native
  -- jsonb timestamp serialisation are locale-independent.
  'recent_orders', coalesce((
    select jsonb_agg(entry order by ts desc)
    from (
      select created_at as ts, jsonb_build_object(
        'id', id,
        'product_title', product_title,
        'channel', channel,
        'status', status,
        'amount_cents', amount_cents,
        'currency', currency,
        'created_at', created_at
      ) as entry
      from eur
      order by created_at desc
      limit 5
    ) r
  ), '[]'::jsonb)
)
$$;

-- -----------------------------------------------------------------------------
-- product_sales_aggregate: per-product paid rollup + the bestseller.
--
-- No currency filter (matches the JS this replaces; a product sells in one
-- currency in practice, and the card labels with the product's own currency).
-- min(currency) stands in for the JS "first order wins": deterministic, and
-- identical for the single-currency catalogues the rule assumes.
-- Bestseller = most REVENUE, ties broken by product_id for determinism.
-- -----------------------------------------------------------------------------
create or replace function public.product_sales_aggregate(p_seller_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with rollup as (
  select
    product_id,
    count(*)::int as units_sold,
    sum(amount_cents)::bigint as revenue_cents,
    min(currency) as currency
  from public.orders
  where seller_id = p_seller_id
    and status = 'paid'
    and product_id is not null
  group by product_id
)
select jsonb_build_object(
  'by_product', coalesce((
    select jsonb_object_agg(
      product_id::text,
      jsonb_build_object(
        'units_sold', units_sold,
        'revenue_cents', revenue_cents,
        'currency', currency
      )
    ) from rollup
  ), '{}'::jsonb),
  'bestseller_id', (
    select product_id::text from rollup
    order by revenue_cents desc, product_id asc
    limit 1
  )
)
$$;

-- -----------------------------------------------------------------------------
-- products_ranked_by_metric: page of product ids ordered by a sales metric.
--
-- Replaces the JS path that read the newest 500 ids and ranked those only.
-- Ordering matches the old code exactly where it was correct: metric
-- descending, then created_at descending, then id ascending as the stable
-- tiebreak. p_search arrives PRE-ESCAPED by the app's escapeIlike (backslash
-- escaping, ILIKE's default escape char).
-- -----------------------------------------------------------------------------
create or replace function public.products_ranked_by_metric(
  p_seller_id uuid,
  p_metric text,            -- 'unitsSold' or 'revenue'
  p_status text default null,
  p_search text default null,
  p_limit  integer default 24,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with sales as (
  select product_id, count(*)::bigint as units_sold, sum(amount_cents)::bigint as revenue
  from public.orders
  where seller_id = p_seller_id and status = 'paid' and product_id is not null
  group by product_id
),
matching as (
  select
    p.id, p.created_at,
    coalesce(case when p_metric = 'unitsSold' then s.units_sold else s.revenue end, 0)
      as metric
  from public.products p
  left join sales s on s.product_id = p.id
  where p.owner_id = p_seller_id
    and (p_status is null or p.status = p_status)
    and (p_search is null or p.title ilike '%' || p_search || '%')
)
select jsonb_build_object(
  'total', (select count(*) from matching),
  'ids', coalesce((
    select jsonb_agg(id order by ord)
    from (
      select id, row_number() over (
        order by metric desc, created_at desc, id asc
      ) as ord
      from matching
      order by metric desc, created_at desc, id asc
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    ) page
  ), '[]'::jsonb)
)
$$;

-- -----------------------------------------------------------------------------
-- Permissions: signed-in app callers and the service role; never anon.
-- -----------------------------------------------------------------------------
revoke execute on function public.analytics_aggregate(uuid, date, date) from public, anon;
grant execute on function public.analytics_aggregate(uuid, date, date) to authenticated, service_role;

revoke execute on function public.dashboard_orders_aggregate(uuid, timestamptz) from public, anon;
grant execute on function public.dashboard_orders_aggregate(uuid, timestamptz) to authenticated, service_role;

revoke execute on function public.product_sales_aggregate(uuid) from public, anon;
grant execute on function public.product_sales_aggregate(uuid) to authenticated, service_role;

revoke execute on function public.products_ranked_by_metric(uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.products_ranked_by_metric(uuid, text, text, text, integer, integer) to authenticated, service_role;

-- ===== 20260804_username_sign_in ============================================
-- =============================================================================
-- USERNAME SIGN-IN: let people sign in with their handle instead of their email.
--
-- Adds the server-side resolver, and teaches the signup trigger to claim a
-- handle in the SAME TRANSACTION as the auth.users insert. Email is untouched:
-- it stays the account's real address for confirmation, recovery and OAuth.
--
-- profiles.username already exists (see the curation-foundation migration): it
-- is nullable, case-insensitively unique via profiles_username_lower_idx, and
-- format-checked. Nothing here redefines those; the column is shared with the
-- curation app, which owns its format rule.
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

-- ===== 20260806_universal_search_indexes ====================================
-- =============================================================================
-- UNIVERSAL SEARCH: trigram GIN indexes behind the top-bar search bar's
-- ILIKE '%term%' matches. pg_trgm is already enabled above
-- (20260720_cost_audit_buyer_email_trgm), as is orders.buyer_email's index.
-- =============================================================================
create index if not exists products_title_trgm_idx
  on public.products using gin (title gin_trgm_ops);

create index if not exists storefronts_name_trgm_idx
  on public.storefronts using gin (name gin_trgm_ops);

create index if not exists orders_product_title_trgm_idx
  on public.orders using gin (product_title gin_trgm_ops);

create index if not exists notifications_title_trgm_idx
  on public.notifications using gin (title gin_trgm_ops);

-- ===== 20260806_merge_display_name_into_username =============================
-- =============================================================================
-- ONE IDENTITY: display_name and username merge into `username`.
--
-- The account had two names: `display_name` (free-form, what buyers saw) and
-- `username` (the sign-in handle). Two names for one account is one too many —
-- it splits "who is this" across two columns, lets them disagree, and makes
-- "is this taken?" two different questions. From here there is one field, and
-- it is `username`.
--
-- It keeps the HANDLE's rules rather than the display name's, because this
-- value is now half of a credential: lowercase a-z0-9_ , 3 to 30 characters,
-- case-insensitively unique. Free-form Unicode with spaces cannot be a login
-- identifier without inviting look-alike accounts.
--
-- Safe across the estate: the marketplace app references neither column, and
-- the curation app already uses `username` exclusively. This migration moves
-- the store app onto the same column the curation app was always using.
-- =============================================================================

-- ---- backfill ----------------------------------------------------------------
-- Every existing display_name becomes a handle. Slugified rather than dropped,
-- so nobody loses the name they chose: lowercased, runs of anything outside
-- [a-z0-9_] collapsed to a single underscore, trimmed of leading/trailing
-- underscores ("Adrian Edwards" -> "adrian_edwards").
--
-- Then padded/truncated into the 3..30 the constraint requires, and finally
-- de-duplicated against the unique index by suffixing a counter. Done in one
-- statement per row via a DO block so collisions can be resolved as we go.
do $$
declare
  r record;
  base text;
  candidate text;
  n integer;
begin
  for r in
    select id, display_name
    from public.profiles
    where username is null
      and nullif(btrim(display_name), '') is not null
    order by created_at
  loop
    base := regexp_replace(lower(btrim(r.display_name)), '[^a-z0-9_]+', '_', 'g');
    base := btrim(base, '_');
    -- Too short to be a handle: pad rather than invent something unrelated.
    if length(base) < 3 then
      base := rpad(coalesce(nullif(base, ''), 'user'), 3, '0');
    end if;
    base := left(base, 30);

    candidate := base;
    n := 1;
    while exists (
      select 1 from public.profiles p where lower(p.username) = candidate
    ) loop
      n := n + 1;
      -- Keep room for the suffix inside the 30-character ceiling.
      candidate := left(base, 30 - length(n::text) - 1) || '_' || n::text;
    end loop;

    update public.profiles set username = candidate where id = r.id;
  end loop;
end $$;

-- ---- dependents of the column -------------------------------------------------
-- Two views project display_name, and an RLS policy on artifacts reads one of
-- them, so the column cannot be dropped until all three are rebuilt. Dropping
-- a view cascades to that policy, hence the explicit recreate below: the
-- cascade is deliberate and accounted for, not discovered later.
--
-- Both views keep security_invoker=false (the default they already had). That
-- matters for public_profiles: the artifacts policy consults it on behalf of
-- ANONYMOUS readers, and profiles has no anon select policy, so an invoker-
-- rights view would evaluate against an empty set and silently hide every
-- public artifact.
drop view if exists public.public_profiles cascade;
drop view if exists public.admin_user_directory;

-- ---- the store's own reads move to username ----------------------------------
-- team_roster/team_my_accounts/team_my_pending_invites all surfaced the
-- account's name from display_name. Their RETURNS TABLE shape changes, so they
-- must be dropped and recreated rather than replaced, and their grants restated
-- (a new function does not inherit them).

drop function if exists public.team_roster(uuid, integer, integer);

create function public.team_roster(
  account uuid,
  page_limit integer default 50,
  page_offset integer default 0
)
returns table (
  id uuid,
  member_user_id uuid,
  invited_email text,
  role team_role,
  status team_member_status,
  invited_at timestamptz,
  accepted_at timestamptz,
  username text,
  avatar_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.id, tm.member_user_id, tm.invited_email, tm.role, tm.status,
         tm.invited_at, tm.accepted_at, p.username, p.avatar_url
  from public.team_members tm
  left join public.profiles p on p.id = tm.member_user_id
  where tm.account_owner_id = account
    and public.team_role_can(public.team_actor_role(account), 'team.read')
  order by public.team_role_rank(tm.role) desc, tm.invited_at asc, tm.id asc
  limit least(greatest(coalesce(page_limit, 50), 1), 100)
  offset greatest(coalesce(page_offset, 0), 0)
$$;

revoke execute on function public.team_roster(uuid, integer, integer) from public, anon;
grant execute on function public.team_roster(uuid, integer, integer) to authenticated, service_role;

drop function if exists public.team_my_accounts();

create function public.team_my_accounts()
returns table (
  account_owner_id uuid,
  role team_role,
  store_name text,
  is_self boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    tm.account_owner_id,
    tm.role,
    coalesce(nullif(btrim(p.username), ''), 'A SquareShare store') as store_name,
    (tm.account_owner_id = (select auth.uid())) as is_self
  from public.team_members tm
  left join public.profiles p on p.id = tm.account_owner_id
  where tm.member_user_id = (select auth.uid())
    and tm.status = 'active'
  order by (tm.account_owner_id = (select auth.uid())) desc, store_name asc
$$;

revoke execute on function public.team_my_accounts() from public, anon;
grant execute on function public.team_my_accounts() to authenticated, service_role;

drop function if exists public.team_my_pending_invites();

create function public.team_my_pending_invites()
returns table (
  id uuid,
  account_owner_id uuid,
  role team_role,
  invited_at timestamptz,
  store_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.id, tm.account_owner_id, tm.role, tm.invited_at,
         coalesce(p.username, 'A SquareShare store')
  from public.team_members tm
  left join public.profiles p on p.id = tm.account_owner_id
  where tm.status = 'invited'
    and lower(tm.invited_email) = (select public.team_jwt_email())
  order by tm.invited_at desc
  limit 50
$$;

revoke execute on function public.team_my_pending_invites() from public, anon;
grant execute on function public.team_my_pending_invites() to authenticated, service_role;

-- ---- signup writes one name --------------------------------------------------
-- An OAuth signup brings a human name ("Adrian Edwards") rather than a handle,
-- so the same slug rule used for the backfill runs here: the account still gets
-- a usable handle instead of failing the format check or landing with none.
-- A collision is left to the unique index, which aborts the signup rather than
-- silently handing out someone else's identity.
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
    slug := null;  -- nothing usable; the account claims a handle later
  else
    slug := left(slug, 30);
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

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---- retire display_name ------------------------------------------------------
-- Its availability check goes with it; is_username_available's job is done by
-- username_taken (service_role-only, see the username sign-in migration).
drop function if exists public.is_display_name_available(text);
drop index if exists public.profiles_display_name_lower_idx;

alter table public.profiles drop column if exists display_name;

-- ---- rebuild the dependents on the surviving column ---------------------------
create view public.public_profiles as
  select id, username, avatar_url
  from public.profiles
  where is_public = true
    and username is not null;

revoke all on public.public_profiles from anon, authenticated;
grant select on public.public_profiles to anon, authenticated, service_role;

-- Restored verbatim apart from the view it reads, which no longer carries a
-- display_name. The policy only ever matched on pp.id, so nothing about its
-- meaning changes.
create policy artifacts_public_read on public.artifacts
  for select to anon, authenticated
  using (
    (collection_id is not null and exists (
      select 1 from public.collections c
      where c.id = artifacts.collection_id and c.is_public = true
    ))
    or
    (collection_id is null and exists (
      select 1 from public.public_profiles pp where pp.id = artifacts.owner_id
    ))
  );

-- Admin directory: same shape, one name. The metadata fallbacks stay, since an
-- account that never claimed a handle still has whatever its provider sent.
create view public.admin_user_directory as
  select
    u.id,
    u.email::text as email,
    coalesce(
      p.username,
      u.raw_user_meta_data ->> 'username',
      u.raw_user_meta_data ->> 'name',
      u.raw_user_meta_data ->> 'full_name'
    ) as username,
    u.created_at,
    u.banned_until,
    u.email_confirmed_at,
    p.id is not null as is_seller
  from auth.users u
  left join public.profiles p on p.id = u.id;

-- Same trap, higher stakes: this view reads auth.users, so an inherited anon
-- grant would publish every email, ban state and confirmation timestamp
-- through PostgREST.
revoke all on public.admin_user_directory from anon, authenticated;
grant select on public.admin_user_directory to service_role;

comment on column public.profiles.username is
  'The account''s ONE identifier: sign-in handle and the name shown to buyers. Lowercase a-z0-9_, 3-30 chars, case-insensitively unique via profiles_username_lower_idx. Resolved to an email by email_by_username() for the password grant.';

-- ===== 20260807_password_security ===========================================
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

-- ===== 20260807 scope_sq_app_social_reads ===================================
-- Like and follow visibility now follows the visibility of the thing it is
-- about. See supabase/migrations/20260807_scope_sq_app_social_reads.sql for
-- the reasoning; the short version is that profiles are private by default
-- while these two tables were world-readable.
drop policy if exists "artifact_likes_public_read" on public.artifact_likes;

create policy "artifact_likes_visible_read"
  on public.artifact_likes
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.artifacts a
      where a.id = artifact_likes.artifact_id
    )
    or (select auth.uid()) = user_id
  );

drop policy if exists "follows_public_read" on public.follows;

create policy "follows_visible_read"
  on public.follows
  for select
  to anon, authenticated
  using (
    -- Consults the public_profiles VIEW, which is how prod's own
    -- artifacts_public_read policy asks the same question. The view is
    -- SECURITY DEFINER precisely so a policy can check "is this profile
    -- public?" for an anonymous reader without profiles carrying an anon
    -- select policy (it holds tax_vat_id and must never have one).
    exists (select 1 from public.public_profiles pp where pp.id = follows.follower_id)
    or exists (select 1 from public.public_profiles pp where pp.id = follows.followee_id)
    or (select auth.uid()) = follower_id
    or (select auth.uid()) = followee_id
  );

-- ===== 20260807 db_hygiene ==================================================
-- Only the parts that can exist in the replica. Deliberately omitted:
--   - `alter table demo.sales_sim enable row level security` — the demo schema
--     is excluded from this replica (it needs pg_cron; see the file header).
--   - `cron.schedule('rate-limit-gc', ...)` — pg_cron is not available in
--     embedded Postgres.
-- Both are pure infrastructure and gate no invariant under test.
drop policy if exists "public can join waitlist" on public.waitlist_signups;

create policy "public can join waitlist"
  on public.waitlist_signups
  for insert
  to anon, authenticated
  with check (
    owner_id is null
    and list_id is null
    and char_length(email) <= 254
    and char_length(coalesce(source, '')) <= 64
  );

-- ===== RECONCILIATION 2026-08-07: curation policies match production ========
-- Discovered while scoping the SQ-app social reads: this replica and production
-- had materially DIFFERENT authorization models for collections and artifacts,
-- and had done for some time.
--
--   production: collections_owner_all + collections_public_read
--               artifacts_owner_all   + artifacts_public_read
--               public.profile_is_public()  -- DOES NOT EXIST
--
--   replica:    the original per-command generation (select/insert/update/
--               delete_own, *_select_public) *plus* artifacts_public_read,
--               and profile_is_public() still defined
--
-- RLS policies are permissive and OR together, so the replica granted strictly
-- MORE than production. Every curation test was therefore written against an
-- authorization model the real database does not run.
--
-- This section ends the file in production's exact state. It is expressed as
-- drops-then-creates rather than by editing the sections above, so the file
-- still reads as the history that actually happened.
drop policy if exists collections_select_own    on public.collections;
drop policy if exists collections_insert_own    on public.collections;
drop policy if exists collections_update_own    on public.collections;
drop policy if exists collections_delete_own    on public.collections;
drop policy if exists collections_select_public on public.collections;

create policy collections_owner_all on public.collections
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy collections_public_read on public.collections
  for select to anon, authenticated
  using (is_public = true);

drop policy if exists artifacts_select_own    on public.artifacts;
drop policy if exists artifacts_insert_own    on public.artifacts;
drop policy if exists artifacts_update_own    on public.artifacts;
drop policy if exists artifacts_delete_own    on public.artifacts;
drop policy if exists artifacts_select_public on public.artifacts;

create policy artifacts_owner_all on public.artifacts
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- artifacts_public_read is already created above, verbatim from production.

-- Nothing in production references this any more; the policies consult the
-- public_profiles view directly. Dropped so the replica cannot keep a helper
-- alive that prod does not have, and so a policy written against it fails here
-- rather than in production.
drop function if exists public.profile_is_public(uuid);

-- ===== 20260808 storefront_brief =============================================
-- Creation-flow answers (category / fulfilment / vibe) on the storefront row.
-- No RLS change: the owner-scoped storefront policies already cover every
-- column. Mirrors supabase/migrations/20260808_storefront_brief.sql.

alter table public.storefronts
  add column if not exists brief jsonb not null default '{}'::jsonb;

-- ===== 20260830 storefront_signals ===========================================
-- The non-order analytics stream (views, clicks, email signups, bookings) and
-- its aggregate. Mirrors supabase/migrations/20260830_storefront_signals.sql
-- verbatim: the whole point of this table is its authorization shape (readable
-- by owner + team, writable by NOBODY client-facing), so a replica that got
-- that wrong would let a test pass against a boundary production does not have.

create table if not exists public.storefront_signals (
  id            bigint generated always as identity primary key,
  account_id    uuid not null references public.profiles(id) on delete cascade,
  storefront_id uuid references public.storefronts(id) on delete set null,
  kind          text not null
    check (kind in ('storefront_view','product_click','email_signup','booking')),
  channel       text not null default 'embed'
    check (channel in ('embed','marketplace','direct')),
  block_id      text check (block_id is null or char_length(block_id) <= 64),
  visitor_hash  text check (visitor_hash is null or char_length(visitor_hash) = 64),
  value_cents   integer check (value_cents is null or value_cents >= 0),
  currency      text check (currency is null or char_length(currency) = 3),
  dedupe_key    text check (dedupe_key is null or char_length(dedupe_key) <= 128),
  occurred_at   timestamptz not null default now(),
  metadata      jsonb not null default '{}'
    check (pg_column_size(metadata) <= 2048)
);

create index if not exists storefront_signals_account_kind_occurred_idx
  on public.storefront_signals (account_id, kind, occurred_at);
create index if not exists storefront_signals_account_occurred_idx
  on public.storefront_signals (account_id, occurred_at desc);
create unique index if not exists storefront_signals_dedupe_idx
  on public.storefront_signals (account_id, dedupe_key)
  where dedupe_key is not null;

alter table public.storefront_signals enable row level security;

drop policy if exists storefront_signals_select_member on public.storefront_signals;
create policy storefront_signals_select_member
  on public.storefront_signals
  for select
  to authenticated
  using (
    account_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(account_id), 'store.read')
  );

revoke insert, update, delete, truncate on table public.storefront_signals
  from anon, authenticated;
revoke all on table public.storefront_signals from anon;
revoke all on sequence public.storefront_signals_id_seq from anon, authenticated;
grant select on table public.storefront_signals to authenticated;

create or replace function public.storefront_signals_aggregate(
  p_account_id uuid,
  p_from date default null,
  p_to   date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with bounds as (
  select
    coalesce(p_from::timestamp at time zone 'UTC', '-infinity'::timestamptz) as from_ts,
    coalesce((p_to + 1)::timestamp at time zone 'UTC', 'infinity'::timestamptz) as to_ts
),
in_range as (
  select s.*
  from public.storefront_signals s, bounds b
  where s.account_id = p_account_id
    and s.occurred_at >= b.from_ts
    and s.occurred_at < b.to_ts
)
select jsonb_build_object(
  'first_signal_date',
    (select ((min(occurred_at) at time zone 'UTC')::date)::text from in_range),
  'totals', coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', kind, 'count', n, 'value_cents', value_cents,
      'unique_visitors', unique_visitors
    ) order by kind)
    from (
      select kind, count(*) as n,
             coalesce(sum(value_cents), 0) as value_cents,
             count(distinct visitor_hash) as unique_visitors
      from in_range group by kind
    ) t
  ), '[]'::jsonb),
  'series_days', coalesce((
    select jsonb_agg(jsonb_build_object(
      'date', day, 'kind', kind, 'count', n, 'value_cents', value_cents
    ) order by day, kind)
    from (
      select ((occurred_at at time zone 'UTC')::date)::text as day, kind,
             count(*) as n, coalesce(sum(value_cents), 0) as value_cents
      from in_range group by 1, 2
    ) d
  ), '[]'::jsonb),
  'channels', coalesce((
    select jsonb_agg(jsonb_build_object('kind', kind, 'channel', channel, 'count', n))
    from (select kind, channel, count(*) as n from in_range group by 1, 2) c
  ), '[]'::jsonb),
  'weekdays', coalesce((
    select jsonb_agg(jsonb_build_object('kind', kind, 'isodow', isodow, 'count', n))
    from (
      select kind, extract(isodow from occurred_at at time zone 'UTC')::int as isodow,
             count(*) as n
      from in_range group by 1, 2
    ) w
  ), '[]'::jsonb),
  'storefronts', coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', kind, 'storefront_id', storefront_id, 'name', name, 'count', n
    ) order by n desc, name asc nulls last)
    from (
      select r.kind, r.storefront_id::text as storefront_id, sf.name as name,
             count(*) as n
      from in_range r
      left join public.storefronts sf on sf.id = r.storefront_id
      group by 1, 2, 3
      order by 4 desc
      limit 40
    ) s
  ), '[]'::jsonb)
)
$$;

revoke execute on function public.storefront_signals_aggregate(uuid, date, date)
  from public, anon;
grant execute on function public.storefront_signals_aggregate(uuid, date, date)
  to authenticated, service_role;

-- ===== 20260830 signal_relevance =============================================
-- Adds all_time_kinds + active_block_types to the signals aggregate, which is
-- what lets the page hide a source the seller does not run. Replayed because
-- the visibility rule is the behaviour under test: a replica on the older
-- function reports no history and no blocks, so every optional source would
-- vanish and the specs would pass for the wrong reason.
-- Mirrors supabase/migrations/20260830_signal_relevance.sql.

create or replace function public.storefront_signals_aggregate(
  p_account_id uuid,
  p_from date default null,
  p_to   date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with bounds as (
  select
    coalesce(p_from::timestamp at time zone 'UTC', '-infinity'::timestamptz) as from_ts,
    coalesce((p_to + 1)::timestamp at time zone 'UTC', 'infinity'::timestamptz) as to_ts
),
in_range as (
  select s.*
  from public.storefront_signals s, bounds b
  where s.account_id = p_account_id
    and s.occurred_at >= b.from_ts
    and s.occurred_at < b.to_ts
)
select jsonb_build_object(
  'first_signal_date',
    (select ((min(occurred_at) at time zone 'UTC')::date)::text from in_range),
  'all_time_kinds', coalesce((
    select jsonb_agg(distinct kind)
    from public.storefront_signals
    where account_id = p_account_id
  ), '[]'::jsonb),
  'active_block_types', coalesce((
    select jsonb_agg(distinct b->>'type')
    from public.storefronts s,
         lateral jsonb_array_elements(s.config->'blocks') b
    where s.owner_id = p_account_id
      and jsonb_typeof(s.config->'blocks') = 'array'
      and b->>'type' is not null
  ), '[]'::jsonb),
  'totals', coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', kind, 'count', n, 'value_cents', value_cents,
      'unique_visitors', unique_visitors
    ) order by kind)
    from (
      select kind, count(*) as n,
             coalesce(sum(value_cents), 0) as value_cents,
             count(distinct visitor_hash) as unique_visitors
      from in_range group by kind
    ) t
  ), '[]'::jsonb),
  'series_days', coalesce((
    select jsonb_agg(jsonb_build_object(
      'date', day, 'kind', kind, 'count', n, 'value_cents', value_cents
    ) order by day, kind)
    from (
      select ((occurred_at at time zone 'UTC')::date)::text as day, kind,
             count(*) as n, coalesce(sum(value_cents), 0) as value_cents
      from in_range group by 1, 2
    ) d
  ), '[]'::jsonb),
  'channels', coalesce((
    select jsonb_agg(jsonb_build_object('kind', kind, 'channel', channel, 'count', n))
    from (select kind, channel, count(*) as n from in_range group by 1, 2) c
  ), '[]'::jsonb),
  'weekdays', coalesce((
    select jsonb_agg(jsonb_build_object('kind', kind, 'isodow', isodow, 'count', n))
    from (
      select kind, extract(isodow from occurred_at at time zone 'UTC')::int as isodow,
             count(*) as n
      from in_range group by 1, 2
    ) w
  ), '[]'::jsonb),
  'storefronts', coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', kind, 'storefront_id', storefront_id, 'name', name, 'count', n
    ) order by n desc, name asc nulls last)
    from (
      select r.kind, r.storefront_id::text as storefront_id, sf.name as name,
             count(*) as n
      from in_range r
      left join public.storefronts sf on sf.id = r.storefront_id
      group by 1, 2, 3
      order by 4 desc
      limit 40
    ) s
  ), '[]'::jsonb)
)
$$;

revoke execute on function public.storefront_signals_aggregate(uuid, date, date)
  from public, anon;
grant execute on function public.storefront_signals_aggregate(uuid, date, date)
  to authenticated, service_role;


-- ============================================================================
-- 20260902_product_page
-- ============================================================================

alter table public.products
  add column gallery      jsonb not null default '[]'::jsonb,
  add column variants     jsonb not null default '[]'::jsonb,
  add column details      jsonb not null default '{}'::jsonb,
  add column purchase_url text;

alter table public.products
  add constraint products_gallery_is_array
    check (jsonb_typeof(gallery) = 'array'),
  add constraint products_variants_is_array
    check (jsonb_typeof(variants) = 'array'),
  add constraint products_details_is_object
    check (jsonb_typeof(details) = 'object'),
  add constraint products_gallery_size
    check (pg_column_size(gallery) <= 8192),
  add constraint products_variants_size
    check (pg_column_size(variants) <= 4096),
  add constraint products_details_size
    check (pg_column_size(details) <= 16384),
  add constraint products_purchase_url_shape
    check (
      purchase_url is null
      or (char_length(purchase_url) <= 2048 and purchase_url ~ '^https://')
    );

alter table public.storefront_signals
  drop constraint storefront_signals_kind_check;
alter table public.storefront_signals
  add constraint storefront_signals_kind_check
    check (kind in ('storefront_view','product_click','email_signup','booking','product_view'));


-- ============================================================================
-- 20260903_product_documents
-- ============================================================================

alter table public.products
  add column documents jsonb not null default '[]'::jsonb;

alter table public.products
  add constraint products_documents_is_array
    check (jsonb_typeof(documents) = 'array'),
  add constraint products_documents_size
    check (pg_column_size(documents) <= 8192);


-- ============================================================================
-- 20260903_product_options
-- ============================================================================

alter table public.products
  add column option_groups jsonb not null default '[]'::jsonb;

update public.products
set option_groups = jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'name', 'Colour',
        'display', 'swatch',
        'options', variants
      )
    )
where jsonb_typeof(variants) = 'array'
  and jsonb_array_length(variants) > 0;

update public.products
set gallery = (
      select coalesce(jsonb_agg(
               case
                 when entry ? 'variantId'
                   then (entry - 'variantId') || jsonb_build_object('optionId', entry -> 'variantId')
                 else entry
               end
               order by ordinality
             ), '[]'::jsonb)
      from jsonb_array_elements(gallery) with ordinality as t(entry, ordinality)
    )
where jsonb_typeof(gallery) = 'array'
  and gallery::text like '%"variantId"%';

alter table public.products
  drop constraint products_variants_is_array,
  drop constraint products_variants_size,
  drop column variants;

alter table public.products
  add constraint products_option_groups_is_array
    check (jsonb_typeof(option_groups) = 'array'),
  add constraint products_option_groups_size
    check (pg_column_size(option_groups) <= 16384);

alter table public.products
  drop constraint products_gallery_size,
  add constraint products_gallery_size
    check (pg_column_size(gallery) <= 32768);

-- 20260904_product_shipping_profile
-- Which of the storefront config's shippingProfiles a product ships under.
-- Null = the store's default terms (config.policies.shipping), which is what
-- every existing row correctly already says. The CHECK is the point: Zod is
-- the boundary for application writes, but a service-role write is not parsed
-- by it, and this column is dereferenced by the public product page.
alter table public.products
  add column shipping_profile_id text;

alter table public.products
  add constraint products_shipping_profile_id_shape
    check (
      shipping_profile_id is null
      or (
        char_length(shipping_profile_id) between 1 and 64
        and shipping_profile_id ~ '^[A-Za-z0-9_-]+$'
      )
    );

create index products_shipping_profile_id_idx
  on public.products (shipping_profile_id)
  where shipping_profile_id is not null;

-- 20260905_seller_identity_on_profile
-- Seller identity moves to the account: three more profile columns beside
-- tax_business_name/tax_vat_id/tax_country (20260706081724), covering what
-- distance-selling law asks for that tax info alone does not (a postal
-- address, a way to reach the seller). storefronts.config.seller is retired;
-- see lib/settings/seller-identity.ts for the one place that reads all six
-- columns into the buyer-facing shape.
alter table public.profiles
  add column seller_address text,
  add column seller_email text,
  add column seller_phone text;

alter table public.profiles
  add constraint profiles_seller_address_shape
    check (seller_address is null or char_length(seller_address) between 1 and 300),
  add constraint profiles_seller_email_shape
    check (
      seller_email is null
      or (char_length(seller_email) <= 254 and seller_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    ),
  add constraint profiles_seller_phone_shape
    check (seller_phone is null or char_length(seller_phone) between 1 and 32);

-- 20260905_shipping_policy_on_profile
-- Shipping and returns terms move to the account: one jsonb column holding the
-- structured answers (ships from, destinations, returns window, who pays the
-- postage back) plus the named shipping profiles products point at by
-- products.shipping_profile_id. storefronts.config.policies and
-- .shippingProfiles are retired; see lib/settings/shipping-policy.ts for the
-- one place that reads this column into the shape every reader uses, and
-- lib/validation/shipping-policy.ts for the real write boundary.
--
-- The backfill and the config strip from the production migration are omitted
-- here for the same reason every other data step is: the replica starts empty,
-- so there is nothing to carry over. What the tests need is the COLUMN and its
-- CHECK, which is what they get.
alter table public.profiles
  add column shipping_policy jsonb;

alter table public.profiles
  add constraint profiles_shipping_policy_shape
    check (
      shipping_policy is null
      or (
        jsonb_typeof(shipping_policy) = 'object'
        and pg_column_size(shipping_policy) <= 16384
      )
    );

-- 20260905_option_specifications
-- Per-version specifications: an option may carry the dimensions, weight and
-- short spec rows that version changes, and the product page shows those in
-- place of the product's own (see lib/products/option-details.ts). Still no
-- price and no stock per option: this is the same presentation column, now
-- carrying the measurements the page prints. The size cap goes up with it,
-- because the schema's worst case (48 fully measured options) is near 48 KB.
alter table public.products
  drop constraint products_option_groups_size,
  add constraint products_option_groups_size
    check (pg_column_size(option_groups) <= 65536);

-- 20260905_order_selected_options
-- What version the buyer bought, on the order: [{label, value}] snapshotted in
-- the seller's own words ("Size": "Six seater"), never option ids, so renaming
-- or deleting an option cannot rewrite what a past order says was sold. Empty
-- for a product sold in one version. Written server-side only, like every other
-- column on this table.
alter table public.orders
  add column selected_options jsonb not null default '[]'::jsonb;

alter table public.orders
  add constraint orders_selected_options_is_array
    check (jsonb_typeof(selected_options) = 'array'),
  add constraint orders_selected_options_size
    check (pg_column_size(selected_options) <= 2048);

-- 20260908_product_max_per_order
-- How many of ONE product a buyer may take in a single order. Seller-set,
-- bounded 1-100 by the CHECK, defaulted to 10 so every row (including every
-- existing one) has a concrete ceiling rather than a fallback each layer has to
-- remember. Replayed for the CHECK and for the decrement's new limit clause:
-- both are the fences a service-role write cannot climb, which is exactly what
-- the db suite exists to prove.
alter table public.products
  add column max_per_order integer not null default 10;

alter table public.products
  add constraint products_max_per_order_range
    check (max_per_order >= 1 and max_per_order <= 100);

-- The atomic decrement now refuses an over-limit quantity too, in the same
-- single UPDATE, so the stock check and the per-order cap cannot be raced past
-- each other. The revoke/grant lines are repeated because `create or replace`
-- re-runs PostgREST's auto-grant and would otherwise publish this RPC to anon.
create or replace function public.decrement_stock(
  p_product_id uuid,
  p_quantity integer
) returns boolean
language sql
security invoker
set search_path = ''
as $$
  update public.products
     set stock_quantity = stock_quantity - p_quantity,
         updated_at = now()
   where id = p_product_id
     and track_stock
     and p_quantity > 0
     and p_quantity <= max_per_order
     and stock_quantity >= p_quantity
  returning true;
$$;

revoke execute on function public.decrement_stock(uuid, integer) from public;
revoke execute on function public.decrement_stock(uuid, integer) from anon;
revoke execute on function public.decrement_stock(uuid, integer) from authenticated;
grant execute on function public.decrement_stock(uuid, integer) to service_role;

-- 20260909_seller_email_verification
-- Double opt-in for the buyer-facing contact address. Replayed for the token
-- store's fences, which are the whole security story: RLS on with NO POLICY
-- (total deny for anon/authenticated), explicit revokes against PostgREST's
-- auto-grant, and a CHECK that refuses anything but a 64-char hex digest in
-- token_hash — the fence that would catch a plaintext token reaching the
-- column. The db suite exists to prove exactly these.
alter table public.profiles
  add column seller_email_verified_at timestamptz;

create table if not exists public.seller_email_verifications (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid        not null references auth.users (id) on delete cascade,
  email        text        not null,
  token_hash   text        not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz
);

alter table public.seller_email_verifications
  add constraint seller_email_verifications_email_shape
    check (
      char_length(email) <= 254
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    ),
  add constraint seller_email_verifications_token_hash_shape
    check (token_hash ~ '^[0-9a-f]{64}$'),
  add constraint seller_email_verifications_expiry_after_issue
    check (expires_at > created_at);

create index if not exists seller_email_verifications_owner_idx
  on public.seller_email_verifications (owner_id);

alter table public.seller_email_verifications enable row level security;

revoke all on public.seller_email_verifications from anon;
revoke all on public.seller_email_verifications from authenticated;
grant all on public.seller_email_verifications to service_role;

-- 20260914_onboarding_state
-- Whether this person has been through the dashboard welcome flow. Replayed so
-- the e2e stack can drive the flow end to end: a replica without the column
-- would never open the dialog (the app treats only an explicit null as
-- pending), and every onboarding spec would pass against a flow that never
-- ran. The backfill is left out on purpose: the replica starts empty, so there
-- is no established seller to mark done.
alter table public.profiles
  add column onboarding_completed_at timestamptz;

-- 20260916_seller_bio
-- The optional one-line seller bio. Replayed in full for its CHECK (length and
-- no control characters), the backstop behind taxSchema for any write that
-- never went through the settings form.
alter table public.profiles
  add column seller_bio text;

alter table public.profiles
  add constraint profiles_seller_bio_shape
    check (
      seller_bio is null
      or (char_length(seller_bio) between 1 and 100 and seller_bio !~ '[\x01-\x1f\x7f]')
    );

-- 20260925_profile_locale
-- The account's chosen UI language. Replayed with its shape CHECK so the e2e
-- stack exercises the same write the app makes when a seller switches language,
-- and so a malformed value is refused here exactly as in production.
-- Applied to prod 2026-10-07 through the Management API query endpoint: it had
-- been replayed here but never run there, so the app's language save had been
-- failing softly. `pnpm check:schema` is what found it.
alter table public.profiles
  add column locale text;

alter table public.profiles
  add constraint profiles_locale_shape
    check (locale is null or locale ~ '^[a-z]{2}(-[A-Z]{2})?$');

-- 20260916_setup_celebrated
-- When this person was first shown their finished setup card. Replayed so the
-- e2e stack can prove the card shows once: the app treats only an explicit null
-- as pending, so a replica without the column would never render the card, and
-- a "shown once" spec would pass against a card that never appeared at all.
alter table public.profiles
  add column setup_celebrated_at timestamptz;

-- 20260917_sample_storefront
-- Two onboarding flags for the sample storefront (which is code, never a
-- storefronts row): whether the seller hid it from their list, and when the
-- designer tour first started for them. Replayed so the e2e stack can prove the
-- hide sticks across reloads and the tour starts once: the app treats only an
-- explicit null as "not yet", so a replica without the columns would show no
-- sample and start no tour at all.
alter table public.profiles
  add column sample_storefront_hidden_at timestamptz,
  add column editor_tour_seen_at timestamptz;

-- 20260918_content_moderation (SQ-store)
-- Takedown state on products, storefronts and artifacts, the trigger that makes
-- it staff-only, and the 'policy' notification type that tells a seller.
-- Replayed because the integration suite has to prove three things that exist
-- only in the database: that a seller cannot write moderation_* through their
-- own RLS-permitted UPDATE, that the columns default to visible, and that a
-- 'policy' notification inserts (the type CHECK and NOTIFICATION_TYPES are two
-- lists, and a mismatch fails silently).
alter table public.products
  add column moderation_status text not null default 'ok',
  add column moderation_ground text,
  add column moderation_note   text,
  add column moderated_at      timestamptz,
  add column moderated_by      uuid references public.admin_users (id) on delete set null;

alter table public.storefronts
  add column moderation_status text not null default 'ok',
  add column moderation_ground text,
  add column moderation_note   text,
  add column moderated_at      timestamptz,
  add column moderated_by      uuid references public.admin_users (id) on delete set null;

alter table public.artifacts
  add column moderation_status text not null default 'ok',
  add column moderation_ground text,
  add column moderation_note   text,
  add column moderated_at      timestamptz,
  add column moderated_by      uuid references public.admin_users (id) on delete set null;

do $guard$
declare
  target text;
begin
  foreach target in array array['products', 'storefronts', 'artifacts'] loop
    execute format(
      'alter table public.%I add constraint %I check (moderation_status in (''ok'', ''removed''))',
      target, target || '_moderation_status_check'
    );
    execute format(
      'alter table public.%I add constraint %I check (moderation_note is null or char_length(moderation_note) <= 500)',
      target, target || '_moderation_note_check'
    );
  end loop;
end
$guard$;

create index products_moderation_removed_idx
  on public.products (moderated_at desc) where moderation_status <> 'ok';
create index storefronts_moderation_removed_idx
  on public.storefronts (moderated_at desc) where moderation_status <> 'ok';
create index artifacts_moderation_removed_idx
  on public.artifacts (moderated_at desc) where moderation_status <> 'ok';

create or replace function public.guard_moderation_columns()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  guarded    text;
  before_row jsonb := to_jsonb(old);
  after_row  jsonb := to_jsonb(new);
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  foreach guarded in array array[
    'moderation_status', 'moderation_ground', 'moderation_note',
    'moderated_at', 'moderated_by'
  ] loop
    if (before_row -> guarded) is distinct from (after_row -> guarded) then
      raise exception
        'Moderation state is set by SquareShare staff and cannot be changed here (column %).', guarded
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$fn$;

create trigger products_guard_moderation
  before update on public.products
  for each row execute function public.guard_moderation_columns();

create trigger storefronts_guard_moderation
  before update on public.storefronts
  for each row execute function public.guard_moderation_columns();

create trigger artifacts_guard_moderation
  before update on public.artifacts
  for each row execute function public.guard_moderation_columns();

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type = any (array['team','payment','stock','order','system','security','policy']));

-- 0007_content_reports (SQ-admin)
-- Widens the shared `reports` table into one notice surface for all three apps,
-- adds the staff resolution columns, and adds the per-target rollup view.
-- Replayed because the RLS suite must keep proving reports stay staff-only
-- after the change, and because the dedupe indexes are the only thing stopping
-- one angry person from counting as a crowd.
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports
  add constraint reports_target_type_check
  check (target_type in ('product', 'storefront', 'artifact', 'profile'));

alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports
  add constraint reports_reason_check
  check (reason in (
    'illegal', 'sexual', 'violence', 'hate',
    'counterfeit', 'scam', 'spam', 'other'
  ));

alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports
  add constraint reports_status_check
  check (status in ('open', 'reviewed', 'actioned', 'dismissed'));

alter table public.reports
  add column reporter_hash   text,
  add column reporter_email  text,
  add column resolved_at     timestamptz,
  add column resolved_by     uuid references public.admin_users (id) on delete set null,
  add column resolution_note text;

alter table public.reports
  add constraint reports_reporter_email_check
  check (reporter_email is null or char_length(reporter_email) <= 320);

alter table public.reports
  add constraint reports_resolution_note_check
  check (resolution_note is null or char_length(resolution_note) <= 500);

create unique index reports_open_dedupe_hash_idx
  on public.reports (target_type, target_id, reporter_hash)
  where status in ('open', 'reviewed') and reporter_hash is not null;

create unique index reports_open_dedupe_user_idx
  on public.reports (target_type, target_id, reporter_id)
  where status in ('open', 'reviewed') and reporter_id is not null;

create index reports_open_created_idx
  on public.reports (created_at) where status in ('open', 'reviewed');

create view public.content_report_scores as
  select
    r.target_type,
    r.target_id,
    (count(*) filter (where r.status in ('open', 'reviewed')))::int             as open_reports,
    (count(*))::int                                                             as total_reports,
    max(r.created_at) filter (where r.status in ('open', 'reviewed'))           as newest_open_at,
    min(r.created_at) filter (where r.status in ('open', 'reviewed'))           as oldest_open_at,
    max(r.created_at)                                                           as newest_report_at,
    mode() within group (order by r.reason)                                     as top_reason,
    coalesce(p.title, s.name, a.title, pr.username)                             as target_title,
    coalesce(p.owner_id, s.owner_id, a.owner_id, pr.id)                         as target_owner_id,
    coalesce(p.moderation_status, s.moderation_status, a.moderation_status)     as moderation_status,
    coalesce(p.moderated_at, s.moderated_at, a.moderated_at)                    as moderated_at
  from public.reports r
  left join public.products    p  on r.target_type = 'product'    and p.id  = r.target_id
  left join public.storefronts s  on r.target_type = 'storefront' and s.id  = r.target_id
  left join public.artifacts   a  on r.target_type = 'artifact'   and a.id  = r.target_id
  left join public.profiles    pr on r.target_type = 'profile'    and pr.id = r.target_id
  group by
    r.target_type, r.target_id,
    p.title, s.name, a.title, pr.username,
    p.owner_id, s.owner_id, a.owner_id, pr.id,
    p.moderation_status, s.moderation_status, a.moderation_status,
    p.moderated_at, s.moderated_at, a.moderated_at;

revoke all on public.content_report_scores from anon, authenticated;
grant select on public.content_report_scores to service_role;

-- =============================================================================
-- ===== moderation_pause ======================================================
-- supabase/migrations/20260923_moderation_pause.sql, replayed. Present in prod
-- as of 2026-09-26 (verified: 'paused' in both status CHECKs and the review
-- column), applied through the SQL editor, which records no row in
-- supabase_migrations.schema_migrations. If it is ever re-applied with
-- apply_migration or db push, add that version to TRIAGE in
-- scripts/check-prod-migrations.ts with marker "moderation_pause".
-- Replayed because the integration suite has to prove a seller cannot set
-- moderation_review_requested_at through their own UPDATE (it is what puts a
-- decision back in front of staff), and the e2e stack drives the whole
-- pause -> fix -> ask -> approve loop against these columns.
-- =============================================================================
do $pause$
declare
  target text;
begin
  foreach target in array array['products', 'storefronts'] loop
    execute format(
      'alter table public.%I drop constraint if exists %I',
      target, target || '_moderation_status_check'
    );
    execute format(
      'alter table public.%I add constraint %I check (moderation_status in (''ok'', ''paused'', ''removed''))',
      target, target || '_moderation_status_check'
    );
  end loop;
end
$pause$;

alter table public.products
  add column moderation_review_requested_at timestamptz;
alter table public.storefronts
  add column moderation_review_requested_at timestamptz;

create index products_moderation_review_idx
  on public.products (moderation_review_requested_at)
  where moderation_review_requested_at is not null;
create index storefronts_moderation_review_idx
  on public.storefronts (moderation_review_requested_at)
  where moderation_review_requested_at is not null;

create or replace function public.guard_moderation_columns()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  guarded    text;
  before_row jsonb := to_jsonb(old);
  after_row  jsonb := to_jsonb(new);
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  foreach guarded in array array[
    'moderation_status', 'moderation_ground', 'moderation_note',
    'moderated_at', 'moderated_by', 'moderation_review_requested_at'
  ] loop
    if (before_row -> guarded) is distinct from (after_row -> guarded) then
      raise exception
        'Moderation state is set by SquareShare staff and cannot be changed here (column %).', guarded
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$fn$;

-- =============================================================================
-- ===== two_factor_auth =======================================================
-- supabase/migrations/20260923_two_factor_auth.sql, replayed verbatim. Applied
-- to prod on 2026-09-24 through the SQL editor, which records no row in
-- supabase_migrations.schema_migrations, so check:migrations has no version to
-- triage. If it is ever re-applied with apply_migration or db push, add that
-- version to TRIAGE in scripts/check-prod-migrations.ts with this marker.
-- =============================================================================

-- ====================================================================
-- TWO-FACTOR AUTHENTICATION: database-level enforcement + recovery codes.
--
-- WHAT THIS IS FOR. Two-factor sign-in itself is Supabase Auth's native TOTP
-- MFA: once a person verifies an authenticator app, every session they start
-- is `aal1` (password, Google or magic link only) until they enter a code, at
-- which point GoTrue re-issues it as `aal2`. The app refuses to serve an `aal1`
-- session for an enrolled account (lib/auth/session.ts), but that is only half
-- of it. The publishable anon key ships to every browser, so someone who has
-- phished a password can ask GoTrue for an `aal1` token directly and talk to
-- PostgREST without ever loading a page of this app. Without the policies
-- below, that token reads the victim's address, VAT number, orders and buyer
-- emails, and can rewrite their catalogue.
--
-- HOW. `mfa_session_ok()` answers one question about the CALLER's own
-- session: "is this token good enough for this account?" True at `aal2`, and
-- true at `aal1` only when the account has no verified factor (2FA is optional,
-- so everyone who has not opted in keeps working exactly as before). A
-- RESTRICTIVE policy built on it is ANDed with every permissive policy on the
-- table, so it cannot widen access anywhere; it can only take it away from a
-- session that skipped its second factor.
--
-- WHICH TABLES. Everything the Store and the marketplace (SQ-app) read or
-- write with a user's JWT. Sessions for both are minted by this app's sign-in
-- page (SQ-app has no login of its own and shares the .squareshare.eu cookie),
-- so an `aal1` session for an enrolled account only ever exists while its
-- owner is on the 2FA challenge screen. The admin panel's own tables are left
-- alone on purpose: it signs staff in itself, and reads the shared tables
-- below with the service role, which RLS never applies to.
--
-- Apply via Supabase MCP (apply_migration) or the SQL editor.
-- ====================================================================

-- ---- 1. Is this session good enough for this account? ---------------------
-- SECURITY DEFINER because `authenticated` has no read grant on auth.* tables.
-- No argument on purpose: the only account it can answer about is the one in
-- the caller's own JWT, so granting EXECUTE to `authenticated` discloses
-- nothing beyond "you have 2FA on", which the caller already knows.
--
-- A missing `aal` claim reads as aal1, matching GoTrue's own rule.
create or replace function public.mfa_session_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1
        from auth.mfa_factors f
        where f.user_id = auth.uid()
          and f.status = 'verified'
      )
$$;

-- Every function in this schema is auto-granted to anon and authenticated
-- (the PostgREST auto-grant trap), so the grant is set explicitly both ways.
revoke execute on function public.mfa_session_ok() from public, anon;
grant execute on function public.mfa_session_ok() to authenticated, service_role;

comment on function public.mfa_session_ok() is
  'True when the caller''s session satisfies their own 2FA setting: an aal2 token, or an aal1 token for an account with no verified MFA factor. Used by the restrictive "Require two-factor when enrolled" policies.';

-- ---- 2. The restrictive policies ------------------------------------------
-- One identical policy per table, created in a loop so the list is the only
-- thing to review. `(select ...)` makes Postgres evaluate the function ONCE per
-- statement (an initplan) rather than once per row.
--
-- Tables that do not exist are skipped rather than failing the migration: the
-- replica in tests/db and prod are both expected to carry every one of these,
-- and a missing one should be noticed by the RLS coverage test, not by a
-- half-applied migration.
do $$
declare
  t text;
  tables text[] := array[
    -- Store
    'profiles',
    'products',
    'storefronts',
    'orders',
    'team_members',
    'notifications',
    'security_events',
    'storefront_signals',
    -- Marketplace (SQ-app), written with the same user JWT
    'collections',
    'artifacts',
    'follows',
    'artifact_likes',
    'reports'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'two_factor_auth: skipping missing table public.%', t;
      continue;
    end if;
    execute format(
      'drop policy if exists "Require two-factor when enrolled" on public.%I', t);
    execute format(
      'create policy "Require two-factor when enrolled" on public.%I '
      'as restrictive for all to authenticated '
      'using ((select public.mfa_session_ok())) '
      'with check ((select public.mfa_session_ok()))', t);
  end loop;
end
$$;

-- ---- 3. Recovery codes ------------------------------------------------------
-- Supabase Auth has no recovery codes, so they live here. Only a salted
-- SHA-256 of each code is stored: the codes are 80 bits of CSPRNG output, so a
-- slow password hash buys nothing (there is no dictionary to slow down), and
-- the per-user salt (the user id, folded into the digest in
-- lib/auth/recovery-codes.ts) stops one precomputed table serving every
-- account. Single-use: `used_at` is set atomically by the consume function.
create table if not exists public.mfa_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  code_hash  text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);

comment on table public.mfa_recovery_codes is
  'Single-use 2FA recovery codes, stored as sha256(user_id:code). Service role only: no client role can read, write or even count them.';

create index if not exists mfa_recovery_codes_unused_idx
  on public.mfa_recovery_codes (user_id)
  where used_at is null;

-- RLS on with ZERO policies = deny-all for every client role. The revoke is
-- what actually matters (new tables are auto-granted to anon and
-- authenticated here), the RLS is the second lock on the same door.
alter table public.mfa_recovery_codes enable row level security;
revoke all on public.mfa_recovery_codes from anon, authenticated;
grant all on public.mfa_recovery_codes to service_role;

-- Replace a user's whole set in one transaction, so a failure part-way can
-- never leave them with half the codes they were just shown.
create or replace function public.mfa_replace_recovery_codes(
  p_user_id uuid,
  p_hashes  text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null
     or p_hashes is null
     or cardinality(p_hashes) = 0
     or cardinality(p_hashes) > 20 then
    raise exception 'invalid recovery code batch';
  end if;

  delete from public.mfa_recovery_codes where user_id = p_user_id;

  insert into public.mfa_recovery_codes (user_id, code_hash)
  select p_user_id, h
  from unnest(p_hashes) as h;

  return cardinality(p_hashes);
end
$$;

-- Spend one code. A single UPDATE, so two requests racing on the same code
-- cannot both succeed: the second finds `used_at` already set.
create or replace function public.mfa_consume_recovery_code(
  p_user_id uuid,
  p_hash    text
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with spent as (
    update public.mfa_recovery_codes
       set used_at = now()
     where user_id = p_user_id
       and code_hash = p_hash
       and used_at is null
    returning 1
  )
  select exists (select 1 from spent)
$$;

revoke execute on function public.mfa_replace_recovery_codes(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.mfa_consume_recovery_code(uuid, text) from public, anon, authenticated;
grant execute on function public.mfa_replace_recovery_codes(uuid, text[]) to service_role;
grant execute on function public.mfa_consume_recovery_code(uuid, text) to service_role;

-- ---- 4. SECURITY DEFINER functions a client can call ---------------------
-- The policies above do not reach inside a SECURITY DEFINER function: it
-- runs as its owner, which bypasses RLS. So every definer function that
-- `authenticated` may EXECUTE was audited, and each one that reads or writes
-- the caller's private data gets the same check at its own door. Found by an
-- adversarial pass over this migration: without it, a password-only token
-- could still read the team roster (member emails) straight off
-- /rest/v1/rpc/team_roster, accept invites, and spend the account's own
-- rate-limit budgets (for instance `password_reauth`, locking the owner out
-- of the password change they would make on seeing the lockout alert).
--
-- Bodies are the current definitions (pg_get_functiondef on the replayed
-- history) with one guard added each, nothing else changed. CREATE OR REPLACE
-- keeps the OID (RLS policies that call team_actor_role stay bound) and the
-- existing grants; the grants are restated anyway so the result does not
-- depend on what they were before (the auto-grant trap).
--
-- Left alone on purpose: is_squareshare_staff() and mfa_session_ok(), which
-- only answer a yes/no about the caller themselves.
--
-- BEFORE APPLYING TO PROD, compare each body with pg_get_functiondef on the
-- live database: these are Store-owned functions, but prod has been ahead of
-- this repo before.

-- The caller's role in `account`. Also the gate inside team_roster and inside
-- the team RLS policies, so guarding it here closes the roster too.
create or replace function public.team_actor_role(account uuid)
returns public.team_role
language sql
stable
security definer
set search_path = ''
as $$
  select tm.role
  from public.team_members tm
  where tm.account_owner_id = account
    and tm.member_user_id = (select auth.uid())
    and tm.status = 'active'
    and (select public.mfa_session_ok())
  limit 1
$$;

create or replace function public.team_my_accounts()
returns table(account_owner_id uuid, role public.team_role, store_name text, is_self boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    tm.account_owner_id,
    tm.role,
    coalesce(nullif(btrim(p.username), ''), 'A SquareShare store') as store_name,
    (tm.account_owner_id = (select auth.uid())) as is_self
  from public.team_members tm
  left join public.profiles p on p.id = tm.account_owner_id
  where tm.member_user_id = (select auth.uid())
    and tm.status = 'active'
    and (select public.mfa_session_ok())
  order by (tm.account_owner_id = (select auth.uid())) desc, store_name asc
$$;

create or replace function public.team_my_pending_invites()
returns table(id uuid, account_owner_id uuid, role public.team_role, invited_at timestamptz, store_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.id, tm.account_owner_id, tm.role, tm.invited_at,
         coalesce(p.username, 'A SquareShare store')
  from public.team_members tm
  left join public.profiles p on p.id = tm.account_owner_id
  where tm.status = 'invited'
    and lower(tm.invited_email) = (select public.team_jwt_email())
    and (select public.mfa_session_ok())
  order by tm.invited_at desc
  limit 50
$$;

create or replace function public.team_accept_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.team_jwt_email();
  v_uid uuid := (select auth.uid());
  v_updated uuid;
begin
  if v_uid is null or v_email is null then
    return false; -- unauthenticated or no verified email
  end if;

  -- Joining a store is an account change: not from a session that still
  -- owes its second factor.
  if not public.mfa_session_ok() then
    return false;
  end if;

  update public.team_members
     set status = 'active',
         member_user_id = v_uid,
         accepted_at = now()
   where id = p_invite_id
     and status = 'invited'
     and lower(invited_email) = v_email  -- identity: this invite is addressed to me
     and role <> 'owner'
   returning id into v_updated;

  return v_updated is not null;
end
$$;

create or replace function public.rl_take(p_action text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := (select auth.uid());
  cutoff timestamptz;
  kept   timestamptz[];
  allowed boolean;
begin
  -- Anonymous callers get nothing: this limiter is identity-scoped by design.
  -- Unauthenticated surfaces must use rl_take_key() instead.
  if uid is null then
    return false;
  end if;

  -- Nor does a session that still owes its second factor. Otherwise someone
  -- holding only the password could drain the account's budgets (and deny
  -- the owner the very actions they reach for when they see the alert).
  if not public.mfa_session_ok() then
    return false;
  end if;

  -- Reject nonsense budgets rather than failing open.
  if p_max is null or p_max < 1 then
    return false;
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    return false;
  end if;

  cutoff := now() - make_interval(secs => p_window_seconds);

  -- Ensure a row exists so the lock below always has one to take.
  insert into public.rate_limits (user_id, action)
  values (uid, p_action)
  on conflict (user_id, action) do nothing;

  -- Serialize concurrent takes for this (user, action) so two requests can
  -- never both read "4 hits" and both append a 5th.
  perform 1
  from public.rate_limits
  where user_id = uid and action = p_action
  for update;

  -- Prune to the trailing window, then decide.
  select coalesce(
           array(
             select t
             from unnest(r.hits) as t
             where t > cutoff
             order by t
           ),
           '{}'::timestamptz[]
         )
  into kept
  from public.rate_limits r
  where r.user_id = uid and r.action = p_action;

  allowed := coalesce(array_length(kept, 1), 0) < p_max;

  -- Only an ALLOWED take is recorded. Denied attempts must not extend the
  -- window, or a caller hammering the endpoint could lock themselves out
  -- indefinitely (and grow the array without bound).
  if allowed then
    kept := kept || now();
  end if;

  update public.rate_limits
  set hits = kept
  where user_id = uid and action = p_action;

  return allowed;
end
$$;

revoke execute on function public.team_actor_role(uuid) from public, anon;
revoke execute on function public.team_my_accounts() from public, anon;
revoke execute on function public.team_my_pending_invites() from public, anon;
revoke execute on function public.team_accept_invite(uuid) from public, anon;
revoke execute on function public.rl_take(text, integer, integer) from public, anon;
grant execute on function public.team_actor_role(uuid) to authenticated, service_role;
grant execute on function public.team_my_accounts() to authenticated, service_role;
grant execute on function public.team_my_pending_invites() to authenticated, service_role;
grant execute on function public.team_accept_invite(uuid) to authenticated, service_role;
grant execute on function public.rl_take(text, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) public_profiles_invoker =====================================
-- supabase/migrations/20260924_public_profiles_invoker.sql, replayed verbatim.
-- In prod: confirmed 2026-10-07 by reading the live schema (public_profiles is
-- security_invoker, profile_directory and its sync trigger exist). Applied
-- outside apply_migration, so no migration version is recorded; if it is ever
-- re-applied through apply_migration, add that version to TRIAGE in
-- scripts/check-prod-migrations.ts with this marker.
-- =============================================================================

-- =============================================================================
-- public_profiles: no longer a SECURITY DEFINER view
-- =============================================================================
-- WHAT THE ADVISOR SAID. Supabase's linter reports public.public_profiles as
-- CRITICAL (0010_security_definer_view): a view that runs with its owner's
-- rights, readable by anon, over public.profiles.
--
-- WHY IT WAS DEFINER. 20260807_db_hygiene section 4 kept it that way on
-- purpose, and the reasoning held: an invoker view reads `profiles` as the
-- caller, `profiles` has no anon select policy, and adding one would publish
-- tax_vat_id, the trader address and the rest of that row to the internet.
--
-- WHAT THIS DOES INSTEAD. The public surface stops reading `profiles` at all.
--
--   * public.profile_directory is a table holding exactly the public part:
--     id, username, avatar_url, and only for profiles that opted in
--     (is_public and a username). No other column exists on it to leak.
--   * A trigger on profiles keeps it in step, in the same transaction as the
--     change, so it can never show a profile that has gone private.
--   * The view keeps its name, columns and OID (CREATE OR REPLACE), and now
--     reads the directory as the CALLER (security_invoker = true). SQ-app's
--     .from("public_profiles") and the two policies that consult the view
--     (artifacts_public_read, follows_visible_read) are unchanged, because a
--     policy references the view by OID, not by name.
--
-- This is safer than before, not just quieter: widening the view can no
-- longer expose a profiles column (the "standing footgun" in SQ-app's
-- RISKS.md section 3), and nothing a client can reach runs with definer rights
-- over profiles any more.
--
-- Run it in one go: the SQL editor runs a script as a single transaction, and
-- step 0 aborts the whole thing, changing nothing, if production's view is not
-- the one this was written against.

-- ---- 0. Refuse to run against a view that has drifted ------------------------
-- The directory copies what the view exposes. If production's view has another
-- column or another filter, copying the replica's version would silently change
-- who is public, so stop and show what is there instead. Already migrated
-- (reads profile_directory) is accepted, so a re-run is harmless.
do $preflight$
declare
  cols text;
  shape text;
begin
  select string_agg(a.attname, ',' order by a.attnum)
    into cols
    from pg_attribute a
   where a.attrelid = 'public.public_profiles'::regclass
     and a.attnum > 0
     and not a.attisdropped;

  -- pg_get_viewdef qualifies names differently across Postgres versions and
  -- search_paths, so compare on a normalised form: lower case, no whitespace,
  -- brackets, semicolons or schema/table qualifiers.
  shape := lower(pg_get_viewdef('public.public_profiles'::regclass));
  shape := regexp_replace(shape, '[\s();]', '', 'g');
  shape := replace(shape, 'public.', '');
  shape := replace(shape, 'profile_directory.', '');
  shape := replace(shape, 'profiles.', '');

  if cols is distinct from 'id,username,avatar_url'
     or shape not in (
       'selectid,username,avatar_urlfromprofileswhereis_public=trueandusernameisnotnull',
       'selectid,username,avatar_urlfromprofile_directory'
     ) then
    raise exception
      'public_profiles is not the view this migration was written for. Nothing was changed. Columns: %. Definition: %',
      cols, pg_get_viewdef('public.public_profiles'::regclass);
  end if;
end
$preflight$;

-- ---- 1. The directory ---------------------------------------------------------
create table if not exists public.profile_directory (
  id uuid primary key references public.profiles (id) on delete cascade,
  username text not null,
  avatar_url text
);

comment on table public.profile_directory is
  'The public part of opted-in profiles (is_public and a username): id, username, avatar_url, nothing else. Written only by the sync_profile_directory trigger on profiles; read through the public_profiles view. Never add a column here that is not meant for the whole internet.';

-- RLS on (the rls_auto_enable event trigger would do it too, but a table's
-- security should not depend on an event trigger someone might drop). Readable
-- by everyone, because that is its whole job; writable by no client role at
-- all. The explicit revokes undo the schema's default grants, which hand every
-- new table to anon and authenticated with INSERT/UPDATE/DELETE included.
alter table public.profile_directory enable row level security;

revoke all on public.profile_directory from public, anon, authenticated, service_role;
grant select on public.profile_directory to anon, authenticated, service_role;

drop policy if exists "Public directory is readable by everyone" on public.profile_directory;
create policy "Public directory is readable by everyone"
  on public.profile_directory
  for select to anon, authenticated
  using (true);

-- ---- 2. Keep it in step with profiles ----------------------------------------
-- SECURITY DEFINER because the person changing their own profile has no write
-- grant on the directory, and must not. It writes only the row of the profile
-- that fired it, with values taken from that row. Nobody can call it directly:
-- it returns `trigger`, and execute is revoked below regardless.
create or replace function public.sync_profile_directory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_public is true and new.username is not null then
    insert into public.profile_directory (id, username, avatar_url)
    values (new.id, new.username, new.avatar_url)
    on conflict (id) do update
      set username = excluded.username,
          avatar_url = excluded.avatar_url;
  else
    delete from public.profile_directory where id = new.id;
  end if;
  return null;
end;
$$;

revoke execute on function public.sync_profile_directory() from public, anon, authenticated;

-- AFTER, so it sees the final values from any BEFORE trigger. A deleted
-- profile needs no branch: the foreign key cascades.
drop trigger if exists profiles_sync_directory on public.profiles;
create trigger profiles_sync_directory
  after insert or update of is_public, username, avatar_url on public.profiles
  for each row execute function public.sync_profile_directory();

-- ---- 3. Backfill (and prune, so a re-run converges) ---------------------------
insert into public.profile_directory (id, username, avatar_url)
select p.id, p.username, p.avatar_url
  from public.profiles p
 where p.is_public = true
   and p.username is not null
on conflict (id) do update
  set username = excluded.username,
      avatar_url = excluded.avatar_url;

delete from public.profile_directory d
 where not exists (
   select 1 from public.profiles p
    where p.id = d.id
      and p.is_public = true
      and p.username is not null
 );

-- ---- 4. The view reads the directory, as the caller -----------------------------
create or replace view public.public_profiles
with (security_invoker = true) as
  select id, username, avatar_url
  from public.profile_directory;

-- Stated again rather than trusted to CREATE OR REPLACE: the options, and
-- the grants (SELECT only; the view is auto-updatable, and although the
-- directory refuses client writes anyway, the view should not offer them).
alter view public.public_profiles set (security_invoker = true);
revoke all on public.public_profiles from public, anon, authenticated;
grant select on public.public_profiles to anon, authenticated, service_role;

comment on view public.public_profiles is
  'Opt-in public directory: id, username, avatar_url for is_public profiles. Reads public.profile_directory as the caller (security_invoker); it no longer touches profiles, which holds tax data and must never carry an anon select policy.';

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) passkey_factors =============================================
-- supabase/migrations/20260925_passkey_factors.sql, replayed verbatim. Applied
-- to prod through the Management API (no migration version is recorded).
-- =============================================================================

-- =============================================================================
-- Passkeys as the second factor
-- =============================================================================
-- WHAT A SELLER GETS. Two-factor authentication without installing an app:
-- Face ID, a fingerprint, or (on a computer) the browser's QR code scanned
-- with the phone's own camera. Authenticator apps stay available beside it.
--
-- WHY THIS SHAPE, and not Supabase's own passkeys:
--   * Supabase Auth's WebAuthn MFA factor is not available on hosted projects
--     (the Management API answers "Enabling of MFA with WebAuthn not currently
--     supported", checked 2026-09-25).
--   * Its passkey SIGN-IN is a first factor. Anyone holding the password could
--     register their own passkey through GoTrue and walk past a second step
--     built on it.
--
-- So each passkey is backed by an ordinary GoTrue TOTP factor whose secret
-- only the server knows. A verified passkey assertion is what makes the server
-- compute the current code and hand it to GoTrue. GoTrue therefore still
-- issues aal2, still refuses factor, password and email changes to aal1
-- sessions, and everything built on aal2 (the app gate, the restrictive RLS,
-- step-up, recovery codes) applies unchanged.
--
-- This table holds, per passkey, the WebAuthn public key and counter, and the
-- TOTP secret SEALED with AES-GCM under a key that exists only in the Worker
-- (MFA_PASSKEY_KEY), bound to the user and factor. A dump of the table cannot
-- mint a code. Service role only, like mfa_recovery_codes.
--
-- Lengths are checked with char_length, not a regex {m,n}: Postgres caps a
-- regex repeat count at 255, and a larger bound only fails when a row is
-- written, not when the table is created.
create table if not exists public.mfa_passkeys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- The GoTrue factor this passkey unlocks. Cascades, so a factor removed by
  -- ANY route (Settings, a recovery code, the dashboard, account deletion)
  -- takes its passkey with it and can never leave a key that unlocks nothing.
  factor_id     uuid not null unique references auth.mfa_factors (id) on delete cascade,
  credential_id text not null unique
                check (credential_id ~ '^[A-Za-z0-9_-]+$' and char_length(credential_id) between 16 and 1400),
  public_key    text not null
                check (public_key ~ '^[A-Za-z0-9_-]+$' and char_length(public_key) between 16 and 2000),
  sign_count    bigint not null default 0 check (sign_count >= 0),
  transports    text[] not null default '{}'
                check (transports <@ array['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']::text[]),
  backed_up     boolean not null default false,
  sealed_secret text not null
                check (sealed_secret ~ '^[A-Za-z0-9_-]+$' and char_length(sealed_secret) between 40 and 400),
  name          text not null check (char_length(name) between 1 and 40),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

comment on table public.mfa_passkeys is
  'Passkeys used as the second factor. Each unlocks one GoTrue TOTP factor whose secret is sealed here under a Worker-only key. Service role only: no client role can read, write or count them.';

create index if not exists mfa_passkeys_user_idx on public.mfa_passkeys (user_id);

-- RLS on with ZERO policies = deny-all for every client role. The revoke is
-- what actually matters (new tables are auto-granted to anon and
-- authenticated here), the RLS is the second lock on the same door.
alter table public.mfa_passkeys enable row level security;
revoke all on public.mfa_passkeys from anon, authenticated;
grant all on public.mfa_passkeys to service_role;

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== moderation_decisions_and_appeals ======================================
-- supabase/migrations/20260926_moderation_decisions_and_appeals.sql, replayed.
-- Present in prod as of 2026-09-26 (verified: both tables, the column CHECKs,
-- the policies, the grants and the widened guard), applied through the SQL
-- editor, which records no row in supabase_migrations.schema_migrations, so
-- check:migrations has no version to triage. If it is ever re-applied with
-- apply_migration or db push, add that version to TRIAGE in
-- scripts/check-prod-migrations.ts with marker
-- "moderation_decisions_and_appeals". Replayed because the integration suite
-- proves the two new tables are read-only to sellers and invisible to
-- strangers, and the e2e stack drives the fix-fields, statement and appeal
-- flows against them.
-- =============================================================================
-- ---- 1. Decisions -----------------------------------------------------------

create table if not exists public.moderation_decisions (
  id             uuid primary key default gen_random_uuid(),
  target_type    text not null check (target_type in ('product', 'storefront')),
  target_id      uuid not null,
  -- The store the content belongs to (the account, not whoever clicked). Team
  -- members of that store read the decision through the policy below.
  owner_id       uuid not null references auth.users (id) on delete cascade,
  -- A snapshot: the statement names the content as it was when decided, and a
  -- seller who renames the listing afterwards does not rewrite the record.
  target_title   text not null check (char_length(target_title) <= 300),
  action         text not null check (action in ('paused', 'removed')),
  -- Mirror of REMOVAL_GROUNDS (@squaresharedev/moderation).
  ground         text not null check (ground in (
                   'illegal', 'sexual', 'violence', 'hate',
                   'counterfeit', 'scam', 'spam', 'other')),
  note           text check (note is null or char_length(note) <= 500),
  -- What the seller must change. Mirror of MODERATION_FIX_FIELDS; checked per
  -- target type below, because a product has no masthead and a storefront no
  -- purchase link.
  fields         text[] not null default '{}',
  -- The facts: how many notices from third parties led here, and what they
  -- alleged. Counts and categories only, never who or their words.
  report_count   integer not null default 0 check (report_count >= 0),
  report_reasons text[] not null default '{}',
  decided_by     uuid references public.admin_users (id) on delete set null,
  decided_at     timestamptz not null default now(),
  constraint moderation_decisions_fields_check check (
    case target_type
      when 'product' then fields <@ array[
        'title', 'description', 'price', 'image', 'photos', 'file',
        'purchaseLink', 'options', 'specs', 'documents', 'safety',
        'shipping', 'other']::text[]
      else fields <@ array[
        'name', 'header', 'text', 'images', 'products', 'background',
        'productPage', 'other']::text[]
    end
  ),
  constraint moderation_decisions_reasons_check check (
    report_reasons <@ array[
      'illegal', 'sexual', 'violence', 'hate',
      'counterfeit', 'scam', 'spam', 'other']::text[]
  )
);

comment on table public.moderation_decisions is
  'One row per staff pause or removal of a product or storefront: the facts a DSA Art. 17 statement of reasons is built from. Immutable once written. Written by the admin panel (service_role); read by the store it belongs to.';

create index if not exists moderation_decisions_target_idx
  on public.moderation_decisions (target_type, target_id, decided_at desc);
create index if not exists moderation_decisions_owner_idx
  on public.moderation_decisions (owner_id, decided_at desc);

-- ---- 2. What to fix, and which decision is current -------------------------
-- On the content row itself, beside the other moderation_* columns, so the
-- edit page reads everything it highlights in the one select it already
-- makes. `moderation_decision_id` is what ties the banner to its statement.

alter table public.products
  add column if not exists moderation_fields text[],
  add column if not exists moderation_decision_id uuid
    references public.moderation_decisions (id) on delete set null;

alter table public.storefronts
  add column if not exists moderation_fields text[],
  add column if not exists moderation_decision_id uuid
    references public.moderation_decisions (id) on delete set null;

alter table public.products drop constraint if exists products_moderation_fields_check;
alter table public.products
  add constraint products_moderation_fields_check check (
    moderation_fields is null or moderation_fields <@ array[
      'title', 'description', 'price', 'image', 'photos', 'file',
      'purchaseLink', 'options', 'specs', 'documents', 'safety',
      'shipping', 'other']::text[]
  );

alter table public.storefronts drop constraint if exists storefronts_moderation_fields_check;
alter table public.storefronts
  add constraint storefronts_moderation_fields_check check (
    moderation_fields is null or moderation_fields <@ array[
      'name', 'header', 'text', 'images', 'products', 'background',
      'productPage', 'other']::text[]
  );

comment on column public.products.moderation_fields is
  'Which parts of a paused product staff asked the seller to change (MODERATION_FIX_FIELDS). Staff-only write (guard_moderation_columns).';
comment on column public.products.moderation_decision_id is
  'The moderation_decisions row behind the current takedown, for its statement of reasons. Null while live. Staff-only write.';
comment on column public.storefronts.moderation_fields is
  'Which parts of a paused storefront staff asked the seller to change. Staff-only write (guard_moderation_columns).';
comment on column public.storefronts.moderation_decision_id is
  'The moderation_decisions row behind the current takedown. Null while live. Staff-only write.';

-- ---- 3. Appeals ---------------------------------------------------------------

create table if not exists public.moderation_appeals (
  id            uuid primary key default gen_random_uuid(),
  decision_id   uuid not null references public.moderation_decisions (id) on delete cascade,
  -- Denormalised from the decision so the policy and the staff queue need no
  -- join. Always equal to the decision's own; the filing action copies them.
  target_type   text not null check (target_type in ('product', 'storefront')),
  target_id     uuid not null,
  owner_id      uuid not null references auth.users (id) on delete cascade,
  -- Who pressed the button: the owner or a team member acting for the store.
  filed_by      uuid references auth.users (id) on delete set null,
  message       text not null check (char_length(message) between 20 and 2000),
  status        text not null default 'open'
                  check (status in ('open', 'upheld', 'overturned')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.admin_users (id) on delete set null,
  -- Staff's answer, shown to the seller verbatim.
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  -- ONE appeal per decision. A person reviewed the complaint and answered it;
  -- a second complaint about the same decision is the same complaint. A new
  -- decision (paused again, then removed) is a new row and can be appealed.
  constraint moderation_appeals_one_per_decision unique (decision_id),
  constraint moderation_appeals_decided_check check (
    (status = 'open') = (decided_at is null)
  )
);

comment on table public.moderation_appeals is
  'A seller''s complaint against one moderation decision (DSA Art. 20). Filed through SQ-store''s server action and answered in the admin panel, both with service_role. Read by the store it belongs to.';

create index if not exists moderation_appeals_open_idx
  on public.moderation_appeals (created_at) where status = 'open';
create index if not exists moderation_appeals_target_idx
  on public.moderation_appeals (target_type, target_id);

-- ---- 4. Access ------------------------------------------------------------------
-- Read: the store's owner and its members, the same test products_select_member
-- uses. Write: nobody but service_role. New tables in this project are
-- auto-granted to anon and authenticated (the PostgREST auto-grant trap), so
-- the grants are set explicitly rather than trusted.

alter table public.moderation_decisions enable row level security;
alter table public.moderation_appeals enable row level security;

revoke all on public.moderation_decisions from anon, authenticated;
revoke all on public.moderation_appeals from anon, authenticated;
grant select on public.moderation_decisions to authenticated;
grant select on public.moderation_appeals to authenticated;
grant all on public.moderation_decisions to service_role;
grant all on public.moderation_appeals to service_role;

drop policy if exists moderation_decisions_select_member on public.moderation_decisions;
create policy moderation_decisions_select_member on public.moderation_decisions
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'store.read')
  );

drop policy if exists moderation_appeals_select_member on public.moderation_appeals;
create policy moderation_appeals_select_member on public.moderation_appeals
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'store.read')
  );

-- The two-factor rule every seller-readable table carries (20260923): a
-- session that skipped its second factor reads nothing here either.
drop policy if exists "Require two-factor when enrolled" on public.moderation_decisions;
create policy "Require two-factor when enrolled" on public.moderation_decisions
  as restrictive for all to authenticated
  using ((select public.mfa_session_ok()))
  with check ((select public.mfa_session_ok()));

drop policy if exists "Require two-factor when enrolled" on public.moderation_appeals;
create policy "Require two-factor when enrolled" on public.moderation_appeals
  as restrictive for all to authenticated
  using ((select public.mfa_session_ok()))
  with check ((select public.mfa_session_ok()));

-- ---- 5. The guard, widened by two columns ------------------------------------
-- Same function, same test, two more names. A seller able to clear
-- moderation_fields would erase what they were told to fix; one able to point
-- moderation_decision_id elsewhere could swap the statement behind their
-- banner for a milder one.

create or replace function public.guard_moderation_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  guarded    text;
  before_row jsonb := to_jsonb(old);
  after_row  jsonb := to_jsonb(new);
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  foreach guarded in array array[
    'moderation_status', 'moderation_ground', 'moderation_note',
    'moderated_at', 'moderated_by', 'moderation_review_requested_at',
    'moderation_fields', 'moderation_decision_id'
  ] loop
    if (before_row -> guarded) is distinct from (after_row -> guarded) then
      raise exception
        'Moderation state is set by SquareShare staff and cannot be changed here (column %).', guarded
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.guard_moderation_columns() is
  'Refuses any change to moderation_* columns (including moderation_review_requested_at, moderation_fields and moderation_decision_id) unless the writer is service_role. Attached to products, storefronts and artifacts.';

-- =============================================================================
-- ===== (applied) contact_verification ========================================
-- supabase/migrations/20260926_contact_verification.sql, replayed verbatim.
-- APPLIED to prod 2026-09-30 through the Management API query endpoint (no
-- schema_migrations row, so nothing in TRIAGE). Replayed because the integration suite proves the guard
-- trigger (a seller cannot grant their own proof, a changed value loses it) and
-- the issue/redeem functions, and the e2e stack drives the code flow on them.
-- =============================================================================
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

-- =============================================================================
-- ===== (applied) sign_in_approvals ===========================================
-- supabase/migrations/20260927_sign_in_approvals.sql, replayed verbatim.
-- Applied to prod 2026-09-27 through the Management API query endpoint, which,
-- like the SQL editor, records no schema_migrations version, so there is
-- nothing to add to TRIAGE. The integration suite proves the three tables are
-- service-role only, and the e2e stack drives the approval flow on them.
-- =============================================================================
-- =============================================================================
-- Sign-in approval: finish signing in from a device that is already signed in
-- =============================================================================
-- WHAT A SELLER GETS. At the two-factor step, "Approve from your phone" shows a
-- QR code. Scanned with the phone's camera it opens Square Share on the phone,
-- where the seller is already signed in, and one tap on Approve finishes the
-- sign-in on the computer. Made for the case that prompted it: the computer
-- offers the browser's own "use a phone" passkey QR code, and the phone says it
-- has no passkey for Square Share because the passkey lives somewhere else.
--
-- HOW IT KEEPS aal2 MEANINGFUL. Exactly like passkeys
-- (20260925_passkey_factors): the approval is backed by an ordinary GoTrue
-- TOTP factor whose secret only the server knows, sealed under the Worker-only
-- MFA_PASSKEY_KEY. When a fully signed-in session (aal2) approves a request,
-- the server computes that factor's code and completes it FOR THE WAITING
-- SESSION ONLY, so GoTrue still issues aal2 and everything built on it (the app
-- gate, the restrictive RLS, step-up) applies unchanged.
--
-- WHY THE FACTOR IS COMPLETED BY THE WAITING SESSION, never by the approver.
-- GoTrue deletes every aal1 session of the account whenever ANY factor is
-- verified (InvalidateSessionsWithAALLessThan in verifyTOTPFactor). If the
-- phone verified anything while the computer waited, the computer would be
-- signed out. So the phone only ENROLS the factor the first time (an aal2
-- session may) and the computer verifies it (GoTrue checks assurance at enrol,
-- not at verify).
--
-- Three tables, all service role only, like mfa_recovery_codes and
-- mfa_passkeys: no client role may read, write or count any of them.
-- =============================================================================

-- ---- the factor ---------------------------------------------------------------
-- One per account. Cascades from its GoTrue factor, so a factor removed by ANY
-- route (Settings, a recovery code, the dashboard, account deletion) takes its
-- sealed secret with it.
create table if not exists public.mfa_approval_factors (
  factor_id     uuid primary key references auth.mfa_factors (id) on delete cascade,
  user_id       uuid not null unique references auth.users (id) on delete cascade,
  sealed_secret text not null
                check (sealed_secret ~ '^[A-Za-z0-9_-]+$' and char_length(sealed_secret) between 40 and 400),
  created_at    timestamptz not null default now()
);

comment on table public.mfa_approval_factors is
  'The GoTrue TOTP factor behind sign-in approval, one per account, its secret sealed under a Worker-only key. Service role only.';

-- ---- the off switch -------------------------------------------------------------
-- Approval is on for every account with 2FA unless it has a row here. A row
-- rather than a column on profiles: profiles is written by its owner through
-- PostgREST, and a way into the account must never be switched back on by a
-- request that did not pass step-up.
create table if not exists public.mfa_approval_opt_outs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.mfa_approval_opt_outs is
  'Accounts that turned sign-in approval off in Settings > Security. Service role only.';

-- ---- the requests ---------------------------------------------------------------
-- One per QR code shown. The token in the QR code is stored only as its
-- SHA-256; the request is bound to the waiting session, which is the only one
-- that may collect an approval.
create table if not exists public.mfa_sign_in_approvals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- GoTrue's session id (the token's session_id claim) of the session waiting
  -- at the two-factor step.
  session_id  uuid not null,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'denied', 'used', 'cancelled')),
  -- What the approving phone is shown about the waiting device. Coarse on
  -- purpose: a browser and system name and a country, never an address.
  browser     text check (char_length(browser) between 1 and 40),
  os          text check (char_length(os) between 1 and 40),
  country     text check (country ~ '^[A-Z]{2}$'),
  -- The approval factor the approver prepared for this request.
  factor_id   uuid references auth.mfa_factors (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  decided_at  timestamptz,
  used_at     timestamptz
);

comment on table public.mfa_sign_in_approvals is
  'Sign-in approval requests: a session at the two-factor step asks, a signed-in session of the same account approves or denies. Token stored hashed. Service role only.';

create index if not exists mfa_sign_in_approvals_user_idx
  on public.mfa_sign_in_approvals (user_id, created_at desc);
create index if not exists mfa_sign_in_approvals_session_idx
  on public.mfa_sign_in_approvals (session_id) where status = 'pending';

-- RLS on with ZERO policies = deny-all for every client role. The revokes are
-- what actually matter (new tables are auto-granted to anon and authenticated
-- here); RLS is the second lock on the same door.
alter table public.mfa_approval_factors enable row level security;
alter table public.mfa_approval_opt_outs enable row level security;
alter table public.mfa_sign_in_approvals enable row level security;
revoke all on public.mfa_approval_factors from anon, authenticated;
revoke all on public.mfa_approval_opt_outs from anon, authenticated;
revoke all on public.mfa_sign_in_approvals from anon, authenticated;
grant all on public.mfa_approval_factors to service_role;
grant all on public.mfa_approval_opt_outs to service_role;
grant all on public.mfa_sign_in_approvals to service_role;

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) order_fulfilment ============================================
-- supabase/migrations/20260927_order_fulfilment.sql, replayed verbatim.
-- Applied to prod 2026-09-28 through the Management API query endpoint, which
-- records no schema_migrations version, so there is nothing to add to TRIAGE.
-- Replayed because the integration suite proves the fences (the CHECKs, the
-- unique checkout id, order_mark_shipped's gates) and the e2e stack drives the
-- To ship flow on the new columns. Its companion
-- 20260927_demo_sales_sim_fulfilment.sql (applied the same way, same day) is
-- NOT replayed: the demo schema is excluded (pg_cron).
-- =============================================================================
-- Order fulfilment: what to pack, where it goes, and whether it has gone.
--
-- WHY. An order recorded what was sold and what it cost, and nothing a seller
-- needs in order to SEND it: not how many, not where to, and not whether it
-- had already gone out. A seller with three orders open had to keep a list of
-- their own to know which parcels were still owed. This is the minimum a
-- parcel needs, snapshotted on the order the way the product and its version
-- already are (20260706081743, 20260905_order_selected_options).
--
-- COLUMNS
--   quantity             How many units. Bounded by PURCHASE_QUANTITY_MAX (100)
--                        in src/lib/validation/product.ts, the same ceiling the
--                        buyer's picker and resolveOrderQuantity enforce.
--   ship_to              The delivery address as the buyer gave it at checkout:
--                        { name, line1, line2?, city, region?, postalCode?,
--                        country, phone? }. A SNAPSHOT, never a reference: a
--                        buyer who moves later must not move a parcel that is
--                        already on its way. Null for an order that ships
--                        nothing (a download), and for rows written before this.
--   buyer_locale         The language the buyer checked out in, so mail about
--                        their order (it has shipped) reaches them in it.
--   fulfilment_status    'unfulfilled' (paid, not sent yet), 'shipped', or
--                        'not_required' (nothing physical to send). Separate
--                        from `status`, which is about the MONEY: a paid order
--                        can be unshipped, and a shipped one can be refunded.
--   shipped_at           When the seller marked it shipped. Set exactly when
--                        fulfilment_status is 'shipped' (a CHECK holds them
--                        together), so "shipped, but when?" cannot exist.
--   tracking_number      Optional, and only on a shipped order. A number, not a
--                        link: it is printed in mail sent from our domain, so
--                        it is held to the reference-code character set rather
--                        than admitted as arbitrary text or a URL.
--   checkout_session_id  The payment provider's id for the checkout that paid
--                        for this order. UNIQUE, and that is the point: a
--                        payment webhook is delivered at least once, and the
--                        order writer (src/lib/orders/record.ts) inserts with
--                        ON CONFLICT DO NOTHING, so a redelivered event can
--                        never become a second order, a second stock decrement
--                        or a second "ship this" email.
--
-- WRITES. Orders are still written by the service role only, through the one
-- order writer. The ONE thing a seller changes is whether an order has shipped,
-- and that goes through public.order_mark_shipped below rather than an UPDATE
-- policy: a policy would open every column of the row (the amount, the payment
-- status) to the seller's own session, where this function touches exactly the
-- fulfilment columns and nothing else.
--
-- PERMISSION. A new action, 'orders.fulfil', for owners and editors. Viewers
-- keep reading orders (store.read) and do not ship them. Mirrored from
-- src/lib/team/permissions.ts, which must be edited in the same change.
--
-- BACKFILL. Every order that exists before this migration is marked shipped
-- (at its own created_at). None of them can be a parcel anybody still owes:
-- checkout has never been open, so every existing row is seed or demo-simulator
-- data. Leaving them 'unfulfilled' would open every such account on a To ship
-- queue hundreds of rows long, which is a false alarm, not history.
--
-- Apply via Supabase MCP (apply_migration) or the SQL editor.

-- ---- 1. Columns ----------------------------------------------------------------

alter table public.orders
  add column quantity integer not null default 1,
  add column ship_to jsonb,
  add column buyer_locale text,
  add column fulfilment_status text not null default 'unfulfilled',
  add column shipped_at timestamptz,
  add column tracking_number text,
  add column checkout_session_id text;

-- Before the constraints below, which it has to satisfy.
update public.orders
   set fulfilment_status = 'shipped',
       shipped_at = created_at;

alter table public.orders
  add constraint orders_quantity_range
    check (quantity between 1 and 100),
  add constraint orders_fulfilment_status_check
    check (fulfilment_status in ('unfulfilled', 'shipped', 'not_required')),
  add constraint orders_shipped_at_matches_status
    check ((fulfilment_status = 'shipped') = (shipped_at is not null)),
  add constraint orders_tracking_number_shape
    check (tracking_number is null or tracking_number ~ '^[A-Za-z0-9 .-]{4,40}$'),
  add constraint orders_tracking_only_when_shipped
    check (tracking_number is null or fulfilment_status = 'shipped'),
  add constraint orders_ship_to_is_object
    check (ship_to is null or jsonb_typeof(ship_to) = 'object'),
  -- The reader's worst case (eight short fields) is well under 1 KB; 2 KB is
  -- the same ceiling selected_options carries, for the same reason: orders are
  -- the highest-volume table in the product.
  add constraint orders_ship_to_size
    check (ship_to is null or pg_column_size(ship_to) <= 2048),
  -- Same shape rule as profiles.locale (20260925_profile_locale): a language,
  -- optionally with a region. The app narrows it to the supported list.
  add constraint orders_buyer_locale_shape
    check (buyer_locale is null or buyer_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  add constraint orders_checkout_session_id_shape
    check (checkout_session_id is null or checkout_session_id ~ '^[A-Za-z0-9_]{1,255}$'),
  add constraint orders_checkout_session_id_key
    unique (checkout_session_id);

-- The To ship queue and its count (the sidebar badge, the overview row): paid,
-- not sent, oldest first. Partial, so it stays the size of the queue rather
-- than of the whole order history.
create index if not exists orders_seller_to_ship_idx
  on public.orders (seller_id, created_at)
  where status = 'paid' and fulfilment_status = 'unfulfilled';

comment on column public.orders.quantity is
  'Units sold on this order, 1..100 (PURCHASE_QUANTITY_MAX).';
comment on column public.orders.ship_to is
  'Delivery address snapshotted at checkout: {name, line1, line2?, city, region?, postalCode?, country (ISO 3166-1 alpha-2), phone?}. Null when nothing ships. Read through src/lib/orders/ship-to.ts, which trims and caps every field.';
comment on column public.orders.buyer_locale is
  'UI language the buyer checked out in (BCP 47, e.g. de or pt-PT), for mail about their order. Null = unknown; mail falls back to English.';
comment on column public.orders.fulfilment_status is
  'unfulfilled (paid, not sent yet) | shipped | not_required (nothing physical to send). Independent of status, which is about the payment.';
comment on column public.orders.shipped_at is
  'When the seller marked the order shipped. Non-null exactly when fulfilment_status = shipped.';
comment on column public.orders.tracking_number is
  'Optional carrier tracking number, set when (or after) the order is marked shipped. Reference-code characters only: it is printed in mail sent to the buyer.';
comment on column public.orders.checkout_session_id is
  'Payment provider checkout id that paid for this order. Unique: the order writer inserts ON CONFLICT DO NOTHING, so a redelivered payment event cannot create a second order.';

-- ---- 2. Permission mirror --------------------------------------------------------
-- MIRROR of src/lib/team/permissions.ts. Edit BOTH together. CREATE OR REPLACE
-- keeps the function's existing grants, so none are restated here.
create or replace function public.team_role_can(r public.team_role, action text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when r is null then false
    when r = 'owner'  then action in ('team.read','team.invite','team.change_role','team.revoke','store.read','products.write','storefront.write','orders.fulfil')
    when r = 'editor' then action in ('team.read','team.invite','store.read','products.write','storefront.write','orders.fulfil')
    when r = 'viewer' then action in ('team.read','store.read')
    else false
  end
$$;

-- ---- 3. Marking an order shipped -------------------------------------------------
-- The seller's one write on an order. SECURITY DEFINER because orders has no
-- client UPDATE policy (see WRITES above), and therefore self-gated on every
-- check a policy would have made, plus the one a definer function skips:
--
--   * mfa_session_ok(): the restrictive "Require two-factor when enrolled"
--     policy never runs inside a definer function, so an aal1 session of an
--     enrolled account is refused here explicitly.
--   * the caller owns the order's store, or holds orders.fulfil on it.
--
-- A refusal and a missing order both read 'not_found', so the function cannot
-- be used to learn which order ids exist in someone else's store.
--
-- Results:
--   'shipped'           unfulfilled -> shipped, stamped now, tracking stored
--   'tracking_updated'  already shipped; the tracking number changed
--   'unchanged'         already shipped with this exact tracking number
--   'not_shippable'     not paid (pending, refunded, disputed), or nothing ships
--   'not_found'         no such order, or not yours to ship
--
-- The caller (src/lib/orders/actions.ts) mails the buyer on 'shipped' and on a
-- 'tracking_updated' that set a number, which is why the result distinguishes
-- them rather than returning a boolean.
create or replace function public.order_mark_shipped(
  p_order_id uuid,
  p_tracking_number text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  tracking text := nullif(btrim(coalesce(p_tracking_number, '')), '');
begin
  if not public.mfa_session_ok() then
    return 'not_found';
  end if;

  select * into target
    from public.orders
   where id = p_order_id
     for update;

  if not found
     or not (
       target.seller_id = (select auth.uid())
       or public.team_role_can(public.team_actor_role(target.seller_id), 'orders.fulfil')
     ) then
    return 'not_found';
  end if;

  if target.status <> 'paid' or target.fulfilment_status = 'not_required' then
    return 'not_shippable';
  end if;

  if target.fulfilment_status = 'shipped' then
    if tracking is not distinct from target.tracking_number then
      return 'unchanged';
    end if;
    update public.orders
       set tracking_number = tracking
     where id = target.id;
    return 'tracking_updated';
  end if;

  update public.orders
     set fulfilment_status = 'shipped',
         shipped_at = now(),
         tracking_number = tracking
   where id = target.id;
  return 'shipped';
end
$$;

-- A new function is auto-granted to anon (the PostgREST auto-grant trap), so
-- the grant is set explicitly both ways.
revoke execute on function public.order_mark_shipped(uuid, text) from public, anon;
grant execute on function public.order_mark_shipped(uuid, text) to authenticated, service_role;

comment on function public.order_mark_shipped(uuid, text) is
  'Seller marks a paid order shipped (optionally with a tracking number), or changes the tracking number of a shipped one. Self-gated: 2FA session bar, owner or orders.fulfil. Returns shipped | tracking_updated | unchanged | not_shippable | not_found.';

notify pgrst, 'reload schema';
-- =============================================================================
-- ===== (applied) checkout ====================================================
-- supabase/migrations/20260928_checkout.sql, replayed verbatim. Applied to prod
-- 2026-09-29 through the Management API query endpoint (no schema_migrations
-- row, so nothing to add to TRIAGE): hosted checkout (channel direct, gift
-- message, withdrawal, the paid file snapshot, the checkout_view signal).
-- =============================================================================
-- Checkout: what an order needs once buyers pay on Square Share itself.
--
-- WHY. Until now an order could only be written by the dev sale simulator, and
-- every row carried a channel of 'embed' or 'marketplace'. Hosted checkout is a
-- third place a sale can come from, and the order it writes owes the buyer
-- three things the row could not hold: the gift message they typed, a record
-- of the withdrawal they asked for, and the file they paid to download.
--
-- COLUMNS
--   channel                  Gains 'direct': a sale made on the seller's hosted
--                            pages (product page, then checkout). The same word
--                            storefront_signals already uses for those pages.
--   gift_message             What the buyer asked the seller to put in the
--                            parcel. Plain text, at most 200 characters,
--                            physical orders only (the writer drops it for a
--                            download). Null when none was written.
--   withdrawal_requested_at  When the buyer used the withdrawal function on the
--                            order page (Consumer Rights Directive art. 11a).
--                            A timestamp rather than a status: the contract is
--                            between buyer and seller, and what the seller does
--                            next (refund, collect the parcel) is theirs to
--                            record. Set once; asking again changes nothing.
--   supply_consent_at        When a buyer of a download agreed, at checkout, to
--                            receive it straight away and so lose the right of
--                            withdrawal (CRD art. 16(m)). The evidence for why
--                            no withdrawal function is offered on that order.
--   digital_file_key         The file this order paid for, SNAPSHOTTED. A
--                            product's file can be replaced or the product
--                            deleted (orders.product_id is ON DELETE SET NULL);
--                            the buyer's download must survive both, so the
--                            order keeps its own key and product writes stop
--                            evicting a file an order still points at.
--
-- SIGNALS. 'checkout_view': a view of the hosted checkout, recorded by the page
-- itself the way 'product_view' is. THIS LIST IS MIRRORED in
-- src/lib/analytics/signals.ts; edit both together.
--
-- WRITES. Unchanged: orders are written by the service role through the one
-- order writer (src/lib/orders/record.ts), and the withdrawal timestamp by the
-- service-role withdrawal route. No policy, grant or function is added.
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. Channel ----------------------------------------------------------------

alter table public.orders
  drop constraint if exists orders_channel_check;
alter table public.orders
  add constraint orders_channel_check
    check (channel in ('embed', 'marketplace', 'direct'));

-- ---- 2. Columns ----------------------------------------------------------------

alter table public.orders
  add column if not exists gift_message text,
  add column if not exists withdrawal_requested_at timestamptz,
  add column if not exists supply_consent_at timestamptz,
  add column if not exists digital_file_key text;

alter table public.orders
  add constraint orders_gift_message_length
    check (gift_message is null or char_length(gift_message) between 1 and 200),
  -- The same prefix and owner-scoped shape every uploaded download has; a key
  -- is copied from the product row by the writer, never accepted from a buyer.
  add constraint orders_digital_file_key_shape
    check (digital_file_key is null or (digital_file_key ~ '^files/' and char_length(digital_file_key) <= 512));

-- Product writes ask "does any order still need this file?" before evicting it.
create index if not exists orders_digital_file_key_idx
  on public.orders (digital_file_key)
  where digital_file_key is not null;

comment on column public.orders.gift_message is
  'The buyer''s gift message for the parcel, plain text, 1..200 characters. Physical orders only.';
comment on column public.orders.withdrawal_requested_at is
  'When the buyer used the withdrawal function on their order page (CRD art. 11a). Set once.';
comment on column public.orders.supply_consent_at is
  'When a download buyer consented at checkout to immediate supply and the loss of the withdrawal right (CRD art. 16(m)).';
comment on column public.orders.digital_file_key is
  'R2 key of the file this order paid for, snapshotted from the product at sale time. Never shown; the order page hands out short-lived signed links.';

-- ---- 3. Signal kind ------------------------------------------------------------

alter table public.storefront_signals
  drop constraint storefront_signals_kind_check;
alter table public.storefront_signals
  add constraint storefront_signals_kind_check
    check (kind in ('storefront_view','product_click','email_signup','booking','product_view','checkout_view'));

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) approval_code ===============================================
-- supabase/migrations/20260929_approval_code.sql, replayed verbatim. Applied to
-- prod 2026-09-29 through the Management API (records no schema_migrations
-- version, so nothing in TRIAGE).
-- =============================================================================
-- =============================================================================
-- Sign-in approval: the approving device hands over ONE short-lived code
-- =============================================================================
-- Until now the WAITING device opened the approval factor's sealed secret and
-- computed the code itself, so every server that can complete an approval had
-- to hold the same MFA_PASSKEY_KEY. A local dev server (its own key) could not
-- finish a sign-in that the live site approved.
--
-- Now the APPROVING side, which already holds the key, computes a single
-- 6-digit code at the moment of approval and leaves it on the request. The
-- waiting device spends it once, within seconds, at GoTrue. It never sees the
-- secret, and a leaked row is worth one code for under a minute, not the factor.
--
-- Cleared as it is spent and left to expire otherwise; the table is service
-- role only (20260927_sign_in_approvals), so no client can read it.
alter table public.mfa_sign_in_approvals
  add column if not exists approval_code text
  check (approval_code is null or approval_code ~ '^[0-9]{6}$');

comment on column public.mfa_sign_in_approvals.approval_code is
  'The one TOTP code the approving device computed for the approval factor. Valid for about a minute; cleared when spent. Service role only.';

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) seller_plans ================================================
-- supabase/migrations/20260930_seller_plans.sql, replayed verbatim. APPLIED to
-- prod 2026-09-30 through the Management API query endpoint (no
-- schema_migrations row, so nothing in TRIAGE). Plan limits ship switched
-- off (billing_switches) until paid plans are on sale.
-- =============================================================================
-- Seller plans: Free, Starter and Pro, billed through Stripe.
--
-- WHY. Square Share moves from one flat per-sale fee to a subscription with a
-- smaller fee. Every account is on Free until it pays for a plan, and falls
-- back to Free when a paid plan ends. Paid plans lower the per-sale fee and
-- lift the limits on how many storefronts and teammates an account can add.
-- The catalog (prices, fees, limits) is src/lib/billing/plans.ts; this file
-- stores who is on what, and enforces the limits a second time.
--
-- WHAT THIS ADDS
--   1. orders: the fee's rate and plan, and the delivery share, snapshotted on
--      every order, so a later price change can never rewrite what a past sale
--      was charged, and "Platform fee (3%)" can be shown exactly.
--   2. seller_billing: one row per account that has ever started paying. The
--      row's `paid_until` is THE answer to "which plan is this account on"
--      (see src/lib/billing/entitlement.ts): the paid plan until then, Free
--      after. Written only by the service role, from Stripe's webhook.
--   3. stripe_events: the webhook's idempotency ledger.
--   4. seller_funnel_events: what happens around the pricing modal (viewed,
--      limit hit, checkout started, upgraded ...), so we can tell which entry
--      points convert. Server-produced; nothing a browser can write.
--   5. plan_limit() and the triggers that enforce it on storefronts and
--      team_members. The app checks first and explains; these make the limit
--      true for a direct REST insert too. Both obey one switch,
--      billing_switches.plan_limits_enforced, which ships OFF: a limit must
--      not bite before a bigger plan can be bought.
--   6. billing_sales_summary(): the last 30 days of item sales, for the
--      pricing modal's "which plan is cheapest for me" calculator.
--   7. The 'billing.manage' permission (owners only) and the 'billing'
--      notification type.
--
-- WRITES. seller_billing, stripe_events and seller_funnel_events have RLS on
-- and NO policies: no client role can read or write them at all. Everything
-- goes through the service role in src/lib/billing (the webhook, the billing
-- actions), which is what makes "an owner edits their own plan over REST"
-- impossible rather than merely refused. Team members read their store's plan
-- through the server (getAccountPlan), never through these tables.
--
-- MIRRORS, each to be edited in the same change as its twin:
--   plan_limit()            <-> PLANS[..].limits in src/lib/billing/plans.ts
--                               (tests/integration/29-seller-plans.test.ts
--                               compares the two)
--   seller_funnel_events    <-> FUNNEL_EVENT_KINDS in src/lib/billing/funnel.ts
--     kind / source CHECKs      and PRICING_SOURCES in src/lib/billing/paths.ts
--   team_role_can()         <-> src/lib/team/permissions.ts
--   notifications_type_check <-> NOTIFICATION_TYPES in lib/notifications/types.ts
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. Orders: the fee as it was charged ---------------------------------------

alter table public.orders
  add column if not exists platform_fee_bps smallint,
  add column if not exists seller_plan text,
  add column if not exists shipping_cents integer;

alter table public.orders
  -- 10 000 bps is the whole sale; a fee can never be more than that.
  add constraint orders_platform_fee_bps_range
    check (platform_fee_bps is null or platform_fee_bps between 0 and 10000),
  add constraint orders_seller_plan_check
    check (seller_plan is null or seller_plan in ('free', 'starter', 'pro')),
  add constraint orders_shipping_cents_range
    check (shipping_cents is null or (shipping_cents >= 0 and shipping_cents <= amount_cents));

comment on column public.orders.platform_fee_bps is
  'The platform fee rate this order was charged, in basis points of the item subtotal (500 = 5%). Snapshotted at sale time from the seller''s plan. Null on orders written before plans existed.';
comment on column public.orders.seller_plan is
  'The seller''s plan (free | starter | pro) at the moment of sale, which set platform_fee_bps. Null on orders written before plans existed.';
comment on column public.orders.shipping_cents is
  'Delivery''s share of amount_cents, in cents. The platform fee is charged on amount_cents minus this. Null when unknown (older orders, and sales that did not report it).';

-- ---- 2. seller_billing -------------------------------------------------------------

create table if not exists public.seller_billing (
  owner_id               uuid primary key references public.profiles (id) on delete cascade,
  stripe_customer_id     text not null unique,
  stripe_subscription_id text unique,
  plan                   text,
  billing_interval       text,
  status                 text not null default 'none',
  price_cents            integer,
  currency               text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  canceled_at            timestamptz,
  paid_until             timestamptz,
  livemode               boolean not null default false,
  stripe_synced_at       timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint seller_billing_customer_shape
    check (stripe_customer_id ~ '^cus_[A-Za-z0-9_]{1,250}$'),
  constraint seller_billing_subscription_shape
    check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9_]{1,250}$'),
  -- Free is the ABSENCE of a paid plan, never a stored value.
  constraint seller_billing_plan_check
    check (plan is null or plan in ('starter', 'pro')),
  constraint seller_billing_interval_check
    check (billing_interval is null or billing_interval in ('month', 'year')),
  -- Stripe's subscription statuses, plus 'none' for a customer with no
  -- subscription yet (the row exists from the first checkout attempt).
  constraint seller_billing_status_check
    check (status in ('none', 'incomplete', 'incomplete_expired', 'trialing', 'active',
                      'past_due', 'canceled', 'unpaid', 'paused')),
  constraint seller_billing_price_range
    check (price_cents is null or price_cents >= 0),
  constraint seller_billing_currency_shape
    check (currency is null or currency ~ '^[A-Z]{3}$'),
  -- A paid-until date only means something with a plan to be paid for.
  constraint seller_billing_paid_until_needs_plan
    check (paid_until is null or plan is not null)
);

comment on table public.seller_billing is
  'Which paid plan an account is on, mirrored from Stripe Billing by the webhook (src/app/api/billing/webhook). No row, or paid_until in the past, means Free. Service role only: no client policy exists.';
comment on column public.seller_billing.paid_until is
  'When the paid plan stops applying (period end plus renewal slack, or past-due grace). THE entitlement: every reader compares this with the clock and never asks Stripe.';
comment on column public.seller_billing.price_cents is
  'What this account actually pays per interval, excluding VAT. Shown instead of the catalog price, so a grandfathered seller sees their own price.';
comment on column public.seller_billing.stripe_synced_at is
  'When the snapshot this row holds was fetched from Stripe. billing_apply_snapshot only ever moves it forward, so an older fetch that lands late cannot overwrite a newer one.';

alter table public.seller_billing enable row level security;
revoke all on table public.seller_billing from anon, authenticated;
grant all on table public.seller_billing to service_role;

-- ---- 3. stripe_events ------------------------------------------------------------

create table if not exists public.stripe_events (
  id              text primary key,
  type            text not null,
  livemode        boolean not null,
  received_at     timestamptz not null default now(),
  -- Set once the event's effect on seller_billing is applied. An event with
  -- none is retried by Stripe (the webhook answers 500 until it succeeds).
  processed_at    timestamptz,
  -- Claimed before a notification or email goes out, so a redelivered event
  -- never tells the seller the same thing twice.
  side_effects_at timestamptz,

  constraint stripe_events_id_shape check (id ~ '^evt_[A-Za-z0-9_]{1,250}$'),
  constraint stripe_events_type_length check (char_length(type) between 1 and 100)
);

comment on table public.stripe_events is
  'Stripe webhook events seen by src/app/api/billing/webhook, for idempotency. Service role only.';

alter table public.stripe_events enable row level security;
revoke all on table public.stripe_events from anon, authenticated;
grant all on table public.stripe_events to service_role;

-- ---- 4. seller_funnel_events ------------------------------------------------------

create table if not exists public.seller_funnel_events (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.profiles (id) on delete cascade,
  -- Who did it: the owner, or a teammate looking at the owner's store. Null
  -- for events Stripe produced (an upgrade confirmed by the webhook).
  actor_id    uuid references public.profiles (id) on delete set null,
  kind        text not null,
  source      text,
  plan        text,
  billing_interval text,
  created_at  timestamptz not null default now(),

  -- MIRROR of FUNNEL_EVENT_KINDS in src/lib/billing/funnel.ts.
  constraint seller_funnel_events_kind_check
    check (kind in ('pricing_viewed', 'limit_hit', 'checkout_started', 'portal_opened',
                    'upgraded', 'plan_changed', 'downgraded', 'payment_failed')),
  -- MIRROR of PRICING_SOURCES in src/lib/billing/paths.ts.
  constraint seller_funnel_events_source_check
    check (source is null or source in ('sidebar', 'profile_menu', 'settings', 'storefront_limit',
                                        'team_limit', 'order_nudge', 'analytics_nudge', 'email',
                                        'notification', 'checkout_cancel')),
  constraint seller_funnel_events_plan_check
    check (plan is null or plan in ('free', 'starter', 'pro')),
  constraint seller_funnel_events_interval_check
    check (billing_interval is null or billing_interval in ('month', 'year'))
);

create index if not exists seller_funnel_events_kind_time_idx
  on public.seller_funnel_events (kind, created_at);

comment on table public.seller_funnel_events is
  'What happens around the pricing modal, per account, for conversion analysis. Written by the server only (src/lib/billing/funnel.ts). Kept 13 months.';

alter table public.seller_funnel_events enable row level security;
revoke all on table public.seller_funnel_events from anon, authenticated;
grant all on table public.seller_funnel_events to service_role;

-- ---- 5. Plan limits ----------------------------------------------------------------

-- THE SWITCH. Limits are only enforced once a bigger plan can actually be
-- bought: a limit whose only way out is an "upgrade" button marked Soon is a
-- dead end, not an upsell. One row, one flag, read by BOTH the app's check
-- (src/lib/billing/limits.ts) and the trigger below, so the two can never
-- disagree. It ships OFF. Turn it on the day Stripe Billing is live:
--   update public.billing_switches set plan_limits_enforced = true;
create table if not exists public.billing_switches (
  -- A single-row table: the primary key can only ever be true.
  id                   boolean primary key default true check (id),
  plan_limits_enforced boolean not null default false,
  updated_at           timestamptz not null default now()
);

insert into public.billing_switches (id) values (true) on conflict (id) do nothing;

comment on table public.billing_switches is
  'Launch switches for seller plans. plan_limits_enforced: whether plan limits refuse creates (off until paid plans can be bought). Service role only.';

alter table public.billing_switches enable row level security;
revoke all on table public.billing_switches from anon, authenticated;
grant all on table public.billing_switches to service_role;

-- MIRROR of PLANS[..].limits in src/lib/billing/plans.ts. Null = unlimited.
-- Pure data, so any role may read it: the same numbers are on the pricing page.
create or replace function public.plan_limit(p_plan text, p_key text)
returns integer
language sql immutable
set search_path = ''
as $$
  select case p_plan
    when 'free'    then case p_key when 'storefronts' then 3  when 'teamSeats' then 2 end
    when 'starter' then case p_key when 'storefronts' then 10 when 'teamSeats' then 5 end
    when 'pro'     then null
  end
$$;

revoke execute on function public.plan_limit(text, text) from public, anon;
grant execute on function public.plan_limit(text, text) to authenticated, service_role;

comment on function public.plan_limit(text, text) is
  'The cap a plan puts on storefronts or teamSeats; null = unlimited. Mirror of src/lib/billing/plans.ts.';

-- The plan in force for an account right now: its paid plan until paid_until,
-- Free otherwise. The SQL twin of effectivePlan() in
-- src/lib/billing/entitlement.ts. SECURITY DEFINER because seller_billing has
-- no client policy; callable by the service role only (the limit triggers
-- below run as their owner, so they reach it without a grant).
create or replace function public.account_plan(p_owner uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select b.plan
       from public.seller_billing b
      where b.owner_id = p_owner
        and b.plan is not null
        and b.paid_until > now()),
    'free')
$$;

revoke execute on function public.account_plan(uuid) from public, anon, authenticated;
grant execute on function public.account_plan(uuid) to service_role;

comment on function public.account_plan(uuid) is
  'free | starter | pro: the plan an account is on now (paid plan until paid_until, else free). Service role only.';

-- THE LIMIT, enforced on insert (and when a row moves into an account, or a
-- revoked seat is revived). The server actions check first and answer
-- with an upgrade prompt (src/lib/billing/limits.ts); this is the same rule
-- held by the database, so a client that skips the action and inserts over
-- REST meets it anyway.
--
-- Only a signed-in CLIENT is limited (auth.role() = 'authenticated'). The
-- service role (the seed script, the e2e fixtures, support) and direct SQL
-- are trusted, the same line the team_members guard draws. current_user is
-- useless for this inside a SECURITY DEFINER function (it is the owner), and
-- auth.role() reads the request's JWT claim, which a definer does not change.
--
-- SECURITY DEFINER so the count sees every row of the account whatever the
-- inserting member's RLS allows, and so account_plan() needs no client grant.
-- The advisory lock serialises inserts for one account and key, so two
-- simultaneous inserts cannot both see "one below the limit".
--
-- Raises SQLSTATE 23514 (check_violation) with message
-- 'plan_limit_reached:<key>', which the actions recognise.
create or replace function public.enforce_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limit_key text := tg_argv[0];
  owner uuid;
  cap integer;
  used integer;
begin
  -- The owner's own seat is always there (it is seeded at signup); only a seat
  -- for someone else, and only one that is live (invited or active), takes
  -- one of the plan's. Decided first: it needs no claims at all. (Nested, not
  -- ANDed: plpgsql does not short-circuit, and a storefront row has no role.)
  if tg_table_name = 'team_members' then
    if new.role = 'owner' or new.status not in ('invited', 'active') then
      return new;
    end if;
  end if;

  if coalesce((select auth.role()), '') <> 'authenticated' then
    return new;
  end if;

  -- Off until paid plans can be bought (see billing_switches above).
  if not coalesce((select s.plan_limits_enforced from public.billing_switches s where s.id), false) then
    return new;
  end if;

  if tg_table_name = 'storefronts' then
    -- An UPDATE only reaches here when owner_id changed (see the trigger):
    -- a storefront moved INTO an account counts against that account.
    if tg_op = 'UPDATE' then
      if new.owner_id is not distinct from old.owner_id then
        return new;
      end if;
    end if;
    owner := new.owner_id;
  elsif tg_table_name = 'team_members' then
    -- Re-activating a revoked row adds a seat, and so does moving a live row
    -- to another account; editing a live row in place does not.
    -- (Nested, not ANDed: OLD only exists for an UPDATE.)
    if tg_op = 'UPDATE' then
      if old.status in ('invited', 'active')
         and new.account_owner_id is not distinct from old.account_owner_id then
        return new;
      end if;
    end if;
    owner := new.account_owner_id;
  else
    raise exception 'enforce_plan_limit: unsupported table %', tg_table_name;
  end if;

  cap := public.plan_limit(public.account_plan(owner), limit_key);
  if cap is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('plan_limit:' || limit_key || ':' || owner::text, 0));

  if tg_table_name = 'storefronts' then
    select count(*) into used from public.storefronts s where s.owner_id = owner;
  else
    select count(*) into used
      from public.team_members tm
     where tm.account_owner_id = owner
       and tm.status in ('invited', 'active');
  end if;

  if used >= cap then
    raise exception 'plan_limit_reached:%', limit_key using errcode = '23514';
  end if;
  return new;
end
$$;

revoke execute on function public.enforce_plan_limit() from public, anon, authenticated;

-- Insert, and any change of the owning account: a row moved from one account
-- into another is a new one for the account it lands in.
drop trigger if exists storefronts_plan_limit on public.storefronts;
create trigger storefronts_plan_limit
  before insert or update of owner_id on public.storefronts
  for each row execute function public.enforce_plan_limit('storefronts');

drop trigger if exists team_members_plan_limit on public.team_members;
create trigger team_members_plan_limit
  before insert or update of status, account_owner_id on public.team_members
  for each row execute function public.enforce_plan_limit('teamSeats');

-- ---- 6. Applying a Stripe snapshot ----------------------------------------------

-- The webhook's one write. Upserts the account's row from a subscription it
-- has just FETCHED from Stripe (never from the event payload, which can arrive
-- out of order), and only if that fetch is at least as new as the one the row
-- already holds. Returns the plan and paid_until the row had before, so the
-- caller can tell an upgrade from a renewal, and whether it applied at all.
--
-- Plain SECURITY INVOKER: only the service role may execute it, and the
-- service role already bypasses RLS.
create or replace function public.billing_apply_snapshot(
  p_owner uuid,
  p_customer text,
  p_subscription text,
  p_plan text,
  p_interval text,
  p_status text,
  p_price_cents integer,
  p_currency text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_canceled_at timestamptz,
  p_paid_until timestamptz,
  p_livemode boolean,
  p_synced_at timestamptz
)
returns table (applied boolean, previous_plan text, previous_paid_until timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  before_row public.seller_billing%rowtype;
begin
  select * into before_row
    from public.seller_billing
   where owner_id = p_owner
     for update;

  if found and before_row.stripe_synced_at is not null and before_row.stripe_synced_at > p_synced_at then
    return query select false, before_row.plan, before_row.paid_until;
    return;
  end if;

  insert into public.seller_billing as b (
    owner_id, stripe_customer_id, stripe_subscription_id, plan, billing_interval, status,
    price_cents, currency, current_period_end, cancel_at_period_end, canceled_at,
    paid_until, livemode, stripe_synced_at, updated_at
  ) values (
    p_owner, p_customer, p_subscription, p_plan, p_interval, p_status,
    p_price_cents, p_currency, p_current_period_end, coalesce(p_cancel_at_period_end, false), p_canceled_at,
    p_paid_until, coalesce(p_livemode, false), p_synced_at, now()
  )
  on conflict (owner_id) do update set
    stripe_customer_id     = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    plan                   = excluded.plan,
    billing_interval       = excluded.billing_interval,
    status                 = excluded.status,
    price_cents            = excluded.price_cents,
    currency               = excluded.currency,
    current_period_end     = excluded.current_period_end,
    cancel_at_period_end   = excluded.cancel_at_period_end,
    canceled_at            = excluded.canceled_at,
    paid_until             = excluded.paid_until,
    livemode               = excluded.livemode,
    stripe_synced_at       = excluded.stripe_synced_at,
    updated_at             = now();

  return query select true, before_row.plan, before_row.paid_until;
end
$$;

revoke execute on function public.billing_apply_snapshot(
  uuid, text, text, text, text, text, integer, text, timestamptz, boolean, timestamptz,
  timestamptz, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_apply_snapshot(
  uuid, text, text, text, text, text, integer, text, timestamptz, boolean, timestamptz,
  timestamptz, boolean, timestamptz) to service_role;

comment on function public.billing_apply_snapshot(
  uuid, text, text, text, text, text, integer, text, timestamptz, boolean, timestamptz,
  timestamptz, boolean, timestamptz) is
  'Webhook write: upsert an account''s billing row from a subscription just fetched from Stripe, only if newer than the stored snapshot. Service role only.';

-- ---- 7. Sales for the calculator ----------------------------------------------------

-- The last 30 days of an account's paid EUR sales: the item subtotal (what the
-- fee is charged on), how many sales, and the fees charged. Service role only:
-- its one caller (the pricing modal's loader) has already checked that the
-- signed-in user may read the store it names, and a client has no reason to
-- probe other stores' figures through an arbitrary seller id.
create or replace function public.billing_sales_summary(p_seller_id uuid, p_now timestamptz default now())
returns table (subtotal_cents bigint, sales integer, fees_cents bigint)
language sql stable
set search_path = ''
as $$
  select
    coalesce(sum(o.product_price_cents::bigint * o.quantity), 0)::bigint,
    count(*)::integer,
    coalesce(sum(o.platform_fee_cents), 0)::bigint
  from public.orders o
  where o.seller_id = p_seller_id
    and o.status = 'paid'
    and o.currency = 'EUR'
    and o.created_at >= p_now - interval '30 days'
    and o.created_at <= p_now
$$;

revoke execute on function public.billing_sales_summary(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_sales_summary(uuid, timestamptz) to service_role;

comment on function public.billing_sales_summary(uuid, timestamptz) is
  'Last 30 days of an account''s paid EUR sales: item subtotal, count, fees. Service role only; the caller authorises the account first.';

-- ---- 8. Permission mirror ------------------------------------------------------------
-- MIRROR of src/lib/team/permissions.ts. Edit BOTH together. 'billing.manage'
-- is the owner's alone: a plan is a contract the owner pays for. CREATE OR
-- REPLACE keeps the function's existing grants, so none are restated here.
create or replace function public.team_role_can(r public.team_role, action text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when r is null then false
    when r = 'owner'  then action in ('team.read','team.invite','team.change_role','team.revoke','store.read','products.write','storefront.write','orders.fulfil','billing.manage')
    when r = 'editor' then action in ('team.read','team.invite','store.read','products.write','storefront.write','orders.fulfil')
    when r = 'viewer' then action in ('team.read','store.read')
    else false
  end
$$;

-- ---- 9. Notification type --------------------------------------------------------------
-- MIRROR of NOTIFICATION_TYPES in lib/notifications/types.ts. A type present in
-- one list and not the other makes createNotification fail SILENTLY.

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type = any (array['team','payment','stock','order','system','security','policy','billing']));

comment on constraint notifications_type_check on public.notifications is
  'Mirror of NOTIFICATION_TYPES in lib/notifications/types.ts. Update both together: a type present in one and not the other fails the insert silently.';

notify pgrst, 'reload schema';

-- ===== (applied) two_factor_hardening ========================================
-- supabase/migrations/20260930_two_factor_hardening.sql, replayed verbatim.
-- In prod: confirmed 2026-10-07 by reading the live schema (mfa_verify_intents,
-- mfa_approval_opt_ins and mfa_access_token_gate exist). No migration version
-- is recorded.
-- =============================================================================
-- Two-factor hardening (security sweep of 2026-09-30)
-- =============================================================================
-- 1. A second factor can only be completed THROUGH THE APP.
--    GoTrue's own verify endpoint is limited per IP address only (15 a minute)
--    and never locks an account, so anyone holding a password could guess
--    six-digit codes against it directly, from as many addresses as they
--    liked, past every budget and alert the app keeps (proven on production
--    with a throwaway account: twelve wrong codes, then the right one, aal2).
--    The same endpoint lets a stolen signed-in session switch on a factor of
--    its own without the step-up the app asks for.
--
--    The fix: GoTrue's Custom Access Token hook (available on every plan) runs
--    INSIDE the verify transaction. For a second-factor token it now demands a
--    single-use "intent" that only the app writes (service role), just before
--    it verifies, for that exact account and session. No intent, no token, and
--    GoTrue rolls the whole verify back: the challenge stays open and a new
--    factor stays unverified. A correct guess made outside the app is worth
--    nothing, and nobody can switch on a factor behind the app's back.
--
--    The hook is ENABLED separately in Auth > Hooks (Management API
--    hook_custom_access_token_*), after the app that writes intents is live.
--    Disabling it there is the kill switch.
--
-- 2. Sign-in approval gets number matching (match_code) and an explicit
--    opt-in (mfa_approval_opt_ins): passkey-only accounts no longer get it by
--    default, because an approval can be talked out of someone and a passkey
--    cannot.
--
-- 3. Staff tables require a fully verified (aal2) session. The admin panel
--    now requires 2FA; these rules stop a staff password alone from reading or
--    writing them through the public API.
-- =============================================================================

-- ---- 1. verify intents -------------------------------------------------------
create table if not exists public.mfa_verify_intents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- The session the app is completing a factor for (the token's session_id).
  session_id  uuid not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

comment on table public.mfa_verify_intents is
  'Single-use permissions, written by the app (service role) just before it verifies a second factor, and spent by the custom access token hook. Without one, GoTrue refuses to issue a second-factor token. Service role only.';

create index if not exists mfa_verify_intents_lookup_idx
  on public.mfa_verify_intents (user_id, session_id, expires_at);

alter table public.mfa_verify_intents enable row level security;
revoke all on public.mfa_verify_intents from anon, authenticated;
grant all on public.mfa_verify_intents to service_role;

-- The hook. SECURITY DEFINER so it can spend an intent under RLS without a
-- policy for GoTrue's role; callable by GoTrue only.
create or replace function public.mfa_access_token_gate(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  method  text := event ->> 'authentication_method';
  uid     uuid;
  sid     uuid;
  spent   uuid;
begin
  -- Only tokens that CLAIM a second factor are gated. Password, link, OAuth
  -- and refresh tokens pass straight through, unchanged.
  if method is null or method not in (
    'totp', 'mfa/totp', 'mfa/phone', 'mfa/webauthn', 'mfa/recovery_code'
  ) then
    return jsonb_build_object('claims', event -> 'claims');
  end if;

  begin
    uid := (event ->> 'user_id')::uuid;
    sid := nullif(event -> 'claims' ->> 'session_id', '')::uuid;
  exception when others then
    uid := null;
  end;

  if uid is not null and sid is not null then
    delete from public.mfa_verify_intents
     where id = (
       select i.id
         from public.mfa_verify_intents i
        where i.user_id = uid
          and i.session_id = sid
          and i.expires_at > now()
        order by i.created_at
        limit 1
        for update skip locked
     )
    returning id into spent;
  end if;

  if spent is not null then
    return jsonb_build_object('claims', event -> 'claims');
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Two-factor verification must be completed in Square Share.'
    )
  );
end;
$$;

comment on function public.mfa_access_token_gate(jsonb) is
  'Custom Access Token hook: a second-factor token is issued only against a fresh single-use intent the app wrote for that account and session (mfa_verify_intents). Everything else passes through unchanged.';

revoke all on function public.mfa_access_token_gate(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.mfa_access_token_gate(jsonb) to supabase_auth_admin;
  end if;
end
$$;

-- ---- 2. sign-in approval: number matching and opt-in -------------------------
alter table public.mfa_sign_in_approvals
  add column if not exists match_code smallint
  check (match_code is null or match_code between 10 and 99);

comment on column public.mfa_sign_in_approvals.match_code is
  'The two-digit number the waiting device shows; the approving device must pick it. A wrong pick denies the request.';

create table if not exists public.mfa_approval_opt_ins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.mfa_approval_opt_ins is
  'Accounts that switched sign-in approval ON in Settings > Security (needed where it is off by default: passkey-only accounts). Service role only.';

alter table public.mfa_approval_opt_ins enable row level security;
revoke all on public.mfa_approval_opt_ins from anon, authenticated;
grant all on public.mfa_approval_opt_ins to service_role;

-- ---- 3. staff tables need aal2 -------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'admin_users', 'admin_audit_log', 'admin_user_moderation',
    'admin_notification_prefs', 'admin_push_subscriptions'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists "Staff need two-factor" on public.%I', t);
      execute format(
        'create policy "Staff need two-factor" on public.%I as restrictive for all to authenticated
           using ((select coalesce(auth.jwt() ->> %L, %L)) = %L)
           with check ((select coalesce(auth.jwt() ->> %L, %L)) = %L)',
        t, 'aal', 'aal1', 'aal2', 'aal', 'aal1', 'aal2'
      );
    end if;
  end loop;
end
$$;

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) plan_perks ==================================================
-- supabase/migrations/20261001_plan_perks.sql, replayed verbatim. Applied to
-- prod 2026-09-30 through the Management API (records no schema_migrations
-- row, so nothing in TRIAGE).
-- =============================================================================
-- Plan perks: the plans page's new entry point in the pricing funnel.
--
-- WHY. Paid plans gain the orders CSV export (src/lib/billing/plans.ts,
-- PLANS[..].perks). On Free, the Orders page offers it as a link to the plans
-- page, and the funnel should be able to tell those arrivals apart from every
-- other entry point.
--
-- WHAT THIS CHANGES. One value, 'orders_export', joins the
-- seller_funnel_events source CHECK. MIRROR of PRICING_SOURCES in
-- src/lib/billing/paths.ts: a source missing here makes its funnel insert fail
-- silently (recording is best-effort by contract). Edit both together.
--
-- Apply via the Management API query endpoint or the SQL editor.

alter table public.seller_funnel_events
  drop constraint if exists seller_funnel_events_source_check;

alter table public.seller_funnel_events
  add constraint seller_funnel_events_source_check
    check (source is null or source in ('sidebar', 'profile_menu', 'settings', 'storefront_limit',
                                        'team_limit', 'order_nudge', 'analytics_nudge', 'email',
                                        'notification', 'checkout_cancel', 'orders_export'));

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) product_limits ============================================
-- supabase/migrations/20261002_product_limits.sql, replayed verbatim. Applied
-- to prod 2026-10-01 through the Management API (records no schema_migrations
-- row, so nothing in TRIAGE).
-- =============================================================================
-- Product limits: a plan now caps how many products a store holds.
--
-- WHY. Plans cap storefronts and team seats already (20260930_seller_plans).
-- Products join them: 20 on Free, 60 on Starter, 500 on Pro. The numbers are
-- the owner's and live in src/lib/billing/plans.ts (PLANS[..].limits);
-- plan_limit() below is their SQL mirror.
--
-- WHAT THIS CHANGES.
--   1. plan_limit() learns the 'products' key, and Pro stops being "no cap on
--      anything": it is unlimited on storefronts and seats, capped on products.
--   2. enforce_plan_limit() learns the products table, and a trigger puts it
--      on products for inserts and for a product moved into another account.
--   3. 'product_limit' joins the seller_funnel_events source CHECK (the entry
--      point a refused create sends a seller from).
--
-- WHAT IT DOES NOT CHANGE.
--   - Nothing is deleted, hidden or unpublished. Only CREATING a product is
--     limited: a store already over its cap keeps and sells every product it
--     has, and can still edit them. It cannot add another until it is back
--     under the cap or on a bigger plan.
--   - Nothing is refused until billing_switches.plan_limits_enforced is turned
--     on (it ships OFF). The trigger and the server actions read that one
--     switch, so this migration is inert on the day it is applied.
--   - The service role and direct SQL stay trusted (seed scripts, fixtures,
--     support), as for the other two limits.
--
-- MIRRORS. Edit these together, or the two sides disagree:
--   plan_limit()                       <-> PLANS[..].limits (plans.ts)
--   seller_funnel_events source CHECK  <-> PRICING_SOURCES (billing/paths.ts)
--
-- A multi-row insert (the CSV import) is checked row by row: a BEFORE ROW
-- trigger sees the rows the same statement has already inserted, so a batch
-- that would cross the cap fails at the first row past it and the whole
-- statement rolls back. The import action sizes its batch to the room left
-- (src/lib/products/import-actions.ts), so this is the backstop, not the path.
--
-- Recreating a function re-grants EXECUTE to the API roles (the PostgREST
-- auto-grant trap), so every grant is restated after its function.
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. The caps -----------------------------------------------------------------

create or replace function public.plan_limit(p_plan text, p_key text)
returns integer
language sql immutable
set search_path = ''
as $$
  select case p_plan
    when 'free'    then case p_key when 'storefronts' then 3  when 'teamSeats' then 2 when 'products' then 20  end
    when 'starter' then case p_key when 'storefronts' then 10 when 'teamSeats' then 5 when 'products' then 60  end
    when 'pro'     then case p_key                                                    when 'products' then 500 end
  end
$$;

revoke execute on function public.plan_limit(text, text) from public, anon;
grant execute on function public.plan_limit(text, text) to authenticated, service_role;

comment on function public.plan_limit(text, text) is
  'The cap a plan puts on storefronts, teamSeats or products; null = unlimited. Mirror of src/lib/billing/plans.ts.';

-- ---- 2. The trigger function, now for products too ------------------------------

-- Unchanged for storefronts and team seats (see 20260930_seller_plans for the
-- reasoning on each line); the products branch follows the storefronts one.
create or replace function public.enforce_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limit_key text := tg_argv[0];
  owner uuid;
  cap integer;
  used integer;
begin
  -- The owner's own seat is always there (it is seeded at signup); only a seat
  -- for someone else, and only one that is live (invited or active), takes
  -- one of the plan's. Decided first: it needs no claims at all. (Nested, not
  -- ANDed: plpgsql does not short-circuit, and other tables have no role.)
  if tg_table_name = 'team_members' then
    if new.role = 'owner' or new.status not in ('invited', 'active') then
      return new;
    end if;
  end if;

  if coalesce((select auth.role()), '') <> 'authenticated' then
    return new;
  end if;

  -- Off until paid plans can be bought (see billing_switches).
  if not coalesce((select s.plan_limits_enforced from public.billing_switches s where s.id), false) then
    return new;
  end if;

  if tg_table_name in ('storefronts', 'products') then
    -- An UPDATE only reaches here when owner_id changed (see the triggers):
    -- a row moved INTO an account counts against that account.
    if tg_op = 'UPDATE' then
      if new.owner_id is not distinct from old.owner_id then
        return new;
      end if;
    end if;
    owner := new.owner_id;
  elsif tg_table_name = 'team_members' then
    -- Re-activating a revoked row adds a seat, and so does moving a live row
    -- to another account; editing a live row in place does not.
    -- (Nested, not ANDed: OLD only exists for an UPDATE.)
    if tg_op = 'UPDATE' then
      if old.status in ('invited', 'active')
         and new.account_owner_id is not distinct from old.account_owner_id then
        return new;
      end if;
    end if;
    owner := new.account_owner_id;
  else
    raise exception 'enforce_plan_limit: unsupported table %', tg_table_name;
  end if;

  cap := public.plan_limit(public.account_plan(owner), limit_key);
  if cap is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('plan_limit:' || limit_key || ':' || owner::text, 0));

  if tg_table_name = 'storefronts' then
    select count(*) into used from public.storefronts s where s.owner_id = owner;
  elsif tg_table_name = 'products' then
    -- Every product counts, whatever its status: a draft takes a place.
    select count(*) into used from public.products p where p.owner_id = owner;
  else
    select count(*) into used
      from public.team_members tm
     where tm.account_owner_id = owner
       and tm.status in ('invited', 'active');
  end if;

  if used >= cap then
    raise exception 'plan_limit_reached:%', limit_key using errcode = '23514';
  end if;
  return new;
end
$$;

revoke execute on function public.enforce_plan_limit() from public, anon, authenticated;

-- Insert, and any change of the owning account: a product moved from one
-- account into another is a new one for the account it lands in.
drop trigger if exists products_plan_limit on public.products;
create trigger products_plan_limit
  before insert or update of owner_id on public.products
  for each row execute function public.enforce_plan_limit('products');

-- ---- 3. The funnel's entry points ------------------------------------------------

alter table public.seller_funnel_events
  drop constraint if exists seller_funnel_events_source_check;

alter table public.seller_funnel_events
  add constraint seller_funnel_events_source_check
    check (source is null or source in ('sidebar', 'profile_menu', 'settings', 'storefront_limit',
                                        'team_limit', 'product_limit', 'order_nudge',
                                        'analytics_nudge', 'email', 'notification',
                                        'checkout_cancel', 'orders_export'));

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) order_tracking_carrier ======================================
-- supabase/migrations/20261001_order_tracking_carrier.sql, replayed verbatim.
-- In prod: confirmed 2026-10-07 by reading the live schema
-- (orders.tracking_carrier and the three-argument order_mark_shipped exist).
-- No migration version is recorded.
-- =============================================================================
-- Order tracking carrier: who is carrying the parcel, so a buyer can follow it.
--
-- WHY. A shipped order carried a tracking number and nothing else. A buyer was
-- handed "RR123456789IE" and left to guess which carrier's site to paste it
-- into. Naming the carrier lets the order page offer a link straight to that
-- parcel.
--
-- COLUMN
--   tracking_carrier   The carrier's id from CARRIER_IDS in
--                      src/types/order-view.ts (e.g. 'dhl', 'an-post'). Null =
--                      no carrier named. Only ever set beside a tracking number.
--
-- STILL NOT A LINK. 20260927_order_fulfilment keeps the tracking number to
-- reference-code characters because it is shown to a buyer on the seller's
-- behalf. That holds: no URL is stored and no seller types one. The link is
-- BUILT by the app (src/lib/orders/carriers.ts) from the carrier's own fixed
-- https tracking page plus the encoded number.
--
-- ONE LIST, NOT TWO. The CHECK below holds the SHAPE of an id, not the list of
-- carriers. The list lives in the app alone, so adding a carrier is one edit
-- and cannot leave a database list behind it (the notification-type trap). An
-- id the app does not know reads as "no carrier" (parseCarrier), and the
-- server action refuses to write one (carrierSchema).
--
-- THE FUNCTION. order_mark_shipped gains a third argument, p_carrier. Changing
-- an argument list makes a NEW function, so the two-argument one is dropped
-- first: left behind, it would be a second way to ship an order that knows
-- nothing about the carrier. Every gate is restated unchanged (two-factor
-- session, owner or orders.fulfil, 'not_found' for any refusal), and the
-- grants are set again explicitly because a new function is auto-granted to
-- anon.
--
-- DEPLOY ORDER: this migration FIRST, then the app. The released app calls
-- order_mark_shipped with its two named arguments, which the new function
-- still answers (p_carrier defaults to null). The new app selects
-- orders.tracking_carrier on every order read, which fails until this has run.
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. Column -----------------------------------------------------------------

alter table public.orders
  add column tracking_carrier text;

alter table public.orders
  add constraint orders_tracking_carrier_shape
    check (tracking_carrier is null or tracking_carrier ~ '^[a-z0-9-]{2,24}$'),
  add constraint orders_tracking_carrier_needs_number
    check (tracking_carrier is null or tracking_number is not null);

comment on column public.orders.tracking_carrier is
  'Optional carrier id (CARRIER_IDS in src/types/order-view.ts), only beside a tracking number. An id, never a URL: the tracking link is built by the app from the carrier''s fixed tracking page.';

-- ---- 2. Marking an order shipped -------------------------------------------------
-- As 20260927_order_fulfilment, plus the carrier. Results are unchanged:
--
--   'shipped'           unfulfilled -> shipped, stamped now, tracking stored
--   'tracking_updated'  already shipped; the tracking number or carrier changed
--   'unchanged'         already shipped with this exact number and carrier
--   'not_shippable'     not paid (pending, refunded, disputed), or nothing ships
--   'not_found'         no such order, or not yours to ship
--
-- A carrier given without a tracking number is dropped, not refused: it says
-- where a number is followed, and there is no number.

drop function if exists public.order_mark_shipped(uuid, text);

create function public.order_mark_shipped(
  p_order_id uuid,
  p_tracking_number text default null,
  p_carrier text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  tracking text := nullif(btrim(coalesce(p_tracking_number, '')), '');
  carrier text := nullif(btrim(coalesce(p_carrier, '')), '');
begin
  if not public.mfa_session_ok() then
    return 'not_found';
  end if;

  if tracking is null then
    carrier := null;
  end if;

  select * into target
    from public.orders
   where id = p_order_id
     for update;

  if not found
     or not (
       target.seller_id = (select auth.uid())
       or public.team_role_can(public.team_actor_role(target.seller_id), 'orders.fulfil')
     ) then
    return 'not_found';
  end if;

  if target.status <> 'paid' or target.fulfilment_status = 'not_required' then
    return 'not_shippable';
  end if;

  if target.fulfilment_status = 'shipped' then
    if tracking is not distinct from target.tracking_number
       and carrier is not distinct from target.tracking_carrier then
      return 'unchanged';
    end if;
    update public.orders
       set tracking_number = tracking,
           tracking_carrier = carrier
     where id = target.id;
    return 'tracking_updated';
  end if;

  update public.orders
     set fulfilment_status = 'shipped',
         shipped_at = now(),
         tracking_number = tracking,
         tracking_carrier = carrier
   where id = target.id;
  return 'shipped';
end
$$;

-- A new function is auto-granted to anon (the PostgREST auto-grant trap), so
-- the grant is set explicitly both ways.
revoke execute on function public.order_mark_shipped(uuid, text, text) from public, anon;
grant execute on function public.order_mark_shipped(uuid, text, text) to authenticated, service_role;

comment on function public.order_mark_shipped(uuid, text, text) is
  'Seller marks a paid order shipped (optionally with a tracking number and its carrier), or changes them on a shipped one. Self-gated: 2FA session bar, owner or orders.fulfil. Returns shipped | tracking_updated | unchanged | not_shippable | not_found.';

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) plan_cancellations ==========================================
-- supabase/migrations/20261003_plan_cancellations.sql, replayed verbatim. Applied
-- to prod 2026-10-03 through the Management API (records no
-- schema_migrations row, so nothing in TRIAGE).
-- =============================================================================
-- Plan cancellations: what a seller tells us when they cancel a paid plan.
--
-- WHY. Cancelling used to happen on Stripe's hosted portal, so all we ever
-- learned was that a plan ended. It now happens in the app (cancelPlan in
-- src/lib/billing/actions.ts), which asks why, optionally, and records the
-- answer here for the admin panel's Plans section (the SQ-admin repo reads it
-- with the service role).
--
-- WHAT THIS ADDS. One table, plan_cancellations: one row per cancellation,
-- with the plan it ends, when it ends, the reason (optional), a note
-- (optional), and when the seller changed their mind (resumed_at).
--
-- PRIVACY.
--   - Service role only: RLS on with no policies, and no grant to the API
--     roles. Sellers never read it back; staff read it through the admin.
--   - Deleted with the account (on delete cascade), like seller_billing and
--     seller_funnel_events, and included in the seller's data export.
--   - Kept 13 months, like the funnel: long enough to see a year's churn.
--
-- MIRROR. reason CHECK <-> CANCELLATION_REASONS in
-- src/lib/billing/cancellation.ts (Stripe's cancellation_details codes plus
-- 'temporary'). A reason missing here makes the row fail to record.
--
-- Apply via the Management API query endpoint or the SQL editor.

create table if not exists public.plan_cancellations (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.profiles (id) on delete cascade,
  plan              text not null check (plan in ('starter', 'pro')),
  billing_interval  text check (billing_interval in ('month', 'year')),
  reason            text check (reason in ('too_expensive', 'unused', 'missing_features',
                                           'switched_service', 'temporary', 'other')),
  detail            text check (char_length(detail) <= 1000),
  -- When the paid period ends and the store moves to Free.
  ends_at           timestamptz not null,
  created_at        timestamptz not null default now(),
  -- Set when the seller pressed "Keep my plan" before ends_at.
  resumed_at        timestamptz
);

comment on table public.plan_cancellations is
  'A seller cancelling a paid plan, with the optional reason and note. Written by the store app, read by the admin panel. Service role only.';

-- One open cancellation per plan end: a double submit is dropped as already
-- recorded. A resume closes the row, so cancelling again records a new one.
create unique index if not exists plan_cancellations_open_idx
  on public.plan_cancellations (owner_id, ends_at)
  where resumed_at is null;

-- The admin lists them newest first.
create index if not exists plan_cancellations_created_idx
  on public.plan_cancellations (created_at desc);

alter table public.plan_cancellations enable row level security;
revoke all on table public.plan_cancellations from public, anon, authenticated;
grant all on table public.plan_cancellations to service_role;

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) discounts ===================================================
-- supabase/migrations/20261004_discounts.sql, replayed verbatim. In prod:
-- confirmed 2026-10-07 by reading the live schema (discounts,
-- product_price_history, orders.discount_*, discount_performance and the
-- discount-aware billing_sales_summary exist). No migration version is recorded.
-- =============================================================================
-- Discounts: automatic sales and discount codes, and what they sold.
--
-- WHY. A seller had one lever on price: the price itself. Discounts are the
-- other one sellers expect: a sale everyone sees ("20% off this weekend"), or
-- a code they hand out where they post ("SUMMER10 on Instagram"). Each code
-- carries the channel it was shared on, so the seller can see which channels
-- actually bring in orders.
--
-- WHAT THIS ADDS
--   discounts              One row per sale or code. Never deleted by the app:
--                          "delete" archives it (archived_at), which keeps its
--                          orders' attribution and the sale history below.
--   product_price_history  Every price a product has had, and since when.
--                          Fed by a trigger on products; read only by the
--                          server (service role).
--   orders.discount_*      What a discount did to one order (snapshotted like
--                          the rest of the order).
--   discount_performance   Orders, revenue and money given per discount.
--   billing_sales_summary  Now subtracts discounts from the item subtotal.
--
-- THE EU PRICE RULE (Price Indication Directive 98/6/EC art. 6a). A shop that
-- announces a price reduction must show, as the earlier price, the LOWEST
-- price it charged in the 30 days before the reduction started. So the app
-- shows a "was" price only when product_price_history covers those 30 days
-- (src/lib/discounts/prior-price.ts), and a sale's history must stay true:
--   - an automatic sale cannot be backdated, and once it has started its
--     terms and start are frozen (guard_discount_rules below);
--   - it cannot be paused (sales are always enabled): it ends, and archiving
--     a running sale ends it now;
--   - archived sales are kept, because an earlier sale lowers the price a
--     later one may be compared against.
--
-- WHO WRITES WHAT
--   discounts: the seller and their team, through the app's server actions
--     (src/lib/discounts/actions.ts) under RLS. Owners and editors write
--     (products.write: a discount is pricing power an editor already has);
--     anyone on the team reads (store.read). No delete policy at all.
--   orders.discount_*: the service-role order writer (src/lib/orders/record.ts).
--   product_price_history: the trigger only.
--
-- MIRRORS. The CHECKs below mirror src/types/discount.ts (limits) and
-- src/lib/validation/discounts.ts. Edit them together.
--
-- DEPLOY ORDER. After 20261001_order_tracking_carrier and
-- 20261003_plan_cancellations, and BEFORE the app that reads it: the app
-- selects the new orders columns on every order read, which fails until this
-- has run.
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. discounts ----------------------------------------------------------------

create table if not exists public.discounts (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users (id) on delete cascade,
  -- 'automatic': a sale every buyer gets, no code. 'code': a buyer types it.
  kind              text not null check (kind in ('automatic', 'code')),
  -- Upper case, as normalised by the app (src/lib/discounts/code.ts).
  code              text,
  -- Where a code was shared ("Instagram"). The seller's own words, shown only
  -- to the seller.
  share_channel     text,
  value_type        text not null check (value_type in ('percent', 'amount')),
  percent_off       smallint,
  amount_off_cents  integer,
  currency          text,
  applies_to        text not null default 'all' check (applies_to in ('all', 'products')),
  product_ids       uuid[] not null default '{}',
  starts_at         timestamptz not null default now(),
  ends_at           timestamptz,
  -- Codes only: how many orders may use it, counted from orders.
  usage_limit       integer,
  -- Codes only can be switched off; a sale ends instead (see THE EU PRICE RULE).
  enabled           boolean not null default true,
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint discounts_code_matches_kind check ((kind = 'code') = (code is not null)),
  constraint discounts_code_shape check (code is null or code ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$'),
  constraint discounts_share_channel check (
    share_channel is null or (kind = 'code' and char_length(share_channel) between 1 and 40)
  ),
  constraint discounts_value check (
    (value_type = 'percent'
      and percent_off between 1 and 90
      and amount_off_cents is null and currency is null)
    or (value_type = 'amount'
      and percent_off is null
      and amount_off_cents between 1 and 100000000
      and currency in ('EUR', 'USD'))
  ),
  constraint discounts_products check (
    (applies_to = 'all' and cardinality(product_ids) = 0)
    or (applies_to = 'products' and cardinality(product_ids) between 1 and 500)
  ),
  -- >= rather than >: archiving a sale clamps its end to now, which can equal
  -- a start set in the same instant.
  constraint discounts_window check (ends_at is null or ends_at >= starts_at),
  constraint discounts_usage_limit check (
    usage_limit is null or (kind = 'code' and usage_limit between 1 and 1000000)
  ),
  constraint discounts_sales_always_on check (kind = 'code' or enabled)
);

comment on table public.discounts is
  'Automatic sales and discount codes. Written by the seller and their team through the app (RLS: store.read reads, products.write writes, no deletes: the app archives). Read by the checkout through the service role.';
comment on column public.discounts.product_ids is
  'The products it covers when applies_to = products. Matched only against the owner''s own products, so a stray id is inert.';
comment on column public.discounts.archived_at is
  'The app''s "delete". Archived discounts stop applying but keep their orders'' attribution and the sale history the 30-day price rule reads.';

-- One live code per store (archived codes free the name again).
create unique index if not exists discounts_live_code_idx
  on public.discounts (owner_id, code)
  where code is not null and archived_at is null;

-- The checkout's read: this store's sales, or one code.
create index if not exists discounts_owner_kind_idx
  on public.discounts (owner_id, kind);

drop trigger if exists discounts_set_updated_at on public.discounts;
create trigger discounts_set_updated_at
  before update on public.discounts
  for each row execute function public.set_updated_at();

alter table public.discounts enable row level security;
revoke all on table public.discounts from public, anon, authenticated;
grant select, insert on table public.discounts to authenticated;
-- Never id, owner_id, kind or created_at: a discount cannot move to another
-- store or turn from a code into a sale.
grant update (code, share_channel, value_type, percent_off, amount_off_cents, currency,
              applies_to, product_ids, starts_at, ends_at, usage_limit, enabled, archived_at)
  on table public.discounts to authenticated;
grant all on table public.discounts to service_role;

drop policy if exists discounts_select_member on public.discounts;
create policy discounts_select_member on public.discounts
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'store.read')
  );

drop policy if exists discounts_insert_writer on public.discounts;
create policy discounts_insert_writer on public.discounts
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'products.write')
  );

drop policy if exists discounts_update_writer on public.discounts;
create policy discounts_update_writer on public.discounts
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'products.write')
  )
  with check (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'products.write')
  );

-- The two-factor rule every seller table carries (20260923).
drop policy if exists "Require two-factor when enrolled" on public.discounts;
create policy "Require two-factor when enrolled" on public.discounts
  as restrictive for all to authenticated
  using ((select public.mfa_session_ok()))
  with check ((select public.mfa_session_ok()));

-- ---- 2. Keeping a sale's history true ----------------------------------------------
-- INVOKER on purpose, like guard_moderation_columns: as a definer it would
-- always see its owner and trust everyone. The service role (the app's own
-- server-side writes, and staff) passes. The five minutes are clock slack
-- between the app server and the database, nothing more.

create or replace function public.guard_discount_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A sale starts now or later: when it began is what the 30-day rule reads.
    if new.kind = 'automatic' and new.starts_at < now() - interval '5 minutes' then
      raise exception 'discount_started' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id or new.kind is distinct from old.kind then
    raise exception 'discount_immutable' using errcode = '42501';
  end if;

  if new.kind <> 'automatic' then
    return new;
  end if;

  if new.starts_at is distinct from old.starts_at and new.starts_at < now() - interval '5 minutes' then
    raise exception 'discount_started' using errcode = '42501';
  end if;

  if old.starts_at <= now() then
    -- Started: its terms are now part of the price history.
    if new.value_type is distinct from old.value_type
       or new.percent_off is distinct from old.percent_off
       or new.amount_off_cents is distinct from old.amount_off_cents
       or new.currency is distinct from old.currency
       or new.applies_to is distinct from old.applies_to
       or new.product_ids is distinct from old.product_ids
       or new.starts_at is distinct from old.starts_at then
      raise exception 'discount_started' using errcode = '42501';
    end if;
    -- An end can move, but never into the past, and an ended sale stays
    -- ended (running it again is a new sale).
    if new.ends_at is distinct from old.ends_at
       and ((old.ends_at is not null and old.ends_at <= now())
            or (new.ends_at is not null and new.ends_at < now() - interval '5 minutes')) then
      raise exception 'discount_started' using errcode = '42501';
    end if;
    -- Archiving a running sale ends it now.
    if new.archived_at is not null and old.archived_at is null
       and (new.ends_at is null or new.ends_at > now()) then
      new.ends_at := now();
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_discount_rules() from public, anon, authenticated;

comment on function public.guard_discount_rules() is
  'Keeps a sale''s history true for the 30-day price rule: no backdated sales, a started sale''s terms are frozen, its end never moves into the past, archiving a running sale ends it now. Owner and kind never change. Service role passes.';

drop trigger if exists discounts_guard_rules on public.discounts;
create trigger discounts_guard_rules
  before insert or update on public.discounts
  for each row execute function public.guard_discount_rules();

-- ---- 3. product_price_history ------------------------------------------------------

create table if not exists public.product_price_history (
  id           bigint generated always as identity primary key,
  product_id   uuid not null references public.products (id) on delete cascade,
  price_cents  integer not null check (price_cents >= 0),
  currency     text not null check (currency in ('EUR', 'USD')),
  valid_from   timestamptz not null default now()
);

comment on table public.product_price_history is
  'Every price a product has had and since when, for the EU 30-day prior-price rule on sales. Written by a trigger on products, read by the server. Service role only.';

create index if not exists product_price_history_product_idx
  on public.product_price_history (product_id, valid_from);

alter table public.product_price_history enable row level security;
revoke all on table public.product_price_history from public, anon, authenticated;
revoke all on sequence public.product_price_history_id_seq from public, anon, authenticated;
grant all on table public.product_price_history to service_role;

-- DEFINER: it writes a table its callers cannot. Not callable by anyone
-- (execute revoked); triggers fire regardless.
create or replace function public.record_product_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.product_price_history (product_id, price_cents, currency, valid_from)
  values (new.id, new.price_cents, new.currency, now());
  return null;
end;
$$;

revoke execute on function public.record_product_price() from public, anon, authenticated;

drop trigger if exists products_record_price_insert on public.products;
create trigger products_record_price_insert
  after insert on public.products
  for each row execute function public.record_product_price();

-- Only a real change: the product form writes price_cents on every save.
drop trigger if exists products_record_price_update on public.products;
create trigger products_record_price_update
  after update of price_cents, currency on public.products
  for each row
  when (old.price_cents is distinct from new.price_cents or old.currency is distinct from new.currency)
  execute function public.record_product_price();

-- What is known today: the current price, since the product was last saved.
-- Older history does not exist, so a sale on a product saved in the last 30
-- days shows no "was" price until 30 days of history exist.
insert into public.product_price_history (product_id, price_cents, currency, valid_from)
select p.id, p.price_cents, p.currency, p.updated_at
from public.products p
where not exists (
  select 1 from public.product_price_history h where h.product_id = p.id
);

-- ---- 4. orders: what a discount did ---------------------------------------------------

alter table public.orders
  add column if not exists discount_id uuid references public.discounts (id) on delete set null,
  add column if not exists discount_cents integer not null default 0,
  add column if not exists discount_code_id uuid references public.discounts (id) on delete set null,
  add column if not exists discount_code text;

-- Dropped first so the whole file can be run again (ADD CONSTRAINT has no
-- IF NOT EXISTS).
alter table public.orders
  drop constraint if exists orders_discount_cents_range,
  drop constraint if exists orders_discount_code_shape;

alter table public.orders
  add constraint orders_discount_cents_range check (
    discount_cents >= 0 and discount_cents::bigint <= product_price_cents::bigint * quantity
  ),
  add constraint orders_discount_code_shape check (
    discount_code is null or discount_code ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$'
  );

-- Usage limits count a code's orders; the Discounts page credits them.
create index if not exists orders_discount_id_idx
  on public.orders (discount_id) where discount_id is not null;
create index if not exists orders_discount_code_id_idx
  on public.orders (discount_code_id) where discount_code_id is not null;

comment on column public.orders.discount_id is
  'The discount that set this order''s price (a sale, or a code that beat it). Null when none applied.';
comment on column public.orders.discount_cents is
  'How much less than the regular price (product_price_cents x quantity) the items cost. 0 when no discount applied.';
comment on column public.orders.discount_code_id is
  'A valid code the buyer entered, credited to its channel even when a better sale set the price.';
comment on column public.orders.discount_code is
  'That code as the buyer used it, snapshotted like the rest of the order.';
comment on column public.orders.shipping_cents is
  'Delivery''s share of amount_cents. The platform fee is charged on amount_cents minus this, i.e. on the items after discounts.';

-- ---- 5. Sales for the pricing calculator, net of discounts ------------------------------

create or replace function public.billing_sales_summary(p_seller_id uuid, p_now timestamptz default now())
returns table (subtotal_cents bigint, sales integer, fees_cents bigint)
language sql stable
set search_path = ''
as $$
  select
    coalesce(sum(o.product_price_cents::bigint * o.quantity - o.discount_cents), 0)::bigint,
    count(*)::integer,
    coalesce(sum(o.platform_fee_cents), 0)::bigint
  from public.orders o
  where o.seller_id = p_seller_id
    and o.status = 'paid'
    and o.currency = 'EUR'
    and o.created_at >= p_now - interval '30 days'
    and o.created_at <= p_now
$$;

-- Restated: recreating a function re-grants EXECUTE to the API roles.
revoke execute on function public.billing_sales_summary(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_sales_summary(uuid, timestamptz) to service_role;

comment on function public.billing_sales_summary(uuid, timestamptz) is
  'Last 30 days of an account''s paid EUR sales: item subtotal after discounts, count, fees. Service role only; the caller authorises the account first.';

-- ---- 6. What each discount sold ------------------------------------------------------
-- One row per (discount, currency). An order is credited to the code the
-- buyer entered when there was one (that is the channel that brought them),
-- else to the sale that set its price. `uses` counts every order, whatever
-- happened to it later, which is what a usage limit counts; the rest are paid
-- orders only.
--
-- INVOKER, like product_sales_aggregate: the caller passes the active
-- account id it has already checked, and RLS on orders answers nothing for a
-- store the caller cannot read.

create or replace function public.discount_performance(p_seller_id uuid)
returns table (
  discount_id    uuid,
  currency       text,
  uses           integer,
  orders         integer,
  revenue_cents  bigint,
  discount_cents bigint,
  last_order_at  timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(o.discount_code_id, o.discount_id),
    o.currency,
    count(*)::integer,
    (count(*) filter (where o.status = 'paid'))::integer,
    coalesce(sum(o.amount_cents) filter (where o.status = 'paid'), 0)::bigint,
    coalesce(sum(o.discount_cents) filter (where o.status = 'paid'), 0)::bigint,
    max(o.created_at) filter (where o.status = 'paid')
  from public.orders o
  where o.seller_id = p_seller_id
    and coalesce(o.discount_code_id, o.discount_id) is not null
  group by 1, 2
$$;

revoke execute on function public.discount_performance(uuid) from public, anon;
grant execute on function public.discount_performance(uuid) to authenticated, service_role;

comment on function public.discount_performance(uuid) is
  'Per discount and currency: uses (all orders), paid orders, revenue and money given. Credits the entered code first, else the sale. Invoker: RLS on orders scopes it.';

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) buy_button_channel ==========================================
-- supabase/migrations/20261005_buy_button_channel.sql, replayed verbatim. In
-- prod: confirmed 2026-10-07 by reading the live schema (both channel CHECKs
-- accept 'button'). No migration version is recorded.
-- =============================================================================
-- Buy button: a fourth channel, 'button'.
--
-- WHY. A seller who sells one product can now put their OWN button on their
-- own website, pointing at the product's hosted page with ?via=button (see
-- src/lib/storefront/product-page-url.ts). The marker rides from the product
-- page to the checkout to the order, so the visit and the sale are filed under
-- where the buyer came from, and the seller can tell their button's sales from
-- the embed's and from a shared link's ('direct').
--
-- CHANNELS (one vocabulary for both tables, ORDER_CHANNELS in
-- src/types/order-view.ts; edit all three together):
--   embed        the storefront embedded on the seller's own site
--   marketplace  the Square Share marketplace
--   direct       the hosted pages, reached any other way
--   button       the seller's own buy button on their website (new)
--
-- Widening a CHECK is backward compatible: no existing row changes, and the
-- code that writes 'button' must not ship before this does (a signal would be
-- dropped silently and an order write would fail).
--
-- No policy, grant or function changes. The aggregates group by channel
-- generically and need nothing.
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. Orders -------------------------------------------------------------------

alter table public.orders
  drop constraint orders_channel_check;
alter table public.orders
  add constraint orders_channel_check
    check (channel in ('embed', 'marketplace', 'direct', 'button'));

-- ---- 2. Signals ------------------------------------------------------------------

-- Declared inline in 20260830_storefront_signals.sql, so Postgres named it.
-- Dropped without IF EXISTS on purpose: a wrong name must fail loudly rather
-- than leave the old CHECK in place beside the new one.
alter table public.storefront_signals
  drop constraint storefront_signals_channel_check;
alter table public.storefront_signals
  add constraint storefront_signals_channel_check
    check (channel in ('embed', 'marketplace', 'direct', 'button'));

-- =============================================================================
-- ===== (applied) analytics_weekday_products ==================================
-- supabase/migrations/20261007_analytics_weekday_products.sql, replayed verbatim.
-- Applied to prod 2026-10-07 through the Management API query endpoint, which
-- records no migration version. The app tolerates its absence (the weekday card
-- then draws plain bars), so code and migration can ship in either order.
-- =============================================================================
-- =============================================================================
-- analytics_weekday_products: which products sold on which day of the week.
--
-- WHY. The "Sales by weekday" card drew one bar per day: how many sales, and
-- nothing about what they were. A seller reading "Saturday is my best day"
-- wants the next sentence too: best day for WHAT. This returns the same paid
-- sales the card already counts, split by product, so each day's bar can be
-- drawn as a stack.
--
-- A NEW FUNCTION, not a new key on analytics_aggregate. That one is 150 lines
-- feeding every other panel on the page; replacing it to add a seventh panel's
-- breakdown would put all six at risk for it, and would force the code and the
-- migration to ship in lockstep. This is additive: until it exists the app
-- gets an error from the RPC, treats the breakdown as absent, and draws the
-- plain bars it always drew.
--
-- THE TOP FEW ARE NAMED, THE REST ARE ONE ROW. A store with 300 products would
-- otherwise return 2,100 rows to draw seven bars nobody could read. The four
-- best sellers in the range (by number of sales, the unit the card counts)
-- keep their titles; everything else comes back with a null title and is drawn
-- as "Other". Four, because the chart kit gives a stack four distinguishable
-- tones before it has to fold. src/lib/analytics/queries.ts does not need the
-- number: it draws whatever is named.
--
-- Same rules as analytics_aggregate, deliberately, so the stack adds up to the
-- bar it replaces: paid orders only, EUR-only (`currency <> 'USD'`), inclusive
-- ISO date bounds read as UTC, ISO weekday numbers (1 = Monday .. 7). Products
-- are grouped by product_title, the snapshot on the order, exactly as
-- top_products is: a renamed or deleted product keeps the sales it made.
--
-- SECURITY INVOKER, for the reason given in 20260802_analytics_sql_aggregates:
-- the orders RLS policies already decide who may read which seller's rows, so
-- a forged p_seller_id returns nothing.
--
-- Apply via the Management API query endpoint or the SQL editor.
-- =============================================================================

create or replace function public.analytics_weekday_products(
  p_seller_id uuid,
  p_from date default null,
  p_to   date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
with bounds as (
  select
    coalesce(p_from::timestamp at time zone 'UTC', '-infinity'::timestamptz) as from_ts,
    coalesce((p_to + 1)::timestamp at time zone 'UTC', 'infinity'::timestamptz) as to_ts
),
paid as (
  select o.product_title, o.created_at
  from public.orders o, bounds b
  where o.seller_id = p_seller_id
    and o.currency <> 'USD'
    and o.status = 'paid'
    and o.created_at >= b.from_ts
    and o.created_at < b.to_ts
),
ranked as (
  select
    product_title,
    count(*) as sales,
    row_number() over (order by count(*) desc, product_title asc) as place
  from paid
  group by product_title
),
split as (
  select
    extract(isodow from p.created_at at time zone 'UTC')::int as isodow,
    -- Null is "everything outside the named few", never a product's own title.
    case when r.place <= 4 then r.product_title end as title,
    case when r.place <= 4 then r.place end as place,
    count(*) as sales
  from paid p
  join ranked r on r.product_title is not distinct from p.product_title
  group by 1, 2, 3
)
select jsonb_build_object(
  'products', coalesce((
    select jsonb_agg(jsonb_build_object('title', product_title, 'sales', sales) order by place)
    from ranked
    where place <= 4
  ), '[]'::jsonb),
  'weekdays', coalesce((
    select jsonb_agg(
      jsonb_build_object('isodow', isodow, 'title', title, 'sales', sales)
      order by isodow, place nulls last
    )
    from split
  ), '[]'::jsonb)
)
$$;

revoke execute on function public.analytics_weekday_products(uuid, date, date) from public, anon;
grant execute on function public.analytics_weekday_products(uuid, date, date) to authenticated, service_role;

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) order_lifecycle =============================================
-- supabase/migrations/20261008_order_lifecycle.sql, replayed verbatim. Applied
-- to prod 2026-10-08 through the Management API query endpoint, which records
-- no migration version. `pnpm check:schema` is what confirms it is there.
-- =============================================================================
-- Order lifecycle: an order holds its stock from the moment it exists, can be
-- taken back, and remembers what has been said about it.
--
-- WHY. An order could be written and then go one way only: shipped. Four
-- things followed from that.
--
--   1. STOCK WAS TAKEN AFTER THE ORDER, in a second statement. Two buyers
--      racing for the last unit both got an order, and the shortfall was a log
--      line. With a real payment in between, that window is minutes wide.
--   2. NOTHING COULD BE UNDONE. No write turned a paid order into a refunded
--      one. A cancelled or returned order stayed "paid, not sent": in the To
--      ship queue and in revenue for good, and the only way out was "Mark as
--      shipped", which emails the buyer that it is on its way.
--   3. A PAYMENT HAD NOWHERE TO WAIT. Nothing was stored between "pay pressed"
--      and "payment confirmed", so a provider that confirms later had no order
--      to confirm, and a product edited or deleted in between took the sale
--      with it.
--   4. THE NEWS WAS SENT ONCE OR NOT AT ALL. A payment event is delivered at
--      least once, and the second delivery found its order and stopped, which
--      is right for the order and wrong for a "ship this" email the first
--      delivery died before sending.
--
-- WHAT THIS ADDS
--   orders.stock_reserved        Units this order took off the shelf (0 when
--                                the product does not track stock). What a
--                                release or a refund puts back, exactly.
--   orders.pending_expires_at    When an unpaid order gives its stock back.
--   orders.payment_ref           The provider's payment id (a Stripe
--                                PaymentIntent), which is what a refund names.
--   orders.refunded_at/_reason   When the seller took the order back, and why.
--   orders.seller_notified_at    When the seller was told (bell and email).
--   orders.confirmation_sent_at  When the buyer's confirmation was sent.
--
--   order_place            The ONE order writer. Inserts the order and takes
--                          its stock in a single transaction: either both
--                          happen or neither does.
--   order_confirm_paid     pending -> paid, when the provider says so.
--   order_release_pending  An unpaid order is abandoned: its stock goes back.
--   orders_release_expired The same, for every unpaid order past its time.
--   order_refund           The seller's second write on an order (after
--                          order_mark_shipped): paid -> refunded.
--
-- THE STATUS VOCABULARY DOES NOT CHANGE. paid | refunded | disputed | pending
-- already says everything needed. An unpaid order that is abandoned is
-- DELETED rather than kept as "cancelled": no money moved, nobody is owed
-- anything, and a fifth status would be a fifth thing for every list, filter,
-- badge and chart to learn in order to show rows nobody acts on. A paid order
-- the seller cancels before sending it IS a refund, and is recorded as one
-- (refund_reason 'cancelled').
--
-- NO CHECK TIES THE NEW COLUMNS TO status. The demo sales simulator
-- (20260801_demo_sales_sim) inserts refunded and pending rows of its own, with
-- none of these columns set, and a constraint that refused them would stop it.
--
-- MIRRORS. Edit these together, or the two sides disagree:
--   team_role_can()            <-> TEAM_PERMISSIONS (src/lib/team/permissions.ts)
--   orders_refund_reason_check <-> REFUND_REASONS (src/types/order-view.ts)
--
-- DEPLOY ORDER: this migration FIRST, then the app. Everything here is
-- additive, and the released app calls none of it. The new app selects the new
-- columns on every order read, which fails until this has run.
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. Columns ------------------------------------------------------------------

alter table public.orders
  add column if not exists stock_reserved integer not null default 0,
  add column if not exists pending_expires_at timestamptz,
  add column if not exists payment_ref text,
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_reason text,
  add column if not exists seller_notified_at timestamptz,
  add column if not exists confirmation_sent_at timestamptz;

-- Dropped first so the whole file can be run again (ADD CONSTRAINT has no
-- IF NOT EXISTS).
alter table public.orders
  drop constraint if exists orders_stock_reserved_range,
  drop constraint if exists orders_payment_ref_shape,
  drop constraint if exists orders_refund_reason_check;

alter table public.orders
  add constraint orders_stock_reserved_range
    check (stock_reserved between 0 and 100),
  -- A provider's id, never a URL: the same character set as checkout_session_id.
  add constraint orders_payment_ref_shape
    check (payment_ref is null or payment_ref ~ '^[A-Za-z0-9_]{1,255}$'),
  add constraint orders_refund_reason_check
    check (refund_reason is null or refund_reason in ('cancelled', 'returned', 'other'));

-- The sweep reads only the unpaid orders that are waiting on a payment.
create index if not exists orders_pending_expiry_idx
  on public.orders (pending_expires_at)
  where status = 'pending' and pending_expires_at is not null;

comment on column public.orders.stock_reserved is
  'Units this order took off the shelf when it was placed (0 when the product does not track stock). What order_release_pending and order_refund put back; set to 0 once they have.';
comment on column public.orders.pending_expires_at is
  'When an unpaid (pending) order is abandoned and its stock released. Null once paid, and for rows that never waited on a payment.';
comment on column public.orders.payment_ref is
  'The payment provider''s id for the payment (a Stripe PaymentIntent id). What a refund names. Null for orders no provider charged.';
comment on column public.orders.refunded_at is
  'When the seller took the order back (order_refund). Null for an order that stands.';
comment on column public.orders.refund_reason is
  'cancelled (before it was sent) | returned | other. Mirror of REFUND_REASONS in src/types/order-view.ts.';
comment on column public.orders.seller_notified_at is
  'When the seller was told about this order (bell and email). Null = not yet: the order writer tries again on its next call.';
comment on column public.orders.confirmation_sent_at is
  'When the buyer''s order confirmation was actually sent. Null = not sent (yet, or mail is off): the order page says "on its way" only when this is set.';

-- ---- 2. Placing an order ----------------------------------------------------------
-- The one order writer (src/lib/orders/record.ts calls it and nothing else
-- inserts an order). `p_order` is the row as JSON, column names as keys.
--
-- ATOMIC. The insert and the stock update are one transaction: when there are
-- not enough left, the exception below takes the insert back with it, so an
-- order never exists without its stock and stock is never taken without an
-- order. The UPDATE is the lock: two buyers after the last unit queue on the
-- product row, and the second finds `stock_quantity >= quantity` false.
--
-- A key the JSON leaves out is NULL in the record, and an explicit NULL beats a
-- column's DEFAULT, so every NOT NULL column with a default is coalesced to it
-- below rather than left to fail the insert.
--
-- IDEMPOTENT on checkout_session_id. A repeat (a double click, a redelivered
-- payment event) finds the order already there and answers with it, taking
-- nothing a second time.
--
-- Answers { order_id, duplicate, stock_left, low_stock }. Raises
-- 'insufficient_stock' (P0001) when the product tracks stock and has too few.
--
-- INVOKER, and granted to the service role alone: it needs no more than the
-- service role already has, and nobody else may write an order.

create or replace function public.order_place(p_order jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  incoming public.orders%rowtype;
  new_id uuid;
  wanted integer;
  left_after integer;
  threshold integer;
begin
  incoming := jsonb_populate_record(null::public.orders, p_order);

  if incoming.checkout_session_id is null then
    raise exception 'order_place: checkout_session_id is required' using errcode = '22023';
  end if;
  if incoming.status is null or incoming.status not in ('paid', 'pending') then
    raise exception 'order_place: status must be paid or pending' using errcode = '22023';
  end if;
  wanted := coalesce(incoming.quantity, 1);

  insert into public.orders (
    seller_id, product_id, storefront_id, channel, status,
    amount_cents, platform_fee_cents, platform_fee_bps, seller_plan, shipping_cents, currency,
    buyer_email, buyer_locale, product_title, product_price_cents,
    discount_cents, discount_id, discount_code_id, discount_code,
    selected_options, quantity, ship_to, fulfilment_status,
    checkout_session_id, gift_message, supply_consent_at, digital_file_key,
    payment_ref, pending_expires_at
  ) values (
    incoming.seller_id, incoming.product_id, incoming.storefront_id, incoming.channel, incoming.status,
    incoming.amount_cents, coalesce(incoming.platform_fee_cents, 0), incoming.platform_fee_bps,
    incoming.seller_plan, incoming.shipping_cents, coalesce(incoming.currency, 'EUR'),
    incoming.buyer_email, incoming.buyer_locale, incoming.product_title, incoming.product_price_cents,
    coalesce(incoming.discount_cents, 0), incoming.discount_id, incoming.discount_code_id, incoming.discount_code,
    coalesce(incoming.selected_options, '[]'::jsonb), wanted, incoming.ship_to,
    coalesce(incoming.fulfilment_status, 'unfulfilled'),
    incoming.checkout_session_id, incoming.gift_message, incoming.supply_consent_at, incoming.digital_file_key,
    incoming.payment_ref,
    case when incoming.status = 'pending' then incoming.pending_expires_at end
  )
  on conflict (checkout_session_id) do nothing
  returning id into new_id;

  if new_id is null then
    select o.id into new_id
      from public.orders o
     where o.checkout_session_id = incoming.checkout_session_id;
    return jsonb_build_object('order_id', new_id, 'duplicate', true);
  end if;

  update public.products p
     set stock_quantity = p.stock_quantity - wanted,
         updated_at = now()
   where p.id = incoming.product_id
     and p.track_stock
     and p.stock_quantity >= wanted
  returning p.stock_quantity, p.low_stock_threshold into left_after, threshold;

  if found then
    update public.orders set stock_reserved = wanted where id = new_id;
  elsif exists (
    select 1 from public.products p where p.id = incoming.product_id and p.track_stock
  ) then
    -- Rolls the insert above back with it.
    raise exception 'insufficient_stock' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'order_id', new_id,
    'duplicate', false,
    'stock_left', left_after,
    'low_stock', coalesce(left_after <= threshold, false)
  );
end
$$;

revoke execute on function public.order_place(jsonb) from public, anon, authenticated;
grant execute on function public.order_place(jsonb) to service_role;

comment on function public.order_place(jsonb) is
  'The one order writer. Inserts the order (idempotent on checkout_session_id) and takes its stock in one transaction; raises insufficient_stock (P0001), undoing the insert, when a tracked product has too few. Service role only.';

-- ---- 3. A payment is confirmed -----------------------------------------------------
-- pending -> paid. Idempotent: a second confirmation of the same checkout
-- answers `changed: false` and touches nothing. `order_id` is null when there
-- is no such order (it was released, or never existed), which the caller must
-- treat as money taken with nothing to show for it.

create or replace function public.order_confirm_paid(
  p_checkout_session_id text,
  p_payment_ref text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  target_id uuid;
  current_status text;
begin
  update public.orders o
     set status = 'paid',
         pending_expires_at = null,
         payment_ref = coalesce(p_payment_ref, o.payment_ref)
   where o.checkout_session_id = p_checkout_session_id
     and o.status = 'pending'
  returning o.id into target_id;

  if found then
    return jsonb_build_object('order_id', target_id, 'changed', true);
  end if;

  select o.id, o.status into target_id, current_status
    from public.orders o
   where o.checkout_session_id = p_checkout_session_id;

  return jsonb_build_object(
    'order_id', target_id,
    'changed', false,
    'status', current_status
  );
end
$$;

revoke execute on function public.order_confirm_paid(text, text) from public, anon, authenticated;
grant execute on function public.order_confirm_paid(text, text) to service_role;

comment on function public.order_confirm_paid(text, text) is
  'The payment provider confirmed a checkout: its pending order becomes paid. Idempotent. order_id is null when no such order exists. Service role only.';

-- ---- 4. An unpaid order is abandoned ------------------------------------------------
-- The order is deleted and its units go back on the shelf. Only ever an order
-- that is still pending AND was placed through order_place (it has a checkout
-- session): the simulator's pending rows are not anybody's reservation.
--
-- The ceiling is STOCK_QUANTITY_MAX (src/lib/validation/product.ts): putting
-- units back must never push a count past what the product form allows.

create or replace function public.order_release_pending(p_checkout_session_id text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  gone record;
begin
  delete from public.orders o
   where o.checkout_session_id = p_checkout_session_id
     and o.status = 'pending'
  returning o.product_id, o.stock_reserved into gone;

  if not found then
    return false;
  end if;

  if gone.stock_reserved > 0 and gone.product_id is not null then
    update public.products p
       set stock_quantity = least(p.stock_quantity + gone.stock_reserved, 1000000),
           updated_at = now()
     where p.id = gone.product_id
       and p.track_stock;
  end if;
  return true;
end
$$;

revoke execute on function public.order_release_pending(text) from public, anon, authenticated;
grant execute on function public.order_release_pending(text) to service_role;

comment on function public.order_release_pending(text) is
  'An unpaid checkout was abandoned or expired: deletes its pending order and puts its reserved units back. False when there is no pending order for it. Service role only.';

create or replace function public.orders_release_expired(p_now timestamptz default now())
returns integer
language sql
set search_path = ''
as $$
  with gone as (
    delete from public.orders o
     where o.status = 'pending'
       and o.checkout_session_id is not null
       and o.pending_expires_at is not null
       and o.pending_expires_at < p_now
    returning o.product_id, o.stock_reserved
  ),
  back as (
    update public.products p
       set stock_quantity = least(p.stock_quantity + units.total, 1000000),
           updated_at = now()
      from (
        select g.product_id, sum(g.stock_reserved)::integer as total
          from gone g
         where g.stock_reserved > 0 and g.product_id is not null
         group by g.product_id
      ) units
     where p.id = units.product_id
       and p.track_stock
    returning 1
  )
  select count(*)::integer from gone
$$;

revoke execute on function public.orders_release_expired(timestamptz) from public, anon, authenticated;
grant execute on function public.orders_release_expired(timestamptz) to service_role;

comment on function public.orders_release_expired(timestamptz) is
  'Releases every unpaid order past its pending_expires_at: deletes it and puts its units back. Returns how many. Run on a schedule; service role only.';

-- Every five minutes, where there is a scheduler. The test replica has none
-- (embedded Postgres ships no pg_cron), and the function is called directly
-- there.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'orders-release-expired',
      '*/5 * * * *',
      $cron$select public.orders_release_expired()$cron$
    );
  end if;
end
$$;

-- ---- 5. Permission mirror -----------------------------------------------------------
-- MIRROR of src/lib/team/permissions.ts. Edit BOTH together. 'orders.refund' is
-- the owner's alone: an editor packs parcels, but giving money back is the
-- owner's decision. CREATE OR REPLACE keeps the function's existing grants.
create or replace function public.team_role_can(r public.team_role, action text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when r is null then false
    when r = 'owner'  then action in ('team.read','team.invite','team.change_role','team.revoke','store.read','products.write','storefront.write','orders.fulfil','orders.refund','billing.manage')
    when r = 'editor' then action in ('team.read','team.invite','store.read','products.write','storefront.write','orders.fulfil')
    when r = 'viewer' then action in ('team.read','store.read')
    else false
  end
$$;

-- ---- 6. Taking an order back ---------------------------------------------------------
-- order_apply_refund is the change itself, for the server (a refund the payment
-- provider reports). order_refund is the seller's way to it: SECURITY DEFINER
-- because orders has no client UPDATE policy, and therefore self-gated exactly
-- as order_mark_shipped is (the two-factor session bar, then the store).
--
-- Results:
--   'refunded'        paid -> refunded, stamped now, with its reason
--   'not_refundable'  not paid (pending, already refunded, disputed), or a
--                     reason this function does not know
--   'not_found'       no such order, or not yours to refund
--
-- `p_restock` puts the order's units back (a parcel that never left, or came
-- back fit to sell). It moves stock_reserved to 0, so nothing can be put back
-- twice.

create or replace function public.order_apply_refund(
  p_order_id uuid,
  p_reason text,
  p_restock boolean default false
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  target public.orders%rowtype;
begin
  if p_reason is null or p_reason not in ('cancelled', 'returned', 'other') then
    return 'not_refundable';
  end if;

  select * into target
    from public.orders
   where id = p_order_id
     for update;

  if not found then
    return 'not_found';
  end if;
  if target.status <> 'paid' then
    return 'not_refundable';
  end if;

  update public.orders
     set status = 'refunded',
         refunded_at = now(),
         refund_reason = p_reason
   where id = target.id;

  if p_restock and target.stock_reserved > 0 and target.product_id is not null then
    update public.products p
       set stock_quantity = least(p.stock_quantity + target.stock_reserved, 1000000),
           updated_at = now()
     where p.id = target.product_id
       and p.track_stock;
    update public.orders set stock_reserved = 0 where id = target.id;
  end if;

  return 'refunded';
end
$$;

revoke execute on function public.order_apply_refund(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.order_apply_refund(uuid, text, boolean) to service_role;

comment on function public.order_apply_refund(uuid, text, boolean) is
  'paid -> refunded, optionally putting the order''s units back. The change itself, ungated: service role only. Returns refunded | not_refundable | not_found.';

create or replace function public.order_refund(
  p_order_id uuid,
  p_reason text,
  p_restock boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  if not public.mfa_session_ok() then
    return 'not_found';
  end if;

  select o.seller_id into owner_id
    from public.orders o
   where o.id = p_order_id;

  if not found
     or not (
       owner_id = (select auth.uid())
       or public.team_role_can(public.team_actor_role(owner_id), 'orders.refund')
     ) then
    return 'not_found';
  end if;

  return public.order_apply_refund(p_order_id, p_reason, p_restock);
end
$$;

-- A new function is auto-granted to anon (the PostgREST auto-grant trap), so
-- the grant is set explicitly both ways.
revoke execute on function public.order_refund(uuid, text, boolean) from public, anon;
grant execute on function public.order_refund(uuid, text, boolean) to authenticated, service_role;

comment on function public.order_refund(uuid, text, boolean) is
  'The seller takes a paid order back (cancelled before it was sent, returned, or other), optionally restocking it. Self-gated: 2FA session bar, owner or orders.refund. Returns refunded | not_refundable | not_found.';

-- ---- 7. A refunded order gives its code back -----------------------------------------
-- `uses` is what a code's usage limit counts (src/lib/discounts/public.ts
-- counts the same way). It used to count every order whatever became of it,
-- which meant a refunded order spent a one-use code for good. An order that
-- was taken back no longer counts; one still waiting on its payment does, so
-- the last use cannot be handed out twice while a buyer is paying.

create or replace function public.discount_performance(p_seller_id uuid)
returns table (
  discount_id    uuid,
  currency       text,
  uses           integer,
  orders         integer,
  revenue_cents  bigint,
  discount_cents bigint,
  last_order_at  timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(o.discount_code_id, o.discount_id),
    o.currency,
    (count(*) filter (where o.status <> 'refunded'))::integer,
    (count(*) filter (where o.status = 'paid'))::integer,
    coalesce(sum(o.amount_cents) filter (where o.status = 'paid'), 0)::bigint,
    coalesce(sum(o.discount_cents) filter (where o.status = 'paid'), 0)::bigint,
    max(o.created_at) filter (where o.status = 'paid')
  from public.orders o
  where o.seller_id = p_seller_id
    and coalesce(o.discount_code_id, o.discount_id) is not null
  group by 1, 2
$$;

-- Restated: recreating a function re-grants EXECUTE to the API roles.
revoke execute on function public.discount_performance(uuid) from public, anon;
grant execute on function public.discount_performance(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) seller_payment_accounts =====================================
-- supabase/migrations/20261008_seller_payment_accounts.sql, replayed verbatim.
-- Applied to prod 2026-10-09 through the Management API query endpoint, which
-- records no migration version. `pnpm check:schema` is what confirms it is there.
-- =============================================================================
-- Seller payment accounts: the seller's own connected Stripe account.
--
-- WHY. Buyers pay SELLERS, not Square Share: a sale is a charge on the
-- seller's own Stripe account (Stripe Connect, a direct charge), with our cut
-- taken as an application fee. That is what keeps the seller the merchant of
-- record. Nothing recorded which Stripe account belongs to which seller, so no
-- charge could be made and no event from Stripe could be matched to a store.
--
-- WHAT THIS ADDS. One table, seller_payment_accounts: one row per seller who
-- has started connecting, with the account's id and the three facts Stripe
-- reports about it. `charges_enabled` is the one checkout reads: until it is
-- true, the seller's products have no Pay button.
--
-- NOT TO BE CONFUSED WITH seller_billing (20260930_seller_plans), which is the
-- seller as OUR customer (the plan they pay us for) on the platform account.
-- This is the seller as a merchant, on their own.
--
-- TRUST. The account id is what an incoming Stripe event is matched against
-- (event.account), so it decides whose order a payment confirms. It is written
-- ONLY by this server, from Stripe's own answer when the account is created
-- (src/lib/payments/connect/account.ts): service role only, RLS on with no
-- policies, no grant to the API roles. A seller never reads the row directly;
-- the Payments page reads it for them on the server.
--
-- Deleted with the account (on delete cascade). The Stripe account itself
-- lives on, as Stripe's record of the seller's past payments.
--
-- DEPLOY ORDER: this migration first, then the app. Additive; the released
-- app does not know the table exists.
--
-- Apply via the Management API query endpoint or the SQL editor.

create table if not exists public.seller_payment_accounts (
  owner_id           uuid primary key references public.profiles (id) on delete cascade,
  stripe_account_id  text not null unique,
  -- Stripe's own three answers about the account, refreshed from Stripe (the
  -- account.updated event, and whenever the seller returns from onboarding).
  charges_enabled    boolean not null default false,
  payouts_enabled    boolean not null default false,
  details_submitted  boolean not null default false,
  -- Whether it is a live-mode account. A live deployment never charges a
  -- test-mode account, and the other way round.
  livemode           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint seller_payment_accounts_id_shape
    check (stripe_account_id ~ '^acct_[A-Za-z0-9]{6,250}$')
);

comment on table public.seller_payment_accounts is
  'A seller''s connected Stripe account (Stripe Connect) and what Stripe says it may do. Written by the server from Stripe''s answers; matched against event.account by the payments webhook. Service role only.';
comment on column public.seller_payment_accounts.charges_enabled is
  'Stripe will take payments on this account. Checkout is offered for the seller''s products only while this is true.';

drop trigger if exists seller_payment_accounts_set_updated_at on public.seller_payment_accounts;
create trigger seller_payment_accounts_set_updated_at
  before update on public.seller_payment_accounts
  for each row execute function public.set_updated_at();

alter table public.seller_payment_accounts enable row level security;
revoke all on table public.seller_payment_accounts from public, anon, authenticated;
grant all on table public.seller_payment_accounts to service_role;

-- A refund or a dispute arrives naming the PAYMENT, not our order.
create index if not exists orders_payment_ref_idx
  on public.orders (payment_ref)
  where payment_ref is not null;

-- Restated: while an order waits to be paid, the column holds the id of the
-- provider's payment PAGE instead, which is what a cancelled checkout closes.
comment on column public.orders.payment_ref is
  'The payment provider''s id for the payment (a Stripe PaymentIntent id, pi_...), which is what a refund names. While the order is still pending: the id of the provider''s checkout session (cs_...). Null for orders no provider charged.';

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) account_deletion_requests ===================================
-- supabase/migrations/20261010_account_deletion_requests.sql, replayed verbatim.
-- Applied to prod 2026-10-10 through the Management API query endpoint, which
-- records no migration version. `pnpm check:schema` is what confirms it is there.
-- =============================================================================
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

-- =============================================================================
-- ===== (pending) pricing_config ==============================================
-- supabase/migrations/20261011_pricing_config.sql, replayed verbatim. NOT in
-- prod as of 2026-10-10: apply it before the app that reads plan_prices ships.
-- =============================================================================
-- Pricing config: plan prices and fees move into the database, every order
-- records the whole fee it was charged, and a ledger keeps what was collected.
--
-- WHY. The plan catalog (prices, the per-sale fee) lived in code
-- (src/lib/billing/plans.ts), so changing a price meant a deploy, and the
-- homepage carried a hand-kept copy. Square Share's pricing was locked on
-- 10 Oct 2026 (Free 5%, Starter EUR 12 + 2%, Pro EUR 39 + 0.5%, a separate
-- fee on sales the marketplace brings, and later an ad fee on promoted
-- sales), and from here on every one of those numbers is a row.
--
-- WHAT THIS ADDS
--   1. plans, plan_prices, plan_entitlements: what each plan costs, what it
--      charges per sale (direct and marketplace), and which features it
--      switches on. plan_prices is append-only: a change closes the open row
--      and adds a new one (plan_price_change), so a past sale's rate can
--      always be explained.
--   2. seller_fee_waivers: sellers who pay no per-sale fee at all (the closed
--      beta, founding sellers). Backfilled with every seller the store has
--      today, so nobody already selling is charged anything new.
--   3. billing_switches.fees_enabled and .entitlements_enforced: the launch
--      switches for the per-sale fee and for feature gating. Both ship OFF.
--   4. orders: the ad fee, the total application fee and whether the 30% cap
--      cut it, beside the platform fee the row already carries. order_place
--      writes them.
--   5. fee_ledger: one row per fee collected or returned. Insert-only. What
--      revenue is counted from.
--   6. billing_sales_30d: a seller's last 30 days of sales, direct and
--      marketplace apart, for the upgrade hint.
--
-- WHAT IT DELIBERATELY DOES NOT ADD
--   * No orders.origin. An order's origin is orders.channel, which already
--     says embed | button | direct | marketplace; the app maps it to the
--     pricing vocabulary in one place (src/lib/billing/origin.ts). A second
--     column saying the same thing would be a second thing to keep true.
--   * No orders.plan_id_at_checkout. That is orders.seller_plan (20260930).
--   * No fee_waiver column on seller_billing. A row there means "this account
--     has a Stripe customer", and the admin panel reads a row that is not
--     live as a test account; a waiver for a seller who never went to
--     checkout would have made every beta seller look like one.
--   * No promotions tables yet. They arrive with promoted listings.
--
-- THE FEE BASE CHANGES with the app that ships after this: the fee is charged
-- on the whole amount the buyer pays, delivery included (it was the items
-- only). orders.platform_fee_bps is from then on basis points of amount_cents.
--
-- MIRRORS, each to be edited in the same change as its twin
-- (tests/integration/36-pricing-config.test.ts compares them):
--   enum plan_id          <-> PLAN_IDS         (src/lib/pricing/enums.ts)
--   enum fee_entry_kind   <-> FEE_ENTRY_KINDS  (src/lib/pricing/enums.ts)
--   enum feature_key      <-> FEATURE_KEYS     (src/lib/pricing/enums.ts)
--   the plan_prices seed  <-> PLAN_PRICE_SEED  (src/lib/billing/pricing-seed.ts)
--   the entitlement seed  <-> ENTITLEMENT_SEED (src/lib/billing/pricing-seed.ts)
--
-- DEPLOY ORDER: this migration FIRST, then the app. Everything here is
-- additive and the released app keeps working: order_place still accepts an
-- order without the new keys. The new app reads plan_prices on every checkout
-- and refuses the sale when it cannot, so it must not ship before this has run.
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. Vocabulary ------------------------------------------------------------------
-- Real enum types: a value outside the list cannot be stored at all.

do $$
begin
  create type public.plan_id as enum ('free', 'starter', 'pro');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.fee_entry_kind as enum ('platform_fee', 'ad_fee', 'platform_fee_refund', 'ad_fee_refund');
exception when duplicate_object then null;
end
$$;

do $$
begin
  create type public.feature_key as enum (
    'freeform_editor', 'custom_fonts', 'remove_badge', 'discount_codes',
    'multiple_storefronts', 'analytics', 'priority_support');
exception when duplicate_object then null;
end
$$;

-- ---- 2. Plans -----------------------------------------------------------------------

create table if not exists public.plans (
  id         public.plan_id primary key,
  name       text not null,
  -- Cheapest first: the order the plans are shown in.
  sort_order smallint not null unique,

  constraint plans_name_length check (char_length(name) between 1 and 40)
);

comment on table public.plans is
  'The seller plans. Three rows. What each costs is plan_prices; what each switches on is plan_entitlements. Read by any signed-in user, written by the service role only.';

insert into public.plans (id, name, sort_order) values
  ('free', 'Free', 1),
  ('starter', 'Starter', 2),
  ('pro', 'Pro', 3)
on conflict (id) do nothing;

-- ---- 3. Plan prices -----------------------------------------------------------------
-- What a plan costs per billing interval and what it charges per sale, for a
-- stretch of time. ONE OPEN ROW per plan and interval (the partial unique
-- index); the row in force at a moment is the one whose window holds it.
--
-- Yearly billing is in the schema and not on sale: it starts the day a yearly
-- row exists for every paid plan.
--
-- stripe_lookup_key, not a price id: a lookup key is the same in Stripe's test
-- and live modes, where the price id differs, so one row serves both.

create table if not exists public.plan_prices (
  id                  uuid primary key default gen_random_uuid(),
  plan_id             public.plan_id not null references public.plans (id),
  version             integer not null,
  billing_interval    text not null default 'month',
  -- Per interval, in cents, excluding VAT.
  price_cents         integer not null,
  -- The REGULAR price when price_cents is a launch price below it. It must be
  -- a price that will really be charged once the launch ends: a struck-through
  -- price nobody will ever pay is misleading advertising.
  list_price_cents    integer,
  currency            text not null default 'EUR',
  direct_fee_bps      integer not null,
  marketplace_fee_bps integer not null,
  stripe_lookup_key   text,
  effective_from      timestamptz not null default now(),
  effective_to        timestamptz,
  created_at          timestamptz not null default now(),

  constraint plan_prices_version_unique unique (plan_id, billing_interval, version),
  constraint plan_prices_version_range check (version >= 1),
  -- MIRROR of BILLING_INTERVALS (src/lib/pricing/enums.ts), as on seller_billing.
  constraint plan_prices_interval_check check (billing_interval in ('month', 'year')),
  constraint plan_prices_list_price_above check (list_price_cents is null or list_price_cents > price_cents),
  constraint plan_prices_currency_shape check (currency ~ '^[A-Z]{3}$'),
  -- 10 000 bps is the whole sale.
  constraint plan_prices_direct_fee_range check (direct_fee_bps between 0 and 10000),
  constraint plan_prices_marketplace_fee_range check (marketplace_fee_bps between 0 and 10000),
  -- `<plan>_<interval>_<currency>_v<N>`: the shape planForLookupKey reads.
  constraint plan_prices_lookup_key_shape
    check (stripe_lookup_key is null or stripe_lookup_key ~ '^[a-z]+_[a-z]+_[a-z]{3}_v[0-9]+$'),
  -- Free costs nothing and is billed through nothing; a paid plan has a price
  -- and a Stripe Price to bill it through.
  constraint plan_prices_free_or_billable check (
    case when plan_id = 'free'
      then price_cents = 0 and stripe_lookup_key is null and billing_interval = 'month'
      else price_cents > 0 and stripe_lookup_key is not null
    end),
  constraint plan_prices_window check (effective_to is null or effective_to > effective_from)
);

create unique index if not exists plan_prices_one_open_idx
  on public.plan_prices (plan_id, billing_interval)
  where effective_to is null;

comment on table public.plan_prices is
  'What each plan costs and charges per sale, over time. One open row (effective_to null) per plan and interval; a change closes it and adds a row (plan_price_change), and no row is ever edited. Mirrored for fixtures by PLAN_PRICE_SEED in src/lib/billing/pricing-seed.ts.';
comment on column public.plan_prices.direct_fee_bps is
  'Our cut of a sale through the seller''s own doors (embed, buy button, hosted pages), in basis points of the whole amount paid. 500 = 5%.';
comment on column public.plan_prices.marketplace_fee_bps is
  'Our cut of a sale the marketplace brought, in basis points of the whole amount paid. Charged instead of direct_fee_bps, never on top.';
comment on column public.plan_prices.stripe_lookup_key is
  'The lookup key of the Stripe Price this row is billed through. Null for Free. The app refuses a checkout whose Stripe Price does not charge price_cents.';

-- A PRICE THAT WAS CHARGED IS HISTORY. The only edit a row allows is closing
-- it, once; the only row that may be deleted is one that never came into
-- force (a scheduled change that was called off).
create or replace function public.plan_prices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.effective_from <= now() then
      raise exception 'plan_prices: a row that has been in force is never deleted' using errcode = '23514';
    end if;
    return old;
  end if;

  if old.effective_to is not null
     or new.effective_to is null
     or (to_jsonb(new) - 'effective_to') is distinct from (to_jsonb(old) - 'effective_to') then
    raise exception 'plan_prices: rows are never edited, add one with plan_price_change' using errcode = '23514';
  end if;
  return new;
end
$$;

revoke execute on function public.plan_prices_guard() from public, anon, authenticated;

drop trigger if exists plan_prices_guard on public.plan_prices;
create trigger plan_prices_guard
  before update or delete on public.plan_prices
  for each row execute function public.plan_prices_guard();

-- THE ONE WAY TO CHANGE A PRICE OR A FEE. Closes the open row at
-- p_effective_from and opens the next version from that moment, in one
-- transaction, so there is never a gap and never two rows in force.
--
-- A change of fee alone keeps the Stripe lookup key (the subscription price
-- did not move, so the same Stripe Price still bills it). A change of price
-- needs a new Stripe Price, created FIRST with the key this function returns:
-- `<plan>_<interval>_eur_v<version>`. Existing subscribers keep paying the
-- price they signed up at; the per-sale fee follows the row in force.
create or replace function public.plan_price_change(
  p_plan                public.plan_id,
  p_price_cents         integer,
  p_direct_fee_bps      integer,
  p_marketplace_fee_bps integer,
  p_billing_interval    text default 'month',
  p_list_price_cents    integer default null,
  p_effective_from      timestamptz default now()
)
returns public.plan_prices
language plpgsql
set search_path = ''
as $$
declare
  open_row public.plan_prices%rowtype;
  next_version integer;
  lookup_key text;
  created public.plan_prices%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan_price:' || p_plan::text || ':' || p_billing_interval, 0));

  select * into open_row
    from public.plan_prices
   where plan_id = p_plan
     and billing_interval = p_billing_interval
     and effective_to is null
     for update;

  if found then
    if p_effective_from <= open_row.effective_from then
      raise exception 'plan_price_change: the new row must start after the open one (%)', open_row.effective_from
        using errcode = '22023';
    end if;
    update public.plan_prices set effective_to = p_effective_from where id = open_row.id;
  end if;

  select coalesce(max(version), 0) + 1 into next_version
    from public.plan_prices
   where plan_id = p_plan
     and billing_interval = p_billing_interval;

  lookup_key := case
    when p_plan = 'free' then null
    when open_row.id is not null and open_row.price_cents = p_price_cents then open_row.stripe_lookup_key
    else p_plan::text || '_' || p_billing_interval || '_eur_v' || next_version
  end;

  insert into public.plan_prices (
    plan_id, version, billing_interval, price_cents, list_price_cents, currency,
    direct_fee_bps, marketplace_fee_bps, stripe_lookup_key, effective_from
  ) values (
    p_plan, next_version, p_billing_interval, p_price_cents, p_list_price_cents, 'EUR',
    p_direct_fee_bps, p_marketplace_fee_bps, lookup_key, p_effective_from
  )
  returning * into created;

  return created;
end
$$;

revoke execute on function public.plan_price_change(
  public.plan_id, integer, integer, integer, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.plan_price_change(
  public.plan_id, integer, integer, integer, text, integer, timestamptz) to service_role;

comment on function public.plan_price_change(
  public.plan_id, integer, integer, integer, text, integer, timestamptz) is
  'Change a plan''s price or fees: closes the open plan_prices row and opens the next version, atomically. A new price needs its Stripe Price created first, under the lookup key this returns. Service role only.';

-- THE SEED: option A, locked on 10 Oct 2026. The marketplace fees (8%, 7%,
-- 6%) are defaults not yet confirmed. MIRROR of PLAN_PRICE_SEED.
insert into public.plan_prices (
  plan_id, version, billing_interval, price_cents, currency,
  direct_fee_bps, marketplace_fee_bps, stripe_lookup_key, effective_from
) values
  ('free',    1, 'month',    0, 'EUR', 500, 800, null,                   '2026-10-10T00:00:00+00:00'),
  ('starter', 1, 'month', 1200, 'EUR', 200, 700, 'starter_month_eur_v1', '2026-10-10T00:00:00+00:00'),
  ('pro',     1, 'month', 3900, 'EUR',  50, 600, 'pro_month_eur_v1',     '2026-10-10T00:00:00+00:00')
on conflict (plan_id, billing_interval, version) do nothing;

-- ---- 4. Plan entitlements -------------------------------------------------------------
-- A row means the plan HAS the feature. limit_int is for a feature that is a
-- number rather than a yes (null = no number attached).
--
-- NOTHING IS GATED BY THIS YET: billing_switches.entitlements_enforced ships
-- off, and with it off every plan has every feature, as today.

create table if not exists public.plan_entitlements (
  plan_id   public.plan_id not null references public.plans (id),
  feature   public.feature_key not null,
  limit_int integer,

  primary key (plan_id, feature),
  constraint plan_entitlements_limit_range check (limit_int is null or limit_int >= 0)
);

comment on table public.plan_entitlements is
  'Which features each plan switches on (a row = the plan has it). Read by hasFeature() in src/lib/billing/entitlements.ts, and only enforced while billing_switches.entitlements_enforced is on. Mirrored for fixtures by ENTITLEMENT_SEED.';

-- The suggested split; Adrian can move items. MIRROR of ENTITLEMENT_SEED.
insert into public.plan_entitlements (plan_id, feature) values
  ('starter', 'freeform_editor'),
  ('starter', 'custom_fonts'),
  ('starter', 'remove_badge'),
  ('starter', 'discount_codes'),
  ('pro', 'freeform_editor'),
  ('pro', 'custom_fonts'),
  ('pro', 'remove_badge'),
  ('pro', 'discount_codes'),
  ('pro', 'multiple_storefronts'),
  ('pro', 'analytics'),
  ('pro', 'priority_support')
on conflict (plan_id, feature) do nothing;

-- The three config tables: any signed-in user reads them (the same numbers
-- are on the plans page), nobody but the service role writes them. A new
-- table is auto-granted to the API roles here, so every grant is set both ways.
alter table public.plans enable row level security;
alter table public.plan_prices enable row level security;
alter table public.plan_entitlements enable row level security;

revoke all on table public.plans, public.plan_prices, public.plan_entitlements from public, anon, authenticated;
grant select on table public.plans, public.plan_prices, public.plan_entitlements to authenticated;
grant all on table public.plans, public.plan_prices, public.plan_entitlements to service_role;

drop policy if exists plans_select_signed_in on public.plans;
create policy plans_select_signed_in on public.plans
  for select to authenticated using (true);

drop policy if exists plan_prices_select_signed_in on public.plan_prices;
create policy plan_prices_select_signed_in on public.plan_prices
  for select to authenticated using (true);

drop policy if exists plan_entitlements_select_signed_in on public.plan_entitlements;
create policy plan_entitlements_select_signed_in on public.plan_entitlements
  for select to authenticated using (true);

-- ---- 5. Fee waivers -----------------------------------------------------------------
-- A seller with a row here pays no per-sale fee, whatever their plan and
-- wherever the sale came from. Service role only: a seller who could write
-- this could waive their own fees.

create table if not exists public.seller_fee_waivers (
  owner_id   uuid primary key references public.profiles (id) on delete cascade,
  reason     text not null default 'closed_beta',
  granted_at timestamptz not null default now(),

  constraint seller_fee_waivers_reason_check check (reason in ('closed_beta', 'founding_seller'))
);

comment on table public.seller_fee_waivers is
  'Sellers who pay no per-sale fee (closed beta, founding sellers). A row is the waiver; deleting it ends it. Read by the checkout when it prices a sale (src/lib/billing/sale-fee.ts). Service role only: no client policy exists.';

alter table public.seller_fee_waivers enable row level security;
revoke all on table public.seller_fee_waivers from public, anon, authenticated;
grant all on table public.seller_fee_waivers to service_role;

-- EVERY SELLER THERE IS TODAY keeps paying nothing: the closed beta charged no
-- fee, and switching fees on must not change that for the people already in it.
insert into public.seller_fee_waivers (owner_id, reason)
select sellers.owner_id, 'closed_beta'
  from (
    select owner_id from public.storefronts
    union
    select owner_id from public.products
  ) sellers
on conflict (owner_id) do nothing;

-- ---- 6. Launch switches ---------------------------------------------------------------

alter table public.billing_switches
  add column if not exists fees_enabled boolean not null default false,
  add column if not exists entitlements_enforced boolean not null default false;

comment on table public.billing_switches is
  'Launch switches for the money layer, one row. plan_limits_enforced: plan limits refuse creates. fees_enabled: a sale is charged its per-sale fee (off = every sale pays nothing, as in the closed beta). entitlements_enforced: plan_entitlements gates features (off = every plan has every feature). All ship off. Service role only.';

-- ---- 7. Orders: the whole fee as it was charged ----------------------------------------

alter table public.orders
  add column if not exists ad_rate_bps smallint,
  add column if not exists ad_fee_cents integer not null default 0,
  add column if not exists application_fee_cents integer,
  add column if not exists fee_capped boolean not null default false;

-- Dropped first so the whole file can be run again.
alter table public.orders
  drop constraint if exists orders_ad_rate_bps_range,
  drop constraint if exists orders_ad_fee_cents_range,
  drop constraint if exists orders_application_fee_range,
  drop constraint if exists orders_application_fee_parts;

alter table public.orders
  add constraint orders_ad_rate_bps_range
    check (ad_rate_bps is null or ad_rate_bps between 1 and 10000),
  add constraint orders_ad_fee_cents_range
    check (ad_fee_cents >= 0),
  add constraint orders_application_fee_range
    check (application_fee_cents is null or (application_fee_cents >= 0 and application_fee_cents <= amount_cents)),
  -- The two parts are the whole: nothing is charged that no column explains.
  add constraint orders_application_fee_parts
    check (application_fee_cents is null or application_fee_cents = platform_fee_cents + ad_fee_cents);

comment on column public.orders.platform_fee_bps is
  'The platform fee rate this order was charged, in basis points (500 = 5%): of the whole amount paid from 20261011 on, of the item subtotal before. Snapshotted at checkout from the plan price row in force. Null on orders written before plans existed.';
comment on column public.orders.ad_rate_bps is
  'The promotion''s ad rate this order was charged, in basis points of the amount paid. Null when no promotion drove the sale.';
comment on column public.orders.ad_fee_cents is
  'The ad fee charged on a promoted marketplace sale, in cents. 0 for every other sale.';
comment on column public.orders.application_fee_cents is
  'Everything Square Share took from this sale: platform_fee_cents + ad_fee_cents, after the 30% cap. What Stripe was asked for as application_fee_amount, corrected to what Stripe actually collected once the payment is confirmed. Null on orders written before 20261011.';
comment on column public.orders.fee_capped is
  'The 30% cap cut this order''s fee down. Rare by design, and logged when it happens.';

-- The one order writer (20261008_order_lifecycle), restated with the four new
-- columns. Nothing else in it changed. A key the JSON leaves out is NULL in
-- the record, so the released app's orders (which do not send these) get the
-- defaults.
create or replace function public.order_place(p_order jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  incoming public.orders%rowtype;
  new_id uuid;
  wanted integer;
  left_after integer;
  threshold integer;
begin
  incoming := jsonb_populate_record(null::public.orders, p_order);

  if incoming.checkout_session_id is null then
    raise exception 'order_place: checkout_session_id is required' using errcode = '22023';
  end if;
  if incoming.status is null or incoming.status not in ('paid', 'pending') then
    raise exception 'order_place: status must be paid or pending' using errcode = '22023';
  end if;
  wanted := coalesce(incoming.quantity, 1);

  insert into public.orders (
    seller_id, product_id, storefront_id, channel, status,
    amount_cents, platform_fee_cents, platform_fee_bps, seller_plan, shipping_cents, currency,
    ad_rate_bps, ad_fee_cents, application_fee_cents, fee_capped,
    buyer_email, buyer_locale, product_title, product_price_cents,
    discount_cents, discount_id, discount_code_id, discount_code,
    selected_options, quantity, ship_to, fulfilment_status,
    checkout_session_id, gift_message, supply_consent_at, digital_file_key,
    payment_ref, pending_expires_at
  ) values (
    incoming.seller_id, incoming.product_id, incoming.storefront_id, incoming.channel, incoming.status,
    incoming.amount_cents, coalesce(incoming.platform_fee_cents, 0), incoming.platform_fee_bps,
    incoming.seller_plan, incoming.shipping_cents, coalesce(incoming.currency, 'EUR'),
    incoming.ad_rate_bps, coalesce(incoming.ad_fee_cents, 0), incoming.application_fee_cents,
    coalesce(incoming.fee_capped, false),
    incoming.buyer_email, incoming.buyer_locale, incoming.product_title, incoming.product_price_cents,
    coalesce(incoming.discount_cents, 0), incoming.discount_id, incoming.discount_code_id, incoming.discount_code,
    coalesce(incoming.selected_options, '[]'::jsonb), wanted, incoming.ship_to,
    coalesce(incoming.fulfilment_status, 'unfulfilled'),
    incoming.checkout_session_id, incoming.gift_message, incoming.supply_consent_at, incoming.digital_file_key,
    incoming.payment_ref,
    case when incoming.status = 'pending' then incoming.pending_expires_at end
  )
  on conflict (checkout_session_id) do nothing
  returning id into new_id;

  if new_id is null then
    select o.id into new_id
      from public.orders o
     where o.checkout_session_id = incoming.checkout_session_id;
    return jsonb_build_object('order_id', new_id, 'duplicate', true);
  end if;

  update public.products p
     set stock_quantity = p.stock_quantity - wanted,
         updated_at = now()
   where p.id = incoming.product_id
     and p.track_stock
     and p.stock_quantity >= wanted
  returning p.stock_quantity, p.low_stock_threshold into left_after, threshold;

  if found then
    update public.orders set stock_reserved = wanted where id = new_id;
  elsif exists (
    select 1 from public.products p where p.id = incoming.product_id and p.track_stock
  ) then
    -- Rolls the insert above back with it.
    raise exception 'insufficient_stock' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'order_id', new_id,
    'duplicate', false,
    'stock_left', left_after,
    'low_stock', coalesce(left_after <= threshold, false)
  );
end
$$;

revoke execute on function public.order_place(jsonb) from public, anon, authenticated;
grant execute on function public.order_place(jsonb) to service_role;

-- ---- 8. The fee ledger ----------------------------------------------------------------
-- One row per fee collected (positive) or returned (negative). What revenue
-- is counted from: an order's fee columns say what it was charged, this says
-- what happened to the money, refund by refund.
--
-- INSERT-ONLY. No role the app uses may update or delete a row (see the
-- grants): a correction is another row. The two references go null rather
-- than taking the row with them when an order or an account is deleted,
-- because what Square Share collected is its own accounting record and
-- outlives both; what is left then names nobody.
--
-- entry_key is what makes every write idempotent: a payment event delivered
-- twice writes its rows once.
--   <order id>:platform_fee            the fee an order was charged
--   <order id>:ad_fee
--   <refund id>:platform_fee_refund    one application fee refund
--   <refund id>:ad_fee_refund

create table if not exists public.fee_ledger (
  id                        uuid primary key default gen_random_uuid(),
  order_id                  uuid references public.orders (id) on delete set null,
  seller_id                 uuid references public.profiles (id) on delete set null,
  kind                      public.fee_entry_kind not null,
  -- Signed: a fee is positive, a refund of one is negative.
  amount_cents              integer not null,
  currency                  text not null,
  -- Stripe's application fee object (fee_...). Null for a sale no provider
  -- charged (the development test provider).
  stripe_application_fee_id text,
  entry_key                 text not null unique,
  livemode                  boolean not null default false,
  created_at                timestamptz not null default now(),

  constraint fee_ledger_amount_sign check (
    (kind in ('platform_fee', 'ad_fee') and amount_cents > 0)
    or (kind in ('platform_fee_refund', 'ad_fee_refund') and amount_cents < 0)),
  constraint fee_ledger_currency_shape check (currency ~ '^[A-Z]{3}$'),
  constraint fee_ledger_fee_id_shape
    check (stripe_application_fee_id is null or stripe_application_fee_id ~ '^fee_[A-Za-z0-9_]{1,250}$'),
  constraint fee_ledger_entry_key_shape check (entry_key ~ '^[A-Za-z0-9_:-]{1,255}$')
);

create index if not exists fee_ledger_seller_time_idx on public.fee_ledger (seller_id, created_at);
create index if not exists fee_ledger_order_idx on public.fee_ledger (order_id);

comment on table public.fee_ledger is
  'Every fee Square Share collected (positive) or returned (negative), one row each. Insert-only; revenue is counted from here. A store''s team reads its own rows; only the service role writes, through fee_ledger_record.';
comment on column public.fee_ledger.livemode is
  'True for a row written from a Stripe live-mode payment. False for test mode and for sales no provider charged: neither is revenue.';

alter table public.fee_ledger enable row level security;
revoke all on table public.fee_ledger from public, anon, authenticated, service_role;
grant select on table public.fee_ledger to authenticated;
-- No UPDATE, DELETE or TRUNCATE, for the service role either.
grant select, insert on table public.fee_ledger to service_role;

-- The same people who read the store's orders read what those orders paid.
drop policy if exists fee_ledger_select_member on public.fee_ledger;
create policy fee_ledger_select_member on public.fee_ledger
  for select to authenticated
  using (
    seller_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(seller_id), 'store.read')
  );

drop policy if exists "Require two-factor when enrolled" on public.fee_ledger;
create policy "Require two-factor when enrolled" on public.fee_ledger
  as restrictive for all to authenticated
  using ((select public.mfa_session_ok()))
  with check ((select public.mfa_session_ok()));

-- THE ONE WRITE. The seller and the currency come from the ORDER, never from
-- the caller, so a row can only ever be filed under the store that made the
-- sale. True when the row was written, false when its entry_key already was.
create or replace function public.fee_ledger_record(
  p_order_id                  uuid,
  p_kind                      public.fee_entry_kind,
  p_amount_cents              integer,
  p_entry_key                 text,
  p_stripe_application_fee_id text default null,
  p_livemode                  boolean default false
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  target record;
  written integer;
begin
  select o.id, o.seller_id, o.currency into target
    from public.orders o
   where o.id = p_order_id;

  if not found then
    raise exception 'fee_ledger_record: no such order' using errcode = '23503';
  end if;

  insert into public.fee_ledger (
    order_id, seller_id, kind, amount_cents, currency,
    stripe_application_fee_id, entry_key, livemode
  ) values (
    target.id, target.seller_id, p_kind, p_amount_cents, target.currency,
    p_stripe_application_fee_id, p_entry_key, coalesce(p_livemode, false)
  )
  on conflict (entry_key) do nothing;

  get diagnostics written = row_count;
  return written > 0;
end
$$;

revoke execute on function public.fee_ledger_record(
  uuid, public.fee_entry_kind, integer, text, text, boolean) from public, anon, authenticated;
grant execute on function public.fee_ledger_record(
  uuid, public.fee_entry_kind, integer, text, text, boolean) to service_role;

comment on function public.fee_ledger_record(
  uuid, public.fee_entry_kind, integer, text, text, boolean) is
  'Write one fee ledger row for an order, idempotent on p_entry_key. The seller and currency are read from the order. Returns whether a row was written. Service role only.';

-- What a store paid in fees over a period, per currency. INVOKER, so the
-- ledger's own policies decide what the caller may add up: a store's team
-- gets its store's figures and nobody else's.
create or replace function public.fee_ledger_summary(
  p_seller_id uuid,
  p_from      timestamptz,
  p_to        timestamptz
)
returns table (currency text, charged_cents bigint, refunded_cents bigint, net_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    l.currency,
    coalesce(sum(l.amount_cents) filter (where l.amount_cents > 0), 0)::bigint,
    coalesce(-sum(l.amount_cents) filter (where l.amount_cents < 0), 0)::bigint,
    coalesce(sum(l.amount_cents), 0)::bigint
  from public.fee_ledger l
  where l.seller_id = p_seller_id
    and l.created_at >= p_from
    and l.created_at < p_to
  group by l.currency
$$;

revoke execute on function public.fee_ledger_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.fee_ledger_summary(uuid, timestamptz, timestamptz) to authenticated, service_role;

comment on function public.fee_ledger_summary(uuid, timestamptz, timestamptz) is
  'Fees a store was charged, had returned, and the net, per currency, for [p_from, p_to). Invoker: limited to rows the caller may read.';

-- ---- 9. Sales for the upgrade hint ---------------------------------------------------
-- The last 30 days of an account's paid EUR sales, as the fee sees them: the
-- whole amount paid, delivery included, with the marketplace's sales apart
-- (they pay a different fee, and a plan cannot make them cheaper to compare).
--
-- Supersedes billing_sales_summary (20260930), which summed the item subtotal
-- and stays only until the app that calls it is gone. Service role only: the
-- caller has already checked that the viewer may read the store it names.
create or replace function public.billing_sales_30d(p_seller_id uuid, p_now timestamptz default now())
returns table (direct_cents bigint, marketplace_cents bigint, sales integer, fees_cents bigint)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(sum(o.amount_cents) filter (where o.channel <> 'marketplace'), 0)::bigint,
    coalesce(sum(o.amount_cents) filter (where o.channel = 'marketplace'), 0)::bigint,
    count(*)::integer,
    coalesce(sum(coalesce(o.application_fee_cents, o.platform_fee_cents)), 0)::bigint
  from public.orders o
  where o.seller_id = p_seller_id
    and o.status = 'paid'
    and o.currency = 'EUR'
    and o.created_at >= p_now - interval '30 days'
    and o.created_at <= p_now
$$;

revoke execute on function public.billing_sales_30d(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_sales_30d(uuid, timestamptz) to service_role;

comment on function public.billing_sales_30d(uuid, timestamptz) is
  'Last 30 days of an account''s paid EUR sales: the amount paid through the seller''s own doors, through the marketplace, the count and the fees. Service role only; the caller authorises the account first.';

notify pgrst, 'reload schema';

-- ===== (pending) auto_moderation ============================================
-- ════════════════════════════════════════════════════════════════════
-- AUTOMATIC MODERATION: THE WALL.
--
-- Until now content was public the moment it was saved and came down only if
-- somebody reported it. This migration turns that around: a row is public only
-- while EVERY part of its current content (its text, each image, each PDF) is
-- on the approved list, and the database is what enforces it.
--
-- WHY THE DATABASE AND NOT THE APPS. A seller holds a publishable key and an
-- RLS-permitted INSERT/UPDATE on their own rows, so every check an app runs in
-- a server action can be skipped with one REST call. A trigger cannot. It also
-- means an app that has never heard of moderation is still safe: content
-- nobody approved is simply not 'ok', and isContentVisible() admits 'ok' and
-- nothing else.
--
-- THE MOVING PARTS, all in this file:
--
--   moderation_checks   The approved list (and the refused one). One row per
--                       part: 'image:<key>', 'pdf:<key>', 'text:<fingerprint>'.
--                       Content-addressed, so the same photo or the same words
--                       are judged once, by the classifier or by a person.
--   moderation_gate()   BEFORE INSERT OR UPDATE on products, storefronts and
--                       artifacts. Replaces guard_moderation_columns there.
--                       When moderated content changes it asks one question,
--                       "is every part of this already approved?", and the row
--                       is 'ok' or 'pending' accordingly.
--   moderation_settle() What the checker calls once it has judged the missing
--                       parts: 'ok', an automated pause, or 'review' (a person
--                       decides). Refuses to act on a revision that has since
--                       changed, and never sets 'ok' on anyone's word but the
--                       approved list's.
--
-- TWO NEW STATES, both hidden by the existing gate with no code change:
--
--   pending  Waiting for the automatic check. Seconds, normally.
--   review   The check could not say it was fine. A person decides.
--
-- WHO IS TRUSTED. service_role, exactly as before: the admin panel's decisions
-- and the checker both write with it. A staff member putting something back
-- ('review', 'paused' or 'removed' -> 'ok') is recorded against the exact
-- parts they approved, so the same photo is never held twice.
--
-- EXISTING ROWS stay 'ok'. They have never been checked, which is what a null
-- moderation_checked_at says, and the sweep audits them while they stay live.
--
-- DEPLOY ORDER. The app that calls these functions must be live BEFORE this
-- is applied: from the moment the gate exists, a save by an app with no
-- checker stays 'pending' until something settles it.
--
-- Apply via Supabase MCP (apply_migration) or the SQL editor, after
-- 20260926_moderation_decisions_and_appeals.
-- ════════════════════════════════════════════════════════════════════

-- ---- 1. The states ----------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['products', 'storefronts'] loop
    execute format(
      'alter table public.%I drop constraint if exists %I',
      target, target || '_moderation_status_check'
    );
    execute format(
      'alter table public.%I add constraint %I check (moderation_status in (''ok'', ''pending'', ''review'', ''paused'', ''removed''))',
      target, target || '_moderation_status_check'
    );
  end loop;
end
$$;

-- Artifacts still cannot be paused (the marketplace has no fix-and-ask-again
-- surface), so an automated refusal there is a removal.
alter table public.artifacts drop constraint if exists artifacts_moderation_status_check;
alter table public.artifacts
  add constraint artifacts_moderation_status_check
  check (moderation_status in ('ok', 'pending', 'review', 'removed'));

comment on column public.products.moderation_status is
  'Moderation state, never the seller''s to write (moderation_gate). ''ok'' (public), ''pending'' (awaiting the automatic check), ''review'' (held for a person), ''paused'' (hidden until fixed) or ''removed'' (hidden, final). Separate from status, the seller''s own draft/active field. Mirror of MODERATION_STATUSES in @squaresharedev/moderation.';

-- ---- 2. Revision and audit marker ---------------------------------------------
-- moderation_rev counts changes to the moderated content. The checker reads
-- it with the content and hands it back when it settles, so an outcome worked
-- out for words the seller has since replaced is refused rather than applied.
--
-- moderation_checked_at is when the CURRENT content last passed. Null on a row
-- that is 'ok' means "live, but from before the wall": the sweep's audit list.

alter table public.products
  add column if not exists moderation_rev integer not null default 0,
  add column if not exists moderation_checked_at timestamptz;
alter table public.storefronts
  add column if not exists moderation_rev integer not null default 0,
  add column if not exists moderation_checked_at timestamptz;
alter table public.artifacts
  add column if not exists moderation_rev integer not null default 0,
  add column if not exists moderation_checked_at timestamptz;

-- The sweep asks one question of each table, and almost every row answers no.
create index if not exists products_moderation_due_idx
  on public.products (updated_at)
  where moderation_status = 'pending' or moderation_checked_at is null;
create index if not exists storefronts_moderation_due_idx
  on public.storefronts (updated_at)
  where moderation_status = 'pending' or moderation_checked_at is null;
create index if not exists artifacts_moderation_due_idx
  on public.artifacts (updated_at)
  where moderation_status = 'pending' or moderation_checked_at is null;

-- A decision made by the automatic check rather than a person. The statement
-- of reasons has to say which (DSA Art. 17(3)(c)), and the gate reads it to
-- know that an edit should be re-checked instead of waiting on staff.
alter table public.moderation_decisions
  add column if not exists automated boolean not null default false;

comment on column public.moderation_decisions.automated is
  'True when the automatic check made this decision and no person did. Printed on the statement of reasons; an automated pause is re-checked when the seller edits.';

-- ---- 3. The approved list ---------------------------------------------------------

create table if not exists public.moderation_checks (
  -- 'image:<object key>', 'pdf:<object key>' or 'text:<md5 of the text lines>'.
  subject    text primary key,
  verdict    text not null check (verdict in ('clean', 'unsure', 'violation')),
  -- Mirror of REMOVAL_GROUNDS. Set with a violation, sometimes with unsure.
  ground     text check (ground is null or ground in (
               'illegal', 'sexual', 'violence', 'hate',
               'counterfeit', 'scam', 'spam', 'other')),
  -- Text only: the field paths the classifier pointed at.
  paths      text[] not null default '{}',
  -- model:  the classifier.
  -- staff:  a person approved it; never overwritten by the classifier.
  -- upload: the upload route, for a file the classifier cannot fully see
  --         (SVG, AVIF, animation), which therefore goes to a person.
  source     text not null check (source in ('model', 'staff', 'upload')),
  model      text,
  checked_at timestamptz not null default now()
);

comment on table public.moderation_checks is
  'The automatic check''s memory: one verdict per part of content (an image, a PDF, or the text of one row), content-addressed so nothing is judged or paid for twice. A row is public only while every part of it is ''clean'' here. Service role only.';

alter table public.moderation_checks enable row level security;
revoke all on public.moderation_checks from anon, authenticated;
grant all on public.moderation_checks to service_role;

-- ---- 4. What counts as content ---------------------------------------------------------
-- ONE list of moderated columns per target, read by the gate and by the
-- checker alike. A column that carries anything a seller typed or uploaded and
-- a buyer can see belongs here; a column missing from this list is a column
-- nobody checks.

create or replace function public.moderation_columns(p_type text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'product' then array[
      'title', 'description', 'image_key', 'gallery', 'variants', 'details',
      'documents', 'option_groups', 'purchase_url']
    when 'storefront' then array['name', 'config']
    when 'artifact' then array['title', 'description', 'image_key']
  end
$$;

create or replace function public.moderation_table(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'product' then 'products'
    when 'storefront' then 'storefronts'
    when 'artifact' then 'artifacts'
  end
$$;

-- A row reduced to its moderated columns.
create or replace function public.moderation_doc(p_row jsonb, p_cols text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(col, p_row -> col), '{}'::jsonb)
  from unnest(p_cols) as col
$$;

-- Every string anywhere inside a document, with the path that leads to it.
-- Array positions are dropped ("gallery[].alt"), so reordering is not a change.
create or replace function public.moderation_leaves(p_doc jsonb)
returns table (path text, value text)
language sql
immutable
set search_path = ''
as $$
  with recursive walk (path, node) as (
    select ''::text, p_doc
    union all
    select
      case
        when child.key is null then walk.path || '[]'
        when walk.path = '' then child.key
        else walk.path || '.' || child.key
      end,
      child.value
    from walk
    cross join lateral (
      select e.key, e.value
        from jsonb_each(
          case when jsonb_typeof(walk.node) = 'object' then walk.node else '{}'::jsonb end
        ) as e
      union all
      select null::text, a.value
        from jsonb_array_elements(
          case when jsonb_typeof(walk.node) = 'array' then walk.node else '[]'::jsonb end
        ) as a
    ) as child
  )
  select walk.path, walk.node #>> '{}'
  from walk
  where jsonb_typeof(walk.node) = 'string'
    and btrim(walk.node #>> '{}') <> ''
$$;

-- A document split into the parts that get a verdict each.
--
--   media         Every stored-object key (the shape buildObjectKey mints):
--                 a PDF under documents/, an image otherwise. Font files are
--                 skipped: no classifier can read one.
--   lines         Everything else a person could have typed, as "path=value".
--                 Values that cannot carry words whatever field they sit in
--                 (a uuid, a hex colour) are left out, so recolouring a
--                 storefront is not new text.
--   text_subject  The fingerprint of those lines. Paths are part of it, so a
--                 change to a user-authored JSON key is a change too.
create or replace function public.moderation_parts(p_doc jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with classed as (
    select
      l.path,
      l.value,
      case
        when l.value ~ '^fonts/[0-9a-f-]{36}/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$' then 'skip'
        when l.value ~ '^documents/[0-9a-f-]{36}/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$' then 'pdf'
        when l.value ~ '^[a-z]{1,20}/[0-9a-f-]{36}/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$' then 'image'
        when l.value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 'skip'
        when l.value ~ '^#[0-9a-fA-F]{3,8}$' then 'skip'
        else 'text'
      end as kind
    from public.moderation_leaves(p_doc) as l
  ),
  text_lines as (
    select distinct c.path || '=' || c.value as line
    from classed c
    where c.kind = 'text'
  ),
  media as (
    select distinct on (c.value) c.kind, c.value, c.path
    from classed c
    where c.kind in ('image', 'pdf')
    order by c.value, c.path
  )
  select jsonb_build_object(
    'lines',
      coalesce((select jsonb_agg(t.line order by t.line) from text_lines t), '[]'::jsonb),
    'text_subject',
      (select 'text:' || md5(string_agg(t.line, E'\n' order by t.line)) from text_lines t),
    'media',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'kind', m.kind,
                    'key', m.value,
                    'subject', m.kind || ':' || m.value,
                    'path', m.path)
                  order by m.value)
           from media m),
        '[]'::jsonb)
  )
$$;

-- The subjects of a parts object, one per row.
create or replace function public.moderation_subjects(p_parts jsonb)
returns setof text
language sql
immutable
set search_path = ''
as $$
  select p_parts ->> 'text_subject'
  where p_parts ->> 'text_subject' is not null
  union all
  select m ->> 'subject'
  from jsonb_array_elements(coalesce(p_parts -> 'media', '[]'::jsonb)) as m
$$;

-- THE question the gate asks: is every part of this content already approved?
-- A document with no parts at all has nothing in it to object to.
create or replace function public.moderation_all_clear(p_doc jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1
    from public.moderation_subjects(public.moderation_parts(p_doc)) as s (subject)
    left join public.moderation_checks c on c.subject = s.subject
    where c.verdict is distinct from 'clean'
  )
$$;

-- ---- 5. The gate ---------------------------------------------------------------------
-- One function for all three tables; the trigger argument names the target.
--
-- SECURITY DEFINER, unlike guard_moderation_columns before it, because it has
-- to read the approved list on behalf of a seller who may not. So it cannot
-- ask `current_user` who is writing (as a definer it would always see its
-- owner). It asks the `role` setting instead: PostgREST's SET ROLE puts
-- 'authenticated' or 'service_role' there, a direct connection leaves 'none',
-- and nothing in a request body can change it.

create or replace function public.moderation_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type     text := tg_argv[0];
  v_cols     text[] := public.moderation_columns(v_type);
  v_trusted  boolean := coalesce(nullif(current_setting('role', true), ''), 'none')
                          in ('none', 'service_role', 'postgres', 'supabase_admin');
  v_new      jsonb := to_jsonb(new);
  v_old      jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_new_doc  jsonb := public.moderation_doc(v_new, v_cols);
  v_changed  boolean;
  v_status   text;
  v_staff_pause boolean;
  v_guarded  text;
  v_next     text;
begin
  v_changed := tg_op = 'INSERT'
    or v_new_doc is distinct from public.moderation_doc(v_old, v_cols);

  -- 1. A seller never writes moderation state. On INSERT there is no old row
  --    to compare with, so whatever they sent is discarded instead.
  if not v_trusted then
    if tg_op = 'UPDATE' then
      foreach v_guarded in array array[
        'moderation_status', 'moderation_ground', 'moderation_note',
        'moderated_at', 'moderated_by', 'moderation_review_requested_at',
        'moderation_fields', 'moderation_decision_id',
        'moderation_rev', 'moderation_checked_at'
      ] loop
        if (v_old -> v_guarded) is distinct from (v_new -> v_guarded) then
          raise exception
            'Moderation state is set by SquareShare staff and cannot be changed here (column %).', v_guarded
            using errcode = '42501';
        end if;
      end loop;
    else
      new := jsonb_populate_record(new, jsonb_build_object(
        'moderation_status', 'pending',
        'moderation_ground', null, 'moderation_note', null,
        'moderated_at', null, 'moderated_by', null,
        'moderation_review_requested_at', null,
        'moderation_fields', null, 'moderation_decision_id', null,
        'moderation_rev', 0, 'moderation_checked_at', null));
    end if;
  end if;

  if not v_changed then
    return new;
  end if;

  new.moderation_rev := coalesce((v_old ->> 'moderation_rev')::integer, 0) + 1;

  -- 2. A trusted writer (the admin panel, the checker, a fixture) states the
  --    outcome itself. What the gate adds is memory: a person putting content
  --    back has approved exactly these parts.
  if v_trusted then
    return new;
  end if;

  -- 3. A seller changed the content. A removal is final, and a pause a person
  --    imposed waits for that person; everything else is decided here, by the
  --    approved list.
  v_status := new.moderation_status;
  if v_status = 'removed' then
    return new;
  end if;
  if v_status = 'paused' then
    select not d.automated into v_staff_pause
      from public.moderation_decisions d
     where d.id = (v_new ->> 'moderation_decision_id')::uuid;
    -- No decision row (a pause older than the decisions table) reads as a
    -- person's, the stricter of the two.
    if coalesce(v_staff_pause, true) then
      return new;
    end if;
  end if;

  v_next := case when public.moderation_all_clear(v_new_doc) then 'ok' else 'pending' end;
  new := jsonb_populate_record(new, jsonb_build_object(
    'moderation_status', v_next,
    'moderation_ground', null, 'moderation_note', null,
    'moderated_at', null, 'moderated_by', null,
    'moderation_review_requested_at', null,
    'moderation_fields', null, 'moderation_decision_id', null,
    'moderation_checked_at', case when v_next = 'ok' then now() else null end));
  return new;
end;
$$;

comment on function public.moderation_gate() is
  'The moderation wall. Refuses any seller write to moderation_* columns, and when moderated content changes sets the row ''ok'' only if every part of it is already approved in moderation_checks, ''pending'' otherwise. Attached to products, storefronts and artifacts.';

-- A person's approval, remembered against the parts they approved. AFTER the
-- write, so it records what was actually stored.
create or replace function public.moderation_remember_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean := coalesce(nullif(current_setting('role', true), ''), 'none')
                         in ('none', 'service_role', 'postgres', 'supabase_admin');
begin
  if v_trusted
     and old.moderation_status in ('review', 'paused', 'removed')
     and new.moderation_status = 'ok' then
    insert into public.moderation_checks (subject, verdict, source)
    select s.subject, 'clean', 'staff'
      from public.moderation_subjects(
             public.moderation_parts(
               public.moderation_doc(to_jsonb(new), public.moderation_columns(tg_argv[0])))
           ) as s (subject)
    on conflict (subject) do update
      set verdict = 'clean', ground = null, paths = '{}', source = 'staff',
          model = null, checked_at = now();
  end if;
  return null;
end;
$$;

comment on function public.moderation_remember_approval() is
  'When a trusted writer puts held or taken-down content back to ''ok'', records every part of it as approved by a person, so the automatic check never holds the same photo or words again.';

do $$
declare
  target record;
begin
  for target in
    select * from (values
      ('products', 'product'), ('storefronts', 'storefront'), ('artifacts', 'artifact')
    ) as t (tbl, kind)
  loop
    execute format('drop trigger if exists %I on public.%I', target.tbl || '_guard_moderation', target.tbl);
    execute format('drop trigger if exists %I on public.%I', target.tbl || '_moderation_gate', target.tbl);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.moderation_gate(%L)',
      target.tbl || '_moderation_gate', target.tbl, target.kind);
    execute format('drop trigger if exists %I on public.%I', target.tbl || '_moderation_approval', target.tbl);
    execute format(
      'create trigger %I after update of moderation_status on public.%I for each row execute function public.moderation_remember_approval(%L)',
      target.tbl || '_moderation_approval', target.tbl, target.kind);
  end loop;
end
$$;

-- Superseded on these three tables by moderation_gate, and attached nowhere
-- else.
drop function if exists public.guard_moderation_columns();

-- ---- 6. What the checker calls ------------------------------------------------------------

-- The parts of content that is about to be written: the stored row (none for
-- an insert) with the caller's changes laid over it. Lets a server action have
-- the new words and photos judged BEFORE the write, so a clean edit to a live
-- listing passes the gate inline and is never hidden at all.
create or replace function public.moderation_preview(p_type text, p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_table text := public.moderation_table(p_type);
  v_row   jsonb := '{}'::jsonb;
begin
  if v_table is null then
    raise exception 'Unknown moderation target %', p_type using errcode = '22023';
  end if;
  if p_id is not null then
    execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_table)
      into v_row using p_id;
  end if;
  return public.moderation_parts(
    public.moderation_doc(
      coalesce(v_row, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb),
      public.moderation_columns(p_type)));
end;
$$;

-- One stored row as the checker needs it: its parts, and the revision they
-- were read at.
create or replace function public.moderation_claim(p_type text, p_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_table text := public.moderation_table(p_type);
  v_row   jsonb;
begin
  if v_table is null then
    raise exception 'Unknown moderation target %', p_type using errcode = '22023';
  end if;
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_table)
    into v_row using p_id;
  if v_row is null then
    return null;
  end if;
  return public.moderation_parts(
           public.moderation_doc(v_row, public.moderation_columns(p_type)))
    || jsonb_build_object(
         'rev', (v_row ->> 'moderation_rev')::integer,
         'status', v_row ->> 'moderation_status',
         'checked', (v_row ->> 'moderation_checked_at') is not null,
         'owner_id', v_row ->> 'owner_id',
         'title', coalesce(v_row ->> 'title', v_row ->> 'name', ''));
end;
$$;

-- Apply the outcome for one row, from the approved list and nothing else.
--
--   every part clean        -> 'ok'
--   any part a violation    -> an automated pause with a decision row
--                              (products, storefronts) or a removal (artifacts)
--   anything else           -> 'review'
--
-- p_ground and p_fields describe a violation in the seller's terms; they are
-- the caller's to supply because the fix-field vocabulary lives in the app.
-- They cannot make anything public: only the approved list can.
create or replace function public.moderation_settle(
  p_type   text,
  p_id     uuid,
  p_rev    integer,
  p_ground text default null,
  p_fields text[] default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_table      text := public.moderation_table(p_type);
  v_row        jsonb;
  v_status     text;
  v_parts      jsonb;
  v_missing    integer;
  v_violations integer;
  v_ground     text;
  v_fields     text[];
  v_decision   uuid;
begin
  if v_table is null then
    raise exception 'Unknown moderation target %', p_type using errcode = '22023';
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.id = $1 for update', v_table)
    into v_row using p_id;
  if v_row is null then
    return jsonb_build_object('outcome', 'gone');
  end if;
  if (v_row ->> 'moderation_rev')::integer is distinct from p_rev then
    return jsonb_build_object('outcome', 'stale');
  end if;

  -- Only content that is waiting: 'pending', or live but never checked.
  v_status := v_row ->> 'moderation_status';
  if not (v_status = 'pending'
          or (v_status = 'ok' and (v_row ->> 'moderation_checked_at') is null)) then
    return jsonb_build_object('outcome', 'settled', 'status', v_status);
  end if;

  v_parts := public.moderation_parts(
    public.moderation_doc(v_row, public.moderation_columns(p_type)));

  select
    count(*) filter (where c.subject is null),
    count(*) filter (where c.verdict = 'violation')
    into v_missing, v_violations
  from public.moderation_subjects(v_parts) as s (subject)
  left join public.moderation_checks c on c.subject = s.subject;

  -- A part nobody has judged yet: not an outcome, the checker is not done.
  if v_missing > 0 then
    return jsonb_build_object('outcome', 'unchecked');
  end if;

  if public.moderation_all_clear(public.moderation_doc(v_row, public.moderation_columns(p_type))) then
    execute format(
      'update public.%I set moderation_status = ''ok'', moderation_checked_at = now() where id = $1',
      v_table) using p_id;
    return jsonb_build_object('outcome', 'ok');
  end if;

  if v_violations = 0 then
    execute format(
      'update public.%I set moderation_status = ''review'', moderated_at = now(), moderation_checked_at = now() where id = $1',
      v_table) using p_id;
    return jsonb_build_object(
      'outcome', 'review',
      'owner_id', v_row ->> 'owner_id',
      'title', coalesce(v_row ->> 'title', v_row ->> 'name', ''));
  end if;

  -- The caller's ground if it is one, else the most urgent the classifier gave.
  select coalesce(
    (select g from unnest(array[p_ground]) as g
      where g in ('illegal', 'sexual', 'violence', 'hate', 'counterfeit', 'scam', 'spam', 'other')),
    (select c.ground
       from public.moderation_subjects(v_parts) as s (subject)
       join public.moderation_checks c on c.subject = s.subject
      where c.verdict = 'violation' and c.ground is not null
      order by array_position(
        array['illegal', 'sexual', 'violence', 'hate', 'counterfeit', 'scam', 'spam', 'other'],
        c.ground)
      limit 1),
    'other')
    into v_ground;

  if p_type = 'artifact' then
    execute format(
      'update public.%I set moderation_status = ''removed'', moderation_ground = $2, moderation_note = null, moderated_at = now(), moderated_by = null, moderation_checked_at = now() where id = $1',
      v_table) using p_id, v_ground;
    return jsonb_build_object(
      'outcome', 'removed', 'ground', v_ground,
      'owner_id', v_row ->> 'owner_id',
      'title', coalesce(v_row ->> 'title', ''));
  end if;

  v_fields := case
    when p_fields is null or cardinality(p_fields) = 0 then array['other']
    else p_fields
  end;

  insert into public.moderation_decisions (
    target_type, target_id, owner_id, target_title, action, ground, fields, automated
  ) values (
    p_type, p_id, (v_row ->> 'owner_id')::uuid,
    left(coalesce(nullif(v_row ->> 'title', ''), nullif(v_row ->> 'name', ''), '(untitled)'), 300),
    'paused', v_ground, v_fields, true
  )
  returning id into v_decision;

  execute format(
    'update public.%I set moderation_status = ''paused'', moderation_ground = $2, moderation_note = null, moderated_at = now(), moderated_by = null, moderation_review_requested_at = null, moderation_fields = $3, moderation_decision_id = $4, moderation_checked_at = now() where id = $1',
    v_table) using p_id, v_ground, v_fields, v_decision;

  return jsonb_build_object(
    'outcome', 'paused', 'ground', v_ground, 'fields', to_jsonb(v_fields),
    'decision_id', v_decision,
    'owner_id', v_row ->> 'owner_id',
    'title', coalesce(v_row ->> 'title', v_row ->> 'name', ''));
end;
$$;

-- The sweep's worklist: what is waiting on the check, oldest first. Covers
-- every row an app wrote without calling the checker, every row whose check
-- failed or timed out, and the audit of content from before the wall.
create or replace function public.moderation_due(p_limit integer default 20)
returns table (target_type text, target_id uuid)
language sql
stable
set search_path = ''
as $$
  select due.target_type, due.target_id
  from (
    select 'product'::text as target_type, p.id as target_id, p.updated_at
      from public.products p
     where p.moderation_status = 'pending'
        or (p.moderation_status = 'ok' and p.moderation_checked_at is null)
    union all
    select 'storefront', s.id, s.updated_at
      from public.storefronts s
     where s.moderation_status = 'pending'
        or (s.moderation_status = 'ok' and s.moderation_checked_at is null)
    union all
    select 'artifact', a.id, a.updated_at
      from public.artifacts a
     where a.moderation_status = 'pending'
        or (a.moderation_status = 'ok' and a.moderation_checked_at is null)
  ) as due
  order by due.updated_at
  limit greatest(1, least(coalesce(p_limit, 20), 200))
$$;

-- When the policy changes: forget what the classifier said (a person's
-- approvals stand) and put every live row back on the audit list. Nothing is
-- hidden by this; rows stay live while they are looked at again.
create or replace function public.moderation_recheck_all()
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.moderation_checks where source = 'model';
  update public.products set moderation_checked_at = null where moderation_status = 'ok';
  update public.storefronts set moderation_checked_at = null where moderation_status = 'ok';
  update public.artifacts set moderation_checked_at = null where moderation_status = 'ok';
end;
$$;

-- ---- 7. Seller text on the profile ---------------------------------------------------------------
-- The trader name, the bio and the shipping terms print on every product page
-- a seller has, so they are checked too. They are short, text only and rarely
-- edited, so they take the simpler rule: the server checks the words first and
-- then writes them, and nobody else may. No state, and a settings edit can
-- never blink a whole store out.

create or replace function public.guard_seller_text()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  trusted boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
begin
  if trusted then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.tax_business_name is not null
       or new.seller_bio is not null
       or new.shipping_policy is not null then
      raise exception 'Seller text is checked before it is saved, not set directly.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.tax_business_name is distinct from old.tax_business_name then
    raise exception 'Seller text is checked before it is saved, not set directly (column tax_business_name).'
      using errcode = '42501';
  end if;
  if new.seller_bio is distinct from old.seller_bio then
    raise exception 'Seller text is checked before it is saved, not set directly (column seller_bio).'
      using errcode = '42501';
  end if;
  if new.shipping_policy is distinct from old.shipping_policy then
    raise exception 'Seller text is checked before it is saved, not set directly (column shipping_policy).'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_seller_text() is
  'Only the service role may write the buyer-facing seller text on profiles (trader name, bio, shipping terms): the server has the words checked first. Attached to profiles.';

drop trigger if exists profiles_guard_seller_text on public.profiles;
create trigger profiles_guard_seller_text
  before insert or update on public.profiles
  for each row execute function public.guard_seller_text();

-- ---- 8. Access --------------------------------------------------------------------------------
-- Creating a function in this project grants EXECUTE to anon and authenticated
-- as a side effect (the PostgREST auto-grant trap), so every one is revoked by
-- name. None of them is for a browser.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.moderation_columns(text)',
    'public.moderation_table(text)',
    'public.moderation_doc(jsonb, text[])',
    'public.moderation_leaves(jsonb)',
    'public.moderation_parts(jsonb)',
    'public.moderation_subjects(jsonb)',
    'public.moderation_all_clear(jsonb)',
    'public.moderation_gate()',
    'public.moderation_remember_approval()',
    'public.moderation_preview(text, uuid, jsonb)',
    'public.moderation_claim(text, uuid)',
    'public.moderation_settle(text, uuid, integer, text, text[])',
    'public.moderation_due(integer)',
    'public.moderation_recheck_all()',
    'public.guard_seller_text()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (pending) storefront_funnel_daily =====================================
-- supabase/migrations/20261012_storefront_funnel_daily.sql, replayed verbatim.
-- NOT in prod as of 2026-10-10. Nothing reads it until it is: the analytics
-- page's funnel read soft-fails without the function.
-- =============================================================================
-- =============================================================================
-- STOREFRONT FUNNEL, DAILY: the lasting record of the buyer funnel.
--
-- WHERE THE NUMBERS COME FROM. The steps a buyer takes on the way to paying
-- (a payment page opened, a payment page left unpaid, ...) are written by the
-- server as data points in Workers Analytics Engine
-- (src/lib/analytics/funnel/record.ts). Analytics Engine keeps 90 days. Once a
-- day a scheduled job (src/lib/analytics/funnel/rollup.ts) counts each
-- finished day there and stores the counts here, so a seller's history does
-- not end at day 91.
--
-- ONE ROW = one seller, store, product, day, event, site and placement, and how
-- many times it happened. COUNTS ONLY. There is no visitor, no IP, no user
-- agent, no address and no amount in this table, and no column one could go
-- in. `referrer_host` is a bare hostname (the CHECK below cannot be satisfied
-- by an address, a path or a port).
--
-- NOT seller_funnel_events. That table is the PLANS funnel (a seller upgrading
-- their own plan, 20260930_seller_plans). This one is about a seller's buyers.
--
-- SECURITY MODEL. Read like storefront_signals: the owner, and their team with
-- `store.read`. No client-facing role can write: the only writer is
-- storefront_funnel_roll_day, service role only. A table a seller could write
-- is a conversion rate a seller could make up.
--
-- TIME. UTC days, like every other aggregate here.
-- =============================================================================

create table if not exists public.storefront_funnel_daily (
  -- The seller whose numbers these are. Their account going takes them along.
  seller_id     uuid not null references public.profiles(id) on delete cascade,

  -- Plain ids, deliberately not foreign keys: a storefront or product deleted
  -- later must not rewrite last quarter's totals, and a day's rollup must not
  -- fail because one product in it is gone.
  store_id      uuid not null,
  product_id    uuid not null,

  day           date not null,

  -- MIRROR of FUNNEL_EVENTS in src/lib/analytics/funnel/events.ts. Edit both
  -- together.
  event         text not null
    check (event in (
      'embed_view','product_open','add_to_cart',
      'checkout_started','order_paid','checkout_expired'
    )),

  -- The host of the seller's site it happened on, '' when not known. Hostname
  -- only: lowercase labels and dots, so nothing longer than a name fits.
  referrer_host text not null default ''
    check (
      char_length(referrer_host) <= 253
      and referrer_host ~ '^$|^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$'
    ),

  -- The placement an embed names itself with, '' when it has none.
  placement_id  text not null default ''
    check (char_length(placement_id) <= 64 and placement_id ~ '^[A-Za-z0-9_-]*$'),

  -- How many times, that day.
  events        bigint not null check (events >= 0),

  primary key (seller_id, day, event, store_id, product_id, referrer_host, placement_id)
);

comment on table public.storefront_funnel_daily is
  'Daily counts of buyer funnel events per seller, store, product, site and placement, rolled up from Workers Analytics Engine. Counts only: no visitor, IP or amount. Written by storefront_funnel_roll_day (service role); read by the owner and their team via RLS.';
comment on column public.storefront_funnel_daily.referrer_host is
  'Hostname of the seller site the event happened on, or empty. Never an address, a path or a port.';

-- ---- RLS: read like storefront_signals, written by nobody a browser can be ----
alter table public.storefront_funnel_daily enable row level security;

drop policy if exists storefront_funnel_daily_select_member on public.storefront_funnel_daily;
create policy storefront_funnel_daily_select_member
  on public.storefront_funnel_daily
  for select
  to authenticated
  using (
    seller_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(seller_id), 'store.read')
  );

-- No insert/update/delete policy, and none should exist. The revokes are on top
-- of that, because Supabase's default privileges grant table access to anon
-- and authenticated.
revoke all on table public.storefront_funnel_daily from anon;
revoke insert, update, delete, truncate on table public.storefront_funnel_daily
  from authenticated;
grant select on table public.storefront_funnel_daily to authenticated;

-- ---- The writer: one finished day, replaced whole --------------------------------
-- The job hands over EVERYTHING Analytics Engine holds for one day, and that
-- day's rows here become exactly that. Replacing rather than adding is what
-- makes the job safe to run twice, or late: the second run writes the same
-- rows. A seller who no longer exists is skipped, not an error.
--
-- p_rows: [{seller_id, store_id, product_id, event, referrer_host,
--           placement_id, events}], already validated by the job; the table's
-- CHECKs refuse anything that was not.
create or replace function public.storefront_funnel_roll_day(p_day date, p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  written integer;
begin
  delete from public.storefront_funnel_daily d where d.day = p_day;

  insert into public.storefront_funnel_daily
    (seller_id, store_id, product_id, day, event, referrer_host, placement_id, events)
  select
    r.seller_id, r.store_id, r.product_id, p_day, r.event,
    coalesce(r.referrer_host, ''), coalesce(r.placement_id, ''),
    sum(r.events)::bigint
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    seller_id uuid, store_id uuid, product_id uuid, event text,
    referrer_host text, placement_id text, events bigint
  )
  where exists (select 1 from public.profiles p where p.id = r.seller_id)
  group by 1, 2, 3, 5, 6, 7;

  get diagnostics written = row_count;
  return written;
end
$$;

comment on function public.storefront_funnel_roll_day(date, jsonb) is
  'Replaces one UTC day of storefront_funnel_daily with the counts given. Idempotent. Service role only.';

revoke execute on function public.storefront_funnel_roll_day(date, jsonb)
  from public, anon, authenticated;
grant execute on function public.storefront_funnel_roll_day(date, jsonb) to service_role;

-- ---- The reader: one account, one window, counted per event ----------------------
-- SECURITY INVOKER: RLS on the table is the boundary, so a forged account id
-- returns nothing. p_from / p_to are inclusive; null = unbounded.
create or replace function public.storefront_funnel_aggregate(
  p_account_id uuid,
  p_from date default null,
  p_to   date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
select jsonb_build_object(
  'totals', coalesce((
    select jsonb_agg(jsonb_build_object('event', event, 'count', n) order by event)
    from (
      select d.event, sum(d.events)::bigint as n
      from public.storefront_funnel_daily d
      where d.seller_id = p_account_id
        and (p_from is null or d.day >= p_from)
        and (p_to is null or d.day <= p_to)
      group by d.event
    ) t
  ), '[]'::jsonb)
)
$$;

comment on function public.storefront_funnel_aggregate(uuid, date, date) is
  'Buyer funnel event counts for one account and date window, as jsonb. SECURITY INVOKER: RLS on storefront_funnel_daily is the boundary.';

-- Re-stated because Supabase re-grants execute to anon/authenticated whenever a
-- function is created or replaced.
revoke execute on function public.storefront_funnel_aggregate(uuid, date, date)
  from public, anon;
grant execute on function public.storefront_funnel_aggregate(uuid, date, date)
  to authenticated, service_role;

notify pgrst, 'reload schema';

-- ===== (pending) marketplace_moderation ======================================
-- ════════════════════════════════════════════════════════════════════
-- AUTOMATIC MODERATION, THE MARKETPLACE'S HALF.
--
-- 20261012_auto_moderation put products, storefronts and artifacts behind the
-- wall: a row is 'ok' only while every part of its content is approved. For
-- the dashboard that was enough, because its public pages are built on the
-- server and ask isContentVisible() before showing anything.
--
-- The marketplace is different in two ways, and this closes both.
--
--   1. ITS PUBLIC READS GO THROUGH RLS. An anonymous visitor reads artifacts
--      straight from the database, and the policy that lets them never asked
--      about moderation: a removed artifact, or one nobody had checked yet,
--      was one REST call away whatever the app chose to display. The takedown
--      gate belongs in the policy, where it cannot be forgotten.
--
--   2. ITS PUBLIC WORDS ARE NOT ALL ON A MODERATED ROW. A handle, a profile
--      picture and a collection's name are shown to everyone and live on rows
--      with no moderation state.
--
--      The handle and the picture reach the public through exactly one door,
--      the profile directory, so the door is where they are checked: it
--      admits a handle, and shows a picture, only when that exact value is on
--      the approved list. Who wrote the value does not matter, which is the
--      point. Sign-up writes both from metadata the person signing up controls
--      (and GoTrue can be called directly), so "only the server may write
--      this column" would have left the front door open.
--
--      A collection has no such door (its rows are read through RLS), so its
--      name takes the rule the trader name already does (guard_seller_text):
--      the server has it checked first and then writes it, and nobody else may.
--
-- DEPLOY ORDER, as for the wall itself: SQ-app must be live with the code that
-- names collections through the service role BEFORE this is applied, or those
-- saves are refused.
--
-- ON APPLYING IT: every profile leaves the public directory, because no handle
-- has been approved yet. Each comes back the next time its owner saves their
-- profile in an app, which is when the handle is checked. The marketplace is
-- not live, so nobody is looking.
--
-- Apply via Supabase MCP (apply_migration) or the SQL editor, after
-- 20261012_auto_moderation.
-- ════════════════════════════════════════════════════════════════════

-- ---- 1. A marketplace item is public only once approved ---------------------
-- Same two branches as before (in a public collection, or loose on a public
-- profile), now behind the one question every other surface already asks.

drop policy if exists artifacts_public_read on public.artifacts;
create policy artifacts_public_read on public.artifacts
  for select to anon, authenticated
  using (
    moderation_status = 'ok'
    and (
      (collection_id is not null and exists (
        select 1 from public.collections c
        where c.id = artifacts.collection_id and c.is_public = true
      ))
      or
      (collection_id is null and exists (
        select 1 from public.public_profiles pp where pp.id = artifacts.owner_id
      ))
    )
  );

-- ---- 2. The handle and the profile picture ------------------------------------
-- The directory's one writer (20260924_public_profiles_invoker), now asking
-- the approved list first. The subjects are worked out from the stored value
-- itself, so an approval is for exactly these characters and exactly this URL:
--
--   handle:<lowercased handle>     recorded by the app that checked it
--   avatar:<avatar_url, verbatim>  recorded for a picture the platform stored
--                                  (a URL nobody else can change the bytes of)
--
-- No approved handle: the profile is not in the directory, so it is not public
-- and its loose artifacts are not either (artifacts_public_read above).
-- No approved picture: the profile is listed without one.

create or replace function public.sync_profile_directory()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_avatar text;
begin
  if new.is_public is true
     and new.username is not null
     and exists (
       select 1 from public.moderation_checks k
        where k.subject = 'handle:' || lower(new.username)
          and k.verdict = 'clean'
     ) then
    select new.avatar_url into v_avatar
     where new.avatar_url is not null
       and exists (
         select 1 from public.moderation_checks k
          where k.subject = 'avatar:' || new.avatar_url
            and k.verdict = 'clean'
       );
    insert into public.profile_directory (id, username, avatar_url)
    values (new.id, new.username, v_avatar)
    on conflict (id) do update
      set username = excluded.username,
          avatar_url = excluded.avatar_url;
  else
    delete from public.profile_directory where id = new.id;
  end if;
  return null;
end;
$$;

comment on function public.sync_profile_directory() is
  'The public directory''s only writer. Admits a profile when it is public AND its handle is approved (moderation_checks, handle:<lowercased>), and carries its picture only when that URL is approved (avatar:<url>).';

revoke execute on function public.sync_profile_directory() from public, anon, authenticated;

-- What is already listed was never checked: out it goes, until it is.
delete from public.profile_directory d
 where not exists (
   select 1 from public.moderation_checks k
    where k.subject = 'handle:' || lower(d.username) and k.verdict = 'clean'
 );

update public.profile_directory d
   set avatar_url = null
 where d.avatar_url is not null
   and not exists (
     select 1 from public.moderation_checks k
      where k.subject = 'avatar:' || d.avatar_url and k.verdict = 'clean'
   );

-- A policy change re-judges rows, because the sweep can find them again. A
-- handle or a picture has no row to find, so its approval stays: forgetting it
-- would not get it looked at, only drop the profile out of the directory at
-- its owner's next save.
create or replace function public.moderation_recheck_all()
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.moderation_checks
   where source = 'model'
     and subject not like 'handle:%'
     and subject not like 'avatar:%';
  update public.products set moderation_checked_at = null where moderation_status = 'ok';
  update public.storefronts set moderation_checked_at = null where moderation_status = 'ok';
  update public.artifacts set moderation_checked_at = null where moderation_status = 'ok';
end;
$$;

revoke execute on function public.moderation_recheck_all() from public, anon, authenticated;
grant execute on function public.moderation_recheck_all() to service_role;

-- ---- 3. A collection's name -----------------------------------------------------
-- The one piece of free text on a collection, shown on the public grid and in
-- search. A client may still reorder a collection or flip it between public
-- and private; naming one is the server's, after the name has been checked.

create or replace function public.guard_collection_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' or new.name is distinct from old.name then
    raise exception 'A collection''s name is checked before it is saved, not set directly.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_collection_name() is
  'Only the service role may create a collection or rename one: the server has the name checked first. Attached to collections.';

drop trigger if exists collections_guard_name on public.collections;
create trigger collections_guard_name
  before insert or update on public.collections
  for each row execute function public.guard_collection_name();

revoke execute on function public.guard_collection_name() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) removed_content_frees_plan_room ============================
-- supabase/migrations/20261019_removed_content_frees_plan_room.sql, replayed
-- verbatim. Applied to prod 2026-10-19 through the Management API query
-- endpoint, which records no migration version. `pnpm check:schema` is what
-- confirms it is there.
-- =============================================================================
-- Products and storefronts that moderation has REMOVED stop counting against
-- the plan's cap.
--
-- WHY. A removal is final for the seller: the moderation gate
-- (20261012_auto_moderation, moderation_gate) leaves a removed row removed
-- whatever the seller saves, and only a trusted writer (staff deciding an
-- appeal) can put it back. Yet the cap counted it, so a Free seller with three
-- removed products had 17 places for 20, and nothing to do about it but delete
-- the evidence of a decision they might be appealing.
--
-- WHY THIS CANNOT BE GAMED.
--   - A seller cannot mark anything removed: every seller write to a
--     moderation_* column is refused by moderation_gate (errcode 42501), and an
--     INSERT has its moderation state reset to 'pending'.
--   - A removed row cannot come back by the seller's hand: editing it keeps it
--     removed (the gate returns early for 'removed').
--   - Only removal frees a place. A draft, a row still being checked, one
--     waiting for a person ('review') and a PAUSED one all still count: the
--     seller can bring a paused row back by changing it.
--   - If staff restore a row on appeal while the account is at its cap, the
--     account is over the cap until it deletes something: the count includes
--     the row again, so nothing new can be created meanwhile.
--
-- Same function as 20261002_product_limits, with the two counts changed; the
-- triggers that call it are unchanged. Mirrored in src/lib/billing/limits.ts
-- (countPlanUsage), which the app asks before writing.

create or replace function public.enforce_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limit_key text := tg_argv[0];
  owner uuid;
  cap integer;
  used integer;
begin
  -- The owner's own seat is always there (it is seeded at signup); only a seat
  -- for someone else, and only one that is live (invited or active), takes
  -- one of the plan's. Decided first: it needs no claims at all. (Nested, not
  -- ANDed: plpgsql does not short-circuit, and other tables have no role.)
  if tg_table_name = 'team_members' then
    if new.role = 'owner' or new.status not in ('invited', 'active') then
      return new;
    end if;
  end if;

  if coalesce((select auth.role()), '') <> 'authenticated' then
    return new;
  end if;

  -- Off until paid plans can be bought (see billing_switches).
  if not coalesce((select s.plan_limits_enforced from public.billing_switches s where s.id), false) then
    return new;
  end if;

  if tg_table_name in ('storefronts', 'products') then
    -- An UPDATE only reaches here when owner_id changed (see the triggers):
    -- a row moved INTO an account counts against that account.
    if tg_op = 'UPDATE' then
      if new.owner_id is not distinct from old.owner_id then
        return new;
      end if;
    end if;
    owner := new.owner_id;
  elsif tg_table_name = 'team_members' then
    -- Re-activating a revoked row adds a seat, and so does moving a live row
    -- to another account; editing a live row in place does not.
    -- (Nested, not ANDed: OLD only exists for an UPDATE.)
    if tg_op = 'UPDATE' then
      if old.status in ('invited', 'active')
         and new.account_owner_id is not distinct from old.account_owner_id then
        return new;
      end if;
    end if;
    owner := new.account_owner_id;
  else
    raise exception 'enforce_plan_limit: unsupported table %', tg_table_name;
  end if;

  cap := public.plan_limit(public.account_plan(owner), limit_key);
  if cap is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('plan_limit:' || limit_key || ':' || owner::text, 0));

  -- What moderation has removed for good takes no place (see the top of
  -- 20261019_removed_content_frees_plan_room). Everything else does, drafts
  -- and paused rows included.
  if tg_table_name = 'storefronts' then
    select count(*) into used from public.storefronts s
     where s.owner_id = owner and s.moderation_status is distinct from 'removed';
  elsif tg_table_name = 'products' then
    select count(*) into used from public.products p
     where p.owner_id = owner and p.moderation_status is distinct from 'removed';
  else
    select count(*) into used
      from public.team_members tm
     where tm.account_owner_id = owner
       and tm.status in ('invited', 'active');
  end if;

  if used >= cap then
    raise exception 'plan_limit_reached:%', limit_key using errcode = '23514';
  end if;
  return new;
end
$$;

-- Unchanged, and restated: a function's privileges are its own, and this one
-- is only ever run by its triggers.
revoke execute on function public.enforce_plan_limit() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) plan_grants ==================================================
-- supabase/migrations/20261019_plan_grants.sql, replayed
-- verbatim. Applied to prod 2026-10-20 through the Management API query
-- endpoint, which records no migration version. `pnpm check:schema` is what
-- confirms it is there.
-- =============================================================================
-- Plan grants: staff put an account on a paid plan, for as long as they choose,
-- without Stripe.
--
-- WHY. Until now the only way onto Starter or Pro was paying for it
-- (seller_billing, written from Stripe's webhook). During the beta, and
-- after it, staff need to give a plan away: to beta testers, founding
-- sellers, partners, a seller support wants to make good to, or a test
-- account. A grant is that, and nothing a seller can do or see changes it.
--
-- WHAT THIS ADDS
--   1. plan_grants: one row per account, the grant it has (or last had). The
--      plan, when it started, when it ends (null = until staff end it), why,
--      and which staff member set it. History (every grant, extension and end)
--      is the admin panel's audit log; this row is only the current state.
--   2. account_plan() now answers the HIGHER of the paid plan and an active
--      grant. It is what the plan-limit triggers ask. Its TypeScript twin is
--      readAccountBilling (src/lib/billing/account-plan.ts), which applies
--      the same rule through grantedPlan() (src/lib/billing/grants.ts).
--   3. plan_grant_set() and plan_grant_end(): the admin panel's two writes,
--      for one account or many at once.
--
-- WHY NOT A ROW IN seller_billing. That table is a mirror of Stripe: the
-- webhook overwrites it from a fresh fetch, its customer id must be a real
-- cus_..., and the admin panel counts it as revenue. A granted plan is none
-- of those things, so it lives apart and is combined only when read.
--
-- WRITES. Service role only, like seller_billing: RLS on, no policy, every
-- client grant revoked. A seller who could write here could give themselves
-- Pro. The admin panel writes through the two functions below.
--
-- MIRRORS, each to be edited in the same change as its twin
-- (tests/integration/39-plan-grants.test.ts compares them):
--   plan_grants_reason_check <-> GRANT_REASONS in src/lib/billing/grants.ts
--                                and the admin panel's lib/plans/grants.ts
--
-- DEPLOY ORDER: either way round. The app reads this table and treats a
-- missing one as "no grants"; the old app never reads it. Apply this, then
-- the admin panel's 0009_plan_directory.sql, which reads it.
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. plan_grants -----------------------------------------------------------------

create table if not exists public.plan_grants (
  owner_id   uuid primary key references public.profiles (id) on delete cascade,
  plan       text not null,
  reason     text not null,
  -- For staff only: the seller never sees it.
  note       text,
  starts_at  timestamptz not null default now(),
  -- Null: no end date, the grant holds until staff end it.
  ends_at    timestamptz,
  -- The staff member's auth user id. No foreign key: staff come and go, and
  -- the audit log is the record of who did what.
  granted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Free is the absence of a grant, never a stored value.
  constraint plan_grants_plan_check check (plan in ('starter', 'pro')),
  -- MIRROR of GRANT_REASONS in src/lib/billing/grants.ts.
  constraint plan_grants_reason_check
    check (reason in ('beta_tester', 'founding_seller', 'support', 'partner', 'promotion', 'internal', 'other')),
  constraint plan_grants_note_length check (note is null or char_length(note) <= 500),
  constraint plan_grants_period check (ends_at is null or ends_at >= starts_at)
);

comment on table public.plan_grants is
  'A paid plan given by staff, without Stripe: one row per account, the grant it has or last had. Active while starts_at <= now() and (ends_at is null or ends_at > now()). Combined with seller_billing by account_plan() and readAccountBilling: the higher plan wins. Written only through plan_grant_set / plan_grant_end. Service role only.';
comment on column public.plan_grants.ends_at is
  'When the grant stops applying. Null = no end date (until staff end it). Ending a grant early sets this to the moment it was ended.';
comment on column public.plan_grants.note is
  'Staff-only context for the grant. Never shown to the seller.';

alter table public.plan_grants enable row level security;
revoke all on table public.plan_grants from public, anon, authenticated;
grant all on table public.plan_grants to service_role;

-- ---- 2. The plan in force -------------------------------------------------------------

-- The SQL twin of readAccountBilling's plan: the higher of the paid plan
-- (until paid_until) and an active grant, Free with neither. Same signature
-- and grants as 20260930_seller_plans; only the body changes.
create or replace function public.account_plan(p_owner uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case greatest(
      (select case b.plan when 'pro' then 2 when 'starter' then 1 else 0 end
         from public.seller_billing b
        where b.owner_id = p_owner
          and b.plan is not null
          and b.paid_until > now()),
      (select case g.plan when 'pro' then 2 when 'starter' then 1 else 0 end
         from public.plan_grants g
        where g.owner_id = p_owner
          and g.starts_at <= now()
          and (g.ends_at is null or g.ends_at > now())),
      0)
    when 2 then 'pro'
    when 1 then 'starter'
    else 'free'
  end
$$;

revoke execute on function public.account_plan(uuid) from public, anon, authenticated;
grant execute on function public.account_plan(uuid) to service_role;

comment on function public.account_plan(uuid) is
  'free | starter | pro: the plan an account is on now, the higher of its paid plan (until paid_until) and an active plan grant. Service role only.';

-- ---- 3. The admin panel's writes ---------------------------------------------------------

-- Give `p_plan` to every account in `p_owners`, until `p_ends_at` (null = no
-- end date). An account with an ACTIVE grant keeps its start date (this is an
-- extension or a change of plan); any other account starts now. Ids with no
-- profile are skipped, so the caller compares what comes back with what it
-- sent. Returns, per account written, the grant as it was before, for the
-- audit log.
--
-- Plain SECURITY INVOKER: only the service role may execute it, and the
-- service role already bypasses RLS. The row lock serialises two staff
-- members writing the same account.
create or replace function public.plan_grant_set(
  p_owners uuid[],
  p_plan text,
  p_ends_at timestamptz,
  p_reason text,
  p_note text,
  p_actor uuid
)
returns table (owner_id uuid, previous_plan text, previous_ends_at timestamptz, was_active boolean)
language plpgsql
set search_path = ''
as $$
declare
  target uuid;
  before_row public.plan_grants%rowtype;
  active boolean;
begin
  if p_ends_at is not null and p_ends_at <= now() then
    raise exception 'plan_grant_ends_in_past' using errcode = '22023';
  end if;
  if coalesce(array_length(p_owners, 1), 0) > 500 then
    raise exception 'plan_grant_too_many' using errcode = '22023';
  end if;

  for target in select distinct o from unnest(p_owners) as o where o is not null loop
    if not exists (select 1 from public.profiles p where p.id = target) then
      continue;
    end if;

    select * into before_row from public.plan_grants g where g.owner_id = target for update;
    active := found
      and before_row.starts_at <= now()
      and (before_row.ends_at is null or before_row.ends_at > now());

    insert into public.plan_grants as g (owner_id, plan, reason, note, starts_at, ends_at, granted_by, updated_at)
    values (target, p_plan, p_reason, nullif(btrim(p_note), ''), now(), p_ends_at, p_actor, now())
    on conflict on constraint plan_grants_pkey do update set
      plan       = excluded.plan,
      reason     = excluded.reason,
      note       = excluded.note,
      starts_at  = case when active then g.starts_at else now() end,
      ends_at    = excluded.ends_at,
      granted_by = excluded.granted_by,
      updated_at = now();

    owner_id := target;
    previous_plan := case when active then before_row.plan end;
    previous_ends_at := case when active then before_row.ends_at end;
    was_active := active;
    return next;
  end loop;
end
$$;

revoke execute on function public.plan_grant_set(uuid[], text, timestamptz, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.plan_grant_set(uuid[], text, timestamptz, text, text, uuid) to service_role;

comment on function public.plan_grant_set(uuid[], text, timestamptz, text, text, uuid) is
  'Admin panel write: give a plan to one or more accounts until a date (null = no end date). Keeps the start of an active grant. Returns the grant each account had before. Service role only.';

-- End the active grant of every account in `p_owners` now. Accounts with no
-- active grant are left alone and not returned. The row stays, ended, so the
-- seller's page can say when it stopped.
create or replace function public.plan_grant_end(p_owners uuid[], p_actor uuid)
returns table (owner_id uuid, previous_plan text, previous_ends_at timestamptz)
language sql
set search_path = ''
as $$
  with ended as (
    select g.owner_id, g.plan, g.ends_at
      from public.plan_grants g
     where g.owner_id = any (p_owners)
       and g.starts_at <= now()
       and (g.ends_at is null or g.ends_at > now())
       for update
  )
  update public.plan_grants g
     set ends_at = now(), granted_by = p_actor, updated_at = now()
    from ended e
   where g.owner_id = e.owner_id
  returning e.owner_id, e.plan, e.ends_at
$$;

revoke execute on function public.plan_grant_end(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.plan_grant_end(uuid[], uuid) to service_role;

comment on function public.plan_grant_end(uuid[], uuid) is
  'Admin panel write: end the active plan grant of one or more accounts now. Returns the grants it ended. Service role only.';

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) admin_plan_directory =========================================
-- Admin repo: supabase/migrations/0009_plan_directory.sql, replayed
-- verbatim. The admin panel's read model over plan_grants. Applied to prod
-- 2026-10-20 through the Management API query endpoint, after plan_grants.
-- =============================================================================
-- Prod's admin_user_directory, as the admin panel's 0004_admin_directory_avatar
-- and 0005_admin_directory_activity left it (checked against prod 2026-10-19).
-- This replica never replayed those two, and the view below reads both columns.
create or replace view public.admin_user_directory as
  select
    u.id,
    u.email::text as email,
    coalesce(
      p.username,
      u.raw_user_meta_data ->> 'username',
      u.raw_user_meta_data ->> 'name',
      u.raw_user_meta_data ->> 'full_name'
    ) as username,
    u.created_at,
    u.banned_until,
    u.email_confirmed_at,
    p.id is not null as is_seller,
    coalesce(
      p.avatar_url,
      u.raw_user_meta_data ->> 'avatar_url',
      u.raw_user_meta_data ->> 'picture'
    ) as avatar_url,
    u.last_sign_in_at
  from auth.users u
  left join public.profiles p on p.id = u.id;

-- ====================================================================
-- Plans: every account's plan in one list, for the admin's /plans page.
--
-- One row per account (admin_user_directory), with:
--   - what it pays for, from seller_billing (Stripe's mirror);
--   - what staff gave it, from plan_grants (SQ-store's
--     20261019_plan_grants.sql, which must be applied first);
--   - the plan in force now and where it comes from, by the SAME rule as the
--     store's account_plan() and readAccountBilling: the higher of the paid
--     plan (until paid_until) and an active grant. A tie goes to "paid":
--     the seller is paying for it, and the grant is then only a safety net;
--   - how much of the store there is (storefronts, products), so staff can
--     see who is actually using what they were given.
--
-- plan_until is when the plan in force stops: paid_until for a paid plan,
-- the grant's end for a granted one (null = no end date), null on Free.
--
-- SECURITY. security_invoker, so it reads with the caller's rights, and
-- SELECT for service_role only: PostgREST grants every new view to anon and
-- authenticated (with write rights, on a simple view), so both revokes are
-- required. The rows include every account's email address.
--
-- Read-only and additive: safe to re-run.
-- ====================================================================

create or replace view public.admin_plan_directory
with (security_invoker = true) as
  select
    d.id,
    d.email,
    d.username,
    d.avatar_url,
    d.created_at,
    d.last_sign_in_at,
    d.banned_until,
    d.is_seller,
    -- Paid (Stripe).
    b.plan                 as paid_plan,
    b.status               as paid_status,
    b.billing_interval     as paid_interval,
    b.price_cents          as paid_price_cents,
    b.currency             as paid_currency,
    b.paid_until,
    b.cancel_at_period_end as paid_cancel_at_period_end,
    b.livemode             as paid_livemode,
    -- Granted (staff).
    g.plan                 as grant_plan,
    g.reason               as grant_reason,
    g.note                 as grant_note,
    g.starts_at            as grant_starts_at,
    g.ends_at              as grant_ends_at,
    g.granted_by           as grant_granted_by,
    g.updated_at           as grant_updated_at,
    r.grant_rank > 0       as grant_active,
    -- In force now.
    case greatest(r.paid_rank, r.grant_rank) when 2 then 'pro' when 1 then 'starter' else 'free' end
                           as effective_plan,
    case
      when r.paid_rank = 0 and r.grant_rank = 0 then 'free'
      when r.paid_rank >= r.grant_rank then 'paid'
      else 'granted'
    end                    as plan_source,
    case
      when r.paid_rank = 0 and r.grant_rank = 0 then null
      when r.paid_rank >= r.grant_rank then b.paid_until
      else g.ends_at
    end                    as plan_until,
    -- The store.
    (select count(*) from public.storefronts s
      where s.owner_id = d.id and s.moderation_status is distinct from 'removed')::integer as storefront_count,
    (select count(*) from public.products p
      where p.owner_id = d.id and p.moderation_status is distinct from 'removed')::integer as product_count
  from public.admin_user_directory d
  left join public.seller_billing b on b.owner_id = d.id
  left join public.plan_grants g on g.owner_id = d.id
  cross join lateral (
    select
      case when b.plan is not null and b.paid_until > now()
           then case b.plan when 'pro' then 2 when 'starter' then 1 else 0 end
           else 0 end as paid_rank,
      case when g.owner_id is not null and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
           then case g.plan when 'pro' then 2 when 'starter' then 1 else 0 end
           else 0 end as grant_rank
  ) r;

revoke all on table public.admin_plan_directory from public, anon, authenticated;
grant select on table public.admin_plan_directory to service_role;

comment on view public.admin_plan_directory is
  'Admin /plans: every account with its paid plan, its staff grant, the plan in force now (the higher of the two) and where it comes from. Service role only.';

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) rl_take keeps history =======================================
-- supabase/migrations/20261021_rl_take_keeps_history.sql, replayed verbatim. Applied to prod 2026-10-21 through the
-- Management API query endpoint.
-- Security audit 2026-10-20: a caller-chosen window can no longer erase the stored log.
-- =============================================================================
-- rl_take: a caller can no longer erase their own rate-limit history.
--
-- THE HOLE (security audit 2026-10-20). rl_take is callable by `authenticated`
-- straight through PostgREST (POST /rest/v1/rpc/rl_take), and it took the
-- WINDOW from its caller. It pruned the stored hits to that window and wrote
-- the pruned array back. So one direct call with p_window_seconds = 1 deleted
-- every hit older than a second, and the server's own next check (which passes
-- the real budget from lib/rate-limit.ts RATE_LIMITS) found an empty log.
-- Every per-user limit built on rateLimit() could be reset at will: team
-- invites (mail to arbitrary addresses), badge checks (paid classifier calls),
-- password re-checks, email changes, contact-code sends, imports, uploads,
-- exports. Keyed limits (rl_take_key, service role only) were never affected.
--
-- THE FIX. Counting still uses the caller's window, exactly as before, so every
-- existing call behaves the same. What changes is what is STORED:
--   - hits are kept for at least RETENTION (24 h, the longest per-user window
--     in RATE_LIMITS: contactCodeSendDaily, mfaVerifyPerUserDaily), or for the
--     caller's window when that is longer, so no window a caller names can
--     forget a hit a real budget still needs;
--   - the stored log is capped at the MAX_KEPT most recent hits, so a caller
--     who passes an enormous p_max to a direct call can only grow their own
--     log so far (and every hit they add counts against them, never for them).
-- A direct call can therefore only ever ADD to the caller's own count.
--
-- If a budget with a window longer than 24 h is ever added to RATE_LIMITS,
-- raise RETENTION here to match (tests/integration/11 pins the reset case).
-- Same signature and grants as before, so this applies safely ahead of any
-- deploy and needs no code change.

create or replace function public.rl_take(p_action text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- How long a hit is remembered no matter what window a caller names.
  retention_seconds constant integer := 86400;
  -- The most hits a log may hold. Far above any per-user budget's max.
  max_kept constant integer := 5000;
  uid    uuid := (select auth.uid());
  cutoff timestamptz;
  keep_after timestamptz;
  kept   timestamptz[];
  counted integer;
  allowed boolean;
begin
  -- Anonymous callers get nothing: this limiter is identity-scoped by design.
  -- Unauthenticated surfaces must use rl_take_key() instead.
  if uid is null then
    return false;
  end if;

  -- Nor does a session that still owes its second factor. Otherwise someone
  -- holding only the password could drain the account's budgets (and deny
  -- the owner the very actions they reach for when they see the alert).
  if not public.mfa_session_ok() then
    return false;
  end if;

  -- Reject nonsense budgets rather than failing open.
  if p_max is null or p_max < 1 then
    return false;
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    return false;
  end if;

  cutoff := now() - make_interval(secs => p_window_seconds);
  keep_after := now() - make_interval(secs => greatest(p_window_seconds, retention_seconds));

  -- Ensure a row exists so the lock below always has one to take.
  insert into public.rate_limits (user_id, action)
  values (uid, p_action)
  on conflict (user_id, action) do nothing;

  -- Serialize concurrent takes for this (user, action) so two requests can
  -- never both read "4 hits" and both append a 5th.
  perform 1
  from public.rate_limits
  where user_id = uid and action = p_action
  for update;

  -- Prune to the RETENTION horizon (never to the caller's window), then count
  -- only the hits inside the caller's window.
  select coalesce(
           array(
             select t
             from unnest(r.hits) as t
             where t > keep_after
             order by t
           ),
           '{}'::timestamptz[]
         )
  into kept
  from public.rate_limits r
  where r.user_id = uid and r.action = p_action;

  select count(*) into counted from unnest(kept) as t where t > cutoff;
  allowed := counted < p_max;

  -- Only an ALLOWED take is recorded. Denied attempts must not extend the
  -- window, or a caller hammering the endpoint could lock themselves out
  -- indefinitely (and grow the array without bound).
  if allowed then
    kept := kept || now();
  end if;

  -- Keep the newest MAX_KEPT. Dropping the oldest can only ever lower a count
  -- that is already far past every budget.
  if coalesce(array_length(kept, 1), 0) > max_kept then
    kept := kept[array_length(kept, 1) - max_kept + 1 : array_length(kept, 1)];
  end if;

  update public.rate_limits
  set hits = kept
  where user_id = uid and action = p_action;

  return allowed;
end
$$;

-- CREATE OR REPLACE keeps existing grants, but restate them: this schema
-- auto-grants new functions to anon, and the limiter must never be anon's.
revoke execute on function public.rl_take(text, integer, integer) from public, anon;
grant execute on function public.rl_take(text, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) reserved usernames ==========================================
-- supabase/migrations/20261021_reserved_usernames.sql, replayed verbatim. Applied to prod 2026-10-21 through the
-- Management API query endpoint.
-- Security audit 2026-10-20: reserved handles refused by a CHECK; handle_new_user drops a reserved slug.
-- =============================================================================
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

-- =============================================================================
-- ===== (applied) signup intents ==============================================
-- supabase/migrations/20261021_signup_intents.sql, replayed verbatim. Applied to prod 2026-10-21 through the
-- Management API query endpoint.
-- Security audit 2026-10-20: single-use sign-up intents and the Before User Created hook function. The hook itself is enabled separately, after the deploy.
-- =============================================================================
-- =============================================================================
-- Sign-up only through the app (security audit 2026-10-20)
-- =============================================================================
-- THE HOLE. Every sign-up guard (the disposable-address block, the Turnstile
-- bot check, the per-client sign-up budget, the breached-password check) runs
-- in the app's authenticate() action before it calls supabase.auth.signUp. But
-- that same GoTrue endpoint (/auth/v1/signup, and /auth/v1/otp with
-- create_user) answers anyone holding the public anon key, with no captcha and
-- no leaked-password check of its own. A script could skip all four guards and
-- open as many accounts on throwaway addresses as it liked, choosing its own
-- signup metadata.
--
-- THE FIX, the same shape as mfa_access_token_gate (20260930): the app writes a
-- single-use INTENT (service role) only after its guards pass, just before it
-- calls signUp, keyed on a hash of the address. GoTrue's Before User Created
-- hook, public.signup_intent_gate, runs before any new user row exists and
-- refuses an email sign-up that has no fresh intent for that address. A sign-up
-- sent to GoTrue by anything other than the app creates nothing.
--
-- What it does NOT gate:
--   - OAuth sign-ups (Google): the provider vouches for the address, and the
--     app's bot check never applied to them.
--   - Existing accounts signing in: the hook only runs when a user is about to
--     be CREATED.
--
-- ROLLOUT, in this order (the hook demands what only the new build writes):
--   1. Apply this migration. Inert on its own: nothing calls the function yet.
--   2. Deploy the app that writes intents (src/lib/auth/signup-intent.ts).
--   3. Enable the hook: Auth > Hooks > Before User Created, Postgres function
--      public.signup_intent_gate (Management API: hook_before_user_created_
--      enabled=true, hook_before_user_created_uri=
--      pg-functions://postgres/public/signup_intent_gate).
--   Disabling the hook there is the kill switch.
--
-- Anything else that ever creates EMAIL users (an admin tool calling
-- auth.admin.createUser, a seed script against production) must write an
-- intent first, or switch the hook off for the run.
-- =============================================================================

create table if not exists public.signup_intents (
  id          uuid primary key default gen_random_uuid(),
  -- sha256 of the lower-cased address, hex. The address itself is never kept.
  email_hash  text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

comment on table public.signup_intents is
  'Single-use permissions to create an email account, written by the app (service role) after its sign-up guards pass and spent by the before-user-created hook (signup_intent_gate). Keyed on sha256(lower(email)). Service role only.';

create index if not exists signup_intents_lookup_idx
  on public.signup_intents (email_hash, expires_at);

alter table public.signup_intents enable row level security;
revoke all on public.signup_intents from public, anon, authenticated;
grant all on public.signup_intents to service_role;

-- The hook. SECURITY DEFINER so it can spend an intent under RLS without a
-- policy for GoTrue's role; callable by GoTrue only.
create or replace function public.signup_intent_gate(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider text := lower(coalesce(event -> 'user' -> 'app_metadata' ->> 'provider', 'email'));
  email    text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
  spent    uuid;
begin
  -- Anonymous users are switched off for this project; never create one here.
  if coalesce((event -> 'user' ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Sign up on Square Share.'));
  end if;

  -- An OAuth provider vouches for its own users.
  if provider not in ('email', 'phone') then
    return '{}'::jsonb;
  end if;

  if email <> '' then
    delete from public.signup_intents
     where id = (
       select i.id
         from public.signup_intents i
        where i.email_hash = encode(sha256(convert_to(email, 'UTF8')), 'hex')
          and i.expires_at > now()
        order by i.created_at
        limit 1
        for update skip locked
     )
    returning id into spent;
  end if;

  if spent is not null then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403, 'message', 'Sign up on Square Share.'));
end;
$$;

comment on function public.signup_intent_gate(jsonb) is
  'Before User Created hook: an email account is created only against a fresh single-use intent the app wrote after its sign-up guards passed (signup_intents). OAuth sign-ups pass through.';

revoke all on function public.signup_intent_gate(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.signup_intent_gate(jsonb) to supabase_auth_admin;
  end if;
end
$$;

notify pgrst, 'reload schema';

-- =============================================================================
-- ===== (applied) object key ownership ========================================
-- supabase/migrations/20261021_object_key_ownership.sql, replayed verbatim. Applied to prod 2026-10-21
-- through the Management API query endpoint.
-- Security review 2026-10-21: a storage key new to a product or storefront must be the writer's own upload.
-- =============================================================================
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

-- =============================================================================
-- ===== (applied) order_refund provider first =================================
-- supabase/migrations/20261021_order_refund_provider_first.sql, replayed verbatim. Applied to prod
-- 2026-10-21 through the Management API query endpoint.
-- Security review 2026-10-21: order_refund refuses an order a payment provider charged.
-- =============================================================================
-- order_refund refuses an order a payment provider charged (security review
-- 2026-10-21).
--
-- THE HOLE. order_refund is the seller's client-callable refund write
-- (EXECUTE to authenticated, self-gated on owner / orders.refund). The order
-- panel calls it only AFTER refunding with the provider (refundOrder in
-- src/lib/orders/actions.ts: "a row saying refunded over money that never went
-- back is the one outcome a buyer cannot be left with"). But a seller can also
-- call it straight through PostgREST, and for an order Stripe charged that
-- marked it refunded with the buyer's money never returned (and stock put
-- back, and the code's use given back).
--
-- THE FIX. For an order with a provider payment (payment_ref 'pi_...', mirror
-- of PROVIDER_PAYMENT_PREFIX in src/lib/orders/queries.ts) order_refund now
-- answers not_refundable. Such an order is recorded refunded only by the
-- service role: by refundOrder once the provider has refunded it, and by the
-- Connect webhook (charge.refunded), both through order_apply_refund. Orders no
-- provider charged are unchanged: the seller pays the buyer back themselves and
-- records it here, as before.

create or replace function public.order_refund(
  p_order_id uuid,
  p_reason text,
  p_restock boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  ref text;
begin
  if not public.mfa_session_ok() then
    return 'not_found';
  end if;

  select o.seller_id, o.payment_ref into owner_id, ref
    from public.orders o
   where o.id = p_order_id;

  if not found
     or not (
       owner_id = (select auth.uid())
       or public.team_role_can(public.team_actor_role(owner_id), 'orders.refund')
     ) then
    return 'not_found';
  end if;

  -- Money a provider took goes back through the provider first; the record
  -- follows from the server (service role), never from a client call.
  if ref like 'pi\_%' then
    return 'not_refundable';
  end if;

  return public.order_apply_refund(p_order_id, p_reason, p_restock);
end
$$;

-- Recreating a function re-opens it to anon in this schema: restate both ways.
revoke execute on function public.order_refund(uuid, text, boolean) from public, anon;
grant execute on function public.order_refund(uuid, text, boolean) to authenticated, service_role;

comment on function public.order_refund(uuid, text, boolean) is
  'The seller takes a paid order back (cancelled before it was sent, returned, or other), optionally restocking it. Self-gated: 2FA session bar, owner or orders.refund. An order a payment provider charged answers not_refundable: it is recorded by the server after the provider refund (order_apply_refund). Returns refunded | not_refundable | not_found.';

notify pgrst, 'reload schema';
