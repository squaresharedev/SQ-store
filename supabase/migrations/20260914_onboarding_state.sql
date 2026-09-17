-- Whether this person has been through the dashboard welcome flow, so it opens
-- once and never again.
--
-- THE PROBLEM. A new seller lands on Overview and the first thing they meet is
-- the red "you can't publish or sell" strip, with nothing saying what the app is
-- for or what to do first. The welcome flow (components/onboarding/
-- WelcomeFlow.tsx) opens on that first arrival instead: a welcome, the three
-- trader-identity fields the publish gate needs, and a map of where everything
-- lives. Finishing, skipping or closing it records this timestamp.
--
-- WHY A COLUMN, NOT localStorage. "Once" is a fact about the person, not about
-- a browser. A seller who signs up on a phone must not be welcomed again on a
-- laptop, and clearing site data must not replay it. Same shape and same home
-- as legal_accepted_at.
--
-- WHY ONLY THIS. The setup checklist under the flow (lib/onboarding/steps.ts) is
-- DERIVED on every render from real rows: the trader identity, the products,
-- the storefront blocks. Storing its progress would be a second copy of facts
-- that already have a home, and a second copy drifts.
--
-- Nullable, no default: null means not seen yet. The app treats ONLY an
-- explicit null as pending, so a read that does not carry the column (a stale
-- select, a deployment ahead of this migration) opens nothing rather than
-- welcoming an established seller. No new RLS: "Users can update their own
-- profile" already covers the one write, which sets the caller's own row and
-- only while it is still null.
--
-- WHY THE BACKFILL. Accounts that already own a product or a storefront are
-- past the point a welcome helps, so they are marked done as of this migration.
-- Accounts that signed up and never started get the flow on their next visit,
-- which is exactly who it is for. (profiles_set_updated_at bumps updated_at on
-- the backfilled rows; harmless.)

alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.profiles.onboarding_completed_at is
  'When this person finished, skipped or closed the dashboard welcome flow. Null = not seen yet. Checklist progress is derived from real data, never stored.';

update public.profiles p
   set onboarding_completed_at = now()
 where p.onboarding_completed_at is null
   and (exists (select 1 from public.products pr where pr.owner_id = p.id)
        or exists (select 1 from public.storefronts s where s.owner_id = p.id));
