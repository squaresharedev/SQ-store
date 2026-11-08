import { intervalPriceCents } from "@/lib/billing/fees";
import {
  taxOn,
  type BillingDetails,
  type BillingProfile,
  type Invoice,
  type InvoiceLine,
  type InvoicesData,
  type InvoiceTax,
  type PaymentFailure,
  type PaymentMethod,
} from "@/lib/billing/invoices";
import type { PricingContext } from "@/lib/billing/pricing-context";
import type { BillingInterval, PaidPlanId } from "@/lib/billing/plans";
import { PLAN_PRICE_SEED } from "@/lib/billing/pricing-seed";
import { FREE_CONTEXT, PRICES_WITH_YEARLY, paidContext } from "../pricing/fixtures";

// Fake billing for /dev/invoices: store states and what Stripe would answer for
// each, built around a `now` so the dates stay believable whenever it is opened.
// Prices come from the seed, so a change to the catalogue moves these too.

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight of `day` in the month `monthsBack` months before `now`'s. */
function monthStart(now: Date, monthsBack: number, day: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, day, 9, 0, 0));
}

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
const iso = (date: Date) => date.toISOString();

/** The day of the month every fake subscription renews on. */
const RENEWAL_DAY = 12;

/** Latest renewal on or before `now`, and the one after it. */
function renewals(now: Date): { last: Date; next: Date } {
  const thisMonth = monthStart(now, 0, RENEWAL_DAY);
  const last = thisMonth.getTime() <= now.getTime() ? thisMonth : monthStart(now, 1, RENEWAL_DAY);
  const next = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, RENEWAL_DAY, 9, 0, 0));
  return { last, next };
}

/** The renewal `monthsBack` months before the latest one. */
const renewalBack = (now: Date, monthsBack: number) => {
  const { last } = renewals(now);
  return new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - monthsBack, RENEWAL_DAY, 9, 0, 0));
};

// Who is billed.

const CZ_VAT: BillingProfile = {
  name: "Studio Nova s.r.o.",
  email: "hello@studionova.example",
  addressLines: ["Vinohradská 12", "120 00 Praha 2"],
  country: "CZ",
  vatId: null,
  tax: { kind: "vat", ratePct: 21 },
};

const DE_REVERSE: BillingProfile = {
  name: "Kunstwerk GmbH",
  email: "buchhaltung@kunstwerk.example",
  addressLines: ["Torstraße 88", "10119 Berlin"],
  country: "DE",
  vatId: "DE123456789",
  tax: { kind: "reverse_charge" },
};

const US_NO_TAX: BillingProfile = {
  name: "Maple & Co",
  email: "orders@mapleandco.example",
  addressLines: ["412 Elm Street", "Portland, OR 97205"],
  country: "US",
  vatId: null,
  tax: { kind: "none" },
};

const NO_PROFILE: BillingProfile = {
  name: null,
  email: null,
  addressLines: [],
  country: null,
  vatId: null,
  tax: { kind: "none" },
};

const card = (brand: PaymentMethod["brand"], last4: string, expMonth: number, expYear: number): PaymentMethod => ({
  brand,
  last4,
  expMonth,
  expYear,
});

// Invoices.

let sequence = 1000;

type InvoiceSpec = {
  issued: Date;
  plan: PaidPlanId;
  interval?: BillingInterval;
  tax: InvoiceTax;
  lines?: InvoiceLine[];
  status?: Invoice["status"];
  refundedCents?: number;
  attemptCount?: number;
  failure?: PaymentFailure;
  nextAttemptAt?: Date;
};

function invoice(spec: InvoiceSpec): Invoice {
  const interval = spec.interval ?? "month";
  const prices = interval === "year" ? PRICES_WITH_YEARLY : PLAN_PRICE_SEED;
  const lines = spec.lines ?? [
    { kind: "plan", plan: spec.plan, interval, amountCents: intervalPriceCents(prices, spec.plan, interval) ?? 0 },
  ];
  const net = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const taxCents = taxOn(net, spec.tax);
  const status = spec.status ?? "paid";
  const number = `SQSH-${++sequence}`;
  const periodEnd =
    interval === "year"
      ? new Date(Date.UTC(spec.issued.getUTCFullYear() + 1, spec.issued.getUTCMonth(), spec.issued.getUTCDate()))
      : new Date(Date.UTC(spec.issued.getUTCFullYear(), spec.issued.getUTCMonth() + 1, spec.issued.getUTCDate()));
  return {
    id: `in_dev_${sequence}`,
    number,
    status,
    createdAt: iso(spec.issued),
    periodStart: iso(spec.issued),
    periodEnd: iso(addDays(periodEnd, -1)),
    currency: "EUR",
    lines,
    tax: spec.tax,
    taxCents,
    amountPaidCents: status === "paid" ? net + taxCents : 0,
    refundedCents: spec.refundedCents ?? 0,
    paidAt: status === "paid" ? iso(spec.issued) : null,
    attemptCount: spec.attemptCount ?? (status === "paid" ? 1 : 0),
    failure: spec.failure ?? null,
    nextAttemptAt: spec.nextAttemptAt ? iso(spec.nextAttemptAt) : null,
    hostedUrl: `https://invoice.stripe.com/(dev)/${number}`,
    pdfUrl: `https://invoice.stripe.com/(dev)/${number}/pdf`,
  };
}

/** `count` monthly invoices on the renewal day, the newest first. */
function monthly(now: Date, count: number, plan: PaidPlanId, tax: InvoiceTax, skipNewest = 0): Invoice[] {
  return Array.from({ length: count }, (_, index) =>
    invoice({ issued: renewalBack(now, index + skipNewest), plan, tax }),
  );
}

// Scenarios.

export type InvoicesScenario = {
  value: string;
  label: string;
  context: PricingContext;
  data: InvoicesData;
};

const ready = (details: BillingDetails): InvoicesData => ({ state: "ready", details });

export function invoicesScenarios(now: Date): InvoicesScenario[] {
  // Numbered from the same start on the server and in the browser, so both draw the same list.
  sequence = 1000;
  const { next } = renewals(now);
  const periodEnd = iso(next);
  const nextYear = card("visa", "4242", 8, now.getUTCFullYear() + 2);
  const yearly = new Date(Date.UTC(now.getUTCFullYear() + 1, 1, 20, 9));

  // Upgrade partway through a cycle: the proration invoice, then Pro as normal.
  const upgradeAt = addDays(renewalBack(now, 3), 11);
  const upgraded = [
    ...monthly(now, 3, "pro", CZ_VAT.tax),
    invoice({
      issued: upgradeAt,
      plan: "pro",
      tax: CZ_VAT.tax,
      lines: [
        { kind: "proration", plan: "starter", interval: "month", amountCents: -480 },
        { kind: "proration", plan: "pro", interval: "month", amountCents: 1560 },
      ],
    }),
    ...monthly(now, 5, "starter", CZ_VAT.tax, 3),
  ];

  const failedNewest = invoice({
    issued: renewals(now).last,
    plan: "pro",
    tax: CZ_VAT.tax,
    status: "open",
    attemptCount: 2,
    failure: "expired_card",
    nextAttemptAt: addDays(now, 3),
  });

  const mixed = [
    invoice({ issued: renewalBack(now, 0), plan: "starter", tax: CZ_VAT.tax }),
    invoice({ issued: renewalBack(now, 1), plan: "starter", tax: CZ_VAT.tax, refundedCents: 1452 }),
    invoice({ issued: renewalBack(now, 2), plan: "starter", tax: CZ_VAT.tax, refundedCents: 600 }),
    invoice({ issued: renewalBack(now, 3), plan: "starter", tax: CZ_VAT.tax, status: "void" }),
    invoice({
      issued: renewalBack(now, 4),
      plan: "starter",
      tax: CZ_VAT.tax,
      status: "uncollectible",
      attemptCount: 4,
      failure: "insufficient_funds",
    }),
    ...monthly(now, 3, "starter", CZ_VAT.tax, 5),
  ];

  const starter = (overrides: Partial<PricingContext> = {}) => paidContext("starter", "month", periodEnd, overrides);
  const pro = (overrides: Partial<PricingContext> = {}) => paidContext("pro", "month", periodEnd, overrides);

  return [
    {
      value: "active",
      label: "Starter, 14 months of invoices, VAT",
      context: starter(),
      data: ready({ paymentMethod: nextYear, profile: CZ_VAT, invoices: monthly(now, 14, "starter", CZ_VAT.tax) }),
    },
    {
      value: "yearly",
      label: "Pro yearly, reverse charge",
      context: paidContext("pro", "year", iso(yearly)),
      data: ready({
        paymentMethod: card("mastercard", "5100", 11, now.getUTCFullYear() + 3),
        profile: DE_REVERSE,
        invoices: [0, 1, 2].map((back) =>
          invoice({
            issued: new Date(Date.UTC(now.getUTCFullYear() - back, 1, 20, 9)),
            plan: "pro",
            interval: "year",
            tax: DE_REVERSE.tax,
          }),
        ),
      }),
    },
    {
      value: "upgraded",
      label: "Moved up to Pro mid-cycle (proration)",
      context: pro(),
      data: ready({ paymentMethod: nextYear, profile: CZ_VAT, invoices: upgraded }),
    },
    {
      value: "failed",
      label: "Payment failed, card expired",
      context: pro({ status: "past_due" }),
      data: ready({
        paymentMethod: card("amex", "0005", ((now.getUTCMonth() + 11) % 12) + 1, now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()),
        profile: CZ_VAT,
        invoices: [failedNewest, ...monthly(now, 5, "pro", CZ_VAT.tax, 1)],
      }),
    },
    {
      value: "due",
      label: "Invoice waiting, no card on file",
      context: starter(),
      data: ready({
        paymentMethod: null,
        profile: CZ_VAT,
        invoices: [
          invoice({ issued: renewals(now).last, plan: "starter", tax: CZ_VAT.tax, status: "open", attemptCount: 0 }),
          ...monthly(now, 3, "starter", CZ_VAT.tax, 1),
        ],
      }),
    },
    {
      value: "authentication",
      label: "Bank needs the owner to confirm",
      context: starter({ status: "past_due" }),
      data: ready({
        paymentMethod: card("visa", "3155", 4, now.getUTCFullYear() + 1),
        profile: CZ_VAT,
        invoices: [
          invoice({
            issued: renewals(now).last,
            plan: "starter",
            tax: CZ_VAT.tax,
            status: "open",
            attemptCount: 1,
            failure: "authentication_required",
            nextAttemptAt: addDays(now, 1),
          }),
          ...monthly(now, 2, "starter", CZ_VAT.tax, 1),
        ],
      }),
    },
    {
      value: "expiring",
      label: "Card expires next month",
      context: starter(),
      data: ready({
        paymentMethod: card(
          "visa",
          "1881",
          ((now.getUTCMonth() + 1) % 12) + 1,
          now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear(),
        ),
        profile: CZ_VAT,
        invoices: monthly(now, 7, "starter", CZ_VAT.tax),
      }),
    },
    {
      value: "ending",
      label: "Pro, cancelled at period end",
      context: pro({ cancelAtPeriodEnd: true }),
      data: ready({ paymentMethod: nextYear, profile: CZ_VAT, invoices: monthly(now, 6, "pro", CZ_VAT.tax) }),
    },
    {
      value: "first",
      label: "Just upgraded: one invoice, US, no tax",
      context: starter(),
      data: ready({
        paymentMethod: card("mastercard", "4444", 2, now.getUTCFullYear() + 4),
        profile: US_NO_TAX,
        invoices: monthly(now, 1, "starter", US_NO_TAX.tax),
      }),
    },
    {
      value: "downgraded",
      label: "Back on Free, old invoices kept",
      context: { ...FREE_CONTEXT, hasBillingAccount: true },
      data: ready({
        paymentMethod: nextYear,
        profile: CZ_VAT,
        invoices: monthly(now, 9, "starter", CZ_VAT.tax, 3),
      }),
    },
    {
      value: "mixed",
      label: "Refunds, a void and a write-off",
      context: starter(),
      data: ready({ paymentMethod: nextYear, profile: CZ_VAT, invoices: mixed }),
    },
    {
      value: "empty",
      label: "Billing account, no invoices yet",
      context: { ...FREE_CONTEXT, hasBillingAccount: true },
      data: ready({ paymentMethod: null, profile: NO_PROFILE, invoices: [] }),
    },
    {
      value: "free",
      label: "Free, never paid",
      context: FREE_CONTEXT,
      data: ready({ paymentMethod: null, profile: NO_PROFILE, invoices: [] }),
    },
    {
      value: "granted",
      label: "Plan given by Square Share",
      context: { ...FREE_CONTEXT, plan: "starter", grant: { plan: "starter", endsAt: periodEnd } },
      data: ready({ paymentMethod: null, profile: NO_PROFILE, invoices: [] }),
    },
    {
      value: "unavailable",
      label: "Billing not set up here",
      context: { ...FREE_CONTEXT, available: false },
      data: ready({ paymentMethod: null, profile: NO_PROFILE, invoices: [] }),
    },
    { value: "loading", label: "Asking Stripe", context: starter(), data: { state: "loading" } },
    { value: "error", label: "Stripe did not answer", context: starter(), data: { state: "error" } },
  ];
}
