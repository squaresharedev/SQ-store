-- Per-version specifications: an option may now state the facts IT changes.
--
-- WHY. A table sold in two sizes is two sets of dimensions and two weights, and
-- until now a product had exactly one `details` blob, so its spec table was
-- wrong for at least one version. Sellers worked around it by writing both sets
-- of numbers into one row ("120x80x75 small / 180x90x75 large") or by listing
-- the same table twice as two products. An option now carries an optional
-- `details` member of its own:
--
--   options: [{ id, name, swatch?, available,
--               details?: { dimensions?, weight?, specs?[] } }]
--
-- and the product page shows the chosen version's numbers in place of the
-- product's (see lib/products/option-details.ts, the one place that folds the
-- two together). Absent means inherit, so a seller states only what differs and
-- the shared facts (materials, care, contents, origin, safety) stay written
-- once on the product.
--
-- STILL NOT A SKU TABLE, and this changes nothing about that. There is no price
-- and no stock here, per option or per combination; this is the same
-- presentation column it always was, now carrying the measurements the page
-- prints. A tie is to ONE option, never a combination, exactly like a photo's:
-- "Large is 180 x 90 x 75" holds in every colour Large is sold in.
--
-- WHY THE CAP GOES UP. 16 KB held the old worst case (4 groups x 24 options of
-- names and swatches) with room over. An option may now add dimensions, a
-- weight and up to OPTION_SPECS_MAX (4) short spec rows, which is roughly a
-- kilobyte more per option, so the schema's worst case (OPTIONS_TOTAL_MAX = 48
-- options, every one of them fully measured) lands near 48 KB. 64 KB keeps the
-- same headroom the column had before. Zod
-- (src/lib/validation/product.ts) remains the boundary every application write
-- passes; this is the fence a service-role write cannot climb.

alter table public.products
  drop constraint products_option_groups_size,
  add constraint products_option_groups_size
    check (pg_column_size(option_groups) <= 65536);

comment on column public.products.option_groups is
  'Seller-defined option axes: [{id, name, display, options:[{id,name,swatch?,available,details?}]}]. details holds the dimensions/weight/specs that version changes; absent inherits the product''s. Presentation only - no per-option price or stock. Validated by productWriteSchema.';
