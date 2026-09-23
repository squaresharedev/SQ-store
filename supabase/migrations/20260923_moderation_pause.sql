-- ════════════════════════════════════════════════════════════════════
-- MODERATION: PAUSE, AND THE SELLER'S WAY BACK.
--
-- Until now a takedown had one shape, 'removed', and one exit: staff putting
-- it back. That is right for a listing that should never have existed and
-- wrong for the much commoner case, a listing with one thing wrong with it (a
-- photo that shows too much, a claim it cannot back up). Removing that and
-- telling the seller "email us" turns a five-minute fix into a support thread.
--
-- So staff now choose between two outcomes:
--
--   paused   Hidden from buyers everywhere, exactly like removed. The seller
--            is told what to change, changes it, and asks for another look.
--            Staff then put it back or take it down for good.
--   removed  Hidden, final. The seller is told why and how to appeal.
--
-- VISIBILITY NEEDS NO CHANGE. Every public read goes through
-- isContentVisible(), which admits 'ok' and nothing else, so a paused row is
-- hidden by the same gate that hides a removed one: this migration only has
-- to make the value legal.
--
-- Artifacts are deliberately left at ('ok', 'removed'). The marketplace has no
-- surface where a seller could fix something and ask again, and a state with
-- no way out is just a slower removal.
--
-- Apply via Supabase MCP (apply_migration) or the SQL editor, after
-- 20260918_content_moderation.
-- ════════════════════════════════════════════════════════════════════

-- ---- 1. The value ---------------------------------------------------------

do $$
declare
  target text;
begin
  foreach target in array array['products', 'storefronts'] loop
    execute format(
      'alter table public.%I drop constraint if exists %I',
      target, target || '_moderation_status_check'
    );
    execute format(
      'alter table public.%I add constraint %I check (moderation_status in (''ok'', ''paused'', ''removed''))',
      target, target || '_moderation_status_check'
    );
  end loop;
end
$$;

comment on column public.products.moderation_status is
  'Takedown state, staff-only (see guard_moderation_columns). ''ok'', ''paused'' (hidden until the seller fixes it and staff approve) or ''removed'' (hidden, final). Separate from status, which is the seller''s own draft/active field. Mirror of MODERATION_STATUSES in @squaresharedev/moderation.';

-- ---- 2. The seller's request ----------------------------------------------
-- When the seller of a PAUSED item said "I have changed it, look again". Null
-- means nobody is waiting on staff. Cleared by every staff decision, so a
-- stale request can never outlive the decision it asked for.
--
-- Written by SQ-store's server action with service_role after it has checked,
-- with the seller's own session, that they may edit the item and that it is
-- paused. It is guarded like the other moderation columns below, because a
-- seller able to set it directly could set it on a REMOVED item and put a
-- final decision back in front of staff as often as they liked.

alter table public.products
  add column if not exists moderation_review_requested_at timestamptz;

alter table public.storefronts
  add column if not exists moderation_review_requested_at timestamptz;

comment on column public.products.moderation_review_requested_at is
  'When the seller of a paused product asked staff to look again. Null when nothing is waiting. Staff-only write (guard_moderation_columns).';
comment on column public.storefronts.moderation_review_requested_at is
  'When the seller of a paused storefront asked staff to look again. Null when nothing is waiting. Staff-only write (guard_moderation_columns).';

-- The admin panel's "sellers waiting on you" list and its notification scan
-- both ask exactly this question, and almost every row answers null.
create index if not exists products_moderation_review_idx
  on public.products (moderation_review_requested_at)
  where moderation_review_requested_at is not null;
create index if not exists storefronts_moderation_review_idx
  on public.storefronts (moderation_review_requested_at)
  where moderation_review_requested_at is not null;

-- ---- 3. The guard, widened by one column ----------------------------------
-- Same function, same test, one more name in the list. Reading the columns
-- out of to_jsonb() is what lets it stay attached to artifacts, which do not
-- have the new column: a missing key is null on both sides, so it is never a
-- change.

create or replace function public.guard_moderation_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  guarded    text;
  before_row jsonb := to_jsonb(old);
  after_row  jsonb := to_jsonb(new);
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  foreach guarded in array array[
    'moderation_status', 'moderation_ground', 'moderation_note',
    'moderated_at', 'moderated_by', 'moderation_review_requested_at'
  ] loop
    if (before_row -> guarded) is distinct from (after_row -> guarded) then
      raise exception
        'Moderation state is set by SquareShare staff and cannot be changed here (column %).', guarded
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.guard_moderation_columns() is
  'Refuses any change to moderation_* columns (including moderation_review_requested_at) unless the writer is service_role. Attached to products, storefronts and artifacts.';
