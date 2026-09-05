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
import { parseStorefrontBrief } from "@/lib/validation/storefront-brief";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
  DEFAULT_STOREFRONT_HEADER,
  type StorefrontConfig,
} from "@/types/storefront";
import type { StorefrontBrief } from "@/types/storefront-brief";
import { themeForVibe } from "@/lib/storefront/presets";
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
  type ActionFailure,
} from "@/lib/errors";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import {
  listStorefronts,
  type StorefrontsPage,
} from "@/lib/storefront/queries";
import { deleteObject, headObject } from "@/lib/r2";
import {
  isAllowedContentType,
  isOwnedObjectKey,
  maxBytesForKind,
  type UploadKind,
} from "@/lib/validation/product";

// Storefront CRUD for the ACTIVE account's store. A store owns MANY storefronts,
// so every mutation is keyed by row id and scoped to the active account (explicit
// owner_id + RLS). Every write: resolve + authorize the active account
// (storefront.write) -> Zod parse (the security boundary; client validation is UX
// only) -> product-ownership re-check -> account-scoped mutation. RLS re-checks
// the same permission at the DB, so a viewer can never write.
// Failures are structured ActionErrors (lib/errors.ts): message + how to fix.

export type CreateStorefrontResult = { ok: true; id: string } | ActionFailure;

/** What the creation flow sends. Both halves are optional: the seller can skip
 *  the flow entirely and still get a storefront. */
export type CreateStorefrontInput = {
  name?: string;
  brief?: StorefrontBrief;
};

export type SaveStorefrontResult =
  | {
      ok: true;
      /** Blocks removed because their product no longer exists / isn't owned. */
      droppedBlocks: number;
    }
  | ActionFailure;

export type DeleteStorefrontResult = { ok: true } | ActionFailure;

/**
 * Create a storefront and return its id (the caller navigates to it).
 *
 * Takes what the creation flow collected: an optional name, and an optional
 * brief describing the store. The brief is stored for the template recommender
 * (lib/storefront/templates.ts) and its `vibe` also does immediate work, by
 * selecting the theme the new storefront starts on.
 *
 * Nothing here is required. Skipping the flow, or abandoning it halfway, gives
 * exactly the storefront this action produced before the flow existed: default
 * theme, default name, empty brief.
 */
export async function createStorefront(
  input?: unknown,
): Promise<CreateStorefrontResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "storefront.write")) {
    return failure(permissionDenied(account.role, "create storefronts"));
  }
  if (!(await rateLimit("storefront_write", RATE_LIMITS.storefrontWrite))) {
    return failure(rateLimited("create storefronts"));
  }

  const payload: { name?: unknown; brief?: unknown } =
    typeof input === "object" && input !== null
      ? (input as { name?: unknown; brief?: unknown })
      : {};

  // Name is optional at creation; fall back to a sensible default the seller
  // can rename in the editor.
  const parsedName = storefrontNameSchema.safeParse(payload.name);
  const baseName = parsedName.success ? parsedName.data : "Untitled storefront";

  // Same forgiveness for the brief: it is a hint for a recommender, never
  // load-bearing, so a malformed one degrades to empty rather than costing the
  // seller their storefront.
  const brief = parseStorefrontBrief(payload.brief);

  const supabase = await createClient();

  // SF-03: Deduplicate storefront names within the same account. If "Foo"
  // already exists we create "Foo 2", then "Foo 3", etc. The SELECT is cheap
  // (names are short) and the LIKE is against a bounded owner_id set.
  const { data: existingNames } = await supabase
    .from("storefronts")
    .select("name")
    .eq("owner_id", account.accountId)
    .like("name", `${baseName}%`);

  const takenNames = new Set((existingNames ?? []).map((r) => r.name));
  let finalName = baseName;
  if (takenNames.has(baseName)) {
    let n = 2;
    while (takenNames.has(`${baseName} ${n}`)) n++;
    finalName = `${baseName} ${n}`;
  }

  // SF-03: Seed the buyer-facing header name from the wizard name so the two
  // are in sync from the moment the storefront is created.
  const initialHeader: typeof DEFAULT_STOREFRONT_HEADER = {
    ...DEFAULT_STOREFRONT_HEADER,
    name: finalName,
  };

  // SF-04: New storefronts allow indexing by default. The constant
  // DEFAULT_PRODUCT_PAGE_CONFIG keeps allowIndexing:false so that existing
  // storefronts loaded without a persisted productPage stay noindexed (no
  // silent flip). Only rows created here get the true default.
  //
  // SF-06: A digital fulfilment storefront sells downloads -- no physical
  // shipment, so pre-set the shipping note accordingly rather than surfacing
  // a "plus shipping" line that would mislead buyers.
  const initialProductPage = {
    ...DEFAULT_PRODUCT_PAGE_CONFIG,
    allowIndexing: true,
    ...(brief.fulfilment === "digital"
      ? { shippingNote: "free-shipping" as const }
      : {}),
  };

  const { data: row, error } = await supabase
    .from("storefronts")
    .insert({
      owner_id: account.accountId,
      name: finalName,
      config: {
        ...DEFAULT_STOREFRONT_CONFIG,
        theme: themeForVibe(brief.vibe),
        header: initialHeader,
        productPage: initialProductPage,
      },
      brief,
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
  if (!(await rateLimit("storefront_write", RATE_LIMITS.storefrontWrite))) {
    return failure(rateLimited("save storefronts"));
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
    // Blocks carry their own coordinates: the schema already verified they sit
    // inside the canvas and don't overlap, so array order is irrelevant.
    blocks,
    // Optional masthead — only persisted when the client sent one.
    ...(parsed.data.header ? { header: parsed.data.header } : {}),
    // Embed settings ride along validated so a designer save can't wipe what
    // updateEmbedSettings stored (the designer passes its loaded value through).
    ...(parsed.data.embed ? { embed: parsed.data.embed } : {}),
    // The product page's options: plain data the schema has already bounded,
    // persisted only when the client sent it. No `seller`, `policies` or
    // `shippingProfiles` here — trader identity and the shipping/returns terms
    // (including the named profiles products point at by id) are both
    // account-level now, written by Settings and never by a designer save
    // (lib/settings/seller-identity.ts, lib/settings/shipping-actions.ts).
    // That separation is the point: a storefront save can no longer touch the
    // terms every OTHER storefront is also selling under.
    ...(parsed.data.productPage ? { productPage: parsed.data.productPage } : {}),
  };

  // Uploaded assets (image background, custom font): the config stores only the
  // R2 object KEY. A key that differs from the one already saved must be a NEW
  // upload by this user: enforce uploader ownership and re-check the stored
  // object's real size/type (upload-time checks alone are not a boundary). The
  // pre-save read also gives us the old keys, so replaced objects can be
  // evicted afterwards.
  const nextBackgroundKey =
    config.theme.background.kind === "image"
      ? config.theme.background.key
      : null;
  const nextFontKey = config.theme.customFont?.key ?? null;
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
  const previousFontKey = storedFontKey(existingRow.config);
  if (nextBackgroundKey && nextBackgroundKey !== previousBackgroundKey) {
    const verified = await verifyUpload(
      nextBackgroundKey,
      "image",
      account.userId,
    );
    if (!verified.ok) return failure(verified.error);
  }
  if (nextFontKey && nextFontKey !== previousFontKey) {
    const verified = await verifyUpload(nextFontKey, "font", account.userId);
    if (!verified.ok) return failure(verified.error);
  }

  // Elements are the one upload a config can hold MANY of, so this is a set
  // difference rather than a pair of scalars. Only keys that are new to this
  // storefront are verified: re-saving an untouched canvas costs no HEAD
  // requests at all, however many elements it carries.
  const previousElementKeys = storedElementKeys(existingRow.config);
  const nextElementKeys = new Set(
    config.blocks.flatMap((block) => (block.type === "image" ? [block.key] : [])),
  );
  const newElementKeys = [...nextElementKeys].filter(
    (key) => !previousElementKeys.has(key),
  );
  // One HEAD each, so a crafted client must not be able to turn a single save
  // into MAX_BLOCKS round-trips to R2. The designer uploads one element at a
  // time, so this ceiling is far above anything the UI can produce.
  if (newElementKeys.length > MAX_NEW_ELEMENT_KEYS_PER_SAVE) {
    return failure(
      invalidInput(
        "Too many new images in one save.",
        "Save your storefront, then add the rest.",
      ),
    );
  }
  for (const key of newElementKeys) {
    const verified = await verifyUpload(key, "element", account.userId);
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

  // Replaced or removed uploads: evict the detached objects.
  if (previousBackgroundKey && previousBackgroundKey !== nextBackgroundKey) {
    await evictObject(previousBackgroundKey);
  }
  if (previousFontKey && previousFontKey !== nextFontKey) {
    await evictObject(previousFontKey);
  }
  for (const key of previousElementKeys) {
    if (!nextElementKeys.has(key)) await evictObject(key);
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

/** The uploaded-font object key inside a stored (untrusted) config jsonb. */
function storedFontKey(config: unknown): string | null {
  if (typeof config !== "object" || config === null) return null;
  const font = (config as { theme?: { customFont?: { key?: unknown } } }).theme
    ?.customFont;
  return typeof font?.key === "string" ? font.key : null;
}

/**
 * Every element object key inside a stored (untrusted) config jsonb.
 *
 * A Set rather than a list, and read defensively field by field, because this
 * runs against whatever is already in the column — including a config written
 * before image blocks existed, or one whose shape no longer parses.
 */
function storedElementKeys(config: unknown): Set<string> {
  const keys = new Set<string>();
  if (typeof config !== "object" || config === null) return keys;
  const blocks = (config as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return keys;
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const candidate = block as { type?: unknown; key?: unknown };
    if (candidate.type === "image" && typeof candidate.key === "string") {
      keys.add(candidate.key);
    }
  }
  return keys;
}

/** How many NEW element uploads one save may introduce. See the call site. */
const MAX_NEW_ELEMENT_KEYS_PER_SAVE = 10;

/** Best-effort R2 cleanup: never fails the parent operation. */
async function evictObject(key: string): Promise<void> {
  await deleteObject(key).catch((error) =>
    console.warn("[storefront] failed to evict object", key, error),
  );
}

/** What each verifiable upload is called and what a rejection tells the seller
 *  to do about it. Keeps {@link verifyUpload} one function rather than two
 *  copies that drift on everything except the noun. */
const UPLOAD_COPY = {
  image: {
    noun: "background image",
    missing: "Select the image again and re-upload it before saving.",
    tooBig: {
      message: "That background image is too large.",
      fix: "Use an image under 10 MB, then re-upload it.",
    },
    wrongType: {
      message: "That file type is not supported.",
      fix: "Use a JPEG, PNG, WebP, GIF, or AVIF image.",
    },
  },
  font: {
    noun: "font",
    missing: "Select the font again and re-upload it before saving.",
    tooBig: {
      message: "That font file is too large.",
      fix: "Use a font under 2 MB. A WOFF2 is usually well under 100 KB.",
    },
    wrongType: {
      message: "That file type is not supported.",
      fix: "Use a WOFF2, WOFF, TTF, or OTF font file.",
    },
  },
  element: {
    noun: "image",
    missing: "Add the image again and re-upload it before saving.",
    tooBig: {
      message: "That image is too large.",
      fix: "Use an image under 2 MB, then add it again.",
    },
    wrongType: {
      message: "That file type is not supported.",
      fix:
        "Use a PNG, JPEG, WebP, GIF, AVIF, or an SVG with no scripts, " +
        "external links, or embedded images.",
    },
  },
} as const satisfies Partial<Record<UploadKind, unknown>>;

/**
 * Post-upload boundary for a NEW object key on a config, mirroring the product
 * image rules: the key must be one this user uploaded, and the stored object's
 * REAL size and type are checked via HEAD. Anything oversized or of the wrong
 * type is evicted and never linked to a config.
 */
async function verifyUpload(
  key: string,
  kind: keyof typeof UPLOAD_COPY,
  uploaderId: string,
): Promise<{ ok: true } | { ok: false; error: ActionError }> {
  const copy = UPLOAD_COPY[kind];
  if (!isOwnedObjectKey(key, kind, uploaderId)) {
    return {
      ok: false,
      error: invalidInput(`That ${copy.noun} can't be used.`, copy.missing),
    };
  }

  let meta;
  try {
    meta = await headObject(key);
  } catch (error) {
    console.error(`[storefront] ${kind} verification failed`, error);
    return { ok: false, error: serverError(`verify your ${copy.noun}`) };
  }
  if (!meta) {
    return {
      ok: false,
      error: uploadFailed(
        `Your ${copy.noun} upload didn't finish.`,
        copy.missing,
      ),
    };
  }
  const tooBig =
    !Number.isFinite(meta.size) ||
    meta.size <= 0 ||
    meta.size > maxBytesForKind(kind);
  const wrongType = !isAllowedContentType(kind, meta.contentType);
  if (tooBig || wrongType) {
    await evictObject(key);
    const reason = tooBig ? copy.tooBig : copy.wrongType;
    return { ok: false, error: uploadFailed(reason.message, reason.fix) };
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
  if (!(await rateLimit("storefront_write", RATE_LIMITS.storefrontWrite))) {
    return failure(rateLimited("save storefronts"));
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
  if (!(await rateLimit("storefront_write", RATE_LIMITS.storefrontWrite))) {
    return failure(rateLimited("delete storefronts"));
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

  // Evict this storefront's uploaded objects (background, font) along with it.
  const backgroundKey = storedBackgroundKey(deleted.config);
  if (backgroundKey) await evictObject(backgroundKey);
  const fontKey = storedFontKey(deleted.config);
  if (fontKey) await evictObject(fontKey);
  for (const key of storedElementKeys(deleted.config)) await evictObject(key);

  revalidatePath("/storefront");
  return { ok: true };
}

export type RotateEmbedKeyResult = { ok: true; embedKey: string } | ActionFailure;

/**
 * Mint a NEW embed key for a storefront, invalidating every snippet already
 * pasted elsewhere.
 *
 * This is the revoke button for embedding: the key is public by design (it
 * lives in someone else's HTML), so the only meaningful response to "it ended
 * up somewhere I didn't intend" is to change it. Deliberately destructive —
 * the caller confirms first, because every legitimate embed breaks too and
 * each host has to be re-pasted.
 *
 * The new key is generated by the DATABASE (gen_random_uuid via the column
 * default is not reachable from an UPDATE, so it is generated here and the
 * unique index is what guarantees no collision survives).
 */
export async function rotateEmbedKey(id: string): Promise<RotateEmbedKeyResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "storefront.write")) {
    return failure(permissionDenied(account.role, "edit storefronts"));
  }
  if (!storefrontIdSchema.safeParse(id).success) {
    return failure(notFound("storefront"));
  }
  if (!(await rateLimit("storefront_write", RATE_LIMITS.storefrontWrite))) {
    return failure(rateLimited("rotate embed keys"));
  }

  const embedKey = crypto.randomUUID();
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("storefronts")
    .update({ embed_key: embedKey, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", account.accountId)
    .select("embed_key")
    .maybeSingle();

  if (error) {
    console.error("[storefront] embed key rotation failed", error);
    return failure(serverError("rotate the embed key"));
  }
  if (!row) return failure(notFound("storefront"));

  revalidatePath("/storefront");
  return { ok: true, embedKey: row.embed_key };
}

/**
 * One further page of storefront summaries, for the list's "Load more".
 * Read-only: listStorefronts scopes to the active account and clamps the
 * offset. Exists because the list seeds one bounded page (each row carries a
 * full Zod-parsed config); past the bound the UI shows "Showing X of N" and
 * loads the rest on demand instead of silently hiding the oldest storefronts.
 */
export async function fetchStorefrontsPage(
  offset: number,
): Promise<StorefrontsPage> {
  return listStorefronts(Math.max(0, Math.trunc(offset)));
}
