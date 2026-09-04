import { CURRENCIES, type Currency, type ProductStatus } from "@/types/product";

/**
 * Reading a product catalogue out of a CSV, so a seller moving from Shopify (or
 * anywhere else) does not retype it.
 *
 * CLIENT-SAFE AND SERVER-USED, on purpose. The browser runs this to show a
 * preview of exactly what will land, and the server action runs the SAME
 * functions on the uploaded text before writing anything. The preview is a
 * courtesy; the server's parse is the boundary, and it never trusts a row the
 * client claims to have parsed. That is why nothing here reaches for the
 * network, the filesystem or a database: it is a pure text-to-rows function.
 *
 * WHAT IS DELIBERATELY NOT IMPORTED, and why:
 *
 * - PHOTOS. Shopify's export references images by URL, and fetching a URL a
 *   stranger put in a spreadsheet is a server-side request forgery waiting to
 *   happen: the fetch would run from inside our network, against whatever host
 *   the file names. Doing it safely needs its own guards (public-IP checks, a
 *   content sniff, a size cap, a timeout, a per-import budget), which is a
 *   piece of work in its own right rather than a line in this parser. Products
 *   arrive without photos and the seller adds them, which is the honest
 *   version of "we did not build that yet".
 * - VARIANTS. A Shopify export writes one ROW PER VARIANT, all sharing a
 *   Handle. We keep the first row of each handle as the product and count the
 *   rest, so a 3-size shirt imports as one shirt rather than three, and the
 *   seller is told how many variant rows were folded in.
 */

/** How many rows one import may carry. Sized for a real catalogue move while
 *  bounding the work a single request can ask of the database. */
export const IMPORT_ROWS_MAX = 200;

/** Bytes of CSV one upload may carry. IMPORT_ROWS_MAX rows of ordinary product
 *  copy fit inside this many times over; it exists so a huge file is refused
 *  before it is read rather than after. */
export const IMPORT_BYTES_MAX = 2 * 1024 * 1024;

/** Longest single field we will look at, so a pathological cell cannot make
 *  the parser do unbounded work building one enormous string. */
const FIELD_CHARS_MAX = 100_000;

/**
 * Control characters the app's text gates refuse, built from CODES so this
 * file carries none of them literally (a raw control byte in source is
 * invisible in review and survives copy-paste badly). Tab and newline are
 * deliberately absent: a description legitimately contains both.
 */
const CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g",
);

/**
 * Split CSV text into rows of raw cells (RFC 4180).
 *
 * Hand-written rather than a dependency because the rules are small and the
 * failure modes matter: a description with a comma, a newline inside a quoted
 * cell, and a doubled quote ("") meaning one literal quote are all things a
 * real Shopify export contains, and a naive `split(",")` corrupts every one of
 * them silently. Silent corruption is the worst outcome for an importer, so
 * this handles the quoting rules properly.
 *
 * Tolerant where tolerance is safe: CRLF or LF, a trailing newline, and a BOM
 * (Excel writes one) are all accepted.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // Excel prefixes UTF-8 files with a BOM; left in, it becomes part of the
  // first header name and every column lookup misses.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  function endField() {
    row.push(field);
    field = "";
  }
  function endRow() {
    endField();
    // A blank line is not a record. Trailing newlines are normal, and a row of
    // one empty cell is what they parse to.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          if (field.length < FIELD_CHARS_MAX) field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      if (field.length < FIELD_CHARS_MAX) field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // CRLF or a lone CR both end the record.
      if (text[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }
    if (field.length < FIELD_CHARS_MAX) field += char;
    i += 1;
  }
  // Whatever is left when the text runs out is the last record, unless the
  // file ended on a newline and there is nothing pending.
  if (field !== "" || row.length > 0 || quoted) endRow();
  return rows;
}

/** The fields an imported product can be built from. Every one is optional
 *  except the title and the price, which are what makes a row a product. */
export type ImportField = "title" | "description" | "price" | "sku" | "stock";

export const IMPORT_FIELDS: readonly ImportField[] = [
  "title",
  "description",
  "price",
  "sku",
  "stock",
];

/** A mapping from each field to the CSV column index that feeds it, or null
 *  for "this file has nothing for that". */
export type ColumnMap = Record<ImportField, number | null>;

/**
 * Header names we recognise, lowercased, in preference order.
 *
 * Shopify's own names come first so its export maps with nothing to correct,
 * then the plain words other tools use. A seller can always fix the mapping by
 * hand; this only has to be right often enough that most people never look.
 */
const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  title: ["title", "name", "product title", "product name", "product"],
  description: ["body (html)", "body", "description", "product description"],
  price: ["variant price", "price", "unit price", "amount"],
  sku: ["variant sku", "sku", "barcode", "code", "reference"],
  stock: [
    "variant inventory qty",
    "variant inventory quantity",
    "inventory quantity",
    "quantity",
    "stock",
    "qty",
    "on hand",
  ],
};

/** Which column each field should read, guessed from the header row. */
export function guessColumns(header: readonly string[]): ColumnMap {
  const normalised = header.map((name) => name.trim().toLowerCase());
  const map = {} as ColumnMap;
  for (const field of IMPORT_FIELDS) {
    let found: number | null = null;
    for (const alias of HEADER_ALIASES[field]) {
      const index = normalised.indexOf(alias);
      if (index !== -1) {
        found = index;
        break;
      }
    }
    map[field] = found;
  }
  return map;
}

/** A Shopify product export, which we can say more about than a generic file:
 *  it groups variants by Handle and writes descriptions as HTML. */
export function isShopifyExport(header: readonly string[]): boolean {
  const normalised = new Set(header.map((name) => name.trim().toLowerCase()));
  return normalised.has("handle") && normalised.has("title");
}

/** The Handle column, when there is one. Rows sharing a handle are one product
 *  in Shopify's format, listed once per variant. */
function handleColumn(header: readonly string[]): number | null {
  const index = header.findIndex((name) => name.trim().toLowerCase() === "handle");
  return index === -1 ? null : index;
}

/**
 * HTML to the plain text this app stores.
 *
 * Shopify writes descriptions as HTML and nothing in this product renders
 * markup: descriptions are React text nodes, split into paragraphs. So the
 * tags have to go, and what matters is that the RESULT is plain text, which is
 * exactly what this returns. It is not a sanitiser guarding a markup sink
 * (there is no such sink), it is a converter: block tags become line breaks,
 * every other tag is dropped, and the handful of entities a description
 * actually contains are decoded.
 */
export function htmlToText(html: string): string {
  return (
    html
      // Drop whole elements whose CONTENT is not prose, before stripping tags,
      // so their bodies do not survive as text.
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      // Block boundaries become line breaks so paragraphs survive the trip.
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n\n")
      .replace(/<li\b[^>]*>/gi, "- ")
      .replace(/<[^>]*>/g, "")
      // The entities that actually turn up in product copy. `&amp;` is decoded
      // LAST so "&amp;lt;" comes out as the literal "&lt;" it encodes.
      .replace(/&nbsp;/gi, " ")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
      // Control characters the text gates would reject anyway, and runaway
      // blank space from the block replacements above.
      .replace(CONTROL_CHARS, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * A price cell to integer cents, or null when it is not a number.
 *
 * Handles what spreadsheets actually contain: a currency symbol, thousands
 * separators, and either decimal convention ("1,299.00" and "1.299,00" both
 * mean the same money). The rule for telling them apart is the LAST separator
 * present: whichever of "." or "," appears last is the decimal point, because
 * a thousands separator can never be the final one.
 */
export function parsePriceCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Keep digits and separators; drop currency symbols, spaces, and the rest.
  const cleaned = trimmed.replace(/[^\d.,-]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  let normalised: string;
  if (lastDot === -1 && lastComma === -1) {
    normalised = cleaned;
  } else {
    const decimalAt = Math.max(lastDot, lastComma);
    const whole = cleaned.slice(0, decimalAt).replace(/[.,]/g, "");
    const fraction = cleaned.slice(decimalAt + 1).replace(/[.,]/g, "");
    // A group of exactly three digits after the last separator with no other
    // separator before it is a thousands group, not cents: "1,200" is 1200.
    normalised =
      fraction.length === 3 && !/[.,]/.test(cleaned.slice(0, decimalAt))
        ? `${whole}${fraction}`
        : `${whole}.${fraction}`;
  }

  const value = Number(normalised);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** One row as it will be written, or the reason it cannot be. */
export type ImportRow = {
  /** 1-based line in the file, for a message that points at something. */
  line: number;
  title: string;
  description: string;
  priceCents: number | null;
  sku: string;
  stock: number | null;
  status: ProductStatus;
  /** Why this row will be skipped, or null when it is good to import. */
  problem: string | null;
};

export type ImportPlan = {
  header: string[];
  columns: ColumnMap;
  shopify: boolean;
  rows: ImportRow[];
  /** Shopify variant rows folded into the product above them. */
  foldedVariants: number;
  /** Rows past IMPORT_ROWS_MAX, which are not in `rows` at all. */
  dropped: number;
};

/** A cell, or "" when the column is unmapped or the row is short. */
function cell(row: readonly string[], index: number | null): string {
  if (index === null) return "";
  return (row[index] ?? "").trim();
}

/**
 * Turn parsed CSV into the rows an import would write.
 *
 * Every row comes back, including the bad ones, each carrying its own
 * `problem`. That is what lets the preview show a seller precisely which lines
 * will not make it and why, instead of importing what it can and leaving them
 * to work out what went missing.
 */
export function buildImportPlan(
  table: readonly (readonly string[])[],
  overrides?: Partial<ColumnMap>,
  defaults?: { status?: ProductStatus },
): ImportPlan {
  const [headerRow = [], ...body] = table;
  const header = headerRow.map((name) => name.trim());
  const columns = { ...guessColumns(header), ...overrides } as ColumnMap;
  const shopify = isShopifyExport(header);
  const handleAt = handleColumn(header);
  const defaultStatus = defaults?.status ?? "draft";

  const rows: ImportRow[] = [];
  const seenHandles = new Set<string>();
  const seenTitles = new Set<string>();
  let foldedVariants = 0;
  let dropped = 0;

  body.forEach((raw, index) => {
    // A Shopify export lists one row per variant under a shared handle. The
    // first is the product; the rest carry only variant fields (often no
    // title at all) and would otherwise import as a pile of blank rows.
    if (handleAt !== null) {
      const handle = cell(raw, handleAt).toLowerCase();
      if (handle) {
        if (seenHandles.has(handle)) {
          foldedVariants += 1;
          return;
        }
        seenHandles.add(handle);
      }
    }

    // Wholly blank lines are not rows a seller wrote; they are how files end.
    if (raw.every((value) => value.trim() === "")) return;

    if (rows.length >= IMPORT_ROWS_MAX) {
      dropped += 1;
      return;
    }

    const title = cell(raw, columns.title);
    const rawDescription = cell(raw, columns.description);
    const description = htmlToText(rawDescription);
    const priceCents = parsePriceCents(cell(raw, columns.price));
    const stockRaw = cell(raw, columns.stock);
    const stockValue = stockRaw === "" ? null : Number(stockRaw.replace(/[^\d-]/g, ""));

    // THE SELLER'S CHOICE, for every row. The file's own status column is
    // deliberately not read: the importer offers one "import as drafts or
    // live" control, and a file that quietly overrode it would break the
    // promise that control makes. It also means a Shopify catalogue that was
    // live over there cannot arrive live over here by surprise.
    const status: ProductStatus = defaultStatus;

    let problem: string | null = null;
    if (!title) problem = "No title.";
    else if (title.length > 200) problem = "Title is longer than 200 characters.";
    else if (priceCents === null) problem = "No price we could read.";
    else if (priceCents < 1) problem = "Price is zero.";
    else if (seenTitles.has(title.toLowerCase())) problem = "Another row has this title.";

    if (!problem) seenTitles.add(title.toLowerCase());

    rows.push({
      // +2: one for the header row, one because files are 1-based.
      line: index + 2,
      title,
      description,
      priceCents,
      sku: cell(raw, columns.sku),
      stock:
        stockValue === null || !Number.isFinite(stockValue) || stockValue < 0
          ? null
          : Math.floor(stockValue),
      status,
      problem,
    });
  });

  return { header, columns, shopify, rows, foldedVariants, dropped };
}

/** The rows an import would actually write. */
export function importableRows(plan: ImportPlan): ImportRow[] {
  return plan.rows.filter((row) => row.problem === null);
}

/** Guard for a currency arriving from a form. */
export function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}
