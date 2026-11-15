import type { Product } from "@/types/product";

/** DEV HARNESSES ONLY: what the harnesses' sale takes off, in percent. */
export const SAMPLE_SALE_PERCENT = 20;

/**
 * DEV HARNESSES ONLY (/dev/sample-storefront with `?sale=1`): every sample
 * product on a SAMPLE_SALE_PERCENT sale, as the designer is handed a running
 * sale (Product.sale), so the sale chip and its controls have a real offer.
 */
export function withSampleSale(products: readonly Product[]): Product[] {
  return products.map((product) => ({
    ...product,
    sale: {
      price: Math.round(product.price * (100 - SAMPLE_SALE_PERCENT)) / 100,
      offerPercent: SAMPLE_SALE_PERCENT,
    },
  }));
}
