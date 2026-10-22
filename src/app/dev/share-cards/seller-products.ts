import type { ShareCardProduct } from "@/components/share-card/types";
import { appUrl } from "@/lib/app-url";
import { productPhotoPath } from "@/lib/products/paths";
import { getProductPlacements, listProducts } from "@/lib/products/queries";
import { productPageUrl } from "@/lib/storefront/product-page-url";
import { getAccessibleAccounts, getActiveAccount } from "@/lib/team/account-context";

/** How many of the seller's own products the gallery offers beside the
 *  fixtures: the newest, which is what a seller would share first. */
const SELLER_PRODUCTS_SHOWN = 8;

/**
 * The signed-in seller's own newest products, as share cards would draw them,
 * so the gallery can be judged on a real catalogue as well as on fixtures.
 * Empty when nobody is signed in, and on any failure: the fixtures alone are
 * still a whole gallery.
 *
 * The QR code leads to the product's hosted page when one of its storefronts
 * has product pages on, and to the app otherwise.
 */
export async function sellerShareProducts(): Promise<(ShareCardProduct & { id: string; note: string })[]> {
  try {
    const account = await getActiveAccount();
    if (!account) return [];
    const [list, placements, accounts] = await Promise.all([
      listProducts({ pageSize: SELLER_PRODUCTS_SHOWN }),
      getProductPlacements(),
      getAccessibleAccounts(),
    ]);
    const storeName =
      accounts.find((option) => option.accountId === account.accountId)?.storeName ?? "";
    return list.rows.map((product) => {
      const hosted = placements[product.id]?.find((placement) => placement.productPagesOn);
      const url = hosted ? productPageUrl(hosted.id, product.id) : appUrl("/");
      return {
        id: product.id,
        note: "Yours",
        title: product.title,
        price: product.price,
        currency: product.currency,
        imageUrl: product.imageUrl,
        // Read through our own origin (the presigned URL's pixels are not
        // readable from here); keyed by the object's path, which a new photo
        // changes and a fresh signature does not.
        photo: product.imageUrl
          ? { src: productPhotoPath(product.id), key: new URL(product.imageUrl).pathname }
          : null,
        soldOut: product.trackStock && (product.stockQuantity ?? 0) <= 0,
        storeName,
        url,
        urlLabel: new URL(url).host,
      };
    });
  } catch (error) {
    console.error("[dev/share-cards] seller products unavailable", error);
    return [];
  }
}
