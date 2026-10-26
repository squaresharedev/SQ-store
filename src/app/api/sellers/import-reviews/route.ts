import { after } from "next/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { readBoundedJson } from "@/lib/security/read-json";
import { uuidField } from "@/lib/validation/inputs";
import { REVIEW_IMPORT_BODY_MAX, REVIEW_IMPORT_BYTES_MAX, REVIEW_IMPORT_ROWS_MAX } from "@/lib/reviews/limits";
import { isReviewImportSource } from "@/lib/reviews/sources";
import { buildReviewImportPlan, slugKey, type ReviewImportProblem } from "@/lib/reviews/import";
import { sweepReviews } from "@/lib/reviews/moderation";

/**
 * POST /api/sellers/import-reviews: a seller bringing their reviews over from
 * a Shopify review app (Judge.me, Loox, Yotpo, Shopify Product Reviews).
 *
 * Body: `{ csv, fileName, source, matches }`, where `matches` maps each
 * product key's slug (lib/reviews/import.ts) to one of the store's product
 * ids, or null to skip it.
 *
 * THE CLIENT'S PREVIEW IS NOT TRUSTED, as with the product import: this is
 * handed the FILE TEXT and parses it again with the same functions. Each
 * matched product id must belong to the active store; anything else counts
 * as unmatched. Every row passes the buyer review's field gates.
 *
 * IDEMPOTENT. Each row is fingerprinted (source, product key, author, date,
 * rating and text), and the database keeps one review per fingerprint per
 * product, so importing the same file twice lands each review once and the
 * second run reports them as already there.
 *
 * UNDOABLE. The run is recorded in review_imports and its reviews hang off
 * it; deleting the run deletes them. A run that fails part-way is deleted
 * here, so nothing is left half-imported.
 *
 * CHECKED BEFORE SHOWN. Imported reviews land pending, like a buyer's, and
 * appear once the automatic check has read them: the first batch straight
 * after this response, the rest on the moderation sweep's schedule.
 *
 * NEVER "VERIFIED". An imported review is labelled with where it came from
 * and is never marked a verified purchase: we cannot check another
 * platform's order records (see the migration's header).
 */

const productIdSchema = uuidField("product");
const BATCH = 500;
/** Skipped rows listed back in full; past this the count says the rest. */
const SKIPPED_LISTED_MAX = 50;

function reply(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** A caller's `matches`, reduced to slugs pointing at well-formed ids. */
function safeMatches(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof raw !== "object" || raw === null) return out;
  for (const [slug, id] of Object.entries(raw).slice(0, REVIEW_IMPORT_ROWS_MAX)) {
    if (slug === slugKey(slug) && slug.length <= 300 && productIdSchema.safeParse(id).success) {
      out.set(slug, id as string);
    }
  }
  return out;
}

async function fingerprint(parts: readonly (string | number)[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return reply({ ok: false, error: "forbidden" }, 403);
  const account = await getActiveAccount();
  if (!account) return reply({ ok: false, error: "unauthorized" }, 401);
  if (!can(account.role, "products.write")) return reply({ ok: false, error: "forbidden" }, 403);
  // Before any parsing: one call can write thousands of rows.
  if (!(await rateLimit("review_import", RATE_LIMITS.reviewImport))) {
    return reply({ ok: false, error: "rate_limited" }, 429);
  }

  const body = await readBoundedJson(request, REVIEW_IMPORT_BODY_MAX);
  if (!body.ok) return reply({ ok: false, error: body.reason === "too_large" ? "too_large" : "invalid" }, 400);
  const { csv, fileName, source, matches } = (body.value ?? {}) as Record<string, unknown>;
  if (typeof csv !== "string" || csv.trim() === "") return reply({ ok: false, error: "invalid" }, 400);
  if (new TextEncoder().encode(csv).length > REVIEW_IMPORT_BYTES_MAX) {
    return reply({ ok: false, error: "too_large" }, 400);
  }

  const plan = buildReviewImportPlan(csv);
  if (plan.missing.length > 0) return reply({ ok: false, error: "unrecognised", missing: plan.missing }, 400);
  const importSource = isReviewImportSource(source) ? source : plan.source;
  if (!importSource) return reply({ ok: false, error: "invalid" }, 400);

  // The store's own products, and nobody else's: a mapping to any other id is
  // treated as no mapping at all.
  const requested = safeMatches(matches);
  const admin = createAdminClient();
  const wanted = [...new Set(requested.values())];
  const { data: owned, error: ownedError } = wanted.length
    ? await admin.from("products").select("id").eq("owner_id", account.accountId).in("id", wanted)
    : { data: [], error: null };
  if (ownedError) {
    console.error("[review-import] product read failed", ownedError.message);
    return reply({ ok: false, error: "failed" }, 503);
  }
  const ownedIds = new Set((owned ?? []).map((row) => row.id));

  const skipped: { line: number; problem: ReviewImportProblem }[] = [];
  const inserts = new Map<string, {
    product_id: string;
    seller_id: string;
    source: typeof importSource;
    external_id: string;
    rating: number;
    title: string | null;
    body: string;
    author_name: string;
    reviewed_at: string;
  }>();
  for (const row of plan.rows) {
    const productId = requested.get(slugKey(row.productKey));
    const problem = row.problem ?? (productId && ownedIds.has(productId) ? null : "product");
    if (problem || !productId) {
      skipped.push({ line: row.line, problem: problem ?? "product" });
      continue;
    }
    const externalId = await fingerprint([importSource, slugKey(row.productKey), row.author, row.reviewedAt, row.rating, row.body]);
    // The same review twice in one file is one review.
    inserts.set(`${productId}:${externalId}`, {
      product_id: productId,
      seller_id: account.accountId,
      source: importSource,
      external_id: externalId,
      rating: row.rating,
      title: row.title || null,
      body: row.body,
      author_name: row.author,
      reviewed_at: row.reviewedAt,
    });
  }
  if (inserts.size === 0) return reply({ ok: false, error: "nothing", skipped: skipped.length }, 400);

  const { data: run, error: runError } = await admin
    .from("review_imports")
    .insert({
      seller_id: account.accountId,
      created_by: account.userId,
      source: importSource,
      file_name: typeof fileName === "string" ? fileName.slice(0, 255) || null : null,
      row_count: plan.rows.length + plan.hidden + plan.dropped,
    })
    .select("id")
    .single();
  if (runError) {
    console.error("[review-import] run insert failed", runError.message);
    return reply({ ok: false, error: "failed" }, 500);
  }

  const rows = [...inserts.values()].map((row) => ({ ...row, import_id: run.id }));
  let imported = 0;
  for (let start = 0; start < rows.length; start += BATCH) {
    const { data, error } = await admin
      .from("reviews")
      .upsert(rows.slice(start, start + BATCH), { onConflict: "product_id,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error("[review-import] review insert failed", error.message);
      // Undo the run, and with it every review it had written so far.
      await admin.from("review_imports").delete().eq("id", run.id);
      return reply({ ok: false, error: "failed" }, 500);
    }
    imported += data.length;
  }

  // A run that added nothing (every review already here) is not worth a record.
  await (imported === 0
    ? admin.from("review_imports").delete().eq("id", run.id)
    : admin.from("review_imports").update({ imported_count: imported, skipped_count: skipped.length }).eq("id", run.id));

  if (imported > 0) {
    after(async () => {
      await sweepReviews().catch((error: unknown) =>
        console.error("[review-import] first check did not run:", error instanceof Error ? error.message : error),
      );
    });
  }

  return reply(
    {
      ok: true,
      imported,
      duplicates: rows.length - imported,
      hidden: plan.hidden,
      dropped: plan.dropped,
      skipped: skipped.slice(0, SKIPPED_LISTED_MAX),
      skippedCount: skipped.length,
    },
    201,
  );
}
