import { z } from "zod";
import { CURRENCIES, PRODUCT_STATUSES } from "@/types/product";

// Zod schemas shared by client (UX feedback) and server (the security
// boundary). Every product write and every presign request is parsed with
// these on the server before anything touches the DB or R2 — the client-side
// checks in ProductForm/ImageDropzone are convenience only.

export const UPLOAD_KINDS = ["image", "file"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const DIGITAL_FILE_MAX_BYTES = 200 * 1024 * 1024; // 200 MB

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

/** Max stored-object size for a kind — the cap enforced server-side via HEAD. */
export function maxBytesForKind(kind: UploadKind): number {
  return kind === "image" ? IMAGE_MAX_BYTES : DIGITAL_FILE_MAX_BYTES;
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
  const allowed: readonly string[] =
    kind === "image" ? IMAGE_CONTENT_TYPES : DIGITAL_FILE_CONTENT_TYPES;
  return allowed.includes(bare);
}

const filenameSchema = z.string().trim().min(1).max(200);

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
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000),
    priceCents: z.number().int().min(1).max(PRICE_CENTS_MAX),
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
// (see lib/r2.ts), so a stored key must match that shape exactly.
const OBJECT_KEY_PATTERN =
  /^(images|files)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,200}$/;

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
  const prefix = kind === "image" ? "images" : "files";
  return (
    OBJECT_KEY_PATTERN.test(key) && key.startsWith(`${prefix}/${ownerId}/`)
  );
}
