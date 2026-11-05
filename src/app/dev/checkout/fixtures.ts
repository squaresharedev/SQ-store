import type { AddOnCard, HiddenAddOn, ProductPageProduct, ProductSale } from "@/types/product";
import type { ProductReviews } from "@/types/review";
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

/** "Add to your order" cards for the harness product (`?addons=1`): one with
 *  versions, one on sale, so both draw. The same kind as the product. */
export function harnessAddOns(digital: boolean): AddOnCard[] {
  if (digital) {
    return [
      {
        id: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a11",
        title: "Firing log template",
        description: "A printable log for every kiln firing: cone, ramp, hold and what came out.",
        pagePath: null,
        priceCents: 600,
        currency: "EUR",
        sale: null,
        images: [{ url: "/sample-storefront/mouse.webp", alt: "A firing log" }],
        optionGroups: [],
        isDigital: true,
        digitalFormat: "PDF",
        shippingProfileId: null,
        rating: null,
      },
    ];
  }
  return [
    {
      id: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a12",
      title: "Oak coasters",
      description: "Turned from Irish oak and oiled by hand.\n\nThey sit flat under anything from a mug to a vase.",
      // Stands for a tile on the storefront, so the dialog offers its full page.
      pagePath: "/dev/checkout?view=product",
      priceCents: 1800,
      currency: "EUR",
      sale: null,
      images: [{ url: "/sample-storefront/watch.webp", alt: "Oak coasters" }],
      optionGroups: [
        {
          id: "g-set",
          name: "Set",
          display: "chip",
          options: [
            { id: "o-two", name: "Two", available: true },
            { id: "o-four", name: "Four", available: true },
          ],
        },
      ],
      isDigital: false,
      digitalFormat: null,
      shippingProfileId: null,
      // Reviewed, so its details show the stars.
      rating: { average: 4.6, count: 12 },
    },
    {
      id: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a13",
      title: "Glaze sampler",
      description: "",
      pagePath: null,
      priceCents: 900,
      currency: "EUR",
      sale: harnessSale("proven", 1200),
      images: [{ url: "/sample-storefront/speaker.webp", alt: "A glaze sampler" }],
      optionGroups: [],
      isDigital: false,
      digitalFormat: null,
      shippingProfileId: null,
      rating: null,
    },
  ];
}

/** Two more posted cards, so `?addons=4` offers the most a product can (four). */
export function harnessMoreAddOns(): AddOnCard[] {
  const card = (id: string, title: string, priceCents: number, image: string): AddOnCard => ({
    id,
    title,
    description: "",
    pagePath: null,
    priceCents,
    currency: "EUR",
    sale: null,
    images: [{ url: image, alt: title }],
    optionGroups: [],
    isDigital: false,
    digitalFormat: null,
    shippingProfileId: null,
    rating: null,
  });
  return [
    card("5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a14", "Linen tea towel", 1400, "/sample-storefront/succulent.webp"),
    card("5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a15", "Beeswax candle", 1100, "/sample-storefront/headphones.webp"),
  ];
}

/** Chosen but not offered (`?addons=hidden`): a draft and one sold out, as the
 *  seller's previews draw them. */
export function harnessHiddenAddOns(): HiddenAddOn[] {
  return [
    {
      id: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a16",
      title: "Candlestick floor lamp",
      imageUrl: "/sample-storefront/camera.webp",
      priceCents: 38000,
      currency: "EUR",
      reason: "draft",
    },
    {
      id: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a17",
      title: "Loft oak bookshelf",
      imageUrl: "/sample-storefront/mouse.webp",
      priceCents: 112000,
      currency: "EUR",
      reason: "soldOut",
    },
  ];
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

/** A product with reviews (`?reviews=1`): every row of the star filter but one has some. */
export const HARNESS_REVIEWS: ProductReviews = {
  summary: { count: 17, average: 3.6, breakdown: [2, 2, 4, 1, 8] },
  firstPage: {
    rows: [
      {
        id: "harness-review-1",
        rating: 5,
        title: "Lovely glaze",
        body: "Arrived well packed and looks even better in person.",
        authorName: "Aoife",
        verified: true,
        source: "native",
        reviewedAt: "2026-10-01T10:00:00.000Z",
      },
    ],
    total: 17,
    page: 1,
    pageSize: 10,
  },
};
