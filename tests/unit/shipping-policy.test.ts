import { describe, expect, it } from "vitest";
import { buildShippingProse, hasShippingPolicy } from "@/lib/shipping/policy-prose";
import {
  compactShippingPolicy,
  shippingPolicySchema,
} from "@/lib/validation/shipping-policy";
import { buildShippingPolicy } from "@/lib/settings/shipping-policy";

/**
 * THE ACCOUNT-LEVEL SHIPPING POLICY: the generator, the write boundary and the
 * read boundary. All three are pure, so all three are tested here rather than
 * behind a rendered page.
 */

describe("buildShippingProse", () => {
  it("says nothing for a seller who has answered nothing", () => {
    expect(buildShippingProse({})).toEqual({ shipping: "", returns: "" });
    expect(buildShippingProse(null)).toEqual({ shipping: "", returns: "" });
  });

  it("opens with where the goods ship from, by name and not by code", () => {
    // A buyer comparing sellers often needs no more than this line, and "IE"
    // is not an answer to "where does this come from".
    expect(buildShippingProse({ shipsFrom: "IE" }).shipping).toBe("Ships from Ireland.");
  });

  it("keeps an unknown country code rather than dropping where it ships from", () => {
    // A stored value from before a list changed. Printing the code lets a
    // reader look it up; silently dropping it loses a fact the seller gave.
    expect(buildShippingProse({ shipsFrom: "ZZ" }).shipping).toBe("Ships from ZZ.");
  });

  it("prints destinations as one block of lines, not one paragraph each", () => {
    // They are a list and read as one. A blank line between "Ireland" and
    // "Rest of EU" makes two unrelated statements out of a single table.
    expect(
      buildShippingProse({
        destinations: [
          { area: "Ireland", time: "2-3 business days", cost: "€4.50" },
          { area: "Rest of EU", time: "5-7 business days" },
        ],
      }).shipping,
    ).toBe("Ireland: 2-3 business days (€4.50)\nRest of EU: 5-7 business days");
  });

  it("appends the seller's extra notes as their own paragraph", () => {
    expect(
      buildShippingProse({
        shipsFrom: "IE",
        shippingNotes: "We do not ship to PO boxes.",
      }).shipping,
    ).toBe("Ships from Ireland.\n\nWe do not ship to PO boxes.");
  });

  it("treats a zero or absent returns window as nothing to say", () => {
    // Both mean "nothing beyond the statutory right", which the page states on
    // its own. Generating a sentence here would either repeat it or contradict
    // it.
    expect(buildShippingProse({ returnsWindowDays: 0 }).returns).toBe("");
    expect(buildShippingProse({ returnsPaidBy: "buyer" }).returns).toBe("");
  });

  it("puts the window and who pays in ONE sentence", () => {
    // Who pays is the second thing every buyer asks and the one sellers most
    // often leave out, so it does not wait for a paragraph nobody writes.
    expect(
      buildShippingProse({ returnsWindowDays: 1, returnsPaidBy: "seller" }).returns,
    ).toBe("Returns accepted within 1 day of delivery. Return postage is on us.");
  });

  it("lets the seller's own words replace the generated text outright", () => {
    // Never appended: a block whose job is legal accuracy must not mix
    // sentences the seller wrote with sentences they did not.
    const prose = buildShippingProse({
      shipsFrom: "IE",
      destinations: [{ area: "Ireland", time: "2 days" }],
      shippingText: "Ask us.",
      returnsWindowDays: 30,
      returnsText: "Talk to us.",
    });
    expect(prose.shipping).toBe("Ask us.");
    expect(prose.returns).toBe("Talk to us.");
  });
});

describe("hasShippingPolicy", () => {
  it("asks the OUTPUT, not the number of keys that happen to be set", () => {
    // A policy holding only "who pays" for a window that does not exist
    // produces no prose. Calling that "set" would tell a seller they were done
    // while their page still said nothing.
    expect(hasShippingPolicy({ returnsPaidBy: "buyer" })).toBe(false);
    expect(hasShippingPolicy({})).toBe(false);
    expect(hasShippingPolicy(null)).toBe(false);
  });

  it("counts a dispatch line on its own, which prints beside the buy button", () => {
    expect(hasShippingPolicy({ dispatch: "Ships Fridays" })).toBe(true);
  });
});

describe("compactShippingPolicy", () => {
  it("drops emptied fields rather than storing empty strings", () => {
    // The form posts every field it has; the schema's text fields are min-1.
    // Without this, an untouched field would be a validation ERROR where the
    // seller meant "blank".
    expect(compactShippingPolicy({ dispatch: "  ", shippingNotes: "", shipsFrom: "IE" })).toEqual({
      shipsFrom: "IE",
    });
  });

  it("keeps a zero returns window, the one falsy value that means something", () => {
    expect(compactShippingPolicy({ returnsWindowDays: 0 })).toEqual({ returnsWindowDays: 0 });
  });

  it("drops who-pays when there is no window for them to pay for", () => {
    expect(compactShippingPolicy({ returnsWindowDays: 0, returnsPaidBy: "buyer" })).toEqual({
      returnsWindowDays: 0,
    });
  });

  it("keeps a destination only once it says both where AND how long", () => {
    // Either alone is half a sentence on the page.
    expect(
      compactShippingPolicy({
        destinations: [
          { area: "Ireland", time: "2 days", cost: "" },
          { area: "Nowhere", time: "" },
          { area: "", time: "3 days" },
        ],
      }),
    ).toEqual({ destinations: [{ area: "Ireland", time: "2 days" }] });
  });

  it("normalises CRLF, which a real textarea posts and multiLineText refuses", () => {
    expect(compactShippingPolicy({ shippingNotes: "one\r\ntwo" })).toEqual({
      shippingNotes: "one\ntwo",
    });
  });

  it("drops a shipping profile with no terms, the rule profiles have always had", () => {
    // A profile whose body is blank says LESS than the default it replaced.
    const kept = { id: "a", name: "Bulky", body: "By pallet." };
    expect(
      compactShippingPolicy({ profiles: [kept, { id: "b", name: "Empty", body: "  " }] }),
    ).toEqual({ profiles: [kept] });
  });

  it("survives junk without throwing, since it runs BEFORE the schema", () => {
    expect(compactShippingPolicy(null)).toEqual({});
    expect(compactShippingPolicy("nope")).toEqual({});
    expect(compactShippingPolicy({ destinations: "nope", profiles: 7 })).toEqual({});
  });
});

describe("shippingPolicySchema", () => {
  it("refuses an unknown key anywhere in the tree", () => {
    // The column is jsonb, so this schema is the only thing standing between a
    // write and "a place to put anything".
    expect(shippingPolicySchema.safeParse({ nope: 1 }).success).toBe(false);
    expect(
      shippingPolicySchema.safeParse({ destinations: [{ area: "a", time: "b", nope: 1 }] }).success,
    ).toBe(false);
  });

  it("bounds the returns window at both ends", () => {
    expect(shippingPolicySchema.safeParse({ returnsWindowDays: -1 }).success).toBe(false);
    expect(shippingPolicySchema.safeParse({ returnsWindowDays: 366 }).success).toBe(false);
    expect(shippingPolicySchema.safeParse({ returnsWindowDays: 0 }).success).toBe(true);
  });

  it("only accepts a country it can actually name", () => {
    expect(shippingPolicySchema.safeParse({ shipsFrom: "IE" }).success).toBe(true);
    expect(shippingPolicySchema.safeParse({ shipsFrom: "XX" }).success).toBe(false);
  });

  it("caps the destination list", () => {
    const row = { area: "a", time: "b" };
    expect(shippingPolicySchema.safeParse({ destinations: Array(6).fill(row) }).success).toBe(true);
    expect(shippingPolicySchema.safeParse({ destinations: Array(7).fill(row) }).success).toBe(false);
  });
});

describe("buildShippingPolicy", () => {
  it("reads an unset column as an empty policy, not an error", () => {
    expect(buildShippingPolicy(null)).toEqual({});
    expect(buildShippingPolicy({ shipping_policy: null })).toEqual({});
  });

  it("PARSES the stored value rather than casting it", () => {
    // jsonb holds whatever was last written, including by something that never
    // went through the action. A reader must never be handed a shape it does
    // not expect — and a value that will not parse degrades to "nothing set"
    // so the page loses its shipping section instead of 500ing.
    expect(buildShippingPolicy({ shipping_policy: { returnsWindowDays: 30 } })).toEqual({
      returnsWindowDays: 30,
    });
    expect(buildShippingPolicy({ shipping_policy: { returnsWindowDays: -5 } })).toEqual({});
    expect(buildShippingPolicy({ shipping_policy: "not an object" })).toEqual({});
  });
});
