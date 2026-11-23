// SERVER ONLY. What a storefront save does for the layout workstream's
// fields (bands, the header's logo and menu, buttons), called from
// saveStorefront (lib/storefront/actions.ts) as a few thin hooks:
//
//   - the bands are carried into the stored config (the save builds it field
//     by field, so a member it does not name is dropped);
//   - a link to ANOTHER STOREFRONT must name one of this store's own: a button
//     or menu entry that names any other is dropped, the way a product block
//     naming someone else's product is;
//   - a link to a PRODUCT the save has just dropped (not this store's, or
//     deleted while the editor was open), as a product block or from a
//     carousel, is dropped with it unless the board still shows that product
//     somewhere else. The schema refuses a link to a product the board does
//     not show, so storing one would leave a config that could not be read
//     back;
//   - band photos are uploads like the background (an `images/` key): a key
//     new to this storefront is verified (ownership, real size and type), and
//     one the save lets go of is evicted once the row is written;
//   - the header logo is an element like an image block's, so its key joins
//     the element keys the save already verifies and evicts.

import { serverError, type ActionError } from "@/lib/errors";
import { storedPagePhotoKeys, verifyUpload } from "@/lib/storefront/uploads";
import { bandPhotoKeys } from "@/lib/storefront/bands";
import { liveHeaderLinks, withoutDeadLinks } from "@/lib/storefront/layout-blocks";
import type { createClient } from "@/lib/supabase/server";
import type { StorefrontBand, StorefrontConfig } from "@/types/storefront";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Carry the bands into the config being saved, and hold every storefront link
 * to this store's own storefronts (dropping a button or menu entry that names
 * another). Edits `config` in place, which is the one the save then writes.
 */
export async function settleLayout(
  supabase: Supabase,
  ownerId: string,
  config: StorefrontConfig,
  bands: StorefrontBand[] | undefined,
): Promise<{ ok: true } | { ok: false; error: ActionError }> {
  if (bands && bands.length > 0) config.bands = bands;

  // After the save's own ownership check has had its say over the product
  // blocks: what is left of the board decides which links still lead somewhere.
  config.blocks = withoutDeadLinks(config.blocks, config.bands ?? []);
  if (config.header?.links) {
    const live = liveHeaderLinks(config.header.links, config.blocks, config.bands ?? []) ?? [];
    if (live.length !== config.header.links.length) {
      const { links: _links, ...rest } = config.header;
      void _links;
      config.header = live.length > 0 ? { ...rest, links: live } : rest;
    }
  }

  const named = new Set<string>();
  for (const block of config.blocks) if (block.type === "button" && block.link.kind === "storefront") named.add(block.link.storefrontId);
  for (const entry of config.header?.links ?? []) if (entry.link.kind === "storefront") named.add(entry.link.storefrontId);
  if (named.size === 0) return { ok: true };

  const { data, error } = await supabase
    .from("storefronts")
    .select("id")
    .eq("owner_id", ownerId)
    .in("id", [...named]);
  if (error) {
    console.error("[storefront] linked storefront check failed", error);
    return { ok: false, error: serverError("saveStorefront") };
  }
  const own = new Set((data ?? []).map((row) => row.id));
  const ours = (link: { kind: string; storefrontId?: string }) => link.kind !== "storefront" || own.has(link.storefrontId ?? "");
  config.blocks = config.blocks.filter((block) => block.type !== "button" || ours(block.link));
  if (config.header?.links) {
    const kept = config.header.links.filter((entry) => ours(entry.link));
    if (kept.length !== config.header.links.length) {
      const { links: _links, ...rest } = config.header;
      void _links;
      config.header = kept.length > 0 ? { ...rest, links: kept } : rest;
    }
  }
  return { ok: true };
}

/** The header logo's key inside a stored (untrusted) config jsonb, if any. */
export function storedLogoKey(config: unknown): string | null {
  if (typeof config !== "object" || config === null) return null;
  const key = (config as { header?: { logo?: { key?: unknown } } }).header?.logo?.key;
  return typeof key === "string" ? key : null;
}

/** Fold the header logo into a set of element keys (it is uploaded and
 *  stored exactly like an image block's artwork). */
export function addLogoKey(keys: Set<string>, config: unknown): void {
  const key = storedLogoKey(config);
  if (key) keys.add(key);
}

/** The band photo keys inside a stored (untrusted) config jsonb. */
function storedBandPhotoKeys(config: unknown): Set<string> {
  const keys = new Set<string>();
  if (typeof config !== "object" || config === null) return keys;
  const bands = (config as { bands?: unknown }).bands;
  if (!Array.isArray(bands)) return keys;
  for (const band of bands) {
    const background = (band as { background?: { kind?: unknown; key?: unknown } } | null)?.background;
    if (background?.kind === "image" && typeof background.key === "string") keys.add(background.key);
  }
  return keys;
}

/**
 * Settle a save's band photos against what was stored: verify each key new to
 * this storefront, and report the keys it lets go of (never one the new
 * config still holds as its background or a page photo). Eviction is the
 * caller's, after the row is written, so a refused save costs nothing.
 */
export async function settleBandPhotos(
  previousConfig: unknown,
  nextConfig: StorefrontConfig,
  uploaderId: string,
): Promise<{ ok: true; released: string[] } | { ok: false; error: ActionError }> {
  const previous = storedBandPhotoKeys(previousConfig);
  const next = new Set(bandPhotoKeys(nextConfig.bands));
  for (const key of next) {
    if (previous.has(key)) continue;
    const verified = await verifyUpload(key, "image", uploaderId);
    if (!verified.ok) return verified;
  }
  const stillHeld = storedPagePhotoKeys(nextConfig);
  if (nextConfig.theme.background.kind === "image") stillHeld.add(nextConfig.theme.background.key);
  return { ok: true, released: [...previous].filter((key) => !next.has(key) && !stillHeld.has(key)) };
}
