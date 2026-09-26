// WHAT STAFF ASKED THE SELLER TO CHANGE, and where each thing lives.
//
// A pause used to point at a whole product: "fix it", and a sentence. On a
// form of nine sections that is a scavenger hunt, so staff now pick the parts
// (the photos, the title, the purchase link) and the seller's edit page lights
// up exactly those. This file is the vocabulary and the map from each word to
// the place on screen that owns it.
//
// MIRROR of FIX_FIELDS in the admin panel (lib/moderation/content.ts), which
// writes these values, and of the CHECK constraints in
// 20260926_moderation_decisions_and_appeals.sql. Change all three together: a
// field the admin panel can pick and this app cannot place is a highlight that
// silently never appears.
//
// Pure and client-safe: the edit form, the banner and the storefront list all
// read it in the browser.

import { msg, type MessageRef } from "@/i18n/types";
import type { ProductFormSectionId } from "@/lib/products/form-datapoints";

/** In the order the product form shows them, so every list of them does too. */
export const PRODUCT_FIX_FIELDS = [
  "title",
  "description",
  "price",
  "image",
  "file",
  "purchaseLink",
  "shipping",
  "options",
  "photos",
  "specs",
  "documents",
  "safety",
  "other",
] as const;

/** In the order the designer's panels read, roughly top of the page down. */
export const STOREFRONT_FIX_FIELDS = [
  "name",
  "header",
  "text",
  "images",
  "products",
  "background",
  "productPage",
  "other",
] as const;

export type ProductFixField = (typeof PRODUCT_FIX_FIELDS)[number];
export type StorefrontFixField = (typeof STOREFRONT_FIX_FIELDS)[number];
export type FixTarget = "product" | "storefront";

const VOCABULARY: Record<FixTarget, readonly string[]> = {
  product: PRODUCT_FIX_FIELDS,
  storefront: STOREFRONT_FIX_FIELDS,
};

/**
 * The fields a row names that this app knows how to show, in display order.
 *
 * The column arrives from the database as whatever the admin panel wrote, and
 * a value this build does not know (a newer admin, a hand edit) is dropped
 * rather than rendered as a raw key. `other` is kept: it has no place on the
 * form, but it still tells the seller the note covers something more.
 */
export function fixFieldsFor(
  target: FixTarget,
  raw: readonly string[] | null | undefined,
): string[] {
  if (!raw || raw.length === 0) return [];
  const wanted = new Set(raw);
  return VOCABULARY[target].filter((field) => wanted.has(field));
}

/** The seller-facing name of one field ("Photos", "Purchase link"). */
export function fixFieldLabel(target: FixTarget, field: string): MessageRef {
  return target === "product"
    ? msg("Products.removal.fields.product", { field })
    : msg("Products.removal.fields.storefront", { field });
}

/**
 * Where each product field lives on the edit form. `other` has no place: the
 * staff note is where it is explained.
 */
export const PRODUCT_FIX_FIELD_SECTION: Record<ProductFixField, ProductFormSectionId | null> = {
  title: "basics",
  description: "basics",
  price: "basics",
  image: "media",
  file: "media",
  purchaseLink: "media",
  shipping: "shipping",
  options: "options",
  photos: "photos",
  specs: "specs",
  documents: "documents",
  safety: "safety",
  other: null,
};

/** The sections a set of product fields touches, in form order (the field
 *  list is itself in form order, so walking it gives the sections in order). */
export function flaggedProductSections(fields: readonly string[]): ProductFormSectionId[] {
  const sections = new Set<ProductFormSectionId>();
  for (const field of PRODUCT_FIX_FIELDS) {
    const section = PRODUCT_FIX_FIELD_SECTION[field];
    if (section && fields.includes(field)) sections.add(section);
  }
  return [...sections];
}

/**
 * sessionStorage key for the flagged parts a seller has already changed and
 * saved under one decision, so "Changed" survives the reload after a save.
 * Per decision: a new pause starts from nothing.
 */
export function fixProgressStorageKey(decisionId: string): string {
  return `sq.moderation.fixed.${decisionId}`;
}

/** The product fields staff flagged inside one section, in form order. */
export function flaggedFieldsIn(
  section: ProductFormSectionId,
  fields: readonly string[],
): ProductFixField[] {
  return PRODUCT_FIX_FIELDS.filter(
    (field) => fields.includes(field) && PRODUCT_FIX_FIELD_SECTION[field] === section,
  );
}
