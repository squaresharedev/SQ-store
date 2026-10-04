import { BILLING_INTERVALS, PAID_PLAN_IDS, type BillingInterval, type PaidPlanId } from "@/lib/billing/plans";

// The pretend subscription behind /dev/cancel. It lives in a cookie, so it
// behaves like the real one: the stand-in actions change it, and the page
// only shows the change once it refreshes (the dialog refreshes on close,
// "Keep my plan" after its toast), exactly as with the server.

/** The cookie holding the pretend subscription, scoped to the route. */
export const DEV_CANCEL_COOKIE = "sq-dev-cancel";
export const DEV_CANCEL_PATH = "/dev/cancel";

/** How the stand-in server answers cancel and keep. */
export const DEV_ANSWERS = ["ok", "refuse", "rateLimited", "serverError", "deletionPending"] as const;
export type DevAnswer = (typeof DEV_ANSWERS)[number];

export type DevCancelState = {
  plan: PaidPlanId;
  interval: BillingInterval;
  /** Cancelled: the plan ends with its period. */
  ending: boolean;
  answer: DevAnswer;
};

/** A fresh monthly Starter subscription that the server lets you change. */
export const DEV_CANCEL_START: DevCancelState = { plan: "starter", interval: "month", ending: false, answer: "ok" };

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;

/** The state in a cookie value, or the start state for anything unreadable. */
export function readDevCancelState(raw: string | undefined): DevCancelState {
  let value: Partial<Record<keyof DevCancelState, unknown>> = {};
  try {
    value = raw ? JSON.parse(decodeURIComponent(raw)) : {};
  } catch {
    // A hand-edited or stale cookie: start over.
  }
  return {
    plan: oneOf(PAID_PLAN_IDS, value.plan, DEV_CANCEL_START.plan),
    interval: oneOf(BILLING_INTERVALS, value.interval, DEV_CANCEL_START.interval),
    ending: value.ending === true,
    answer: oneOf(DEV_ANSWERS, value.answer, DEV_CANCEL_START.answer),
  };
}

/** Save the state for the next render of the page (browser only). */
export function writeDevCancelState(state: DevCancelState): void {
  document.cookie = `${DEV_CANCEL_COOKIE}=${encodeURIComponent(JSON.stringify(state))}; path=${DEV_CANCEL_PATH}; SameSite=Lax`;
}
