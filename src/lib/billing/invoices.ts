// What Settings › Billing & invoices shows, and the rules that decide it.
// Client-safe and pure: the card (components/billing/invoices) and the dev
// gallery (/dev/invoices) read these, and a provider method that lists a
// customer's invoices from Stripe will fill them without the card changing.
//
// Money is integer cents everywhere.

import type { PricingContext } from "@/lib/billing/pricing-context";
import type { BillingInterval, PaidPlanId } from "@/lib/billing/plans";

/** Stripe's invoice statuses. A draft is never shown: it is not an invoice yet. */
export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";

/** What an invoice reads as to the seller: Stripe's status plus what is known. */
export type InvoiceDisplayStatus =
  | "paid"
  | "partially_refunded"
  | "refunded"
  /** Sent, waiting for the first attempt or the buyer's action. */
  | "due"
  | "payment_failed"
  | "void"
  | "uncollectible";

/** Why a card attempt failed, narrowed to what the seller can act on. */
export type PaymentFailure = "card_declined" | "expired_card" | "insufficient_funds" | "authentication_required";

/** How VAT applies to a store: a rate, nothing (outside VAT), or the buyer accounts for it. */
export type InvoiceTax =
  | { kind: "vat"; ratePct: number }
  | { kind: "reverse_charge" }
  | { kind: "none" };

/** One line of an invoice. A proration is what a mid-cycle plan change adds or credits. */
export type InvoiceLine = {
  kind: "plan" | "proration";
  plan: PaidPlanId;
  interval: BillingInterval;
  /** Negative for a credit. */
  amountCents: number;
};

export type Invoice = {
  /** Stripe's id (`in_…`). */
  id: string;
  /** The number printed on the PDF. */
  number: string;
  status: InvoiceStatus;
  /** When it was issued, ISO. */
  createdAt: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  lines: InvoiceLine[];
  tax: InvoiceTax;
  taxCents: number;
  amountPaidCents: number;
  refundedCents: number;
  paidAt: string | null;
  /** Card attempts so far: above 0 on an open invoice means one failed. */
  attemptCount: number;
  failure: PaymentFailure | null;
  /** When Stripe tries the card again, if it will. */
  nextAttemptAt: string | null;
  /** Stripe's page for this invoice (view, and pay it while it is open). */
  hostedUrl: string;
  pdfUrl: string;
};

export type CardBrand = "visa" | "mastercard" | "amex" | "other";

/** The card on file. Only what Stripe shows back: never a full number. */
export type PaymentMethod = {
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
};

/** What invoices are issued to. Edited on Stripe's page, never here. */
export type BillingProfile = {
  name: string | null;
  email: string | null;
  /** Street, city and postcode as Stripe holds them, one per line. */
  addressLines: string[];
  country: string | null;
  vatId: string | null;
  tax: InvoiceTax;
};

/** Everything the card draws once Stripe has answered. */
export type BillingDetails = {
  paymentMethod: PaymentMethod | null;
  profile: BillingProfile;
  invoices: Invoice[];
};

/** The card's three states while its data is fetched: asking, answered, or failed. */
export type InvoicesData =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; details: BillingDetails };

/** How many invoices the list draws before "Show more", and how many that adds. */
export const INVOICES_PAGE_SIZE = 6;

/** A card is "expiring" this many days before the end of its last month. */
export const CARD_EXPIRY_WARN_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export const invoiceTotalCents = (invoice: Invoice) =>
  invoice.lines.reduce((sum, line) => sum + line.amountCents, 0) + invoice.taxCents;

/** The tax on a net amount, rounded to the cent. Reverse charge and no tax add none. */
export function taxOn(netCents: number, tax: InvoiceTax): number {
  return tax.kind === "vat" ? Math.round((netCents * tax.ratePct) / 100) : 0;
}

export function invoiceDisplayStatus(invoice: Invoice): InvoiceDisplayStatus {
  switch (invoice.status) {
    case "paid":
      if (invoice.refundedCents > 0 && invoice.refundedCents >= invoice.amountPaidCents) return "refunded";
      return invoice.refundedCents > 0 ? "partially_refunded" : "paid";
    case "open":
    case "draft":
      return invoice.attemptCount > 0 ? "payment_failed" : "due";
    case "void":
      return "void";
    case "uncollectible":
      return "uncollectible";
  }
}

/** The statuses that ask the seller for something. */
export const needsAction = (status: InvoiceDisplayStatus) => status === "due" || status === "payment_failed";

/** Newest first, drafts left out: the list the seller reads. */
export function listedInvoices(invoices: readonly Invoice[]): Invoice[] {
  return invoices
    .filter((invoice) => invoice.status !== "draft")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** The newest invoice still waiting on the seller, if any. */
export function outstandingInvoice(invoices: readonly Invoice[]): Invoice | null {
  return listedInvoices(invoices).find((invoice) => needsAction(invoiceDisplayStatus(invoice))) ?? null;
}

/** A card is good through the last day of its expiry month. */
export function cardExpiryState(method: PaymentMethod, now: Date): "ok" | "expiring" | "expired" {
  // Day 0 of the next month is the last day of this one.
  const lastDay = Date.UTC(method.expYear, method.expMonth, 0, 23, 59, 59);
  if (now.getTime() > lastDay) return "expired";
  return lastDay - now.getTime() <= CARD_EXPIRY_WARN_DAYS * DAY_MS ? "expiring" : "ok";
}

/** A card's expiry month as printed on it: "08/2027". */
export const formatCardMonth = (method: PaymentMethod) =>
  `${String(method.expMonth).padStart(2, "0")}/${method.expYear}`;

/** What the next invoice is, from the plan the store is on. */
export type NextInvoice =
  | { kind: "scheduled"; dateIso: string; netCents: number; taxCents: number; totalCents: number; tax: InvoiceTax }
  /** A payment is failing: the outstanding invoice is the one to look at. */
  | { kind: "past_due" }
  /** The plan ends at the close of the period: nothing more is billed. */
  | { kind: "ending"; dateIso: string }
  | { kind: "granted" }
  | { kind: "none" };

export function nextInvoice(context: PricingContext, tax: InvoiceTax): NextInvoice {
  if (context.grant) return { kind: "granted" };
  if (!context.hasSubscription || context.priceCents === null || !context.currentPeriodEnd) return { kind: "none" };
  if (context.status === "past_due") return { kind: "past_due" };
  if (context.cancelAtPeriodEnd) return { kind: "ending", dateIso: context.currentPeriodEnd };
  const taxCents = taxOn(context.priceCents, tax);
  return {
    kind: "scheduled",
    dateIso: context.currentPeriodEnd,
    netCents: context.priceCents,
    taxCents,
    totalCents: context.priceCents + taxCents,
    tax,
  };
}
