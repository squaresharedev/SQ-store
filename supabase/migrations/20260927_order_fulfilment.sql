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
