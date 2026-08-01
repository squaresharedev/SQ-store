"use server";

import { revalidatePath } from "next/cache";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { createClient } from "@/lib/supabase/server";
import { deleteObject, headObject } from "@/lib/r2";
import type { TablesUpdate } from "@/types";
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
  isAllowedContentType,
  isOwnedObjectKey,
  maxBytesForKind,
  productIdSchema,
  productWriteSchema,
  type ProductWriteInput,
  type UploadKind,
} from "@/lib/validation/product";

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
  return { data: parsed.data };
}

const KIND_NOUN: Record<UploadKind, string> = { image: "image", file: "file" };

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
              : "Use a ZIP, PDF, EPUB, MP3, WAV, MP4, JPEG, PNG, WebP, or TXT file.",
          ),
    };
  }
  return { ok: true };
}

/** Verify every newly-set object key on a write (skips keep/clear states). */
async function verifyNewKeys(
  data: ProductWriteInput,
): Promise<{ ok: true } | { ok: false; error: ActionError }> {
  const checks: Promise<{ ok: true } | { ok: false; error: ActionError }>[] =
    [];
  if (typeof data.imageKey === "string") {
    checks.push(verifyUploadedObject(data.imageKey, "image"));
  }
  if (typeof data.digitalFileKey === "string") {
    checks.push(verifyUploadedObject(data.digitalFileKey, "file"));
  }
  const failure = (await Promise.all(checks)).find((result) => !result.ok);
  return failure ?? { ok: true };
}

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

  const verified = await verifyNewKeys(data);
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

  const verified = await verifyNewKeys(data);
  if (!verified.ok) return failure(verified.error);

  const update: TablesUpdate<"products"> = {
    title: data.title,
    description: data.description || null,
    price_cents: data.priceCents,
    currency: data.currency,
    status: data.status,
  };
  // Three-state keys: undefined = keep stored key, null = clear, string = replace.
  const replacingImage = data.imageKey !== undefined;
  const replacingFile = data.digitalFileKey !== undefined;
  if (replacingImage) update.image_key = data.imageKey;
  if (replacingFile) update.digital_file_key = data.digitalFileKey;
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

  const supabase = await createClient();

  // If a stored file is being replaced or cleared, read the old keys first so
  // the now-detached R2 objects can be evicted after a successful write.
  let oldKeys: { image_key: string | null; digital_file_key: string | null } | null =
    null;
  if (replacingImage || replacingFile) {
    const { data: existing } = await supabase
      .from("products")
      .select("image_key, digital_file_key")
      .eq("id", id)
      .eq("owner_id", account.accountId)
      .maybeSingle();
    oldKeys = existing ?? null;
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

  if (oldKeys) {
    const stale: (string | null)[] = [];
    if (replacingImage && oldKeys.image_key !== data.imageKey) {
      stale.push(oldKeys.image_key);
    }
    if (replacingFile && oldKeys.digital_file_key !== data.digitalFileKey) {
      stale.push(oldKeys.digital_file_key);
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
    .select("id, image_key, digital_file_key")
    .maybeSingle();

  if (error) {
    console.error("[products] delete failed", error);
    return failure(serverError("delete the product"));
  }
  if (!deleted) return failure(notFound("product"));

  await evictObjects([deleted.image_key, deleted.digital_file_key]);
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
