-- When this person was first shown their finished setup card ("You're set up"),
-- so it is shown once and never again.
--
-- THE PROBLEM. Overview's setup checklist turns into a "You're set up" card with
-- the live product page's link once every step is done. The only thing that
-- ever hid it was a per-device localStorage flag set by clicking Hide, so it came
-- back on every other browser, in a private window, after clearing site data,
-- and in the server render of every page load (a server cannot read
-- localStorage). A payoff shown on every visit stops being a payoff.
--
-- WHY A COLUMN, NOT localStorage. Same reason as onboarding_completed_at: "once"
-- is a fact about the person, not about a browser.
--
-- WHY IT IS WRITTEN ON SIGHT. The card records this the first time it renders
-- (lib/onboarding/actions.ts, markSetupCelebrated) WITHOUT revalidating, so it
-- stays up for the visit it was shown on and is gone from the next one. The
-- checklist itself is still derived, never stored: if a seller later unpublishes
-- everything the unfinished checklist comes back, and finishing again does not
-- replay the celebration.
--
-- Nullable, no default: null means not shown yet. The app treats ONLY an
-- explicit null as pending, so a read that does not carry the column (a
-- deployment ahead of this migration) shows nothing, rather than the card on
-- every visit. No new RLS: "Users can update their own profile" is row level and
-- already covers the one write, to the caller's own row while it is still null.
--
-- NO BACKFILL. The card had not shipped before this, so nobody has seen it yet:
-- every seller whose setup is complete sees it exactly once.

alter table public.profiles
  add column if not exists setup_celebrated_at timestamptz;

comment on column public.profiles.setup_celebrated_at is
  'When this person was first shown their finished setup card on Overview. Null = not shown yet. Checklist progress is derived from real data, never stored.';
