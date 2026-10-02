import { describe, expect, it } from "vitest";
import { CSV_BOM, centsToDecimal, csvCell, toCsv } from "@/lib/format/csv";
import { ORDERS_CSV_COLUMNS, ordersCsv, ordersCsvFileName, type OrderExportRow } from "@/lib/orders/csv";
import { orderView } from "../setup/order-view";

// The orders export (a paid perk): what a spreadsheet opens, and what it must
// never run or reveal.

describe("csvCell", () => {
  it("quotes commas, quotes and line breaks, doubling inner quotes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a, b")).toBe('"a, b"');
    expect(csvCell('the "big" one')).toBe('"the ""big"" one"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(" padded")).toBe('" padded"');
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+1 cmd")).toBe("'+1 cmd");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
  });

  it("leaves plain numbers alone so a column still sums", () => {
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell(3)).toBe("3");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("centsToDecimal", () => {
  it("prints integer cents as two-decimal amounts without float drift", () => {
    expect(centsToDecimal(0)).toBe("0.00");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(1234)).toBe("12.34");
    expect(centsToDecimal(-1999)).toBe("-19.99");
    expect(centsToDecimal(1_000_000_01)).toBe("1000000.01");
  });
});

describe("toCsv", () => {
  it("starts with a byte-order mark and ends every row in CRLF", () => {
    expect(toCsv(["a", "b"], [["1", 2]])).toBe(`${CSV_BOM}a,b\r\n1,2\r\n`);
  });
});

function row(overrides: Partial<OrderExportRow> = {}): OrderExportRow {
  return { ...orderView(), shippingCents: 450, ...overrides };
}

describe("ordersCsv", () => {
  it("writes the header contract, then one line per order", () => {
    const lines = ordersCsv([row(), row()]).replace(CSV_BOM, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe(ORDERS_CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(3);
  });

  it("carries the ledger: amounts, the fee, its rate and what the seller keeps", () => {
    const order = row({
      id: "44561113-aaaa-bbbb-cccc-000000000000",
      amountCents: 2450,
      platformFeeCents: 60,
      platformFeeBps: 300,
      shippingCents: 450,
      currency: "EUR",
      quantity: 2,
      selection: [{ label: "Size", value: "Large" }],
    });
    const [, line] = ordersCsv([order]).replace(CSV_BOM, "").trimEnd().split("\r\n");
    const cells = Object.fromEntries(ORDERS_CSV_COLUMNS.map((column, i) => [column, line!.split(",")[i]]));
    expect(cells.order_number).toBe("44561113");
    expect(cells.quantity).toBe("2");
    expect(cells.currency).toBe("EUR");
    expect(cells.amount).toBe("24.50");
    expect(cells.shipping).toBe("4.50");
    expect(cells.platform_fee).toBe("0.60");
    expect(cells.platform_fee_rate_percent).toBe("3.00");
    expect(cells.after_platform_fee).toBe("23.90");
    expect(cells.options).toBe("Size: Large");
  });

  it("leaves the rate and shipping empty on orders from before they were recorded", () => {
    const [, line] = ordersCsv([row({ platformFeeBps: null, shippingCents: null })])
      .replace(CSV_BOM, "")
      .trimEnd()
      .split("\r\n");
    const cells = line!.split(",");
    expect(cells[ORDERS_CSV_COLUMNS.indexOf("shipping")]).toBe("");
    expect(cells[ORDERS_CSV_COLUMNS.indexOf("platform_fee_rate_percent")]).toBe("");
  });

  it("names the carrier after the tracking number, as the newest and so the last column", () => {
    expect(ORDERS_CSV_COLUMNS.slice(-2)).toEqual(["tracking_number", "tracking_carrier"]);
    const [, line] = ordersCsv([
      row({
        fulfilment: {
          status: "shipped",
          shippedAt: "2026-09-27T10:00:00Z",
          trackingNumber: "RR123456789IE",
          carrier: "an-post",
        },
      }),
    ])
      .replace(CSV_BOM, "")
      .trimEnd()
      .split("\r\n");
    expect(line!.split(",").slice(-2)).toEqual(["RR123456789IE", "an-post"]);
  });

  it("is a ledger, not a mailing list: no buyer email, name or street", () => {
    const csv = ordersCsv([
      row({
        buyerEmail: "buyer@example.com",
        shipTo: { name: "Ada Buyer", line1: "1 Secret Street", city: "Prague", country: "CZ" },
      }),
    ]);
    expect(csv).not.toContain("buyer@example.com");
    expect(csv).not.toContain("Ada Buyer");
    expect(csv).not.toContain("Secret Street");
    expect(csv).toContain(",CZ,");
  });

  it("defuses a product title written as a formula", () => {
    const csv = ordersCsv([row({ productTitle: "=cmd|' /C calc'!A0" })]);
    expect(csv).toContain(",'=cmd|' /C calc'!A0,");
  });
});

describe("ordersCsvFileName", () => {
  it("is branded and dated in UTC", () => {
    expect(ordersCsvFileName(new Date("2026-09-30T23:30:00Z"))).toBe("square-share-orders-2026-09-30.csv");
  });
});
