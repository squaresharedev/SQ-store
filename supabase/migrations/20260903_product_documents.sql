-- Product documents: certificates, manuals, spec sheets a regulated or
-- technical product needs to show buyers (and regulators) BEFORE purchase,
-- publicly, not gated behind checkout the way digital_file_key is.
--
-- Same reasoning as gallery/variants/details (20260902_product_page.sql):
-- bounded jsonb validated by one Zod schema before every write, no new RLS
-- surface, no new view or function to audit.

alter table public.products
  add column documents jsonb not null default '[]'::jsonb;

alter table public.products
  add constraint products_documents_is_array
    check (jsonb_typeof(documents) = 'array'),
  add constraint products_documents_size
    check (pg_column_size(documents) <= 8192);

comment on column public.products.documents is
  'Public documents: [{key, label}], R2 keys under documents/ (PDF only, 20 MB, uploaded via /api/uploads/document). Validated by productWriteSchema. Not the paywalled digital_file_key, which lives under files/.';

-- The product page's section list has grown to include "documents". Configs
-- saved before it existed simply lack the entry; nothing here needs to
-- change for them (see productPageSchema.sections in
-- src/lib/validation/storefront.ts, and normalizeSections).
