-- ════════════════════════════════════════════════════════════════════
-- CONTENT MODERATION: takedown state on the seller's own content.
--
-- WHAT THIS IS FOR. Buyers report a product or a storefront (the notice side
-- lives in the admin repo's 0007_content_reports.sql, on the shared `reports`
-- table). Staff then decide, and a decision to remove has to be recorded
-- somewhere that every public read can see. That is what these columns are.
--
-- WHY NOT REUSE `products.status`. `status` is the SELLER's field: active,
-- draft, archived, theirs to set from the dashboard whenever they like. A
-- takedown recorded there would be reversible by the person it was applied to,
-- which is not a takedown. So moderation gets its own column, and the trigger
-- below is what makes "the seller cannot touch it" true rather than merely
-- intended.
--
-- WHY A TRIGGER AND NOT A COLUMN GRANT. The obvious form is
-- `revoke update (moderation_status) on products from authenticated`, and it
-- does not work: PostgreSQL will not let a column-level revoke cut into an
-- existing table-level UPDATE grant (it warns and changes nothing). Supabase
-- grants table-level UPDATE to authenticated by default, so the column grant
-- would be a comforting no-op. A trigger is checked on every write regardless
-- of how the grants were last rebuilt, which matters here because recreating a
-- view or function in this project re-grants anon/authenticated as a side
-- effect (see docs/context.md on the PostgREST auto-grant trap).
--
-- Apply via Supabase MCP (apply_migration) or the SQL editor.
-- ════════════════════════════════════════════════════════════════════

-- ---- 1. The columns -------------------------------------------------------
-- `ok` by default so existing rows stay visible; a takedown is always an
-- explicit act. `moderation_ground` mirrors REMOVAL_GROUNDS in
-- @squaresharedev/moderation and `moderation_note` is the staff sentence that
-- goes with it: together they are the statement of reasons the seller is shown
-- and is entitled to (DSA Art. 17), which is why the note is stored rather
-- than composed fresh at display time.

alter table public.products
  add column if not exists moderation_status text not null default 'ok',
  add column if not exists moderation_ground text,
  add column if not exists moderation_note   text,
  add column if not exists moderated_at      timestamptz,
  add column if not exists moderated_by      uuid references public.admin_users (id) on delete set null;

alter table public.storefronts
  add column if not exists moderation_status text not null default 'ok',
  add column if not exists moderation_ground text,
  add column if not exists moderation_note   text,
  add column if not exists moderated_at      timestamptz,
  add column if not exists moderated_by      uuid references public.admin_users (id) on delete set null;

-- Same columns on artifacts (SQ-app's table, same database) so one admin queue
-- can action marketplace content too. Additive and defaulted, so SQ-app is
-- unaffected until it reads them.
alter table public.artifacts
  add column if not exists moderation_status text not null default 'ok',
  add column if not exists moderation_ground text,
  add column if not exists moderation_note   text,
  add column if not exists moderated_at      timestamptz,
  add column if not exists moderated_by      uuid references public.admin_users (id) on delete set null;

do $$
declare
  target text;
begin
  foreach target in array array['products', 'storefronts', 'artifacts'] loop
    execute format(
      'alter table public.%I drop constraint if exists %I',
      target, target || '_moderation_status_check'
    );
    execute format(
      'alter table public.%I add constraint %I check (moderation_status in (''ok'', ''removed''))',
      target, target || '_moderation_status_check'
    );
    execute format(
      'alter table public.%I drop constraint if exists %I',
      target, target || '_moderation_note_check'
    );
    -- 500 chars: the seller reads this verbatim, so it is bounded like any
    -- other published text. Mirrors REMOVAL_NOTE_MAX.
    execute format(
      'alter table public.%I add constraint %I check (moderation_note is null or char_length(moderation_note) <= 500)',
      target, target || '_moderation_note_check'
    );
  end loop;
end
$$;

comment on column public.products.moderation_status is
  'Takedown state, staff-only (see guard_moderation_columns). ''ok'' or ''removed''. Separate from status, which is the seller''s own draft/active field. Mirror of MODERATION_STATUSES in @squaresharedev/moderation.';
comment on column public.products.moderation_ground is
  'Why staff removed it. Mirror of REMOVAL_GROUNDS in @squaresharedev/moderation. Shown to the seller.';
comment on column public.products.moderation_note is
  'The staff sentence shown to the seller alongside the ground. Part of the statement of reasons, so it is stored, not recomposed.';

comment on column public.storefronts.moderation_status is
  'Takedown state, staff-only. A removed storefront takes its whole embed and every hosted product page with it.';

-- Partial indexes: the only questions anyone asks are "what is removed" and
-- "is this one removed", and almost every row is 'ok'.
create index if not exists products_moderation_removed_idx
  on public.products (moderated_at desc) where moderation_status <> 'ok';
create index if not exists storefronts_moderation_removed_idx
  on public.storefronts (moderated_at desc) where moderation_status <> 'ok';
create index if not exists artifacts_moderation_removed_idx
  on public.artifacts (moderated_at desc) where moderation_status <> 'ok';

-- ---- 2. The guard ---------------------------------------------------------
-- One table-agnostic trigger function rather than three near-copies: it reads
-- the guarded columns out of to_jsonb(OLD/NEW), so adding a fourth moderated
-- table is one CREATE TRIGGER and no new logic.
--
-- The test is `current_user`, which is set by PostgREST's SET ROLE and cannot
-- be influenced by anything in the request body. service_role bypasses RLS
-- anyway; this makes it the only thing that can write moderation state, which
-- is the actual security property. A seller's own UPDATE still succeeds for
-- every other column, so an edit that happens to select these columns without
-- changing them is not punished.

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
    'moderated_at', 'moderated_by'
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
  'Refuses any change to moderation_* columns unless the writer is service_role. Attached to products, storefronts and artifacts.';

drop trigger if exists products_guard_moderation on public.products;
create trigger products_guard_moderation
  before update on public.products
  for each row execute function public.guard_moderation_columns();

drop trigger if exists storefronts_guard_moderation on public.storefronts;
create trigger storefronts_guard_moderation
  before update on public.storefronts
  for each row execute function public.guard_moderation_columns();

drop trigger if exists artifacts_guard_moderation on public.artifacts;
create trigger artifacts_guard_moderation
  before update on public.artifacts
  for each row execute function public.guard_moderation_columns();

-- ---- 3. The seller has to be told -----------------------------------------
-- The type list lives in TWO places: NOTIFICATION_TYPES in
-- lib/notifications/types.ts and this CHECK. Adding one without the other
-- makes createNotification fail SILENTLY, because notification creation is
-- best-effort by contract. That is how a removal notice would go missing, and
-- a removal nobody was told about is the one failure this whole feature is
-- built to avoid.

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type = any (array['team','payment','stock','order','system','security','policy']));

comment on constraint notifications_type_check on public.notifications is
  'Mirror of NOTIFICATION_TYPES in lib/notifications/types.ts. Update both together: a type present in one and not the other fails the insert silently.';
