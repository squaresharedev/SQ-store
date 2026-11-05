-- =============================================================================
-- ROLLBACK of 20261028_product_add_ons.sql. Not a migration: run by hand only.
-- =============================================================================
-- Restores the nine functions the migration replaced, exactly as they were, then
-- removes what it added. RUN ONLY with no app build reading add_on_ids or
-- order_add_ons (PUBLIC_PRODUCT_SELECT does), and know what it costs: dropping
-- order_add_ons deletes the add-on lines of every order that has any, so an
-- order's amount_cents would then cover lines nobody can see, and their reserved
-- stock is not given back. Check first:
--   select count(*) from public.order_add_ons;
-- =============================================================================

begin;

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

revoke execute on function public.discount_performance(uuid) from public, anon;
grant execute on function public.discount_performance(uuid) to authenticated, service_role;

drop view if exists public.order_lines;
drop table if exists public.order_add_ons;
drop trigger if exists guard_add_on_ids on public.products;
drop function if exists public.guard_add_on_ids();
alter table public.products drop constraint if exists products_add_on_ids_size;
alter table public.products drop column if exists add_on_ids;

commit;

notify pgrst, 'reload schema';
