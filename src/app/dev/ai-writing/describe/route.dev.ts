import { z } from "zod";
import { suggestionClient } from "@/lib/ai-suggestions";
import { SUGGESTION_MODEL } from "@/lib/suggestions/ai";
import { describeRequestSchema } from "@/lib/suggestions/describe";
import { describeListing, describeListingForTest, describePrompt } from "@/lib/suggestions/describe-listing";
import { LAB_BUDGET_SPENT, takeLabModelCall } from "../lab-budget";

/**
 * POST /dev/ai-writing/describe: the AI writing lab's way to the describe
 * task, with no session, plan or budget, so the real chip can be tried while
 * nobody is signed in. The real model when this machine has a key, else (or
 * with `?standIn=1`) the stand-in. The answer says which answered, how long
 * it took, what it cost and what the model read. Only `next dev` builds a
 * route.dev.ts, so this does not exist anywhere else; real calls stop at the
 * lab's own hourly ceiling (../lab-budget.ts).
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = describeRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, reason: "too_little", model: "none", ms: 0, cost: 0, prompt: z.prettifyError(parsed.error) });
  }
  const client = new URL(request.url).searchParams.has("standIn") ? null : suggestionClient();
  if (client && !takeLabModelCall()) return Response.json(LAB_BUDGET_SPENT);
  const started = Date.now();
  const outcome = client ? await describeListing(client, parsed.data) : describeListingForTest(parsed.data);
  return Response.json({
    ...outcome,
    model: client ? SUGGESTION_MODEL : "stand-in",
    ms: Date.now() - started,
    prompt: describePrompt(parsed.data),
  });
}
