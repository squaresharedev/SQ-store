-- =============================================================================
-- Product add-ons: "Add to your order" on the product page.
-- =============================================================================
-- WHAT. A seller picks up to four of their other products for a product
-- (products.add_on_ids). The hosted product page offers them beside Buy now,
-- and a buyer who taps one pays for it in the SAME order: one payment, one
-- parcel, one delivery charge.
--
-- THE SHAPE. An order keeps its main product exactly where it always was, on
-- the orders row. Each add-on is one extra row in order_add_ons. So every
-- reader of an order without add-ons sees exactly what it saw before, and only
-- the readers that must show or count the whole order (the packing list, the
-- buyer's order page, stock give-back, product analytics) read the new rows.
--
--   1. products.add_on_ids   The seller's choice, in their order, at most 4.
--                            A trigger refuses a product of another store.
--   2. order_add_ons         What an order sold besides its main product:
--                            snapshotted title, options, price, file, stock.
--   3. order_place           Writes the add-on lines and takes their stock in
--                            the same transaction: a shortfall on any line
--                            writes no order at all.
--   4. Stock give-back       An expired or abandoned checkout, and a refund
--                            with restock, put the add-on units back too.
--   5. order_lines           One row per product sold (main line + add-ons),
--                            so per-product analytics credit an add-on to its
--                            own product, and orders without add-ons add up
--                            exactly as before.
--
-- WRITES are the server's: order_add_ons has no client write policy, like
-- orders. Members read their store's rows through RLS.
--
-- DEPLOY ORDER: apply this BEFORE the app that reads products.add_on_ids
-- (PUBLIC_PRODUCT_SELECT selects it, so every product page read fails without
-- it). The sentinel in scripts/lib/prod-schema.ts makes the deploy gate refuse
-- the app until this is in.
--
-- Apply via the Management API query endpoint or the SQL editor.
-- =============================================================================

-- ---- 1. products.add_on_ids ---------------------------------------------------

alter table public.products
  add column if not exists add_on_ids uuid[] not null default '{}';

alter table public.products
  drop constraint if exists products_add_on_ids_size;
-- MIRROR of ADD_ONS_MAX in src/types/product.ts.
alter table public.products
  add constraint products_add_on_ids_size
    check (cardinality(add_on_ids) <= 4);

comment on column public.products.add_on_ids is
  'Other products of the same store offered as "Add to your order" on this product''s page, in the seller''s order. A deleted or inactive one simply stops showing; the buyer path re-checks every id on read.';

-- Owners and editors may write products straight through PostgREST, where the
-- app's own ownership check never runs, so the database is the wall: an id NEW
-- to the row must be another product of the SAME store. Ids already on the row
-- stay (a product deleted since is just not shown), so re-saving never fails on
-- one. INVOKER on purpose: a writer who cannot see a product cannot name it.
create or replace function public.guard_add_on_ids()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_ids uuid[] := '{}';
  candidate uuid;
begin
  if tg_op = 'UPDATE' then
    old_ids := coalesce(old.add_on_ids, '{}');
  end if;

  if new.id = any (new.add_on_ids) then
    raise exception 'A product cannot be its own add-on.' using errcode = '23514';
  end if;
  if cardinality(new.add_on_ids) <> (select count(distinct x) from unnest(new.add_on_ids) as x) then
    raise exception 'An add-on is listed twice.' using errcode = '23514';
  end if;

  foreach candidate in array new.add_on_ids loop
    continue when candidate = any (old_ids);
    if not exists (
      select 1 from public.products p
       where p.id = candidate and p.owner_id = new.owner_id
    ) then
      raise exception 'An add-on must be another product of the same store.'
        using errcode = '42501';
    end if;
  end loop;

  return new;
end
$$;

-- A trigger function is never called directly.
revoke execute on function public.guard_add_on_ids() from public, anon, authenticated;

drop trigger if exists guard_add_on_ids on public.products;
create trigger guard_add_on_ids
  before insert or update of add_on_ids on public.products
  for each row execute function public.guard_add_on_ids();

-- ---- 2. order_add_ons -----------------------------------------------------------

create table if not exists public.order_add_ons (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete cascade,
  -- The order's seller, copied so RLS reads one column like orders does.
  seller_id           uuid not null references auth.users (id) on delete cascade,
  product_id          uuid references public.products (id) on delete set null,
  -- Snapshots, exactly as on orders: renaming or deleting the product later
  -- cannot rewrite what this order says was sold.
  product_title       text not null,
  -- The REGULAR unit price. amount_cents is what was charged for the line;
  -- discount_cents is the difference, set by the sale that priced it.
  product_price_cents integer not null,
  quantity            integer not null default 1,
  amount_cents        integer not null,
  discount_id         uuid references public.discounts (id) on delete set null,
  discount_cents      integer not null default 0,
  selected_options    jsonb not null default '[]'::jsonb,
  digital_file_key    text,
  stock_reserved      integer not null default 0,
  -- The seller's order on the page, so the packing list reads the same way.
  position            smallint not null default 0,
  created_at          timestamptz not null default now(),

  constraint order_add_ons_title_length check (char_length(product_title) between 1 and 200),
  constraint order_add_ons_price_range check (product_price_cents >= 0),
  constraint order_add_ons_quantity_range check (quantity between 1 and 100),
  constraint order_add_ons_amount_range check (amount_cents >= 0),
  constraint order_add_ons_discount_range
    check (discount_cents >= 0 and discount_cents::bigint <= product_price_cents::bigint * quantity),
  constraint order_add_ons_selected_options_is_array check (jsonb_typeof(selected_options) = 'array'),
  constraint order_add_ons_selected_options_size check (pg_column_size(selected_options) <= 2048),
  constraint order_add_ons_digital_file_key_shape
    check (digital_file_key is null or (digital_file_key ~ '^files/' and char_length(digital_file_key) <= 512)),
  constraint order_add_ons_stock_reserved_range check (stock_reserved between 0 and 100),
  constraint order_add_ons_position_range check (position between 0 and 3)
);

create index if not exists order_add_ons_order_id_idx on public.order_add_ons (order_id);
create index if not exists order_add_ons_product_id_idx on public.order_add_ons (product_id);
create index if not exists order_add_ons_seller_id_idx on public.order_add_ons (seller_id);
create index if not exists order_add_ons_discount_id_idx
  on public.order_add_ons (discount_id) where discount_id is not null;
-- Product writes ask "does any order still need this file?" before evicting it.
create index if not exists order_add_ons_digital_file_key_idx
  on public.order_add_ons (digital_file_key) where digital_file_key is not null;

comment on table public.order_add_ons is
  'What an order sold besides its main product (orders.product_id): one row per "Add to your order" product the buyer took. Written by order_place only.';

alter table public.order_add_ons enable row level security;

revoke all on table public.order_add_ons from public, anon, authenticated;
grant select on table public.order_add_ons to authenticated;
grant all on table public.order_add_ons to service_role;

drop policy if exists order_add_ons_select_member on public.order_add_ons;
create policy order_add_ons_select_member on public.order_add_ons
  for select to authenticated
  using (
    seller_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(seller_id), 'store.read')
  );

-- The two-factor rule every seller table carries (20260923).
drop policy if exists "Require two-factor when enrolled" on public.order_add_ons;
create policy "Require two-factor when enrolled" on public.order_add_ons
  as restrictive for all to authenticated
  using ((select public.mfa_session_ok()))
  with check ((select public.mfa_session_ok()));

-- ---- 3. order_place writes the add-on lines -------------------------------------
-- Everything up to the main product's stock is the 20261022 function
-- unchanged. Then each entry of p_order->'add_ons' becomes a line and takes its
-- own stock with the same guard; a shortfall on any line raises, which rolls
-- the whole order back. jsonb_populate_record fills only orders' own columns,
-- so the extra key never reaches the main insert. A duplicate checkout session
-- returns before any line is written, so lines are never written twice.

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
  code_limit integer;
  code_uses integer;
  lines jsonb := coalesce(p_order->'add_ons', '[]'::jsonb);
  line jsonb;
  line_id uuid;
  line_product uuid;
  line_wanted integer;
  line_left integer;
  line_threshold integer;
  line_position integer := 0;
  low_add_ons jsonb := '[]'::jsonb;
begin
  incoming := jsonb_populate_record(null::public.orders, p_order);

  if incoming.checkout_session_id is null then
    raise exception 'order_place: checkout_session_id is required' using errcode = '22023';
  end if;
  if incoming.status is null or incoming.status not in ('paid', 'pending') then
    raise exception 'order_place: status must be paid or pending' using errcode = '22023';
  end if;
  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) > 4 then
    raise exception 'order_place: add_ons must be an array of at most 4' using errcode = '22023';
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

  -- A limited code: lock its row so takers serialise, then count the uses that
  -- stand. This order is already inserted, so it counts as one of them.
  -- Refunded orders give their use back, as in findCodeFor.
  if incoming.discount_code_id is not null then
    select d.usage_limit into code_limit
      from public.discounts d
     where d.id = incoming.discount_code_id
       for update;

    if code_limit is not null then
      select count(*) into code_uses
        from public.orders o
       where o.discount_code_id = incoming.discount_code_id
         and o.status <> 'refunded';

      if code_uses > code_limit then
        -- Rolls the insert above back with it.
        raise exception 'discount_exhausted' using errcode = 'P0001';
      end if;
    end if;
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

  for line in select value from jsonb_array_elements(lines) loop
    line_product := (line->>'product_id')::uuid;
    line_wanted := coalesce((line->>'quantity')::integer, 1);

    insert into public.order_add_ons (
      order_id, seller_id, product_id, product_title, product_price_cents,
      quantity, amount_cents, discount_id, discount_cents,
      selected_options, digital_file_key, position
    ) values (
      new_id, incoming.seller_id, line_product, line->>'product_title',
      (line->>'product_price_cents')::integer,
      line_wanted, (line->>'amount_cents')::integer, (line->>'discount_id')::uuid,
      coalesce((line->>'discount_cents')::integer, 0),
      coalesce(line->'selected_options', '[]'::jsonb), line->>'digital_file_key', line_position
    )
    returning id into line_id;
    line_position := line_position + 1;

    update public.products p
       set stock_quantity = p.stock_quantity - line_wanted,
           updated_at = now()
     where p.id = line_product
       and p.track_stock
       and p.stock_quantity >= line_wanted
    returning p.stock_quantity, p.low_stock_threshold into line_left, line_threshold;

    if found then
      update public.order_add_ons set stock_reserved = line_wanted where id = line_id;
      if line_left <= line_threshold then
        low_add_ons := low_add_ons || jsonb_build_object('product_id', line_product, 'stock_left', line_left);
      end if;
    elsif exists (
      select 1 from public.products p where p.id = line_product and p.track_stock
    ) then
      -- Rolls the whole order back with it.
      raise exception 'insufficient_stock' using errcode = 'P0001';
    end if;
  end loop;

  return jsonb_build_object(
    'order_id', new_id,
    'duplicate', false,
    'stock_left', left_after,
    'low_stock', coalesce(left_after <= threshold, false),
    'add_on_low_stock', low_add_ons
  );
end
$$;

-- Restated: recreating a function re-grants EXECUTE to the API roles.
revoke execute on function public.order_place(jsonb) from public, anon, authenticated;
grant execute on function public.order_place(jsonb) to service_role;

-- ---- 4. Stock give-back covers the add-on lines ---------------------------------
-- The lines go with their order (on delete cascade), so their units are put
-- back BEFORE the order is deleted. The order row is locked first, so a
-- payment confirming at the same moment waits instead of racing the release.

create or replace function public.order_release_pending(p_checkout_session_id text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  gone record;
begin
  select o.id, o.product_id, o.stock_reserved into gone
    from public.orders o
   where o.checkout_session_id = p_checkout_session_id
     and o.status = 'pending'
     for update;

  if not found then
    return false;
  end if;

  update public.products p
     set stock_quantity = least(p.stock_quantity + units.total, 1000000),
         updated_at = now()
    from (
      select a.product_id, sum(a.stock_reserved)::integer as total
        from public.order_add_ons a
       where a.order_id = gone.id
         and a.stock_reserved > 0
         and a.product_id is not null
       group by a.product_id
    ) units
   where p.id = units.product_id
     and p.track_stock;

  delete from public.orders o where o.id = gone.id;

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

-- One statement: the orders delete and the lines delete both RETURN what they
-- held, and the units are put back per product from the two together. (The
-- cascade from the orders delete then finds the lines already gone.)
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
    returning o.id, o.product_id, o.stock_reserved
  ),
  gone_lines as (
    delete from public.order_add_ons a
     using gone g
     where a.order_id = g.id
    returning a.product_id, a.stock_reserved
  ),
  back as (
    update public.products p
       set stock_quantity = least(p.stock_quantity + units.total, 1000000),
           updated_at = now()
      from (
        select u.product_id, sum(u.stock_reserved)::integer as total
          from (
            select g.product_id, g.stock_reserved from gone g
            union all
            select l.product_id, l.stock_reserved from gone_lines l
          ) u
         where u.stock_reserved > 0 and u.product_id is not null
         group by u.product_id
      ) units
     where p.id = units.product_id
       and p.track_stock
    returning 1
  )
  select count(*)::integer from gone
$$;

revoke execute on function public.orders_release_expired(timestamptz) from public, anon, authenticated;
grant execute on function public.orders_release_expired(timestamptz) to service_role;

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

  if p_restock then
    update public.products p
       set stock_quantity = least(p.stock_quantity + units.total, 1000000),
           updated_at = now()
      from (
        select a.product_id, sum(a.stock_reserved)::integer as total
          from public.order_add_ons a
         where a.order_id = target.id
           and a.stock_reserved > 0
           and a.product_id is not null
         group by a.product_id
      ) units
     where p.id = units.product_id
       and p.track_stock;
    update public.order_add_ons
       set stock_reserved = 0
     where order_id = target.id
       and stock_reserved > 0;
  end if;

  return 'refunded';
end
$$;

revoke execute on function public.order_apply_refund(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.order_apply_refund(uuid, text, boolean) to service_role;

-- ---- 5. order_lines: one row per product sold -----------------------------------
-- The main line carries the order's amount LESS its add-on lines (delivery
-- stays on the main line, as it always has), and each add-on line carries what
-- was charged for it. So an order without add-ons is one row with exactly the
-- amount it always had, and the per-product numbers below do not move for any
-- existing order. credit_id is the discount a line is credited to: the main
-- line's code or sale (as discount_performance has always credited it), an
-- add-on line's sale.
--
-- security_invoker: the orders and order_add_ons RLS policies decide whose rows
-- a caller sees, exactly as when the functions read orders directly.

create or replace view public.order_lines
with (security_invoker = true) as
  select
    o.id as order_id,
    o.seller_id,
    o.status,
    o.currency,
    o.channel,
    o.created_at,
    o.product_id,
    o.product_title,
    o.quantity,
    o.amount_cents - coalesce((
      select sum(a.amount_cents) from public.order_add_ons a where a.order_id = o.id
    ), 0) as revenue_cents,
    coalesce(o.discount_code_id, o.discount_id) as credit_id,
    o.discount_cents,
    false as is_add_on
  from public.orders o
  union all
  select
    a.order_id,
    a.seller_id,
    o.status,
    o.currency,
    o.channel,
    o.created_at,
    a.product_id,
    a.product_title,
    a.quantity,
    a.amount_cents as revenue_cents,
    a.discount_id as credit_id,
    a.discount_cents,
    true as is_add_on
  from public.order_add_ons a
  join public.orders o on o.id = a.order_id;

comment on view public.order_lines is
  'One row per product an order sold: the main product (orders) and each add-on (order_add_ons). revenue_cents adds up to orders.amount_cents per order. Read by the per-product analytics.';

-- Restated: creating a view grants it to the API roles.
revoke all on public.order_lines from public, anon, authenticated;
grant select on public.order_lines to authenticated, service_role;

-- ---- 6. Per-product numbers read order_lines ------------------------------------
-- Each function below is its last version with the per-product source swapped
-- from orders to order_lines. Totals, series and channels still read orders.

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
-- One row per product sold, so an add-on counts for its own product.
paid_lines as (
  select l.product_title, l.revenue_cents
  from public.order_lines l, bounds b
  where l.seller_id = p_seller_id
    and l.currency <> 'USD'
    and l.status = 'paid'
    and l.created_at >= b.from_ts
    and l.created_at < b.to_ts
),
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
      select product_title, sum(revenue_cents) as revenue_cents, count(*) as sales
      from paid_lines
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

revoke execute on function public.analytics_aggregate(uuid, date, date) from public, anon;
grant execute on function public.analytics_aggregate(uuid, date, date) to authenticated, service_role;

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
    sum(revenue_cents)::bigint as revenue_cents,
    min(currency) as currency
  from public.order_lines
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

revoke execute on function public.product_sales_aggregate(uuid) from public, anon;
grant execute on function public.product_sales_aggregate(uuid) to authenticated, service_role;

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
  select product_id, count(*)::bigint as units_sold, sum(revenue_cents)::bigint as revenue
  from public.order_lines
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

revoke execute on function public.products_ranked_by_metric(uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.products_ranked_by_metric(uuid, text, text, text, integer, integer) to authenticated, service_role;

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
  select l.product_title, l.created_at
  from public.order_lines l, bounds b
  where l.seller_id = p_seller_id
    and l.currency <> 'USD'
    and l.status = 'paid'
    and l.created_at >= b.from_ts
    and l.created_at < b.to_ts
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

-- A sale that priced an add-on gets the credit for it. Orders are counted
-- once each (an order whose main product and add-on were both on one sale is
-- one order of that sale, not two).
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
    l.credit_id,
    l.currency,
    (count(distinct l.order_id) filter (where l.status <> 'refunded'))::integer,
    (count(distinct l.order_id) filter (where l.status = 'paid'))::integer,
    coalesce(sum(l.revenue_cents) filter (where l.status = 'paid'), 0)::bigint,
    coalesce(sum(l.discount_cents) filter (where l.status = 'paid'), 0)::bigint,
    max(l.created_at) filter (where l.status = 'paid')
  from public.order_lines l
  where l.seller_id = p_seller_id
    and l.credit_id is not null
  group by 1, 2
$$;

revoke execute on function public.discount_performance(uuid) from public, anon;
grant execute on function public.discount_performance(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
