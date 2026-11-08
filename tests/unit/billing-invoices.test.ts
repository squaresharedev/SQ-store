// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  cardExpiryState,
  formatCardMonth,
  invoiceDisplayStatus,
  invoiceTotalCents,
  listedInvoices,
  nextInvoice,
  outstandingInvoice,
  taxOn,
  type Invoice,
  type InvoiceTax,
} from "@/lib/billing/invoices";
import type { PricingContext } from "@/lib/billing/pricing-context";
import { FREE_CONTEXT, paidContext } from "../../src/app/dev/pricing/fixtures";

const VAT: InvoiceTax = { kind: "vat", ratePct: 21 };

function invoice(fields: Partial<Invoice> = {}): Invoice {
  return {
    id: "in_1",
    number: "SQSH-1001",
    status: "paid",
    createdAt: "2026-10-12T09:00:00Z",
    periodStart: "2026-10-12T09:00:00Z",
    periodEnd: "2026-11-11T09:00:00Z",
    currency: "EUR",
    lines: [{ kind: "plan", plan: "starter", interval: "month", amountCents: 1200 }],
    tax: VAT,
    taxCents: 252,
    amountPaidCents: 1452,
    refundedCents: 0,
    paidAt: "2026-10-12T09:00:00Z",
    attemptCount: 1,
    failure: null,
    nextAttemptAt: null,
    hostedUrl: "https://example.test/i/1",
    pdfUrl: "https://example.test/i/1/pdf",
    ...fields,
  };
}

describe("taxOn", () => {
  it("rounds VAT to the cent and adds none for reverse charge or no tax", () => {
    expect(taxOn(1200, VAT)).toBe(252);
    expect(taxOn(3900, VAT)).toBe(819);
    expect(taxOn(1999, VAT)).toBe(420); // 419.79
    expect(taxOn(1200, { kind: "reverse_charge" })).toBe(0);
    expect(taxOn(1200, { kind: "none" })).toBe(0);
  });
});

describe("invoice totals", () => {
  it("adds the lines and the tax, and counts a credit as negative", () => {
    expect(invoiceTotalCents(invoice())).toBe(1452);
    const upgrade = invoice({
      lines: [
        { kind: "proration", plan: "starter", interval: "month", amountCents: -480 },
        { kind: "proration", plan: "pro", interval: "month", amountCents: 1560 },
      ],
      taxCents: taxOn(1080, VAT),
    });
    expect(invoiceTotalCents(upgrade)).toBe(1080 + 227);
  });

});

describe("invoiceDisplayStatus", () => {
  it("reads a paid invoice by how much of it was refunded", () => {
    expect(invoiceDisplayStatus(invoice())).toBe("paid");
    expect(invoiceDisplayStatus(invoice({ refundedCents: 500 }))).toBe("partially_refunded");
    expect(invoiceDisplayStatus(invoice({ refundedCents: 1452 }))).toBe("refunded");
  });

  it("reads an open invoice by whether a card attempt has failed", () => {
    expect(invoiceDisplayStatus(invoice({ status: "open", attemptCount: 0, paidAt: null }))).toBe("due");
    expect(invoiceDisplayStatus(invoice({ status: "open", attemptCount: 2, paidAt: null }))).toBe("payment_failed");
  });

  it("passes void and written-off invoices through", () => {
    expect(invoiceDisplayStatus(invoice({ status: "void" }))).toBe("void");
    expect(invoiceDisplayStatus(invoice({ status: "uncollectible" }))).toBe("uncollectible");
  });
});

describe("the list", () => {
  const older = invoice({ id: "a", createdAt: "2025-12-12T09:00:00Z" });
  const newer = invoice({ id: "b", createdAt: "2026-10-12T09:00:00Z" });
  const middle = invoice({ id: "c", createdAt: "2026-02-12T09:00:00Z" });
  const draft = invoice({ id: "d", status: "draft", createdAt: "2026-11-01T09:00:00Z" });

  it("is newest first and leaves drafts out", () => {
    expect(listedInvoices([older, draft, newer, middle]).map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("does not reorder the array it was given", () => {
    const input = [older, newer];
    listedInvoices(input);
    expect(input.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("finds the newest invoice still waiting on the owner", () => {
    const due = invoice({ id: "due", status: "open", attemptCount: 0, createdAt: "2026-09-12T09:00:00Z" });
    const failed = invoice({ id: "failed", status: "open", attemptCount: 1, createdAt: "2026-10-12T09:00:00Z" });
    expect(outstandingInvoice([due, failed, newer])?.id).toBe("failed");
    expect(outstandingInvoice([newer, older])).toBeNull();
  });
});

describe("cardExpiryState", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const card = (expMonth: number, expYear: number) => ({ brand: "visa" as const, last4: "4242", expMonth, expYear });

  it("is good through the last day of its month", () => {
    expect(cardExpiryState(card(11, 2026), new Date("2026-11-30T23:00:00Z"))).toBe("expiring");
    expect(cardExpiryState(card(11, 2026), new Date("2026-12-01T00:00:01Z"))).toBe("expired");
  });

  it("warns within 60 days and not before", () => {
    expect(cardExpiryState(card(12, 2026), now)).toBe("expiring");
    expect(cardExpiryState(card(1, 2027), now)).toBe("ok"); // ends 31 Jan, 84 days away
    expect(cardExpiryState(card(3, 2027), now)).toBe("ok");
    expect(cardExpiryState(card(10, 2026), now)).toBe("expired");
  });

  it("prints the month as on the card", () => {
    expect(formatCardMonth(card(8, 2028))).toBe("08/2028");
  });
});

describe("nextInvoice", () => {
  const periodEnd = "2026-12-12T09:00:00Z";

  it("schedules the plan's price plus tax on the period end", () => {
    const next = nextInvoice(paidContext("starter", "month", periodEnd), VAT);
    expect(next).toMatchObject({ kind: "scheduled", dateIso: periodEnd, netCents: 1200, taxCents: 252, totalCents: 1452 });
  });

  it("adds no tax under reverse charge", () => {
    const next = nextInvoice(paidContext("pro", "month", periodEnd), { kind: "reverse_charge" });
    expect(next).toMatchObject({ kind: "scheduled", netCents: 3900, taxCents: 0, totalCents: 3900 });
  });

  it("bills nothing more once the plan is set to end", () => {
    expect(nextInvoice(paidContext("pro", "month", periodEnd, { cancelAtPeriodEnd: true }), VAT)).toEqual({
      kind: "ending",
      dateIso: periodEnd,
    });
  });

  it("holds while a payment is failing, and has nothing for Free or a given plan", () => {
    expect(nextInvoice(paidContext("pro", "month", periodEnd, { status: "past_due" }), VAT)).toEqual({ kind: "past_due" });
    expect(nextInvoice(FREE_CONTEXT, VAT)).toEqual({ kind: "none" });
    const granted: PricingContext = { ...FREE_CONTEXT, plan: "pro", grant: { plan: "pro", endsAt: null } };
    expect(nextInvoice(granted, VAT)).toEqual({ kind: "granted" });
  });
});
