-- order_place: a limited discount code cannot be taken past its usage_limit.
--
-- findCodeFor (src/lib/discounts/public.ts) counts the uses before a buyer is
-- quoted, but that count is only read: two buyers reaching for the last use at
-- the same moment both pass it and both reach here. This re-checks under a row
-- lock on the discount, so takers of one code serialise: the second waits for
-- the first to commit, then counts it. Over the limit raises, which rolls back
-- the order insert with it, so no order is written and nothing is charged.
--
-- Everything else is the 20261011 function unchanged.

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
