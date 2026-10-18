// SERVER ONLY. The daily rollup: count each finished day of funnel events in
// Workers Analytics Engine and store the counts in
// public.storefront_funnel_daily, which is what the analytics page reads.
//
// WHY. Analytics Engine keeps 90 days and answers through an account-level
// API, never to a seller. The daily table is the lasting, per-seller record,
// behind RLS (supabase/migrations/20261012_storefront_funnel_daily.sql).
//
// STARTED FROM OUTSIDE, like every scheduled job here: the scheduler calls
// app/api/cron/funnel-rollup with CRON_SECRET (lib/ops/cron.ts). This Worker
// is built by OpenNext and has no scheduled handler of its own.
//
// SAFE TO RUN TWICE, AND LATE. Each run rolls the last ROLLUP_DAYS finished
// UTC days, and a day is REPLACED with what Analytics Engine holds for it
// (storefront_funnel_roll_day). So a missed night is caught up by the next
// run, a second run changes nothing, and points that arrived late are picked
// up. Today is never rolled: it is not over.
//
// A DAY THAT CANNOT BE READ IN FULL IS LEFT ALONE. If the query fails, or
// comes back at the row cap, that day's stored rows are not touched: half a
// day written over a whole one is worse than a day rolled tomorrow.
//
// OFF UNTIL IT HAS SOMETHING TO READ WITH: CLOUDFLARE_ACCOUNT_ID (a var) and
// FUNNEL_ANALYTICS_TOKEN (a secret: an API token with Account Analytics Read
// and nothing else). Without both the job reports "not configured".

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PLACEMENT_ID_MAX,
  REFERRER_HOST_MAX,
  funnelPointSchema,
} from "@/lib/analytics/funnel/events";
import { FUNNEL_DATASET } from "@/lib/analytics/funnel/record";

/** How many finished days each run rolls. More than one, so a missed run and
 *  late points are both made good without anyone noticing. */
export const ROLLUP_DAYS = 3;

/** The most groups one day may come back as. A day AT the cap is treated as
 *  cut short and not rolled. */
export const ROLLUP_ROW_CAP = 50_000;

const DAY_MS = 24 * 60 * 60 * 1000;
const SQL_TIMEOUT_MS = 20_000;

export type RollupConfig = { accountId: string; token: string };

/** What the job needs to read Analytics Engine, or null while it is off. */
export function rollupConfig(): RollupConfig | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const token = process.env.FUNNEL_ANALYTICS_TOKEN ?? "";
  // An account id is 32 hex characters; it goes into an address.
  if (!/^[0-9a-f]{32}$/.test(accountId) || token.length === 0) return null;
  return { accountId, token };
}

/** The last `count` finished UTC days before `now`, oldest first, as ISO days. */
export function finishedDays(now: Date, count = ROLLUP_DAYS): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: count }, (_, index) =>
    new Date(today - (count - index) * DAY_MS).toISOString().slice(0, 10),
  );
}

/**
 * The query for one day. Columns are read by position, in the order record.ts
 * writes them (FUNNEL_BLOBS). `day` is an ISO date this module produced itself
 * (finishedDays), never a caller's string, and is shape-checked all the same
 * because it is spliced into SQL.
 *
 * SUM(_sample_interval), not COUNT(): Analytics Engine may keep one point in
 * several on a very busy index and says so in that column.
 */
export function daySql(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("not a day");
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
  return [
    "SELECT index1 AS seller_id, blob1 AS event, blob2 AS store_id, blob3 AS product_id,",
    "blob4 AS referrer_host, blob5 AS placement_id, SUM(_sample_interval) AS events",
    `FROM ${FUNNEL_DATASET}`,
    `WHERE timestamp >= toDateTime('${day} 00:00:00') AND timestamp < toDateTime('${next} 00:00:00')`,
    "GROUP BY seller_id, event, store_id, product_id, referrer_host, placement_id",
    `LIMIT ${ROLLUP_ROW_CAP}`,
    "FORMAT JSON",
  ].join(" ");
}

/** One group as the daily table takes it. */
export type RollupRow = {
  seller_id: string;
  store_id: string;
  product_id: string;
  event: string;
  referrer_host: string;
  placement_id: string;
  events: number;
};

const answerSchema = z.object({ data: z.array(z.record(z.string(), z.unknown())) });

/**
 * Analytics Engine's answer for one day, as rows the table will take.
 *
 * Every group is put through the SAME schema a point is written with, so
 * nothing reaches the database that could not have been recorded. A group
 * that fails (a point from a build with another layout, a count that is not
 * one) is dropped and counted, never guessed at. Null when the answer is not
 * an answer at all.
 */
export function readDayAnswer(payload: unknown): { rows: RollupRow[]; dropped: number; capped: boolean } | null {
  const answer = answerSchema.safeParse(payload);
  if (!answer.success) return null;
  const rows: RollupRow[] = [];
  let dropped = 0;
  for (const group of answer.data.data) {
    const point = funnelPointSchema.safeParse({
      sellerId: group.seller_id,
      storeId: group.store_id,
      productId: group.product_id,
      event: group.event,
      referrerHost: String(group.referrer_host ?? "").slice(0, REFERRER_HOST_MAX),
      placementId: String(group.placement_id ?? "").slice(0, PLACEMENT_ID_MAX),
    });
    // A 64-bit sum arrives as a string.
    const events = Math.round(Number(group.events));
    if (!point.success || !Number.isSafeInteger(events) || events <= 0) {
      dropped += 1;
      continue;
    }
    rows.push({
      seller_id: point.data.sellerId,
      store_id: point.data.storeId,
      product_id: point.data.productId,
      event: point.data.event,
      referrer_host: point.data.referrerHost,
      placement_id: point.data.placementId,
      events,
    });
  }
  return { rows, dropped, capped: answer.data.data.length >= ROLLUP_ROW_CAP };
}

async function queryDay(config: RollupConfig, day: string): Promise<unknown> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}` },
      body: daySql(day),
      signal: AbortSignal.timeout(SQL_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`Analytics Engine answered ${response.status}`);
  return response.json();
}

export type RollupResult =
  | { configured: false }
  | {
      configured: true;
      /** Days replaced, and the rows they now hold in total. */
      days: number;
      rows: number;
      /** Groups Analytics Engine returned that were not valid points. */
      dropped: number;
      /** Days left as they were: unreadable, or cut short. */
      failed: number;
    };

/** One run of the job. Counts only in what it returns, never an id. */
export async function runFunnelRollup(now = new Date()): Promise<RollupResult> {
  const config = rollupConfig();
  if (!config) return { configured: false };

  const admin = createAdminClient();
  const result = { configured: true as const, days: 0, rows: 0, dropped: 0, failed: 0 };

  for (const day of finishedDays(now)) {
    try {
      const answer = readDayAnswer(await queryDay(config, day));
      if (!answer || answer.capped) throw new Error(answer ? "the day came back at the row cap" : "unreadable answer");
      const { data, error } = await admin.rpc("storefront_funnel_roll_day", {
        p_day: day,
        p_rows: answer.rows,
      });
      if (error) throw new Error(error.message);
      result.days += 1;
      result.rows += typeof data === "number" ? data : 0;
      result.dropped += answer.dropped;
    } catch (error) {
      result.failed += 1;
      console.error(`[funnel] ${day} was not rolled up:`, error instanceof Error ? error.message : error);
    }
  }
  return result;
}
