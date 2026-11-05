// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LAB_MODEL_CALLS_PER_HOUR, takeLabModelCall } from "@/app/dev/ai-writing/lab-budget";

// The AI writing lab's dev routes spend this machine's key with no sign-in,
// on a server every device on the network can reach: they stop at an hour's
// ceiling, and start again as the hour moves on.
describe("the AI writing lab's model budget", () => {
  it("allows an hour's calls, refuses the next, and frees them an hour later", () => {
    const start = 1_000_000;
    for (let call = 0; call < LAB_MODEL_CALLS_PER_HOUR; call += 1) {
      expect(takeLabModelCall(start + call)).toBe(true);
    }
    expect(takeLabModelCall(start + LAB_MODEL_CALLS_PER_HOUR)).toBe(false);
    expect(takeLabModelCall(start + 60 * 60 * 1000 - 1)).toBe(false);
    // The first call's hour is over: one more may go.
    expect(takeLabModelCall(start + 60 * 60 * 1000)).toBe(true);
    expect(takeLabModelCall(start + 60 * 60 * 1000)).toBe(false);
  });
});
