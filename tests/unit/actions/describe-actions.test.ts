// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// AI writing help's two actions (a draft, and the next words as you type):
// every gate before the model is asked, what each refusal says, and that the
// most a call can cost is held on the store's credit before it and settled to
// what it cost after. The model itself is faked; the real one is measured in
// the *.live.test.ts evals.

const getActiveAccountMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({ getActiveAccount: () => getActiveAccountMock() }));

const planMock = vi.fn();
const holdMock = vi.fn();
const settleMock = vi.fn();
const testProviderMock = vi.fn();
const clientMock = vi.fn();
vi.mock("@/lib/ai-suggestions", () => ({
  aiPlanFor: (...args: unknown[]) => planMock(...args),
  holdAiCredit: (...args: unknown[]) => holdMock(...args),
  settleAiCredit: (...args: unknown[]) => settleMock(...args),
  aiTestProvider: () => testProviderMock(),
  suggestionClient: () => clientMock(),
}));

const describeMock = vi.fn();
vi.mock("@/lib/suggestions/describe-listing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/suggestions/describe-listing")>()),
  describeListing: (...args: unknown[]) => describeMock(...args),
}));

const completeMock = vi.fn();
vi.mock("@/lib/suggestions/complete-listing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/suggestions/complete-listing")>()),
  completeListing: (...args: unknown[]) => completeMock(...args),
}));

const rateLimitMock = vi.fn();
const rateLimitKeyMock = vi.fn();
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
  rateLimitKey: (...args: unknown[]) => rateLimitKeyMock(...args),
}));

const { suggestDescriptionCompletion, suggestProductDescription } = await import("@/lib/products/describe-actions");
const { describeListingMaxCost } = await import("@/lib/suggestions/describe-listing");
const { completeListingMaxCost } = await import("@/lib/suggestions/complete-listing");

const OWNER = "11111111-1111-4111-8111-111111111111";
const REQUEST = {
  mode: "write" as const,
  title: "Ceramic mug",
  text: "",
  facts: [{ label: "Capacity", value: "350 ml" }],
  language: "en",
};
const TYPING = { title: "Ceramic mug", text: "A mug that holds ", facts: REQUEST.facts, language: "en" };
const CLIENT = { messages: {} };
const HOLD = { ownerId: OWNER, period: "2026-11-01", day: "2026-11-04", micros: 4_000 };

/** The key of the message an action failed with. */
async function refusal(request: unknown = REQUEST): Promise<string | undefined> {
  const result = await suggestProductDescription(request);
  return result.ok ? undefined : result.error.message.key;
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveAccountMock.mockResolvedValue({ accountId: OWNER, userId: OWNER, role: "owner", isOwner: true });
  planMock.mockResolvedValue({ ok: true, plan: "pro" });
  holdMock.mockResolvedValue({ ok: true, hold: HOLD });
  settleMock.mockResolvedValue(undefined);
  testProviderMock.mockReturnValue(false);
  clientMock.mockReturnValue(CLIENT);
  rateLimitMock.mockResolvedValue(true);
  rateLimitKeyMock.mockResolvedValue(true);
  describeMock.mockResolvedValue({ ok: true, text: "A ceramic mug that holds 350 ml.", cost: 180 });
  completeMock.mockResolvedValue({ ok: true, completion: "350 ml.", cost: 150 });
});

describe("suggestProductDescription", () => {
  it("answers with the draft after every check, holding the most first and settling what it cost", async () => {
    await expect(suggestProductDescription(REQUEST)).resolves.toEqual({ ok: true, text: "A ceramic mug that holds 350 ml." });
    expect(describeMock).toHaveBeenCalledWith(CLIENT, REQUEST);
    expect(planMock).toHaveBeenCalledWith(OWNER);
    expect(rateLimitMock).toHaveBeenCalledWith("ai_suggest", expect.anything());
    expect(rateLimitKeyMock).toHaveBeenCalledWith(OWNER, "ai_suggest_store", expect.anything());
    expect(holdMock).toHaveBeenCalledWith(OWNER, "pro", describeListingMaxCost(REQUEST));
    expect(holdMock.mock.invocationCallOrder[0]).toBeLessThan(describeMock.mock.invocationCallOrder[0]!);
    expect(settleMock).toHaveBeenCalledWith(HOLD, 180);
  });

  it("needs a session and the right to edit products", async () => {
    getActiveAccountMock.mockResolvedValueOnce(null);
    expect(await refusal()).toBe("Errors.sessionExpired.message");
    getActiveAccountMock.mockResolvedValueOnce({ accountId: OWNER, userId: "x", role: "viewer", isOwner: false });
    expect(await refusal()).toBe("Errors.permissionDenied.editProducts.withRole");
    expect(describeMock).not.toHaveBeenCalled();
    expect(holdMock).not.toHaveBeenCalled();
  });

  it("refuses a malformed request, an oversized one, and one with nothing to write from, before any budget", async () => {
    expect(await refusal({ ...REQUEST, title: "" })).toBe("Errors.products.invalid.message");
    // Every part within its own limit, the whole past the total.
    const heavy = Array.from({ length: 13 }, (_, index) => ({ label: `Spec ${index}`, value: "x".repeat(1_000) }));
    expect(await refusal({ ...REQUEST, facts: heavy })).toBe("Errors.products.invalid.message");
    expect(await refusal({ ...REQUEST, facts: [] })).toBe("Errors.ai.tooLittle.message");
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(planMock).not.toHaveBeenCalled();
    expect(holdMock).not.toHaveBeenCalled();
  });

  it("is a Pro perk, checked here whatever the screen showed", async () => {
    planMock.mockResolvedValueOnce({ ok: false, reason: "not_on_plan" });
    expect(await refusal()).toBe("Errors.ai.notOnPlan.message");
    planMock.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    expect(await refusal()).toBe("Errors.ai.unavailable.message");
    expect(holdMock).not.toHaveBeenCalled();
    expect(describeMock).not.toHaveBeenCalled();
  });

  it("asks nothing when the credit has no room for the call, or cannot be held", async () => {
    holdMock.mockResolvedValueOnce({ ok: false, reason: "credit_used" });
    expect(await refusal()).toBe("Errors.ai.creditUsed.message");
    // The platform's day full, or the database down: not the seller's doing.
    holdMock.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    expect(await refusal()).toBe("Errors.ai.unavailable.message");
    expect(describeMock).not.toHaveBeenCalled();
    expect(settleMock).not.toHaveBeenCalled();
  });

  it("stops at each pace budget, before anything is held", async () => {
    rateLimitMock.mockResolvedValueOnce(false);
    expect(await refusal()).toBe("Errors.rateLimited.writeWithAi");
    rateLimitKeyMock.mockResolvedValueOnce(false);
    expect(await refusal()).toBe("Errors.rateLimited.writeWithAi");
    expect(holdMock).not.toHaveBeenCalled();
    expect(describeMock).not.toHaveBeenCalled();
  });

  it("says why there is no draft, and settles every outcome to what it cost", async () => {
    describeMock.mockResolvedValueOnce({ ok: false, reason: "declined", cost: 90 });
    expect(await refusal()).toBe("Errors.ai.declined.message");
    expect(settleMock).toHaveBeenLastCalledWith(HOLD, 90);
    describeMock.mockResolvedValueOnce({ ok: false, reason: "too_little", cost: 90 });
    expect(await refusal()).toBe("Errors.ai.tooLittle.message");
    clientMock.mockReturnValueOnce(null);
    expect(await refusal()).toBe("Errors.ai.unavailable.message");
    expect(settleMock).toHaveBeenLastCalledWith(HOLD, 0);
  });

  it("answers from the stand-in when the test provider is on, and gives the hold back", async () => {
    testProviderMock.mockReturnValue(true);
    await expect(suggestProductDescription(REQUEST)).resolves.toEqual({
      ok: true,
      text: "A test description of Ceramic mug: 350 ml.",
    });
    expect(describeMock).not.toHaveBeenCalled();
    expect(settleMock).toHaveBeenCalledWith(HOLD, 0);
  });
});

describe("suggestDescriptionCompletion", () => {
  it("answers with the next words after its own budgets, holding the most and settling what they cost", async () => {
    await expect(suggestDescriptionCompletion(TYPING)).resolves.toEqual({ ok: true, completion: "350 ml." });
    expect(completeMock).toHaveBeenCalledWith(CLIENT, TYPING);
    expect(rateLimitMock).toHaveBeenCalledWith("ai_complete_minute", expect.anything());
    expect(rateLimitMock).toHaveBeenCalledWith("ai_complete", expect.anything());
    expect(rateLimitKeyMock).toHaveBeenCalledWith(OWNER, "ai_complete_store", expect.anything());
    expect(holdMock).toHaveBeenCalledWith(OWNER, "pro", completeListingMaxCost(TYPING));
    expect(settleMock).toHaveBeenCalledWith(HOLD, 150);
  });

  it("costs nothing mid-word: no budget, no hold, no call", async () => {
    await expect(suggestDescriptionCompletion({ ...TYPING, text: "A mug that hol" })).resolves.toEqual({
      ok: true,
      completion: "",
    });
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(holdMock).not.toHaveBeenCalled();
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("is refused like a draft: no session, no role, no plan, no credit, too fast", async () => {
    getActiveAccountMock.mockResolvedValueOnce(null);
    expect((await suggestDescriptionCompletion(TYPING)).ok).toBe(false);
    holdMock.mockResolvedValueOnce({ ok: false, reason: "credit_used" });
    const used = await suggestDescriptionCompletion(TYPING);
    expect(used.ok ? null : used.error.message.key).toBe("Errors.ai.creditUsed.message");
    rateLimitMock.mockResolvedValueOnce(false);
    const fast = await suggestDescriptionCompletion(TYPING);
    expect(fast.ok ? null : fast.error.code).toBe("rate_limited");
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("settles a call that never answered at the most it could have cost", async () => {
    const most = completeListingMaxCost(TYPING);
    completeMock.mockResolvedValueOnce({ ok: false, reason: "unavailable", cost: most });
    expect((await suggestDescriptionCompletion(TYPING)).ok).toBe(false);
    expect(settleMock).toHaveBeenCalledWith(HOLD, most);
  });

  it("answers from the stand-in when the test provider is on", async () => {
    testProviderMock.mockReturnValue(true);
    await expect(suggestDescriptionCompletion(TYPING)).resolves.toEqual({ ok: true, completion: "350 ml." });
    expect(completeMock).not.toHaveBeenCalled();
  });
});
