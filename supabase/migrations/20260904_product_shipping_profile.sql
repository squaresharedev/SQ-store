-- Shipping profiles: which set of shipping terms a product is sold under.
--
-- THE PROBLEM. Shipping reads the same for almost every product a seller
-- lists, so asking for it per product is asking the same question fifty times
-- and getting fifty answers that drift apart. Shopify's answer is a general
-- shipping profile every product falls into plus custom profiles products are
-- moved to; Etsy's is the same idea under the same name. Both share one rule:
-- the terms live in ONE place and products POINT at it. Nothing is ever copied
-- onto a product, so editing the terms edits every product using them.
--
-- WHERE THE PROFILES LIVE. In storefronts.config, beside policies.shipping —
-- which IS the general profile, unchanged, still the default for every product
-- that names nothing. The named exceptions are config.shippingProfiles, one
-- more seller-authored jsonb member validated by the same Zod schema every
-- other member is (src/lib/validation/storefront.ts). Same reasoning as
-- 20260902_product_page: no new table, so no new RLS surface, and no new
-- object for this schema's auto-grant to expose.
--
-- WHY A COLUMN HERE, NOT A KEY IN products.details. `details` is the
-- specification and compliance block a page prints; a shipping profile is a
-- reference to another row's config, and it is the thing you would want to
-- query ("what still uses this profile") the day a seller deletes one.
--
-- NULLABLE IS THE COMMON CASE and the only default: null means "the store's
-- default terms", which is what nearly every product wants and what every
-- existing row correctly already says. Deliberately NOT a foreign key: the
-- target is an id inside another table's jsonb, so nothing could enforce it.
-- An id naming a profile the storefront no longer has resolves to the store's
-- default (see resolveProductShipping), which is the same graceful answer a
-- product placed on a second storefront gets.

alter table public.products
  add column shipping_profile_id text;

alter table public.products
  add constraint products_shipping_profile_id_shape
    check (
      shipping_profile_id is null
      or (
        char_length(shipping_profile_id) between 1 and 64
        and shipping_profile_id ~ '^[A-Za-z0-9_-]+$'
      )
    );

-- Partial: nearly every row is null (the store default), and those are exactly
-- the rows no lookup ever asks about.
create index products_shipping_profile_id_idx
  on public.products (shipping_profile_id)
  where shipping_profile_id is not null;

comment on column public.products.shipping_profile_id is
  'Which of the storefront config''s shippingProfiles this product ships under. Null = the store default (config.policies.shipping). Not an FK: the target lives in another table''s jsonb, and an unresolvable id falls back to the default.';
