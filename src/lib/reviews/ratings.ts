import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductRating } from "@/types/product";

/** Products asked about in one read, so the request's address stays well
 *  inside what a proxy will carry however many a board or an offer holds. */
const RATINGS_PER_READ = 100;

/**
 * Several products' reviews in two numbers each, from product_rating_summaries
 * (the row the product page's own rating reads, which counts only the reviews
 * buyers can see). One with no reviews yet is left out.
 *
 * A failed read leaves them ALL out rather than failing whatever asked: the
 * stars are a nicety on a card or an add-on, never a reason to refuse the
 * page. The seller's own client reads its store's rows under RLS; a buyer's
 * page asks with the admin client, like every other public read.
 */
export async function readRatingSummaries(
  client: Pick<SupabaseClient, "from">,
  ids: readonly string[],
  /** Names the caller in the log line. */
  context: string,
): Promise<Map<string, ProductRating>> {
  if (ids.length === 0) return new Map();
  const runs: string[][] = [];
  for (let start = 0; start < ids.length; start += RATINGS_PER_READ) {
    runs.push(ids.slice(start, start + RATINGS_PER_READ));
  }
  const answers = await Promise.all(
    runs.map((run) =>
      client.from("product_rating_summaries").select("product_id, review_count, average").in("product_id", run),
    ),
  );
  const failed = answers.find((answer) => answer.error);
  if (failed?.error) {
    console.error(`[${context}] ratings read failed`, failed.error.message);
    return new Map();
  }
  return new Map(
    answers.flatMap((answer) =>
      ((answer.data ?? []) as { product_id: string; review_count: number; average: number | string | null }[]).flatMap(
        (row) =>
          row.review_count > 0 && row.average !== null
            ? [[row.product_id, { average: Number(row.average), count: row.review_count }] as const]
            : [],
      ),
    ),
  );
}
