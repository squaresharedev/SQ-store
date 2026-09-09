-- Per-order purchase limit: how many of ONE product a buyer may take at once.
--
-- WHY. Until now a product page offered exactly one unit and the buy button was
-- a link or a mailto, so "how many" was a sentence the buyer typed. A quantity
-- picker turns that into a number, and a number that reaches a checkout is a
-- number someone will try to forge. The seller states the ceiling here, on the
-- row, and every layer above reads it from here rather than from the request.
--
-- ONE NUMBER, NOT A TIER TABLE. There is no per-option limit, no per-buyer
-- limit and no bulk pricing: this is the MVP's single preset ceiling for the
-- whole product, exactly like max_per_order on a stock keeping unit and nothing
-- more. Anything richer is rows, not a column, and it earns them when it is
-- actually needed.
--
-- WHY NOT NULL WITH A DEFAULT. A nullable "no limit" would mean the ceiling is
-- decided by whichever layer happened to remember the fallback, and the layer
-- that forgets is the one an attacker finds. Every product has a concrete,
-- bounded ceiling from the moment it exists; existing rows inherit 10, which is
-- the same answer the picker would have given them.
--
-- 100 IS THE PLATFORM CEILING and it is a fence, not a preference. The seller's
-- own number lives inside it, the Zod schema
-- (src/lib/validation/product.ts, PURCHASE_QUANTITY_MAX) mirrors it, and this
-- CHECK is what a service-role write cannot climb. It also bounds
-- price_cents * quantity well inside anything the money path has to hold.

alter table public.products
  add column max_per_order integer not null default 10;

alter table public.products
  add constraint products_max_per_order_range
    check (max_per_order >= 1 and max_per_order <= 100);

comment on column public.products.max_per_order is
  'How many units of this product one buyer may take in a single order, 1-100. Seller-set, server-authoritative: the buyer picker, the public payload cap and resolveOrderQuantity all read it from here. Validated by productWriteSchema.';

-- THE LAST FENCE, not the first. resolveOrderQuantity
-- (src/lib/products/order-quantity.ts) is the boundary a checkout is supposed
-- to pass, and it refuses an over-limit quantity outright. This makes the
-- atomic decrement refuse it too, so a future caller that skips that boundary —
-- a bug, a hand-run script, a compromised worker holding the service role —
-- still cannot take 500 units of a product capped at 3. The stock check and the
-- limit check are the same single UPDATE's WHERE clause, so neither can be
-- raced past the other.
--
-- RE-GRANTED DELIBERATELY: `create or replace function` re-runs PostgREST's
-- auto-grant, which hands EXECUTE back to anon and authenticated. Replacing the
-- body without repeating these four lines would publish an inventory-decrement
-- RPC to every unauthenticated visitor.
create or replace function public.decrement_stock(
  p_product_id uuid,
  p_quantity integer
) returns boolean
language sql
security invoker
set search_path = ''
as $$
  update public.products
     set stock_quantity = stock_quantity - p_quantity,
         updated_at = now()
   where id = p_product_id
     and track_stock
     and p_quantity > 0
     and p_quantity <= max_per_order
     and stock_quantity >= p_quantity
  returning true;
$$;

revoke execute on function public.decrement_stock(uuid, integer) from public;
revoke execute on function public.decrement_stock(uuid, integer) from anon;
revoke execute on function public.decrement_stock(uuid, integer) from authenticated;
grant execute on function public.decrement_stock(uuid, integer) to service_role;
