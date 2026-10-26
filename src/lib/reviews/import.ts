import { msg, type MessageRef } from "@/i18n/types";
import { htmlToText, parseCsv } from "@/lib/products/csv";
import { reviewContent } from "@/lib/validation/reviews";
import { REVIEW_IMPORT_ROWS_MAX } from "@/lib/reviews/limits";
import type { ReviewImportSource } from "@/lib/reviews/sources";

/**
 * Reading a seller's reviews out of a Shopify review app's export, so moving
 * to Square Share does not cost them their history.
 *
 * CLIENT-SAFE AND SERVER-USED, like the product importer (lib/products/csv.ts,
 * whose RFC 4180 parser this shares). The browser runs it for the preview and
 * the product mapping; the import route runs the SAME functions on the
 * uploaded text before writing anything, and never trusts a row the client
 * claims to have parsed.
 *
 * THE FORMATS. Judge.me, Loox, Yotpo and Shopify's own Product Reviews each
 * export a CSV with their own column names. Rather than four parsers, each
 * field has a list of the names those apps use for it (FIELD_ALIASES), and
 * the app is recognised from columns only it writes (detectReviewSource).
 *
 * WHICH PRODUCT. Square Share products have no SKU or handle of their own, so
 * a review's product is the export's product key (SKU, barcode, handle, title
 * or id, the first the file has), matched to a product here by its slug
 * (suggestProductMatches) and confirmed or corrected by the seller, one
 * product key at a time. A key the seller leaves unmatched is skipped.
 *
 * WHAT IS DELIBERATELY NOT IMPORTED: reviewer emails and IP addresses (never
 * read, so never stored), photos (fetching URLs from a spreadsheet is the
 * same SSRF problem the product importer declines), seller replies, and rows
 * the app marked as spam or hidden.
 */

export type ReviewImportField = "rating" | "title" | "body" | "author" | "date" | "product" | "status";

export type ReviewColumnMap = Record<ReviewImportField, number | null>;

/** Column names per field, compared after normalizeHeader. Product keys are
 *  listed most specific first: a SKU beats a handle beats a title. */
const FIELD_ALIASES: Record<ReviewImportField, readonly string[]> = {
  rating: ["rating", "reviewscore", "score", "stars"],
  title: ["title", "reviewtitle"],
  body: ["body", "review", "reviewcontent", "content", "reviewbody"],
  author: ["reviewername", "author", "displayname", "nickname", "fullname", "name"],
  date: ["reviewdate", "date", "createdat", "submittedat"],
  product: [
    "sku",
    "productsku",
    "variantsku",
    "barcode",
    "gtin",
    "producthandle",
    "handle",
    "producttitle",
    "productname",
    "productid",
  ],
  status: ["curated", "state", "status", "published"],
};

/** Status values meaning the review was not shown on the old store. */
const HIDDEN_STATUSES = new Set(["spam", "hidden", "unpublished", "rejected", "deleted", "archived", "false", "no", "0"]);

/** "Reviewer Name", "reviewer_name" and "reviewerName" are the same column. */
function normalizeHeader(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function guessReviewColumns(header: readonly string[]): ReviewColumnMap {
  const normalized = header.map(normalizeHeader);
  const find = (aliases: readonly string[]) => {
    for (const alias of aliases) {
      const index = normalized.indexOf(alias);
      if (index !== -1) return index;
    }
    return null;
  };
  return {
    rating: find(FIELD_ALIASES.rating),
    title: find(FIELD_ALIASES.title),
    body: find(FIELD_ALIASES.body),
    author: find(FIELD_ALIASES.author),
    date: find(FIELD_ALIASES.date),
    product: find(FIELD_ALIASES.product),
    status: find(FIELD_ALIASES.status),
  };
}

/** Which app wrote this export, from columns only that app writes. */
export function detectReviewSource(header: readonly string[]): ReviewImportSource | null {
  const has = (name: string) => header.some((column) => normalizeHeader(column) === name);
  if (has("curated") || has("metaobjecthandle") || (has("reviewername") && has("producthandle"))) return "judgeme";
  if (has("reviewscore") || has("reviewcontent")) return "yotpo";
  if (has("nickname") || has("fullname") || has("verifiedpurchase")) return "loox";
  if (has("author") && has("producthandle")) return "shopify";
  return null;
}

/** The fields a file cannot be imported without. */
export const REQUIRED_REVIEW_FIELDS: readonly ReviewImportField[] = ["rating", "author", "date", "product"];

/**
 * A product key or title as a comparable slug: "Linen Shirt (Blue)" and
 * "linen-shirt-blue" are the same product. Accents are folded, so
 * "Café mug" meets "cafe-mug".
 */
export function slugKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Why a row cannot be imported (Validation.reviewImport.<problem>). */
export type ReviewImportProblem = "rating" | "title" | "body" | "author" | "date" | "product";

export function reviewImportProblemMessage(problem: ReviewImportProblem): MessageRef {
  return msg(`Validation.reviewImport.${problem}`);
}

export type ReviewImportRow = {
  /** 1-based line in the file. */
  line: number;
  /** The export's product key as written; matched by its slug. */
  productKey: string;
  rating: number;
  title: string;
  body: string;
  author: string;
  /** ISO timestamp of the original review. */
  reviewedAt: string;
  problem: ReviewImportProblem | null;
};

export type ReviewImportPlan = {
  header: string[];
  columns: ReviewColumnMap;
  source: ReviewImportSource | null;
  /** Required fields the file has no column for. Non-empty means nothing imports. */
  missing: ReviewImportField[];
  rows: ReviewImportRow[];
  /** Rows the old store had hidden or flagged as spam, left out. */
  hidden: number;
  /** Rows past REVIEW_IMPORT_ROWS_MAX, left out. */
  dropped: number;
};

/** Reviews older than this are a typo or a bad column, not a review. */
const EARLIEST_REVIEW = Date.UTC(2000, 0, 1);

/** "4", "4.0" and "5 stars" read; "4.5" and "6" do not. */
function parseRating(raw: string): number | null {
  const match = /^\s*(\d+)(?:\.0+)?(?![\d.])/.exec(raw);
  return match ? Number(match[1]) : null;
}

function parseDate(raw: string, now: number): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // "2023-05-01 12:34:56 UTC" (Judge.me) and "... +0000" are ISO 8601 with a
  // space in place of the T; Date.parse reads neither as written.
  const iso = /^\d{4}-\d{2}-\d{2} \d/.test(trimmed)
    ? trimmed.replace(" ", "T").replace(/\s*(?:UTC|GMT)$/i, "Z").replace(/\s+([+-]\d{2}:?\d{2})$/, "$1")
    : trimmed;
  const time = Date.parse(iso);
  // A day of slack for time zones: "today" in the reviewer's zone may be
  // tomorrow in UTC.
  if (Number.isNaN(time) || time < EARLIEST_REVIEW || time > now + 24 * 60 * 60 * 1000) return null;
  return new Date(time).toISOString();
}

/**
 * The whole file, read: every row as it would be written, or why it cannot
 * be. Each row passes the same field gates a buyer's review does
 * (lib/validation/reviews.ts), so an import is a faster way to the reviews
 * table, never a softer one.
 */
export function buildReviewImportPlan(text: string, now: number = Date.now()): ReviewImportPlan {
  const [header = [], ...records] = parseCsv(text);
  const columns = guessReviewColumns(header);
  const missing = REQUIRED_REVIEW_FIELDS.filter((field) => columns[field] === null);
  const cell = (record: readonly string[], field: ReviewImportField) => {
    const index = columns[field];
    return index === null ? "" : (record[index] ?? "").trim();
  };

  const rows: ReviewImportRow[] = [];
  let hidden = 0;
  let dropped = 0;
  records.forEach((record, index) => {
    if (HIDDEN_STATUSES.has(cell(record, "status").toLowerCase())) {
      hidden += 1;
      return;
    }
    if (rows.length >= REVIEW_IMPORT_ROWS_MAX) {
      dropped += 1;
      return;
    }
    const rating = parseRating(cell(record, "rating"));
    const title = reviewContent.title.safeParse(htmlToText(cell(record, "title")));
    const body = reviewContent.body.safeParse(htmlToText(cell(record, "body")));
    const author = reviewContent.authorName.safeParse(htmlToText(cell(record, "author")));
    const reviewedAt = parseDate(cell(record, "date"), now);
    const productKey = cell(record, "product");

    const problem: ReviewImportProblem | null = !slugKey(productKey)
      ? "product"
      : rating === null || !reviewContent.rating.safeParse(rating).success
        ? "rating"
        : !author.success
          ? "author"
          : !body.success
            ? "body"
            : !title.success
              ? "title"
              : !reviewedAt
                ? "date"
                : null;

    rows.push({
      // +2: one for the header, one because lines count from 1.
      line: index + 2,
      productKey,
      rating: rating ?? 0,
      title: title.success ? title.data : "",
      body: body.success ? body.data : "",
      author: author.success ? author.data : "",
      reviewedAt: reviewedAt ?? "",
      problem,
    });
  });

  return { header, columns, source: detectReviewSource(header), missing, rows, hidden, dropped };
}

/** One product key in the file and how many importable reviews carry it. */
export type ReviewProductKey = { key: string; slug: string; count: number };

/** The file's product keys, most reviewed first. */
export function reviewProductKeys(plan: ReviewImportPlan): ReviewProductKey[] {
  const keys = new Map<string, ReviewProductKey>();
  for (const row of plan.rows) {
    if (row.problem !== null) continue;
    const slug = slugKey(row.productKey);
    const entry = keys.get(slug) ?? { key: row.productKey, slug, count: 0 };
    entry.count += 1;
    keys.set(slug, entry);
  }
  return [...keys.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** A seller's product as the matcher sees it. */
export type MatchableProduct = { id: string; title: string; identifier: string | null };

/**
 * A first guess at which product each key is: the product whose title or
 * product identifier has the same slug. A handle is its product's title
 * slugged, so a store whose titles came over with the product import matches
 * itself. Keys are matched by slug, never by raw text.
 */
export function suggestProductMatches(
  keys: readonly ReviewProductKey[],
  products: readonly MatchableProduct[],
): Record<string, string | null> {
  const bySlug = new Map<string, string>();
  for (const product of products) {
    for (const candidate of [product.identifier, product.title]) {
      const slug = candidate ? slugKey(candidate) : "";
      if (slug && !bySlug.has(slug)) bySlug.set(slug, product.id);
    }
  }
  return Object.fromEntries(keys.map(({ slug }) => [slug, bySlug.get(slug) ?? null]));
}
