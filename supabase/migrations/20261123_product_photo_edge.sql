-- =============================================================================
-- A PRODUCT PHOTO'S EDGE (storefront editor upgrade, round two)
--
-- What is at the edges of a product's main photo: near-white all round (a
-- studio shot) or anything else. Two storefront card looks read it: a white
-- blend set to "auto" blends only a white-edged photo, and the "shadow" name
-- style fades pale over one (src/lib/storefront/photo-edge.ts).
--
-- WHO MEASURES IT. The seller's browser, never the server (decoding a photo
-- costs more CPU than a Worker request has): where the browser holds the file
-- as it is uploaded, or later through the seller's same-origin copy of the
-- photo (GET /api/products/[id]/photo), which no buyer's page can read. The
-- answer is stored here, once per photo, so every storefront the product is
-- on blends from it, a board built through the MCP included.
--
--   1. products.photo_edge: 'white', 'other', or null (not measured yet).
--      NOT CONTENT. It is not in moderation_columns('product'), so writing it
--      neither re-checks nor holds the product, and it is not in `details`,
--      which is moderated, strictly parsed and replaced whole by every save.
--   2. IT FOLLOWS THE PHOTO. Any write that changes image_key clears it, so a
--      replaced photo never wears the old one's answer, whoever replaced it
--      (the form, the MCP, a service-role write). The app records a
--      measurement only against the photo that was measured
--      (update ... where image_key = that key), so a late answer about an old
--      photo lands nowhere.
--   3. A MEASUREMENT IS NOT AN EDIT. An update that changes photo_edge and
--      nothing else leaves updated_at alone, which "last touched" (the
--      designer's suggestions) and the sitemap read.
--
-- RLS is unchanged: the column is the product's, under the products policies
-- (the owner, and team members with products.write). The CHECK is the
-- database's half of the enum (PHOTO_EDGES in src/types/product.ts).
--
-- APPLY BEFORE DEPLOYING the build that reads it: every product read selects
-- the column. Sentinel: scripts/lib/prod-schema.ts. One added column (no
-- rewrite: nullable, no default), one constraint over a column that is all
-- null, and two trigger functions. No backfill: photos are measured by the
-- seller's browser as they are seen.
-- =============================================================================

-- ---- 1. The column ---------------------------------------------------------------

alter table public.products
  add column if not exists photo_edge text;

alter table public.products
  drop constraint if exists products_photo_edge_check;
alter table public.products
  add constraint products_photo_edge_check
    check (photo_edge is null or photo_edge in ('white', 'other'));

comment on column public.products.photo_edge is
  'What is at the edges of the main photo (image_key): white (a studio shot) or other. Null = not measured. Measured in the seller''s browser, never on the server; cleared whenever image_key changes. Read by the storefront card looks (whiteBlend auto, the shadow title).';

-- ---- 2. It follows the photo -----------------------------------------------------

create or replace function public.products_photo_edge_follows_photo()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.image_key is distinct from old.image_key then
    new.photo_edge := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.products_photo_edge_follows_photo() from public, anon, authenticated;

drop trigger if exists products_photo_edge_follows_photo on public.products;
create trigger products_photo_edge_follows_photo
  before update of image_key on public.products
  for each row execute function public.products_photo_edge_follows_photo();

-- ---- 3. A measurement is not an edit ---------------------------------------------
-- The products table's own updated_at trigger, which until now called the
-- shared set_updated_at(). Every other update moves updated_at exactly as
-- before, a write that changes nothing included.

create or replace function public.products_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.photo_edge is distinct from old.photo_edge then
    if (to_jsonb(new) - 'photo_edge') = (to_jsonb(old) - 'photo_edge') then
      return new;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.products_set_updated_at() from public, anon, authenticated;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.products_set_updated_at();

notify pgrst, 'reload schema';
