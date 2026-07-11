-- =============================================================================
-- CURATION FOUNDATION (SQ-app): the content-curation SPA shares this project's
-- database and auth. Adds two profile fields (username, is_public) and two
-- net-new user-owned content tables (collections, artifacts). Additive only:
-- no existing table, policy, trigger, or function is modified.
--
-- Deliberately NOT wired into team_role_can()/team_actor_role(): the curation
-- app has no team semantics. Owner-only CRUD plus public read, nothing else.
-- =============================================================================

-- ---- profiles: login handle + public-grid visibility ------------------------
alter table public.profiles
  add column username text
    check (username is null or lower(username) ~ '^[a-z0-9_]{3,30}$'),
  add column is_public boolean not null default true;

comment on column public.profiles.username is
  'Curation-app login handle, distinct from display_name. Nullable: existing store users have none until they claim one. Case-insensitively unique.';
comment on column public.profiles.is_public is
  'Curation app: whether this profile (and its loose artifacts) shows on the public grid. Default on.';

-- Case-insensitive uniqueness, same pattern as profiles_display_name_lower_idx.
-- Partial (WHERE username IS NOT NULL) so the many store accounts without a
-- username never collide with each other.
create unique index profiles_username_lower_idx
  on public.profiles (lower(username))
  where username is not null;

-- ---- collections -------------------------------------------------------------
-- A named group of artifacts. Private by default; flipping is_public exposes
-- the collection AND its artifacts to the public read policies below.
create table public.collections (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  is_public  boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.collections is
  'Curation app: a user''s named group of artifacts. Private by default; is_public exposes it (and its artifacts) to anonymous readers.';

-- The curation app lists "my collections"; index the owner scan (also covers
-- the otherwise-unindexed FK, per the cost-audit convention).
create index collections_owner_id_idx on public.collections (owner_id);

alter table public.collections enable row level security;

-- Owner-scoped CRUD. (select auth.uid()) is cached per-statement.
create policy collections_select_own on public.collections
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy collections_insert_own on public.collections
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy collections_update_own on public.collections
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy collections_delete_own on public.collections
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Public grid: anyone (signed in or not) can read a collection its owner
-- marked public. Read-only — there are intentionally no anon write policies.
create policy collections_select_public on public.collections
  for select to anon, authenticated
  using (is_public);

-- Reuse the shared updated_at trigger function from the products migration.
create trigger collections_set_updated_at
  before update on public.collections
  for each row execute function public.set_updated_at();

-- ---- profile_is_public helper ------------------------------------------------
-- "Is this profile on the public grid?" — used by the artifacts public-read
-- policy for loose artifacts (no collection). Must be SECURITY DEFINER: profiles
-- has no anon/public select policy, so a direct subquery inside the policy
-- would evaluate against an empty set for anonymous readers. Boolean-only,
-- never row data (same shape as is_squareshare_staff / is_display_name_available).
create or replace function public.profile_is_public(p_profile_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and p.is_public
  );
$$;

-- Unlike this project's other helpers, anon KEEPS execute: the function is
-- evaluated inside an RLS policy on behalf of anonymous readers, and it only
-- reveals what the public grid reveals anyway (whether a profile is public).
revoke all on function public.profile_is_public(uuid) from public;
grant execute on function public.profile_is_public(uuid) to anon, authenticated;

-- ---- artifacts ----------------------------------------------------------------
-- A curated item on the owner's grid. Image bytes live in R2; rows store keys
-- minted by buildObjectKey (src/lib/r2.ts) — never URLs.
create table public.artifacts (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  -- Loose artifacts (null) hang directly off the profile grid.
  collection_id uuid references public.collections(id) on delete set null,
  -- Forward-compatible commerce bridge: an artifact may later point at a store
  -- product. Unused by the curation rebuild's v1; deleting a product detaches.
  product_id    uuid references public.products(id) on delete set null,
  title         text check (title is null or char_length(title) <= 200),
  description   text check (description is null or char_length(description) <= 2000),
  image_key     text not null,
  -- Bento-grid placement: cell position, span, and image focal point (%).
  grid_x        integer not null default 0 check (grid_x >= 0),
  grid_y        integer not null default 0 check (grid_y >= 0),
  span_w        integer not null default 1 check (span_w >= 1),
  span_h        integer not null default 1 check (span_h >= 1),
  img_offset_x  numeric not null default 50,
  img_offset_y  numeric not null default 50,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.artifacts is
  'Curation app: one curated grid item. image_key is an R2 object key (buildObjectKey shape), never a URL. product_id is a dormant commerce bridge.';

-- Owner grid reads + collection detail reads; product_id covered too so a
-- product delete's ON DELETE SET NULL never scans artifacts (cost-audit rule).
create index artifacts_owner_id_idx on public.artifacts (owner_id);
create index artifacts_collection_id_idx on public.artifacts (collection_id);
create index artifacts_product_id_idx on public.artifacts (product_id);

alter table public.artifacts enable row level security;

create policy artifacts_select_own on public.artifacts
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy artifacts_insert_own on public.artifacts
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy artifacts_update_own on public.artifacts
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy artifacts_delete_own on public.artifacts
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Public read: an artifact is visible when its collection is public, or — for
-- loose artifacts — when its owner's profile is public. The collections
-- subquery runs under the CALLER's RLS, where collections_select_public grants
-- exactly the public rows, so no definer helper is needed on that branch.
create policy artifacts_select_public on public.artifacts
  for select to anon, authenticated
  using (
    case
      when collection_id is null then public.profile_is_public(owner_id)
      else exists (
        select 1
        from public.collections c
        where c.id = artifacts.collection_id
          and c.is_public
      )
    end
  );

create trigger artifacts_set_updated_at
  before update on public.artifacts
  for each row execute function public.set_updated_at();
