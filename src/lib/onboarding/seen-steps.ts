// WHICH SETUP STEPS THIS DEVICE HAS ALREADY SEEN DONE.
//
// The "Get set up" card plays a short animation for a step the first time it is
// seen done (its point turns green, its flag goes up, its box ticks). To know
// which steps are new, the card needs what it showed last time. That lives in a
// COOKIE rather than localStorage because the card renders on the server: the
// server reads it, so the very first paint already has each new step in its
// "before" pose, waiting to play. Read from localStorage after hydration, the
// finished state would flash first and then rewind.
//
// Per device on purpose: it records what THIS screen has shown, which is what
// "seen" means. Keyed to the account, so a different store on the same browser
// starts with no history (and so no animation) instead of borrowing one.
//
// No history at all (first visit, cleared cookies, another account) animates
// nothing: without a "before" there is nothing to tell apart from "now".

import { SETUP_STEP_IDS, type SetupStepId } from "@/lib/onboarding/steps";

export const SETUP_SEEN_COOKIE = "sq-setup-seen";

/** A year: long enough to outlive any setup. */
export const SETUP_SEEN_MAX_AGE = 60 * 60 * 24 * 365;

const STEP_IDS = new Set<string>(SETUP_STEP_IDS);

/** `<accountId>:<step>|<step>` (cookie-safe: no commas, semicolons or spaces). */
export function serializeSeenSteps(accountId: string, done: readonly SetupStepId[]): string {
  return `${accountId}:${done.join("|")}`;
}

/**
 * The steps seen done on this device for this account, or null when there is no
 * usable history (no cookie, another account's, or unreadable). Unknown step ids
 * are dropped rather than failing the whole value.
 */
export function parseSeenSteps(
  raw: string | undefined,
  accountId: string,
): SetupStepId[] | null {
  if (!raw) return null;
  const split = raw.indexOf(":");
  if (split < 0 || raw.slice(0, split) !== accountId) return null;
  const body = raw.slice(split + 1);
  if (body === "") return [];
  return body.split("|").filter((id): id is SetupStepId => STEP_IDS.has(id));
}

/** The done steps that were not done last time this device looked: the ones to
 *  animate. Nothing without a history. */
export function newlyDoneSteps(
  steps: readonly { id: SetupStepId; done: boolean }[],
  seen: readonly SetupStepId[] | null,
): SetupStepId[] {
  if (seen === null) return [];
  const before = new Set(seen);
  return steps.filter((step) => step.done && !before.has(step.id)).map((step) => step.id);
}
