import { z } from "zod";
import { suggestionClient } from "@/lib/ai-suggestions";
import { SUGGESTION_MODEL } from "@/lib/suggestions/ai";
import { completeRequestSchema } from "@/lib/suggestions/complete";
import { completeListing, completeListingForTest, completePrompt } from "@/lib/suggestions/complete-listing";
import { LAB_BUDGET_SPENT, takeLabModelCall } from "../lab-budget";

/**
 * POST /dev/ai-writing/complete: the AI writing lab's way to the complete
 * task (the grey next words), like ../describe: no session, plan, budget or
 * credit; the real model when this machine has a key, else (or with
 * `?standIn=1`) the stand-in, up to the lab's hourly ceiling
 * (../lab-budget.ts). Only `next dev` builds a route.dev.ts.
 */
export async function POST(request: Request): Promise<Response> {
  const parsed = completeRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, reason: "unavailable", model: "none", ms: 0, cost: 0, prompt: z.prettifyError(parsed.error) });
  }
  const client = new URL(request.url).searchParams.has("standIn") ? null : suggestionClient();
  if (client && !takeLabModelCall()) return Response.json(LAB_BUDGET_SPENT);
  const started = Date.now();
  const outcome = client ? await completeListing(client, parsed.data) : completeListingForTest(parsed.data);
  return Response.json({
    ...outcome,
    model: client ? SUGGESTION_MODEL : "stand-in",
    ms: Date.now() - started,
    prompt: completePrompt(parsed.data),
  });
}
