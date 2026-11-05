-- =============================================================================
-- ROLLBACK of 20261103_two_factor_review_tables.sql. Not a migration: run by
-- hand only. Reopens the aal1 read of these four tables for a 2FA account; there
-- is no reason to, short of the policy itself misbehaving.
-- =============================================================================

begin;

drop policy if exists "Require two-factor when enrolled" on public.reviews;
drop policy if exists "Require two-factor when enrolled" on public.review_imports;
drop policy if exists "Require two-factor when enrolled" on public.product_rating_summaries;
drop policy if exists "Require two-factor when enrolled" on public.storefront_funnel_daily;

notify pgrst, 'reload schema';

commit;
