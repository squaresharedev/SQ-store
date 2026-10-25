// @vitest-environment node
import { describe, expect, it } from "vitest";
import { APPROVAL_POLL_FAST_MS, APPROVAL_POLL_SLOW_MS, approvalPollDelayMs } from "@/lib/auth/approval-poll";

/** An approval waits this long to be collected (lib/auth/sign-in-approval.ts). */
const COLLECT_MS = 50_000;
/** How long a QR code stays usable (APPROVAL_REQUEST_SECONDS). */
const REQUEST_MS = 5 * 60 * 1000;

/** Every ask a visible page makes over a QR code's whole life. */
function asksOver(totalMs: number): number {
  let at = 0;
  let asks = 0;
  for (;;) {
    at += asks === 0 ? APPROVAL_POLL_FAST_MS : approvalPollDelayMs(at, false);
    if (at > totalMs) return asks;
    asks += 1;
  }
}

describe("approvalPollDelayMs", () => {
  it("asks quickly while the person is reaching for the phone, then slows down", () => {
    expect(approvalPollDelayMs(0, false)).toBe(APPROVAL_POLL_FAST_MS);
    expect(approvalPollDelayMs(19_999, false)).toBe(APPROVAL_POLL_FAST_MS);
    expect(approvalPollDelayMs(20_000, false)).toBeGreaterThan(APPROVAL_POLL_FAST_MS);
    expect(approvalPollDelayMs(60_000, false)).toBe(APPROVAL_POLL_SLOW_MS);
  });

  it("is always the slow step in a background tab", () => {
    expect(approvalPollDelayMs(0, true)).toBe(APPROVAL_POLL_SLOW_MS);
  });

  it("never waits long enough for an approval to go uncollected", () => {
    for (const waited of [0, 10_000, 30_000, 90_000, REQUEST_MS]) {
      expect(approvalPollDelayMs(waited, false)).toBeLessThan(COLLECT_MS);
    }
  });

  it("asks well under half as often as a flat two-second poll over a QR code's life", () => {
    const flat = REQUEST_MS / APPROVAL_POLL_FAST_MS;
    expect(asksOver(REQUEST_MS)).toBeLessThan(flat * 0.5);
  });
});
