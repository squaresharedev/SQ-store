-- order_refund refuses an order a payment provider charged (security review
-- 2026-10-21).
--
-- THE HOLE. order_refund is the seller's client-callable refund write
-- (EXECUTE to authenticated, self-gated on owner / orders.refund). The order
-- panel calls it only AFTER refunding with the provider (refundOrder in
-- src/lib/orders/actions.ts: "a row saying refunded over money that never went
-- back is the one outcome a buyer cannot be left with"). But a seller can also
-- call it straight through PostgREST, and for an order Stripe charged that
-- marked it refunded with the buyer's money never returned (and stock put
-- back, and the code's use given back).
--
-- THE FIX. For an order with a provider payment (payment_ref 'pi_...', mirror
-- of PROVIDER_PAYMENT_PREFIX in src/lib/orders/queries.ts) order_refund now
-- answers not_refundable. Such an order is recorded refunded only by the
-- service role: by refundOrder once the provider has refunded it, and by the
-- Connect webhook (charge.refunded), both through order_apply_refund. Orders no
-- provider charged are unchanged: the seller pays the buyer back themselves and
-- records it here, as before.

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
  ref text;
begin
  if not public.mfa_session_ok() then
    return 'not_found';
  end if;

  select o.seller_id, o.payment_ref into owner_id, ref
    from public.orders o
   where o.id = p_order_id;

  if not found
     or not (
       owner_id = (select auth.uid())
       or public.team_role_can(public.team_actor_role(owner_id), 'orders.refund')
     ) then
    return 'not_found';
  end if;

  -- Money a provider took goes back through the provider first; the record
  -- follows from the server (service role), never from a client call.
  if ref like 'pi\_%' then
    return 'not_refundable';
  end if;

  return public.order_apply_refund(p_order_id, p_reason, p_restock);
end
$$;

-- Recreating a function re-opens it to anon in this schema: restate both ways.
revoke execute on function public.order_refund(uuid, text, boolean) from public, anon;
grant execute on function public.order_refund(uuid, text, boolean) to authenticated, service_role;

comment on function public.order_refund(uuid, text, boolean) is
  'The seller takes a paid order back (cancelled before it was sent, returned, or other), optionally restocking it. Self-gated: 2FA session bar, owner or orders.refund. An order a payment provider charged answers not_refundable: it is recorded by the server after the provider refund (order_apply_refund). Returns refunded | not_refundable | not_found.';

notify pgrst, 'reload schema';
