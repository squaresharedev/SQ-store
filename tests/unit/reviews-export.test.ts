// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CSV_BOM, boundedCsv, datedCsvFileName, toCsv } from "@/lib/format/csv";
import { parseCsv } from "@/lib/products/csv";
import { buildReviewImportPlan } from "@/lib/reviews/import";
import {
  REVIEW_AUTHOR_MAX,
  REVIEW_BODY_MAX,
  REVIEW_EXPORT_BYTES_MAX,
  REVIEW_EXPORT_PAGE_SIZE,
  REVIEW_EXPORT_ROWS_MAX,
  REVIEW_IMPORT_BYTES_MAX,
  REVIEW_IMPORT_ROWS_MAX,
  REVIEW_TITLE_MAX,
} from "@/lib/reviews/limits";
import { REVIEWS_CSV_COLUMNS, isReviewPublished, reviewsCsv, reviewsCsvFileName } from "@/lib/reviews/export";
import {
  DEFAULT_REVIEW_FILTERS,
  parseSellerReviewFilters,
  reviewsExportHref,
  type SellerReviewFilters,
} from "@/lib/reviews/seller-filters";
import { REVIEWS_EXPORT_API_PATH } from "@/lib/reviews/paths";
import type { SellerReview } from "@/types/review";

/**
 * The reviews export (lib/reviews/export.ts and its route): what the file
 * holds, what a spreadsheet must never run from it, that it stays small
 * whatever the reviews say, that the database is not read past a full file,
 * and that the importer knows it for what it is.
 */

// ---- A stand-in database: one store's reviews, served a range at a time. ----

const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  ranges: [] as [number, number][],
  calls: [] as unknown[][],
  failOnRead: null as number | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "or", "order"]) {
        query[method] = (...args: unknown[]) => {
          db.calls.push([method, ...args]);
          return query;
        };
      }
      query.range = (from: number, to: number) => {
        db.ranges.push([from, to]);
        const failed = db.failOnRead === db.ranges.length;
        return Promise.resolve(
          failed
            ? { data: null, error: { message: "connection reset" } }
            : { data: db.rows.slice(from, to + 1), error: null },
        );
      };
      return query;
    },
  }),
}));

const { sellerReviewsForExport } = await import("@/lib/reviews/seller-queries");

beforeEach(() => {
  db.rows = [];
  db.ranges = [];
  db.calls = [];
  db.failOnRead = null;
});

function dbRow(index: number): Record<string, unknown> {
  return {
    id: `r-${index}`,
    product_id: "p-1",
    rating: 5,
    title: `Review ${index}`,
    body: "Lovely.",
    author_name: "Ana",
    is_verified_buyer: false,
    source: "judgeme",
    reviewed_at: "2026-10-01T10:00:00.000Z",
    moderation_status: "clean",
    moderation_ground: null,
    hidden_reason: null,
    products: { title: "Lamp", image_key: "products/u/lamp.webp" },
  };
}

// ---- Fixtures ----

function review(patch: Partial<SellerReview> = {}): SellerReview {
  return {
    id: "6f1c1d1e-0000-4000-8000-000000000001",
    productId: "9a9a9a9a-0000-4000-8000-000000000002",
    productTitle: "Brass Desk Lamp",
    productImageUrl: null,
    rating: 5,
    title: "Beautiful finish",
    body: "The brass has a soft brushed finish.",
    authorName: "Eva Nováková",
    verified: true,
    source: "native",
    reviewedAt: "2026-10-01T09:30:00.000Z",
    moderation: "clean",
    ground: null,
    hiddenReason: null,
    ...patch,
  };
}

/** A stream of `count` reviews that records how many the consumer asked for. */
function stream(count: number, make: (index: number) => SellerReview = (index) => review({ id: `r-${index}` })) {
  const pulled = { count: 0 };
  async function* reviews() {
    for (let index = 0; index < count; index++) {
      pulled.count += 1;
      yield make(index);
    }
  }
  return { reviews: reviews(), pulled };
}

async function* from(list: SellerReview[]) {
  yield* list;
}

/** The file's lines without the byte-order mark, the trailing line ending dropped. */
function lines(csv: string): string[] {
  expect(csv.startsWith(CSV_BOM)).toBe(true);
  return csv.slice(CSV_BOM.length).replace(/\r\n$/, "").split("\r\n");
}

const utf8 = (text: string) => Buffer.byteLength(text, "utf8");

// ---- boundedCsv ----

describe("boundedCsv", () => {
  it("writes exactly what toCsv writes while the rows fit", () => {
    const rows = [["a", 1], ["b, c", null], ["=SUM(A1)", "-2"]] as const;
    const file = boundedCsv(["name", "n"], 1_000);
    for (const row of rows) expect(file.add(row)).toBe(true);
    expect(file.toString()).toBe(toCsv(["name", "n"], rows));
    expect(file.rows).toBe(3);
  });

  it("counts the bytes it will be served as, byte-order mark included", () => {
    const file = boundedCsv(["text"], 10_000);
    file.add(["café"]);
    file.add(["日本語のレビュー"]);
    expect(file.bytes).toBe(utf8(file.toString()));
  });

  it("refuses the row that would pass the budget, and every row after it", () => {
    const header = boundedCsv(["text"], 1_000).bytes;
    // Room for exactly two ten-byte rows ("aaaaaaaa" + CRLF).
    const file = boundedCsv(["text"], header + 20);
    expect(file.add(["aaaaaaaa"])).toBe(true);
    expect(file.add(["bbbbbbbb"])).toBe(true);
    expect(file.add(["c"])).toBe(false);
    // A row that would fit is still refused: the file is a prefix, never a sample.
    expect(file.add([""])).toBe(false);
    expect(file.rows).toBe(2);
    expect(file.bytes).toBe(header + 20);
    expect(utf8(file.toString())).toBe(header + 20);
  });

  it("prices multi-byte text at its UTF-8 weight, not its length", () => {
    const header = boundedCsv(["text"], 1_000).bytes;
    // Five characters and fifteen bytes do not fit in ten; five ASCII ones do.
    expect(boundedCsv(["text"], header + 10).add(["レビュー！"])).toBe(false);
    expect(boundedCsv(["text"], header + 10).add(["abcde"])).toBe(true);
  });
});

describe("file names", () => {
  it("are branded and dated in UTC", () => {
    const late = new Date("2026-10-28T23:30:00-05:00");
    expect(reviewsCsvFileName(late)).toBe("square-share-reviews-2026-10-29.csv");
    expect(datedCsvFileName("orders", late)).toBe("square-share-orders-2026-10-29.csv");
  });
});

// ---- The file ----

describe("reviewsCsv", () => {
  it("starts with the contract header", async () => {
    const { csv } = await reviewsCsv(from([]));
    expect(lines(csv)).toEqual([
      "review_id,review_date,product_title,product_id,rating,title,body,reviewer_name,verified_buyer,source,published,moderation_status,hidden_reason,moderation_ground,exported_from",
    ]);
  });

  it("an empty view is the header alone, and not cut short", async () => {
    const result = await reviewsCsv(from([]));
    expect(result).toMatchObject({ rows: 0, truncated: false });
  });

  it("writes one review's cells in column order", async () => {
    const { csv } = await reviewsCsv(from([review()]));
    expect(lines(csv)[1]).toBe(
      "6f1c1d1e-0000-4000-8000-000000000001,2026-10-01T09:30:00.000Z,Brass Desk Lamp,9a9a9a9a-0000-4000-8000-000000000002,5,Beautiful finish,The brass has a soft brushed finish.,Eva Nováková,true,native,true,clean,,,Square Share",
    );
  });

  it("says a review is published only when buyers can see it", () => {
    expect(isReviewPublished(review())).toBe(true);
    expect(isReviewPublished(review({ hiddenReason: "spam" }))).toBe(false);
    expect(isReviewPublished(review({ moderation: "held", ground: "scam" }))).toBe(false);
    expect(isReviewPublished(review({ moderation: "pending" }))).toBe(false);
    expect(isReviewPublished(review({ moderation: "blocked", ground: "hate_speech" as SellerReview["ground"] }))).toBe(false);
  });

  it("keeps the seller's reason and the check's verdict apart", async () => {
    const { csv } = await reviewsCsv(
      from([review({ hiddenReason: "personal_info", moderation: "held", ground: "scam", title: null, verified: false })]),
    );
    const cells = lines(csv)[1]!.split(",");
    const at = (column: (typeof REVIEWS_CSV_COLUMNS)[number]) => cells[REVIEWS_CSV_COLUMNS.indexOf(column)];
    expect(at("title")).toBe("");
    expect(at("verified_buyer")).toBe("false");
    expect(at("published")).toBe("false");
    expect(at("moderation_status")).toBe("held");
    expect(at("hidden_reason")).toBe("personal_info");
    expect(at("moderation_ground")).toBe("scam");
  });

  it("never lets what a buyer typed run as a formula", async () => {
    const { csv } = await reviewsCsv(
      from([
        review({
          title: '=HYPERLINK("http://evil.example","Click")',
          body: "+1 would buy again",
          authorName: "@admin",
          productTitle: "-Lamp",
        }),
      ]),
    );
    const row = lines(csv)[1]!;
    expect(row).toContain(`"'=HYPERLINK(""http://evil.example"",""Click"")"`);
    expect(row).toContain("'+1 would buy again");
    expect(row).toContain("'@admin");
    expect(row).toContain("'-Lamp");
    // The rating stays a number a column can average.
    expect(row).toContain(",5,");
  });

  it("quotes a review that spans lines or holds commas and quotes", async () => {
    const { csv } = await reviewsCsv(from([review({ body: 'Line one,\nline "two"' })]));
    expect(csv).toContain(`"Line one,\nline ""two"""`);
  });

  it("stops at the row cap, and stops READING one review past it", async () => {
    const { reviews, pulled } = stream(50);
    const result = await reviewsCsv(reviews, { maxRows: 10, maxBytes: 1_000_000 });
    expect(result).toMatchObject({ rows: 10, truncated: true });
    expect(lines(result.csv)).toHaveLength(11);
    // The eleventh is the one that proves there is more; nothing past it is read.
    expect(pulled.count).toBe(11);
  });

  it("a view of exactly the cap is whole, not cut short", async () => {
    const { reviews } = stream(10);
    expect(await reviewsCsv(reviews, { maxRows: 10, maxBytes: 1_000_000 })).toMatchObject({ rows: 10, truncated: false });
  });

  it("stops at the byte cap whatever the row count, and never passes it", async () => {
    const long = "é".repeat(REVIEW_BODY_MAX);
    const { reviews, pulled } = stream(100, (index) => review({ id: `r-${index}`, body: long }));
    const maxBytes = 100_000;
    const result = await reviewsCsv(reviews, { maxRows: 1_000, maxBytes });
    expect(result.truncated).toBe(true);
    expect(utf8(result.csv)).toBeLessThanOrEqual(maxBytes);
    // Ten thousand bytes of body a row: nine fit in a hundred thousand.
    expect(result.rows).toBe(9);
    expect(pulled.count).toBe(10);
  });

  it("by default holds at most the importer's rows, and its bytes", async () => {
    expect(REVIEW_EXPORT_ROWS_MAX).toBe(REVIEW_IMPORT_ROWS_MAX);
    expect(REVIEW_EXPORT_BYTES_MAX).toBe(REVIEW_IMPORT_BYTES_MAX);

    const { reviews } = stream(REVIEW_EXPORT_ROWS_MAX + 500);
    const byRows = await reviewsCsv(reviews);
    expect(byRows).toMatchObject({ rows: REVIEW_EXPORT_ROWS_MAX, truncated: true });

    // The heaviest review the database allows, in three-byte characters.
    const heaviest = (index: number) =>
      review({
        id: `r-${index}`,
        title: "評".repeat(REVIEW_TITLE_MAX),
        body: "評".repeat(REVIEW_BODY_MAX),
        authorName: "評".repeat(REVIEW_AUTHOR_MAX),
        productTitle: "評".repeat(200),
      });
    const { reviews: heavy } = stream(REVIEW_EXPORT_ROWS_MAX, heaviest);
    const byBytes = await reviewsCsv(heavy);
    expect(byBytes.truncated).toBe(true);
    expect(utf8(byBytes.csv)).toBeLessThanOrEqual(REVIEW_EXPORT_BYTES_MAX);
    // Even at the worst, a cut-short file is still a useful one.
    expect(byBytes.rows).toBeGreaterThan(150);
  });
});

// ---- Read back by the importer ----

describe("the importer knows an export", () => {
  const ID_A = "6f1c1d1e-0000-4000-8000-00000000000a";
  const ID_B = "6f1c1d1e-0000-4000-8000-00000000000b";
  const ID_C = "6f1c1d1e-0000-4000-8000-00000000000c";

  it("carries the watermark on every row, as a plain last column", async () => {
    const { csv } = await reviewsCsv(from([review({ id: ID_A }), review({ id: ID_B, body: "Two\nlines" })]));
    expect(REVIEWS_CSV_COLUMNS.at(-1)).toBe("exported_from");
    const plan = parseCsv(csv);
    expect(plan[0]!.at(-1)).toBe("exported_from");
    expect(plan.slice(1).map((row) => row.at(-1))).toEqual(["Square Share", "Square Share"]);
    expect(plan.slice(1).every((row) => row.length === REVIEWS_CSV_COLUMNS.length)).toBe(true);
  });

  it("reads every review's id and offers nothing to write, published or not", async () => {
    const { csv } = await reviewsCsv(
      from([
        review({ id: ID_A, source: "native", verified: true }),
        review({ id: ID_B, hiddenReason: "spam" }),
        review({ id: ID_C, moderation: "held", ground: "scam" }),
      ]),
    );
    const plan = buildReviewImportPlan(csv, Date.UTC(2026, 9, 28));
    expect(plan.squareShare).toEqual({ reviewIds: [ID_A, ID_B, ID_C], unreadable: 0 });
    expect(plan).toMatchObject({ rows: [], missing: [], hidden: 0, dropped: 0, source: null });
  });

  it("knows a file exported before the watermark column", async () => {
    const { csv } = await reviewsCsv(from([review({ id: ID_A })]));
    const old = csv
      .split("\r\n")
      .map((line) => line.slice(0, Math.max(0, line.lastIndexOf(","))))
      .join("\r\n");
    expect(old).not.toContain("exported_from");
    expect(buildReviewImportPlan(old).squareShare).toEqual({ reviewIds: [ID_A], unreadable: 0 });
  });

  it("counts a row whose id was edited away, and rows past the file limit", () => {
    const rows = Array.from({ length: REVIEW_IMPORT_ROWS_MAX + 2 }, () => `${ID_A},Square Share`);
    rows[0] = "not-an-id,Square Share";
    const plan = buildReviewImportPlan(["review_id,exported_from", ...rows].join("\n"));
    expect(plan.squareShare).toMatchObject({ unreadable: 1 });
    expect(plan.squareShare!.reviewIds).toHaveLength(REVIEW_IMPORT_ROWS_MAX - 1);
    expect(plan.dropped).toBe(2);
  });

  it("still treats a watermarked file with no ids as an export, never as a new import", () => {
    const plan = buildReviewImportPlan("rating,reviewer_name,review_date,product_title,exported_from\n5,Ana,2026-01-01,Lamp,Square Share");
    expect(plan.squareShare).toEqual({ reviewIds: [], unreadable: 1 });
    expect(plan.rows).toEqual([]);
  });

  it("leaves another app's export alone, even one with an id column", () => {
    const plan = buildReviewImportPlan(
      "review_id,title,body,rating,review_date,reviewer_name,product_handle\n1,Nice,Good,5,2024-03-01 10:00:00 UTC,Dana,mug",
      Date.UTC(2026, 9, 28),
    );
    expect(plan.squareShare).toBeNull();
    expect(plan.rows).toHaveLength(1);
  });
});

// ---- The view, through the URL ----

describe("reviewsExportHref", () => {
  it("is the bare route for the plain view", () => {
    expect(reviewsExportHref(DEFAULT_REVIEW_FILTERS)).toBe(REVIEWS_EXPORT_API_PATH);
  });

  it("carries the whole view, and the page's parser reads the same view back", () => {
    const view: SellerReviewFilters = {
      status: "held",
      search: 'fell apart, "fast" & 50%',
      rating: 1,
      productId: "9a9a9a9a-0000-4000-8000-000000000002",
      origin: "imported",
      sort: "oldest",
    };
    const href = reviewsExportHref(view);
    expect(href.startsWith(`${REVIEWS_EXPORT_API_PATH}?`)).toBe(true);
    const params = Object.fromEntries(new URL(href, "http://localhost").searchParams);
    expect(parseSellerReviewFilters(params).filters).toEqual(view);
    // Every page of the view, so no page number.
    expect(href).not.toContain("page=");
  });
});

// ---- The database reader ----

describe("sellerReviewsForExport", () => {
  async function drain(limit: number, filters: SellerReviewFilters = DEFAULT_REVIEW_FILTERS) {
    const out: SellerReview[] = [];
    for await (const row of sellerReviewsForExport("seller-1", filters, limit)) out.push(row);
    return out;
  }

  it("reads only this store's reviews, in the view's order, a page at a time", async () => {
    db.rows = Array.from({ length: REVIEW_EXPORT_PAGE_SIZE * 2 + 3 }, (_, index) => dbRow(index));
    const out = await drain(10_000, { ...DEFAULT_REVIEW_FILTERS, rating: 5, sort: "lowest" });
    expect(out).toHaveLength(REVIEW_EXPORT_PAGE_SIZE * 2 + 3);
    expect(db.ranges).toEqual([
      [0, REVIEW_EXPORT_PAGE_SIZE - 1],
      [REVIEW_EXPORT_PAGE_SIZE, REVIEW_EXPORT_PAGE_SIZE * 2 - 1],
      [REVIEW_EXPORT_PAGE_SIZE * 2, REVIEW_EXPORT_PAGE_SIZE * 3 - 1],
    ]);
    expect(db.calls).toContainEqual(["eq", "seller_id", "seller-1"]);
    expect(db.calls).toContainEqual(["eq", "rating", 5]);
    expect(db.calls).toContainEqual(["order", "rating", { ascending: true }]);
    // A file has no use for a link that expires.
    expect(out[0]!.productImageUrl).toBeNull();
    expect(out[0]).toMatchObject({ id: "r-0", productTitle: "Lamp", source: "judgeme", moderation: "clean" });
  });

  it("never reads past its limit", async () => {
    db.rows = Array.from({ length: 2_000 }, (_, index) => dbRow(index));
    const out = await drain(REVIEW_EXPORT_PAGE_SIZE + 1);
    expect(out).toHaveLength(REVIEW_EXPORT_PAGE_SIZE + 1);
    expect(db.ranges).toEqual([
      [0, REVIEW_EXPORT_PAGE_SIZE - 1],
      [REVIEW_EXPORT_PAGE_SIZE, REVIEW_EXPORT_PAGE_SIZE],
    ]);
  });

  it("reads the next page only when the file asks for it", async () => {
    db.rows = Array.from({ length: 2_000 }, (_, index) => dbRow(index));
    // A file full after three reviews stops the reads on the first page.
    await reviewsCsv(sellerReviewsForExport("seller-1", DEFAULT_REVIEW_FILTERS, 5_001), { maxRows: 3, maxBytes: 1_000_000 });
    expect(db.ranges).toHaveLength(1);
  });

  it("fails loudly rather than ending early when a page cannot be read", async () => {
    db.rows = Array.from({ length: 1_200 }, (_, index) => dbRow(index));
    db.failOnRead = 2;
    await expect(drain(5_001)).rejects.toThrow(/Reviews export read failed: connection reset/);
  });
});

// ---- The route's guards, pinned in its source ----

describe("import route on an export", () => {
  const source = readFileSync(join(process.cwd(), "src", "app", "api", "sellers", "import-reviews", "route.ts"), "utf8");

  it("refuses before it reads a mapping or touches the database", () => {
    const refusal = source.indexOf('error: "square_share_export"');
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(source.indexOf("createAdminClient()"));
  });
});

describe("export route invariants", () => {
  const source = readFileSync(join(process.cwd(), "src", "app", "api", "sellers", "export-reviews", "route.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("spends the member's budget and the store's, both from the registry, before reading", () => {
    expect(source).toMatch(/rateLimit\(\s*"reviews_export",\s*RATE_LIMITS\.reviewsExport\s*\)/);
    expect(source).toMatch(/rateLimitKey\(\s*account\.accountId,\s*"reviews_export_store",\s*RATE_LIMITS\.reviewsExportPerStore\s*\)/);
    expect(source.indexOf("RATE_LIMITS.reviewsExportPerStore")).toBeLessThan(source.indexOf("sellerReviewsForExport("));
    expect(source.match(/refuse\(429/g)).toHaveLength(2);
  });

  it("scopes to the session's store and checks the page's permission", () => {
    expect(source).toContain("sellerReviewsForExport(account.accountId,");
    expect(source).toContain('can(account.role, "store.read")');
  });

  it("is never cached", () => {
    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toContain('"Cache-Control": "no-store"');
  });
});
