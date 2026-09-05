import { describe, expect, it } from "vitest";
import { buildSellerIdentity, type SellerIdentityRow } from "@/lib/settings/seller-identity";

function row(overrides: Partial<SellerIdentityRow> = {}): SellerIdentityRow {
  return {
    tax_business_name: null,
    tax_vat_id: null,
    tax_country: null,
    seller_address: null,
    seller_email: null,
    seller_phone: null,
    ...overrides,
  };
}

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
          seller_phone: "+353 1 234 5678",
        }),
      ),
    ).toEqual({
      businessName: "Studio Ltd",
      address: "12 Market Street\nDublin",
      email: "hi@studio.example",
      vatId: "IE1234567T",
      country: "IE",
      phone: "+353 1 234 5678",
    });
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
  });

  it("handles a partial identity (some fields set, some not)", () => {
    expect(
      buildSellerIdentity(row({ tax_business_name: "Studio Ltd", tax_country: "IE" })),
    ).toEqual({ businessName: "Studio Ltd", country: "IE" });
  });
});
