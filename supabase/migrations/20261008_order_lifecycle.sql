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
