import { describe, expect, it } from "vitest";
import {
  buildSellerIdentity,
  buildTraderIdentityInput,
  type SellerIdentityRow,
} from "@/lib/settings/seller-identity";

function row(overrides: Partial<SellerIdentityRow> = {}): SellerIdentityRow {
  return {
    tax_business_name: null,
    tax_vat_id: null,
    tax_country: null,
    seller_address: null,
    seller_email: null,
    seller_phone: null,
    seller_phone_verified_at: null,
    seller_bio: null,
    ...overrides,
  };
}

const PROVEN_AT = "2026-09-26T10:00:00Z";

describe("buildSellerIdentity", () => {
  it("answers an empty object for a missing row", () => {
    // The public product page and the storefront designer both treat this
    // as "nothing set yet", never as an error — see the callers in
    // lib/products/public.ts and app/storefront/[id]/page.tsx.
    expect(buildSellerIdentity(null)).toEqual({});
  });

  it("answers an empty object when every column is null", () => {
    expect(buildSellerIdentity(row())).toEqual({});
  });

  it("maps every column to its StorefrontSeller field", () => {
    expect(
      buildSellerIdentity(
        row({
          tax_business_name: "Studio Ltd",
          seller_address: "12 Market Street\nDublin",
          seller_email: "hi@studio.example",
          tax_vat_id: "IE1234567T",
          tax_country: "IE",
          seller_phone: "+353871234567",
          seller_phone_verified_at: PROVEN_AT,
          seller_bio: "Hand-thrown stoneware from Dublin",
        }),
      ),
    ).toEqual({
      businessName: "Studio Ltd",
      address: "12 Market Street\nDublin",
      email: "hi@studio.example",
      vatId: "IE1234567T",
      country: "IE",
      // Stored as E.164, shown the way people read it.
      phone: "+353 87 123 4567",
      bio: "Hand-thrown stoneware from Dublin",
    });
  });

  it("never shows a phone nobody has proven they answer", () => {
    const unproven = buildSellerIdentity(row({ seller_phone: "+353871234567" }));
    expect(unproven).not.toHaveProperty("phone");
    // And the proof's timestamp itself never rides along to a buyer.
    const proven = buildSellerIdentity(
      row({ seller_phone: "+353871234567", seller_phone_verified_at: PROVEN_AT }),
    );
    expect(JSON.stringify(proven)).not.toContain(PROVEN_AT);
  });

  it("omits a field entirely rather than carrying it as null or empty", () => {
    // hasSellerDetails / isEuSeller (SellerBlock.tsx, product-page.ts) test
    // for the KEY's presence — a `businessName: null` would read as "set".
    const built = buildSellerIdentity(row({ tax_business_name: "Studio Ltd" }));
    expect(built).toHaveProperty("businessName");
    expect(built).not.toHaveProperty("address");
    expect(built).not.toHaveProperty("email");
    expect(built).not.toHaveProperty("vatId");
    expect(built).not.toHaveProperty("country");
    expect(built).not.toHaveProperty("phone");
    expect(built).not.toHaveProperty("bio");
  });

  it("handles a partial identity (some fields set, some not)", () => {
    expect(
      buildSellerIdentity(row({ tax_business_name: "Studio Ltd", tax_country: "IE" })),
    ).toEqual({ businessName: "Studio Ltd", country: "IE" });
  });
});

describe("buildTraderIdentityInput", () => {
  const gateRow = (overrides: Partial<SellerIdentityRow> & { seller_email_verified_at?: string | null }) => ({
    ...row({
      tax_business_name: "Studio Ltd",
      seller_address: "12 Market Street\nDublin",
      seller_email: "hello@studio-builderboy.at",
    }),
    seller_email_verified_at: null,
    ...overrides,
  });

  it("passes a plausible identity through, with whether the email is proven", () => {
    expect(buildTraderIdentityInput(gateRow({ seller_email_verified_at: PROVEN_AT }))).toMatchObject({
      businessName: "Studio Ltd",
      address: "12 Market Street\nDublin",
      email: "hello@studio-builderboy.at",
      emailVerified: true,
    });
  });

  it("counts a value the settings form would refuse as ABSENT, however it was written", () => {
    // profiles is writable by its owner over the REST API as well, so the
    // gate cannot assume every stored value came through the form.
    for (const seller_email of ["hi@studio.example", "x@mailinator.com", "not-an-address"]) {
      expect(buildTraderIdentityInput(gateRow({ seller_email })), seller_email).not.toHaveProperty("email");
    }
    for (const seller_address of ["123 Fake Street, Springfield", "Dublin"]) {
      expect(buildTraderIdentityInput(gateRow({ seller_address })), seller_address).not.toHaveProperty(
        "address",
      );
    }
  });
});
