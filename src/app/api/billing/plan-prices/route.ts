import { readPlanPrices } from "@/lib/billing/catalog";
import { planPrice } from "@/lib/billing/fees";
import { BILLING_CURRENCY, PLAN_IDS } from "@/lib/billing/plans";

/**
 * GET /api/billing/plan-prices: THE PUBLIC PRICE LIST (PLAN_PRICES_API_PATH).
 *
 * What each plan costs a month and what it charges per sale, from the
 * plan_prices rows in force. It exists for the homepage's pricing section
 * (the SQ-home repo, a separate app with no access to this database), so the
 * numbers a visitor reads there are the ones a seller is charged here, with
 * no copy to keep in step.
 *
 * PUBLIC ON PURPOSE, and safe to be: these are the figures on the pricing
 * page. The response is BUILT, never passed through: the monthly price and
 * the direct fee per plan, and nothing else a row holds (no Stripe lookup
 * key, no dates, no ids). The marketplace fee is left out until there is a
 * marketplace to charge it on: a rate nobody can be charged yet is not one to
 * publish.
 *
 * CACHED at the edge and in the browser for a few minutes. A price change is
 * a row added by a person; nobody needs it on the homepage within the second,
 * and no visitor should be able to make this a database read per request.
 *
 * Unreadable prices answer 503 and are never cached: the homepage then keeps
 * the figures it already has rather than showing a guess.
 */

/** How long a copy of the list may be served before asking again. */
const CACHE_SECONDS = 300;
/** How long a stale copy may still be served while a fresh one is fetched. */
const STALE_SECONDS = 3600;

const OPEN_TO_ANY_ORIGIN = { "access-control-allow-origin": "*" };

export async function GET() {
  const prices = await readPlanPrices();
  if (!prices) {
    return Response.json(
      { error: "The price list is unavailable right now." },
      { status: 503, headers: { ...OPEN_TO_ANY_ORIGIN, "cache-control": "no-store" } },
    );
  }

  return Response.json(
    {
      currency: BILLING_CURRENCY,
      plans: PLAN_IDS.map((plan) => {
        const price = planPrice(prices, plan, "month");
        return {
          id: plan,
          monthlyPriceCents: price.priceCents,
          directFeeBps: price.directFeeBps,
        };
      }),
    },
    {
      headers: {
        ...OPEN_TO_ANY_ORIGIN,
        "cache-control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
      },
    },
  );
}
