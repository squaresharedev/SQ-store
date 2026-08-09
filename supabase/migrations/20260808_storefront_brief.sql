-- Creation-flow brief: what the seller told us about the store when they made
-- this storefront.
--
-- WHY NOT INSIDE `config`: config is the storefront's PUBLIC contract. It is
-- what the embed endpoint serialises and hands to a third-party page, and its
-- schema is a Zod strictObject precisely so nothing can ride along in it. The
-- brief is the opposite kind of data: seller-side intent (what they sell, how
-- buyers get it, the look they want) that no buyer should ever receive. Its own
-- column keeps the public contract narrow and keeps the two lifecycles apart,
-- since the brief is written once at creation and config is rewritten on every
-- save.
--
-- WHY NOT ITS OWN TABLE: four optional fields, strictly one per storefront,
-- never queried on their own. A table would add a join, a second RLS policy set
-- and a delete cascade to maintain, for nothing this shape needs.
--
-- WHAT READS IT: today, nothing but the seller's own GDPR export. It exists so
-- the template recommender (see lib/storefront/templates.ts) has signals to
-- match against when the template catalogue lands. The one answer that already
-- does work at creation time is `vibe`, which selects a starting theme; that is
-- applied to `config` by createStorefront, not stored here twice.
--
-- An empty object is meaningful: it means the seller skipped the flow, so a
-- recommendation built from it should be treated as low confidence rather than
-- as "no preference".

alter table public.storefronts
  add column if not exists brief jsonb not null default '{}'::jsonb;

comment on column public.storefronts.brief is
  'Creation-flow answers (category, fulfilment, vibe) used to recommend templates. Seller-side only: never part of the public embed payload. Empty object means the flow was skipped.';

-- NO RLS CHANGE. The storefronts policies are row-scoped to the owner and apply
-- to every column on the table, so the brief inherits exactly the access the
-- rest of the row already has. Nothing grants anon a read of this table (the
-- embed endpoint goes through service_role and applies its own origin check),
-- so there is no path by which a buyer sees this.
