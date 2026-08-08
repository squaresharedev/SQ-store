// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  QUARANTINE_PREFIX,
  interpretModelVerdict,
  moderateUpload,
} from "@/lib/moderation";
import { isOwnedObjectKey } from "@/lib/validation/product";

/**
 * MODERATION POLICY.
 *
 * The classifier itself cannot be tested here: Workers AI only exists on the
 * Cloudflare runtime. What CAN be tested — and is the part with security
 * consequences — is what the platform DOES with an answer, including the
 * answers that never arrive.
 *
 * The invariant these tests exist to protect: only an explicit "clean" results
 * in `allow`. A model that errors, times out, returns prose, returns nothing,
 * or returns a label nobody recognises must never publish an image.
 */

const subject = {
  kind: "product-image" as const,
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
  contentType: "image/jpeg",
  uploaderId: "11111111-1111-1111-1111-111111111111",
  accountId: "22222222-2222-2222-2222-222222222222",
};

afterEach(() => {
  delete process.env.MODERATION_ENABLED;
  vi.restoreAllMocks();
});

describe("interpretModelVerdict", () => {
  it("allows only an explicit clean label", () => {
    expect(interpretModelVerdict("clean")).toEqual({ decision: "allow" });
    // Tolerant of the shape a model actually returns.
    expect(interpretModelVerdict("  Clean.\n")).toEqual({ decision: "allow" });
  });

  it("rejects each unsafe category with copy the uploader can read", () => {
    for (const label of ["sexual", "graphic_violence", "gore", "hate_symbol"]) {
      const verdict = interpretModelVerdict(label);
      expect(verdict.decision).toBe("reject");
      if (verdict.decision === "reject") {
        expect(verdict.reason.length).toBeGreaterThan(10);
        // The uploader must not be shown a raw model label.
        expect(verdict.reason).not.toContain("_");
      }
    }
  });

  it("holds anything it cannot read, rather than allowing it", () => {
    for (const answer of [
      "unclear",
      "",
      "   ",
      "I'm sorry, I can't help with that.",
      "probably clean but there is some ambiguity here",
      "banana",
      null,
      undefined,
      42,
      { decision: "allow" },
    ]) {
      expect(interpretModelVerdict(answer).decision).toBe("review");
    }
  });

  it("never allows on a discursive answer that merely contains the word clean", () => {
    // A model that ignored the one-label instruction has not classified the
    // image; matching a substring here would turn chatter into permission.
    expect(interpretModelVerdict("The image appears clean to me").decision).toBe(
      "review",
    );
  });
});

describe("moderateUpload failure policy", () => {
  it("allows everything while disabled, which is the pre-classifier behaviour", async () => {
    await expect(moderateUpload(subject)).resolves.toEqual({ decision: "allow" });
  });

  it("quarantines rather than publishes when the classifier cannot be reached", async () => {
    process.env.MODERATION_ENABLED = "true";
    // No Cloudflare binding exists in this environment, so the dynamic import
    // of getCloudflareContext fails — the same class of failure as a provider
    // outage. The result must not be `allow`.
    const verdict = await moderateUpload(subject);
    expect(verdict.decision).toBe("review");
  });
});

describe("quarantine remains unreachable from a product", () => {
  it("cannot satisfy the owned-key check", () => {
    // The last line of defence: even if a quarantined key leaked back to a
    // client, it cannot be attached to a product.
    const key = `${QUARANTINE_PREFIX}/images/${subject.uploaderId}/${subject.accountId}-x.webp`;
    expect(isOwnedObjectKey(key, "image", subject.uploaderId)).toBe(false);
  });
});

describe("moderation is honest about what it is not", () => {
  const SOURCE = readFileSync(
    join(process.cwd(), "src", "lib", "moderation", "index.ts"),
    "utf8",
  );

  it("records that this is not a CSAM control", () => {
    // Workers AI has no purpose-built abuse classifier; this is a general
    // vision model answering a policy question. If that caveat is ever deleted,
    // someone has started believing this module is something it is not.
    expect(SOURCE).toMatch(/CSAM/);
  });

  it("keeps the classifier off by default", () => {
    // The request shape is unverified until a deploy proves it. On-by-default
    // would run that experiment against real sellers' uploads.
    expect(SOURCE).toContain('process.env.MODERATION_ENABLED === "true"');
  });
});
