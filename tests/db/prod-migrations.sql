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
