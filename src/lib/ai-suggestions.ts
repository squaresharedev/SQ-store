// SERVER ONLY. The Store's wiring of AI writing help (the shared core is
// lib/suggestions): who gets it, what it has left to spend, and the client it
// is asked through.
//
// Who gets it: a store whose plan has the aiSuggestions perk (Pro), on a
// deployment that can reach the model. Pages ask aiWritingFor before they
// offer it; the actions ask aiPlanFor and holdAiCredit before they spend
// anything, so a screen that is out of date (a plan that lapsed mid-visit, a
// credit used up in another tab) is refused, not served.
//
// What it has to spend: the month's AI credit (lib/billing/ai-credit.ts). The
// most a call can cost is held before it, and settled to what it really cost
// after.

import Anthropic from "@anthropic-ai/sdk";
import { getAccountBilling } from "@/lib/billing/account-plan";
import {
  AI_PLATFORM_DAILY_CENTS,
  aiCreditAllowance,
  aiCreditCharge,
  aiCreditPeriod,
  hasAiCreditLeft,
  MICROS_PER_CENT,
  type AiCredit,
} from "@/lib/billing/ai-credit";
import { planHas } from "@/lib/billing/features";
import type { PlanId } from "@/lib/billing/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The stand-in model (lib/suggestions/describe-listing.ts describeListingForTest),
 * for the e2e stack. Development builds only: a deployed Worker is a
 * production build, so a real seller is never answered by it. It writes
 * nothing anywhere, so unlike the moderation stand-in it needs no local
 * database.
 */
export function aiTestProvider(): boolean {
  return process.env.NODE_ENV === "development" && process.env.AI_SUGGESTIONS_TEST_PROVIDER === "1";
}

// One client per isolate. The key is read from ANTHROPIC_API_KEY by the SDK.
let cachedClient: Anthropic | undefined;

/** The client a suggestion is asked through, or null with no key here. */
export function suggestionClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  cachedClient ??= new Anthropic();
  return cachedClient;
}

/** Whether this deployment can answer at all: a key, or the stand-in. */
const canAnswer = () => aiTestProvider() || Boolean(process.env.ANTHROPIC_API_KEY);

/** What the product form offers of AI writing help (ProductForm's props). */
export type AiWriting = {
  /** The perk: the draft chip and, with `suggestAsYouType`, grey next words. */
  aiSuggestions: boolean;
  /** This person's own switch for the grey next words. */
  suggestAsYouType: boolean;
  /** A plan without the perk, on a deployment that has it: the quiet link. */
  aiUpsell: boolean;
  /** With the perk: the month's credit is spent, so the form says so before a
   *  tap rather than after one. False when it cannot be read: the actions
   *  check again either way. */
  aiCreditUsed: boolean;
};

export const NO_AI_WRITING: AiWriting = {
  aiSuggestions: false,
  suggestAsYouType: false,
  aiUpsell: false,
  aiCreditUsed: false,
};

/** What `userId` gets of AI writing help in `accountId`'s store now. A plan
 *  that cannot be read offers nothing: the perk is never handed out on a
 *  guess, and an upsell on a guess could be selling a plan they have. */
export async function aiWritingFor(accountId: string, userId: string): Promise<AiWriting> {
  if (!canAnswer()) return NO_AI_WRITING;
  const billing = await getAccountBilling(accountId);
  if (!billing.ok) return NO_AI_WRITING;
  const plan = billing.billing.plan;
  if (!planHas(plan, "aiSuggestions")) return { ...NO_AI_WRITING, aiUpsell: true };
  const [asYouType, credit] = await Promise.all([
    suggestsAsYouType(userId),
    // A credit that cannot be read must not cost the seller the form.
    readAiCredit(accountId, plan).catch(() => null),
  ]);
  return {
    aiSuggestions: true,
    suggestAsYouType: asYouType,
    aiUpsell: false,
    aiCreditUsed: credit !== null && !hasAiCreditLeft(credit),
  };
}

/**
 * Settings › Plan & billing's AI writing card (components/settings/
 * AiWritingCard): on a plan with the perk, the month's credit (null when it
 * cannot be read) and this person's switch; on one without, what Pro adds.
 * Null on a deployment that cannot answer at all: no card to show.
 */
export type AiSettings =
  | { kind: "included"; credit: AiCredit | null; suggestAsYouType: boolean }
  | { kind: "upsell" }
  | null;

export async function aiSettingsFor(accountId: string, userId: string, plan: PlanId): Promise<AiSettings> {
  if (!canAnswer()) return null;
  if (!planHas(plan, "aiSuggestions")) return { kind: "upsell" };
  const [credit, asYouType] = await Promise.all([readAiCredit(accountId, plan), suggestsAsYouType(userId)]);
  return { kind: "included", credit, suggestAsYouType: asYouType };
}

/**
 * The store's AI credit this month on `plan`, or null when it cannot be read.
 * Null refuses the call: credit nobody can count is credit nobody can check.
 */
export async function readAiCredit(accountId: string, plan: PlanId): Promise<AiCredit | null> {
  const period = aiCreditPeriod();
  const { data, error } = await createAdminClient()
    .from("ai_credit_usage")
    .select("used_micros")
    .eq("owner_id", accountId)
    .eq("period", period.start)
    .maybeSingle();
  if (error) {
    console.warn("[ai-credit] read failed:", error.message);
    return null;
  }
  return { allowance: aiCreditAllowance(plan), used: data?.used_micros ?? 0, renewsAt: period.renewsAt };
}

/** Why the store may not spend on AI now. */
export type AiRefusal = "not_on_plan" | "credit_used" | "unavailable";

/** The store's plan, when it has the perk on a deployment that can answer. */
export async function aiPlanFor(accountId: string): Promise<{ ok: true; plan: PlanId } | { ok: false; reason: AiRefusal }> {
  if (!canAnswer()) return { ok: false, reason: "not_on_plan" };
  const billing = await getAccountBilling(accountId);
  if (!billing.ok) return { ok: false, reason: "unavailable" };
  const plan = billing.billing.plan;
  return planHas(plan, "aiSuggestions") ? { ok: true, plan } : { ok: false, reason: "not_on_plan" };
}

/** Credit held for one call (holdAiCredit), until settleAiCredit says what it
 *  really cost. `micros` is what was held; the rest names the rows. */
export type AiCreditHold = { ownerId: string; period: string; day: string; micros: number };

/**
 * Holds the most a call can cost (`maxCostMicroUsd`, from the task's
 * maxCost) on the store's month and the platform's day, in one atomic step
 * that refuses when either has no room for it. Refused when it cannot be
 * done: credit nobody can count is credit nobody can check.
 */
export async function holdAiCredit(
  accountId: string,
  plan: PlanId,
  maxCostMicroUsd: number,
): Promise<{ ok: true; hold: AiCreditHold } | { ok: false; reason: AiRefusal }> {
  const period = aiCreditPeriod();
  const hold: AiCreditHold = {
    ownerId: accountId,
    period: period.start,
    day: period.day,
    micros: aiCreditCharge(maxCostMicroUsd),
  };
  const { data, error } = await createAdminClient().rpc("ai_credit_hold", {
    p_owner: hold.ownerId,
    p_period: hold.period,
    p_day: hold.day,
    p_micros: hold.micros,
    p_allowance: aiCreditAllowance(plan),
    p_platform_max: AI_PLATFORM_DAILY_CENTS * MICROS_PER_CENT,
  });
  if (error) {
    console.warn("[ai-credit] hold failed:", error.message);
    return { ok: false, reason: "unavailable" };
  }
  if (data === "held") return { ok: true, hold };
  if (data === "credit_used") return { ok: false, reason: "credit_used" };
  // The platform's day is full: not the seller's doing, so it reads as "not
  // available right now", and it is something to look at.
  console.error("[ai-credit] the platform's daily AI ceiling is reached:", data);
  return { ok: false, reason: "unavailable" };
}

/**
 * Settles `hold` to what the call really cost the platform (`costMicroUsd`,
 * plus the margin): what was held and not spent goes back. A settle that
 * fails is logged, not retried: the store stays charged the most the call
 * could have cost, which is never less than it did.
 */
export async function settleAiCredit(hold: AiCreditHold, costMicroUsd: number): Promise<void> {
  const delta = aiCreditCharge(Math.max(costMicroUsd, 0)) - hold.micros;
  if (delta === 0) return;
  // Charged in full all the same; a bound that is too low is a fault to fix.
  if (delta > 0) console.error("[ai-credit] a call cost more than was held for it:", { held: hold.micros, delta });
  const { error } = await createAdminClient().rpc("ai_credit_settle", {
    p_owner: hold.ownerId,
    p_period: hold.period,
    p_day: hold.day,
    p_delta: delta,
  });
  if (error) console.error("[ai-credit] settle failed (the hold stands):", error.message);
}

/**
 * Whether the signed-in person wants suggestions while they type (their own
 * switch, on by default). Unreadable says off: an unwanted suggestion is
 * worse than a missing one.
 */
export async function suggestsAsYouType(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("ai_suggest_as_you_type").eq("id", userId).maybeSingle();
  return !error && data?.ai_suggest_as_you_type === true;
}
