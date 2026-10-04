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
