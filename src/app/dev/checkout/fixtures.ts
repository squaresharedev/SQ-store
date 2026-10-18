import type { ProductPageProduct, ProductSale } from "@/types/product";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";

// The pretend shop the buyer-page harnesses draw: one theme, one seller, one
// set of delivery terms and one product (a vase, or a download). Shared by
// /dev/checkout and /dev/discounts, so the two show the same shop.

export const HARNESS_THEME = {
  ...DEFAULT_STOREFRONT_CONFIG.theme,
  background: { kind: "solid" as const, color: "#f6f1e7" },
  accent: "#1f4d3a",
  cornerRadius: 12,
};

export const HARNESS_SHIPPING: SellerShippingPolicy = {
  shipsFrom: "IE",
  dispatch: "Ships within 1-3 business days",
  destinations: [
    { area: "Ireland", time: "1-2 business days", countries: ["IE"], rateCents: 450 },
    { area: "Everywhere else", time: "5-8 business days", countries: ["*"], rateCents: 1200 },
  ],
  ratesCurrency: "EUR",
  freeOverCents: 8000,
  returnsWindowDays: 30,
  returnsPaidBy: "buyer",
};

export const HARNESS_SELLER = {
  businessName: "Clay House",
  address: "4 Quay Street, Galway, H91 X2Y3, Ireland",
  email: "hello@clayhouse.example",
  country: "IE",
  vatId: "IE1234567FA",
};

/** What the harness sale takes off, in whole percent. */
const HARNESS_SALE_PERCENT = 25;
const HARNESS_SALE_ENDS = "2026-10-31T12:00:00.000Z";

/**
 * The sales a product page can be asked to draw. The regular price is crossed
 * out in all of them; what differs is what the page may say about it:
 *   - "proven": the regular price was also the lowest of the 30 days before,
 *     so the percentage is measured against it;
 *   - "no-end": the same, with no end date;
 *   - "lower": an earlier sale took the price lower than the regular price in
 *     those 30 days, so that price is stated and the percentage is the smaller
 *     one measured against it;
 *   - "unproven": the records do not reach back far enough to say, so there is
 *     no percentage and the crossed-out price is called the regular price.
 */
export type HarnessSale = "proven" | "no-end" | "lower" | "unproven";

/** In the "lower" sale, the earlier price as a share of the regular one. */
const HARNESS_LOWER_PRIOR_PERCENT = 85;

function harnessSale(kind: HarnessSale, regularCents: number): ProductSale {
  const saleCents = regularCents - Math.floor((regularCents * HARNESS_SALE_PERCENT) / 100);
  const prior =
    kind === "unproven"
      ? null
      : kind === "lower"
        ? Math.floor((regularCents * HARNESS_LOWER_PRIOR_PERCENT) / 100)
        : regularCents;
  return {
    regularPriceCents: regularCents,
    priorPriceCents: prior,
    percentOff: prior === null ? null : Math.floor(((prior - saleCents) * 100) / prior),
    offerPercent: HARNESS_SALE_PERCENT,
    endsAt: kind === "no-end" ? null : HARNESS_SALE_ENDS,
  };
}

/** The harness product. On `sale`, its price is what the sale leaves. */
export function harnessProduct(digital: boolean, sale: HarnessSale | null = null): ProductPageProduct {
  const regularCents = digital ? 1200 : 2400;
  return {
    id: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a03",
    title: digital ? "Glaze recipes zine" : "Stoneware vase",
    description: "",
    priceCents: sale ? regularCents - Math.floor((regularCents * HARNESS_SALE_PERCENT) / 100) : regularCents,
    currency: "EUR",
    sale: sale ? harnessSale(sale, regularCents) : null,
    purchaseUrl: null,
    shippingProfileId: null,
    images: [{ url: "/sample-storefront/succulent.webp", alt: "A stoneware vase" }],
    optionGroups: digital
      ? []
      : [
          {
            id: "g-colour",
            name: "Colour",
            display: "swatch",
            options: [
              { id: "o-sage", name: "Sage", swatch: "#9caf88", available: true },
              { id: "o-clay", name: "Clay", swatch: "#c26a4a", available: true },
            ],
          },
          {
            id: "g-size",
            name: "Size",
            display: "chip",
            options: [
              { id: "o-small", name: "Small", available: true },
              { id: "o-large", name: "Large", available: true },
            ],
          },
        ],
    details: {},
    documents: [],
    isDigital: digital,
    digitalFormat: digital ? "PDF" : null,
    stock: null,
    soldOut: false,
    maxQuantity: 5,
  };
}
