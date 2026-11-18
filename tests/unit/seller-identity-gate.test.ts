// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildSellerIdentity,
  buildTraderIdentityInput,
  type SellerIdentityRow,
  type TraderGateRow,
} from "@/lib/settings/seller-identity";
import { addressQualityProblem } from "@/lib/validation/address-quality";
import { emailQualityProblem } from "@/lib/validation/email-quality";
import { emailAddress } from "@/lib/validation/inputs";
import { missingTraderIdentity } from "@/lib/settings/trader-identity";

/**
 * buildTraderIdentityInput optimization parity.
 *
 * The optimized implementation builds only the four publish-gate fields
 * (businessName, address, email, emailVerified) directly from the row, avoiding
 * the libphonenumber call in buildSellerIdentity. The publish-gate result must
 * be byte-identical to what the old implementation produced.
 *
 * Reference implementation (the pre-optimization logic):
 *   const { address, email, ...rest } = buildSellerIdentity(row);
 *   return { ...rest,
 *     ...(address && !addressQualityProblem(address) ? { address } : {}),
 *     ...(email && plausibleEmail(email) ? { email } : {}),
 *     emailVerified: Boolean(row?.seller_email_verified_at) };
 *
 * missingTraderIdentity reads ONLY businessName, address, email, emailVerified,
 * so the gate result is what matters. The other fields (vatId, country, phone,
 * bio) are stripped from the return value; none of the gate callers read them.
 */

const PROVEN_AT = "2026-09-26T10:00:00Z";

function base(): TraderGateRow {
  return {
    tax_business_name: "Studio Builderboy e.U.",
    tax_vat_id: null,
    tax_country: null,
    seller_address: "12 Market Street\nVienna\nAustria",
    seller_email: "hello@studio-builderboy.at",
    seller_phone: null,
    seller_phone_verified_at: null,
    seller_bio: null,
    seller_email_verified_at: null,
  };
}

/** Gate result (missing fields) for a row using the new implementation. */
function gate(
  row: TraderGateRow | null,
  opts: { requireVerifiedEmail?: boolean } = {},
): string[] {
  return missingTraderIdentity(buildTraderIdentityInput(row), opts);
}

describe("buildTraderIdentityInput parity with pre-optimization logic", () => {
  it("null row: all required fields are missing", () => {
    expect(gate(null)).toEqual(["businessName", "address", "email"]);
  });

  it("fully complete identity: nothing missing", () => {
    expect(gate(base())).toEqual([]);
  });

  it("phone set and verified does not affect the gate", () => {
    // Phone is optional and irrelevant to the publish gate. The old code included
    // it in ...rest but missingTraderIdentity ignored it; new code omits it.
    const withPhone = { ...base(), seller_phone: "+353871234567", seller_phone_verified_at: PROVEN_AT };
    expect(gate(withPhone)).toEqual([]);
  });

  it("phone set but unverified does not affect the gate", () => {
    const withUnprovenPhone = { ...base(), seller_phone: "+353871234567" };
    expect(gate(withUnprovenPhone)).toEqual([]);
  });

  it("address that fails quality check counts as absent", () => {
    // These are examples addressQualityProblem rejects: too short, no structure.
    for (const seller_address of ["123 Fake Street, Springfield", "Dublin"]) {
      expect(gate({ ...base(), seller_address }), seller_address).toContain("address");
    }
  });

  it("valid address without a quality problem is accepted", () => {
    expect(gate(base())).not.toContain("address");
    expect(addressQualityProblem("12 Market Street\nVienna\nAustria")).toBeNull();
  });

  it("email that fails plausibleEmail counts as absent", () => {
    // These are invalid or disposable: the form would refuse them too.
    for (const seller_email of ["hi@studio.example", "x@mailinator.com", "not-an-address"]) {
      expect(gate({ ...base(), seller_email }), seller_email).toContain("email");
    }
  });

  it("empty businessName: businessName missing, rest present", () => {
    expect(gate({ ...base(), tax_business_name: null })).toEqual(["businessName"]);
    expect(gate({ ...base(), tax_business_name: "" })).toEqual(["businessName"]);
  });

  it("emailVerified missing when unverified and verification is required", () => {
    const unverified = { ...base(), seller_email_verified_at: null };
    expect(gate(unverified, { requireVerifiedEmail: true })).toEqual(["emailVerified"]);
    expect(gate(unverified)).toEqual([]); // Not required when flag is off.
  });

  it("emailVerified present when proven and verification is required", () => {
    const verified = { ...base(), seller_email_verified_at: PROVEN_AT };
    expect(gate(verified, { requireVerifiedEmail: true })).toEqual([]);
  });

  it("all required typed fields missing together with unverified email", () => {
    const empty: TraderGateRow = {
      ...base(),
      tax_business_name: null,
      seller_address: null,
      seller_email: null,
      seller_email_verified_at: null,
    };
    expect(gate(empty, { requireVerifiedEmail: true })).toEqual([
      "businessName",
      "address",
      "email",
      // Not "emailVerified": no email to confirm.
    ]);
  });

  it("matches the pre-optimization logic on a spread of rows", () => {
    // The old buildTraderIdentityInput body, inlined here as the reference:
    //   const { address, email, ...rest } = buildSellerIdentity(row);
    //   return { ...rest,
    //     ...(address && !addressQualityProblem(address) ? { address } : {}),
    //     ...(email && plausibleEmail(email) ? { email } : {}),
    //     emailVerified: Boolean(row?.seller_email_verified_at) };
    // where: plausibleEmail(e) = emailAddress("contactEmail").safeParse(e).success
    //                            && !emailQualityProblem(e)
    function refPlausibleEmail(e: string): boolean {
      return emailAddress("contactEmail").safeParse(e).success && !emailQualityProblem(e);
    }
    function oldGate(row: TraderGateRow | null, opts: { requireVerifiedEmail?: boolean } = {}): string[] {
      const { address, email, ...rest } = buildSellerIdentity(row as SellerIdentityRow | null);
      return missingTraderIdentity({
        ...rest,
        ...(address && !addressQualityProblem(address) ? { address } : {}),
        ...(email && refPlausibleEmail(email) ? { email } : {}),
        emailVerified: Boolean(row?.seller_email_verified_at),
      }, opts);
    }

    const rows: Array<TraderGateRow | null> = [
      null,
      base(),
      { ...base(), tax_business_name: null },
      { ...base(), seller_address: "Dublin" }, // Quality failure
      { ...base(), seller_email: "hi@studio.example" }, // Plausible check failure
      { ...base(), seller_email: "x@mailinator.com" }, // Disposable
      { ...base(), seller_email_verified_at: PROVEN_AT },
      { ...base(), seller_phone: "+353871234567", seller_phone_verified_at: PROVEN_AT },
      { ...base(), seller_phone: "+353871234567" }, // Unproven phone
      { ...base(), tax_vat_id: "IE1234567T", tax_country: "IE" }, // Extra fields
    ];
    const optSets: Array<{ requireVerifiedEmail?: boolean }> = [{}, { requireVerifiedEmail: true }];

    for (const row of rows) {
      for (const opts of optSets) {
        expect(gate(row, opts), JSON.stringify(row)).toEqual(oldGate(row, opts));
      }
    }
  });
});
