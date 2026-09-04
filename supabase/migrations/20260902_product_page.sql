-- Product page: the facts a hosted buyer-facing product page needs beyond the
-- tile, and a signal kind for its views.
--
-- WHY JSONB, NOT TABLES. Gallery, variants and details are bounded, seller-
-- authored documents validated by one Zod schema (src/lib/validation/product.ts)
-- before every write, exactly like storefronts.config. Columns on the existing
-- row mean no new RLS surface, no new view or function (this schema auto-grants
-- anon/authenticated on anything new, so every new object is an exposure to
-- audit), and one write path. Per-variant price and stock are deliberately NOT
-- modelled; when they are needed they justify a table of their own.
--
-- WHY THE CHECKS. Zod is the boundary, but a direct write with the service
-- role is not parsed by Zod. jsonb_typeof pins the top-level shape and
-- pg_column_size caps the bytes, so nothing can turn these columns into a
-- dumping ground. purchase_url repeats the scheme and length rules the schema
-- enforces, so a stored link can never be anything but https.

alter table public.products
  add column gallery      jsonb not null default '[]'::jsonb,
  add column variants     jsonb not null default '[]'::jsonb,
  add column details      jsonb not null default '{}'::jsonb,
  add column purchase_url text;

alter table public.products
  add constraint products_gallery_is_array
    check (jsonb_typeof(gallery) = 'array'),
  add constraint products_variants_is_array
    check (jsonb_typeof(variants) = 'array'),
  add constraint products_details_is_object
    check (jsonb_typeof(details) = 'object'),
  add constraint products_gallery_size
    check (pg_column_size(gallery) <= 8192),
  add constraint products_variants_size
    check (pg_column_size(variants) <= 4096),
  add constraint products_details_size
    check (pg_column_size(details) <= 16384),
  add constraint products_purchase_url_shape
    check (
      purchase_url is null
      or (char_length(purchase_url) <= 2048 and purchase_url ~ '^https://')
    );

comment on column public.products.gallery is
  'Extra photos: [{key, alt, variantId?}], R2 keys only. Validated by productWriteSchema.';
comment on column public.products.variants is
  'Colour variants: [{id, name, swatch?, available}]. Photos only; no per-variant price or stock.';
comment on column public.products.details is
  'Specification and compliance facts (dimensions, weight, materials, care, included, specs, origin, safety).';
comment on column public.products.purchase_url is
  'Where the product page buy button sends a buyer. https only. Null = no button.';

-- A view of the hosted product page. Recorded server-side by the page itself
-- (never accepted from the widget), deduped per visitor per product per hour.
-- THIS LIST IS MIRRORED in src/lib/analytics/signals.ts; edit both together.
alter table public.storefront_signals
  drop constraint storefront_signals_kind_check;
alter table public.storefront_signals
  add constraint storefront_signals_kind_check
    check (kind in ('storefront_view','product_click','email_signup','booking','product_view'));
