import { describe, expect, it } from "vitest";
import {
  canAddShippingProfile,
  compactShippingProfiles,
  findShippingProfile,
  newShippingProfileId,
  resolveProductShipping,
  resolveReturns,
} from "@/lib/storefront/shipping";
import { shippingProfilesSchema } from "@/lib/validation/storefront";
import { SHIPPING_PROFILES_MAX, type ShippingProfile } from "@/types/storefront";

const BULKY = "11111111-1111-4111-8111-111111111111";
const SLOW = "22222222-2222-4222-8222-222222222222";

function profile(overrides: Partial<ShippingProfile> = {}): ShippingProfile {
  return {
    id: BULKY,
    name: "Bulky items",
    dispatch: "Allow 3 weeks",
    body: "Pallet courier, ground floor only.",
    ...overrides,
  };
}

describe("resolveProductShipping", () => {
  // The ACCOUNT's terms, not a storefront's. `shippingText` is the seller's own
  // words, which the prose generator prefers over anything it would build.
  const policy = {
    shippingText: "Ships in 3 days.",
    dispatch: "Ships within 24 hours",
    profiles: [profile()],
  };

  it("gives the account's default terms to a product that names no profile", () => {
    expect(resolveProductShipping(null, policy)).toEqual({
      name: null,
      body: "Ships in 3 days.",
      dispatch: "Ships within 24 hours",
    });
  });

  it("gives a named profile INSTEAD of the default, never layered over it", () => {
    // The whole point of choosing a profile is that it supersedes the account's
    // terms. Inheriting the default's dispatch would leave "ships within 24
    // hours" printed on a made-to-order product.
    expect(resolveProductShipping(BULKY, policy)).toEqual({
      name: "Bulky items",
      body: "Pallet courier, ground floor only.",
      dispatch: "Allow 3 weeks",
    });
  });

  it("says nothing about dispatch for a profile that set none", () => {
    const bare = { ...policy, profiles: [profile({ dispatch: undefined })] };
    expect(resolveProductShipping(BULKY, bare)?.dispatch).toBe("");
  });

  it("falls back to the default for an id the account does not have", () => {
    // One honest way to get here now: the seller deleted the profile. (Before
    // terms moved to the account there was a second — a product placed on a
    // storefront that never had the profile — which the move removed.)
    expect(resolveProductShipping(SLOW, policy)?.name).toBeNull();
    expect(resolveProductShipping(SLOW, { shippingText: "Ships in 3 days." })?.body).toBe(
      "Ships in 3 days.",
    );
  });

  it("is null when the seller has written nothing at all", () => {
    // Not an empty section: a page with nothing to say about shipping says
    // nothing rather than printing an empty heading.
    expect(resolveProductShipping(null, {})).toBeNull();
    expect(resolveProductShipping(BULKY, {})).toBeNull();
    expect(resolveProductShipping(null, null)).toBeNull();
  });

  it("counts a dispatch line on its own as something to say", () => {
    expect(resolveProductShipping(null, { dispatch: "Ships Fridays" })).toEqual({
      name: null,
      body: "",
      dispatch: "Ships Fridays",
    });
  });

  it("builds the default body from the STRUCTURED answers when there is no override", () => {
    // The step-3 payoff: a seller who never wrote a paragraph still gets one,
    // and it is the same paragraph the product page prints.
    const structured = {
      shipsFrom: "IE",
      destinations: [
        { area: "Ireland", time: "2-3 business days", cost: "€4.50" },
        { area: "Rest of EU", time: "5-7 business days" },
      ],
    };
    expect(resolveProductShipping(null, structured)?.body).toBe(
      "Ships from Ireland.\n\nIreland: 2-3 business days (€4.50)\nRest of EU: 5-7 business days",
    );
  });
});

describe("resolveReturns", () => {
  it("says nothing when no window is offered", () => {
    // 0 and absent are the same answer: the seller offers nothing BEYOND the
    // statutory right, which the page states on its own.
    expect(resolveReturns({})).toBe("");
    expect(resolveReturns({ returnsWindowDays: 0 })).toBe("");
    expect(resolveReturns(null)).toBe("");
  });

  it("states the window and who pays in one sentence", () => {
    expect(resolveReturns({ returnsWindowDays: 30, returnsPaidBy: "buyer" })).toBe(
      "Returns accepted within 30 days of delivery. Return postage is paid by the buyer.",
    );
    expect(resolveReturns({ returnsWindowDays: 14, returnsPaidBy: "seller" })).toBe(
      "Returns accepted within 14 days of delivery. Return postage is on us.",
    );
  });

  it("keeps the exceptions as their own paragraph", () => {
    expect(
      resolveReturns({
        returnsWindowDays: 14,
        returnsPaidBy: "buyer",
        returnsNotes: "Made-to-order pieces cannot be returned.",
      }),
    ).toBe(
      "Returns accepted within 14 days of delivery. Return postage is paid by the buyer." +
        "\n\nMade-to-order pieces cannot be returned.",
    );
  });

  it("lets the seller's own words replace the generated paragraph outright", () => {
    // Never appended to: a block whose job is legal accuracy must not mix
    // sentences the seller wrote with sentences they did not.
    expect(
      resolveReturns({ returnsWindowDays: 30, returnsText: "Talk to us and we'll sort it." }),
    ).toBe("Talk to us and we'll sort it.");
  });
});

describe("findShippingProfile", () => {
  it("answers null for every way of not having one", () => {
    expect(findShippingProfile([profile()], null)).toBeNull();
    expect(findShippingProfile([profile()], undefined)).toBeNull();
    expect(findShippingProfile(undefined, BULKY)).toBeNull();
    expect(findShippingProfile([profile()], SLOW)).toBeNull();
  });
});

describe("compactShippingProfiles", () => {
  it("trims, drops a blank dispatch, and names an unnamed profile", () => {
    expect(
      compactShippingProfiles([
        { id: BULKY, name: "  Bulky items  ", dispatch: "   ", body: "  Pallet courier.  " },
        { id: SLOW, name: "", body: "Made to order." },
      ]),
    ).toEqual([
      { id: BULKY, name: "Bulky items", body: "Pallet courier." },
      { id: SLOW, name: "Shipping profile", body: "Made to order." },
    ]);
  });

  it("drops a profile with no terms rather than storing a name pointing at nothing", () => {
    // A profile with an empty body says LESS than the default it replaced, so
    // there is nothing to save. Products pointing at it fall back, which is
    // what every unresolvable id does.
    expect(compactShippingProfiles([profile({ body: "   " })])).toEqual([]);
  });

  it("produces something the schema accepts", () => {
    const clean = compactShippingProfiles([profile(), profile({ id: SLOW, name: "Slow" })]);
    expect(shippingProfilesSchema.safeParse(clean).success).toBe(true);
  });
});

describe("the profile list's bounds", () => {
  it("stops at the cap, which is also the schema's", () => {
    const full = Array.from({ length: SHIPPING_PROFILES_MAX }, (_, index) =>
      profile({ id: `${index}`.padStart(8, "0") + "-0000-4000-8000-000000000000" }),
    );
    expect(canAddShippingProfile(full)).toBe(false);
    expect(canAddShippingProfile(full.slice(1))).toBe(true);
    expect(canAddShippingProfile(undefined)).toBe(true);
    expect(shippingProfilesSchema.safeParse([...full, profile({ id: SLOW })]).success).toBe(false);
  });

  it("refuses two profiles sharing an id, because products point at ids", () => {
    expect(shippingProfilesSchema.safeParse([profile(), profile()]).success).toBe(false);
  });

  it("mints ids the products column's CHECK accepts", () => {
    // The DB CHECK is 1-64 chars of [A-Za-z0-9_-]; keeping the two rules
    // agreeing is the whole reason newShippingProfileId is a named function.
    expect(newShippingProfileId()).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });
});
