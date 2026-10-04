-- Plan cancellations: what a seller tells us when they cancel a paid plan.
--
-- WHY. Cancelling used to happen on Stripe's hosted portal, so all we ever
-- learned was that a plan ended. It now happens in the app (cancelPlan in
-- src/lib/billing/actions.ts), which asks why, optionally, and records the
-- answer here for the admin panel's Plans section (the SQ-admin repo reads it
-- with the service role).
--
-- WHAT THIS ADDS. One table, plan_cancellations: one row per cancellation,
-- with the plan it ends, when it ends, the reason (optional), a note
-- (optional), and when the seller changed their mind (resumed_at).
--
-- PRIVACY.
--   - Service role only: RLS on with no policies, and no grant to the API
--     roles. Sellers never read it back; staff read it through the admin.
--   - Deleted with the account (on delete cascade), like seller_billing and
--     seller_funnel_events, and included in the seller's data export.
--   - Kept 13 months, like the funnel: long enough to see a year's churn.
--
-- MIRROR. reason CHECK <-> CANCELLATION_REASONS in
-- src/lib/billing/cancellation.ts (Stripe's cancellation_details codes plus
-- 'temporary'). A reason missing here makes the row fail to record.
--
-- Apply via the Management API query endpoint or the SQL editor.

create table if not exists public.plan_cancellations (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.profiles (id) on delete cascade,
  plan              text not null check (plan in ('starter', 'pro')),
  billing_interval  text check (billing_interval in ('month', 'year')),
  reason            text check (reason in ('too_expensive', 'unused', 'missing_features',
                                           'switched_service', 'temporary', 'other')),
  detail            text check (char_length(detail) <= 1000),
  -- When the paid period ends and the store moves to Free.
  ends_at           timestamptz not null,
  created_at        timestamptz not null default now(),
  -- Set when the seller pressed "Keep my plan" before ends_at.
  resumed_at        timestamptz
);

comment on table public.plan_cancellations is
  'A seller cancelling a paid plan, with the optional reason and note. Written by the store app, read by the admin panel. Service role only.';

-- One open cancellation per plan end: a double submit is dropped as already
-- recorded. A resume closes the row, so cancelling again records a new one.
create unique index if not exists plan_cancellations_open_idx
  on public.plan_cancellations (owner_id, ends_at)
  where resumed_at is null;

-- The admin lists them newest first.
create index if not exists plan_cancellations_created_idx
  on public.plan_cancellations (created_at desc);

alter table public.plan_cancellations enable row level security;
revoke all on table public.plan_cancellations from public, anon, authenticated;
grant all on table public.plan_cancellations to service_role;

notify pgrst, 'reload schema';
