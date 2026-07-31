-- Cost-audit: covering indexes for hot read paths and unindexed foreign keys.
-- All additive (create index if not exists) — no data or result changes, only
-- planner options. Tables are read-heavy (dashboard) and written rarely
-- (checkout/seed), so the extra write cost is negligible against the scan cost
-- these remove once order/product volume grows.

-- orders.product_id / storefront_id are foreign keys with no covering index
-- (flagged by the Supabase performance linter). Without them, deleting a product
-- or storefront forces a full scan of orders to apply ON DELETE SET NULL, and
-- per-storefront sales lookups seq-scan. Index both FK columns.
create index if not exists orders_product_id_idx
  on public.orders (product_id);
create index if not exists orders_storefront_id_idx
  on public.orders (storefront_id);

-- Orders list (lib/orders/queries.ts) filters seller_id = X AND status = Y.
-- Existing indexes cover (seller_id, created_at) and (seller_id, channel) but
-- not status, so the status filter is a post-scan predicate today.
create index if not exists orders_seller_status_idx
  on public.orders (seller_id, status);

-- Orders list also offers sort-by-amount (sort.field === "amount" -> amount_cents).
-- Without this the seller's rows are scanned via the created_at index and sorted
-- in memory on every amount-sorted page.
create index if not exists orders_seller_amount_idx
  on public.orders (seller_id, amount_cents);

-- Product list (lib/products/queries.ts) is always owner_id = X ORDER BY
-- created_at desc. products_owner_id_idx (owner_id) covers the filter but not the
-- sort; the composite makes it an index-ordered scan with no separate sort.
-- (products_owner_id_idx becomes largely redundant once this exists — left in
-- place; drop is a separate, reviewable decision.)
create index if not exists products_owner_created_idx
  on public.products (owner_id, created_at desc);

-- Storefront list (lib/storefront/queries.ts) is owner_id = X ORDER BY
-- updated_at desc. Same shape as products above.
create index if not exists storefronts_owner_updated_idx
  on public.storefronts (owner_id, updated_at desc);
