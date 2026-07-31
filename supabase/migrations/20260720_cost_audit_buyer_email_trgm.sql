-- The orders list supports a buyer_email substring search (ILIKE '%term%').
-- A btree index can never serve a leading wildcard, so today that filter scans
-- every one of the seller's orders. A trigram GIN index makes it index-backed.
--
-- Applied to the live project via MCP during the cost audit; recorded here so
-- the repo stays the source of truth and the test replica matches production.
create extension if not exists pg_trgm;

create index if not exists orders_buyer_email_trgm_idx
  on public.orders using gin (buyer_email gin_trgm_ops);
