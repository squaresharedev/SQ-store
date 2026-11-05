-- =============================================================================
-- The two-factor rule on the seller tables that were added without it.
--
-- WHAT WAS OPEN. Every seller table carries the RESTRICTIVE policy
-- "Require two-factor when enrolled" (20260923): a session that has not passed
-- the account's second factor (aal1) reads none of the store's rows, so a
-- stolen password alone opens nothing. Four tables created since were given
-- their member SELECT policy but not this one:
--
--   reviews                   every review of the store, including the ones
--                             the seller hid (hidden_reason personal_info is
--                             a buyer's personal details), held and blocked
--                             ones, and the order each came from;
--   review_imports            file names and counts of the seller's imports;
--   product_rating_summaries  the store's rating counts;
--   storefront_funnel_daily   the store's buyer funnel counts.
--
-- With only a 2FA seller's password, GET /rest/v1/reviews with the aal1 token
-- GoTrue hands out returned all of them. Writes were never open (no client
-- write policy on any of the four, and review_set_visibility checks
-- mfa_session_ok itself).
--
-- THE FIX is the same policy, word for word. Buyers are unaffected: they read
-- through the server, with the service role. tests/integration/
-- 22-two-factor-rls.test.ts now fails for any table a client can read that
-- lacks it, so the next new table cannot repeat this.
-- =============================================================================

drop policy if exists "Require two-factor when enrolled" on public.reviews;
create policy "Require two-factor when enrolled" on public.reviews
  as restrictive for all to authenticated
  using ((select public.mfa_session_ok()))
  with check ((select public.mfa_session_ok()));

drop policy if exists "Require two-factor when enrolled" on public.review_imports;
create policy "Require two-factor when enrolled" on public.review_imports
  as restrictive for all to authenticated
  using ((select public.mfa_session_ok()))
  with check ((select public.mfa_session_ok()));

drop policy if exists "Require two-factor when enrolled" on public.product_rating_summaries;
create policy "Require two-factor when enrolled" on public.product_rating_summaries
  as restrictive for all to authenticated
  using ((select public.mfa_session_ok()))
  with check ((select public.mfa_session_ok()));

drop policy if exists "Require two-factor when enrolled" on public.storefront_funnel_daily;
create policy "Require two-factor when enrolled" on public.storefront_funnel_daily
  as restrictive for all to authenticated
  using ((select public.mfa_session_ok()))
  with check ((select public.mfa_session_ok()));

notify pgrst, 'reload schema';
