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
    // are on TaxSection's field wrappers.
    expect(TRADER_IDENTITY_FIELDS.map((field) => field.anchor)).toEqual([
      "business-name",
      "address",
      "contact-email",
    ]);
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
