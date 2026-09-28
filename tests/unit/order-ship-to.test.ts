import { describe, expect, it } from "vitest";
import { formatShipTo, parseShipTo, shipToLines } from "@/lib/orders/ship-to";
import { isToShip, parseFulfilment } from "@/lib/orders/fulfilment";
import { trackingNumberSchema } from "@/lib/validation/orders";
import { SHIP_TO_MAX } from "@/types/order-view";

// The address is what a parcel is labelled with, and the same module reads it
// for the panel, the copy button and the seller's email. These pin both halves:
// what gets stored (and refused), and the label it prints as.

const DUBLIN = {
  name: "Aoife Byrne",
  line1: "12 Harbour Road",
  line2: "Apartment 4",
  city: "Dublin",
  postalCode: "D02 X285",
  country: "IE",
  phone: "+353 87 123 4567",
};

describe("parseShipTo", () => {
  it("keeps a complete address as it was given", () => {
    expect(parseShipTo(DUBLIN)).toEqual(DUBLIN);
  });

  it("trims, collapses whitespace and upper-cases the country", () => {
    expect(
      parseShipTo({ name: "  Aoife   Byrne ", line1: "12 Harbour Road", city: " Dublin", country: "ie" }),
    ).toEqual({ name: "Aoife Byrne", line1: "12 Harbour Road", city: "Dublin", country: "IE" });
  });

  it("turns control characters into spaces rather than storing them", () => {
    const parsed = parseShipTo({ ...DUBLIN, line1: "12 Harbour\r\nRoad\u0000" });
    expect(parsed?.line1).toBe("12 Harbour Road");
  });

  it("caps every field", () => {
    const parsed = parseShipTo({ ...DUBLIN, name: "x".repeat(500), postalCode: "9".repeat(50) });
    expect(parsed?.name).toHaveLength(SHIP_TO_MAX.name);
    expect(parsed?.postalCode).toHaveLength(SHIP_TO_MAX.postalCode);
  });

  it("drops empty optional fields instead of storing them blank", () => {
    const parsed = parseShipTo({ ...DUBLIN, line2: "   ", phone: "" });
    expect(parsed).not.toHaveProperty("line2");
    expect(parsed).not.toHaveProperty("phone");
  });

  it("is null when the parcel could not be addressed with it", () => {
    for (const missing of ["name", "line1", "city", "country"] as const) {
      expect(parseShipTo({ ...DUBLIN, [missing]: "" })).toBeNull();
    }
    expect(parseShipTo({ ...DUBLIN, country: "Ireland" })).toBeNull();
    expect(parseShipTo(null)).toBeNull();
    expect(parseShipTo("12 Harbour Road")).toBeNull();
    expect(parseShipTo([DUBLIN])).toBeNull();
  });
});

describe("shipToLines", () => {
  it("writes an Irish address city, then Eircode, then country", () => {
    expect(shipToLines(DUBLIN, "Ireland")).toEqual([
      "Aoife Byrne",
      "12 Harbour Road",
      "Apartment 4",
      "Dublin",
      "D02 X285",
      "Ireland",
    ]);
  });

  it("writes a continental address postcode first, on the city's line", () => {
    expect(
      shipToLines(
        { name: "Lukas Weber", line1: "Lindenstrasse 14", city: "Berlin", postalCode: "10115", country: "DE" },
        "Deutschland",
      ),
    ).toEqual(["Lukas Weber", "Lindenstrasse 14", "10115 Berlin", "Deutschland"]);
  });

  it("writes a US address as city, state and ZIP on one line", () => {
    expect(
      shipToLines(
        { name: "Sam Park", line1: "1 Main St", city: "Portland", region: "OR", postalCode: "97201", country: "US" },
        "United States",
      ),
    ).toEqual(["Sam Park", "1 Main St", "Portland, OR 97201", "United States"]);
  });

  it("never puts the phone on the label, and falls back to the code for an unnamed country", () => {
    const lines = shipToLines(DUBLIN, null);
    expect(lines).not.toContain(DUBLIN.phone);
    expect(lines.at(-1)).toBe("IE");
  });

  it("joins the label into one block for copying", () => {
    expect(formatShipTo(DUBLIN, "Ireland")).toBe(
      "Aoife Byrne\n12 Harbour Road\nApartment 4\nDublin\nD02 X285\nIreland",
    );
  });
});

describe("fulfilment", () => {
  it("reads a shipped order with its date and tracking number", () => {
    expect(
      parseFulfilment({
        fulfilment_status: "shipped",
        shipped_at: "2026-09-27T10:00:00Z",
        tracking_number: "RR123456789IE",
      }),
    ).toEqual({ status: "shipped", shippedAt: "2026-09-27T10:00:00Z", trackingNumber: "RR123456789IE" });
  });

  it("never reads an unknown status as a parcel still owed", () => {
    expect(parseFulfilment({ fulfilment_status: "lost" }).status).toBe("not_required");
    expect(parseFulfilment({}).status).toBe("not_required");
  });

  it("ignores a date or tracking number on an order that has not shipped", () => {
    expect(
      parseFulfilment({ fulfilment_status: "unfulfilled", shipped_at: "x", tracking_number: "RR1" }),
    ).toEqual({ status: "unfulfilled", shippedAt: null, trackingNumber: null });
  });

  it("counts only paid, unsent orders as to ship", () => {
    const order = (status: "paid" | "pending" | "refunded" | "disputed", fulfilment: "unfulfilled" | "shipped" | "not_required") => ({
      status,
      fulfilment: { status: fulfilment },
    });
    expect(isToShip(order("paid", "unfulfilled"))).toBe(true);
    expect(isToShip(order("paid", "shipped"))).toBe(false);
    expect(isToShip(order("paid", "not_required"))).toBe(false);
    expect(isToShip(order("pending", "unfulfilled"))).toBe(false);
    expect(isToShip(order("refunded", "unfulfilled"))).toBe(false);
    expect(isToShip(order("disputed", "unfulfilled"))).toBe(false);
  });
});

describe("trackingNumberSchema", () => {
  it("accepts carrier numbers, trimmed, and an empty field", () => {
    expect(trackingNumberSchema.parse(" RR123456789IE ")).toBe("RR123456789IE");
    expect(trackingNumberSchema.parse("1Z 999 AA1 01 2345 6784")).toBe("1Z 999 AA1 01 2345 6784");
    expect(trackingNumberSchema.parse("")).toBe("");
  });

  it("refuses links, markup, and numbers too short or long to be one", () => {
    for (const value of ["https://track.example/1", "<b>1234</b>", "abc", "9".repeat(41)]) {
      expect(trackingNumberSchema.safeParse(value).success).toBe(false);
    }
  });
});
