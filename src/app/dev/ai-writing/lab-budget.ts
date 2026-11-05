/**
 * The AI writing lab's own ceiling on real model calls (./describe and
 * ./complete route.dev.ts). Those routes ask the model on this machine's key
 * with no session, plan or credit, and `next dev` listens on every interface,
 * so anyone on the same network can reach them. This bounds what they can
 * spend: past it the lab answers "unavailable" until the hour has moved on.
 * In memory on purpose: only `next dev` builds these routes, one process.
 */
export const LAB_MODEL_CALLS_PER_HOUR = 200;

const HOUR_MS = 60 * 60 * 1000;
const calls: number[] = [];

/** Takes one real model call from the hour, or says there is none left. */
export function takeLabModelCall(now: number = Date.now()): boolean {
  while (calls.length > 0 && calls[0]! <= now - HOUR_MS) calls.shift();
  if (calls.length >= LAB_MODEL_CALLS_PER_HOUR) return false;
  calls.push(now);
  return true;
}

/** What a route answers once the hour's calls are spent. */
export const LAB_BUDGET_SPENT = {
  ok: false,
  reason: "unavailable",
  model: "none",
  ms: 0,
  cost: 0,
  prompt: `The lab's ${LAB_MODEL_CALLS_PER_HOUR} real model calls this hour are spent. Switch on the stand-in, or wait.`,
} as const;
