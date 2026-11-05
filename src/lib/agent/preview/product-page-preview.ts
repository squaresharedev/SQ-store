// SERVER ONLY. A product's page as its owner's assistant previews it: the same
// page data the public route draws (lib/products/public.ts), built by the same
// functions, but read AS THE GRANT, under row level security, rather than
// through the buyer gate (lib/products/purchasable.ts):
//
//   - the product and the storefront are read with the grant's own client, so
//     only this store's exist for this caller;
//   - a draft is drawn (the owner is previewing their own page), and what would
//     keep the page from buyers is reported in `notes` instead of refused;
//   - prices go through the seller's preview pricing, add-ons through the
//     buyer's own loader under the buyer page's own rule, and the page is
//     drawn by the buyer's renderer: what a buyer would see, nothing of the
//     designer's (its hints, the add-ons it shows faded).
//
// A product page is part of a storefront: it wears that storefront's look and
// lives at its address. The one asked for, or else the storefront the product
// sits on (the one edited last), or else, for a product on none yet, the
// store's newest, so the seller still sees the page it would have.

import { resolveCtaTarget } from "@/components/product-page/cta-target";
import { checkoutAvailableFor } from "@/lib/checkout/availability";
import { emailProofRequired } from "@/lib/contact-verification/availability";
import { loadPreviewPricing } from "@/lib/discounts/storefront-preview";
import { toCurrency } from "@/lib/format/money";
import { isContentVisible } from "@/lib/moderation/removal";
import { loadAddOnCards } from "@/lib/products/add-ons";
import { PUBLIC_PRODUCT_SELECT, buildProductPageProduct, type PublicProductRow } from "@/lib/products/public";
import { getProductPlacements } from "@/lib/products/queries";
import { presignGetUrl } from "@/lib/r2";
import { getProductReviews } from "@/lib/reviews/queries";
import {
  TRADER_GATE_SELECT,
  buildSellerIdentity,
  buildTraderIdentityInput,
  type SellerIdentityRow,
  type TraderGateRow,
} from "@/lib/settings/seller-identity";
import { SHIPPING_POLICY_SELECT, buildShippingPolicy, type ShippingPolicyRow } from "@/lib/settings/shipping-policy";
import { isTraderIdentityComplete } from "@/lib/settings/trader-identity";
import { isProductPageSectionShown, resolveProductPage } from "@/lib/storefront/product-page";
import { productPageUrl } from "@/lib/storefront/product-page-url";
import { getStorefront, listStorefronts } from "@/lib/storefront/queries";
import { signPagePhoto } from "@/lib/storefront/uploads";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { productIdSchema } from "@/lib/validation/product";
import type { ProductReviews } from "@/types/review";
import type { ProductPageData } from "@/types/product-page";

export type ProductPagePreviewNotes = {
  /** Why buyers cannot open this page yet, if they cannot. */
  notPublic: (
    | "draft"
    | "archived"
    | "not_on_storefront"
    | "product_pages_off"
    | "trader_identity_incomplete"
    | "taken_down"
  )[];
  /** No photo: the page shows an empty frame where it would be. */
  noPhoto: boolean;
  /** No buy button: no purchase link, no contact email, no checkout. */
  noWayToBuy: boolean;
};

export type ProductPagePreview = {
  page: ProductPageData;
  reviews: ProductReviews | null;
  status: string;
  notes: ProductPagePreviewNotes;
};

type PreviewRow = PublicProductRow & { status: string };

/**
 * The product's page as it would be drawn, or "no_storefront" for a store that
 * has none to draw it in, or null for a product (or storefront) this caller
 * cannot read.
 */
export async function productPagePreview(
  productId: string,
  storefrontId?: string,
): Promise<ProductPagePreview | "no_storefront" | null> {
  if (!productIdSchema.safeParse(productId).success) return null;
  const account = await getActiveAccount();
  if (!account) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(`${PUBLIC_PRODUCT_SELECT}, status`)
    .eq("id", productId)
    .eq("owner_id", account.accountId)
    .maybeSingle();
  if (error) throw new Error(`Reading the previewed product failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as PreviewRow;

  const placements = storefrontId ? [] : ((await getProductPlacements())[productId] ?? []);
  const chosen = storefrontId ?? placements[0]?.id ?? (await listStorefronts()).rows[0]?.id;
  if (!chosen) return "no_storefront";
  const storefront = await getStorefront(chosen);
  if (!storefront) return null;
  const { config } = storefront;
  const productPage = resolveProductPage(config);
  const block = config.blocks.find((candidate) => candidate.type === "product" && candidate.productId === productId);

  const admin = createAdminClient();
  const now = new Date();
  const [{ data: sellerRow }, pricing] = await Promise.all([
    admin.from("profiles").select(`${TRADER_GATE_SELECT}, ${SHIPPING_POLICY_SELECT}`).eq("id", account.accountId).maybeSingle(),
    loadPreviewPricing(account.accountId, [
      { id: row.id, price: row.price_cents / 100, currency: toCurrency(row.currency), listedAt: row.created_at ?? null },
    ]),
  ]);
  const shippingPolicy = buildShippingPolicy(sellerRow as ShippingPolicyRow | null);

  const product = await buildProductPageProduct(row, {
    soldOutFlag: block?.type === "product" && block.soldOut === true,
    showStock: productPage.showStock,
    pricing: pricing.get(row.id),
  });
  const reviewsShown = isProductPageSectionShown(productPage, "reviews");
  const theme = config.theme;
  const [reviews, backgroundImageUrl, customFontUrl, pagePhoto, checkout] = await Promise.all([
    reviewsShown ? getProductReviews(row.id) : Promise.resolve(null),
    theme.background.kind === "image" ? presignGetUrl(theme.background.key) : Promise.resolve(null),
    theme.customFont ? presignGetUrl(theme.customFont.key) : Promise.resolve(null),
    signPagePhoto(productPage.backgroundImage),
    checkoutAvailableFor({ ownerId: account.accountId, shippingPolicy, row }),
  ]);
  // Offered exactly where the buyer's page offers them (lib/products/public.ts).
  const addOns =
    checkout && isProductPageSectionShown(productPage, "addOns") && !product.soldOut
      ? await loadAddOnCards(admin, {
          ownerId: account.accountId,
          ids: row.add_on_ids,
          isDigital: product.isDigital,
          currency: product.currency,
          now,
          unreadableSales: "regular",
          pages: { storefrontId: storefront.id, linked: () => true },
          withRatings: reviewsShown,
        })
      : [];

  const seller = buildSellerIdentity(sellerRow as SellerIdentityRow | null);
  // The page's own rule for its button, so the note says what the page draws.
  const target = resolveCtaTarget(
    product.purchaseUrl,
    seller.email,
    product.title,
    "",
    checkout ? { storefrontId: storefront.id, productId: product.id } : null,
  );
  const notes: ProductPagePreviewNotes = { notPublic: [], noPhoto: !row.image_key, noWayToBuy: target.kind === "none" };
  if (row.status === "draft" || row.status === "archived") notes.notPublic.push(row.status);
  if (!block) notes.notPublic.push("not_on_storefront");
  if (!productPage.enabled) notes.notPublic.push("product_pages_off");
  if (
    !isTraderIdentityComplete(buildTraderIdentityInput(sellerRow as TraderGateRow | null), {
      requireVerifiedEmail: emailProofRequired(),
    })
  ) {
    notes.notPublic.push("trader_identity_incomplete");
  }
  if (storefront.removal || !isContentVisible(row.moderation_status)) notes.notPublic.push("taken_down");

  return {
    page: {
      storefront: {
        id: storefront.id,
        name: storefront.name,
        theme,
        ...(config.header ? { header: config.header } : {}),
        productPage,
        shippingPolicy,
        seller,
        backgroundImageUrl,
        customFontUrl,
        pagePhoto,
        checkout,
      },
      product,
      productUrl: productPageUrl(storefront.id, product.id),
      ...(addOns.length > 0 ? { addOns } : {}),
    },
    reviews,
    status: row.status,
    notes,
  };
}
