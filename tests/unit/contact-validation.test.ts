// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatPhoneInternational, normalizeSellerPhone } from "@/lib/validation/phone";
import { addressQualityProblem } from "@/lib/validation/address-quality";
import { english } from "../setup/translate";

// "Fake data" filters for the contact details buyers see: the checks that
// run before anything is sent, and again (server-side) wherever the value is
// read back, so a value written around the form gets no easier ride.

describe("normalizeSellerPhone", () => {
  it.each([
    ["+353 87 123 4567", undefined, "+353871234567"],
    ["087 123 4567", "IE", "+353871234567"],
    ["0035387 123 4567", undefined, "+353871234567"],
    ["+49 170 1234 5678", undefined, "+4917012345678"],
    ["+41 79 123 45 67", undefined, "+41791234567"],
    ["06 12 34 56 78", "FR", "+33612345678"],
  ])("%s (country %s) is %s", (raw, region, e164) => {
    expect(normalizeSellerPhone(raw, region)).toEqual({ ok: true, e164 });
  });

  it.each([
    // National digits mean a different number in every country.
    ["087 123 4567", null, /country code/i],
    // Not a number anywhere, or reserved fiction (Ofcom's drama range).
    ["+353 87 000", null, /doesn't exist/i],
    ["+44 7700 900123", null, /doesn't exist/i],
    ["12345", "IE", /doesn't exist/i],
    // Real, but outside where codes may be texted (the SMS-pumping fence).
    ["+1 202 555 0143", null, /EU, the EEA/i],
    ["+1 900 555 0100", null, /EU, the EEA/i],
    // Real, allowed, but a landline could never be proven by text.
    ["+353 1 234 5678", null, /mobile number/i],
    ["+44 20 7946 0000", null, /mobile number/i],
  ])("refuses %s (country %s)", (raw, region, message) => {
    const result = normalizeSellerPhone(raw, region);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(english(result.problem)).toMatch(message);
  });

  it("ignores a country code it does not know rather than guessing", () => {
    expect(normalizeSellerPhone("087 123 4567", "XX").ok).toBe(false);
  });
});

describe("formatPhoneInternational", () => {
  it("writes a stored number the way people read it", () => {
    expect(formatPhoneInternational("+353871234567")).toBe("+353 87 123 4567");
  });

  it("shows a value saved before normalisation as it was typed", () => {
    expect(formatPhoneInternational("call the shop")).toBe("call the shop");
  });
});

describe("addressQualityProblem", () => {
  it.each([
    "12 Market Street\nDublin, D02 X285\nIreland",
    "Main Street, Ballymore, Co. Westmeath", // rural Ireland: no digit at all
    "Rose Cottage Church Lane Little Snoring", // one line, no commas
    "Via Roma 1, 00184 Roma",
    "Fakenham Road 4\nNorwich", // "Fake" inside a real name is fine
    "ul. Marszałkowska 10, 00-590 Warszawa",
    // Short, one-line and label-led real addresses: each was refused once, and
    // the publish gate re-runs this, so a false positive here takes a live
    // seller's pages down.
    "PO Box 12",
    "1010 Wien",
    "Kaiserweg 12",
    "Main Street",
    "Business address: Hauptstraße 5, 1010 Wien",
    "Άγιος Νικόλαος 5, Αθήνα",
  ])("accepts %j", (address) => {
    expect(addressQualityProblem(address)).toBeNull();
  });

  it.each([
    ["123 Fake Street\nSpringfield", "placeholder"],
    ["Musterstraße 1\n12345 Musterstadt", "placeholder"],
    ["Lorem ipsum dolor\nsit amet", "placeholder"],
    ["asdfgh, qwerty", "placeholder"],
    ["n/a", "placeholder"],
    ["test", "placeholder"],
    ["aaaa, bbbb", "placeholder"],
    ["Your address here, City", "placeholder"],
    ["xx yy", "placeholder"],
    ["Dublin", "incomplete"],
    ["Home", "incomplete"],
  ])("refuses %j as %s", (address, kind) => {
    expect(addressQualityProblem(address)).toBe(`Validation.address.${kind}`);
  });

  it("leaves an empty address to the publish gate", () => {
    expect(addressQualityProblem("   ")).toBeNull();
  });
});
