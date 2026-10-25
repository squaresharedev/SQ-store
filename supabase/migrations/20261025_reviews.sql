-- =============================================================================
-- Product reviews: written by buyers, imported from Shopify review apps, and
-- summarised per product for the product page.
-- =============================================================================
-- THREE TABLES, ONE DOMAIN. Nothing here reaches into another feature's
-- tables except by foreign key (products, orders, auth.users), so the review
-- system can be lifted out on its own later.
--
--   reviews                   One review of one product. Either NATIVE (a
--                             buyer reviewing their order, proven by the
--                             order's link credential) or IMPORTED (a row
--                             from a seller's Shopify review export).
--   review_imports            One import run: who, from which app, how many
--                             rows. Deleting a run deletes its reviews, so an
--                             import is undoable as a whole.
--   product_rating_summaries  The product page's numbers (count, average,
--                             5..1 breakdown), kept by triggers so no page
--                             load ever aggregates reviews.
--
-- WRITES are the server's alone (service role): the buyer route checks the
-- order credential and the import route checks the seller's role before
-- anything is written. Clients read their own store's rows through RLS and
-- write nothing. Buyers read through the server, which only ever selects
-- approved rows.
--
-- VERIFIED MEANS VERIFIED. is_verified_buyer is set by the server only for a
-- native review whose order is paid and not refunded, and the trigger on
-- orders below takes it away again if that order is refunded later. An
-- imported review is never marked verified: we cannot check another
-- platform's purchase records, and calling a review verified without having
-- checked is exactly what EU consumer law (Directive 2019/2161) forbids.
--
-- Apply via the Management API query endpoint or the SQL editor.
-- =============================================================================

-- ---- 1. review_imports -------------------------------------------------------

create table if not exists public.review_imports (
  id             uuid primary key default gen_random_uuid(),
  seller_id      uuid not null references auth.users (id) on delete cascade,
  -- The teammate who ran it. No foreign key: people leave teams, the record stays.
  created_by     uuid,
  -- MIRROR of REVIEW_IMPORT_SOURCES in src/lib/reviews/sources.ts.
  source         text not null,
  file_name      text,
  row_count      integer not null default 0,
  imported_count integer not null default 0,
  skipped_count  integer not null default 0,
  created_at     timestamptz not null default now(),

  constraint review_imports_source_check check (source in ('judgeme', 'loox', 'yotpo', 'shopify')),
  constraint review_imports_file_name_length check (file_name is null or char_length(file_name) <= 255),
  constraint review_imports_counts check (row_count >= 0 and imported_count >= 0 and skipped_count >= 0)
);

create index if not exists review_imports_seller_idx
  on public.review_imports (seller_id, created_at desc);

comment on table public.review_imports is
  'One review import run (lib/reviews/import.ts). Deleting a run deletes the reviews it brought in. Written by the service role only.';

-- ---- 2. reviews --------------------------------------------------------------

create table if not exists public.reviews (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references public.products (id) on delete cascade,
  -- The product's owner, always: set from the product by the trigger below,
  -- whatever the writer sent.
  seller_id         uuid not null references auth.users (id) on delete cascade,
  -- A native review's order. One review per order.
  order_id          uuid references public.orders (id) on delete set null,
  -- An imported review's run.
  import_id         uuid references public.review_imports (id) on delete cascade,
  -- MIRROR of REVIEW_SOURCES in src/lib/reviews/sources.ts.
  source            text not null default 'native',
  is_imported       boolean generated always as (source <> 'native') stored,
  -- An imported row's fingerprint (lib/reviews/import.ts), so importing the
  -- same file twice lands each review once.
  external_id       text,
  rating            smallint not null,
  title             text,
  body              text not null default '',
  author_name       text not null,
  is_verified_buyer boolean not null default false,
  is_approved       boolean not null default true,
  -- When the review was written: now for a native review, the original date
  -- for an imported one. The feed sorts on this.
  reviewed_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint reviews_source_check check (source in ('native', 'judgeme', 'loox', 'yotpo', 'shopify')),
  constraint reviews_rating_range check (rating between 1 and 5),
  -- MIRROR of the REVIEW_*_MAX limits in src/lib/reviews/limits.ts.
  constraint reviews_title_length check (title is null or char_length(title) between 1 and 120),
  constraint reviews_body_length check (char_length(body) <= 5000),
  constraint reviews_author_length check (char_length(author_name) between 1 and 60),
  constraint reviews_external_id_length check (external_id is null or char_length(external_id) <= 128),
  -- A native review comes from an order, an imported one from a run; never both.
  constraint reviews_origin check (
    (source = 'native' and import_id is null and external_id is null)
    or (source <> 'native' and order_id is null and import_id is not null and external_id is not null)
  ),
  constraint reviews_imported_not_verified check (source = 'native' or not is_verified_buyer)
);

-- Plain (not partial) unique indexes, so the importer's upsert can name them
-- as its conflict target; NULLs stay distinct, so rows without one never clash.
create unique index if not exists reviews_order_unique
  on public.reviews (order_id);
create unique index if not exists reviews_external_unique
  on public.reviews (product_id, external_id);
-- The feed, newest first, and the summary's recount.
create index if not exists reviews_product_feed_idx
  on public.reviews (product_id, reviewed_at desc, id desc) where is_approved;
-- The feed sorted by rating.
create index if not exists reviews_product_rating_idx
  on public.reviews (product_id, rating, reviewed_at desc) where is_approved;
create index if not exists reviews_seller_idx
  on public.reviews (seller_id, created_at desc);
create index if not exists reviews_import_idx
  on public.reviews (import_id) where import_id is not null;

comment on table public.reviews is
  'A product review: native (a buyer, proven by their order link) or imported (a Shopify review app export). Buyers see approved rows only. Written by the service role only.';
comment on column public.reviews.is_verified_buyer is
  'True only for a native review of a paid, unrefunded order. Cleared if the order is refunded. Never true for an imported review.';
comment on column public.reviews.is_approved is
  'Whether buyers see it. Only approved reviews count towards product_rating_summaries.';

-- The owner, from the product, and the edit time. Before the row's CHECKs,
-- so a writer cannot file a review under someone else's store.
create or replace function public.reviews_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.product_id is distinct from old.product_id then
    new.seller_id := (select p.owner_id from public.products p where p.id = new.product_id);
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end
$$;

revoke execute on function public.reviews_before_write() from public, anon, authenticated;

drop trigger if exists reviews_before_write on public.reviews;
create trigger reviews_before_write
  before insert or update on public.reviews
  for each row execute function public.reviews_before_write();

-- ---- 3. product_rating_summaries ----------------------------------------------

create table if not exists public.product_rating_summaries (
  product_id   uuid primary key references public.products (id) on delete cascade,
  seller_id    uuid not null references auth.users (id) on delete cascade,
  review_count integer not null default 0,
  rating_sum   integer not null default 0,
  rating_1     integer not null default 0,
  rating_2     integer not null default 0,
  rating_3     integer not null default 0,
  rating_4     integer not null default 0,
  rating_5     integer not null default 0,
  average      numeric(3, 2) generated always as (
                 case when review_count = 0 then null
                      else round(rating_sum::numeric / review_count, 2) end
               ) stored,
  updated_at   timestamptz not null default now(),

  constraint product_rating_summaries_counts check (
    review_count >= 0
    and review_count = rating_1 + rating_2 + rating_3 + rating_4 + rating_5
    and rating_sum = rating_1 + 2 * rating_2 + 3 * rating_3 + 4 * rating_4 + 5 * rating_5
  )
);

create index if not exists product_rating_summaries_seller_idx
  on public.product_rating_summaries (seller_id);

comment on table public.product_rating_summaries is
  'Per product: how many approved reviews, their average and the 1..5 breakdown. Kept by triggers on reviews (review_summaries_refresh); never written by the app.';

-- Recount the given products from their approved reviews. A RECOUNT rather
-- than +1/-1 deltas, so the numbers cannot drift whatever happened before;
-- one indexed scan per product, run once per statement (so an import of a
-- thousand rows recounts each product once, not a thousand times).
--
-- Serialised per product with an advisory lock, in id order so two writers
-- cannot deadlock: without it, two reviews landing at once could each recount
-- without seeing the other's row, and the later commit would write a count
-- one short.
create or replace function public.review_summaries_refresh(p_product_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('product_rating_summaries:' || id::text, 0))
     from (select distinct unnest(p_product_ids) as id order by 1) ids;

  insert into public.product_rating_summaries as s
         (product_id, seller_id, review_count, rating_sum,
          rating_1, rating_2, rating_3, rating_4, rating_5, updated_at)
  select p.id,
         p.owner_id,
         count(r.id)::integer,
         coalesce(sum(r.rating), 0)::integer,
         (count(*) filter (where r.rating = 1))::integer,
         (count(*) filter (where r.rating = 2))::integer,
         (count(*) filter (where r.rating = 3))::integer,
         (count(*) filter (where r.rating = 4))::integer,
         (count(*) filter (where r.rating = 5))::integer,
         now()
    from public.products p
    left join public.reviews r on r.product_id = p.id and r.is_approved
   where p.id = any (p_product_ids)
   group by p.id, p.owner_id
  on conflict (product_id) do update
     set seller_id    = excluded.seller_id,
         review_count = excluded.review_count,
         rating_sum   = excluded.rating_sum,
         rating_1     = excluded.rating_1,
         rating_2     = excluded.rating_2,
         rating_3     = excluded.rating_3,
         rating_4     = excluded.rating_4,
         rating_5     = excluded.rating_5,
         updated_at   = excluded.updated_at;
end
$$;

revoke execute on function public.review_summaries_refresh(uuid[]) from public, anon, authenticated;
grant execute on function public.review_summaries_refresh(uuid[]) to service_role;

-- Statement-level, over the rows the statement touched. A deleted product's
-- reviews arrive here too (by cascade); the recount's join on products skips
-- it, and its summary row goes with it by its own cascade.
create or replace function public.reviews_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.review_summaries_refresh(array(select distinct product_id from new_rows));
  elsif tg_op = 'DELETE' then
    perform public.review_summaries_refresh(array(select distinct product_id from old_rows));
  else
    perform public.review_summaries_refresh(array(
      select product_id from new_rows union select product_id from old_rows
    ));
  end if;
  return null;
end
$$;

revoke execute on function public.reviews_after_write() from public, anon, authenticated;

-- One trigger per event: a trigger with transition tables takes one event.
drop trigger if exists reviews_after_insert on public.reviews;
create trigger reviews_after_insert
  after insert on public.reviews
  referencing new table as new_rows
  for each statement execute function public.reviews_after_write();

drop trigger if exists reviews_after_update on public.reviews;
create trigger reviews_after_update
  after update on public.reviews
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.reviews_after_write();

drop trigger if exists reviews_after_delete on public.reviews;
create trigger reviews_after_delete
  after delete on public.reviews
  referencing old table as old_rows
  for each statement execute function public.reviews_after_write();

-- ---- 4. A refund takes the verified badge away ---------------------------------

create or replace function public.reviews_unverify_refunded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.reviews
     set is_verified_buyer = false
   where order_id = new.id
     and is_verified_buyer;
  return null;
end
$$;

revoke execute on function public.reviews_unverify_refunded() from public, anon, authenticated;

drop trigger if exists reviews_unverify_refunded on public.orders;
create trigger reviews_unverify_refunded
  after update of status on public.orders
  for each row
  when (new.status = 'refunded' and old.status is distinct from 'refunded')
  execute function public.reviews_unverify_refunded();

-- ---- 5. Access ------------------------------------------------------------------
-- Members of a store read its rows (the dashboard); nobody writes but the
-- service role.

alter table public.review_imports enable row level security;
alter table public.reviews enable row level security;
alter table public.product_rating_summaries enable row level security;

revoke all on table public.review_imports, public.reviews, public.product_rating_summaries
  from public, anon, authenticated;
grant select on table public.review_imports, public.reviews, public.product_rating_summaries
  to authenticated;
grant all on table public.review_imports, public.reviews, public.product_rating_summaries
  to service_role;

drop policy if exists review_imports_select_member on public.review_imports;
create policy review_imports_select_member on public.review_imports
  for select to authenticated
  using (
    seller_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(seller_id), 'store.read')
  );

drop policy if exists reviews_select_member on public.reviews;
create policy reviews_select_member on public.reviews
  for select to authenticated
  using (
    seller_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(seller_id), 'store.read')
  );

drop policy if exists product_rating_summaries_select_member on public.product_rating_summaries;
create policy product_rating_summaries_select_member on public.product_rating_summaries
  for select to authenticated
  using (
    seller_id = (select auth.uid())
    or public.team_role_can(public.team_actor_role(seller_id), 'store.read')
  );

notify pgrst, 'reload schema';
