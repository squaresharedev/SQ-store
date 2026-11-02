// SERVER ONLY. A storefront as its owner's assistant previews it: the same page
// data the public page draws (lib/storefront/storefront-page.ts), built by the
// same tile and image functions, but read AS THE GRANT, under row level
// security, rather than through the buyer gate:
//
//   - the storefront is read with getStorefront, which only finds this store's;
//   - its products are read with the grant's own client, so RLS decides which
//     exist for this caller. A draft is drawn (the owner is previewing their
//     own design) and listed in `notes`, because a buyer would not see it;
//   - prices go through the public pricing functions, for the same store;
//   - nothing is gated on being published: what would keep the page from buyers
//     is reported instead, so the assistant can say what is missing.

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadProductSales, readStoreSales, salesCovering } from "@/lib/discounts/public";
import { emailProofRequired } from "@/lib/contact-verification/availability";
import { toCurrency } from "@/lib/format/money";
import { isContentVisible } from "@/lib/moderation/removal";
import {
  TRADER_GATE_SELECT,
  buildSellerIdentity,
  buildTraderIdentityInput,
  type SellerIdentityRow,
  type TraderGateRow,
} from "@/lib/settings/seller-identity";
import { isTraderIdentityComplete } from "@/lib/settings/trader-identity";
import { resolveProductPage } from "@/lib/storefront/product-page";
import { productPagePath, storefrontPageUrl } from "@/lib/storefront/product-page-url";
import { getStorefront } from "@/lib/storefront/queries";
import { TILE_PRODUCT_SELECT, signImageBlocks, tileProduct, type TileProductRow } from "@/lib/storefront/storefront-page";
import { presignGetUrl } from "@/lib/r2";
import { getActiveAccount } from "@/lib/team/account-context";
import { buyerVisibleBlocks, type StorefrontBlock } from "@/types/storefront";
import type { StorefrontPageData } from "@/types/storefront-page";

/** A product tile the preview can point at: where it is, and what it is. */
export type PreviewTarget = { href: string; productId: string; title: string; status: string };

export type StorefrontPreviewNotes = {
  /** Why buyers cannot open this storefront's page yet, if they cannot. */
  notPublic: ("product_pages_off" | "trader_identity_incomplete" | "taken_down")[];
  /** Product tiles a buyer would not see, and why. */
  hiddenFromBuyers: { productId: string; title: string | null; reason: "draft" | "archived" | "taken_down" | "missing" }[];
  /** Product tiles with no photo: they draw as an empty frame. */
  noPhoto: { productId: string; title: string }[];
};

type PreviewRow = TileProductRow & { status: string };

export async function storefrontPreview(
  storefrontId: string,
): Promise<{ page: StorefrontPageData; targets: PreviewTarget[]; notes: StorefrontPreviewNotes } | null> {
  const account = await getActiveAccount();
  const storefront = await getStorefront(storefrontId);
  if (!account || !storefront) return null;
  const { config } = storefront;

  const productIds = [
    ...new Set(config.blocks.flatMap((block) => (block.type === "product" ? [block.productId] : []))),
  ];
  const supabase = await createClient();
  const { data: rows, error } =
    productIds.length === 0
      ? { data: [] as PreviewRow[], error: null }
      : await supabase.from("products").select(`${TILE_PRODUCT_SELECT}, status`).in("id", productIds).eq("owner_id", account.accountId);
  if (error) throw new Error(`Reading preview products failed: ${error.message}`);
  const products = (rows ?? []) as unknown as PreviewRow[];
  const byId = new Map(products.map((row) => [row.id, row]));

  const notes: StorefrontPreviewNotes = { notPublic: [], hiddenFromBuyers: [], noPhoto: [] };
  for (const id of productIds) {
    const row = byId.get(id);
    if (!row) notes.hiddenFromBuyers.push({ productId: id, title: null, reason: "missing" });
    else if (!isContentVisible(row.moderation_status)) notes.hiddenFromBuyers.push({ productId: id, title: row.title, reason: "taken_down" });
    else if (row.status !== "active") {
      notes.hiddenFromBuyers.push({ productId: id, title: row.title, reason: row.status === "archived" ? "archived" : "draft" });
    }
    if (row && !row.image_key) notes.noPhoto.push({ productId: id, title: row.title });
  }

  // The owner's own design, drafts included; only what no longer exists, or
  // was taken down, is left out (a hole the buyer would not see either).
  const drawable = products.filter((row) => isContentVisible(row.moderation_status));
  const drawableIds = new Set(drawable.map((row) => row.id));
  const blocks: StorefrontBlock[] = buyerVisibleBlocks(config).filter(
    (block) => block.type !== "product" || drawableIds.has(block.productId),
  );

  const admin = createAdminClient();
  const now = new Date();
  const [{ data: sellerRow }, storeSales] = await Promise.all([
    admin.from("profiles").select(TRADER_GATE_SELECT).eq("id", account.accountId).maybeSingle(),
    drawable.length === 0 ? Promise.resolve([]) : readStoreSales(admin, account.accountId, now),
  ]);
  const pricing = await loadProductSales(admin, {
    ownerId: account.accountId,
    products: drawable.map((row) => ({
      productId: row.id,
      regularPriceCents: row.price_cents,
      currency: toCurrency(row.currency),
      sales: salesCovering(storeSales ?? [], row.id),
      listedAt: row.created_at ?? null,
    })),
  });

  if (!resolveProductPage(config).enabled) notes.notPublic.push("product_pages_off");
  if (
    !isTraderIdentityComplete(buildTraderIdentityInput(sellerRow as TraderGateRow | null), {
      requireVerifiedEmail: emailProofRequired(),
    })
  ) {
    notes.notPublic.push("trader_identity_incomplete");
  }
  if (storefront.removal) notes.notPublic.push("taken_down");

  const { theme } = config;
  const hrefOf = (productId: string) => productPagePath(storefront.id, productId);
  const [tiles, imageUrls, backgroundImageUrl, customFontUrl] = await Promise.all([
    Promise.all(drawable.map((row) => tileProduct(row, hrefOf(row.id), pricing.get(row.id)))),
    signImageBlocks(blocks),
    theme.background.kind === "image" ? presignGetUrl(theme.background.key) : null,
    theme.customFont ? presignGetUrl(theme.customFont.key) : null,
  ]);

  return {
    page: {
      id: storefront.id,
      name: storefront.name,
      theme,
      ...(config.header ? { header: config.header } : {}),
      blocks,
      products: tiles,
      imageUrls,
      backgroundImageUrl,
      customFontUrl,
      seller: buildSellerIdentity(sellerRow as SellerIdentityRow | null),
      allowIndexing: false,
      url: storefrontPageUrl(storefront.id),
    },
    targets: drawable.map((row) => ({ href: hrefOf(row.id), productId: row.id, title: row.title, status: row.status })),
    notes,
  };
}
