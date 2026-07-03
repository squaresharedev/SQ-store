"use server";

import { revalidatePath } from "next/cache";
import type { User } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { deleteObject, headObject } from "@/lib/r2";
import type { TablesUpdate } from "@/types";
import {
  isAllowedContentType,
  isOwnedObjectKey,
  maxBytesForKind,
  productIdSchema,
  productWriteSchema,
  type ProductWriteInput,
  type UploadKind,
} from "@/lib/validation/product";

// Product CRUD. Every write: session check -> Zod parse (the security
// boundary; client validation is UX only) -> object-key ownership check ->
// owner-scoped mutation. RLS enforces ownership at the DB as well; the
// explicit owner_id here is defense in depth.

export type ProductActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const GENERIC_WRITE_ERROR = "Could not save the product. Try again.";

/**
 * Parse + authorize a write payload. Returns the validated input or an error
 * result. Keys must be well-formed and live under the caller's own R2 prefix.
 */
function parseWrite(
  user: User,
  input: unknown,
): { data: ProductWriteInput } | { error: string } {
  const parsed = productWriteSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid product data." };
  const { imageKey, digitalFileKey } = parsed.data;
  if (imageKey && !isOwnedObjectKey(imageKey, "image", user.id)) {
    return { error: "Invalid image reference." };
  }
  if (digitalFileKey && !isOwnedObjectKey(digitalFileKey, "file", user.id)) {
    return { error: "Invalid file reference." };
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  const noun = KIND_NOUN[kind];
  let meta;
  try {
    meta = await headObject(key);
  } catch (error) {
    console.error("[products] object verification failed", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  if (!meta) {
    return { ok: false, error: `Your ${noun} upload did not finish. Try again.` };
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
        ? `That ${noun} is too large.`
        : "That file type is not supported.",
    };
  }
  return { ok: true };
}

/** Verify every newly-set object key on a write (skips keep/clear states). */
async function verifyNewKeys(
  data: ProductWriteInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const checks: Promise<{ ok: true } | { ok: false; error: string }>[] = [];
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
  const user = await getUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };

  const parsed = parseWrite(user, input);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const { data } = parsed;

  const verified = await verifyNewKeys(data);
  if (!verified.ok) return { ok: false, error: verified.error };

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("products")
    .insert({
      owner_id: user.id,
      title: data.title,
      description: data.description || null,
      price_cents: data.priceCents,
      currency: data.currency,
      status: data.status,
      image_key: data.imageKey ?? null,
      digital_file_key: data.digitalFileKey ?? null,
    })
    .select("id")
    .single();

  if (error || !row) {
    console.error("[products] create failed", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  revalidatePath("/products");
  return { ok: true, id: row.id };
}

export async function updateProduct(
  id: string,
  input: unknown,
): Promise<ProductActionResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };
  if (!productIdSchema.safeParse(id).success) {
    return { ok: false, error: "Product not found." };
  }

  const parsed = parseWrite(user, input);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const { data } = parsed;

  const verified = await verifyNewKeys(data);
  if (!verified.ok) return { ok: false, error: verified.error };

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
      .eq("owner_id", user.id)
      .maybeSingle();
    oldKeys = existing ?? null;
  }

  const { data: row, error } = await supabase
    .from("products")
    .update(update)
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[products] update failed", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  if (!row) return { ok: false, error: "Product not found." };

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
  const user = await getUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };
  if (!productIdSchema.safeParse(id).success) {
    return { ok: false, error: "Product not found." };
  }

  const supabase = await createClient();
  // Return the deleted row so we can (a) confirm something was actually removed
  // — a missing/again-someone-else's id matches zero rows, which is NOT success
  // — and (b) evict its R2 objects instead of leaving them orphaned.
  const { data: deleted, error } = await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id, image_key, digital_file_key")
    .maybeSingle();

  if (error) {
    console.error("[products] delete failed", error);
    return { ok: false, error: "Could not delete the product. Try again." };
  }
  if (!deleted) return { ok: false, error: "Product not found." };

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
