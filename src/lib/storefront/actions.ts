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

// Storefront CRUD for the ACTIVE account's store. A store owns MANY storefronts,
// so every mutation is keyed by row id and scoped to the active account (explicit
// owner_id + RLS). Every write: resolve + authorize the active account
// (storefront.write) -> Zod parse (the security boundary; client validation is UX
// only) -> product-ownership re-check -> account-scoped mutation. RLS re-checks
// the same permission at the DB, so a viewer can never write.

const SESSION_ERROR = "Your session expired. Sign in again.";
const NOT_FOUND = "Storefront not found.";
const NO_WRITE_PERMISSION =
  "You don't have permission to edit the storefront in this store.";

export type CreateStorefrontResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type SaveStorefrontResult =
  | {
      ok: true;
      /** Blocks removed because their product no longer exists / isn't owned. */
      droppedBlocks: number;
    }
  | { ok: false; error: string };

export type DeleteStorefrontResult =
  | { ok: true }
  | { ok: false; error: string };

/** Create a fresh, empty storefront and return its id (caller navigates to it). */
export async function createStorefront(
  name?: unknown,
): Promise<CreateStorefrontResult> {
  const account = await getActiveAccount();
  if (!account) return { ok: false, error: SESSION_ERROR };
  if (!can(account.role, "storefront.write")) {
    return { ok: false, error: NO_WRITE_PERMISSION };
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
    return { ok: false, error: "Could not create the storefront. Try again." };
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
  if (!account) return { ok: false, error: SESSION_ERROR };
  if (!can(account.role, "storefront.write")) {
    return { ok: false, error: NO_WRITE_PERMISSION };
  }
  if (!storefrontIdSchema.safeParse(id).success) {
    return { ok: false, error: NOT_FOUND };
  }

  const payload = (input ?? {}) as { name?: unknown; config?: unknown };
  const parsedName = storefrontNameSchema.safeParse(payload.name);
  if (!parsedName.success) {
    return { ok: false, error: "Give your storefront a name (1 to 80 characters)." };
  }
  const parsed = storefrontConfigSchema.safeParse(payload.config);
  if (!parsed.success) {
    return { ok: false, error: "Invalid storefront configuration." };
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
      return { ok: false, error: "Could not save your storefront. Try again." };
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
    return { ok: false, error: "Could not save your storefront. Try again." };
  }
  if (!row) return { ok: false, error: NOT_FOUND };

  revalidatePath("/storefront");
  revalidatePath(`/storefront/${id}`);
  return {
    ok: true,
    droppedBlocks: parsed.data.blocks.length - config.blocks.length,
  };
}

export type UpdateEmbedSettingsResult =
  | { ok: true }
  | { ok: false; error: string };

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
  if (!account) return { ok: false, error: SESSION_ERROR };
  if (!can(account.role, "storefront.write")) {
    return { ok: false, error: NO_WRITE_PERMISSION };
  }
  if (!storefrontIdSchema.safeParse(id).success) {
    return { ok: false, error: NOT_FOUND };
  }

  // The security boundary: strict shape, hostname-regex-gated domains.
  const parsed = embedSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid embed settings.",
    };
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
    return { ok: false, error: "Could not save embed settings. Try again." };
  }
  if (!row) return { ok: false, error: NOT_FOUND };

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
    return { ok: false, error: "Could not save embed settings. Try again." };
  }
  if (!updated) return { ok: false, error: NOT_FOUND };

  revalidatePath("/storefront");
  return { ok: true };
}

/** Delete one storefront. Its orders are detached (FK on delete set null). */
export async function deleteStorefront(
  id: string,
): Promise<DeleteStorefrontResult> {
  const account = await getActiveAccount();
  if (!account) return { ok: false, error: SESSION_ERROR };
  if (!can(account.role, "storefront.write")) {
    return { ok: false, error: NO_WRITE_PERMISSION };
  }
  if (!storefrontIdSchema.safeParse(id).success) {
    return { ok: false, error: NOT_FOUND };
  }

  const supabase = await createClient();
  // Return the deleted row so a missing/again-someone-else's id (zero rows) is
  // reported as failure, not silent success.
  const { data: deleted, error } = await supabase
    .from("storefronts")
    .delete()
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[storefront] delete failed", error);
    return { ok: false, error: "Could not delete the storefront. Try again." };
  }
  if (!deleted) return { ok: false, error: NOT_FOUND };

  revalidatePath("/storefront");
  return { ok: true };
}
