import { describe, expect, it } from "vitest";
import {
  TRADER_IDENTITY_FIELDS,
  isTraderIdentityComplete,
  listMissingTraderFields,
  missingTraderIdentity,
  traderIdentityFix,
  traderIdentityHref,
} from "@/lib/settings/trader-identity";
import { buildSellerIdentity } from "@/lib/settings/seller-identity";
import type { StorefrontSeller } from "@/types/storefront";

// The publish gate's rule, pinned. Every enforcement point in the app — the
// product write, the CSV import, the embed toggle, the public product page,
// the embed endpoint — asks this module the same question, so what it answers
// is what "can this seller sell" means everywhere.

const COMPLETE: StorefrontSeller = {
  businessName: "Studio Builderboy e.U.",
  address: "12 Market Street\nVienna\nAustria",
  email: "hello@studio-builderboy.at",
};

describe("missingTraderIdentity", () => {
  it("passes a seller with a name, an address and a contact email", () => {
    expect(missingTraderIdentity(COMPLETE)).toEqual([]);
    expect(isTraderIdentityComplete(COMPLETE)).toBe(true);
  });

  it("never asks for a bio", () => {
    expect(COMPLETE).not.toHaveProperty("bio");
    expect(isTraderIdentityComplete({ ...COMPLETE, bio: "" })).toBe(true);
  });

  it("names each required field that is absent", () => {
    expect(missingTraderIdentity({})).toEqual(["businessName", "address", "email"]);
    expect(missingTraderIdentity({ ...COMPLETE, email: undefined })).toEqual(["email"]);
    expect(missingTraderIdentity({ ...COMPLETE, address: undefined })).toEqual(["address"]);
  });

  it("treats whitespace as absent — a space is not an address", () => {
    expect(missingTraderIdentity({ ...COMPLETE, address: "   \n  " })).toEqual(["address"]);
  });

  it("returns fields in form order, whichever ones are missing", () => {
    expect(missingTraderIdentity({ email: "hi@studio-builderboy.at" })).toEqual([
      "businessName",
      "address",
    ]);
  });

  // These three are deliberately NOT required: see the module header.
  it("does not require a phone, a VAT ID or a country", () => {
    expect(isTraderIdentityComplete(COMPLETE)).toBe(true);
    expect(
      isTraderIdentityComplete({ ...COMPLETE, phone: "", vatId: "", country: "" }),
    ).toBe(true);
  });

  // The contact address must be PROVEN, not merely typed — but only where the
  // platform can actually send the link. A deployment with no mail must not
  // demand a click nobody can deliver.
  it("ignores verification unless the caller asks for it", () => {
    expect(missingTraderIdentity({ ...COMPLETE, emailVerified: false })).toEqual([]);
    expect(
      missingTraderIdentity(
        { ...COMPLETE, emailVerified: false },
        { requireVerifiedEmail: true },
      ),
    ).toEqual(["emailVerified"]);
    expect(
      missingTraderIdentity(
        { ...COMPLETE, emailVerified: true },
        { requireVerifiedEmail: true },
      ),
    ).toEqual([]);
  });

  it("does not complain that a missing email is also unconfirmed", () => {
    // Two complaints about one blank field is worse advice than one.
    expect(
      missingTraderIdentity(
        { ...COMPLETE, email: undefined },
        { requireVerifiedEmail: true },
      ),
    ).toEqual(["email"]);
  });

  it("agrees with what buildSellerIdentity makes of a raw profile row", () => {
    // The read side applies this predicate to a built identity, so a column
    // that is null must arrive as a missing field rather than as an empty one.
    const seller = buildSellerIdentity({
      tax_business_name: "Studio Builderboy e.U.",
      tax_vat_id: null,
      tax_country: null,
      seller_address: null,
      seller_email: "hello@studio-builderboy.at",
      seller_phone: null,
      seller_bio: null,
    });
    expect(missingTraderIdentity(seller)).toEqual(["address"]);
    expect(missingTraderIdentity(buildSellerIdentity(null))).toEqual([
      "businessName",
      "address",
      "email",
    ]);
  });
});

describe("the copy the gate hands every surface", () => {
  it("deep-links to the first field still to fill in", () => {
    expect(traderIdentityHref(["address", "email"])).toBe("/settings/tax#address");
    expect(traderIdentityHref(["email"])).toBe("/settings/tax#contact-email");
    // Nothing missing: the page itself, not a dangling anchor.
    expect(traderIdentityHref([])).toBe("/settings/tax");
  });

  it("every field's anchor exists on the settings page", () => {
    // The hrefs are only worth anything if they land on the field. These ids
    // are on TaxSection's field wrappers; confirmation shares the contact
    // email's, because that is where its status line and resend button live.
    expect(TRADER_IDENTITY_FIELDS.map((field) => field.anchor)).toEqual([
      "business-name",
      "address",
      "contact-email",
      "contact-email",
    ]);
  });

  it("tells an unconfirmed seller to click a link, not to type something", () => {
    // "Add your confirmed contact email" would be advice to fill in a field
    // that is already filled in.
    const fix = traderIdentityFix(["emailVerified"]);
    expect(fix).toMatch(/confirmation link/i);
    expect(fix).not.toMatch(/^Add your/);
    // With typed fields missing too, both asks are made, once each.
    const both = traderIdentityFix(["address", "emailVerified"]);
    expect(both).toContain("business address");
    expect(both).toMatch(/confirm your contact email/i);
  });

  it("lists missing fields as a readable phrase", () => {
    expect(listMissingTraderFields(["email"])).toBe("contact email");
    expect(listMissingTraderFields(["address", "email"])).toBe(
      "business address and contact email",
    );
    expect(listMissingTraderFields(["businessName", "address", "email"])).toBe(
      "trader name, business address and contact email",
    );
    expect(listMissingTraderFields([])).toBe("");
  });

  it("always gives a next step, even when handed nothing", () => {
    expect(traderIdentityFix(["email"])).toContain("contact email");
    expect(traderIdentityFix([])).toContain("Settings");
  });
});
