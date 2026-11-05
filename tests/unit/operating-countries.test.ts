import { describe, expect, it } from "vitest";
import {
  EU_COUNTRY_CODES,
  OPERATING_COUNTRY_CODES,
  SHIPPING_COUNTRY_CODES,
} from "@/lib/settings/constants";
import { shipToSchema } from "@/lib/validation/checkout";
import { taxSchema } from "@/lib/validation/settings";

// The Terms of Service promise the EU, the USA and Canada, and nowhere else yet.
// That promise is only true while these lists keep to it.

const VALID_SHIP_TO = { name: "Ada Lovelace", line1: "1 Analytical Way", city: "Dublin" };

describe("where Square Share operates", () => {
  it("is the 27 EU member states, the USA and Canada", () => {
    expect(EU_COUNTRY_CODES).toHaveLength(27);
    expect([...OPERATING_COUNTRY_CODES].sort()).toEqual([...EU_COUNTRY_CODES, "US", "CA"].sort());
  });

  it("is exactly where checkout delivers", () => {
    expect([...SHIPPING_COUNTRY_CODES].sort()).toEqual([...OPERATING_COUNTRY_CODES].sort());
  });

  it.each(["IE", "US", "CA"])("accepts a delivery to %s", (country) => {
    expect(shipToSchema.safeParse({ ...VALID_SHIP_TO, country }).success).toBe(true);
  });

  it.each(["GB", "CH", "NO", "AU", "NZ", "JP"])("refuses a delivery to %s", (country) => {
    expect(shipToSchema.safeParse({ ...VALID_SHIP_TO, country }).success).toBe(false);
  });

  it.each(["CZ", "US", "CA", ""])("lets a seller answer %j for their country", (tax_country) => {
    const parsed = taxSchema.shape.tax_country.safeParse(tax_country);
    expect(parsed.success).toBe(true);
  });

  it("does not let a seller name a country we do not operate in", () => {
    expect(taxSchema.shape.tax_country.safeParse("GB").success).toBe(false);
  });
});
