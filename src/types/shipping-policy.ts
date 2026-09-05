import type { ShippingProfile } from "@/types/storefront";

/**
 * THE ACCOUNT'S SHIPPING AND RETURNS TERMS.
 *
 * WHERE THIS CAME FROM. These used to be `storefronts.config.policies` plus
 * `storefronts.config.shippingProfiles`: three free-text boxes and a profile
 * list, edited inside the storefront designer's side panel. Two things were
 * wrong with that. A seller with more than one storefront retyped the same
 * returns policy into each of them, and a storefront is a PRESENTATION of one
 * catalogue rather than a separate business, so there was never a second
 * answer to give. And the design surface is the wrong place to be writing
 * legal text at all: nobody arranging a page wants to stop and decide who pays
 * return postage. Shopify (Settings › Policies), Etsy (Settings › Policies)
 * and Squarespace (Settings › Shipping and Fulfillment) all put this in
 * settings for the same reason.
 *
 * So this is account-level, set once in Settings › Shipping & returns, read by
 * every storefront and every product the account has. Same move, same day, as
 * the trader identity in `lib/settings/seller-identity.ts`, and for the same
 * reason: it is a fact about the BUSINESS, not about a page.
 *
 * STRUCTURED, NOT THREE TEXTAREAS. The old shape asked for prose and got
 * nothing: a blank box is the single best predictor of a policy never being
 * written. Asking instead for the four or five facts a buyer actually wants
 * (where it ships from, how long to where, how long they have to return it,
 * who pays the postage back) is answerable in a minute, and `policy-prose.ts`
 * turns the answers into the paragraphs the page prints. It also makes the
 * terms MACHINE-READABLE rather than an opaque blob, which is what lets the
 * storefront contract in `@squareshare/schemas` describe them properly, and
 * what a compliance check would later read.
 *
 * `shippingText` / `returnsText` are the escape hatch: a seller who wants
 * their own words gets them, and the generator steps aside. Absent (not "")
 * when unused, so an account that never touched them stores nothing.
 */
export type SellerShippingPolicy = {
  // --- Shipping ---
  /** ISO-3166 alpha-2, or absent. Printed as "Ships from Ireland." */
  shipsFrom?: string;
  /** The one line that belongs beside the buy button rather than in the fold
   *  below ("Ships within 1-3 business days"), which is why it is its own
   *  field and not the first sentence of a paragraph. */
  dispatch?: string;
  /** Where it goes and how long it takes. A short list, not a rate table. */
  destinations?: ShippingDestination[];
  /** Anything the rows above cannot say. Appended to the generated prose. */
  shippingNotes?: string;
  /** The seller's own shipping paragraph, used INSTEAD of the generated one. */
  shippingText?: string;

  // --- Returns ---
  /** Days from delivery. 0 = none offered beyond the statutory right the page
   *  already states for EU sellers, which is a real and common answer. */
  returnsWindowDays?: number;
  /** Who pays the postage back. Absent while no window is offered. */
  returnsPaidBy?: ReturnsPaidBy;
  /** Exceptions: made-to-order, hygiene items, opened software. */
  returnsNotes?: string;
  /** The seller's own returns paragraph, used INSTEAD of the generated one. */
  returnsText?: string;

  // --- Exceptions ---
  /**
   * NAMED SETS OF TERMS the handful of products that ship differently point
   * at, by `products.shipping_profile_id`. Unchanged in shape from when they
   * lived on the storefront, and deliberately still PROSE: an exception is a
   * sentence ("Made to order, allow 3 weeks"), not a structure worth filling
   * in five fields for.
   */
  profiles?: ShippingProfile[];
};

/** One "where to, and how long" row. */
export type ShippingDestination = {
  /** "Ireland", "Rest of EU", "Worldwide". The seller's own grouping. */
  area: string;
  /** "2-3 business days". Words, not a number: sellers do not agree on
   *  whether the count includes dispatch, and forcing a number would make the
   *  page state something the seller did not mean. */
  time: string;
  /** "€4.50", "Free over €50". Absent = say nothing about cost. */
  cost?: string;
};

export const RETURNS_PAID_BY = ["buyer", "seller"] as const;
export type ReturnsPaidBy = (typeof RETURNS_PAID_BY)[number];

/**
 * The statutory distance-selling window in the EU, and the default this form
 * offers. A seller is free to give more; the product page states the statutory
 * right separately either way, so a shorter number here is not a way to opt
 * out of it (see ProductPageView's EU block).
 */
export const RETURNS_WINDOW_DEFAULT_DAYS = 14;
export const RETURNS_WINDOW_MAX_DAYS = 365;

/** A short list of destinations, not a rate table. Past this the seller is
 *  modelling something these three fields cannot express. */
export const SHIPPING_DESTINATIONS_MAX = 6;
export const DESTINATION_AREA_MAX = 60;
export const DESTINATION_TIME_MAX = 60;
export const DESTINATION_COST_MAX = 40;

/** Where the terms are edited. Lives HERE, not beside getShippingChoices in
 *  lib/storefront/queries.ts, because the product form is a CLIENT component:
 *  a value imported from that module drags lib/supabase/server (and so
 *  next/headers) into the browser bundle and fails the build. Types are erased
 *  and may still come from there; values may not. */
export const SHIPPING_SETTINGS_HREF = "/settings/shipping";

/** An account that has said nothing at all. Its own constant rather than a
 *  literal at each call site, so "empty" means one thing everywhere. */
export const EMPTY_SHIPPING_POLICY: SellerShippingPolicy = {};
