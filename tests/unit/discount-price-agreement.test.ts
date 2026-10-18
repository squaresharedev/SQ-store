// @vitest-environment node
/**
 * ONE PRICE, EVERYWHERE, UNDER EVERYTHING WE CAN THROW AT IT.
 *
 * A product's price reaches a buyer three ways: on its storefront tile, on its
 * product page, and as the amount the checkout charges. A discount that showed
 * on one and not another would be a shop advertising a price it does not
 * honour. This file draws thousands of random stores (products at awkward
 * prices, sales that overlap, start this millisecond, ended a millisecond ago,
 * cover everything or three products, in the wrong currency, deleted, another
 * store's) and for every product asks the three REAL loaders, through a fake
 * database that applies the filters they send, and holds them to:
 *
 *   1. AGREEMENT. Tile, page and quote say the same number.
 *   2. CORRECTNESS. That number is what a from-scratch calculation in this
 *      file says it should be (the oracle below shares no code with the app).
 *   3. AN HONEST SALE. While a sale lowers a price the regular price is
 *      struck through on the tile and the page alike. The PERCENTAGE is another
 *      matter: it is claimed only when the records prove the lowest price of
 *      the 30 days before the sale (or since a younger product was listed), it
 *      is measured against that price and never undercut by any price charged
 *      in those days, and the tile and the page claim the same one.
 *   4. NO WRONG PRICE UNDER FAILURE. With reads failing at random, a surface
 *      either says "not right now" or says exactly what it says when nothing
 *      fails (at most without the percentage). Never a different price.
 *   5. NOTHING LEAKS. No discount id reaches a payload.
 *
 * Seeded, so a failure names the store that caused it and replays.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PAGE_BUSY } from "@/lib/public/busy";
import { MAX_BLOCKS } from "@/lib/validation/storefront";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import { createFakeAdmin, seededRandom, type Fault } from "../setup/fake-admin";

vi.mock("@/lib/r2", () => ({ presignGetUrl: vi.fn(async (key: string) => `https://cdn.test/${key}`) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers({ "cf-connecting-ip": "203.0.113.9" })) }));
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMITS: new Proxy({}, { get: () => ({ max: 600, windowSeconds: 3600 }) }),
  clientKey: vi.fn(async () => "203.0.113.9"),
  rateLimitKey: vi.fn(async () => true),
}));
vi.mock("@/lib/checkout/availability", () => ({ checkoutAvailableFor: vi.fn(async () => true) }));
vi.mock("@/lib/storefront/uploads", () => ({ signPagePhoto: vi.fn(async () => null) }));

let fake = createFakeAdmin();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fake.admin }));

const { getPublicStorefrontPage } = await import("@/lib/storefront/storefront-page");
const { getPublicProductPage } = await import("@/lib/products/public");
const { quoteCheckout } = await import("@/lib/checkout/quote");

const NOW = Date.parse("2026-10-11T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const WINDOW = 30 * DAY;
/** The smallest card payment: a discount stops short of it (MIN_PAYABLE_CENTS). */
const FLOOR = 50;

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STRANGER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const STOREFRONT = "5f000000-0000-4000-8000-000000000001";
const uuid = (prefix: string, n: number) => `${prefix}00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const iso = (ms: number) => new Date(ms).toISOString();
const BUDGET = { action: "test", budget: { max: 600, windowSeconds: 3600 } };

const PROFILE = {
  id: OWNER,
  tax_business_name: "Studio Builderboy e.U.",
  tax_vat_id: "ATU12345678",
  tax_country: "AT",
  seller_address: "12 Market Street\nVienna\nAustria",
  seller_email: "hello@studio-builderboy.at",
  seller_phone: "+43 1 234567",
  shipping_policy: null,
};

type ProductRow = { id: string; price_cents: number; currency: "EUR" | "USD"; status: string } & Record<string, unknown>;
type SaleRow = {
  id: string;
  owner_id: string;
  kind: string;
  code: string | null;
  value_type: "percent" | "amount";
  percent_off: number | null;
  amount_off_cents: number | null;
  currency: string | null;
  applies_to: "all" | "products";
  product_ids: string[];
  starts_at: string;
  ends_at: string | null;
  usage_limit: number | null;
  enabled: boolean;
  archived_at: string | null;
  created_at: string;
  share_channel: string | null;
};
type HistoryRow = { product_id: string; price_cents: number; currency: string; valid_from: string };
type Store = { products: ProductRow[]; sales: SaleRow[]; history: HistoryRow[] };

// ---- THE ORACLE: the rules, written out again from the product's own words --------
// (docs: one discount per item, the sale that makes it cheapest; a percentage
// rounds DOWN; an amount applies only in its own currency; nothing takes an
// item below 50 cents; a sale runs from its start up to, not including, its end.)

function oracleOff(sale: SaleRow, regular: number, currency: string): number {
  const wanted =
    sale.value_type === "percent"
      ? Math.floor((regular * (sale.percent_off ?? 0)) / 100)
      : sale.currency === currency
        ? (sale.amount_off_cents ?? 0)
        : 0;
  return Math.max(0, Math.min(wanted, Math.max(0, regular - FLOOR)));
}

const covers = (sale: SaleRow, productId: string) => sale.applies_to === "all" || sale.product_ids.includes(productId);

function oracleRunning(sale: SaleRow, at: number): boolean {
  return (
    sale.owner_id === OWNER &&
    sale.kind === "automatic" &&
    sale.archived_at === null &&
    Date.parse(sale.starts_at) <= at &&
    (sale.ends_at === null || Date.parse(sale.ends_at) > at)
  );
}

/** What one costs right now, and which sales make it that. */
function oraclePrice(store: Store, product: ProductRow): { cents: number; winners: SaleRow[] } {
  let cents = product.price_cents;
  let winners: SaleRow[] = [];
  for (const sale of store.sales) {
    if (!oracleRunning(sale, NOW) || !covers(sale, product.id)) continue;
    const price = product.price_cents - oracleOff(sale, product.price_cents, product.currency);
    if (price < cents) {
      cents = price;
      winners = [sale];
    } else if (price === cents && price < product.price_cents) {
      winners.push(sale);
    }
  }
  return { cents, winners };
}

/** The price actually charged for `product` at the instant `at`, before the
 *  sale `except` existed: the listed price of the time, less the best of the
 *  store's other sales running then. Null when no price is on record yet. */
function oracleChargedAt(store: Store, product: ProductRow, at: number, except: string): number | null {
  const listed = store.history
    .filter((row) => row.product_id === product.id && Date.parse(row.valid_from) <= at)
    .sort((a, b) => Date.parse(a.valid_from) - Date.parse(b.valid_from))
    .at(-1);
  if (!listed) return null;
  let charged = listed.price_cents;
  for (const sale of store.sales) {
    if (sale.id === except || sale.owner_id !== OWNER || sale.kind !== "automatic" || !covers(sale, product.id)) continue;
    // A sale deleted before it began never ran.
    if (sale.archived_at !== null && Date.parse(sale.archived_at) <= Date.parse(sale.starts_at)) continue;
    const from = Date.parse(sale.starts_at);
    const to = sale.ends_at === null ? Number.POSITIVE_INFINITY : Date.parse(sale.ends_at);
    if (from <= at && at < to) {
      charged = Math.min(charged, listed.price_cents - oracleOff(sale, listed.price_cents, product.currency));
    }
  }
  return charged;
}

/** A minute: how far apart a product's listing and its first recorded price may be. */
const LISTING_SLACK = 60_000;

/**
 * Where the days a sale is measured against begin for this product: 30 days
 * before the sale when a price is on record from before then, the day it was
 * listed when its records begin there, and null when neither (its lowest price
 * cannot be known) or when the price changed currency on the way.
 */
function oracleWindowStart(store: Store, product: ProductRow, saleStart: number): number | null {
  const rows = store.history
    .filter((row) => row.product_id === product.id && Date.parse(row.valid_from) < saleStart)
    .sort((a, b) => Date.parse(a.valid_from) - Date.parse(b.valid_from));
  const thirtyDaysBefore = saleStart - WINDOW;
  const onRecord = rows.filter((row) => Date.parse(row.valid_from) <= thirtyDaysBefore).at(-1);
  const first = rows[0];
  const sinceListing =
    first !== undefined && Date.parse(first.valid_from) <= Date.parse(String(product.created_at)) + LISTING_SLACK;
  if (!onRecord && !sinceListing) return null;
  const from = onRecord ? thirtyDaysBefore : Date.parse(first.valid_from);
  const counted = [onRecord ?? first, ...rows.filter((row) => Date.parse(row.valid_from) > from)];
  return counted.every((row) => row.currency === product.currency) ? from : null;
}

// ---- A RANDOM STORE ----------------------------------------------------------------

const AWKWARD_PRICES = [1, 49, 50, 51, 52, 99, 100, 101, 199, 999, 1000, 74500, 99_999_999];
/** Offsets from now a sale's start or end lands on: far, near, and either side of this instant. */
const STARTS = [-90 * DAY, -45 * DAY, -31 * DAY, -29 * DAY, -10 * DAY, -DAY, -HOUR, -1, 0, 1, HOUR, DAY];
const ENDS = [-20 * DAY, -DAY, -HOUR, -1, 0, 1, 1000, HOUR, DAY, 30 * DAY];

function drawStore(seed: number): Store {
  const random = seededRandom(seed);
  const products: ProductRow[] = Array.from({ length: random.int(1, 7) }, (_, index) => {
    const currency = random.chance(0.8) ? "EUR" : "USD";
    return {
      id: uuid("b0b", index + 1),
      owner_id: OWNER,
      title: `Product ${index + 1}`,
      description: null,
      price_cents: random.chance(0.3) ? random.pick(AWKWARD_PRICES) : random.int(60, 250_000),
      currency,
      // A download, so the quote prices no delivery and its total is the items alone.
      image_key: null,
      digital_file_key: `files/${OWNER}/${uuid("f11", index + 1)}-file.pdf`,
      gallery: [],
      option_groups: [],
      details: {},
      documents: [],
      purchase_url: null,
      shipping_profile_id: null,
      max_per_order: 5,
      moderation_status: "ok",
      track_stock: false,
      stock_quantity: null,
      low_stock_threshold: 5,
      status: random.chance(0.9) ? "active" : "draft",
    } satisfies ProductRow;
  });

  const sales: SaleRow[] = Array.from({ length: random.int(0, 7) }, (_, index) => {
    const start = NOW + random.pick(STARTS);
    const endOffset = random.chance(0.35) ? null : random.pick(ENDS);
    const end = endOffset === null ? null : Math.max(start, NOW + endOffset);
    const percent = random.chance(0.65);
    const named = random.chance(0.4);
    const isCode = random.chance(0.12);
    // Deleted: sometimes after it ran, sometimes before it began.
    const archived = random.chance(0.15) ? start + random.pick([-DAY, HOUR, 2 * DAY]) : null;
    return {
      id: uuid("d15", index + 1),
      owner_id: random.chance(0.9) ? OWNER : STRANGER,
      kind: isCode ? "code" : "automatic",
      code: isCode ? `CODE${index}` : null,
      share_channel: null,
      value_type: percent ? "percent" : "amount",
      percent_off: percent ? random.pick([1, 5, 10, 15, 20, 33, 50, 75, 90]) : null,
      amount_off_cents: percent ? null : random.pick([1, 49, 50, 500, 1250, 10_000, 300_000]),
      currency: percent ? null : random.chance(0.75) ? "EUR" : "USD",
      applies_to: named ? "products" : "all",
      product_ids: named ? products.filter(() => random.chance(0.5)).map((product) => product.id) : [],
      starts_at: iso(start),
      ends_at: end === null ? null : iso(end),
      usage_limit: null,
      enabled: true,
      archived_at: archived === null ? null : iso(archived),
      created_at: iso(start - random.int(0, 5) * DAY - index),
    } satisfies SaleRow;
  });

  const history: HistoryRow[] = products.flatMap((product) => {
    // Some products have years of history, some a week, some none at all.
    const depth = random.pick([0, 1, 1, 2, 3, 6]);
    return Array.from({ length: depth }, (_, index) => ({
      product_id: product.id,
      price_cents:
        index === 0 || random.chance(0.6)
          ? product.price_cents
          : Math.max(1, product.price_cents + random.int(-product.price_cents, product.price_cents)),
      // Now and then the price was once in the other currency.
      currency: random.chance(0.93) ? product.currency : product.currency === "EUR" ? "USD" : "EUR",
      valid_from: iso(NOW - random.pick([400 * DAY, 120 * DAY, 61 * DAY, 45 * DAY, 20 * DAY, 3 * DAY, HOUR]) - index),
    }));
  });

  // When each product was listed. Half the time its records begin right there
  // (every price it ever had is known, however young it is); otherwise it is
  // older than its records, which is every product that predates them.
  for (const product of products) {
    const firstRecord = Math.min(
      ...history.filter((row) => row.product_id === product.id).map((row) => Date.parse(row.valid_from)),
    );
    product.created_at = iso(
      Number.isFinite(firstRecord) && random.chance(0.5)
        ? firstRecord - random.pick([0, 0, 1, LISTING_SLACK, LISTING_SLACK + 1])
        : NOW - 500 * DAY,
    );
  }

  return { products, sales, history };
}

function seed(store: Store) {
  fake = createFakeAdmin({
    storefronts: [
      {
        id: STOREFRONT,
        name: "Studio",
        owner_id: OWNER,
        moderation_status: "ok",
        config: {
          ...DEFAULT_STOREFRONT_CONFIG,
          theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, columns: 6, rows: 12 },
          blocks: store.products.map((product, index) => ({
            type: "product",
            productId: product.id,
            x: (index % 3) * 2,
            y: Math.floor(index / 3) * 2,
            w: 2,
            h: 2,
          })),
        },
      },
    ],
    profiles: [PROFILE],
    products: store.products,
    discounts: store.sales,
    product_price_history: store.history,
    orders: [],
  });
}

/** What a tile says: the price, the regular price it strikes through (null
 *  without a sale), and the percentage its chip can say (null without one). */
type Said = { cents: number; regular: number | null; offer: number | null };

async function askBoard(): Promise<Map<string, Said> | "busy" | null> {
  const result = await getPublicStorefrontPage(STOREFRONT);
  if (result === PAGE_BUSY) return "busy";
  if (!result) return null;
  return new Map(
    result.page.products.map((tile) => [
      tile.id,
      {
        cents: Math.round(tile.price * 100),
        regular: tile.regularPrice === undefined ? null : Math.round(tile.regularPrice * 100),
        offer: tile.offerPercent ?? null,
      },
    ]),
  );
}

async function askPage(productId: string) {
  const result = await getPublicProductPage(STOREFRONT, productId);
  if (result === PAGE_BUSY) return "busy" as const;
  return result;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** How many stores are drawn. PRICE_STRESS_STORES raises it for a longer soak
 *  (20000 takes a few minutes); the default keeps the suite quick. */
const STORES = Number(process.env.PRICE_STRESS_STORES) || 1500;

describe(`a discount's price, across ${STORES} random stores`, () => {
  it("is the same on the tile, the product page and the quote, and is the right one", async () => {
    let priced = 0;
    let onSale = 0;
    /** Sales whose lowest earlier price the records proved, and the ones that
     *  could claim a percentage against it. */
    let proven = 0;
    let claimed = 0;

    for (let n = 1; n <= STORES; n++) {
      const store = drawStore(n);
      seed(store);
      const where = (product: ProductRow) => `store ${n}, ${product.id} (${product.price_cents} ${product.currency})`;

      const board = await askBoard();
      if (!board || board === "busy") throw new Error(`store ${n}: no board`);
      const live = store.products.filter((product) => product.status === "active");
      expect([...board.keys()].sort(), `store ${n}: tiles`).toEqual(live.map((product) => product.id).sort());

      for (const product of live) {
        const truth = oraclePrice(store, product);
        const tile = board.get(product.id)!;
        const page = await askPage(product.id);
        if (!page || page === "busy") throw new Error(`${where(product)}: no page`);
        const quantity = 1 + (n % 3);
        const quoted = await quoteCheckout(
          { storefrontId: STOREFRONT, productId: product.id, optionIds: [], quantity, country: null },
          BUDGET,
        );
        if (!quoted.ok) throw new Error(`${where(product)}: quote refused, ${quoted.reason}`);
        const { quote } = quoted;

        // 1 + 2: agreement, and correctness.
        expect(tile.cents, `${where(product)}: tile`).toBe(truth.cents);
        expect(page.page.product.priceCents, `${where(product)}: page`).toBe(truth.cents);
        expect(quote.unitPriceCents, `${where(product)}: quote`).toBe(truth.cents);
        expect(quote.totalCents, `${where(product)}: charged`).toBe(truth.cents * quantity);
        expect(quote.regularUnitCents).toBe(product.price_cents);

        // Never above the listed price; never under the floor a discount stops at.
        expect(truth.cents).toBeLessThanOrEqual(product.price_cents);
        expect(truth.cents).toBeGreaterThanOrEqual(Math.min(product.price_cents, FLOOR));

        // The order is credited to a sale that really made that price, or to none.
        if (truth.cents < product.price_cents) {
          expect(truth.winners.map((sale) => sale.id), `${where(product)}: credit`).toContain(quote.discount?.id);
          expect(quote.discount?.cents).toBe((product.price_cents - truth.cents) * quantity);
          expect(page.page.product.sale?.regularPriceCents).toBe(product.price_cents);
        } else {
          expect(quote.discount, `${where(product)}: credit`).toBeNull();
          expect(page.page.product.sale, `${where(product)}: sale`).toBeNull();
        }

        // 3: an honest sale. The regular price is struck through exactly while
        // a sale lowers the price, the same on the tile and the page.
        const sale = page.page.product.sale;
        const onSaleNow = truth.cents < product.price_cents;
        expect(tile.regular, `${where(product)}: tile strikes the regular price`).toBe(
          onSaleNow ? product.price_cents : null,
        );
        // The chip's figure: what the credited sale takes off the struck
        // price, its own percentage where it applied in full and the share
        // rounded down otherwise. The tile and the page agree on it, and it
        // never says more came off than did.
        const credited = onSaleNow ? truth.winners.find((winner) => winner.id === quote.discount?.id)! : null;
        const off = product.price_cents - truth.cents;
        const share = Math.floor((off * 100) / product.price_cents);
        const offer = !credited
          ? null
          : credited.value_type === "percent" &&
              off === Math.floor((product.price_cents * (credited.percent_off ?? 0)) / 100)
            ? credited.percent_off
            : share >= 1
              ? share
              : null;
        expect(tile.offer, `${where(product)}: chip figure`).toBe(offer);
        expect(sale?.offerPercent ?? null, `${where(product)}: page agrees on the chip figure`).toBe(offer);
        if (offer !== null) {
          expect(Math.floor((product.price_cents * offer) / 100), `${where(product)}: never overstated`).toBeLessThanOrEqual(off);
        }

        if (sale) {
          // The app credits the first of equally good sales, and measures from
          // when THAT one began.
          const began = truth.winners.find((winner) => winner.id === quote.discount?.id)!;
          const saleStart = Date.parse(began.starts_at);
          const from = oracleWindowStart(store, product, saleStart);
          const prior = sale.priorPriceCents;
          // Known exactly when the records can prove it, and not otherwise.
          expect(prior === null, `${where(product)}: lowest price ${prior}, window from ${from}`).toBe(from === null);
          // A percentage only against that price, only when it is a reduction.
          const percent = prior !== null && prior > truth.cents ? Math.floor(((prior - truth.cents) * 100) / prior) : 0;
          expect(sale.percentOff, `${where(product)}: percentage`).toBe(percent >= 1 ? percent : null);
          if (sale.percentOff !== null) claimed++;
        }
        const prior = sale?.priorPriceCents ?? null;
        if (prior !== null && sale) {
          proven++;
          const began = truth.winners.find((winner) => winner.id === quote.discount?.id)!;
          const saleStart = Date.parse(began.starts_at);
          const from = oracleWindowStart(store, product, saleStart)!;
          // Lowest: no price charged anywhere in those days undercuts it. Probed
          // at the window's edges, at every instant anything changed, and a
          // millisecond either side of each.
          const instants = new Set<number>([from, saleStart - 1]);
          for (const row of store.history) if (row.product_id === product.id) instants.add(Date.parse(row.valid_from));
          for (const other of store.sales) {
            instants.add(Date.parse(other.starts_at));
            if (other.ends_at) instants.add(Date.parse(other.ends_at));
          }
          for (const instant of [...instants]) {
            instants.add(instant - 1);
            instants.add(instant + 1);
          }
          let lowest = Number.POSITIVE_INFINITY;
          for (const instant of instants) {
            if (instant < from || instant >= saleStart) continue;
            const charged = oracleChargedAt(store, product, instant, began.id);
            if (charged === null) continue;
            expect(charged, `${where(product)}: charged ${charged} at ${iso(instant)}, lowest says ${prior}`).toBeGreaterThanOrEqual(prior);
            lowest = Math.min(lowest, charged);
          }
          // And it is a price that WAS charged, not one below them all.
          expect(lowest, `${where(product)}: the lowest is a real price`).toBe(prior);
        }

        // 5: no discount id in anything a browser is sent.
        const sent = JSON.stringify(page.page);
        for (const row of store.sales) expect(sent.includes(row.id), `${where(product)}: leaked ${row.id}`).toBe(false);

        priced++;
        if (truth.cents < product.price_cents) onSale++;
      }

      const boardSent = JSON.stringify((await getPublicStorefrontPage(STOREFRONT)) ?? {});
      for (const row of store.sales) expect(boardSent.includes(row.id), `store ${n}: board leaked ${row.id}`).toBe(false);
    }

    // The draw has to have exercised the thing: plenty of products on sale,
    // plenty not, a fair number with a provable earlier price, and among those
    // both kinds: a real reduction, and a sale as deep as an earlier one.
    expect(priced).toBeGreaterThan(4000);
    expect(onSale).toBeGreaterThan(1000);
    expect(priced - onSale).toBeGreaterThan(1000);
    expect(proven).toBeGreaterThan(200);
    expect(claimed).toBeGreaterThan(100);
    expect(proven - claimed).toBeGreaterThan(20);
  }, 900_000);

  it("says 'not right now' or the true price when reads fail at random, never another price", async () => {
    let busy = 0;
    let answered = 0;
    let withoutPercent = 0;

    for (let n = 1; n <= STORES; n++) {
      const store = drawStore(n);
      seed(store);
      const truthBoard = await askBoard();
      if (!truthBoard || truthBoard === "busy") throw new Error(`store ${n}: no board`);
      const asked = store.products.find((candidate) => candidate.status === "active");
      const truthPage = asked ? await askPage(asked.id) : null;
      const truthPercent = truthPage && truthPage !== "busy" ? (truthPage.page.product.sale?.percentOff ?? null) : null;

      for (let round = 0; round < 3; round++) {
        const random = seededRandom(n * 31 + round);
        // The readers that set a price guard against a client that throws as
        // well as one that answers with an error; the rest only ever see errors.
        const flaky = (table: string): Fault => {
          if (!random.chance(0.3)) return null;
          return (table === "discounts" || table === "product_price_history") && random.chance(0.5) ? "throw" : "error";
        };

        seed(store);
        fake.state.fault = flaky;
        const board = await askBoard();
        if (board === "busy" || board === null) busy++;
        else {
          answered++;
          expect([...board.keys()].sort(), `store ${n}: tiles under failure`).toEqual([...truthBoard.keys()].sort());
          for (const [productId, said] of board) {
            const truth = truthBoard.get(productId)!;
            expect(said.cents, `store ${n}, ${productId}: tile price under failure`).toBe(truth.cents);
            // The struck regular price comes from the product itself: always there.
            expect(said.regular, `store ${n}, ${productId}: struck price under failure`).toBe(truth.regular);
            // So does the chip's figure: it is the sale's own, read with the
            // price, never dropped and never another.
            expect(said.offer, `store ${n}, ${productId}: chip figure under failure`).toBe(truth.offer);
          }
        }

        const product = store.products.find((candidate) => candidate.status === "active");
        if (!product) continue;
        seed(store);
        fake.state.fault = flaky;
        const page = await askPage(product.id);
        const quoted = await quoteCheckout(
          { storefrontId: STOREFRONT, productId: product.id, optionIds: [], quantity: 1, country: null },
          BUDGET,
        );
        const truth = truthBoard.get(product.id)!;
        if (page && page !== "busy") {
          expect(page.page.product.priceCents, `store ${n}, ${product.id}: page price under failure`).toBe(truth.cents);
          // The page's percentage needs the history, so it may be dropped. It
          // may never be a different one.
          const percent = page.page.product.sale?.percentOff ?? null;
          if (percent !== null) expect(percent, `store ${n}, ${product.id}: page percentage under failure`).toBe(truthPercent);
          else if (truthPercent !== null) withoutPercent++;
          expect(page.page.product.sale?.offerPercent ?? null, `store ${n}, ${product.id}: page chip figure under failure`).toBe(truth.offer);
        }
        // A quote that cannot be sure refuses; one that answers charges the true price.
        if (quoted.ok) expect(quoted.quote.totalCents, `store ${n}, ${product.id}: charged under failure`).toBe(truth.cents);
      }
    }

    expect(busy).toBeGreaterThan(500);
    expect(answered).toBeGreaterThan(500);
    expect(withoutPercent).toBeGreaterThan(0);
  }, 900_000);

  it("turns a sale on and off at exactly the same instant on all three", async () => {
    const START = NOW + HOUR;
    const END = NOW + 2 * HOUR;
    const store: Store = {
      products: drawStore(7).products.slice(0, 1).map((product) => ({ ...product, price_cents: 74_500, currency: "EUR", status: "active" })),
      sales: [
        {
          ...drawStore(3).sales[0],
          id: uuid("d15", 99),
          owner_id: OWNER,
          kind: "automatic",
          code: null,
          value_type: "percent",
          percent_off: 10,
          amount_off_cents: null,
          currency: null,
          applies_to: "all",
          product_ids: [],
          starts_at: iso(START),
          ends_at: iso(END),
          archived_at: null,
        },
      ],
      history: [],
    };
    const [product] = store.products;

    for (const [at, expected] of [
      [START - 1, 74_500],
      [START, 67_050],
      [START + 1, 67_050],
      [END - 1, 67_050],
      [END, 74_500],
      [END + 1, 74_500],
    ] as const) {
      vi.setSystemTime(at);
      seed(store);
      const board = await askBoard();
      const page = await askPage(product.id);
      const quoted = await quoteCheckout(
        { storefrontId: STOREFRONT, productId: product.id, optionIds: [], quantity: 1, country: null },
        BUDGET,
      );
      if (!board || board === "busy" || !page || page === "busy" || !quoted.ok) throw new Error(`no answer at ${iso(at)}`);
      expect(board.get(product.id)?.cents, `tile at ${iso(at)}`).toBe(expected);
      expect(page.page.product.priceCents, `page at ${iso(at)}`).toBe(expected);
      expect(quoted.quote.totalCents, `quote at ${iso(at)}`).toBe(expected);
    }
  });

  it("prices the fullest board a storefront can hold under 40 overlapping sales, each tile as its own page would", async () => {
    const random = seededRandom(2026);
    const products = Array.from({ length: MAX_BLOCKS }, (_, index) => ({
      ...drawStore(1).products[0],
      id: uuid("b0b", index + 1),
      title: `Product ${index + 1}`,
      price_cents: random.int(60, 90_000),
      currency: "EUR" as const,
      status: "active",
    }));
    const sales: SaleRow[] = Array.from({ length: 40 }, (_, index) => ({
      id: uuid("d15", index + 1),
      owner_id: OWNER,
      kind: "automatic",
      code: null,
      share_channel: null,
      value_type: index % 3 === 0 ? "amount" : "percent",
      percent_off: index % 3 === 0 ? null : random.int(1, 90),
      amount_off_cents: index % 3 === 0 ? random.int(1, 20_000) : null,
      currency: index % 3 === 0 ? "EUR" : null,
      applies_to: index % 4 === 0 ? "all" : "products",
      product_ids: index % 4 === 0 ? [] : products.filter(() => random.chance(0.2)).map((product) => product.id),
      starts_at: iso(NOW - random.int(1, 60) * DAY),
      ends_at: random.chance(0.5) ? null : iso(NOW + random.int(-10, 10) * DAY),
      usage_limit: null,
      enabled: true,
      archived_at: null,
      created_at: iso(NOW - 70 * DAY + index),
    }));
    const history = products.map((product) => ({
      product_id: product.id,
      price_cents: product.price_cents,
      currency: "EUR",
      valid_from: iso(NOW - 200 * DAY),
    }));
    const store: Store = { products, sales, history };

    // Every block the schema allows, each a product: one tile per cell.
    fake = createFakeAdmin({
      storefronts: [
        {
          id: STOREFRONT,
          name: "Studio",
          owner_id: OWNER,
          moderation_status: "ok",
          config: {
            ...DEFAULT_STOREFRONT_CONFIG,
            theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, columns: 12, rows: 40 },
            blocks: products.map((product, index) => ({
              type: "product",
              productId: product.id,
              x: index % 12,
              y: Math.floor(index / 12),
              w: 1,
              h: 1,
            })),
          },
        },
      ],
      profiles: [PROFILE],
      products,
      discounts: sales,
      product_price_history: history,
      orders: [],
    });

    const board = await askBoard();
    if (!board || board === "busy") throw new Error("no board");
    expect(board.size).toBe(MAX_BLOCKS);
    // The whole board costs a handful of reads, not one per tile: the
    // storefront, the seller, the products, the running sales, and (for the
    // percentages) the price history and the store's earlier sales.
    expect(fake.state.reads.length).toBeLessThanOrEqual(8);

    for (const product of products) {
      const truth = oraclePrice(store, product);
      expect(board.get(product.id)?.cents, product.id).toBe(truth.cents);
    }
    // Every tenth tile against its own page: the same price, struck price and chip figure.
    for (const product of products.filter((_, index) => index % 10 === 0)) {
      const page = await askPage(product.id);
      if (!page || page === "busy") throw new Error(`${product.id}: no page`);
      expect(board.get(product.id)).toEqual({
        cents: page.page.product.priceCents,
        regular: page.page.product.sale?.regularPriceCents ?? null,
        offer: page.page.product.sale?.offerPercent ?? null,
      });
    }
  }, 60_000);
});
