import type { MessageKey } from "@/i18n/types";
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
 * parses it to keep it that way. Pictures are real product photos under
 * public/sample-storefront (the same studio shots the marketing site uses),
 * which is why these products carry plain paths where a real product carries a
 * signed URL.
 *
 * THE LOOK is deliberately plain and current: a light neutral canvas, the sans
 * face, near-black ink, sharp tiles that are all picture, and the name and
 * price on an overlay that arrives on hover. A first storefront gets copied,
 * so the example should be one worth copying.
 *
 * IN THE SELLER'S LANGUAGE. It is an example of what they will make, so its
 * words (the name, the product titles and descriptions, the bio and text
 * blocks, the dispatch line) are messages under `Storefront.sample`, and
 * buildSampleStorefront puts it together for whoever is reading. The brand name
 * and the example address stay as they are, like any seller's own would.
 */

export const SAMPLE_STOREFRONT_PATH = "/storefront/sample";

/** A translator over full message keys: `useTranslations()` with no namespace,
 *  or `getTranslations()` on the server. */
type Translate = (key: MessageKey) => string;

/** Fixed, well-formed ids: block keys and product lookups need stable values,
 *  and nothing checks them against the database because nothing is stored. */
const PRODUCT_IDS = {
  camera: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a01",
  headphones: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a02",
  watch: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a03",
  mouse: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a04",
  speaker: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a05",
  succulent: "5a3e1d20-0c4f-4b6e-9a61-1f0d2c3b4a06",
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
    imageUrl: `/sample-storefront/${key}.webp`,
    digitalFileName: null,
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 3,
    maxPerOrder: 10,
  };
}

const PRODUCTS: readonly {
  key: keyof typeof PRODUCT_IDS;
  price: number;
  title: MessageKey;
  description: MessageKey;
}[] = [
  {
    key: "camera",
    price: 119,
    title: "Storefront.sample.content.products.camera.title",
    description: "Storefront.sample.content.products.camera.description",
  },
  {
    key: "headphones",
    price: 89,
    title: "Storefront.sample.content.products.headphones.title",
    description: "Storefront.sample.content.products.headphones.description",
  },
  {
    key: "watch",
    price: 249,
    title: "Storefront.sample.content.products.watch.title",
    description: "Storefront.sample.content.products.watch.description",
  },
  {
    key: "mouse",
    price: 39,
    title: "Storefront.sample.content.products.mouse.title",
    description: "Storefront.sample.content.products.mouse.description",
  },
  {
    key: "speaker",
    price: 79,
    title: "Storefront.sample.content.products.speaker.title",
    description: "Storefront.sample.content.products.speaker.description",
  },
  {
    key: "succulent",
    price: 18,
    title: "Storefront.sample.content.products.succulent.title",
    description: "Storefront.sample.content.products.succulent.description",
  },
];

const TEXT_IDS = {
  heading: "7c2b9e40-3d1a-4f5c-8b72-2e4f6a8c0d01",
  story: "7c2b9e40-3d1a-4f5c-8b72-2e4f6a8c0d02",
} as const;

/** The sample's own brand, a name like any seller's: never translated. */
const SAMPLE_BRAND = "Parallel Goods";

function sampleConfig(t: Translate): StorefrontConfig {
  return {
    theme: {
      ...DEFAULT_STOREFRONT_CONFIG.theme,
      // Sharp tiles, pictures first: the name and the price arrive together on
      // an overlay band when a tile is hovered, in the sans face, on a light
      // neutral canvas.
      ...VIBE_PRESETS.minimal,
      background: { kind: "solid", color: "#f4f4f5" },
      accent: "#0a0a0a",
      font: "sans",
      cornerRadius: 0,
      gridGap: 12,
      titleStyle: "overlay",
      titleDisplay: "hover",
      priceDisplay: "hover",
      // "below" is the title band, so the price rides in with the name.
      priceTagPosition: "below",
      priceTagFont: "inter",
      columns: 6,
      rows: 9,
    },
    header: {
      show: true,
      name: SAMPLE_BRAND,
      bio: t("Storefront.sample.content.bio"),
    },
    blocks: [
      { type: "product", productId: PRODUCT_IDS.camera, x: 0, y: 0, w: 3, h: 3 },
      { type: "product", productId: PRODUCT_IDS.headphones, x: 3, y: 0, w: 3, h: 3 },
      {
        type: "text",
        id: TEXT_IDS.heading,
        text: t("Storefront.sample.content.heading"),
        variant: "subheading",
        align: "left",
        x: 0,
        y: 3,
        w: 6,
        h: 1,
      },
      { type: "product", productId: PRODUCT_IDS.watch, x: 0, y: 4, w: 2, h: 2 },
      { type: "product", productId: PRODUCT_IDS.mouse, x: 2, y: 4, w: 2, h: 2 },
      { type: "product", productId: PRODUCT_IDS.succulent, x: 4, y: 4, w: 2, h: 2 },
      { type: "product", productId: PRODUCT_IDS.speaker, x: 0, y: 6, w: 4, h: 3 },
      {
        type: "text",
        id: TEXT_IDS.story,
        text: t("Storefront.sample.content.story"),
        variant: "body",
        align: "left",
        x: 4,
        y: 6,
        w: 2,
        h: 3,
      },
    ],
    productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
  };
}

/** The trader details the sample's product pages show. Complete, so the
 *  designer's "seller details missing" notices stay out of a storefront the
 *  seller cannot publish anyway. */
export const SAMPLE_SELLER: StorefrontSeller = {
  businessName: SAMPLE_BRAND,
  address: "12 Example Street, Lisbon, Portugal",
  email: "hello@example.com",
  country: "PT",
};

export type SampleStorefront = {
  name: string;
  config: StorefrontConfig;
  products: readonly Product[];
  seller: StorefrontSeller;
  shippingPolicy: SellerShippingPolicy;
};

/** The whole sample, in the language `t` speaks. */
export function buildSampleStorefront(t: Translate): SampleStorefront {
  return {
    name: t("Storefront.sample.name"),
    config: sampleConfig(t),
    products: PRODUCTS.map((product) =>
      sampleProduct(product.key, t(product.title), product.price, t(product.description)),
    ),
    seller: SAMPLE_SELLER,
    shippingPolicy: {
      shipsFrom: "PT",
      dispatch: t("Storefront.sample.content.dispatch"),
      returnsWindowDays: 14,
    },
  };
}

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
