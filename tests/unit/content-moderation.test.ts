// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MODERATION_GATE_SELECT,
  REMOVAL_GROUNDS,
  REMOVAL_NOTE_MAX,
  isContentVisible,
  isRemovalGround,
  isRowVisible,
  removalAppealHref,
  removalStatement,
  takedownFromRow,
  takedownKind,
} from "@/lib/moderation/removal";
import {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  REPORT_REASON_COPY,
  reportSchema,
} from "@/lib/validation/reports";
import { english } from "../setup/translate";

const TARGET = "0b1f7b1e-6d3a-4f4e-9f6c-1a2b3c4d5e6f";

/**
 * The gate decides whether content reaches a buyer, so the cases that matter
 * are the ones where the answer is NOT a clean "removed": a null from a failed
 * read, a value nobody recognises, a row that never arrived.
 */
describe("isContentVisible", () => {
  it("shows only what is explicitly ok", () => {
    expect(isContentVisible("ok")).toBe(true);
    expect(isContentVisible("removed")).toBe(false);
  });

  it("fails closed on a read that could not answer", () => {
    expect(isContentVisible(null)).toBe(false);
    expect(isContentVisible("")).toBe(false);
  });

  it("fails closed on anything unrecognised, including case", () => {
    // A future status ("quarantined", say) must hide content until someone
    // has decided what it means, not publish it by default.
    expect(isContentVisible("OK")).toBe(false);
    expect(isContentVisible("quarantined")).toBe(false);
    expect(isContentVisible("pending")).toBe(false);
  });

  it("treats a row shape without the column as visible", () => {
    // Otherwise deploying the gate ahead of the migration takes the whole
    // catalogue offline.
    expect(isContentVisible(undefined)).toBe(true);
  });
});

describe("takedownKind", () => {
  it("names the two takedowns and nothing for live content", () => {
    expect(takedownKind("ok")).toBeNull();
    expect(takedownKind("paused")).toBe("paused");
    expect(takedownKind("removed")).toBe("removed");
  });

  it("reads anything else hidden as the stricter kind", () => {
    // A status from a newer admin deploy must not offer the seller a review
    // button whose server half would refuse it.
    expect(takedownKind("quarantined")).toBe("removed");
    expect(takedownKind(null)).toBe("removed");
  });

  it("hides a paused row exactly like a removed one", () => {
    expect(isContentVisible("paused")).toBe(false);
  });
});

describe("takedownFromRow", () => {
  const base = {
    moderation_ground: "other",
    moderation_note: "Replace the second photo.",
    moderated_at: "2026-09-23T10:00:00Z",
    moderation_review_requested_at: "2026-09-23T12:00:00Z",
  };

  it("is null for a live row, so callers can spread it", () => {
    expect(takedownFromRow({ ...base, moderation_status: "ok" })).toBeNull();
  });

  it("carries the review request on a pause", () => {
    expect(takedownFromRow({ ...base, moderation_status: "paused" })).toEqual({
      kind: "paused",
      ground: "other",
      note: "Replace the second photo.",
      at: "2026-09-23T10:00:00Z",
      reviewRequestedAt: "2026-09-23T12:00:00Z",
    });
  });

  it("never shows a removal as waiting on anyone", () => {
    expect(
      takedownFromRow({ ...base, moderation_status: "removed" })?.reviewRequestedAt,
    ).toBeNull();
  });
});

describe("isRowVisible", () => {
  it("hides a row that is missing entirely", () => {
    expect(isRowVisible(null)).toBe(false);
    expect(isRowVisible(undefined)).toBe(false);
  });

  it("reads the column off the row", () => {
    expect(isRowVisible({ moderation_status: "ok" })).toBe(true);
    expect(isRowVisible({ moderation_status: "removed" })).toBe(false);
    expect(isRowVisible({ moderation_status: null })).toBe(false);
  });

  it("names the column the select actually asks for", () => {
    // If these drift, every gate reads undefined and silently passes.
    expect(MODERATION_GATE_SELECT).toBe("moderation_status");
  });
});

describe("removalStatement", () => {
  it("gives every ground a sentence a person can read", () => {
    for (const ground of REMOVAL_GROUNDS) {
      const statement = english(removalStatement(ground));
      expect(statement.length).toBeGreaterThan(10);
      expect(statement.endsWith(".")).toBe(true);
    }
  });

  it("names the ground, then what it means, in the words it always used", () => {
    // What the removal banner has always printed: the ground's label, then
    // the explanation. Legal copy, so moved word for word.
    const expected: Record<(typeof REMOVAL_GROUNDS)[number], string> = {
      illegal:
        "Illegal goods or activity. It offered something that cannot be sold legally, or used the listing to arrange it.",
      sexual: "Sexual content. It contained explicit sexual content.",
      violence: "Violence or gore. It contained graphic violence.",
      hate: "Hate or harassment. It attacked a person or group, or carried hate symbolism.",
      counterfeit:
        "Counterfeit or stolen. It appeared to offer counterfeit goods, or work that belongs to someone else.",
      scam: "Scam or fraud. It appeared designed to take payment without delivering what was promised.",
      spam: "Spam. It was repetitive or misleading rather than a genuine listing.",
      other: "Something else. It broke the platform rules.",
    };
    for (const ground of REMOVAL_GROUNDS) {
      expect(english(removalStatement(ground))).toBe(expected[ground]);
    }
  });

  it("appends a staff note when there is one", () => {
    expect(english(removalStatement("counterfeit", "The mark is registered."))).toBe(
      "Counterfeit or stolen. It appeared to offer counterfeit goods, or work that belongs to someone else. The mark is registered.",
    );
  });

  it("carries the note as data, never as a message to parse", () => {
    const note = "Seller's {name} <b>tag</b> #1";
    expect(english(removalStatement("spam", note))).toBe(
      `Spam. It was repetitive or misleading rather than a genuine listing. ${note}`,
    );
  });

  it("ignores a note that is only whitespace", () => {
    expect(removalStatement("spam", "   ")).toEqual(removalStatement("spam"));
  });

  it("falls back to a real sentence for a ground it does not know", () => {
    // The admin panel writes this column. A value from a newer deploy there
    // must not produce an empty explanation here.
    expect(removalStatement("something-new")).toEqual(removalStatement("other"));
    expect(removalStatement(null)).toEqual(removalStatement("other"));
  });

  it("bounds the note to what the column accepts", () => {
    expect(REMOVAL_NOTE_MAX).toBe(500);
  });
});

describe("isRemovalGround", () => {
  it("accepts a ground and rejects anything else", () => {
    expect(isRemovalGround("hate")).toBe(true);
    expect(isRemovalGround("nudity")).toBe(false);
    expect(isRemovalGround(undefined)).toBe(false);
    expect(isRemovalGround(3)).toBe(false);
  });
});

describe("removalAppealHref", () => {
  it("pre-addresses the mail with what it is about", () => {
    const href = removalAppealHref("product", TARGET, "Brass lamp", english);
    expect(href.startsWith("mailto:")).toBe(true);
    expect(decodeURIComponent(href)).toContain("Brass lamp");
    expect(decodeURIComponent(href)).toContain(TARGET);
  });

  it("says in English exactly what it always said", () => {
    const url = new URL(removalAppealHref("product", TARGET, "Brass lamp", english));
    expect(url.pathname).toBe("support@squareshare.eu");
    expect(url.searchParams.get("subject")).toBe("Appeal: product removal (Brass lamp)");
    expect(url.searchParams.get("body")).toBe(
      [
        "I would like this product reviewed again.",
        "",
        `Product id: ${TARGET}`,
        "Name: Brass lamp",
        "",
        "Why I think this was wrong:",
        "",
      ].join("\n"),
    );

    const storefront = new URL(removalAppealHref("storefront", TARGET, "Shop", english));
    expect(storefront.searchParams.get("subject")).toBe("Appeal: storefront removal (Shop)");
    expect(storefront.searchParams.get("body")).toContain(
      `I would like this storefront reviewed again.\n\nStorefront id: ${TARGET}`,
    );
  });

  it("escapes a title that would otherwise break the URL", () => {
    const href = removalAppealHref("product", TARGET, "Lamp & Co #1 ?sale", english);
    // The raw characters must not survive into the href unencoded, or the
    // mailto silently truncates at the first one.
    expect(href).not.toContain("&subject");
    expect(href).not.toContain("#1");
    expect(decodeURIComponent(href)).toContain("Lamp & Co #1 ?sale");
  });
});

describe("reportSchema", () => {
  const valid = { targetType: "product", targetId: TARGET, reason: "scam" };

  it("accepts a bare category from an anonymous reporter", () => {
    const parsed = reportSchema.parse(valid);
    expect(parsed.details).toBe("");
    expect(parsed.reporterEmail).toBe("");
  });

  it("keeps details and a contact address, trimmed", () => {
    const parsed = reportSchema.parse({
      ...valid,
      details: "  These are fake.  ",
      reporterEmail: "buyer@example.com",
    });
    expect(parsed.details).toBe("These are fake.");
    expect(parsed.reporterEmail).toBe("buyer@example.com");
  });

  it("refuses an unknown key rather than dropping it", () => {
    expect(reportSchema.safeParse({ ...valid, severity: "high" }).success).toBe(
      false,
    );
  });

  it("refuses target types this app cannot render", () => {
    // artifact/profile are the marketplace's, and arrive at its own endpoint.
    for (const targetType of ["artifact", "profile", "comment", "order"]) {
      expect(reportSchema.safeParse({ ...valid, targetType }).success).toBe(false);
    }
  });

  it("refuses a reason outside the shared vocabulary", () => {
    expect(reportSchema.safeParse({ ...valid, reason: "nudity" }).success).toBe(
      false,
    );
  });

  it("refuses a target id that is not a uuid", () => {
    expect(reportSchema.safeParse({ ...valid, targetId: "1" }).success).toBe(false);
  });

  it("bounds the free text and keeps control characters out of it", () => {
    expect(
      reportSchema.safeParse({ ...valid, details: "x".repeat(REPORT_DETAILS_MAX + 1) })
        .success,
    ).toBe(false);
    expect(
      reportSchema.safeParse({ ...valid, details: `bell${String.fromCharCode(7)}` })
        .success,
    ).toBe(false);
    // Newline is the one control character a person actually types.
    expect(
      reportSchema.safeParse({ ...valid, details: "one\ntwo" }).success,
    ).toBe(true);
  });

  it("treats an empty email as not given, but rejects a malformed one", () => {
    expect(reportSchema.safeParse({ ...valid, reporterEmail: "" }).success).toBe(
      true,
    );
    expect(
      reportSchema.safeParse({ ...valid, reporterEmail: "not-an-address" }).success,
    ).toBe(false);
  });

  it("gives every reason a label and a hint for the dialog", () => {
    for (const reason of REPORT_REASONS) {
      expect(english(REPORT_REASON_COPY[reason].label).length).toBeGreaterThan(0);
      expect(english(REPORT_REASON_COPY[reason].hint).length).toBeGreaterThan(0);
    }
  });

  it("asks in the words it always used, which the marketplace mirrors", () => {
    const copy = Object.fromEntries(
      REPORT_REASONS.map((reason) => [
        reason,
        [english(REPORT_REASON_COPY[reason].label), english(REPORT_REASON_COPY[reason].hint)],
      ]),
    );
    expect(copy).toEqual({
      illegal: [
        "Illegal goods or activity",
        "Selling something that is against the law, or using the listing to arrange it.",
      ],
      sexual: ["Sexual content", "Explicit imagery, or anything sexualising a minor."],
      violence: ["Violence or gore", "Graphic injury, threats, or content glorifying violence."],
      hate: ["Hate or harassment", "Attacks on a person or group, or hate symbolism."],
      counterfeit: [
        "Counterfeit or stolen",
        "Fake branded goods, or someone else's work sold as their own.",
      ],
      scam: ["Scam or fraud", "The listing looks designed to take money without delivering."],
      spam: ["Spam", "Repetitive, misleading, or not a real product at all."],
      other: ["Something else", "Tell us below and a person will read it."],
    });
  });
});
