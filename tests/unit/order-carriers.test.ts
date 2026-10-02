import { describe, expect, it } from "vitest";
import {
  CARRIER_OPTIONS,
  carrierName,
  parseCarrier,
  trackingLinkFor,
  trackingUrl,
} from "@/lib/orders/carriers";
import { parseFulfilment } from "@/lib/orders/fulfilment";
import { isCourierPhone } from "@/lib/orders/ship-to";
import { carrierSchema } from "@/lib/validation/orders";
import { shipToSchema } from "@/lib/validation/checkout";
import { CARRIER_IDS } from "@/types/order-view";

// A tracking LINK is the one place this app sends a buyer to somebody else's
// site, so what these pin is that it can only ever be a carrier's own https
// page with the number as a value in it: never a seller's URL, never a
// number that escapes its place in the address.

describe("the carrier list", () => {
  it("has a name and an https tracking page for every id an order can store", () => {
    for (const id of CARRIER_IDS) {
      expect(carrierName(id).length).toBeGreaterThan(1);
      const url = new URL(trackingUrl(id, "RR123456789IE", { country: "NL", postalCode: "1012 AB" }));
      expect(url.protocol).toBe("https:");
      expect(url.href).toContain("RR123456789IE");
    }
  });

  it("stores ids the database's shape check accepts", () => {
    // orders_tracking_carrier_shape in 20261001_order_tracking_carrier.sql.
    for (const id of CARRIER_IDS) expect(id).toMatch(/^[a-z0-9-]{2,24}$/);
    expect(new Set(CARRIER_IDS).size).toBe(CARRIER_IDS.length);
  });

  it("offers every carrier in the picker, A to Z", () => {
    expect(CARRIER_OPTIONS.map((option) => option.value).sort()).toEqual([...CARRIER_IDS].sort());
    const labels = CARRIER_OPTIONS.map((option) => option.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en")));
  });
});

describe("trackingUrl", () => {
  it("drops the spaces a seller typed for legibility", () => {
    expect(trackingUrl("ups", "1Z 999 AA1 01 2345 6784")).toBe(
      "https://www.ups.com/track?tracknum=1Z999AA10123456784",
    );
  });

  it("keeps the number a value: nothing in it can change where the link goes", () => {
    // Not a number the write boundary would store, which is the point: the
    // link is safe on its own, whatever reached the column.
    const hostile = "x/../../evil?next=//evil.example#";
    for (const id of CARRIER_IDS) {
      const url = new URL(trackingUrl(id, hostile, { country: "NL", postalCode: "1012AB" }));
      const clean = new URL(trackingUrl(id, "RR123456789IE", { country: "NL", postalCode: "1012AB" }));
      expect(url.origin).toBe(clean.origin);
      expect(url.href).not.toContain("evil.example#");
      expect(url.href).not.toContain("/../");
    }
  });

  it("gives PostNL the destination it asks for, and its tracking page without one", () => {
    expect(trackingUrl("postnl", "3SABCD123456789", { country: "NL", postalCode: "1012 AB" })).toBe(
      "https://jouw.postnl.nl/track-and-trace/3SABCD123456789-NL-1012AB",
    );
    expect(trackingUrl("postnl", "3SABCD123456789")).toBe("https://jouw.postnl.nl/track-and-trace/");
    expect(trackingUrl("postnl", "3SABCD123456789", { country: "IE" })).toBe(
      "https://jouw.postnl.nl/track-and-trace/",
    );
  });
});

describe("parseCarrier", () => {
  it("reads a carrier it knows, and nothing else", () => {
    expect(parseCarrier("dhl")).toBe("dhl");
    for (const unknown of ["DHL", "retired-carrier", "https://evil.example", "", null, undefined, 7]) {
      expect(parseCarrier(unknown)).toBeNull();
    }
  });
});

describe("carrierSchema", () => {
  it("accepts a listed carrier or none", () => {
    expect(carrierSchema.parse("an-post")).toBe("an-post");
    expect(carrierSchema.parse(null)).toBeNull();
  });

  it("refuses anything a seller could have typed", () => {
    for (const forged of ["", "An Post", "https://evil.example/track", "javascript:alert(1)"]) {
      expect(carrierSchema.safeParse(forged).success).toBe(false);
    }
  });
});

describe("a shipped order's carrier", () => {
  const row = {
    fulfilment_status: "shipped",
    shipped_at: "2026-09-27T10:00:00Z",
    tracking_number: "RR123456789IE",
    tracking_carrier: "an-post",
  };

  it("is read beside its tracking number", () => {
    expect(parseFulfilment(row)).toEqual({
      status: "shipped",
      shippedAt: "2026-09-27T10:00:00Z",
      trackingNumber: "RR123456789IE",
      carrier: "an-post",
    });
  });

  it("never stands without a number, and never on an order that has not shipped", () => {
    expect(parseFulfilment({ ...row, tracking_number: null }).carrier).toBeNull();
    expect(parseFulfilment({ ...row, fulfilment_status: "unfulfilled" }).carrier).toBeNull();
  });

  it("degrades to a plain number when the stored carrier is not one this build knows", () => {
    const fulfilment = parseFulfilment({ ...row, tracking_carrier: "carrier-from-the-future" });
    expect(fulfilment).toMatchObject({ trackingNumber: "RR123456789IE", carrier: null });
    expect(trackingLinkFor(fulfilment, null)).toBeNull();
  });

  it("links to the carrier's page only when there is both a number and a carrier", () => {
    expect(trackingLinkFor(parseFulfilment(row), null)).toEqual({
      carrier: "An Post",
      url: "https://www.anpost.com/Post-Parcels/Track/History?item=RR123456789IE",
    });
    expect(trackingLinkFor({ trackingNumber: "RR123456789IE", carrier: null }, null)).toBeNull();
    expect(trackingLinkFor({ trackingNumber: null, carrier: "an-post" }, null)).toBeNull();
  });
});

describe("the buyer's phone for the courier", () => {
  it("accepts numbers the way people write them", () => {
    for (const phone of ["+353 87 123 4567", "087 1234567", "(01) 234-5678", "+49.151.23456789", "0871234567"]) {
      expect(isCourierPhone(phone)).toBe(true);
    }
  });

  it("refuses words, links and numbers too short to ring", () => {
    for (const phone of ["call me", "12345", "+", "087 123 4567 ext. 9", "https://evil.example", "0871234567<script>"]) {
      expect(isCourierPhone(phone)).toBe(false);
    }
  });

  const address = { name: "Aoife Byrne", line1: "12 Harbour Road", city: "Dublin", country: "IE" };

  it("is optional at checkout, trimmed when given", () => {
    expect(shipToSchema.parse(address)).not.toHaveProperty("phone");
    expect(shipToSchema.parse({ ...address, phone: " +353 87 123 4567 " }).phone).toBe("+353 87 123 4567");
  });

  it("is refused at checkout when it is not a number, or is too long to be one", () => {
    for (const phone of ["call me after six", "", "1".repeat(25)]) {
      const result = shipToSchema.safeParse({ ...address, phone });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.path).toEqual(["phone"]);
    }
  });

  it("still refuses a key the checkout does not know", () => {
    expect(shipToSchema.safeParse({ ...address, phone: "0871234567", note: "x" }).success).toBe(false);
  });
});
