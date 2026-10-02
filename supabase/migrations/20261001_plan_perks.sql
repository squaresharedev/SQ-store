-- Plan perks: the plans page's new entry point in the pricing funnel.
--
-- WHY. Paid plans gain the orders CSV export (src/lib/billing/plans.ts,
-- PLANS[..].perks). On Free, the Orders page offers it as a link to the plans
-- page, and the funnel should be able to tell those arrivals apart from every
-- other entry point.
--
-- WHAT THIS CHANGES. One value, 'orders_export', joins the
-- seller_funnel_events source CHECK. MIRROR of PRICING_SOURCES in
-- src/lib/billing/paths.ts: a source missing here makes its funnel insert fail
-- silently (recording is best-effort by contract). Edit both together.
--
-- Apply via the Management API query endpoint or the SQL editor.

alter table public.seller_funnel_events
  drop constraint if exists seller_funnel_events_source_check;

alter table public.seller_funnel_events
  add constraint seller_funnel_events_source_check
    check (source is null or source in ('sidebar', 'profile_menu', 'settings', 'storefront_limit',
                                        'team_limit', 'order_nudge', 'analytics_nudge', 'email',
                                        'notification', 'checkout_cancel', 'orders_export'));

notify pgrst, 'reload schema';
