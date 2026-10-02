// What each plan offers, as lists the plans page, the comparison table and
// the Settings upsell all read. Pure, client-safe: derived from the catalog
// (lib/billing/plans.ts), so a number changed there changes every place a
// plan is described.

import {
  PLAN_IDS,
  PLAN_PERK_KEYS,
  PLANS,
  type PlanId,
  type PlanPerkKey,
} from "@/lib/billing/plans";

/**
 * Every feature a plan CARD can be described by, in display order: the
 * numbers that differ by plan, the core every plan shares, then the perks.
 */
export const PLAN_FEATURE_KEYS = [
  "fee",
  "products",
  "storefronts",
  "teamSeats",
  "core",
  ...PLAN_PERK_KEYS,
] as const;
export type PlanFeatureKey = (typeof PLAN_FEATURE_KEYS)[number];

/**
 * What every plan includes in full, named one by one in the comparison table
 * so a seller can see how much Free already has. Display only: nothing gates
 * on these, and each one is a feature that exists today.
 */
export const INCLUDED_FEATURE_KEYS = [
  "productPages",
  "checkout",
  "digitalDownloads",
  "stock",
  "shipping",
  "embed",
  "designer",
  "roles",
  "analytics",
  "productImport",
] as const;
export type IncludedFeatureKey = (typeof INCLUDED_FEATURE_KEYS)[number];

/** One row of the comparison table. */
export type CompareRowKey = Exclude<PlanFeatureKey, "core"> | IncludedFeatureKey;

/** A section of the comparison table. */
export type CompareGroupKey = "selling" | "store" | "tools" | "support";

/** The comparison table's sections, in order, each with its rows. */
export const COMPARE_GROUPS: readonly { key: CompareGroupKey; rows: readonly CompareRowKey[] }[] = [
  {
    key: "selling",
    rows: ["fee", "products", "productPages", "checkout", "digitalDownloads", "stock", "shipping", "embed"],
  },
  { key: "store", rows: ["storefronts", "designer", "teamSeats", "roles"] },
  { key: "tools", rows: ["analytics", "ordersExport", "analyticsExport", "productImport"] },
  { key: "support", rows: ["earlyAccess", "prioritySupport"] },
];

const isPerk = (key: string): key is PlanPerkKey => (PLAN_PERK_KEYS as readonly string[]).includes(key);

/** A cap as a comparable number: unlimited ranks above any count. */
const capRank = (cap: number | null) => (cap === null ? Number.POSITIVE_INFINITY : cap);

/** Whether `plan` offers `key` at all (the core, the caps and every included
 *  feature always; a perk only where the catalog switches it on). */
export function planHas(plan: PlanId, key: CompareRowKey | PlanFeatureKey): boolean {
  return isPerk(key) ? PLANS[plan].perks[key] : true;
}

/** The cheapest plan that offers `key` (PLAN_IDS runs cheapest first): the
 *  plan a locked feature names ("Pro"). */
export function cheapestPlanWith(key: PlanFeatureKey): PlanId {
  return PLAN_IDS.find((plan) => planHas(plan, key)) ?? PLAN_IDS[PLAN_IDS.length - 1]!;
}

/** Whether `to` is strictly better than `from` on `key`. */
function improves(from: PlanId, to: PlanId, key: PlanFeatureKey): boolean {
  switch (key) {
    case "fee":
      return PLANS[to].feeBps < PLANS[from].feeBps;
    case "products":
    case "storefronts":
    case "teamSeats":
      return capRank(PLANS[to].limits[key]) > capRank(PLANS[from].limits[key]);
    case "core":
      return false;
    default:
      return PLANS[to].perks[key] && !PLANS[from].perks[key];
  }
}

/** Everything `plan` offers, in display order. */
export function planFeatures(plan: PlanId): PlanFeatureKey[] {
  return PLAN_FEATURE_KEYS.filter((key) => planHas(plan, key));
}

/** What `to` adds over `from`: the upsell's list of reasons. */
export function gainsOver(from: PlanId, to: PlanId): PlanFeatureKey[] {
  return PLAN_FEATURE_KEYS.filter((key) => improves(from, to, key));
}

/**
 * What a plan's card lists: everything, for the first plan; for every other,
 * only what it adds over the plan below it ("Everything in Free, plus").
 */
export function planCardFeatures(plan: PlanId): { below: PlanId | null; features: PlanFeatureKey[] } {
  const index = PLAN_IDS.indexOf(plan);
  const below = index > 0 ? PLAN_IDS[index - 1]! : null;
  return { below, features: below ? gainsOver(below, plan) : planFeatures(plan) };
}
