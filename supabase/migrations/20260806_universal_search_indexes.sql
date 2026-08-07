-- UNIVERSAL SEARCH: make the top-bar search bar's substring matches
-- index-backed instead of scanning.
--
-- The search hits five surfaces at once, per keystroke, and every one of them
-- filters with ILIKE '%term%'. A leading wildcard is exactly what a btree index
-- cannot serve, so without these each search was a sequential scan of the
-- account's rows on every keystroke. A trigram GIN index turns the same query
-- into a bitmap index scan.
--
-- pg_trgm is already enabled (20260720_cost_audit_buyer_email_trgm.sql), and
-- orders.buyer_email already has its trigram index from that same migration.
--
-- CAVEAT, deliberate: a trigram index needs THREE characters to build a
-- trigram, so 2-character queries still plan as a scan. That is acceptable
-- here because every search query also carries an equality filter on the
-- owner/seller/user column, which bounds the scan to one account's rows. The
-- API rejects anything shorter than 2 characters outright.

-- The primary search surface. Previously unindexed for ILIKE entirely: the
-- products page's own `?q=` filter scanned too.
create index if not exists products_title_trgm_idx
  on public.products using gin (title gin_trgm_ops);

-- Storefront lookup by name.
create index if not exists storefronts_name_trgm_idx
  on public.storefronts using gin (name gin_trgm_ops);

-- Orders searched by the product name recorded on them (the denormalised
-- snapshot column, which is what the orders list displays).
create index if not exists orders_product_title_trgm_idx
  on public.orders using gin (product_title gin_trgm_ops);

-- Notification history search. Only the title is indexed: `body` is long-form
-- and its search is already bounded to one user's own notifications by the
-- user_id equality filter, so it does not earn the write cost of a second GIN.
create index if not exists notifications_title_trgm_idx
  on public.notifications using gin (title gin_trgm_ops);
