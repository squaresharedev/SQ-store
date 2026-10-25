// The waiting page's poll for a phone's answer (components/auth/ApproveFromDevice).
// Pure, so the schedule can be asserted without a browser.
//
// Each ask is a server action, and server actions share one queue with
// navigation, so a flat two-second poll over a five-minute QR code was up to
// 150 of them. Most approvals come in the first half minute, while the person
// is finding the phone, so the poll is quick then and slows after.
//
// The slowest step must stay well under an approval's collect window
// (COLLECT_SECONDS in lib/auth/sign-in-approval.ts, 50 s): the approval has to
// still be collectable when the next ask arrives.

/** How often the page asks at first, while the person is reaching for the phone. */
export const APPROVAL_POLL_FAST_MS = 2000;
/** The step after the first half minute. */
const APPROVAL_POLL_STEADY_MS = 4000;
/** From a minute in, and always in a background tab (the browser throttles it anyway). */
export const APPROVAL_POLL_SLOW_MS = 6000;

/** How long into the wait each quicker step lasts. */
const FAST_UNTIL_MS = 20_000;
const STEADY_UNTIL_MS = 60_000;

/** How long to wait before asking again, `waitedMs` into the wait. */
export function approvalPollDelayMs(waitedMs: number, hidden: boolean): number {
  if (hidden) return APPROVAL_POLL_SLOW_MS;
  if (waitedMs < FAST_UNTIL_MS) return APPROVAL_POLL_FAST_MS;
  if (waitedMs < STEADY_UNTIL_MS) return APPROVAL_POLL_STEADY_MS;
  return APPROVAL_POLL_SLOW_MS;
}
