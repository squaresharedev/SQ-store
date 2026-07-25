"use server";

import { revalidatePath } from "next/cache";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  embedSettingsSchema,
  parseStoredStorefrontConfig,
  storefrontConfigSchema,
  storefrontIdSchema,
  storefrontNameSchema,
} from "@/lib/validation/storefront";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontConfig,
} from "@/types/storefront";
import {
  failure,
  invalidInput,
  notFound,
  permissionDenied,
  serverError,
  sessionExpired,
  uploadFailed,
  type ActionError,
  type ActionFailure,
} from "@/lib/errors";
import { deleteObject, headObject } from "@/lib/r2";
import {
  isAllowedContentType,
  isOwnedObjectKey,
  maxBytesForKind,
} from "@/lib/validation/product";

// Storefront CRUD for the ACTIVE account's store. A store owns MANY storefronts,
// so every mutation is keyed by row id and scoped to the active account (explicit
// owner_id + RLS). Every write: resolve + authorize the active account
// (storefront.write) -> Zod parse (the security boundary; client validation is UX
// only) -> product-ownership re-check -> account-scoped mutation. RLS re-checks
// the same permission at the DB, so a viewer can never write.
// Failures are structured ActionErrors (lib/errors.ts): message + how to fix.

export type CreateStorefrontResult = { ok: true; id: string } | ActionFailure;

export type SaveStorefrontResult =
  | {
      ok: true;
      /** Blocks removed because their product no longer exists / isn't owned. */
      droppedBlocks: number;
    }
  | ActionFailure;

export type DeleteStorefrontResult = { ok: true } | ActionFailure;

/** Create a fresh, empty storefront and return its id (caller navigates to it). */
export async function createStorefront(
  name?: unknown,
): Promise<CreateStorefrontResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "storefront.write")) {
    return failure(permissionDenied(account.role, "create storefronts"));
  }

  // Name is optional at creation; fall back to a sensible default the seller
  // can rename in the editor.
  const parsedName =
    name === undefined ? null : storefrontNameSchema.safeParse(name);
  const finalName =
    parsedName === null
      ? "Untitled storefront"
      : parsedName.success
        ? parsedName.data
        : "Untitled storefront";

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("storefronts")
    .insert({
      owner_id: account.accountId,
      name: finalName,
      config: DEFAULT_STOREFRONT_CONFIG,
    })
    .select("id")
    .single();

  if (error || !row) {
    console.error("[storefront] create failed", error);
    return failure(serverError("create the storefront"));
  }

  revalidatePath("/storefront");
  return { ok: true, id: row.id };
}

/**
 * Save one storefront's name + grid. Input is `{ name, config }`. The product
 * blocks are re-checked against the caller's OWN products (never trust
 * client-supplied ids); unknown ids are dropped so a product deleted mid-edit
 * doesn't block the save.
 */
export async function saveStorefront(
  id: string,
  input: unknown,
): Promise<SaveStorefrontResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "storefront.write")) {
    return failure(permissionDenied(account.role, "edit storefronts"));
  }
  if (!storefrontIdSchema.safeParse(id).success) {
    return failure(notFound("storefront"));
  }

  const payload = (input ?? {}) as { name?: unknown; config?: unknown };
  const parsedName = storefrontNameSchema.safeParse(payload.name);
  if (!parsedName.success) {
    return failure(
      invalidInput(
        "The storefront needs a name.",
        "Type a name (1 to 80 characters) in the field at the top of the editor, then save again.",
      ),
    );
  }
  const parsed = storefrontConfigSchema.safeParse(payload.config);
  if (!parsed.success) {
    return failure(
      invalidInput(
        "The storefront layout data is invalid.",
        "Refresh the editor and try saving again.",
      ),
    );
  }

  const supabase = await createClient();

  // Ownership check: keep only product blocks whose product exists AND belongs
  // to the caller. Text blocks carry no references and pass through as-parsed.
  let blocks = parsed.data.blocks;
  const productIds = blocks
    .filter((block) => block.type === "product")
    .map((block) => block.productId);
  if (productIds.length > 0) {
    const { data: ownedRows, error } = await supabase
      .from("products")
      .select("id")
      .eq("owner_id", account.accountId)
      .in("id", productIds);
    if (error) {
      console.error("[storefront] ownership check failed", error);
      return failure(serverError("save your storefront"));
    }
    const ownedIds = new Set(ownedRows.map((row) => row.id));
    blocks = blocks.filter(
      (block) => block.type !== "product" || ownedIds.has(block.productId),
    );
  }

  const config: StorefrontConfig = {
    theme: parsed.data.theme,
    // Normalize order to a clean 0..n sequence.
    blocks: blocks
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((block, index) => ({ ...block, order: index })),
    // Optional masthead — only persisted when the client sent one.
    ...(parsed.data.header ? { header: parsed.data.header } : {}),
    // Embed settings ride along validated so a designer save can't wipe what
    // updateEmbedSettings stored (the designer passes its loaded value through).
    ...(parsed.data.embed ? { embed: parsed.data.embed } : {}),
  };

  // Image background: the config stores only the R2 object KEY. A key that
  // differs from the one already saved must be a NEW upload by this user:
  // enforce uploader ownership and re-check the stored object's real
  // size/type (presign-time checks are advisory only). The pre-save read also
  // gives us the old key so a replaced image can be evicted afterwards.
  const nextBackgroundKey =
    config.theme.background.kind === "image"
      ? config.theme.background.key
      : null;
  const { data: existingRow, error: existingError } = await supabase
    .from("storefronts")
    .select("config")
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .maybeSingle();
  if (existingError) {
    console.error("[storefront] pre-save read failed", existingError);
    return failure(serverError("save your storefront"));
  }
  if (!existingRow) return failure(notFound("storefront"));
  const previousBackgroundKey = storedBackgroundKey(existingRow.config);
  if (nextBackgroundKey && nextBackgroundKey !== previousBackgroundKey) {
    if (!isOwnedObjectKey(nextBackgroundKey, "image", account.userId)) {
      return failure(
        invalidInput(
          "That background image can't be used.",
          "Re-upload the image, then save again.",
        ),
      );
    }
    const verified = await verifyBackgroundImage(nextBackgroundKey);
    if (!verified.ok) return failure(verified.error);
  }

  const { data: row, error } = await supabase
    .from("storefronts")
    .update({
      name: parsedName.data,
      config,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[storefront] save failed", error);
    return failure(serverError("save your storefront"));
  }
  if (!row) return failure(notFound("storefront"));

  // Replaced or removed image background: evict the detached object.
  if (previousBackgroundKey && previousBackgroundKey !== nextBackgroundKey) {
    await evictObject(previousBackgroundKey);
  }

  revalidatePath("/storefront");
  revalidatePath(`/storefront/${id}`);
  return {
    ok: true,
    droppedBlocks: parsed.data.blocks.length - config.blocks.length,
  };
}

/** The image-background object key inside a stored (untrusted) config jsonb. */
function storedBackgroundKey(config: unknown): string | null {
  if (typeof config !== "object" || config === null) return null;
  const background = (
    config as { theme?: { background?: { kind?: unknown; key?: unknown } } }
  ).theme?.background;
  return background?.kind === "image" && typeof background.key === "string"
    ? background.key
    : null;
}

/** Best-effort R2 cleanup: never fails the parent operation. */
async function evictObject(key: string): Promise<void> {
  await deleteObject(key).catch((error) =>
    console.warn("[storefront] failed to evict object", key, error),
  );
}

/**
 * Post-upload boundary for a NEW background image key, mirroring the product
 * image rules: the stored object's REAL size and type are checked via HEAD;
 * anything oversized or non-image is evicted and never linked to a config.
 */
async function verifyBackgroundImage(
  key: string,
): Promise<{ ok: true } | { ok: false; error: ActionError }> {
  let meta;
  try {
    meta = await headObject(key);
  } catch (error) {
    console.error("[storefront] background verification failed", error);
    return { ok: false, error: serverError("verify your background image") };
  }
  if (!meta) {
    return {
      ok: false,
      error: uploadFailed(
        "Your background image upload didn't finish.",
        "Select the image again and re-upload it before saving.",
      ),
    };
  }
  const tooBig =
    !Number.isFinite(meta.size) ||
    meta.size <= 0 ||
    meta.size > maxBytesForKind("image");
  const wrongType = !isAllowedContentType("image", meta.contentType);
  if (tooBig || wrongType) {
    await evictObject(key);
    return {
      ok: false,
      error: tooBig
        ? uploadFailed(
            "That background image is too large.",
            "Use an image under 10 MB, then re-upload it.",
          )
        : uploadFailed(
            "That file type is not supported.",
            "Use a JPEG, PNG, WebP, GIF, or AVIF image.",
          ),
    };
  }
  return { ok: true };
}

export type UpdateEmbedSettingsResult = { ok: true } | ActionFailure;

/**
 * Save one storefront's embed-widget settings (enabled flag + domain
 * allowlist). They live inside the config jsonb (the table has no dedicated
 * columns), so this is a read-modify-write scoped to the owner: only the
 * `embed` member changes; theme/blocks/header pass through untouched. A
 * concurrent designer save can win the race — acceptable for now, both writes
 * are fully validated and last-write-wins.
 */
export async function updateEmbedSettings(
  id: string,
  input: unknown,
): Promise<UpdateEmbedSettingsResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "storefront.write")) {
    return failure(permissionDenied(account.role, "edit storefronts"));
  }
  if (!storefrontIdSchema.safeParse(id).success) {
    return failure(notFound("storefront"));
  }

  // The security boundary: strict shape, hostname-regex-gated domains.
  const parsed = embedSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      invalidInput(
        parsed.error.issues[0]?.message ?? "Invalid embed settings.",
        "Check the domain list (comma-separated hostnames like example.com) and save again.",
      ),
    );
  }

  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("storefronts")
    .select("config")
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .maybeSingle();
  if (readError) {
    console.error("[storefront] embed settings read failed", readError);
    return failure(serverError("save the embed settings"));
  }
  if (!row) return failure(notFound("storefront"));

  const config: StorefrontConfig = {
    ...(parseStoredStorefrontConfig(row.config) ?? DEFAULT_STOREFRONT_CONFIG),
    embed: parsed.data,
  };

  const { data: updated, error } = await supabase
    .from("storefronts")
    .update({ config, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[storefront] embed settings save failed", error);
    return failure(serverError("save the embed settings"));
  }
  if (!updated) return failure(notFound("storefront"));

  revalidatePath("/storefront");
  return { ok: true };
}

/** Delete one storefront. Its orders are detached (FK on delete set null). */
export async function deleteStorefront(
  id: string,
): Promise<DeleteStorefrontResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "storefront.write")) {
    return failure(permissionDenied(account.role, "delete storefronts"));
  }
  if (!storefrontIdSchema.safeParse(id).success) {
    return failure(notFound("storefront"));
  }

  const supabase = await createClient();
  // Return the deleted row so a missing/again-someone-else's id (zero rows) is
  // reported as failure, not silent success.
  const { data: deleted, error } = await supabase
    .from("storefronts")
    .delete()
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .select("id, config")
    .maybeSingle();

  if (error) {
    console.error("[storefront] delete failed", error);
    return failure(serverError("delete the storefront"));
  }
  if (!deleted) return failure(notFound("storefront"));

  // Evict the image background object (if any) along with its storefront.
  const backgroundKey = storedBackgroundKey(deleted.config);
  if (backgroundKey) await evictObject(backgroundKey);

  revalidatePath("/storefront");
  return { ok: true };
}
