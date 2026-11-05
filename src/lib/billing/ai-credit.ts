// THE AI CREDIT: how a store's AI writing help is metered (lib/suggestions,
// the aiSuggestions perk). Pure and client-safe: the settings card shows it,
// the actions charge by it (lib/ai-suggestions.ts).
//
// THE RULE. Every model call is charged to the store's monthly credit
// (PLANS[plan].aiCreditCents) at what it cost the platform plus
// AI_CREDIT_MARGIN. A US dollar of model cost is counted as a euro of credit,
// which rounds in the platform's favour while the dollar is worth less than
// the euro. So EUR 10 of credit buys at most USD 8.33 of model calls: the most
// AI can cost the platform per store per month, whatever the store does. When
// the credit is spent, AI writing help pauses until the 1st (UTC).
//
// HOW IT HOLDS. Before a call, the most it can cost (lib/suggestions/ai.ts
// maxAskCost, plus the margin) is taken from the credit in one atomic step
// that refuses when it does not fit; after it, the hold is settled to what the
// call really cost. So calls fired together cannot overshoot the credit, a
// call that never reports back stays paid for, and a settle that fails
// leaves the store charged the most, never nothing. The same step holds the
// platform's day (AI_PLATFORM_DAILY_CENTS), whatever every store has left.

import { PLANS, type PlanId } from "@/lib/billing/plans";

/** What the platform keeps on top of the model's cost: a call that cost 1 is
 *  charged 1.2. */
export const AI_CREDIT_MARGIN = 0.2;

/** Credit is counted in millionths of the currency ("micros"): one call takes
 *  a few hundredths of a cent. */
export const MICROS_PER_CENT = 10_000;

/**
 * The most AI writing help may take in a day (UTC) across every store, in
 * cents of credit: EUR 100, so at most USD 83 of model calls. Not what stops a
 * store (its credit does): a ceiling for what nobody foresaw, such as a fault
 * handing the perk to every plan, or plan grants by the hundred. Raise it as
 * Pro grows: a day past it, AI pauses for everyone until midnight UTC.
 */
export const AI_PLATFORM_DAILY_CENTS = 10_000;

/** A store's credit this month: what its plan gives, what it has used (both
 *  in micros), and when the next month's starts. */
export type AiCredit = { allowance: number; used: number; renewsAt: string };

/** `plan`'s monthly credit, in micros. */
export function aiCreditAllowance(plan: PlanId): number {
  return PLANS[plan].aiCreditCents * MICROS_PER_CENT;
}

/** What a call that cost the platform `costMicroUsd` takes from the credit,
 *  in micros, rounded up. */
export function aiCreditCharge(costMicroUsd: number): number {
  return Math.ceil(costMicroUsd * (1 + AI_CREDIT_MARGIN));
}

/** Whether there is credit left for another call. */
export function hasAiCreditLeft(credit: AiCredit): boolean {
  return credit.used < credit.allowance;
}

/** The credit's month at `now`: its first day (YYYY-MM-01, the usage row's
 *  key), the day (the platform row's key) and the moment the next month's
 *  credit starts. UTC, like the rows. */
export function aiCreditPeriod(now: Date = new Date()): { start: string; day: string; renewsAt: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString().slice(0, 10), day: now.toISOString().slice(0, 10), renewsAt: next.toISOString() };
}
