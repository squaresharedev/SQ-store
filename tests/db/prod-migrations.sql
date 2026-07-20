-- =============================================================================
-- PROD MIGRATION REPLAY — SQ-store (vnyfndqpdllwhvhinjoi)
-- Extracted verbatim from supabase_migrations.schema_migrations on 2026-07-10.
-- 25 migrations, applied in version order. Do not edit; regenerate from prod.
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
