-- Buy button: a fourth channel, 'button'.
--
-- WHY. A seller who sells one product can now put their OWN button on their
-- own website, pointing at the product's hosted page with ?via=button (see
-- src/lib/storefront/product-page-url.ts). The marker rides from the product
-- page to the checkout to the order, so the visit and the sale are filed under
-- where the buyer came from, and the seller can tell their button's sales from
-- the embed's and from a shared link's ('direct').
--
-- CHANNELS (one vocabulary for both tables, ORDER_CHANNELS in
-- src/types/order-view.ts; edit all three together):
--   embed        the storefront embedded on the seller's own site
--   marketplace  the Square Share marketplace
--   direct       the hosted pages, reached any other way
--   button       the seller's own buy button on their website (new)
--
-- Widening a CHECK is backward compatible: no existing row changes, and the
-- code that writes 'button' must not ship before this does (a signal would be
-- dropped silently and an order write would fail).
--
-- No policy, grant or function changes. The aggregates group by channel
-- generically and need nothing.
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. Orders -------------------------------------------------------------------

alter table public.orders
  drop constraint orders_channel_check;
alter table public.orders
  add constraint orders_channel_check
    check (channel in ('embed', 'marketplace', 'direct', 'button'));

-- ---- 2. Signals ------------------------------------------------------------------

-- Declared inline in 20260830_storefront_signals.sql, so Postgres named it.
-- Dropped without IF EXISTS on purpose: a wrong name must fail loudly rather
-- than leave the old CHECK in place beside the new one.
alter table public.storefront_signals
  drop constraint storefront_signals_channel_check;
alter table public.storefront_signals
  add constraint storefront_signals_channel_check
    check (channel in ('embed', 'marketplace', 'direct', 'button'));
