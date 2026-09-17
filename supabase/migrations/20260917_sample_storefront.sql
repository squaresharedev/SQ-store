-- Two onboarding facts about the person, for the sample storefront.
--
-- THE FEATURE. The storefront list shows a sample storefront (products, layout
-- and theme defined in code, lib/storefront/sample.ts) so a new seller can see
-- what a finished one looks like, and opening it runs a short tour of the
-- designer. The sample is NOT a row in `storefronts`: a real row would count
-- towards setup, analytics, search and "needs attention", and could be embedded
-- or published. Nothing about it is stored except these two flags.
--
-- sample_storefront_hidden_at: set when the seller hides the sample from their
-- list, cleared when they bring it back. A toggle, not first-write-wins.
--
-- editor_tour_seen_at: when the designer tour first started for them in the
-- sample, so it starts by itself once. First write wins; the sample's own
-- "Take the tour" button replays it without touching this.
--
-- WHY COLUMNS, NOT localStorage. Same reason as onboarding_completed_at and
-- setup_celebrated_at: both are facts about the person, not a browser, and a
-- server-rendered list that read localStorage would flash a hidden sample back
-- on every load.
--
-- Nullable, no default, no backfill. The app treats ONLY an explicit null as
-- "not yet", so a read that does not carry these columns (a deployment ahead of
-- this migration) shows no sample and starts no tour, rather than the reverse.
-- No new RLS: "Users can update their own profile" is row level and covers both
-- writes, which only ever target the caller's own row.

alter table public.profiles
  add column if not exists sample_storefront_hidden_at timestamptz,
  add column if not exists editor_tour_seen_at timestamptz;

comment on column public.profiles.sample_storefront_hidden_at is
  'When this person hid the sample storefront from their storefront list. Null = shown. The sample itself is code, never a storefronts row.';

comment on column public.profiles.editor_tour_seen_at is
  'When the storefront designer tour first started for this person (in the sample storefront). Null = not started yet.';
