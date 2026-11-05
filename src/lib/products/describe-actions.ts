"use server";

import { msg } from "@/i18n/types";
import {
  aiPlanFor,
  aiTestProvider,
  holdAiCredit,
  settleAiCredit,
  suggestionClient,
  type AiCreditHold,
  type AiRefusal,
} from "@/lib/ai-suggestions";
import {
  actionError,
  failure,
  invalidInput,
  permissionDenied,
  rateLimited,
  sessionExpired,
  type ActionError,
  type ActionFailure,
} from "@/lib/errors";
import { RATE_LIMITS, rateLimit, rateLimitKey, type RateLimitBudget } from "@/lib/rate-limit";
import { canComplete, completeRequestSchema, type CompleteOutcome } from "@/lib/suggestions/complete";
import { completeListing, completeListingForTest, completeListingMaxCost } from "@/lib/suggestions/complete-listing";
import type { Costed } from "@/lib/suggestions/ai";
import { canDescribe, describeRequestSchema, type DescribeOutcome } from "@/lib/suggestions/describe";
import { describeListing, describeListingForTest, describeListingMaxCost } from "@/lib/suggestions/describe-listing";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";

const notOnPlan = (): ActionError =>
  actionError("permission_denied", msg("Errors.ai.notOnPlan.message"), msg("Errors.ai.notOnPlan.fix"));
const tooLittle = (): ActionError =>
  invalidInput(msg("Errors.ai.tooLittle.message"), msg("Errors.ai.tooLittle.fix"));
const unavailable = (): ActionError =>
  actionError("server_error", msg("Errors.ai.unavailable.message"), msg("Errors.ai.unavailable.fix"));
const declined = (): ActionError =>
  actionError("invalid_input", msg("Errors.ai.declined.message"), msg("Errors.ai.declined.fix"));
const creditUsed = (): ActionError =>
  actionError("rate_limited", msg("Errors.ai.creditUsed.message"), msg("Errors.ai.creditUsed.fix"));

const REFUSED: Record<AiRefusal, () => ActionError> = {
  not_on_plan: notOnPlan,
  credit_used: creditUsed,
  unavailable,
};

const NO_DRAFT: Record<Exclude<DescribeOutcome, { ok: true }>["reason"], () => ActionError> = {
  too_little: tooLittle,
  declined,
  unavailable,
};

type Budget = { action: string; budget: RateLimitBudget };

/** The budgets one AI task spends before the model is asked (rate-limit.ts). */
type AiPace = { person: Budget[]; store: Budget };

const DESCRIBE_PACE: AiPace = {
  person: [{ action: "ai_suggest", budget: RATE_LIMITS.aiSuggest }],
  store: { action: "ai_suggest_store", budget: RATE_LIMITS.aiSuggestPerStore },
};

const COMPLETE_PACE: AiPace = {
  person: [
    { action: "ai_complete_minute", budget: RATE_LIMITS.aiCompletePerMinute },
    { action: "ai_complete", budget: RATE_LIMITS.aiComplete },
  ],
  store: { action: "ai_complete_store", budget: RATE_LIMITS.aiCompletePerStore },
};

/**
 * The one way into a model call: the plan and the pace budgets, side by side
 * (an answer while someone types cannot wait for every round trip in a row),
 * then a hold on the month's credit and the platform's day for the most the
 * call can cost (`maxCostMicroUsd`). The caller settles the hold once the
 * call is back (settleAiCredit), whatever came of it.
 */
async function startAiCall(
  accountId: string,
  pace: AiPace,
  maxCostMicroUsd: number,
): Promise<{ ok: true; hold: AiCreditHold } | { ok: false; error: ActionError }> {
  const [plan, person, store] = await Promise.all([
    aiPlanFor(accountId),
    Promise.all(pace.person.map(({ action, budget }) => rateLimit(action, budget))),
    rateLimitKey(accountId, pace.store.action, pace.store.budget),
  ]);
  if (!plan.ok) return { ok: false, error: REFUSED[plan.reason]() };
  if (!person.every(Boolean) || !store) return { ok: false, error: rateLimited("writeWithAi") };
  const held = await holdAiCredit(accountId, plan.plan, maxCostMicroUsd);
  return held.ok ? held : { ok: false, error: REFUSED[held.reason]() };
}

/**
 * A product description written or improved by AI, from what the seller has
 * entered so far (the shared core: lib/suggestions/describe.ts). A Pro perk.
 *
 * Only answers: nothing is saved, and the form puts the text in the field
 * where the seller reads it, changes it or takes it back. The save then checks
 * it like anything else they type (lib/moderation).
 *
 * The plan, the role and the month's AI credit are checked here, never
 * trusted from the screen; every draft spends the pace budgets and holds the
 * most it can cost before the model is asked, and is settled to what it
 * really cost after (startAiCall).
 * Nothing but the request is sent: no seller identity, no contact details.
 */
export async function suggestProductDescription(request: unknown): Promise<{ ok: true; text: string } | ActionFailure> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) return failure(permissionDenied(account.role, "editProducts"));
  const parsed = describeRequestSchema.safeParse(request);
  if (!parsed.success) {
    return failure(invalidInput(msg("Errors.products.invalid.message"), msg("Errors.products.invalid.fix")));
  }
  // Before any budget: the screen never offers it with nothing to write from.
  if (!canDescribe(parsed.data)) return failure(tooLittle());
  const started = await startAiCall(account.accountId, DESCRIBE_PACE, describeListingMaxCost(parsed.data));
  if (!started.ok) return failure(started.error);

  const client = suggestionClient();
  const outcome: Costed<DescribeOutcome> = aiTestProvider()
    ? describeListingForTest(parsed.data)
    : client
      ? await describeListing(client, parsed.data)
      : { ok: false, reason: "unavailable", cost: 0 };
  await settleAiCredit(started.hold, outcome.cost);
  return outcome.ok ? { ok: true, text: outcome.text } : failure(NO_DRAFT[outcome.reason]());
}

/**
 * The next few words of a description while the seller types it, shown in
 * grey after the cursor (components/ui/SuggestingTextarea). A Pro perk, on
 * the same credit as drafts.
 *
 * "" is the usual answer, not a failure: the listing seldom says how the
 * sentence goes on. A description with nothing worth asking about yet costs
 * nothing (no budget, no call). The field stays quiet about failures, except
 * a used-up credit, which it says once.
 */
export async function suggestDescriptionCompletion(
  request: unknown,
): Promise<{ ok: true; completion: string } | ActionFailure> {
  const account = await getActiveAccount();
  if (!account) return failure(sessionExpired());
  if (!can(account.role, "products.write")) return failure(permissionDenied(account.role, "editProducts"));
  const parsed = completeRequestSchema.safeParse(request);
  if (!parsed.success) {
    return failure(invalidInput(msg("Errors.products.invalid.message"), msg("Errors.products.invalid.fix")));
  }
  if (!canComplete(parsed.data)) return { ok: true, completion: "" };
  const started = await startAiCall(account.accountId, COMPLETE_PACE, completeListingMaxCost(parsed.data));
  if (!started.ok) return failure(started.error);

  const client = suggestionClient();
  const outcome: Costed<CompleteOutcome> = aiTestProvider()
    ? completeListingForTest(parsed.data)
    : client
      ? await completeListing(client, parsed.data)
      : { ok: false, reason: "unavailable", cost: 0 };
  await settleAiCredit(started.hold, outcome.cost);
  if (outcome.ok) return { ok: true, completion: outcome.completion };
  return failure(outcome.reason === "declined" ? declined() : unavailable());
}
