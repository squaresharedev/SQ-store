// SERVER ONLY. THE PLAN PRICES IN FORCE, read from the database.
//
// plan_prices is where every price and every per-sale fee lives (migration
// 20261011_pricing_config), so a number changes by adding a row, never by a
// deploy. This is the one read of it: the checkout prices a sale from what
// comes back, and the plans page shows the same rows.
//
// ALL OR NOTHING. A set that is missing a plan, or holds a row that does not
// parse, is answered as null. The checkout then refuses the sale and the
// plans page says it is unavailable: a plan shown or charged at a guessed
// rate would be worse than either.
//
// SERVICE ROLE, and safe to hand on: these rows are the public price list.
// What comes back carries no ids.
//
// BEFORE THE MIGRATION HAS RUN there is no table to read, and the answer is
// the seed (lib/billing/pricing-seed.ts): the very rows the migration
// inserts, so the plans page keeps working on a database that is one deploy
// behind the code. Only a MISSING TABLE takes this path. Once the table
// exists, an unreadable or incomplete set is null, never the seed.

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLAN_IDS, type BillingInterval, type PaidPlanId } from "@/lib/billing/plans";
import type { PlanPrices } from "@/lib/billing/fees";
import { PLAN_PRICE_SEED } from "@/lib/billing/pricing-seed";
import { activePlanPrices, findPlanPrice, planPriceSchema, type PlanPrice } from "@/lib/pricing";

/** "No such table": Postgres' own code, and PostgREST's for a table missing
 *  from its schema cache. The database has not had 20261011_pricing_config. */
const MISSING_TABLE_CODES = ["42P01", "PGRST205"];

const PLAN_PRICE_SELECT =
  "plan_id, version, billing_interval, price_cents, list_price_cents, currency, direct_fee_bps, marketplace_fee_bps, stripe_lookup_key, effective_from, effective_to" as const;

/**
 * The plan prices in force at `now`: one row per plan and interval sold, with
 * a monthly row for every plan. Null when they cannot be read whole.
 */
export async function readPlanPrices(now: Date = new Date()): Promise<PlanPrices | null> {
  try {
    // Every row that has started: the table holds a handful per plan, and
    // which of them is in force is activePlanPrices' to say, the same code
    // the tests hold to the window rule.
    const { data, error } = await createAdminClient()
      .from("plan_prices")
      .select(PLAN_PRICE_SELECT)
      .lte("effective_from", now.toISOString());
    if (error) {
      if (MISSING_TABLE_CODES.includes(error.code)) {
        console.warn("[billing] plan_prices does not exist yet (apply 20261011_pricing_config); using the seed");
        return activePlanPrices(PLAN_PRICE_SEED, now);
      }
      console.error("[billing] reading the plan prices failed:", error.message);
      return null;
    }

    const rows: PlanPrice[] = [];
    for (const row of data ?? []) {
      const parsed = planPriceSchema.safeParse({
        planId: row.plan_id,
        version: row.version,
        interval: row.billing_interval,
        priceCents: row.price_cents,
        listPriceCents: row.list_price_cents,
        currency: row.currency,
        directFeeBps: row.direct_fee_bps,
        marketplaceFeeBps: row.marketplace_fee_bps,
        stripeLookupKey: row.stripe_lookup_key,
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
      });
      if (!parsed.success) {
        console.error("[billing] a plan price row does not parse:", parsed.error.issues[0]?.path.join("."));
        return null;
      }
      rows.push(parsed.data);
    }

    const active = activePlanPrices(rows, now);
    const missing = PLAN_IDS.filter((plan) => findPlanPrice(active, plan)?.interval !== "month");
    if (missing.length > 0) {
      console.error("[billing] no monthly price in force for:", missing.join(", "));
      return null;
    }
    return active;
  } catch (error) {
    // createAdminClient throws without the service role key.
    console.error("[billing] reading the plan prices threw:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * The price a paid plan is SOLD at for exactly this interval, or null when it
 * is not sold by it (or the prices cannot be read). What a subscription
 * checkout charges: unlike the fee lookups, this never falls back to the
 * monthly row, because a yearly checkout at a monthly price is a wrong charge.
 */
export async function readSoldPrice(plan: PaidPlanId, interval: BillingInterval): Promise<PlanPrice | null> {
  const prices = await readPlanPrices();
  return prices?.find((price) => price.planId === plan && price.interval === interval) ?? null;
}

/** readPlanPrices, once per request: a page and its sections ask on one render. */
export const getPlanPrices = cache(() => readPlanPrices());
