"use server";

import { revalidatePath } from "next/cache";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  failure,
  invalidInput,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  type ActionError,
} from "@/lib/errors";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { productWriteSchema } from "@/lib/validation/product";
import { CURRENCIES, PRODUCT_STATUSES, type Currency, type ProductStatus } from "@/types/product";
import {
  IMPORT_BYTES_MAX,
  IMPORT_ROWS_MAX,
  buildImportPlan,
  importableRows,
  parseCsv,
  type ColumnMap,
  type ImportField,
} from "./csv";

/**
 * Importing a catalogue from a CSV.
 *
 * THE CLIENT'S PREVIEW IS NOT TRUSTED. The browser parses the same file with
 * the same functions to show what will land, but this action is handed the
 * FILE TEXT, not the rows the client built from it, and parses it again here.
 * Anything else would make the preview the security boundary, and a preview is
 * a convenience a caller can rewrite at will.
 *
 * Every row still goes through `productWriteSchema`, the same gate a
 * hand-typed product passes: an import is a faster way to reach the product
 * table, never a softer one. A row that fails is reported and skipped, so one
 * bad line never costs a seller the other 199.
 */

export type ImportResult =
  | {
      ok: true;
      imported: number;
      /** Rows that could not be written, each with the reason. */
      skipped: { line: number; title: string; reason: string }[];
    }
  | { ok: false; error: ActionError };

export type ImportInput = {
  /** The uploaded file's text. Re-parsed here; the client's rows are ignored. */
  csv: string;
  /** The seller's column mapping, as corrected in the preview. */
  columns: Partial<ColumnMap>;
  currency: string;
  status: string;
};

/** A field name we accept in a mapping. Anything else is dropped rather than
 *  trusted to index something. */
const FIELD_NAMES: readonly ImportField[] = [
  "title",
  "description",
  "price",
  "sku",
  "stock",
];

/**
 * A caller-supplied column map, reduced to what it is allowed to be: known
 * field names pointing at non-negative integer column indexes, or null.
 * Anything else becomes null (unmapped) rather than reaching the parser.
 */
function safeColumns(raw: unknown): Partial<ColumnMap> {
  if (typeof raw !== "object" || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const out: Partial<ColumnMap> = {};
  for (const field of FIELD_NAMES) {
    const value = source[field];
    if (value === null) {
      out[field] = null;
      continue;
    }
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 1000) {
      out[field] = value;
    }
  }
  return out;
}

export async function importProducts(input: unknown): Promise<ImportResult> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) {
    return failure(permissionDenied(account.role, "import products"));
  }
  // Before any parsing: one call here can insert IMPORT_ROWS_MAX rows, so the
  // budget is spent before the work, not after it.
  if (!(await rateLimit("product_import", RATE_LIMITS.productImport))) {
    return failure(rateLimited("import products"));
  }

  if (typeof input !== "object" || input === null) {
    return failure(invalidInput("That import could not be read.", "Upload the file again."));
  }
  const { csv, columns, currency, status } = input as Partial<ImportInput>;

  if (typeof csv !== "string" || csv.trim() === "") {
    return failure(invalidInput("That file was empty.", "Export your products again and retry."));
  }
  // Measured in BYTES, not characters: a file of multi-byte text is bigger
  // than its length suggests, and the cap is about the work this does.
  if (new TextEncoder().encode(csv).length > IMPORT_BYTES_MAX) {
    const maxMb = Math.round(IMPORT_BYTES_MAX / 1024 / 1024);
    return failure(
      invalidInput(
        "That file is too large to import.",
        `Split it into files under ${maxMb} MB, or import up to ${IMPORT_ROWS_MAX} products at a time.`,
      ),
    );
  }
  if (typeof currency !== "string" || !(CURRENCIES as readonly string[]).includes(currency)) {
    return failure(
      invalidInput("Pick a currency for these products.", "Choose one, then import again."),
    );
  }
  if (typeof status !== "string" || !(PRODUCT_STATUSES as readonly string[]).includes(status)) {
    return failure(
      invalidInput(
        "Pick whether these arrive as drafts or live products.",
        "Choose one, then import again.",
      ),
    );
  }

  const plan = buildImportPlan(parseCsv(csv), safeColumns(columns), {
    status: status as ProductStatus,
  });
  const rows = importableRows(plan);
  const skipped = plan.rows
    .filter((row) => row.problem !== null)
    .map((row) => ({ line: row.line, title: row.title, reason: row.problem! }));

  if (rows.length === 0) {
    return failure(
      invalidInput(
        "Nothing in that file could be imported.",
        skipped[0]?.reason
          ? `The first row says: ${skipped[0].reason} Check which columns hold the title and the price.`
          : "Check that it has a title column and a price column.",
      ),
    );
  }

  // THE SAME GATE A TYPED PRODUCT PASSES. An import is a faster route to the
  // table, not a softer one, so each row is parsed by productWriteSchema
  // rather than trusted because it came from a file we just parsed ourselves.
  const inserts: {
    owner_id: string;
    title: string;
    description: string | null;
    price_cents: number;
    currency: Currency;
    status: ProductStatus;
    track_stock: boolean;
    stock_quantity: number | null;
    low_stock_threshold: number;
  }[] = [];

  for (const row of rows) {
    const parsed = productWriteSchema.safeParse({
      title: row.title,
      description: row.description,
      priceCents: row.priceCents,
      currency,
      status: row.status,
      trackStock: row.stock !== null,
      stockQuantity: row.stock,
    });
    if (!parsed.success) {
      skipped.push({
        line: row.line,
        title: row.title,
        reason: parsed.error.issues[0]?.message ?? "That row is not a valid product.",
      });
      continue;
    }
    const data = parsed.data;
    inserts.push({
      owner_id: account.accountId,
      title: data.title,
      description: data.description || null,
      price_cents: data.priceCents,
      currency: data.currency,
      status: data.status,
      track_stock: data.trackStock ?? false,
      stock_quantity: (data.trackStock ?? false) ? (data.stockQuantity ?? null) : null,
      low_stock_threshold: data.lowStockThreshold ?? 5,
    });
  }

  if (inserts.length === 0) {
    return failure(
      invalidInput(
        "None of those rows could be saved.",
        skipped[0]?.reason ?? "Check the title and price columns.",
      ),
    );
  }

  // ONE insert for the whole file. Row by row would be IMPORT_ROWS_MAX round
  // trips, and would leave a half-imported catalogue behind on any failure.
  // RLS re-checks the caller's permission on every row here, exactly as it
  // does for a single create.
  const supabase = await createClient();
  const { data: written, error } = await supabase
    .from("products")
    .insert(inserts)
    .select("id");
  if (error) {
    console.error("[products] import failed", error);
    return failure(serverError("import your products"));
  }

  revalidatePath("/products");
  return { ok: true, imported: written?.length ?? inserts.length, skipped };
}
