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
