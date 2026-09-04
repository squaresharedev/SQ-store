"use server";

import { revalidatePath } from "next/cache";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { createClient } from "@/lib/supabase/server";
import { deleteObject, headObject } from "@/lib/r2";
import type { TablesUpdate } from "@/types";
import type { Json } from "@/types/supabase";
import { parseDocuments, parseGallery, parseOptionGroups } from "@/lib/products/detail";
import {
  failure,
  invalidInput,
  notFound,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  uploadFailed,
  type ActionError,
} from "@/lib/errors";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import {
  NEW_DOCUMENT_KEYS_PER_SAVE_MAX,
  NEW_GALLERY_KEYS_PER_SAVE_MAX,
  collectOptionIds,
  isAllowedContentType,
  isOwnedObjectKey,
  maxBytesForKind,
  objectKeyPrefix,
  productIdSchema,
  productWriteSchema,
  type ProductWriteInput,
  type UploadKind,
} from "@/lib/validation/product";

/** jsonb columns are written through a JSON round-trip so `undefined` members
 *  (an untied photo's optionId) are dropped rather than serialised oddly. */
function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

// Product CRUD for the ACTIVE account's store (your own, or one you can edit as
// an owner/editor). Every write: resolve + authorize the active account
// (products.write) -> Zod parse (the security boundary; client validation is UX
// only) -> object-key ownership check (against the UPLOADER) -> account-scoped
// mutation. RLS re-checks the same permission at the DB (defense in depth), so a
// viewer can never write even if this layer were bypassed.
// Failures are structured ActionErrors (lib/errors.ts): message + how to fix.

export type ProductActionResult =
  | { ok: true; id: string }
  | { ok: false; error: ActionError };

/**
 * Parse + authorize a write payload. Returns the validated input or an error
 * result. Object keys must be well-formed and live under the UPLOADER's own R2
 * prefix (an editor legitimately uploads under their own id, then references it
 * on the owner's product).
 */
function parseWrite(
  uploaderId: string,
  input: unknown,
): { data: ProductWriteInput } | { error: ActionError } {
  const parsed = productWriteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      error: invalidInput(
        "The product details didn't pass validation.",
        "Check the name, price, and other fields, then try saving again.",
      ),
    };
  }
  const { imageKey, digitalFileKey } = parsed.data;
  if (imageKey && !isOwnedObjectKey(imageKey, "image", uploaderId)) {
    return {
      error: invalidInput(
        "That image upload can't be used with this product.",
        "Re-upload the image, then save again.",
      ),
    };
  }
  if (digitalFileKey && !isOwnedObjectKey(digitalFileKey, "file", uploaderId)) {
    return {
      error: invalidInput(
        "That file upload can't be used with this product.",
        "Re-upload the file, then save again.",
      ),
    };
  }
  // Gallery photos are images too: same prefix, same uploader-ownership rule.
  const foreignPhoto = parsed.data.gallery?.find(
    (image) => !isOwnedObjectKey(image.key, "image", uploaderId),
  );
  if (foreignPhoto) {
    return {
      error: invalidInput(
        "One of the photos can't be used with this product.",
        "Remove it, upload it again, then save.",
      ),
    };
  }
  // Documents are their own kind, under their own prefix, with their own caps.
  const foreignDocument = parsed.data.documents?.find(
    (document) => documentKeyKind(document.key, uploaderId) === null,
  );
  if (foreignDocument) {
    return {
      error: invalidInput(
        "One of the documents can't be used with this product.",
        "Remove it, upload it again, then save.",
      ),
    };
  }
  return { data: parsed.data };
}

/**
 * Which upload kind a document key is, or null when it belongs to nobody the
 * caller may link.
 *
 * Documents are uploaded as their own kind, under `documents/`, and verified
 * against the document caps (PDF only, 20 MB). Keys under `files/` are
 * accepted too, because documents shipped briefly sharing the digital-file
 * route and a seller must not be told their saved manual is now foreign; those
 * are verified against the file caps they were stored under. Nothing new is
 * ever minted there, so the legacy branch only ever narrows over time.
 */
function documentKeyKind(key: string, uploaderId: string): UploadKind | null {
  if (isOwnedObjectKey(key, "document", uploaderId)) return "document";
  if (isOwnedObjectKey(key, "file", uploaderId)) return "file";
  return null;
}

/** The kind an already-accepted document key must be verified as. Prefix
 *  alone, because parseWrite has already proved the key is one of the two and
 *  that it is the caller's. */
function storedDocumentKind(key: string): UploadKind {
  return key.startsWith(`${objectKeyPrefix("document")}/`) ? "document" : "file";
}

const KIND_NOUN: Record<UploadKind, string> = {
  image: "image",
  document: "document",
  file: "file",
  // Products never carry either of these (a font belongs to a storefront's
  // theme, an element to its canvas), but the kinds exist, so this map answers
  // for them rather than leaving a hole.
  font: "font",
  element: "element",
};

/**
 * Post-upload security boundary. A presigned PUT can bind neither Content-Type
 * nor Content-Length (see lib/r2.ts), so the presign-time checks are advisory
 * only. Before persisting a key we HEAD the stored object and enforce its REAL
 * size and type; anything oversized/wrong is deleted (not left as an abusive
 * orphan) and never linked to a product. Fails closed on transport errors.
 */
async function verifyUploadedObject(
  key: string,
  kind: UploadKind,
): Promise<{ ok: true } | { ok: false; error: ActionError }> {
  const noun = KIND_NOUN[kind];
  const maxLabel = `${Math.round(maxBytesForKind(kind) / 1024 / 1024)} MB`;
  let meta;
  try {
    meta = await headObject(key);
  } catch (error) {
    console.error("[products] object verification failed", error);
    return { ok: false, error: serverError(`verify your ${noun} upload`) };
  }
  if (!meta) {
    return {
      ok: false,
      error: uploadFailed(
        `Your ${noun} upload didn't finish.`,
        `Select the ${noun} again and re-upload it before saving.`,
      ),
    };
  }
  const tooBig =
    !Number.isFinite(meta.size) ||
    meta.size <= 0 ||
    meta.size > maxBytesForKind(kind);
  const wrongType = !isAllowedContentType(kind, meta.contentType);
  if (tooBig || wrongType) {
    // Evict the rejected object so a crafted upload can't linger in the bucket.
    await deleteObject(key).catch((error) =>
      console.error("[products] failed to evict rejected object", error),
    );
    return {
      ok: false,
      error: tooBig
        ? uploadFailed(
            `That ${noun} is too large.`,
            `Use a ${noun} under ${maxLabel}, then re-upload it.`,
          )
        : uploadFailed(
            "That file type is not supported.",
            kind === "image"
              ? "Use a JPEG, PNG, WebP, GIF, or AVIF image."
              : kind === "document"
                ? "Documents have to be PDFs. Export it as a PDF, then upload it again."
                : "Use a ZIP, PDF, EPUB, MP3, WAV, MP4, JPEG, PNG, WebP, or TXT file.",
          ),
    };
  }
  return { ok: true };
}

/**
 * Verify every newly-set object key on a write (skips keep/clear states).
 * `storedGalleryKeys`/`storedDocumentKeys` are the ones already on the row:
 * those were verified when they were first saved, so only keys the row has
 * never held are HEADed, and a save may introduce at most
 * NEW_GALLERY_KEYS_PER_SAVE_MAX / NEW_DOCUMENT_KEYS_PER_SAVE_MAX of each.
 */
async function verifyNewKeys(
  data: ProductWriteInput,
  storedGalleryKeys: ReadonlySet<string>,
  storedDocumentKeys: ReadonlySet<string>,
): Promise<{ ok: true } | { ok: false; error: ActionError }> {
  const checks: Promise<{ ok: true } | { ok: false; error: ActionError }>[] =
    [];
  if (typeof data.imageKey === "string") {
    checks.push(verifyUploadedObject(data.imageKey, "image"));
  }
  if (typeof data.digitalFileKey === "string") {
    checks.push(verifyUploadedObject(data.digitalFileKey, "file"));
  }
  const newGalleryKeys = [
    ...new Set(
      (data.gallery ?? [])
        .map((image) => image.key)
        .filter((key) => !storedGalleryKeys.has(key)),
    ),
  ];
  if (newGalleryKeys.length > NEW_GALLERY_KEYS_PER_SAVE_MAX) {
    return {
      ok: false,
      error: invalidInput(
        "Too many new photos in one save.",
        `Add up to ${NEW_GALLERY_KEYS_PER_SAVE_MAX} photos, save, then add the rest.`,
      ),
    };
  }
  for (const key of newGalleryKeys) {
    checks.push(verifyUploadedObject(key, "image"));
  }
  const newDocumentKeys = [
    ...new Set(
      (data.documents ?? [])
        .map((document) => document.key)
        .filter((key) => !storedDocumentKeys.has(key)),
    ),
  ];
  if (newDocumentKeys.length > NEW_DOCUMENT_KEYS_PER_SAVE_MAX) {
    return {
      ok: false,
      error: invalidInput(
        "Too many new documents in one save.",
        `Add up to ${NEW_DOCUMENT_KEYS_PER_SAVE_MAX} documents, save, then add the rest.`,
      ),
    };
  }
  for (const key of newDocumentKeys) {
    // Verified against the caps of the prefix it was actually stored under:
    // a `documents/` key must be a PDF under 20 MB, a legacy `files/` one
    // keeps the digital-file caps it was uploaded with. parseWrite has already
    // refused every key that is under neither, and refused both when the
    // prefix is not the caller's own.
    checks.push(verifyUploadedObject(key, storedDocumentKind(key)));
  }
  const failure = (await Promise.all(checks)).find((result) => !result.ok);
  return failure ?? { ok: true };
}

/** The photos tied to options must name options the product will have after
 *  this write: the payload's own, or the stored ones when the payload keeps
 *  them. The schema already covers the both-present case. */
function galleryMatchesOptions(
  data: ProductWriteInput,
  storedOptionIds: ReadonlySet<string>,
): boolean {
  if (!data.gallery) return true;
  const ids = data.optionGroups ? collectOptionIds(data.optionGroups) : storedOptionIds;
  return data.gallery.every((image) => !image.optionId || ids.has(image.optionId));
}

const STALE_OPTION_ERROR = invalidInput(
  "A photo points at an option that no longer exists.",
  "Reassign or untag that photo, then save again.",
);

export async function createProduct(
  input: unknown,
): Promise<ProductActionResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) {
    return failure(permissionDenied(account.role, "create products"));
  }
  // After the role check, before any R2 head or DB write: RLS decides WHETHER
  // this caller may write, the budget bounds HOW MUCH.
  if (!(await rateLimit("product_write", RATE_LIMITS.productWrite))) {
    return failure(rateLimited("create products"));
  }

  const parsed = parseWrite(account.userId, input);
  if ("error" in parsed) return failure(parsed.error);
  const { data } = parsed;

  // A new row has no stored photos, documents or options: every key is new,
  // and a tied photo must name an option in this same payload.
  if (!galleryMatchesOptions(data, new Set())) return failure(STALE_OPTION_ERROR);
  const verified = await verifyNewKeys(data, new Set(), new Set());
  if (!verified.ok) return failure(verified.error);

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("products")
    .insert({
      owner_id: account.accountId,
      title: data.title,
      description: data.description || null,
      price_cents: data.priceCents,
      currency: data.currency,
      status: data.status,
      image_key: data.imageKey ?? null,
      digital_file_key: data.digitalFileKey ?? null,
      track_stock: data.trackStock ?? false,
      // Quantity is only meaningful (and only stored) when tracking is enabled.
      stock_quantity:
        (data.trackStock ?? false) ? (data.stockQuantity ?? null) : null,
      low_stock_threshold: data.lowStockThreshold ?? 5,
      gallery: toJson(data.gallery ?? []),
      option_groups: toJson(data.optionGroups ?? []),
      details: toJson(data.details ?? {}),
      documents: toJson(data.documents ?? []),
      purchase_url: data.purchaseUrl ?? null,
      shipping_profile_id: data.shippingProfileId ?? null,
    })
    .select("id")
    .single();

  if (error || !row) {
    console.error("[products] create failed", error);
    return failure(serverError("create the product"));
  }
  revalidatePath("/products");
  return { ok: true, id: row.id };
}

export async function updateProduct(
  id: string,
  input: unknown,
): Promise<ProductActionResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) {
    return failure(permissionDenied(account.role, "edit products"));
  }
  if (!(await rateLimit("product_write", RATE_LIMITS.productWrite))) {
    return failure(rateLimited("edit products"));
  }
  if (!productIdSchema.safeParse(id).success) {
    return failure(notFound("product"));
  }

  const parsed = parseWrite(account.userId, input);
  if ("error" in parsed) return failure(parsed.error);
  const { data } = parsed;

  const supabase = await createClient();

  // Three-state keys: undefined = keep stored key, null = clear, string = replace.
  const replacingImage = data.imageKey !== undefined;
  const replacingFile = data.digitalFileKey !== undefined;
  const replacingGallery = data.gallery !== undefined;
  const replacingDocuments = data.documents !== undefined;

  // When anything stored in R2 may be replaced, read what the row holds now:
  // the old keys are evicted after a successful write, the stored gallery/
  // documents say which are genuinely new (and need a HEAD check), and the
  // stored options are what a kept-options payload must match.
  let existing: {
    image_key: string | null;
    digital_file_key: string | null;
    gallery: Json;
    option_groups: Json;
    documents: Json;
  } | null = null;
  if (replacingImage || replacingFile || replacingGallery || replacingDocuments) {
    const { data: row, error } = await supabase
      .from("products")
      .select("image_key, digital_file_key, gallery, option_groups, documents")
      .eq("id", id)
      .eq("owner_id", account.accountId)
      .maybeSingle();
    if (error) {
      console.error("[products] pre-save read failed", error);
      return failure(serverError("save the product"));
    }
    if (!row) return failure(notFound("product"));
    existing = row;
  }
  const storedGallery = existing ? parseGallery(existing.gallery) : [];
  const storedGalleryKeys = new Set(storedGallery.map((image) => image.key));
  const storedDocumentKeys = new Set(
    (existing ? parseDocuments(existing.documents) : []).map((document) => document.key),
  );
  const storedOptionIds = collectOptionIds(
    existing ? parseOptionGroups(existing.option_groups) : [],
  );

  if (!galleryMatchesOptions(data, storedOptionIds)) return failure(STALE_OPTION_ERROR);
  const verified = await verifyNewKeys(data, storedGalleryKeys, storedDocumentKeys);
  if (!verified.ok) return failure(verified.error);

  const update: TablesUpdate<"products"> = {
    title: data.title,
    description: data.description || null,
    price_cents: data.priceCents,
    currency: data.currency,
    status: data.status,
  };
  if (replacingImage) update.image_key = data.imageKey;
  if (replacingFile) update.digital_file_key = data.digitalFileKey;
  // Page detail: lists replace whole; absent leaves the stored value alone.
  if (replacingGallery) update.gallery = toJson(data.gallery);
  if (data.optionGroups !== undefined) update.option_groups = toJson(data.optionGroups);
  if (data.details !== undefined) update.details = toJson(data.details);
  if (replacingDocuments) update.documents = toJson(data.documents);
  if (data.purchaseUrl !== undefined) update.purchase_url = data.purchaseUrl;
  if (data.shippingProfileId !== undefined) {
    update.shipping_profile_id = data.shippingProfileId;
  }
  // Three-state stock columns: only written when the field was explicitly
  // included in the payload (undefined = leave the stored value untouched).
  if (data.trackStock !== undefined) {
    update.track_stock = data.trackStock;
    // Turning tracking off clears the quantity — the DB check constraint
    // requires a quantity when tracking, and a stale number is misleading.
    if (!data.trackStock) update.stock_quantity = null;
  }
  if (data.stockQuantity !== undefined) {
    // stockQuantity is nullish in the schema; write the value as-is (the
    // refine already enforced quantity present when trackStock === true).
    update.stock_quantity = data.stockQuantity ?? null;
  }
  if (data.lowStockThreshold !== undefined) {
    update.low_stock_threshold = data.lowStockThreshold;
  }

  const { data: row, error } = await supabase
    .from("products")
    .update(update)
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[products] update failed", error);
    return failure(serverError("save the product"));
  }
  if (!row) return failure(notFound("product"));

  // Evict what the row no longer references: a replaced cover or file, and
  // every photo the new gallery dropped.
  if (existing) {
    const stale: (string | null)[] = [];
    if (replacingImage && existing.image_key !== data.imageKey) {
      stale.push(existing.image_key);
    }
    if (replacingFile && existing.digital_file_key !== data.digitalFileKey) {
      stale.push(existing.digital_file_key);
    }
    if (replacingGallery) {
      const kept = new Set((data.gallery ?? []).map((image) => image.key));
      for (const key of storedGalleryKeys) if (!kept.has(key)) stale.push(key);
    }
    if (replacingDocuments) {
      const kept = new Set((data.documents ?? []).map((document) => document.key));
      for (const key of storedDocumentKeys) if (!kept.has(key)) stale.push(key);
    }
    await evictObjects(stale);
  }

  revalidatePath("/products");
  return { ok: true, id: row.id };
}

export async function deleteProduct(id: string): Promise<ProductActionResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) {
    return failure(permissionDenied(account.role, "delete products"));
  }
  if (!(await rateLimit("product_write", RATE_LIMITS.productWrite))) {
    return failure(rateLimited("delete products"));
  }
  if (!productIdSchema.safeParse(id).success) {
    return failure(notFound("product"));
  }

  const supabase = await createClient();
  // Return the deleted row so we can (a) confirm something was actually removed
  // — a missing/again-someone-else's id matches zero rows, which is NOT success
  // — and (b) evict its R2 objects instead of leaving them orphaned.
  const { data: deleted, error } = await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .select("id, image_key, digital_file_key, gallery, documents")
    .maybeSingle();

  if (error) {
    console.error("[products] delete failed", error);
    return failure(serverError("delete the product"));
  }
  if (!deleted) return failure(notFound("product"));

  await evictObjects([
    deleted.image_key,
    deleted.digital_file_key,
    ...parseGallery(deleted.gallery).map((image) => image.key),
    ...parseDocuments(deleted.documents).map((document) => document.key),
  ]);
  revalidatePath("/products");
  return { ok: true, id };
}

/** Best-effort R2 cleanup — storage cleanup never fails the parent operation. */
async function evictObjects(keys: (string | null | undefined)[]): Promise<void> {
  const present = keys.filter((key): key is string => Boolean(key));
  await Promise.all(
    present.map((key) =>
      deleteObject(key).catch((error) =>
        console.warn("[products] failed to evict object", key, error),
      ),
    ),
  );
}
