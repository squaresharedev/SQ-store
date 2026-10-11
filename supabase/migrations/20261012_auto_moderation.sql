-- ====================================================================
-- AUTOMATIC MODERATION: THE WALL.
--
-- Until now content was public the moment it was saved and came down only if
-- somebody reported it. This migration turns that around: a row is public only
-- while EVERY part of its current content (its text, each image, each PDF) is
-- on the approved list, and the database is what enforces it.
--
-- WHY THE DATABASE AND NOT THE APPS. A seller holds a publishable key and an
-- RLS-permitted INSERT/UPDATE on their own rows, so every check an app runs in
-- a server action can be skipped with one REST call. A trigger cannot. It also
-- means an app that has never heard of moderation is still safe: content
-- nobody approved is simply not 'ok', and isContentVisible() admits 'ok' and
-- nothing else.
--
-- THE MOVING PARTS, all in this file:
--
--   moderation_checks   The approved list (and the refused one). One row per
--                       part: 'image:<key>', 'pdf:<key>', 'text:<fingerprint>'.
--                       Content-addressed, so the same photo or the same words
--                       are judged once, by the classifier or by a person.
--   moderation_gate()   BEFORE INSERT OR UPDATE on products, storefronts and
--                       artifacts. Replaces guard_moderation_columns there.
--                       When moderated content changes it asks one question,
--                       "is every part of this already approved?", and the row
--                       is 'ok' or 'pending' accordingly.
--   moderation_settle() What the checker calls once it has judged the missing
--                       parts: 'ok', an automated pause, or 'review' (a person
--                       decides). Refuses to act on a revision that has since
--                       changed, and never sets 'ok' on anyone's word but the
--                       approved list's.
--
-- TWO NEW STATES, both hidden by the existing gate with no code change:
--
--   pending  Waiting for the automatic check. Seconds, normally.
--   review   The check could not say it was fine. A person decides.
--
-- WHO IS TRUSTED. service_role, exactly as before: the admin panel's decisions
-- and the checker both write with it. A staff member putting something back
-- ('review', 'paused' or 'removed' -> 'ok') is recorded against the exact
-- parts they approved, so the same photo is never held twice.
--
-- EXISTING ROWS stay 'ok'. They have never been checked, which is what a null
-- moderation_checked_at says, and the sweep audits them while they stay live.
--
-- DEPLOY ORDER. The app that calls these functions must be live BEFORE this
-- is applied: from the moment the gate exists, a save by an app with no
-- checker stays 'pending' until something settles it.
--
-- Apply via Supabase MCP (apply_migration) or the SQL editor, after
-- 20260926_moderation_decisions_and_appeals.
-- ====================================================================

-- ---- 1. The states ----------------------------------------------------------

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
      'alter table public.%I add constraint %I check (moderation_status in (''ok'', ''pending'', ''review'', ''paused'', ''removed''))',
      target, target || '_moderation_status_check'
    );
  end loop;
end
$$;

-- Artifacts still cannot be paused (the marketplace has no fix-and-ask-again
-- surface), so an automated refusal there is a removal.
alter table public.artifacts drop constraint if exists artifacts_moderation_status_check;
alter table public.artifacts
  add constraint artifacts_moderation_status_check
  check (moderation_status in ('ok', 'pending', 'review', 'removed'));

comment on column public.products.moderation_status is
  'Moderation state, never the seller''s to write (moderation_gate). ''ok'' (public), ''pending'' (awaiting the automatic check), ''review'' (held for a person), ''paused'' (hidden until fixed) or ''removed'' (hidden, final). Separate from status, the seller''s own draft/active field. Mirror of MODERATION_STATUSES in @squaresharedev/moderation.';

-- ---- 2. Revision and audit marker ---------------------------------------------
-- moderation_rev counts changes to the moderated content. The checker reads
-- it with the content and hands it back when it settles, so an outcome worked
-- out for words the seller has since replaced is refused rather than applied.
--
-- moderation_checked_at is when the CURRENT content last passed. Null on a row
-- that is 'ok' means "live, but from before the wall": the sweep's audit list.

alter table public.products
  add column if not exists moderation_rev integer not null default 0,
  add column if not exists moderation_checked_at timestamptz;
alter table public.storefronts
  add column if not exists moderation_rev integer not null default 0,
  add column if not exists moderation_checked_at timestamptz;
alter table public.artifacts
  add column if not exists moderation_rev integer not null default 0,
  add column if not exists moderation_checked_at timestamptz;

-- The sweep asks one question of each table, and almost every row answers no.
create index if not exists products_moderation_due_idx
  on public.products (updated_at)
  where moderation_status = 'pending' or moderation_checked_at is null;
create index if not exists storefronts_moderation_due_idx
  on public.storefronts (updated_at)
  where moderation_status = 'pending' or moderation_checked_at is null;
create index if not exists artifacts_moderation_due_idx
  on public.artifacts (updated_at)
  where moderation_status = 'pending' or moderation_checked_at is null;

-- A decision made by the automatic check rather than a person. The statement
-- of reasons has to say which (DSA Art. 17(3)(c)), and the gate reads it to
-- know that an edit should be re-checked instead of waiting on staff.
alter table public.moderation_decisions
  add column if not exists automated boolean not null default false;

comment on column public.moderation_decisions.automated is
  'True when the automatic check made this decision and no person did. Printed on the statement of reasons; an automated pause is re-checked when the seller edits.';

-- ---- 3. The approved list ---------------------------------------------------------

create table if not exists public.moderation_checks (
  -- 'image:<object key>', 'pdf:<object key>' or 'text:<md5 of the text lines>'.
  subject    text primary key,
  verdict    text not null check (verdict in ('clean', 'unsure', 'violation')),
  -- Mirror of REMOVAL_GROUNDS. Set with a violation, sometimes with unsure.
  ground     text check (ground is null or ground in (
               'illegal', 'sexual', 'violence', 'hate',
               'counterfeit', 'scam', 'spam', 'other')),
  -- Text only: the field paths the classifier pointed at.
  paths      text[] not null default '{}',
  -- model:  the classifier.
  -- staff:  a person approved it; never overwritten by the classifier.
  -- upload: the upload route, for a file the classifier cannot fully see
  --         (SVG, AVIF, animation), which therefore goes to a person.
  source     text not null check (source in ('model', 'staff', 'upload')),
  model      text,
  checked_at timestamptz not null default now()
);

comment on table public.moderation_checks is
  'The automatic check''s memory: one verdict per part of content (an image, a PDF, or the text of one row), content-addressed so nothing is judged or paid for twice. A row is public only while every part of it is ''clean'' here. Service role only.';

alter table public.moderation_checks enable row level security;
revoke all on public.moderation_checks from anon, authenticated;
grant all on public.moderation_checks to service_role;

-- ---- 4. What counts as content ---------------------------------------------------------
-- ONE list of moderated columns per target, read by the gate and by the
-- checker alike. A column that carries anything a seller typed or uploaded and
-- a buyer can see belongs here; a column missing from this list is a column
-- nobody checks.

create or replace function public.moderation_columns(p_type text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'product' then array[
      'title', 'description', 'image_key', 'gallery', 'variants', 'details',
      'documents', 'option_groups', 'purchase_url']
    when 'storefront' then array['name', 'config']
    when 'artifact' then array['title', 'description', 'image_key']
  end
$$;

create or replace function public.moderation_table(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'product' then 'products'
    when 'storefront' then 'storefronts'
    when 'artifact' then 'artifacts'
  end
$$;

-- A row reduced to its moderated columns.
create or replace function public.moderation_doc(p_row jsonb, p_cols text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(col, p_row -> col), '{}'::jsonb)
  from unnest(p_cols) as col
$$;

-- Every string anywhere inside a document, with the path that leads to it.
-- Array positions are dropped ("gallery[].alt"), so reordering is not a change.
create or replace function public.moderation_leaves(p_doc jsonb)
returns table (path text, value text)
language sql
immutable
set search_path = ''
as $$
  with recursive walk (path, node) as (
    select ''::text, p_doc
    union all
    select
      case
        when child.key is null then walk.path || '[]'
        when walk.path = '' then child.key
        else walk.path || '.' || child.key
      end,
      child.value
    from walk
    cross join lateral (
      select e.key, e.value
        from jsonb_each(
          case when jsonb_typeof(walk.node) = 'object' then walk.node else '{}'::jsonb end
        ) as e
      union all
      select null::text, a.value
        from jsonb_array_elements(
          case when jsonb_typeof(walk.node) = 'array' then walk.node else '[]'::jsonb end
        ) as a
    ) as child
  )
  select walk.path, walk.node #>> '{}'
  from walk
  where jsonb_typeof(walk.node) = 'string'
    and btrim(walk.node #>> '{}') <> ''
$$;

-- A document split into the parts that get a verdict each.
--
--   media         Every stored-object key (the shape buildObjectKey mints):
--                 a PDF under documents/, an image otherwise. Font files are
--                 skipped: no classifier can read one.
--   lines         Everything else a person could have typed, as "path=value".
--                 Values that cannot carry words whatever field they sit in
--                 (a uuid, a hex colour) are left out, so recolouring a
--                 storefront is not new text.
--   text_subject  The fingerprint of those lines. Paths are part of it, so a
--                 change to a user-authored JSON key is a change too.
create or replace function public.moderation_parts(p_doc jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with classed as (
    select
      l.path,
      l.value,
      case
        when l.value ~ '^fonts/[0-9a-f-]{36}/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$' then 'skip'
        when l.value ~ '^documents/[0-9a-f-]{36}/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$' then 'pdf'
        when l.value ~ '^[a-z]{1,20}/[0-9a-f-]{36}/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$' then 'image'
        when l.value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 'skip'
        when l.value ~ '^#[0-9a-fA-F]{3,8}$' then 'skip'
        else 'text'
      end as kind
    from public.moderation_leaves(p_doc) as l
  ),
  text_lines as (
    select distinct c.path || '=' || c.value as line
    from classed c
    where c.kind = 'text'
  ),
  media as (
    select distinct on (c.value) c.kind, c.value, c.path
    from classed c
    where c.kind in ('image', 'pdf')
    order by c.value, c.path
  )
  select jsonb_build_object(
    'lines',
      coalesce((select jsonb_agg(t.line order by t.line) from text_lines t), '[]'::jsonb),
    'text_subject',
      (select 'text:' || md5(string_agg(t.line, E'\n' order by t.line)) from text_lines t),
    'media',
      coalesce(
        (select jsonb_agg(
                  jsonb_build_object(
                    'kind', m.kind,
                    'key', m.value,
                    'subject', m.kind || ':' || m.value,
                    'path', m.path)
                  order by m.value)
           from media m),
        '[]'::jsonb)
  )
$$;

-- The subjects of a parts object, one per row.
create or replace function public.moderation_subjects(p_parts jsonb)
returns setof text
language sql
immutable
set search_path = ''
as $$
  select p_parts ->> 'text_subject'
  where p_parts ->> 'text_subject' is not null
  union all
  select m ->> 'subject'
  from jsonb_array_elements(coalesce(p_parts -> 'media', '[]'::jsonb)) as m
$$;

-- THE question the gate asks: is every part of this content already approved?
-- A document with no parts at all has nothing in it to object to.
create or replace function public.moderation_all_clear(p_doc jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1
    from public.moderation_subjects(public.moderation_parts(p_doc)) as s (subject)
    left join public.moderation_checks c on c.subject = s.subject
    where c.verdict is distinct from 'clean'
  )
$$;

-- ---- 5. The gate ---------------------------------------------------------------------
-- One function for all three tables; the trigger argument names the target.
--
-- SECURITY DEFINER, unlike guard_moderation_columns before it, because it has
-- to read the approved list on behalf of a seller who may not. So it cannot
-- ask `current_user` who is writing (as a definer it would always see its
-- owner). It asks the `role` setting instead: PostgREST's SET ROLE puts
-- 'authenticated' or 'service_role' there, a direct connection leaves 'none',
-- and nothing in a request body can change it.

create or replace function public.moderation_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type     text := tg_argv[0];
  v_cols     text[] := public.moderation_columns(v_type);
  v_trusted  boolean := coalesce(nullif(current_setting('role', true), ''), 'none')
                          in ('none', 'service_role', 'postgres', 'supabase_admin');
  v_new      jsonb := to_jsonb(new);
  v_old      jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_new_doc  jsonb := public.moderation_doc(v_new, v_cols);
  v_changed  boolean;
  v_status   text;
  v_staff_pause boolean;
  v_guarded  text;
  v_next     text;
begin
  v_changed := tg_op = 'INSERT'
    or v_new_doc is distinct from public.moderation_doc(v_old, v_cols);

  -- 1. A seller never writes moderation state. On INSERT there is no old row
  --    to compare with, so whatever they sent is discarded instead.
  if not v_trusted then
    if tg_op = 'UPDATE' then
      foreach v_guarded in array array[
        'moderation_status', 'moderation_ground', 'moderation_note',
        'moderated_at', 'moderated_by', 'moderation_review_requested_at',
        'moderation_fields', 'moderation_decision_id',
        'moderation_rev', 'moderation_checked_at'
      ] loop
        if (v_old -> v_guarded) is distinct from (v_new -> v_guarded) then
          raise exception
            'Moderation state is set by SquareShare staff and cannot be changed here (column %).', v_guarded
            using errcode = '42501';
        end if;
      end loop;
    else
      new := jsonb_populate_record(new, jsonb_build_object(
        'moderation_status', 'pending',
        'moderation_ground', null, 'moderation_note', null,
        'moderated_at', null, 'moderated_by', null,
        'moderation_review_requested_at', null,
        'moderation_fields', null, 'moderation_decision_id', null,
        'moderation_rev', 0, 'moderation_checked_at', null));
    end if;
  end if;

  if not v_changed then
    return new;
  end if;

  new.moderation_rev := coalesce((v_old ->> 'moderation_rev')::integer, 0) + 1;

  -- 2. A trusted writer (the admin panel, the checker, a fixture) states the
  --    outcome itself. What the gate adds is memory: a person putting content
  --    back has approved exactly these parts.
  if v_trusted then
    return new;
  end if;

  -- 3. A seller changed the content. A removal is final, and a pause a person
  --    imposed waits for that person; everything else is decided here, by the
  --    approved list.
  v_status := new.moderation_status;
  if v_status = 'removed' then
    return new;
  end if;
  if v_status = 'paused' then
    select not d.automated into v_staff_pause
      from public.moderation_decisions d
     where d.id = (v_new ->> 'moderation_decision_id')::uuid;
    -- No decision row (a pause older than the decisions table) reads as a
    -- person's, the stricter of the two.
    if coalesce(v_staff_pause, true) then
      return new;
    end if;
  end if;

  v_next := case when public.moderation_all_clear(v_new_doc) then 'ok' else 'pending' end;
  new := jsonb_populate_record(new, jsonb_build_object(
    'moderation_status', v_next,
    'moderation_ground', null, 'moderation_note', null,
    'moderated_at', null, 'moderated_by', null,
    'moderation_review_requested_at', null,
    'moderation_fields', null, 'moderation_decision_id', null,
    'moderation_checked_at', case when v_next = 'ok' then now() else null end));
  return new;
end;
$$;

comment on function public.moderation_gate() is
  'The moderation wall. Refuses any seller write to moderation_* columns, and when moderated content changes sets the row ''ok'' only if every part of it is already approved in moderation_checks, ''pending'' otherwise. Attached to products, storefronts and artifacts.';

-- A person's approval, remembered against the parts they approved. AFTER the
-- write, so it records what was actually stored.
create or replace function public.moderation_remember_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trusted boolean := coalesce(nullif(current_setting('role', true), ''), 'none')
                         in ('none', 'service_role', 'postgres', 'supabase_admin');
begin
  if v_trusted
     and old.moderation_status in ('review', 'paused', 'removed')
     and new.moderation_status = 'ok' then
    insert into public.moderation_checks (subject, verdict, source)
    select s.subject, 'clean', 'staff'
      from public.moderation_subjects(
             public.moderation_parts(
               public.moderation_doc(to_jsonb(new), public.moderation_columns(tg_argv[0])))
           ) as s (subject)
    on conflict (subject) do update
      set verdict = 'clean', ground = null, paths = '{}', source = 'staff',
          model = null, checked_at = now();
  end if;
  return null;
end;
$$;

comment on function public.moderation_remember_approval() is
  'When a trusted writer puts held or taken-down content back to ''ok'', records every part of it as approved by a person, so the automatic check never holds the same photo or words again.';

do $$
declare
  target record;
begin
  for target in
    select * from (values
      ('products', 'product'), ('storefronts', 'storefront'), ('artifacts', 'artifact')
    ) as t (tbl, kind)
  loop
    execute format('drop trigger if exists %I on public.%I', target.tbl || '_guard_moderation', target.tbl);
    execute format('drop trigger if exists %I on public.%I', target.tbl || '_moderation_gate', target.tbl);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.moderation_gate(%L)',
      target.tbl || '_moderation_gate', target.tbl, target.kind);
    execute format('drop trigger if exists %I on public.%I', target.tbl || '_moderation_approval', target.tbl);
    execute format(
      'create trigger %I after update of moderation_status on public.%I for each row execute function public.moderation_remember_approval(%L)',
      target.tbl || '_moderation_approval', target.tbl, target.kind);
  end loop;
end
$$;

-- Superseded on these three tables by moderation_gate, and attached nowhere
-- else.
drop function if exists public.guard_moderation_columns();

-- ---- 6. What the checker calls ------------------------------------------------------------

-- The parts of content that is about to be written: the stored row (none for
-- an insert) with the caller's changes laid over it. Lets a server action have
-- the new words and photos judged BEFORE the write, so a clean edit to a live
-- listing passes the gate inline and is never hidden at all.
create or replace function public.moderation_preview(p_type text, p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_table text := public.moderation_table(p_type);
  v_row   jsonb := '{}'::jsonb;
begin
  if v_table is null then
    raise exception 'Unknown moderation target %', p_type using errcode = '22023';
  end if;
  if p_id is not null then
    execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_table)
      into v_row using p_id;
  end if;
  return public.moderation_parts(
    public.moderation_doc(
      coalesce(v_row, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb),
      public.moderation_columns(p_type)));
end;
$$;

-- One stored row as the checker needs it: its parts, and the revision they
-- were read at.
create or replace function public.moderation_claim(p_type text, p_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_table text := public.moderation_table(p_type);
  v_row   jsonb;
begin
  if v_table is null then
    raise exception 'Unknown moderation target %', p_type using errcode = '22023';
  end if;
  execute format('select to_jsonb(t) from public.%I t where t.id = $1', v_table)
    into v_row using p_id;
  if v_row is null then
    return null;
  end if;
  return public.moderation_parts(
           public.moderation_doc(v_row, public.moderation_columns(p_type)))
    || jsonb_build_object(
         'rev', (v_row ->> 'moderation_rev')::integer,
         'status', v_row ->> 'moderation_status',
         'checked', (v_row ->> 'moderation_checked_at') is not null,
         'owner_id', v_row ->> 'owner_id',
         'title', coalesce(v_row ->> 'title', v_row ->> 'name', ''));
end;
$$;

-- Apply the outcome for one row, from the approved list and nothing else.
--
--   every part clean        -> 'ok'
--   any part a violation    -> an automated pause with a decision row
--                              (products, storefronts) or a removal (artifacts)
--   anything else           -> 'review'
--
-- p_ground and p_fields describe a violation in the seller's terms; they are
-- the caller's to supply because the fix-field vocabulary lives in the app.
-- They cannot make anything public: only the approved list can.
create or replace function public.moderation_settle(
  p_type   text,
  p_id     uuid,
  p_rev    integer,
  p_ground text default null,
  p_fields text[] default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_table      text := public.moderation_table(p_type);
  v_row        jsonb;
  v_status     text;
  v_parts      jsonb;
  v_missing    integer;
  v_violations integer;
  v_ground     text;
  v_fields     text[];
  v_decision   uuid;
begin
  if v_table is null then
    raise exception 'Unknown moderation target %', p_type using errcode = '22023';
  end if;

  execute format('select to_jsonb(t) from public.%I t where t.id = $1 for update', v_table)
    into v_row using p_id;
  if v_row is null then
    return jsonb_build_object('outcome', 'gone');
  end if;
  if (v_row ->> 'moderation_rev')::integer is distinct from p_rev then
    return jsonb_build_object('outcome', 'stale');
  end if;

  -- Only content that is waiting: 'pending', or live but never checked.
  v_status := v_row ->> 'moderation_status';
  if not (v_status = 'pending'
          or (v_status = 'ok' and (v_row ->> 'moderation_checked_at') is null)) then
    return jsonb_build_object('outcome', 'settled', 'status', v_status);
  end if;

  v_parts := public.moderation_parts(
    public.moderation_doc(v_row, public.moderation_columns(p_type)));

  select
    count(*) filter (where c.subject is null),
    count(*) filter (where c.verdict = 'violation')
    into v_missing, v_violations
  from public.moderation_subjects(v_parts) as s (subject)
  left join public.moderation_checks c on c.subject = s.subject;

  -- A part nobody has judged yet: not an outcome, the checker is not done.
  if v_missing > 0 then
    return jsonb_build_object('outcome', 'unchecked');
  end if;

  if public.moderation_all_clear(public.moderation_doc(v_row, public.moderation_columns(p_type))) then
    execute format(
      'update public.%I set moderation_status = ''ok'', moderation_checked_at = now() where id = $1',
      v_table) using p_id;
    return jsonb_build_object('outcome', 'ok');
  end if;

  if v_violations = 0 then
    execute format(
      'update public.%I set moderation_status = ''review'', moderated_at = now(), moderation_checked_at = now() where id = $1',
      v_table) using p_id;
    return jsonb_build_object(
      'outcome', 'review',
      'owner_id', v_row ->> 'owner_id',
      'title', coalesce(v_row ->> 'title', v_row ->> 'name', ''));
  end if;

  -- The caller's ground if it is one, else the most urgent the classifier gave.
  select coalesce(
    (select g from unnest(array[p_ground]) as g
      where g in ('illegal', 'sexual', 'violence', 'hate', 'counterfeit', 'scam', 'spam', 'other')),
    (select c.ground
       from public.moderation_subjects(v_parts) as s (subject)
       join public.moderation_checks c on c.subject = s.subject
      where c.verdict = 'violation' and c.ground is not null
      order by array_position(
        array['illegal', 'sexual', 'violence', 'hate', 'counterfeit', 'scam', 'spam', 'other'],
        c.ground)
      limit 1),
    'other')
    into v_ground;

  if p_type = 'artifact' then
    execute format(
      'update public.%I set moderation_status = ''removed'', moderation_ground = $2, moderation_note = null, moderated_at = now(), moderated_by = null, moderation_checked_at = now() where id = $1',
      v_table) using p_id, v_ground;
    return jsonb_build_object(
      'outcome', 'removed', 'ground', v_ground,
      'owner_id', v_row ->> 'owner_id',
      'title', coalesce(v_row ->> 'title', ''));
  end if;

  v_fields := case
    when p_fields is null or cardinality(p_fields) = 0 then array['other']
    else p_fields
  end;

  insert into public.moderation_decisions (
    target_type, target_id, owner_id, target_title, action, ground, fields, automated
  ) values (
    p_type, p_id, (v_row ->> 'owner_id')::uuid,
    left(coalesce(nullif(v_row ->> 'title', ''), nullif(v_row ->> 'name', ''), '(untitled)'), 300),
    'paused', v_ground, v_fields, true
  )
  returning id into v_decision;

  execute format(
    'update public.%I set moderation_status = ''paused'', moderation_ground = $2, moderation_note = null, moderated_at = now(), moderated_by = null, moderation_review_requested_at = null, moderation_fields = $3, moderation_decision_id = $4, moderation_checked_at = now() where id = $1',
    v_table) using p_id, v_ground, v_fields, v_decision;

  return jsonb_build_object(
    'outcome', 'paused', 'ground', v_ground, 'fields', to_jsonb(v_fields),
    'decision_id', v_decision,
    'owner_id', v_row ->> 'owner_id',
    'title', coalesce(v_row ->> 'title', v_row ->> 'name', ''));
end;
$$;

-- The sweep's worklist: what is waiting on the check, oldest first. Covers
-- every row an app wrote without calling the checker, every row whose check
-- failed or timed out, and the audit of content from before the wall.
create or replace function public.moderation_due(p_limit integer default 20)
returns table (target_type text, target_id uuid)
language sql
stable
set search_path = ''
as $$
  select due.target_type, due.target_id
  from (
    select 'product'::text as target_type, p.id as target_id, p.updated_at
      from public.products p
     where p.moderation_status = 'pending'
        or (p.moderation_status = 'ok' and p.moderation_checked_at is null)
    union all
    select 'storefront', s.id, s.updated_at
      from public.storefronts s
     where s.moderation_status = 'pending'
        or (s.moderation_status = 'ok' and s.moderation_checked_at is null)
    union all
    select 'artifact', a.id, a.updated_at
      from public.artifacts a
     where a.moderation_status = 'pending'
        or (a.moderation_status = 'ok' and a.moderation_checked_at is null)
  ) as due
  order by due.updated_at
  limit greatest(1, least(coalesce(p_limit, 20), 200))
$$;

-- When the policy changes: forget what the classifier said (a person's
-- approvals stand) and put every live row back on the audit list. Nothing is
-- hidden by this; rows stay live while they are looked at again.
create or replace function public.moderation_recheck_all()
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.moderation_checks where source = 'model';
  update public.products set moderation_checked_at = null where moderation_status = 'ok';
  update public.storefronts set moderation_checked_at = null where moderation_status = 'ok';
  update public.artifacts set moderation_checked_at = null where moderation_status = 'ok';
end;
$$;

-- ---- 7. Seller text on the profile ---------------------------------------------------------------
-- The trader name, the bio and the shipping terms print on every product page
-- a seller has, so they are checked too. They are short, text only and rarely
-- edited, so they take the simpler rule: the server checks the words first and
-- then writes them, and nobody else may. No state, and a settings edit can
-- never blink a whole store out.

create or replace function public.guard_seller_text()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  trusted boolean := current_user in ('service_role', 'postgres', 'supabase_admin');
begin
  if trusted then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.tax_business_name is not null
       or new.seller_bio is not null
       or new.shipping_policy is not null then
      raise exception 'Seller text is checked before it is saved, not set directly.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.tax_business_name is distinct from old.tax_business_name then
    raise exception 'Seller text is checked before it is saved, not set directly (column tax_business_name).'
      using errcode = '42501';
  end if;
  if new.seller_bio is distinct from old.seller_bio then
    raise exception 'Seller text is checked before it is saved, not set directly (column seller_bio).'
      using errcode = '42501';
  end if;
  if new.shipping_policy is distinct from old.shipping_policy then
    raise exception 'Seller text is checked before it is saved, not set directly (column shipping_policy).'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_seller_text() is
  'Only the service role may write the buyer-facing seller text on profiles (trader name, bio, shipping terms): the server has the words checked first. Attached to profiles.';

drop trigger if exists profiles_guard_seller_text on public.profiles;
create trigger profiles_guard_seller_text
  before insert or update on public.profiles
  for each row execute function public.guard_seller_text();

-- ---- 8. Access --------------------------------------------------------------------------------
-- Creating a function in this project grants EXECUTE to anon and authenticated
-- as a side effect (the PostgREST auto-grant trap), so every one is revoked by
-- name. None of them is for a browser.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.moderation_columns(text)',
    'public.moderation_table(text)',
    'public.moderation_doc(jsonb, text[])',
    'public.moderation_leaves(jsonb)',
    'public.moderation_parts(jsonb)',
    'public.moderation_subjects(jsonb)',
    'public.moderation_all_clear(jsonb)',
    'public.moderation_gate()',
    'public.moderation_remember_approval()',
    'public.moderation_preview(text, uuid, jsonb)',
    'public.moderation_claim(text, uuid)',
    'public.moderation_settle(text, uuid, integer, text, text[])',
    'public.moderation_due(integer)',
    'public.moderation_recheck_all()',
    'public.guard_seller_text()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;

notify pgrst, 'reload schema';
