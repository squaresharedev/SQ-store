// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  MODERATION_GATE_SELECT,
  REMOVAL_GROUNDS,
  REMOVAL_NOTE_MAX,
  isContentVisible,
  isRemovalGround,
  isRowVisible,
  decisionReference,
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
import {
  PRODUCT_FIX_FIELDS,
  PRODUCT_FIX_FIELD_SECTION,
  STOREFRONT_FIX_FIELDS,
  fixFieldLabel,
  fixFieldsFor,
  flaggedFieldsIn,
  flaggedProductSections,
} from "@/lib/moderation/fix-fields";
import { PRODUCT_FORM_SECTIONS } from "@/lib/products/form-datapoints";
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
      fields: [],
      decisionId: null,
    });
  });

  it("carries what to change, in form order, and the decision behind it", () => {
    const takedown = takedownFromRow({
      ...base,
      moderation_status: "paused",
      // Out of order, with a duplicate and a value this build does not know.
      moderation_fields: ["photos", "title", "photos", "hologram"],
      moderation_decision_id: TARGET,
    });
    expect(takedown?.fields).toEqual(["title", "photos"]);
    expect(takedown?.decisionId).toBe(TARGET);
  });

  it("reads a storefront's fields from the storefront's own list", () => {
    const row = { ...base, moderation_status: "paused", moderation_fields: ["images", "title"] };
    expect(takedownFromRow(row, "storefront")?.fields).toEqual(["images"]);
    expect(takedownFromRow(row, "product")?.fields).toEqual(["title"]);
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

describe("decisionReference", () => {
  it("is MD- and the first ten hex digits, upper-cased", () => {
    expect(decisionReference("0b1f7b1e-6d3a-4f4e-9f6c-1a2b3c4d5e6f")).toBe("MD-0B1F7B1E6D");
  });
});

describe("fix fields", () => {
  it("places every product field in a real section of the form, or nowhere for other", () => {
    const sections = new Set<string>(PRODUCT_FORM_SECTIONS.map((section) => section.id));
    for (const field of PRODUCT_FIX_FIELDS) {
      const section = PRODUCT_FIX_FIELD_SECTION[field];
      if (field === "other") expect(section).toBeNull();
      else expect(sections.has(section!)).toBe(true);
    }
  });

  it("mirrors the database CHECK lists exactly", () => {
    // 20260926_moderation_decisions_and_appeals.sql; the admin panel writes
    // these, so a value one list has and another lacks fails a takedown.
    expect([...PRODUCT_FIX_FIELDS].sort()).toEqual(
      [
        "title", "description", "price", "image", "photos", "file", "purchaseLink",
        "options", "specs", "documents", "safety", "shipping", "other",
      ].sort(),
    );
    expect([...STOREFRONT_FIX_FIELDS].sort()).toEqual(
      ["name", "header", "text", "images", "products", "background", "productPage", "other"].sort(),
    );
  });

  it("names every field for the seller", () => {
    for (const field of PRODUCT_FIX_FIELDS) {
      expect(english(fixFieldLabel("product", field)).length).toBeGreaterThan(2);
    }
    for (const field of STOREFRONT_FIX_FIELDS) {
      expect(english(fixFieldLabel("storefront", field)).length).toBeGreaterThan(2);
    }
    expect(english(fixFieldLabel("product", "purchaseLink"))).toBe("Purchase link");
  });

  it("keeps only known fields, deduplicated, in display order", () => {
    expect(fixFieldsFor("product", ["documents", "title", "nope", "title"])).toEqual([
      "title",
      "documents",
    ]);
    expect(fixFieldsFor("product", null)).toEqual([]);
  });

  it("groups flagged fields by the section they live in", () => {
    const fields = ["title", "price", "photos", "purchaseLink", "other"];
    expect(flaggedProductSections(fields)).toEqual(["basics", "media", "photos"]);
    expect(flaggedFieldsIn("basics", fields)).toEqual(["title", "price"]);
    expect(flaggedFieldsIn("media", fields)).toEqual(["purchaseLink"]);
    expect(flaggedFieldsIn("specs", fields)).toEqual([]);
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
    // artifact is the marketplace's, and arrives at its own endpoint. A
    // profile is never named directly: a seller is reported as "seller",
    // through the storefront, and resolved on the server.
    for (const targetType of ["artifact", "profile", "comment", "order"]) {
      expect(reportSchema.safeParse({ ...valid, targetType }).success).toBe(false);
    }
  });

  it("accepts a storefront or a seller, both named by a storefront id", () => {
    expect(reportSchema.safeParse({ ...valid, targetType: "storefront" }).success).toBe(true);
    expect(reportSchema.safeParse({ ...valid, targetType: "seller" }).success).toBe(true);
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
