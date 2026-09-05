// Shared fake-data generators for the dev seed script (and reused types for the
// reset script). Deterministic when given a --seed, so runs are reproducible.
//
// HARD RULE: all money is integer cents. No floats are ever stored.
//
// RELATIONSHIP TO THE SALES SIMULATOR. `pnpm seed` bootstraps a store from
// nothing: it creates the products, then backfills a history of orders AND
// storefront signals. The pg_cron simulator in
// supabase/migrations/20260801_demo_sales_sim.sql (extended by
// 20260830_demo_sales_sim_signals.sql) takes it from there, adding a few
// orders, views and clicks every 20 minutes so the dashboard keeps moving. The
// two MUST model sales — and now traffic — the same way or a backfilled day
// and a live day would look different in the same chart, so the properties
// below are deliberately mirrored on both sides:
//
//   1. ONE currency per store  - the analytics reader is EUR-only, so a mixed
//      catalogue silently drops half the dataset before it reaches a chart.
//   2. A recurring buyer pool  - a fresh random email per order pins the
//      analytics "repeat buyers" figure to 0 forever. Signals mirror this with
//      their own recurring VISITOR pool (see pickVisitorHash).
//   3. Time-of-day shape       - real stores do not sell evenly at 04:00.
//   4. Pareto product mix      - uniform picking makes "top products" noise.
//   5. Signals are DERIVED from orders, not chosen independently - clicks are
//      a share of embed orders run in reverse, views are a share of clicks run
//      in reverse (see generateSignals and CLICK_TO_ORDER_RATE /
//      VIEW_TO_CLICK_RATE, mirrored by demo.signal_funnel in SQL). That keeps
//      "more traffic than sales" true by construction instead of by luck.

import { randomUUID } from "node:crypto";
import { CATALOG } from "./catalog.ts";

// ---------------------------------------------------------------------------
// Deterministic RNG + small sampling helpers
// ---------------------------------------------------------------------------

export type Rng = () => number;

/** mulberry32 — tiny deterministic PRNG so `--seed <n>` reproduces a dataset. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Pick a value by relative weight, e.g. [["paid", 85], ["refunded", 6]]. */
export function weightedPick<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return entries[entries.length - 1]![0];
}

// ---------------------------------------------------------------------------
// Order enums — kept in sync with the orders table CHECK constraints.
// ---------------------------------------------------------------------------

export const ORDER_CHANNELS = ["embed", "marketplace"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const ORDER_STATUSES = ["paid", "refunded", "disputed", "pending"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/** Insert shape for public.products (matches the existing table columns). */
export interface ProductInsert {
  owner_id: string;
  title: string;
  description: string;
  price_cents: number;
  currency: string;
  status: string;
  image_key: string;
  /** Product page facts. Seeded so a demo store's pages are as complete as a
   *  real seller's, rather than a title and a price on an empty screen. */
  gallery: never[];
  option_groups: SeedOptionGroup[];
  details: Record<string, unknown>;
  purchase_url: string | null;
  /** Public documents: [{ key, label }]. The key is a full https URL here,
   *  which only a service_role seed can write (see presignGetUrl). */
  documents: { key: string; label: string }[];
  /**
   * Inventory. Seeded because the availability line is the one part of a
   * product page that changes on its own, and a demo store where every item is
   * silently "in stock" never shows the low-stock or sold-out states that the
   * badge, the button and the tile all have code for.
   */
  track_stock: boolean;
  stock_quantity: number | null;
  low_stock_threshold: number;
}

type SeedOption = { id: string; name: string; swatch?: string; available: boolean };
type SeedOptionGroup = {
  id: string;
  name: string;
  display: "swatch" | "chip" | "select";
  options: SeedOption[];
};

/** How a theme's option groups are authored: a name, how it draws, and its
 *  values — a bare string for a text axis, or a name plus a swatch. */
type SeedGroupSpec = {
  name: string;
  display: "swatch" | "chip" | "select";
  values: readonly (string | { name: string; swatch: string })[];
};

/**
 * Per-collection page facts for the demo catalogue.
 *
 * PER THEME, not per product: the catalogue is authored with a real title,
 * description, price and photograph for each item (see build-catalog.ts), and
 * hand-writing dimensions for fifty of them would add nothing a page layout
 * cannot be judged without. What matters here is that every section of the
 * product page has something in it, in the right shape and the right units.
 *
 * Deliberately obvious demo values: example.com is the reserved example
 * domain, so a seeded purchase link and a seeded manufacturer address cannot
 * point at a real business.
 */
const THEME_PAGE_FACTS: Record<
  string,
  {
    materials: string;
    care: string;
    included: string[];
    specs: { label: string; value: string }[];
    origin: string;
    /** [min, max] per axis, in the unit named. */
    dimensions?: { unit: "mm" | "cm"; length: [number, number]; width: [number, number]; height: [number, number] };
    weight: { unit: "g" | "kg"; range: [number, number] };
    optionGroups: SeedGroupSpec[];
    manufacturer: string;
    /**
     * The paperwork this kind of product actually ships with, in the order a
     * buyer would reach for it. Seeded because the Documents section is one of
     * the few parts of a product page that stays empty on a demo store and so
     * never gets looked at: a furniture shop with no assembly instructions is
     * not a furniture shop anyone would recognise.
     *
     * Each becomes a real one-page PDF in the public seed bucket, so the links
     * open rather than 404. See documentAssets() and scripts/lib/pdf.ts.
     */
    documents: readonly { label: string; body: readonly string[] }[];
  }
> = {
  "furniture-brutalist": {
    materials: "Board-formed concrete, blackened steel, charcoal wool.",
    care: "Wipe with a damp cloth and dry off. Re-seal the concrete once a year with a matt stone sealer. Keep the steel out of standing water.",
    included: ["The piece, fully assembled", "Felt floor pads", "Sealing cloth"],
    specs: [
      { label: "Finish", value: "Matt sealed concrete" },
      { label: "Indoor or outdoor", value: "Indoor" },
    ],
    origin: "Portugal",
    dimensions: { unit: "cm", length: [60, 220], width: [45, 100], height: [40, 92] },
    weight: { unit: "kg", range: [9, 68] },
    optionGroups: [
      {
        name: "Colour",
        display: "swatch",
        values: [
          { name: "Raw concrete", swatch: "#b8b5ae" },
          { name: "Charcoal", swatch: "#3a3a3c" },
        ],
      },
    ],
    manufacturer: "Formwork Studio Lda",
    documents: [
      {
        label: "Assembly and anchoring guide",
        body: [
          "Concrete is heavy. Two people, and a clear route to the room.",
          "Fit the felt pads before the piece is stood upright.",
          "Wall-anchor anything taller than it is wide.",
        ],
      },
      {
        label: "Sealing and care sheet",
        body: [
          "Re-seal once a year with a matt stone sealer.",
          "Blot spills. Do not let standing water sit on the steel.",
        ],
      },
      {
        label: "Declaration of conformity",
        body: [
          "Demo document. Not a real declaration.",
          "Issued for Squareshare seed data only.",
        ],
      },
    ],
  },
  "furniture-cozy": {
    materials: "Solid oak, boucle wool, brass fittings.",
    care: "Dust with a dry cloth. Treat the oak with a clear wood oil twice a year. Spot-clean the wool with cold water.",
    included: ["The piece, flat packed", "Brass fittings and key", "Care card"],
    specs: [
      { label: "Finish", value: "Hard-wax oiled oak" },
      { label: "Assembly", value: "Two people, 20 minutes" },
    ],
    origin: "Denmark",
    dimensions: { unit: "cm", length: [55, 210], width: [40, 95], height: [38, 88] },
    weight: { unit: "kg", range: [6, 42] },
    optionGroups: [
      {
        name: "Colour",
        display: "swatch",
        values: [
          { name: "Natural oak", swatch: "#d7b184" },
          { name: "Smoked oak", swatch: "#6b4f3a" },
        ],
      },
    ],
    manufacturer: "Nordhus Møbler ApS",
    documents: [
      {
        label: "Assembly instructions",
        body: [
          "Two people, about twenty minutes.",
          "Step 1: lay the panels face down on the flat pack card.",
          "Step 2: hand-tighten every brass fitting before final tightening.",
          "Step 3: turn the piece upright and check it does not rock.",
        ],
      },
      {
        label: "Oiling and care guide",
        body: [
          "Oil the oak twice a year with a clear hard-wax oil.",
          "Spot-clean the wool with cold water and a clean cloth.",
          "Keep the piece out of direct afternoon sun.",
        ],
      },
      {
        label: "Materials and origin statement",
        body: [
          "Demo document for Squareshare seed data.",
          "Oak from certified European forestry.",
        ],
      },
    ],
  },
  tech: {
    materials: "Anodised aluminium, recycled polycarbonate.",
    care: "Wipe with a dry microfibre cloth. Do not submerge. Charge at room temperature.",
    included: ["The device", "1.5 m USB-C cable", "Quick start guide"],
    specs: [
      { label: "Connectivity", value: "USB-C, Bluetooth 5.3" },
      { label: "Battery life", value: "Up to 30 hours" },
      { label: "Warranty", value: "2 years" },
    ],
    origin: "Taiwan",
    dimensions: { unit: "mm", length: [90, 320], width: [60, 210], height: [8, 60] },
    weight: { unit: "g", range: [120, 1400] },
    optionGroups: [
      {
        name: "Colour",
        display: "swatch",
        values: [
          { name: "Graphite", swatch: "#3d3d42" },
          { name: "Silver", swatch: "#cfd2d6" },
        ],
      },
      // A second axis whose values are read, not seen. Seeded so the demo
      // store exercises the chip picker and a two-axis page, which is the
      // whole point of options being seller-defined.
      { name: "Storage", display: "chip", values: ["128 GB", "256 GB", "512 GB"] },
    ],
    manufacturer: "Meridian Devices Ltd",
    documents: [
      {
        label: "Quick start guide",
        body: [
          "Charge fully before first use.",
          "Hold the power key for three seconds to pair.",
          "Firmware updates arrive over Bluetooth.",
        ],
      },
      {
        label: "Safety and battery information",
        body: [
          "Charge at room temperature. Do not submerge.",
          "Do not puncture or incinerate the battery pack.",
        ],
      },
      {
        label: "EU declaration of conformity",
        body: ["Demo document. Not a real declaration.", "Squareshare seed data only."],
      },
    ],
  },
  fashion: {
    materials: "Organic cotton, recycled polyester trim.",
    care: "Machine wash cold on a gentle cycle. Line dry. Warm iron on the reverse. Do not tumble dry.",
    included: ["The garment", "Spare button", "Cotton dust bag"],
    specs: [
      { label: "Fit", value: "Relaxed" },
      { label: "Fabric weight", value: "320 gsm" },
    ],
    origin: "Portugal",
    weight: { unit: "g", range: [180, 900] },
    optionGroups: [
      {
        name: "Colour",
        display: "swatch",
        values: [
          { name: "Bone", swatch: "#e8e2d6" },
          { name: "Ink", swatch: "#22242a" },
          { name: "Clay", swatch: "#b4715a" },
        ],
      },
      { name: "Size", display: "chip", values: ["XS", "S", "M", "L", "XL"] },
    ],
    manufacturer: "Atelier Norte Lda",
    documents: [
      {
        label: "Size and fit guide",
        body: [
          "Measurements are of the garment, laid flat, in centimetres.",
          "The cut is relaxed. Size down for a closer fit.",
        ],
      },
      {
        label: "Washing and care card",
        body: [
          "Machine wash cold, gentle cycle. Line dry.",
          "Warm iron on the reverse. Do not tumble dry.",
        ],
      },
    ],
  },
  drones: {
    materials: "Carbon fibre frame, glass-filled nylon arms.",
    care: "Keep the sensors clean and dry. Store the battery at half charge. Check the propellers before every flight.",
    included: ["The aircraft", "Two battery packs", "Spare propeller set", "Carry case"],
    specs: [
      { label: "Flight time", value: "Up to 28 minutes" },
      { label: "Range", value: "8 km" },
      { label: "Camera", value: "4K / 60 fps" },
    ],
    origin: "China",
    dimensions: { unit: "mm", length: [180, 420], width: [180, 400], height: [60, 140] },
    weight: { unit: "g", range: [249, 1100] },
    optionGroups: [
      {
        name: "Colour",
        display: "swatch",
        values: [
          { name: "Slate", swatch: "#4a4f57" },
          { name: "Arctic", swatch: "#e6e8ea" },
        ],
      },
      { name: "Bundle", display: "chip", values: ["Standard", "Fly More", "Cine"] },
    ],
    manufacturer: "Skyline Aerial Systems",
    documents: [
      {
        label: "Flight manual",
        body: [
          "Read before the first flight.",
          "Calibrate the compass away from metal and power lines.",
          "Check the propellers for chips before every flight.",
        ],
      },
      {
        label: "Battery safety sheet",
        body: [
          "Store at half charge. Never leave a pack charging unattended.",
          "Retire any pack that swells or will not hold charge.",
        ],
      },
      {
        label: "CE declaration of conformity",
        body: ["Demo document. Not a real declaration.", "Squareshare seed data only."],
      },
      {
        label: "Airspace and registration notes",
        body: [
          "Most of Europe requires operator registration above 250 g.",
          "Demo text. Check your own national authority.",
        ],
      },
    ],
  },
};

/**
 * The public bucket the seed's own assets live in, mirroring what
 * scripts/mirror-catalog-images.ts already does for product photography.
 * `presignGetUrl` passes a full https URL straight through, so a seeded row
 * can hold one where the app would normally hold an R2 object key.
 */
const SEED_ASSET_BUCKET = "seed-assets";
const DOCUMENT_PREFIX = "docs/v1";

/** Where one theme's document lives, and what it says. The seed uploads these
 *  once (see uploadSeedDocuments) and every product of that theme links them. */
export interface SeedDocumentAsset {
  /** Object path inside the public bucket. */
  path: string;
  label: string;
  body: readonly string[];
}

/** Every demo document the catalogue references, deduplicated across themes.
 *  Themes share a label rarely enough that the path is namespaced per theme. */
export function documentAssets(): SeedDocumentAsset[] {
  const assets: SeedDocumentAsset[] = [];
  for (const [themeKey, facts] of Object.entries(THEME_PAGE_FACTS)) {
    for (const document of facts.documents) {
      assets.push({
        path: `${DOCUMENT_PREFIX}/${themeKey}/${slugify(document.label)}.pdf`,
        label: document.label,
        body: document.body,
      });
    }
  }
  return assets;
}

/** The public URL a seeded document row points at. Built from the project URL
 *  the seed is already configured with, so it follows the target it writes to
 *  rather than being hardcoded to one project. */
export function documentPublicUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${SEED_ASSET_BUCKET}/${path}`;
}

/**
 * The STORE-level facts a product page reads off the storefront config, rather
 * than off the product: the shipping and returns policies, and the trader
 * identity EU distance-selling law asks for beside an offer.
 *
 * Seeded because without them a demo product page shows "the seller has not
 * added shipping details yet", an empty Seller section, no "Sold by" byline
 * and none of the statutory lines: the three sections most likely to be judged
 * empty are exactly the three nothing was filling.
 *
 * The country is deliberately an EU one so the withdrawal and guarantee lines
 * render. They are a real part of the page and would otherwise never be seen.
 */
export function storeFactsFor(themeKey: string): {
  policies: { shipping: string; returns: string };
  seller: {
    businessName: string;
    address: string;
    email: string;
    country: string;
    phone: string;
    vatId: string;
  };
} {
  const facts = THEME_PAGE_FACTS[themeKey];
  const manufacturer = facts?.manufacturer ?? "Demo Trading Ltd";
  const heavy = themeKey.startsWith("furniture");

  return {
    policies: {
      shipping: heavy
        ? [
            "Delivered by a two-person crew across the EU, to the room of your choice.",
            "",
            "Ireland and mainland Europe: 5 to 10 working days. Islands and remote addresses can take a week longer. You will get a call to arrange a delivery window before anything is loaded.",
            "",
            "Shipping is quoted at checkout by weight and distance. Nothing is dispatched until the address is confirmed.",
          ].join("\n")
        : [
            "Dispatched within one working day from our warehouse in Europe.",
            "",
            "Ireland and mainland Europe: 2 to 4 working days, tracked. Rest of the world: 5 to 10 working days.",
            "",
            "Shipping is calculated at checkout. Orders over 150 EUR ship free.",
          ].join("\n"),
      returns: [
        "Thirty days to change your mind, from the day it arrives.",
        "",
        heavy
          ? "Send it back in its original packaging and we will refund the item in full. Collection of a large item is arranged with the same crew that delivered it, and costs 40 EUR unless the piece arrived damaged or faulty."
          : "Send it back unworn and unused in its original packaging and we will refund the item in full. Return postage is on us if the item arrived damaged or faulty, and on you otherwise.",
        "",
        "Made-to-order pieces are the one exception and cannot be returned unless they are faulty.",
      ].join("\n"),
    },
    seller: {
      businessName: manufacturer,
      // No country line: SellerBlock prints the country from `country` on its
      // own, so repeating it here renders "Ireland" twice in the seller block.
      address: "1 Example Way\nDemo Industrial Estate\nD02 XY45 Dublin",
      email: "hello@example.com",
      country: "IE",
      phone: "+353 1 234 5678",
      vatId: "IE1234567X",
    },
  };
}

/** A URL-safe slug, for the demo purchase link. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The page facts for one seeded product: bounded numbers in the theme's own
 *  units, its options, and a compliance block that names a demo manufacturer. */
function pageFactsFor(
  rng: Rng,
  themeKey: string,
  product: CatalogProduct,
  supabaseUrl: string,
): Pick<ProductInsert, "option_groups" | "details" | "purchase_url" | "documents"> {
  const facts = THEME_PAGE_FACTS[themeKey];
  if (!facts) return { option_groups: [], details: {}, purchase_url: null, documents: [] };

  const dimensions = facts.dimensions
    ? {
        length: randInt(rng, ...facts.dimensions.length),
        width: randInt(rng, ...facts.dimensions.width),
        height: randInt(rng, ...facts.dimensions.height),
        unit: facts.dimensions.unit,
      }
    : undefined;

  return {
    // Every document the theme defines, in its authored order: a buyer opens
    // the assembly guide before the conformity declaration.
    documents: facts.documents.map((document) => ({
      key: documentPublicUrl(
        supabaseUrl,
        `${DOCUMENT_PREFIX}/${themeKey}/${slugify(document.label)}.pdf`,
      ),
      label: document.label,
    })),
    option_groups: facts.optionGroups.map((spec) => ({
      id: randomUUID(),
      name: spec.name,
      display: spec.display,
      options: spec.values.map((value) => ({
        id: randomUUID(),
        name: typeof value === "string" ? value : value.name,
        ...(typeof value === "string" ? {} : { swatch: value.swatch }),
        available: true,
      })),
    })),
    details: {
      ...(dimensions ? { dimensions } : {}),
      weight: { value: randInt(rng, ...facts.weight.range), unit: facts.weight.unit },
      materials: facts.materials,
      care: facts.care,
      included: facts.included,
      specs: facts.specs,
      origin: facts.origin,
      safety: {
        manufacturerName: facts.manufacturer,
        manufacturerAddress: `1 Example Way\n${facts.origin}`,
        manufacturerEmail: "safety@example.com",
        // Whole words: a blind slice cut this mid-word and printed a product
        // identifier like "DEMO-ROUNDHOUSE-COFFEE-", which reads as a bug on
        // the page rather than as demo data. The field allows 80 characters,
        // so no product title needs cutting at all.
        identifier: `DEMO-${slugify(product.title).toUpperCase()}`,
        warnings: "Demo data. Keep away from children under 3 years.",
      },
    },
    purchase_url: `https://example.com/checkout/${slugify(product.title)}`,
  };
}

/** One product the store actually sells: a real name, description, price and
 *  photograph, snapshotted from a real catalogue. See scripts/build-catalog.ts. */
export interface CatalogProduct {
  title: string;
  description: string;
  /** Integer cents, like every other money value in this project. */
  priceCents: number;
  /** Absolute https URL to a photo OF THIS PRODUCT (not a themed stock shot).
   *  presignGetUrl() passes full URLs straight through — see src/lib/r2.ts. */
  imageUrl: string;
}

/**
 * How a category is shot AND what it sells — the two halves of looking like one
 * real shop rather than a stock-photo grab bag.
 *
 * `aesthetic` is the design language every product in the collection shares
 * (one material palette, one era). It matters as much as the backdrop: a
 * consistent white sweep behind an ornate carved bed, a red mid-century chair
 * and a kitsch photo frame still reads as three unrelated shops.
 *
 * `prompt` is the shared instruction the collection's photography was
 * generated from, kept so the set can be extended later without drifting.
 */
export interface PhotoStyle {
  /** The lighting/backdrop treatment, e.g. "Low-key charcoal". */
  name: string;
  /** The collection's design language, e.g. "Brutalist concrete". */
  aesthetic: string;
  /** Shared generation prompt, so new products match the existing shots. */
  prompt: string;
}

/** A themed slice of the catalogue, e.g. "Furniture". A store only ever draws
 *  from ONE theme (see generateProducts), so it never ends up selling, say,
 *  running shoes next to smartphones. */
export interface ProductTheme {
  key: string;
  label: string;
  photoStyle: PhotoStyle;
  products: readonly CatalogProduct[];
}

/**
 * The store categories, each ONE design collection. See lib/catalog.ts for the
 * data and for why it is authored rather than scraped.
 */
export const PRODUCT_THEMES: readonly ProductTheme[] = CATALOG;

/** Look a theme up by its key, e.g. for `pnpm seed --theme drones`. */
export function themeByKey(key: string): ProductTheme | undefined {
  return PRODUCT_THEMES.find((theme) => theme.key === key);
}

/** Every theme key, for CLI help and validation messages. */
export const THEME_KEYS: readonly string[] = PRODUCT_THEMES.map((theme) => theme.key);

/** Pick the one theme a store's whole catalogue will be drawn from. */
export function pickTheme(rng: Rng): ProductTheme {
  return pick(rng, PRODUCT_THEMES);
}

/** Every catalogue product across every theme. */
export const CATALOG_PRODUCTS: readonly CatalogProduct[] = PRODUCT_THEMES.flatMap((t) => t.products);

/** Find a catalogue entry by its exact title, for tools that need to restore a
 *  seeded product's original photo (scripts/update-product-images.ts). */
export function findCatalogProduct(title: string): CatalogProduct | undefined {
  return CATALOG_PRODUCTS.find((product) => product.title === title);
}


/**
 * The store's single currency.
 *
 * WHY NOT a per-product mix: getAnalytics() pushes `.neq("currency", "USD")`
 * down to the database, so every USD row is invisible to the revenue tiles, the
 * time series, the channel split and the top-products table. A catalogue priced
 * half in USD therefore renders as a store with half the sales, for no reason a
 * reader could ever deduce from the UI. One store, one currency.
 */
export const STORE_CURRENCY = "EUR";

/** Fisher-Yates, drawing from the seeded RNG so shuffles stay reproducible. */
function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Generate a store's catalogue. Every product is drawn from a SINGLE theme
 * (defaults to one picked at random) so a store never ends up selling, say,
 * running shoes and smartphones side by side — real storefronts specialise.
 *
 * Products are SAMPLED WITHOUT REPLACEMENT from the theme's real catalogue, so
 * a store never lists the same item twice. `count` is therefore capped at the
 * theme's size — ask for 15 furniture items from a 10-item theme and you get
 * 10, which is the honest answer rather than five duplicates.
 */
export function generateProducts(
  rng: Rng,
  ownerId: string,
  count: number,
  theme: ProductTheme = pickTheme(rng),
  /** The Supabase project the seed is writing to, for the document URLs. */
  supabaseUrl = "",
): ProductInsert[] {
  // Titles are snapshotted onto orders and the top-products table groups by
  // that snapshot, so two rows sharing a title would merge into one overstated
  // row. Sampling without replacement makes that impossible by construction.
  const picked = shuffled(rng, theme.products).slice(
    0,
    Math.min(count, theme.products.length),
  );
  // One spread for the whole catalogue, so it can GUARANTEE coverage rather
  // than hope for it. See stockSpread.
  const stock = stockSpread(rng, picked.length);

  return picked.map((product, index) => ({
    owner_id: ownerId,
    title: product.title,
    description: product.description,
    price_cents: product.priceCents,
    currency: STORE_CURRENCY,
    image_key: product.imageUrl,
    // Mostly active; a few drafts. Drafts are excluded from order generation.
    status: weightedPick<string>(rng, [["active", 8], ["draft", 2]]),
    // No extra photos: the catalogue holds one real photograph per item, and
    // repeating it as a second "angle" would be a lie the layout is judged on.
    gallery: [],
    ...stock[index]!,
    ...pageFactsFor(rng, theme.key, product, supabaseUrl),
  }));
}

type StockState = "healthy" | "low" | "out" | "untracked";

type StockFields = Pick<
  ProductInsert,
  "track_stock" | "stock_quantity" | "low_stock_threshold"
>;

/**
 * Inventory for a whole catalogue, DEALT rather than rolled.
 *
 * Every availability state the page can render has to occur somewhere in a
 * seeded store or nobody ever sees it: the plain in-stock line, the "only N
 * left" warning, the sold-out button, and the shop that simply does not count
 * stock. Rolling each product independently does not achieve that. A 20%
 * chance of "low" across eight products misses entirely about one run in six,
 * and the first version of this did exactly that: eight furniture items, not
 * one of them low or sold out, so two of the four states the product page has
 * code for were invisible on the demo store.
 *
 * So the scarce states are dealt FIRST, one each, and only the remainder is
 * random. A catalogue too small to hold one of each (fewer than four) just
 * fills from the weights, because guaranteeing four states across three
 * products would mean a store that is one third sold out.
 */
function stockSpread(rng: Rng, count: number): StockFields[] {
  const states: StockState[] = [];
  // All four, including "healthy": leaving the common one to the weights meant
  // a small catalogue could roll none of it, which is the same bug in reverse.
  if (count >= 4) states.push("healthy", "low", "out", "untracked");
  while (states.length < count) {
    states.push(
      weightedPick<StockState>(rng, [
        ["healthy", 11],
        ["low", 3],
        ["out", 1],
        ["untracked", 3],
      ]),
    );
  }
  // Shuffled so the guaranteed ones are not always the first three tiles on
  // the board, which would read as deliberate on a demo store.
  return shuffled(rng, states).map((state) => stockFields(rng, state));
}

/** One state as the columns it is stored in. The threshold is held constant so
 *  "low" is a question about the quantity, never about the threshold. */
function stockFields(rng: Rng, state: StockState): StockFields {
  const low_stock_threshold = 5;
  switch (state) {
    case "untracked":
      // A made-to-order or drop-shipped line: no count, no badge.
      return { track_stock: false, stock_quantity: null, low_stock_threshold };
    case "out":
      return { track_stock: true, stock_quantity: 0, low_stock_threshold };
    case "low":
      return { track_stock: true, stock_quantity: randInt(rng, 1, 5), low_stock_threshold };
    case "healthy":
      return { track_stock: true, stock_quantity: randInt(rng, 12, 140), low_stock_threshold };
  }
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** The product fields the seed needs after products are inserted (with ids). */
export interface SeededProduct {
  id: string;
  title: string;
  price_cents: number;
  currency: string;
  status: string;
  /** Read back so an order can record WHICH version was bought. A store whose
   *  every order is version-less makes the orders page look like the feature
   *  does not exist. */
  option_groups?: SeedOptionGroup[];
}

/** Insert shape for public.orders. created_at is backdated across the window. */
export interface OrderInsert {
  seller_id: string;
  product_id: string | null;
  storefront_id: string | null;
  channel: OrderChannel;
  status: OrderStatus;
  amount_cents: number;
  platform_fee_cents: number;
  currency: string;
  buyer_email: string;
  product_title: string;
  product_price_cents: number;
  /** What the buyer picked, snapshotted in words: [{label, value}]. Empty for
   *  a product sold in one version. */
  selected_options: { label: string; value: string }[];
  created_at: string;
}

/** Small, realistic platform take rate applied to the gross amount. */
const PLATFORM_TAKE_RATE = 0.05;
const DAY_MS = 86_400_000;

const BUYER_FIRST = [
  "alex", "sam", "jordan", "riley", "casey", "noa", "mika", "lee", "robin",
  "kai", "tess", "ivan", "luca", "mara", "gus", "juno", "remy", "sasha",
] as const;
const BUYER_LAST = [
  "wong", "silva", "meyer", "novak", "haddad", "kim", "rossi", "dubois",
  "olsen", "costa", "tran", "abadi", "weber", "koch", "flores", "park",
] as const;

/**
 * Deterministic address for a buyer INDEX, on a reserved .test domain so it is
 * never deliverable to a real inbox. Index-addressed (rather than freshly
 * random) so the same index always means the same person, which is what makes
 * repeat purchases expressible at all.
 */
export function buyerEmailForIndex(index: number): string {
  const first = BUYER_FIRST[index % BUYER_FIRST.length]!;
  const last = BUYER_LAST[Math.floor(index / BUYER_FIRST.length) % BUYER_LAST.length]!;
  return `${first}.${last}${100 + index}@example.test`;
}

/** Share of orders placed by someone who has bought before. */
export const RETURNING_BUYER_RATE = 0.28;
/** How many distinct regulars the store has. */
export const BUYER_POOL_SIZE = 90;

/**
 * Pick the buyer for one order: usually a first-timer, sometimes a regular.
 *
 * Both degenerate models read as obviously fake on the analytics page, which
 * reports unique buyers and repeat buyers side by side:
 *   - a fresh random address every time (what this generator used to do) gives
 *     416 orders, 416 buyers, and a repeat-buyer count pinned to 0;
 *   - drawing only from a fixed pool makes EVERY buyer a repeat buyer, so the
 *     store never appears to acquire anyone.
 * Mixing the two in a ~28/72 split produces both numbers at once.
 */
export function pickBuyerEmail(rng: Rng, poolSize = BUYER_POOL_SIZE): string {
  if (rng() < RETURNING_BUYER_RATE) {
    // Mild skew (exponent 1.3) so a few regulars stand out. A harder skew
    // concentrates the store on one address: at 2.2 the top buyer took 15% of
    // every order placed, which is not a customer, it is a bug that looks like
    // a customer.
    return buyerEmailForIndex(Math.floor(Math.pow(rng(), 1.3) * poolSize));
  }
  // First-timer: an index far outside the pool, so it can never collide with a
  // regular and silently turn them into a repeat buyer.
  return buyerEmailForIndex(poolSize + Math.floor(rng() * 1_000_000));
}

/**
 * Relative sales intensity by UTC hour, normalised to mean 1 so it re-shapes
 * WHEN orders land without changing HOW MANY there are. A flat clock is the
 * most obvious tell in a demo dataset: nobody buys evenly at 04:00 and 20:00.
 */
const HOUR_WEIGHTS = [
  0.25, 0.15, 0.1, 0.1, 0.12, 0.2, // 00-05 night
  0.4, 0.7, 1.0, 1.2, 1.3, 1.25, // 06-11 morning ramp
  1.1, 1.2, 1.3, 1.35, 1.4, 1.5, // 12-17 afternoon
  1.7, 1.8, 1.6, 1.2, 0.8, 0.45, // 18-23 evening peak
] as const;

/** Seconds past midnight for one order, drawn from the hour-of-day shape. */
export function pickSecondOfDay(rng: Rng): number {
  const total = HOUR_WEIGHTS.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let hour = 0; hour < HOUR_WEIGHTS.length; hour += 1) {
    roll -= HOUR_WEIGHTS[hour]!;
    if (roll < 0) return hour * 3600 + Math.floor(rng() * 3600);
  }
  return 23 * 3600 + Math.floor(rng() * 3600);
}

/**
 * Relative popularity per product, by catalogue position: weight ~ 1/rank^0.7.
 *
 * Uniform picking gives every product the same sales, which makes the dashboard
 * "top products" table a list of ties in random order, i.e. pure noise. Real
 * catalogues have a head and a long tail.
 */
export function popularityWeights(count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.pow(i + 1, -0.7));
}

/** Draw an index in [0, weights.length) proportional to `weights`. */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i]!;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

export interface GenerateOrdersOptions {
  sellerId: string;
  /** Storefront to attribute embed sales to; null if the seller has none. */
  storefrontId: string | null;
  products: SeededProduct[];
  /** "Now" — captured once by the caller so a run is internally consistent. */
  now: Date;
  /** Size of the backdated window, in days (~90). */
  days: number;
  /** Approximate total number of orders to generate (~150–300). */
  targetTotal: number;
}

function makeOrder(
  rng: Rng,
  args: {
    sellerId: string;
    storefrontId: string | null;
    product: SeededProduct;
    dayStart: Date;
    now: Date;
  },
): OrderInsert {
  const { sellerId, storefrontId, product, dayStart, now } = args;
  const channel = weightedPick<OrderChannel>(rng, [["embed", 6], ["marketplace", 4]]);
  const status = weightedPick<OrderStatus>(rng, [
    ["paid", 85],
    ["refunded", 6],
    ["disputed", 3],
    ["pending", 6],
  ]);
  const amount_cents = product.price_cents; // gross, drawn from the product price
  const platform_fee_cents = Math.round(amount_cents * PLATFORM_TAKE_RATE);
  // Embed sales flow through the seller's storefront widget; marketplace sales
  // come from the (future) discovery feed and aren't tied to a storefront.
  const storefront_id = channel === "embed" ? storefrontId : null;
  // Time-of-day follows the hour shape, clamped so "today" never lands in the
  // future (the current day is only partly elapsed).
  const at = Math.min(dayStart.getTime() + pickSecondOfDay(rng) * 1000, now.getTime());
  return {
    seller_id: sellerId,
    product_id: product.id,
    storefront_id,
    channel,
    status,
    amount_cents,
    platform_fee_cents,
    currency: product.currency,
    buyer_email: pickBuyerEmail(rng),
    product_title: product.title,
    product_price_cents: product.price_cents,
    selected_options: pickSelection(rng, product),
    created_at: new Date(at).toISOString(),
  };
}

/**
 * One option per group, the way a buyer has to pick: a product sold in a size
 * and a colour was bought in exactly one of each.
 *
 * The NAMES are stored, not the ids, matching what the column is for (see
 * 20260905_order_selected_options): an order says what was sold, and the
 * product's options are free to change afterwards. Sold-out options are
 * skipped where there is anything else to pick, because a seeded order is a
 * sale that went through.
 */
function pickSelection(
  rng: Rng,
  product: SeededProduct,
): { label: string; value: string }[] {
  const selection: { label: string; value: string }[] = [];
  for (const group of product.option_groups ?? []) {
    const choosable = group.options.filter((option) => option.available);
    const option = pick(rng, choosable.length > 0 ? choosable : group.options);
    if (!group.name.trim() || !option?.name.trim()) continue;
    selection.push({ label: group.name.trim(), value: option.name.trim() });
  }
  return selection;
}

/**
 * Per-day relative volume: a gentle upward trend, weekend dips, day-to-day
 * noise, and occasional spike days. Extracted so orders AND signals (see
 * generateSignals below) share the same demand shape — both trend the same
 * direction across a launch, a quiet week or a spike day, without moving in
 * exact lockstep, since each call draws its own noise. That is closer to a
 * real store than either perfect correlation or two unrelated curves.
 */
export function dailyVolumeWeights(rng: Rng, now: Date, days: number): number[] {
  const weights: number[] = [];
  for (let d = 0; d < days; d += 1) {
    const dayDate = new Date(now.getTime() - (days - 1 - d) * DAY_MS);
    const trend = 0.5 + d / days; // ramps ~0.5 -> ~1.5 across the window
    const dow = dayDate.getUTCDay(); // 0 Sun .. 6 Sat
    const weekend = dow === 0 || dow === 6 ? 0.6 : 1;
    const noise = 0.6 + rng() * 0.8; // 0.6 .. 1.4
    const spike = rng() < 0.07 ? 2.2 : 1; // ~7% of days are unusually busy
    weights.push(trend * weekend * noise * spike);
  }
  return weights;
}

/**
 * Generate orders over the last `days` with a NON-UNIFORM distribution: a gentle
 * upward trend, weekend dips, day-to-day noise, and occasional spike days — so
 * dashboard charts look real instead of flat. Only active products get sales.
 */
export function generateOrders(rng: Rng, opts: GenerateOrdersOptions): OrderInsert[] {
  const { sellerId, storefrontId, products, now, days, targetTotal } = opts;
  const active = products.filter((p) => p.status === "active");
  const pool = active.length > 0 ? active : products;
  if (pool.length === 0) return [];
  // Fixed popularity per catalogue position, drawn once so a product's
  // standing is stable for the whole window. Re-rolling per order would
  // average every product back to the same volume.
  const popularity = popularityWeights(pool.length);

  const weights = dailyVolumeWeights(rng, now, days);
  const weightSum = weights.reduce((sum, w) => sum + w, 0);

  // 2) Convert weights into integer per-day counts summing ~= targetTotal,
  //    using stochastic rounding so the fractional part isn't lost.
  const orders: OrderInsert[] = [];
  for (let d = 0; d < days; d += 1) {
    const expected = (weights[d]! / weightSum) * targetTotal;
    let count = Math.floor(expected);
    if (rng() < expected - count) count += 1;
    const dayStart = new Date(now.getTime() - (days - 1 - d) * DAY_MS);
    dayStart.setUTCHours(0, 0, 0, 0);
    for (let i = 0; i < count; i += 1) {
      const product = pool[weightedIndex(rng, popularity)]!;
      orders.push(makeOrder(rng, { sellerId, storefrontId, product, dayStart, now }));
    }
  }
  return orders;
}

// ---------------------------------------------------------------------------
// Signals (storefront views / product clicks)
// ---------------------------------------------------------------------------
//
// Mirrors public.storefront_signals
// (supabase/migrations/20260830_storefront_signals.sql) and
// src/lib/analytics/signals.ts, kept as a LOCAL copy rather than an import:
// scripts/ never imports from src/, so a schema change on either side surfaces
// as a compile error in its own tree instead of silently drifting apart.
//
// ONLY THE TWO KINDS WITH A REAL PRODUCER ARE SEEDED. email_signup and booking
// have no storefront block that can produce them yet (see
// docs/analytics-datapoints.md) — seeding fake rows for a feature nothing can
// actually turn on would be exactly the kind of invented number this project
// goes out of its way to avoid everywhere else (DemographicsCard was removed
// for this same reason; MetricTile's `pending` state exists to say so instead
// of guessing). storefront_view and product_click both have a real, working
// ingest path today (GET /api/embed/[key], POST /api/embed/[key]/signal), so
// modelling them ahead of the widget that will eventually call the click route
// is modelling a real mechanism early, not inventing one.

/**
 * Insert shape for public.storefront_signals — only the columns the seed
 * writes. `metadata` is ALWAYS present (`{}` when there is nothing to carry),
 * even though the column has a database default: a bulk insert is one POST
 * with one column list shared by every row, so a batch mixing rows that omit
 * a key with rows that set it sends an explicit `null` for the rows missing
 * it, not "use the default" — and `metadata` is NOT NULL. Every row must
 * agree on its shape.
 */
export interface SignalInsert {
  account_id: string;
  storefront_id: string;
  kind: "storefront_view" | "product_click";
  channel: "embed";
  block_id: null;
  visitor_hash: string;
  occurred_at: string;
  metadata: { product_id: string } | Record<string, never>;
}

/**
 * Deterministic 64-hex-char string for a visitor INDEX — the signal-side
 * analogue of buyerEmailForIndex. NOT a real digest (this is fake data); its
 * only job is to be a stable, unique-per-index string so COUNT DISTINCT on
 * visitor_hash behaves the same way it does against a real salted one (the
 * column's CHECK constraint requires exactly 64 hex characters).
 */
function visitorHashForIndex(index: number): string {
  let h = (index + 1) >>> 0;
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}

/** Share of signals from a visitor who has been seen before. Same reasoning
 *  as RETURNING_BUYER_RATE: a fresh hash every time pins uniqueVisitors to the
 *  row count forever, and a fixed pool only makes every visitor a repeat —
 *  mixing the two is what makes BOTH figures on the analytics page look real
 *  at once. */
export const RETURNING_VISITOR_RATE = 0.35;
/** Distinct regulars in the visitor pool. Larger than the buyer pool: far
 *  more people browse a storefront than buy from it. */
export const VISITOR_POOL_SIZE = 260;

export function pickVisitorHash(rng: Rng, poolSize = VISITOR_POOL_SIZE): string {
  if (rng() < RETURNING_VISITOR_RATE) {
    // Mild skew (exponent 1.4), same reasoning as pickBuyerEmail: a few
    // regulars stand out without one visitor swallowing a chunk of the
    // traffic on their own.
    return visitorHashForIndex(Math.floor(Math.pow(rng(), 1.4) * poolSize));
  }
  // First-time visitor: an index far outside the pool, so it can never
  // collide with a regular and silently turn them into a repeat.
  return visitorHashForIndex(poolSize + Math.floor(rng() * 1_000_000));
}

/** Fraction of embed orders that trace back to a click. Wide band: a fixed
 *  rate across every seeded run would be as obvious a tell as flat data.
 *  Mirrored by demo.signal_funnel's rate band in the SQL simulator — the two
 *  MUST stay in step (see the file header). */
const CLICK_TO_ORDER_RATE = [0.08, 0.22] as const;
/** Fraction of views that lead to a click. Same mirroring requirement. */
const VIEW_TO_CLICK_RATE = [0.12, 0.32] as const;

function randFloat(rng: Rng, [min, max]: readonly [number, number]): number {
  return min + rng() * (max - min);
}

export interface GenerateSignalsOptions {
  accountId: string;
  /** No storefront, no embed widget, no views — matches production exactly:
   *  the only place a storefront_view is ever recorded is the embed route,
   *  and that route needs a real embed_key, which needs a real storefront. */
  storefrontId: string | null;
  /** The same catalogue passed to generateOrders — clicks land on an active
   *  product, weighted by the same popularity curve orders use, so a
   *  bestseller in sales is also the most-clicked product. */
  products: SeededProduct[];
  now: Date;
  days: number;
  /** Embed-channel orders already generated in this run — the funnel's floor.
   *  Views and clicks scale off this, never off a target of their own. */
  embedOrderCount: number;
}

/**
 * Generate storefront_view and product_click rows for the last `days`.
 *
 * THE FUNNEL: clicks are a noisy fraction of that day's views (not an
 * independent curve — the same traffic surge drives both, so tying them at
 * the day level keeps the two trend lines correlated the way a real funnel's
 * do), and the overall view volume is sized from embedOrderCount by running
 * the two conversion rates in reverse. Every stage has a floor so a quiet or
 * order-less store still seeds SOME traffic — people look at a storefront
 * before it has sold anything too.
 */
export function generateSignals(rng: Rng, opts: GenerateSignalsOptions): SignalInsert[] {
  const { accountId, storefrontId, products, now, days, embedOrderCount } = opts;
  if (!storefrontId) return [];

  const clickToOrderRate = randFloat(rng, CLICK_TO_ORDER_RATE);
  const viewToClickRate = randFloat(rng, VIEW_TO_CLICK_RATE);
  const targetClicks = Math.max(
    embedOrderCount,
    Math.round(embedOrderCount / clickToOrderRate),
    20,
  );
  const targetViews = Math.max(
    targetClicks,
    Math.round(targetClicks / viewToClickRate),
    60,
  );

  const active = products.filter((p) => p.status === "active");
  const popularity = popularityWeights(active.length);

  const weights = dailyVolumeWeights(rng, now, days);
  const weightSum = weights.reduce((sum, w) => sum + w, 0);

  const signals: SignalInsert[] = [];
  for (let d = 0; d < days; d += 1) {
    const expectedViews = (weights[d]! / weightSum) * targetViews;
    let viewCount = Math.floor(expectedViews);
    if (rng() < expectedViews - viewCount) viewCount += 1;

    // Clicks are a share of THIS DAY'S views, with their own noise on the
    // conversion rate — correlated with traffic, not a mechanically fixed
    // fraction of it.
    const dailyConversionNoise = 0.7 + rng() * 0.6; // 0.7 .. 1.3
    const expectedClicks = viewCount * viewToClickRate * dailyConversionNoise;
    let clickCount = Math.floor(expectedClicks);
    if (rng() < expectedClicks - clickCount) clickCount += 1;

    const dayStart = new Date(now.getTime() - (days - 1 - d) * DAY_MS);
    dayStart.setUTCHours(0, 0, 0, 0);

    for (let i = 0; i < viewCount; i += 1) {
      signals.push({
        account_id: accountId,
        storefront_id: storefrontId,
        kind: "storefront_view",
        channel: "embed",
        block_id: null,
        visitor_hash: pickVisitorHash(rng),
        occurred_at: signalTimestamp(rng, dayStart, now),
        metadata: {},
      });
    }
    for (let i = 0; i < clickCount; i += 1) {
      const product =
        active.length > 0 ? active[weightedIndex(rng, popularity)] : undefined;
      signals.push({
        account_id: accountId,
        storefront_id: storefrontId,
        kind: "product_click",
        channel: "embed",
        block_id: null,
        visitor_hash: pickVisitorHash(rng),
        occurred_at: signalTimestamp(rng, dayStart, now),
        metadata: product ? { product_id: product.id } : {},
      });
    }
  }
  return signals;
}

function signalTimestamp(rng: Rng, dayStart: Date, now: Date): string {
  const at = Math.min(dayStart.getTime() + pickSecondOfDay(rng) * 1000, now.getTime());
  return new Date(at).toISOString();
}
