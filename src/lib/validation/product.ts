import { z } from "zod";
import {
  boundedInt,
  multiLineText,
  singleLineText,
} from "@/lib/validation/inputs";
import { CURRENCIES, PRODUCT_STATUSES } from "@/types/product";

// Zod schemas shared by client (UX feedback) and server (the security
// boundary). Every product write and every presign request is parsed with
// these on the server before anything touches the DB or R2 — the client-side
// checks in ProductForm/ImageDropzone are convenience only.

export const UPLOAD_KINDS = ["image", "file", "font", "element"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const DIGITAL_FILE_MAX_BYTES = 200 * 1024 * 1024; // 200 MB
/**
 * Decorative artwork a seller drops on the storefront canvas: a logo, an icon,
 * a graphic. Deliberately far tighter than a product photo — an element is
 * chrome, not the subject, and every buyer who loads the storefront fetches it.
 */
export const ELEMENT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
/**
 * Fonts are small by nature: a subset WOFF2 is tens of KB and a full-coverage
 * TTF rarely passes 1 MB. The cap is deliberately tight, because this file is fetched
 * by every buyer who loads the storefront, so a font big enough to be felt is a
 * font the seller should be compressing instead.
 */
export const FONT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

export const IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

// What a buyer downloads: archives, documents, audio, video, images.
// Windows browsers report zips as x-zip-compressed, so both are listed.
export const DIGITAL_FILE_CONTENT_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/pdf",
  "application/epub+zip",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "video/mp4",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
] as const;

/**
 * Web font formats a storefront may use. WOFF2 first because it is the one to
 * use: it is the smallest and every browser this app supports reads it. The
 * others are accepted so a seller with only a TTF/OTF licence is not stuck.
 */
export const FONT_CONTENT_TYPES = [
  "font/woff2",
  "font/woff",
  "font/ttf",
  "font/otf",
] as const;

/**
 * Canvas elements: every raster a product image may be, PLUS SVG.
 *
 * SVG IS ADMITTED HERE AND NOWHERE ELSE, and that isolation is the point. It is
 * markup, so it is the one upload in this product that could carry script, and
 * confining it to its own kind (and its own `elements/` prefix) means product
 * images, backgrounds, fonts and digital files keep exactly the allowlists they
 * had. Two things make it safe to accept at all: `sniffSvg` rejects any file
 * carrying script, event handlers, external references or entity declarations
 * before it is ever stored, and ImageTileContent renders elements only through
 * `<img src>`, where the spec puts SVG in secure static mode — no scripts, no
 * external fetches, no interactivity. It is never inlined into the DOM.
 */
export const ELEMENT_CONTENT_TYPES = [
  ...IMAGE_CONTENT_TYPES,
  "image/svg+xml",
] as const;

/** Max stored-object size for a kind — the cap enforced server-side via HEAD. */
export function maxBytesForKind(kind: UploadKind): number {
  switch (kind) {
    case "image":
      return IMAGE_MAX_BYTES;
    case "font":
      return FONT_MAX_BYTES;
    case "file":
      return DIGITAL_FILE_MAX_BYTES;
    case "element":
      return ELEMENT_MAX_BYTES;
  }
}

/** The allowlist of stored Content-Types for a kind. */
function contentTypesForKind(kind: UploadKind): readonly string[] {
  switch (kind) {
    case "image":
      return IMAGE_CONTENT_TYPES;
    case "font":
      return FONT_CONTENT_TYPES;
    case "file":
      return DIGITAL_FILE_CONTENT_TYPES;
    case "element":
      return ELEMENT_CONTENT_TYPES;
  }
}

/**
 * Whether a stored object's Content-Type is allowed for the kind. R2 returns
 * the type verbatim; tolerate an optional `; charset=...` suffix.
 */
export function isAllowedContentType(
  kind: UploadKind,
  contentType: string | null,
): boolean {
  if (!contentType) return false;
  const bare = contentType.split(";")[0]!.trim().toLowerCase();
  return contentTypesForKind(kind).includes(bare);
}

// A user-supplied file NAME (the stored key is server-minted separately).
const filenameSchema = singleLineText({ label: "A filename", max: 200 });

export const presignRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("image"),
    filename: filenameSchema,
    contentType: z.enum(IMAGE_CONTENT_TYPES),
    size: z.number().int().positive().max(IMAGE_MAX_BYTES),
  }),
  z.object({
    kind: z.literal("file"),
    filename: filenameSchema,
    contentType: z.enum(DIGITAL_FILE_CONTENT_TYPES),
    size: z.number().int().positive().max(DIGITAL_FILE_MAX_BYTES),
  }),
]);
export type PresignRequest = z.infer<typeof presignRequestSchema>;

// €/$1,000,000 cap in cents — far below int4 max, sane for the product.
export const PRICE_CENTS_MAX = 100_000_000;

// Inventory cap — far below int4 max; nobody hand-tracks more units than this.
export const STOCK_QUANTITY_MAX = 1_000_000;

/**
 * A full product write. For updates, `imageKey`/`digitalFileKey` are
 * three-state: `undefined` = keep the stored key, `null` = clear it,
 * `string` = replace it (must be a key the caller owns — see
 * {@link isOwnedObjectKey}, checked in the server action).
 */
export const productWriteSchema = z
  .object({
    title: singleLineText({ label: "A product title", max: 200 }),
    description: multiLineText({ label: "A product description", max: 5000 }),
    priceCents: boundedInt({ label: "Price", min: 1, max: PRICE_CENTS_MAX }),
    currency: z.enum(CURRENCIES),
    status: z.enum(PRODUCT_STATUSES),
    imageKey: z.string().max(600).nullish(),
    digitalFileKey: z.string().max(600).nullish(),
    // Stock tracking (all optional so pre-stock callers/payloads still parse;
    // server actions leave stored values untouched when a field is absent).
    // Quantities are non-negative INTEGERS — the DB checks mirror this.
    trackStock: z.boolean().optional(),
    stockQuantity: z.number().int().min(0).max(STOCK_QUANTITY_MAX).nullish(),
    lowStockThreshold: z.number().int().min(0).max(STOCK_QUANTITY_MAX).optional(),
  })
  // Mirrors the DB constraint: tracking without a concrete quantity is invalid.
  .refine(
    (data) => data.trackStock !== true || typeof data.stockQuantity === "number",
    { error: "Set how many are in stock.", path: ["stockQuantity"] },
  );
export type ProductWriteInput = z.infer<typeof productWriteSchema>;

export const productIdSchema = z.uuid();

// Keys are minted server-side as {prefix}/{ownerId}/{uuid}-{sanitizedName}
// (see lib/r2.ts), so a stored key must match that shape exactly. Exported for
// other schemas that store object keys (e.g. storefront background images).
export const OBJECT_KEY_PATTERN =
  /^(images|files|fonts|elements)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,200}$/;

/** The bucket prefix a kind's objects live under. One place, because the key
 *  pattern, the key builder and the ownership check must agree exactly. */
export function objectKeyPrefix(kind: UploadKind): string {
  switch (kind) {
    case "image":
      return "images";
    case "font":
      return "fonts";
    case "file":
      return "files";
    case "element":
      return "elements";
  }
}

/**
 * True if `key` is well-formed AND lives under the caller's own prefix for the
 * given kind. Prevents a client from linking someone else's object (or an
 * arbitrary path) to their product row.
 */
export function isOwnedObjectKey(
  key: string,
  kind: UploadKind,
  ownerId: string,
): boolean {
  return (
    OBJECT_KEY_PATTERN.test(key) &&
    key.startsWith(`${objectKeyPrefix(kind)}/${ownerId}/`)
  );
}
