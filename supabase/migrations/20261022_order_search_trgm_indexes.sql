-- ORDER SEARCH: index the three order columns the search still scanned.
--
-- The top-bar search (api/search) and the Orders page search (lib/orders/queries)
-- both filter orders with ILIKE '%term%' on the tracking number and on the
-- buyer's name and city inside ship_to. 20260806_universal_search_indexes
-- indexed product_title and buyer_email was indexed before that; these three
-- were left, so each keystroke read the seller's whole order history for them.
--
-- The expressions are exactly what PostgREST writes for `ship_to->>name`
-- (ship_to ->> 'name'), so the planner can use them. Same caveat as before:
-- a trigram needs three characters, and the seller_id equality filter on every
-- query bounds the scan for a shorter term.

create index if not exists orders_tracking_number_trgm_idx
  on public.orders using gin (tracking_number gin_trgm_ops);

create index if not exists orders_ship_to_name_trgm_idx
  on public.orders using gin ((ship_to ->> 'name') gin_trgm_ops);

create index if not exists orders_ship_to_city_trgm_idx
  on public.orders using gin ((ship_to ->> 'city') gin_trgm_ops);
