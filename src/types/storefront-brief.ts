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
 *
 * THREE, not six. The six that came before were six colour schemes: they
 * differed in canvas, accent and roundness, and every one of them showed the
 * same tile — name and price printed under the picture, always. Picking between
 * them was picking a palette, which is a thing the seller can change in two
 * clicks anyway. These three differ in what a tile SHOWS, which is the decision
 * a storefront is actually built around and the one that is tedious to arrive
 * at by hand: a gallery wall that stays out of the way until you point at it, a
 * shop that labels everything, and a catalogue that always shows the price.
 */
export const STOREFRONT_VIBES = ["minimal", "classic", "bold"] as const;
export type StorefrontVibe = (typeof STOREFRONT_VIBES)[number];

/**
 * The looks that existed before the set was cut to three, and the survivor each
 * one now stands for.
 *
 * A brief is stored jsonb, so rows carrying a retired answer outlive the answer
 * itself. Mapping them (rather than letting the enum reject them) keeps the
 * rest of an old brief — the category and fulfilment, which are the two the
 * recommender actually leans on — instead of degrading the whole thing to
 * nothing over a question we retired. The map is by closest surviving look:
 * warm and luxe were both soft, serif-ish and fully labelled; playful was the
 * loud one.
 */
export const RETIRED_STOREFRONT_VIBES: Record<string, StorefrontVibe> = {
  warm: "classic",
  luxe: "classic",
  playful: "bold",
};

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
