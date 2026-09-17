-- A short, optional seller bio on the account.
--
-- WHAT IT IS. One line (100 characters at most) about who is selling, set once
-- in Settings › Business & seller details beside the trader identity and shown
-- in the Seller section of every hosted product page this account sells on
-- (lib/settings/seller-identity.ts builds it into `StorefrontSeller.bio`).
-- Account-level for the same reason the rest of that section is: it describes
-- the seller, not one storefront. A storefront's own masthead bio
-- (storefronts.config.header.bio) is a separate, per-store line and is not
-- replaced by this.
--
-- NOT PART OF THE PUBLISH GATE. Nothing in lib/settings/trader-identity.ts
-- reads it; an empty bio never blocks publishing or selling.
--
-- WHY THE CHECKS. Zod (taxSchema) is the write boundary for the settings form;
-- these are the backstop against a direct or service-role write that skipped
-- it, the same reasoning every other profile text column carries a CHECK for.
-- The control-character rule mirrors the single-line text primitive
-- (lib/validation/inputs.ts): no newlines or other C0 characters, no DEL.

alter table public.profiles
  add column seller_bio text;

alter table public.profiles
  add constraint profiles_seller_bio_shape
    check (
      seller_bio is null
      or (char_length(seller_bio) between 1 and 100 and seller_bio !~ '[\x01-\x1f\x7f]')
    );

comment on column public.profiles.seller_bio is
  'Optional one-line seller bio (max 100 chars) shown in the Seller section of every hosted product page this account sells on. Never required to publish.';
