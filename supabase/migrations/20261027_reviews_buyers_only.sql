-- =============================================================================
-- Only a buyer can write a native review: the database's own say.
-- =============================================================================
-- The review route (app/api/products/[id]/reviews) already refuses anyone
-- without a paid, unrefunded order of the product: the order's link is the
-- credential, and lib/reviews/eligibility.ts decides. This makes the database
-- refuse the same thing, so no future writer (a script, a new route, a bug)
-- can put a "Verified buyer" review on a product nobody bought.
--
-- A NATIVE review must name its order, and that order must be of the same
-- product, paid, and not refunded, AT THE MOMENT THE REVIEW IS WRITTEN.
-- Insert only: an order refunded later keeps its review (the refund trigger
-- in 20261025_reviews.sql takes the badge away), and an order deleted later
-- sets order_id null on its review by foreign key, which must not fail.
-- Imported reviews are untouched: they never name an order and are never
-- verified (reviews_origin, reviews_imported_not_verified).
--
-- NOT YET APPLIED to prod (2026-10-27). Nothing in the app depends on it.
-- Once applied, replay it in tests/db/prod-migrations.sql and list
-- reviews_require_purchase() in scripts/lib/prod-schema.ts.
--
-- Apply via the Management API query endpoint or the SQL editor.
-- =============================================================================

create or replace function public.reviews_require_purchase()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'native' and not exists (
    select 1
      from public.orders o
     where o.id = new.order_id
       and o.product_id = new.product_id
       and o.status = 'paid'
       and o.refunded_at is null
  ) then
    raise exception 'a native review needs a paid, unrefunded order of this product'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

revoke execute on function public.reviews_require_purchase() from public, anon, authenticated;

drop trigger if exists reviews_require_purchase on public.reviews;
create trigger reviews_require_purchase
  before insert on public.reviews
  for each row execute function public.reviews_require_purchase();

comment on function public.reviews_require_purchase() is
  'Refuses a native review whose order is missing, of another product, unpaid or refunded. Insert only. Mirrors lib/reviews/eligibility.ts.';
