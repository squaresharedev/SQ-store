-- Seller identity moves to the ACCOUNT, off the storefront.
--
-- THE PROBLEM. The trader identity a distance-selling buyer is owed (name,
-- address, a way to get in touch, VAT id) used to live in
-- storefronts.config.seller — a seller-editable jsonb member. A seller with
-- more than one storefront had to type the same business details into every
-- one of them, and a hired team member (who has no access to Settings, which
-- is scoped to the signed-in user, never the active account) could invent
-- values the actual owner never approved. Both are wrong: this is a fact
-- about the BUSINESS, set once, true everywhere that business sells.
--
-- THE FIX. `profiles` already carries `tax_business_name` / `tax_vat_id` /
-- `tax_country` (20260706081724 settings_profile_fields), collected ahead of
-- VAT/invoicing work that had no downstream reader yet. This finishes that:
-- three more columns for the parts distance-selling law asks for that tax
-- info alone does not cover (a physical address and a way to reach the
-- seller), and every one of the six is now read by the hosted product page
-- (lib/settings/seller-identity.ts is the one place that builds the buyer-
-- facing shape from a profile row). `storefronts.config.seller` is retired —
-- see the RETIRED_TOP_LEVEL_FIELDS strip in lib/validation/storefront.ts.
--
-- WHY NOT A NEW TABLE. One seller identity per account, not a list of them;
-- a column on the row that already holds the other half of the same real-
-- world fact (tax_business_name/tax_vat_id/tax_country) is simpler than a
-- one-to-one child table would be, and RLS is already correct here (`profiles`
-- is select/update-your-own-row-only — see 20260706081542 create_profiles_
-- with_rls). A team member previewing someone else's storefront reads this
-- through a gated service-role helper instead (see the file above), the same
-- pattern the public product page already uses for everything else on it.
--
-- WHY THE CHECKS. Zod is the write boundary for the authenticated settings
-- form, but these are still a backstop against a direct or service-role
-- write that never went through it — the same reasoning every other text
-- column in this schema carries its own CHECK for.

alter table public.profiles
  add column seller_address text,
  add column seller_email text,
  add column seller_phone text;

alter table public.profiles
  add constraint profiles_seller_address_shape
    check (seller_address is null or char_length(seller_address) between 1 and 300),
  add constraint profiles_seller_email_shape
    check (
      seller_email is null
      or (char_length(seller_email) <= 254 and seller_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    ),
  add constraint profiles_seller_phone_shape
    check (seller_phone is null or char_length(seller_phone) between 1 and 32);

comment on column public.profiles.seller_address is
  'Postal address shown in the trader-identity block of every hosted product page this account sells on. Part of the same seller identity as tax_business_name/tax_vat_id/tax_country.';
comment on column public.profiles.seller_email is
  'Buyer-facing contact address (a mailto on the product page and the purchase-link fallback). Deliberately separate from the sign-in email: a seller may not want to expose that one.';
comment on column public.profiles.seller_phone is
  'Buyer-facing phone number shown in the trader-identity block, same scope as seller_address.';

-- Hygiene, not a live cleanup: no stored storefront currently carries a
-- `seller` config member (checked before writing this), so this is a no-op
-- today and only guards against a stray one reappearing before the schema
-- change ships everywhere.
update public.storefronts
set config = config - 'seller'
where config ? 'seller';
