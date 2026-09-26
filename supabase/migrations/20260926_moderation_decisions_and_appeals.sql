-- ════════════════════════════════════════════════════════════════════
-- MODERATION: A RECORD PER DECISION, WHAT TO FIX, AND APPEALS.
--
-- Until now a takedown lived only on the content row: a status, a ground and
-- a note, overwritten by the next decision and wiped by a restore. That was
-- enough to hide a listing and not enough for the three things a seller is
-- owed once something of theirs comes down:
--
--   1. WHAT TO CHANGE. "Fix it" pointing at a whole product is a scavenger
--      hunt. Staff now name the parts (the photos, the title, the purchase
--      link) and the seller's edit page lights up exactly those.
--      -> products/storefronts.moderation_fields
--
--   2. A STATEMENT THEY CAN KEEP. EU Digital Services Act Art. 17 gives the
--      provider of restricted content a statement of reasons: what was
--      decided, on what ground, on what facts, and how to challenge it. The
--      seller downloads it as a PDF, so the facts it is built from have to
--      survive the next decision rather than be overwritten by it.
--      -> moderation_decisions, one immutable row per pause or removal
--
--   3. A WAY TO SAY "YOU GOT THIS WRONG". DSA Art. 20 asks for an internal
--      complaint-handling system, free, electronic, and decided by a person.
--      Until now the banner offered a mailto link.
--      -> moderation_appeals, one per decision
--
-- WHO WRITES WHAT. Staff decisions come from the admin panel's service role,
-- exactly like the moderation_* columns. Appeals are filed by SQ-store's
-- server action, which checks the seller's own session first and then writes
-- with the service role (the pattern review-request.ts already uses): a seller
-- who could insert appeal rows directly could file one against somebody
-- else's decision, or rewrite one after staff had answered it. So both tables
-- are READ-ONLY to authenticated, and only for the store they belong to.
--
-- Apply via Supabase MCP (apply_migration) or the SQL editor, after
-- 20260923_moderation_pause.
-- ════════════════════════════════════════════════════════════════════

-- ---- 1. Decisions -----------------------------------------------------------

create table if not exists public.moderation_decisions (
  id             uuid primary key default gen_random_uuid(),
  target_type    text not null check (target_type in ('product', 'storefront')),
  target_id      uuid not null,
  -- The store the content belongs to (the account, not whoever clicked). Team
  -- members of that store read the decision through the policy below.
  owner_id       uuid not null references auth.users (id) on delete cascade,
  -- A snapshot: the statement names the content as it was when decided, and a
  -- seller who renames the listing afterwards does not rewrite the record.
  target_title   text not null check (char_length(target_title) <= 300),
  action         text not null check (action in ('paused', 'removed')),
  -- Mirror of REMOVAL_GROUNDS (@squaresharedev/moderation).
  ground         text not null check (ground in (
                   'illegal', 'sexual', 'violence', 'hate',
                   'counterfeit', 'scam', 'spam', 'other')),
  note           text check (note is null or char_length(note) <= 500),
  -- What the seller must change. Mirror of MODERATION_FIX_FIELDS; checked per
  -- target type below, because a product has no masthead and a storefront no
  -- purchase link.
  fields         text[] not null default '{}',
  -- The facts: how many notices from third parties led here, and what they
  -- alleged. Counts and categories only, never who or their words.
  report_count   integer not null default 0 check (report_count >= 0),
  report_reasons text[] not null default '{}',
  decided_by     uuid references public.admin_users (id) on delete set null,
  decided_at     timestamptz not null default now(),
  constraint moderation_decisions_fields_check check (
    case target_type
      when 'product' then fields <@ array[
        'title', 'description', 'price', 'image', 'photos', 'file',
        'purchaseLink', 'options', 'specs', 'documents', 'safety',
        'shipping', 'other']::text[]
      else fields <@ array[
        'name', 'header', 'text', 'images', 'products', 'background',
        'productPage', 'other']::text[]
    end
  ),
  constraint moderation_decisions_reasons_check check (
    report_reasons <@ array[
      'illegal', 'sexual', 'violence', 'hate',
      'counterfeit', 'scam', 'spam', 'other']::text[]
  )
);

comment on table public.moderation_decisions is
  'One row per staff pause or removal of a product or storefront: the facts a DSA Art. 17 statement of reasons is built from. Immutable once written. Written by the admin panel (service_role); read by the store it belongs to.';

create index if not exists moderation_decisions_target_idx
  on public.moderation_decisions (target_type, target_id, decided_at desc);
create index if not exists moderation_decisions_owner_idx
  on public.moderation_decisions (owner_id, decided_at desc);

-- ---- 2. What to fix, and which decision is current -------------------------
-- On the content row itself, beside the other moderation_* columns, so the
-- edit page reads everything it highlights in the one select it already
-- makes. `moderation_decision_id` is what ties the banner to its statement.

alter table public.products
  add column if not exists moderation_fields text[],
  add column if not exists moderation_decision_id uuid
    references public.moderation_decisions (id) on delete set null;

alter table public.storefronts
  add column if not exists moderation_fields text[],
  add column if not exists moderation_decision_id uuid
    references public.moderation_decisions (id) on delete set null;

alter table public.products drop constraint if exists products_moderation_fields_check;
alter table public.products
  add constraint products_moderation_fields_check check (
    moderation_fields is null or moderation_fields <@ array[
      'title', 'description', 'price', 'image', 'photos', 'file',
      'purchaseLink', 'options', 'specs', 'documents', 'safety',
      'shipping', 'other']::text[]
  );

alter table public.storefronts drop constraint if exists storefronts_moderation_fields_check;
alter table public.storefronts
  add constraint storefronts_moderation_fields_check check (
    moderation_fields is null or moderation_fields <@ array[
      'name', 'header', 'text', 'images', 'products', 'background',
      'productPage', 'other']::text[]
  );

comment on column public.products.moderation_fields is
  'Which parts of a paused product staff asked the seller to change (MODERATION_FIX_FIELDS). Staff-only write (guard_moderation_columns).';
comment on column public.products.moderation_decision_id is
  'The moderation_decisions row behind the current takedown, for its statement of reasons. Null while live. Staff-only write.';
comment on column public.storefronts.moderation_fields is
  'Which parts of a paused storefront staff asked the seller to change. Staff-only write (guard_moderation_columns).';
comment on column public.storefronts.moderation_decision_id is
  'The moderation_decisions row behind the current takedown. Null while live. Staff-only write.';

-- ---- 3. Appeals ---------------------------------------------------------------

create table if not exists public.moderation_appeals (
  id            uuid primary key default gen_random_uuid(),
  decision_id   uuid not null references public.moderation_decisions (id) on delete cascade,
  -- Denormalised from the decision so the policy and the staff queue need no
  -- join. Always equal to the decision's own; the filing action copies them.
  target_type   text not null check (target_type in ('product', 'storefront')),
  target_id     uuid not null,
  owner_id      uuid not null references auth.users (id) on delete cascade,
  -- Who pressed the button: the owner or a team member acting for the store.
  filed_by      uuid references auth.users (id) on delete set null,
  message       text not null check (char_length(message) between 20 and 2000),
  status        text not null default 'open'
                  check (status in ('open', 'upheld', 'overturned')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.admin_users (id) on delete set null,
  -- Staff's answer, shown to the seller verbatim.
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  -- ONE appeal per decision. A person reviewed the complaint and answered it;
  -- a second complaint about the same decision is the same complaint. A new
  -- decision (paused again, then removed) is a new row and can be appealed.
  constraint moderation_appeals_one_per_decision unique (decision_id),
  constraint moderation_appeals_decided_check check (
    (status = 'open') = (decided_at is null)
  )
);

comment on table public.moderation_appeals is
  'A seller''s complaint against one moderation decision (DSA Art. 20). Filed through SQ-store''s server action and answered in the admin panel, both with service_role. Read by the store it belongs to.';

create index if not exists moderation_appeals_open_idx
  on public.moderation_appeals (created_at) where status = 'open';
create index if not exists moderation_appeals_target_idx
  on public.moderation_appeals (target_type, target_id);

-- ---- 4. Access ------------------------------------------------------------------
-- Read: the store's owner and its members, the same test products_select_member
-- uses. Write: nobody but service_role. New tables in this project are
-- auto-granted to anon and authenticated (the PostgREST auto-grant trap), so
-- the grants are set explicitly rather than trusted.

alter table public.moderation_decisions enable row level security;
alter table public.moderation_appeals enable row level security;

revoke all on public.moderation_decisions from anon, authenticated;
revoke all on public.moderation_appeals from anon, authenticated;
grant select on public.moderation_decisions to authenticated;
grant select on public.moderation_appeals to authenticated;
grant all on public.moderation_decisions to service_role;
grant all on public.moderation_appeals to service_role;

drop policy if exists moderation_decisions_select_member on public.moderation_decisions;
create policy moderation_decisions_select_member on public.moderation_decisions
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'store.read')
  );

drop policy if exists moderation_appeals_select_member on public.moderation_appeals;
create policy moderation_appeals_select_member on public.moderation_appeals
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(owner_id), 'store.read')
  );

-- The two-factor rule every seller-readable table carries (20260923): a
-- session that skipped its second factor reads nothing here either.
drop policy if exists "Require two-factor when enrolled" on public.moderation_decisions;
create policy "Require two-factor when enrolled" on public.moderation_decisions
  as restrictive for all to authenticated
  using ((select public.mfa_session_ok()))
  with check ((select public.mfa_session_ok()));

drop policy if exists "Require two-factor when enrolled" on public.moderation_appeals;
create policy "Require two-factor when enrolled" on public.moderation_appeals
  as restrictive for all to authenticated
  using ((select public.mfa_session_ok()))
  with check ((select public.mfa_session_ok()));

-- ---- 5. The guard, widened by two columns ------------------------------------
-- Same function, same test, two more names. A seller able to clear
-- moderation_fields would erase what they were told to fix; one able to point
-- moderation_decision_id elsewhere could swap the statement behind their
-- banner for a milder one.

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
    'moderated_at', 'moderated_by', 'moderation_review_requested_at',
    'moderation_fields', 'moderation_decision_id'
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
  'Refuses any change to moderation_* columns (including moderation_review_requested_at, moderation_fields and moderation_decision_id) unless the writer is service_role. Attached to products, storefronts and artifacts.';
