// What the seller told us about their store when they created this storefront.
// Stored in the `storefronts.brief` jsonb column, which is deliberately NOT
// `config`: config is the buyer-facing render contract (see types/storefront.ts)
// and gets serialised into the public embed payload, so seller-side intent must
// not live there.
//
// Every field is optional, because the creation flow can be skipped at any
// point. An empty brief means "we never asked / they declined", which is a
// different thing from "they have no preference" and the recommender should
// treat it as such.
//
// The values are closed enums so the whole file doubles as the allowlist the
// server validates against (lib/validation/storefront-brief.ts).

/**
 * What the store sells. The single strongest signal for matching a template:
 * theme marketplaces filter on industry above everything else. This is the
 * Shopify Theme Store's 20-facet industry list compressed to the categories a
 * creator-scale seller actually falls into, plus an escape hatch.
 */
export const STOREFRONT_CATEGORIES = [
  "fashion",
  "art",
  "jewellery",
  "handmade",
  "home",
  "beauty",
  "food",
  "music",
  "photography",
  "books",
  "digital",
  "vintage",
  "other",
] as const;
export type StorefrontCategory = (typeof STOREFRONT_CATEGORIES)[number];

/**
 * How a buyer takes delivery. Decides which capabilities a template has to
 * support: shipping fields and physical-product cards, a download handoff, a
 * booking surface, or all of them at once.
 */
export const STOREFRONT_FULFILMENTS = [
  "physical",
  "digital",
  "services",
  "mixed",
] as const;
export type StorefrontFulfilment = (typeof STOREFRONT_FULFILMENTS)[number];

/**
 * The look the seller is going for. The one answer that pays off immediately:
 * each vibe maps to a real starting theme in lib/storefront/presets.ts, applied
 * to the config at creation, so the seller lands in a designer that already
 * looks like the tile they picked.
 */
export const STOREFRONT_VIBES = [
  "minimal",
  "warm",
  "bold",
  "playful",
  "luxe",
  "classic",
] as const;
export type StorefrontVibe = (typeof STOREFRONT_VIBES)[number];

/**
 * The stored shape. Note what is NOT here: catalogue size. It is a real
 * template signal, but we already know the seller's exact product count, and
 * asking someone to bucket a number we can read is pure cost. The recommender
 * reads it from the products table instead, where it also stays current.
 */
export type StorefrontBrief = {
  category?: StorefrontCategory;
  /** Free text. Only meaningful when `category` is "other". */
  otherCategory?: string;
  fulfilment?: StorefrontFulfilment;
  vibe?: StorefrontVibe;
};

/** Cap on the one free-text field in the brief. */
export const BRIEF_OTHER_CATEGORY_MAX = 60;

/** A brief with nothing in it: the creation flow was skipped. */
export const EMPTY_STOREFRONT_BRIEF: StorefrontBrief = {};
