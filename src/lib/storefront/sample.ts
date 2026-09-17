import type { Product } from "@/types/product";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontConfig,
  type StorefrontSeller,
} from "@/types/storefront";
import { VIBE_PRESETS } from "./presets";

/**
 * THE SAMPLE STOREFRONT: a finished storefront a new seller can look at and
 * play with, defined here in code and never stored.
 *
 * WHY IT IS NOT A ROW. A real `storefronts` row would be counted by everything
 * that reads that table: the setup checklist, Analytics' first-run state, "needs
 * attention", search, the embed route. And it could only show products by
 * creating fake ones in the seller's catalogue. As code it touches none of that.
 * The storefront list draws its card from this module, and `/storefront/sample`
 * opens it in the designer's sample mode, where nothing saves. The only stored
 * facts about it are two profile flags (hidden from the list, tour seen).
 *
 * Every value stays inside the storefront contract (storefrontConfigSchema), so
 * what a seller sees here is something they could really build; a unit test
 * parses it to keep it that way. Pictures are static illustrations under
 * public/sample-storefront, which is why these products carry plain paths where
 * a real product carries a signed URL.
 */

export const SAMPLE_STOREFRONT_PATH = "/storefront/sample";
export const SAMPLE_STOREFRONT_NAME = "Sample storefront";

/** Fixed, well-formed ids: block keys and product lookups need stable values,
 *  and nothing checks them against the database because nothing is stored. */
const PRODUCT_IDS = {
  mug: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a01",
  bowl: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a02",
  vase: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a03",
  candle: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a04",
  towel: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a05",
  plate: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a06",
} as const;

function sampleProduct(
  key: keyof typeof PRODUCT_IDS,
  title: string,
  price: number,
  description: string,
): Product {
  return {
    id: PRODUCT_IDS[key],
    title,
    description,
    price,
    currency: "EUR",
    status: "active",
    imageUrl: `/sample-storefront/${key}.svg`,
    digitalFileName: null,
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 3,
    maxPerOrder: 10,
  };
}

export const SAMPLE_PRODUCTS: readonly Product[] = [
  sampleProduct("mug", "Speckled mug", 24, "Stoneware mug with a speckled glaze and a blue dipped base. Holds 350 ml."),
  sampleProduct("bowl", "Stoneware bowl", 32, "A deep everyday bowl, glazed sage inside. Dishwasher safe."),
  sampleProduct("vase", "Bud vase", 28, "A small terracotta vase for a few dried stems."),
  sampleProduct("candle", "Soy candle", 22, "Hand-poured soy wax in a reusable tin. Around 40 hours of burn time."),
  sampleProduct("towel", "Linen tea towel", 18, "Washed linen with a woven stripe. Gets softer with every wash."),
  sampleProduct("plate", "Serving plate", 45, "A wide plate for sharing, with a speckled rim."),
];

const TEXT_IDS = {
  heading: "7c2b9e40-3d1a-4f5c-8b72-2e4f6a8c0d01",
  story: "7c2b9e40-3d1a-4f5c-8b72-2e4f6a8c0d02",
} as const;
const SHAPE_IDS = {
  sparkle: "9d4c2a60-5e3b-4a7d-9c83-3f5a7b9d1e01",
  circle: "9d4c2a60-5e3b-4a7d-9c83-3f5a7b9d1e02",
} as const;

export const SAMPLE_STOREFRONT_CONFIG: StorefrontConfig = {
  theme: {
    ...DEFAULT_STOREFRONT_CONFIG.theme,
    // The Classic look: every tile labelled, in the same serif.
    ...VIBE_PRESETS.classic,
    accent: "#5b4636",
    columns: 6,
    rows: 9,
  },
  header: {
    show: true,
    name: "Juniper & Clay",
    bio: "Small-batch ceramics and linens, made by hand.",
  },
  blocks: [
    { type: "product", productId: PRODUCT_IDS.mug, x: 0, y: 0, w: 3, h: 3 },
    { type: "product", productId: PRODUCT_IDS.bowl, x: 3, y: 0, w: 3, h: 3 },
    {
      type: "text",
      id: TEXT_IDS.heading,
      text: "New this season",
      variant: "subheading",
      align: "center",
      x: 0,
      y: 3,
      w: 6,
      h: 1,
    },
    { type: "product", productId: PRODUCT_IDS.vase, x: 0, y: 4, w: 2, h: 2 },
    { type: "product", productId: PRODUCT_IDS.candle, x: 2, y: 4, w: 2, h: 2 },
    { type: "product", productId: PRODUCT_IDS.towel, x: 4, y: 4, w: 2, h: 2 },
    { type: "product", productId: PRODUCT_IDS.plate, x: 0, y: 6, w: 4, h: 3 },
    {
      type: "text",
      id: TEXT_IDS.story,
      text: "Every piece is thrown, glazed and fired by hand, so no two are quite the same.",
      variant: "body",
      align: "left",
      x: 4,
      y: 6,
      w: 2,
      h: 2,
    },
    { type: "shape", id: SHAPE_IDS.sparkle, kind: "sparkle", color: "#5b4636", x: 4, y: 8, w: 1, h: 1 },
    { type: "shape", id: SHAPE_IDS.circle, kind: "circle", color: "#d8c3a5", x: 5, y: 8, w: 1, h: 1 },
  ],
  productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
};

/** The trader details the sample's product pages show. Complete, so the
 *  designer's "seller details missing" notices stay out of a storefront the
 *  seller cannot publish anyway. */
export const SAMPLE_SELLER: StorefrontSeller = {
  businessName: "Juniper & Clay",
  address: "12 Example Street, Lisbon, Portugal",
  email: "hello@example.com",
  country: "PT",
};

export const SAMPLE_SHIPPING_POLICY: SellerShippingPolicy = {
  shipsFrom: "PT",
  dispatch: "Ships within 2 business days",
  returnsWindowDays: 14,
};

/**
 * A stand-in object key for a file added inside the sample.
 *
 * The sample never uploads: the designer shows the seller's own copy of the file
 * (an object URL) under a key shaped like a real one, so every piece of editor
 * code that groups or looks up artwork by key keeps working. The nil uploader id
 * marks it as never having been stored.
 */
export function sampleObjectKey(
  prefix: "images" | "fonts" | "elements",
  file: File,
): string {
  const name = file.name.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80) || "file";
  return `${prefix}/00000000-0000-0000-0000-000000000000/${crypto.randomUUID()}-${name}`;
}
