-- Product options: the seller-defined axes a product is sold along, replacing
-- the fixed "colours" list added in 20260902_product_page.
--
-- WHY. `variants` could only ever be a flat list of colours, so a seller with
-- sizes, wattages, lengths or capacities had nowhere to put them. An axis is
-- the seller's own business, so the axis itself becomes data: option_groups is
-- [{id, name, display, options: [{id, name, swatch?, available}]}], where the
-- group's NAME is what the page prints ("Colour", "Power output", "Length")
-- and its `display` decides whether the choices draw as swatches, chips or a
-- dropdown. A photo's tie moves from gallery[].variantId to gallery[].optionId
-- and points at an option in any group.
--
-- STILL NOT A SKU TABLE. Every option is the same product at the same price
-- with the same stock; the shape cannot express anything else, and that is
-- deliberate. Per-combination price and inventory need real rows (a
-- product_variants table with its own RLS), and they earn them when in-house
-- checkout needs them, not before. This column is presentation: which photo,
-- and whether the buy button is available.
--
-- WHY THE CHECKS, again. Zod (src/lib/validation/product.ts) is the boundary
-- for every application write, but a service-role write is not parsed by Zod,
-- so jsonb_typeof pins the top-level shape and pg_column_size caps the bytes.
-- 16 KB holds the schema's worst case (4 groups x 24 options) with room over.
--
-- The gallery cap goes up with it: a product varying along two axes needs more
-- than ten photos to show them, and each entry now carries an optionId. 32 KB
-- covers GALLERY_MAX (24) entries at their maximum key + alt length.

alter table public.products
  add column option_groups jsonb not null default '[]'::jsonb;

-- Carry the colours over as one group named "Colour", ids unchanged, so every
-- photo tie keeps resolving. Only rows that actually have colours are touched.
update public.products
set option_groups = jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'name', 'Colour',
        'display', 'swatch',
        'options', variants
      )
    )
where jsonb_typeof(variants) = 'array'
  and jsonb_array_length(variants) > 0;

-- gallery[].variantId -> gallery[].optionId, entry by entry. `- 'variantId'`
-- drops the old member; entries with no tie pass through untouched.
update public.products
set gallery = (
      select coalesce(jsonb_agg(
               case
                 when entry ? 'variantId'
                   then (entry - 'variantId') || jsonb_build_object('optionId', entry -> 'variantId')
                 else entry
               end
               order by ordinality
             ), '[]'::jsonb)
      from jsonb_array_elements(gallery) with ordinality as t(entry, ordinality)
    )
where jsonb_typeof(gallery) = 'array'
  and gallery::text like '%"variantId"%';

alter table public.products
  drop constraint products_variants_is_array,
  drop constraint products_variants_size,
  drop column variants;

alter table public.products
  add constraint products_option_groups_is_array
    check (jsonb_typeof(option_groups) = 'array'),
  add constraint products_option_groups_size
    check (pg_column_size(option_groups) <= 16384);

alter table public.products
  drop constraint products_gallery_size,
  add constraint products_gallery_size
    check (pg_column_size(gallery) <= 32768);

comment on column public.products.option_groups is
  'Seller-defined option axes: [{id, name, display, options:[{id,name,swatch?,available}]}]. Presentation only - no per-option price or stock. Validated by productWriteSchema.';
comment on column public.products.gallery is
  'Extra photos: [{key, alt, optionId?}], R2 keys only. optionId ties a photo to one option in any group. Validated by productWriteSchema.';
