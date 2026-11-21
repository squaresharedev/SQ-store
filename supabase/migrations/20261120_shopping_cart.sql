-- =============================================================================
-- SHOPPING CART (2026-11-20)
--
-- A buyer collects products from one storefront and pays for them once. An
-- order of many lines keeps the shape add-ons gave orders (20261028): the
-- FIRST line is the orders row itself, and every line after it is a row of
-- order_add_ons, the table that now holds "every line after the first",
-- whether it was taken from "Add to your order" or put in the cart.
--
--   1. order_add_ons: a `source` per line, and room for a cart's worth of
--      lines (CART_LINES_MAX = 20 in src/lib/cart/limits.ts, so 19 after the
--      first). A line may now be a download beside a parcel.
--   2. orders: `lines_digest` (a fingerprint of the whole basket, so a
--      repeated attempt is answered only for the same lines), `cart_id`
--      (the cart the order was paid from, which payment closes), and
--      `more_product_ids` / `more_titles` (so the seller's lists find an order
--      by any of its lines).
--   3. carts: the cart itself. Service-role only; its id is the buyer's only
--      key to it. No prices and nothing about the buyer: product ids, option
--      ids and quantities.
--   4. A daily sweep: carts untouched for CART_IDLE_DAYS (14), and paid ones a
--      day after payment.
--   5. order_place takes up to 19 lines with their source, and the two new
--      order columns. Otherwise the 20261028 function unchanged.
--   6. order_line_refunds, order_line_refund_amount, order_apply_line_refund:
--      one line of an order refunded (and restocked) on its own.
--   7. A refunded line leaves the figures: order_lines gets a status per line,
--      units sold add up quantities, and revenue totals count what a paid
--      order kept.
--   8. "Added to cart" is a signal kind of its own (cart_add), counted on the
--      analytics page beside views and checkouts.
--   9. A review per PRODUCT of an order, not one per order: a cart's buyer can
--      review everything they bought. A line refunded on its own takes the
--      verified badge from that product's review, as a refunded order does
--      from all of its reviews.
-- =============================================================================

-- ---- 1. Every line after the first ---------------------------------------------

alter table public.order_add_ons
  add column if not exists source text not null default 'add_on';

alter table public.order_add_ons drop constraint if exists order_add_ons_source_check;
alter table public.order_add_ons
  add constraint order_add_ons_source_check check (source in ('add_on', 'cart'));

-- The order's own row is the first of CART_LINES_MAX (20) lines.
alter table public.order_add_ons drop constraint if exists order_add_ons_position_range;
alter table public.order_add_ons
  add constraint order_add_ons_position_range check (position between 0 and 18);

comment on table public.order_add_ons is
  'Every line of an order after its first (the orders row): products taken from "Add to your order" (source add_on) or put in the cart (source cart). Written by order_place only.';

-- ---- 2. The basket's fingerprint and its cart -------------------------------------

alter table public.orders add column if not exists lines_digest text;
alter table public.orders drop constraint if exists orders_lines_digest_shape;
alter table public.orders
  add constraint orders_lines_digest_shape check (lines_digest is null or lines_digest ~ '^[0-9a-f]{64}$');

-- No foreign key: a cart is swept a day after it is paid, and the order stays.
alter table public.orders add column if not exists cart_id uuid;

-- The products and titles of every line after the first, on the order itself,
-- so the seller's lists find an order by ANY of its lines in one query: the
-- search box (more_titles), a product's orders and its "to ship" count
-- (more_product_ids). Written by order_place from the lines it inserts; a
-- deleted product's id stays behind, harmlessly (its lines keep their titles).
alter table public.orders add column if not exists more_product_ids uuid[] not null default '{}';
alter table public.orders add column if not exists more_titles text not null default '';
alter table public.orders drop constraint if exists orders_more_lines_size;
alter table public.orders
  add constraint orders_more_lines_size
  check (cardinality(more_product_ids) <= 19 and char_length(more_titles) <= 4000);

-- Orders that already have lines after the first (add-ons, since 20261028).
update public.orders o
   set more_product_ids = s.ids,
       more_titles = left(s.titles, 4000)
  from (
    select order_id,
           coalesce(array_agg(product_id order by position) filter (where product_id is not null), '{}') as ids,
           coalesce(string_agg(product_title, ' / ' order by position), '') as titles
      from public.order_add_ons
     group by order_id
  ) s
 where s.order_id = o.id
   and o.more_product_ids = '{}';

-- ---- 3. carts -------------------------------------------------------------------------

create table if not exists public.carts (
  -- Random, and the buyer's only key to their cart (a capability): never
  -- listed, never logged, never put in analytics.
  id            uuid primary key default gen_random_uuid(),
  storefront_id uuid not null references public.storefronts (id) on delete cascade,
  -- [{ productId, optionIds, quantity, source, addedAt }], as src/lib/cart
  -- writes and reads them. Requests only: every price is the quote's.
  lines         jsonb not null default '[]'::jsonb,
  -- Bumped on every write: optimistic concurrency (two tabs adding at once
  -- never lose an add), and how a buyer's other tabs know to look again.
  rev           integer not null default 0,
  -- Set when an order paid from this cart is paid. A closed cart takes no
  -- more lines, and is swept a day later.
  ordered_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- An array of at most CART_LINES_MAX (20). CASE, because CHECKs run in no
  -- set order and jsonb_array_length raises on anything but an array.
  constraint carts_lines_shape check (
    case when jsonb_typeof(lines) = 'array' then jsonb_array_length(lines) <= 20 else false end
  ),
  constraint carts_lines_size check (pg_column_size(lines) <= 8192),
  constraint carts_rev_range check (rev >= 0)
);

create index if not exists carts_storefront_id_idx on public.carts (storefront_id);
create index if not exists carts_updated_at_idx on public.carts (updated_at);

comment on table public.carts is
  'A buyer''s cart on one storefront. Service role only: reached through app/api/cart, by its random id. Swept daily (carts_sweep).';

alter table public.carts enable row level security;
revoke all on table public.carts from public, anon, authenticated;
grant all on table public.carts to service_role;

-- ---- 4. The sweep -------------------------------------------------------------------

create or replace function public.carts_sweep(p_now timestamptz default now())
returns integer
language sql
security invoker
set search_path = ''
as $$
  with gone as (
    delete from public.carts c
     where c.updated_at < p_now - interval '14 days'
        or (c.ordered_at is not null and c.ordered_at < p_now - interval '1 day')
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function public.carts_sweep(timestamptz) from public, anon, authenticated;
grant execute on function public.carts_sweep(timestamptz) to service_role;

comment on function public.carts_sweep(timestamptz) is
  'Deletes carts untouched for 14 days (CART_IDLE_DAYS) and carts paid more than a day ago. Returns how many. Run daily; service role only.';

-- Daily, where there is a scheduler. The test replica has none (embedded
-- Postgres ships no pg_cron), and the function is called directly there.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'carts-sweep',
      '23 3 * * *',
      $cron$select public.carts_sweep()$cron$
    );
  end if;
end
$$;

-- ---- 5. order_place: a cart's worth of lines --------------------------------------
-- The 20261028 function, with: up to 19 lines after the first; each line's
-- source; and lines_digest, cart_id, more_product_ids and more_titles on the
-- order.

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
  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) > 19 then
    raise exception 'order_place: add_ons must be an array of at most 19' using errcode = '22023';
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
    payment_ref, pending_expires_at, lines_digest, cart_id,
    more_product_ids, more_titles
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
    case when incoming.status = 'pending' then incoming.pending_expires_at end,
    incoming.lines_digest, incoming.cart_id,
    -- Taken from the lines themselves, never from the caller.
    (select coalesce(array_agg((e.l->>'product_id')::uuid order by e.n) filter (where e.l->>'product_id' is not null), '{}')
       from jsonb_array_elements(lines) with ordinality as e(l, n)),
    (select left(coalesce(string_agg(e.l->>'product_title', ' / ' order by e.n), ''), 4000)
       from jsonb_array_elements(lines) with ordinality as e(l, n))
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
      order_id, seller_id, product_id, source, product_title, product_price_cents,
      quantity, amount_cents, discount_id, discount_cents,
      selected_options, digital_file_key, position
    ) values (
      new_id, incoming.seller_id, line_product, coalesce(line->>'source', 'add_on'), line->>'product_title',
      (line->>'product_price_cents')::integer,
      line_wanted, (line->>'amount_cents')::integer, (line->>'discount_id')::uuid,
      coalesce((line->>'discount_cents')::integer, 0),
      coalesce(line->'selected_options', '[]'::jsonb), line->>'digital_file_key', line_position
    )
    returning id into line_id;
    line_position := line_position + 1;

    -- The same guard as the first line. Two lines of one product (two
    -- versions) each take their own units from the one shelf, so together
    -- they can never take more than it holds.
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

-- ---- 6. Refunding one line of an order ---------------------------------------------
-- A cart's order holds several products, and "one arrived broken" is a refund
-- of that line, not of the order. One row per refunded line (the order's own
-- first line is line_id null). The money goes back through the provider FIRST
-- (lib/orders/actions.ts refundOrderLine); order_apply_line_refund records it,
-- restocks the line when asked, and turns the order refunded once every line
-- is. The last line still standing takes the delivery back with it, so
-- refunding every line gives back everything that was paid.

create table if not exists public.order_line_refunds (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  seller_id    uuid not null references auth.users (id) on delete cascade,
  -- order_add_ons.id; null = the order's own first line (the orders row).
  line_id      uuid references public.order_add_ons (id) on delete cascade,
  amount_cents integer not null,
  restocked    integer not null default 0,
  reason       text not null,
  created_at   timestamptz not null default now(),

  constraint order_line_refunds_amount_range check (amount_cents >= 0),
  constraint order_line_refunds_restocked_range check (restocked between 0 and 100),
  constraint order_line_refunds_reason_check check (reason in ('cancelled', 'returned', 'other'))
);

-- A line is refunded once.
create unique index if not exists order_line_refunds_one_per_line
  on public.order_line_refunds (order_id, coalesce(line_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists order_line_refunds_seller_id_idx on public.order_line_refunds (seller_id);

comment on table public.order_line_refunds is
  'One refunded line of an order (line_id null = the order''s own first line). Written by order_apply_line_refund only; the store''s team reads its own.';

alter table public.order_line_refunds enable row level security;
revoke all on table public.order_line_refunds from public, anon, authenticated;
grant select on table public.order_line_refunds to authenticated;
grant all on table public.order_line_refunds to service_role;

drop policy if exists order_line_refunds_select_member on public.order_line_refunds;
create policy order_line_refunds_select_member on public.order_line_refunds
  for select to authenticated
  using (
    seller_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(seller_id), 'store.read')
  );

drop policy if exists "Require two-factor when enrolled" on public.order_line_refunds;
create policy "Require two-factor when enrolled" on public.order_line_refunds
  as restrictive for all to authenticated
  using ((select public.mfa_session_ok()))
  with check ((select public.mfa_session_ok()));

-- What refunding this line gives back, or null when it cannot be refunded
-- (no such line, the order is not paid, or the line already was).
create or replace function public.order_line_refund_amount(p_order_id uuid, p_line_id uuid)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  more_lines integer;
  done_lines integer;
  done_cents integer;
  amount integer;
begin
  select * into target from public.orders where id = p_order_id;
  if not found or target.status <> 'paid' then
    return null;
  end if;
  if exists (
    select 1 from public.order_line_refunds r
     where r.order_id = p_order_id and r.line_id is not distinct from p_line_id
  ) then
    return null;
  end if;

  if p_line_id is null then
    select target.amount_cents - coalesce(target.shipping_cents, 0) - coalesce(sum(a.amount_cents), 0)
      into amount
      from public.order_add_ons a
     where a.order_id = p_order_id;
  else
    select a.amount_cents into amount
      from public.order_add_ons a
     where a.id = p_line_id and a.order_id = p_order_id;
    if not found then
      return null;
    end if;
  end if;

  -- The last line still standing takes back everything left, delivery too.
  select count(*) into more_lines from public.order_add_ons where order_id = p_order_id;
  select count(*), coalesce(sum(amount_cents), 0) into done_lines, done_cents
    from public.order_line_refunds where order_id = p_order_id;
  if done_lines = more_lines then
    amount := target.amount_cents - done_cents;
  end if;
  return greatest(amount, 0);
end
$$;

create or replace function public.order_apply_line_refund(
  p_order_id uuid,
  p_line_id uuid,
  p_reason text,
  p_restock boolean,
  p_amount_cents integer
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  item public.order_add_ons%rowtype;
  reserved integer := 0;
  product uuid;
  more_lines integer;
  done_lines integer;
  done_cents integer;
begin
  if p_reason is null or p_reason not in ('cancelled', 'returned', 'other') then
    return 'not_refundable';
  end if;
  if p_amount_cents is null or p_amount_cents < 0 then
    return 'not_refundable';
  end if;

  select * into target from public.orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;
  if target.status <> 'paid' then
    return 'not_refundable';
  end if;

  if p_line_id is null then
    reserved := target.stock_reserved;
    product := target.product_id;
  else
    select * into item from public.order_add_ons
     where id = p_line_id and order_id = p_order_id
       for update;
    if not found then
      return 'not_found';
    end if;
    reserved := item.stock_reserved;
    product := item.product_id;
  end if;

  begin
    insert into public.order_line_refunds (order_id, seller_id, line_id, amount_cents, restocked, reason)
    values (p_order_id, target.seller_id, p_line_id, p_amount_cents,
            case when p_restock then reserved else 0 end, p_reason);
  exception when unique_violation then
    return 'already';
  end;

  -- The verified badge stands on a purchase: once every line of this product
  -- in the order is refunded, its review loses it (as reviews_unverify_refunded
  -- does for a whole order). Two versions of one product are two lines, and
  -- refunding one leaves the other bought.
  if product is not null and not exists (
    select 1
      from (
        select null::uuid as line_id, o.product_id from public.orders o where o.id = p_order_id
        union all
        select a.id, a.product_id from public.order_add_ons a where a.order_id = p_order_id
      ) l
     where l.product_id = product
       and not exists (
         select 1 from public.order_line_refunds r
          where r.order_id = p_order_id and r.line_id is not distinct from l.line_id
       )
  ) then
    update public.reviews
       set is_verified_buyer = false
     where order_id = p_order_id
       and product_id = product
       and is_verified_buyer;
  end if;

  if p_restock and reserved > 0 and product is not null then
    update public.products p
       set stock_quantity = least(p.stock_quantity + reserved, 1000000),
           updated_at = now()
     where p.id = product
       and p.track_stock;
    if p_line_id is null then
      update public.orders set stock_reserved = 0 where id = p_order_id;
    else
      update public.order_add_ons set stock_reserved = 0 where id = p_line_id;
    end if;
  end if;

  -- Every line refunded: the order is. Unless money is still owed: two lines
  -- refunded at the same moment were each priced before the other was written,
  -- so neither took the delivery back. Then the answer is 'rest' and the order
  -- stays paid until the caller has given back what is left and recorded the
  -- whole order's refund (order_apply_refund / order_refund).
  select count(*) into more_lines from public.order_add_ons where order_id = p_order_id;
  select count(*), coalesce(sum(amount_cents), 0) into done_lines, done_cents
    from public.order_line_refunds where order_id = p_order_id;
  if done_lines > more_lines then
    if done_cents < target.amount_cents then
      return 'rest';
    end if;
    update public.orders
       set status = 'refunded', refunded_at = now(), refund_reason = p_reason
     where id = p_order_id;
    return 'refunded';
  end if;
  return 'line_refunded';
end
$$;

revoke execute on function public.order_line_refund_amount(uuid, uuid) from public, anon, authenticated;
grant execute on function public.order_line_refund_amount(uuid, uuid) to service_role;
revoke execute on function public.order_apply_line_refund(uuid, uuid, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.order_apply_line_refund(uuid, uuid, text, boolean, integer) to service_role;

-- ---- 7. A refunded line leaves the figures ------------------------------------------
-- A refunded line stops counting as a sale while the rest of its order stands:
--   * order_lines gives each line its OWN status, so the per-product readers
--     (sales per product, bestseller, top products, weekday bars) drop it;
--   * units sold are the quantities added up, not the lines counted (a line of
--     3 is 3 units);
--   * the revenue totals count what a paid order KEPT: its amount less its
--     refunded lines.
-- Each function is its last version (20261028, 20261117) with only that change.

create or replace view public.order_lines
with (security_invoker = true) as
  select
    o.id as order_id,
    o.seller_id,
    case
      when o.status = 'paid' and exists (
        select 1 from public.order_line_refunds r where r.order_id = o.id and r.line_id is null
      ) then 'refunded'
      else o.status
    end as status,
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
    case
      when o.status = 'paid' and exists (
        select 1 from public.order_line_refunds r where r.order_id = a.order_id and r.line_id = a.id
      ) then 'refunded'
      else o.status
    end as status,
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
  'One row per line an order sold: the first (orders) and every line after it (order_add_ons), each with its own status (a line refunded on its own is refunded while its order stays paid). revenue_cents adds up to orders.amount_cents per order. Read by the per-product analytics.';

-- Restated: replacing a view grants it to the API roles.
revoke all on public.order_lines from public, anon, authenticated;
grant select on public.order_lines to authenticated, service_role;

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
    sum(quantity)::int as units_sold,
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
  select product_id, sum(quantity)::bigint as units_sold, sum(revenue_cents)::bigint as revenue
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
-- kept_cents: what a paid order kept, its amount less any line refunded on
-- its own. The scalar figures read it from one pass over the seller's orders.
with kept as (
  select
    o.status,
    o.created_at,
    case
      when o.status = 'paid'
        then o.amount_cents - coalesce((
          select sum(r.amount_cents) from public.order_line_refunds r where r.order_id = o.id
        ), 0)
      else o.amount_cents
    end as kept_cents
  from public.orders o
  where o.seller_id = p_seller_id and o.currency <> 'USD'
)
select jsonb_build_object(
  'all_time', jsonb_build_object(
    'revenue_cents', coalesce(sum(kept_cents) filter (where status = 'paid'), 0),
    'sales',         count(*)           filter (where status = 'paid')
  ),
  'last_30d', jsonb_build_object(
    'revenue_cents', coalesce(
      sum(kept_cents) filter (
        where status = 'paid'
          and created_at >= p_now - interval '30 days'
      ), 0),
    'sales', count(*) filter (
      where status = 'paid'
        and created_at >= p_now - interval '30 days'
    )
  ),
  'prev_30d', jsonb_build_object(
    'revenue_cents', coalesce(
      sum(kept_cents) filter (
        where status = 'paid'
          and created_at >= p_now - interval '60 days'
          and created_at <  p_now - interval '30 days'
      ), 0),
    'sales', count(*) filter (
      where status = 'paid'
        and created_at >= p_now - interval '60 days'
        and created_at <  p_now - interval '30 days'
    )
  ),
  'trend_days', coalesce((
    select jsonb_agg(jsonb_build_object(
      'age_days', age_days, 'revenue_cents', revenue_cents, 'sales', sales
    ) order by age_days)
    from (
      select
        floor(extract(epoch from (p_now - created_at)) / 86400)::int as age_days,
        sum(kept_cents) as revenue_cents,
        count(*) as sales
      from kept
      where status = 'paid'
        and created_at >= p_now - interval '30 days'
      group by 1
    ) t
  ), '[]'::jsonb),
  'refunded_count', count(*) filter (where status = 'refunded'),
  'disputed_count', count(*) filter (where status = 'disputed'),
  -- created_at is passed through as a raw timestamptz: jsonb serialises it as
  -- ISO 8601 with an offset, which new Date() parses to the exact instant.
  -- Deliberately NOT to_char() (server locale; see 20261117).
  'recent_orders', coalesce((
    select jsonb_agg(entry order by ts desc)
    from (
      select created_at as ts, jsonb_build_object(
        'id',            id,
        'product_title', product_title,
        'channel',       channel,
        'status',        status,
        'amount_cents',  amount_cents,
        'currency',      currency,
        'created_at',    created_at
      ) as entry
      from public.orders
      where seller_id = p_seller_id and currency <> 'USD'
      order by created_at desc
      limit 5
    ) r
  ), '[]'::jsonb)
)
from kept
$$;

revoke execute on function public.dashboard_orders_aggregate(uuid, timestamptz) from public, anon;
grant execute on function public.dashboard_orders_aggregate(uuid, timestamptz) to authenticated, service_role;

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
  select
    coalesce(p_from::timestamp at time zone 'UTC', '-infinity'::timestamptz) as from_ts,
    coalesce((p_to + 1)::timestamp at time zone 'UTC', 'infinity'::timestamptz) as to_ts
),
-- amount_cents is what a paid order KEPT: its amount less any line refunded
-- on its own. A refunded order keeps its whole amount here, for the refunded
-- total.
in_range as (
  select o.created_at, o.status,
         case
           when o.status = 'paid'
             then o.amount_cents - coalesce((
               select sum(r.amount_cents) from public.order_line_refunds r where r.order_id = o.id
             ), 0)
           else o.amount_cents
         end as amount_cents,
         o.platform_fee_cents, o.buyer_email, o.channel
  from public.orders o, bounds b
  where o.seller_id = p_seller_id
    and o.currency <> 'USD'
    and o.created_at >= b.from_ts
    and o.created_at < b.to_ts
),
paid as (select * from in_range where status = 'paid'),
refunded as (select * from in_range where status = 'refunded'),
-- One row per line sold, so every line counts for its own product.
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


-- ---- 8. "Added to cart" ------------------------------------------------------------
-- MIRROR of SIGNAL_KINDS in src/lib/analytics/signals.ts. Written by the cart
-- route (app/api/cart/[storefrontId]) when a line goes in, one per visitor, per
-- product, per hour (lib/analytics/record.ts cartAddDedupeKey).

alter table public.storefront_signals
  drop constraint if exists storefront_signals_kind_check;
alter table public.storefront_signals
  add constraint storefront_signals_kind_check
    check (kind in ('storefront_view','product_click','email_signup','booking','product_view','checkout_view','cart_add'));

-- ---- 9. A review per product of an order -------------------------------------------
-- One review per order was one per purchase while an order held one product.
-- A cart's order holds several, and each can be reviewed once. Plain (not
-- partial), like the index it replaces: NULL order ids (imported reviews) stay
-- distinct and never clash. The review route checks the product is one of the
-- order's lines (app/api/products/[id]/reviews).

create unique index if not exists reviews_order_product_unique
  on public.reviews (order_id, product_id);
drop index if exists public.reviews_order_unique;

notify pgrst, 'reload schema';
