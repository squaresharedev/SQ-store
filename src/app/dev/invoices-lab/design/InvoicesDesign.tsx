"use client";

import * as React from "react";
import { useLocale } from "next-intl";
import { InvoicesCard } from "@/components/billing/invoices/InvoicesCard";
import { countryName } from "@/lib/format/country";
import { formatLongDate } from "@/lib/format/date";
import {
  cardExpiryState,
  invoiceTotalCents,
  listedInvoices,
  nextInvoice,
  outstandingInvoice,
  type BillingDetails,
  type Invoice,
  type NextInvoice,
} from "@/lib/billing/invoices";
import { standInBillingActions } from "../../pricing/fixtures";
import type { InvoicesScenario } from "../../invoices/fixtures";
import { cn } from "@/lib/utils";
import {
  AccentLink,
  AttentionBanner,
  Btn,
  CardExpiry,
  CardMark,
  InvoiceDialog,
  InvoiceTable,
  SpendBars,
  cardClass,
  lineLabel,
  cardName,
  cardShort,
  designVars,
  money,
  type Design,
} from "./parts";

/** Everything a composition needs, worked out once from a store state. */
type View = {
  props: Design;
  details: BillingDetails;
  invoices: Invoice[];
  next: NextInvoice;
  expiry: "ok" | "expiring" | "expired" | null;
  outstanding: Invoice | null;
  now: Date;
  /** Opens an invoice the design's way (dialog, or Stripe's page). */
  openInvoice: (invoice: Invoice) => void;
  download: (invoice: Invoice) => void;
  /** Stripe's portal, for a card, an address or a VAT ID. */
  portal: (what: string) => void;
  banner: React.ReactNode;
  /** "Starter", for a bill's breakdown. */
  planName: string;
};

const H2 = "text-base font-semibold text-foreground";
const SUB = "mt-1 font-inter text-sm text-muted-foreground";
const EYEBROW = "font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** The section's own title, as Settings draws it above its cards. */
function SectionTitle() {
  return (
    <div>
      <h2 className={H2}>Billing &amp; invoices</h2>
      <p className={SUB}>Your card, who invoices go to, and every invoice we&apos;ve sent you.</p>
    </div>
  );
}

/** "€14.52", with the date and tax said under it. */
function useNextWords(view: View) {
  const locale = useLocale();
  const { next } = view;
  const currency = "EUR";
  switch (next.kind) {
    case "scheduled":
      return {
        figure: money(next.totalCents, currency, locale),
        line: `on ${formatLongDate(next.dateIso, locale)}`,
        note:
          next.tax.kind === "vat"
            ? `${money(next.netCents, currency, locale)} + ${money(next.taxCents, currency, locale)} VAT`
            : next.tax.kind === "reverse_charge"
              ? "VAT reverse charged"
              : "No VAT",
      };
    case "past_due":
      return view.outstanding
        ? {
            figure: money(invoiceTotalCents(view.outstanding), view.outstanding.currency, locale),
            line: `the payment on ${formatLongDate(view.outstanding.createdAt, locale)} failed`,
            note: "",
            due: true,
          }
        : { figure: "On hold", line: "until the failed payment goes through", note: "" };
    case "ending":
      return { figure: "None", line: `your plan ends on ${formatLongDate(next.dateIso, locale)}`, note: "" };
    case "granted":
      return { figure: "None", line: "Square Share gave your store this plan", note: "" };
    default:
      return { figure: "None", line: "you're not on a paid plan", note: "" };
  }
}

function BilledTo({ view, compact = false }: { view: View; compact?: boolean }) {
  const locale = useLocale();
  const { profile } = view.details;
  if (!profile.name && !profile.addressLines.length) return <p className="font-inter text-sm text-muted-foreground">Added when you first pay.</p>;
  const place = [...profile.addressLines, countryName(profile.country, locale) ?? profile.country].filter(Boolean);
  return (
    <div className="min-w-0 font-inter text-sm">
      <p className="font-medium text-foreground">{profile.name}</p>
      {compact ? (
        <p className="text-muted-foreground">{place.join(", ")}</p>
      ) : (
        place.map((line) => (
          <p key={line} className="text-muted-foreground">
            {line}
          </p>
        ))
      )}
      <p className="text-muted-foreground">{profile.vatId ? `VAT ID ${profile.vatId}` : "No VAT ID"}</p>
      {!compact && profile.email && <p className="text-muted-foreground">{profile.email}</p>}
    </div>
  );
}

function CardFact({ view, size = "sm" }: { view: View; size?: "sm" | "lg" }) {
  const method = view.details.paymentMethod;
  if (!method) return <p className="font-inter text-sm text-muted-foreground">No card on file.</p>;
  if (size === "lg" && view.props.cardMark === "art") {
    return (
      <div className="space-y-2">
        <CardMark method={method} props={view.props} size="lg" />
        <CardExpiry method={method} state={view.expiry ?? "ok"} />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-3">
      <CardMark method={method} props={view.props} />
      <div className="min-w-0 font-inter text-sm">
        <p className="font-medium text-foreground">{cardName(method)}</p>
        <CardExpiry method={method} state={view.expiry ?? "ok"} />
      </div>
    </div>
  );
}

function Table({ view, inset, headers, labels }: { view: View; inset?: boolean; headers?: boolean; labels?: Parameters<typeof InvoiceTable>[0]["labels"] }) {
  if (!view.invoices.length) {
    return <p className={cn("py-6 text-center font-inter text-sm text-muted-foreground", inset && "px-5")}>No invoices yet. The first appears when your plan is billed.</p>;
  }
  return (
    <InvoiceTable
      invoices={view.invoices}
      props={view.props}
      method={view.details.paymentMethod}
      onOpen={view.openInvoice}
      onDownload={view.download}
      inset={inset}
      headers={headers}
      labels={labels}
    />
  );
}

function ExportButton({ view }: { view: View }) {
  if (!view.props.exportCsv) return null;
  return (
    <Btn props={view.props} className="h-8 px-3 text-xs" onClick={() => view.portal("export.csv")}>
      Export CSV
    </Btn>
  );
}

// The compositions.

/** Stripe's customer portal: three stacked sections with small caps headings and an accent Update on each. */
function Portal({ view }: { view: View }) {
  const { props } = view;
  const section = "space-y-3 border-t border-border pt-5 first:border-t-0 first:pt-0";
  return (
    <div className={cn(cardClass(props), "space-y-5 p-6")}>
      <SectionTitle />
      {view.banner}
      <section className={section}>
        <h3 className={EYEBROW}>Payment method</h3>
        <div className="flex items-center justify-between gap-4">
          <CardFact view={view} />
          <AccentLink onClick={() => view.portal("payment method")}>{view.details.paymentMethod ? "Update" : "Add card"}</AccentLink>
        </div>
      </section>
      <section className={section}>
        <h3 className={EYEBROW}>Billing information</h3>
        <div className="flex items-start justify-between gap-4">
          <BilledTo view={view} />
          <AccentLink onClick={() => view.portal("billing information")}>Update</AccentLink>
        </div>
      </section>
      <section className={section}>
        <div className="flex items-center justify-between gap-3">
          <h3 className={EYEBROW}>Invoice history</h3>
          <ExportButton view={view} />
        </div>
        {props.spendChart && <SpendBars invoices={view.invoices} now={view.now} props={props} />}
        <Table view={view} headers={false} />
      </section>
    </div>
  );
}

/** A Vercel card: title, body, and a grey footer bar with a hint and its button. */
function Panel({
  view,
  title,
  description,
  footer,
  action,
  flush = false,
  children,
}: {
  view: View;
  title: string;
  description?: string;
  footer: string;
  action?: React.ReactNode;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={cardClass(view.props)}>
      <div className={cn("space-y-4 p-5", flush && "pb-3")}>
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {description && <p className={SUB}>{description}</p>}
        </div>
        {!flush && children}
      </div>
      {flush && children}
      <div className="flex flex-col gap-3 border-t border-border bg-neutral-50 px-5 py-3 @xl:flex-row @xl:items-center @xl:justify-between">
        <p className="font-inter text-sm text-muted-foreground">{footer}</p>
        {action}
      </div>
    </section>
  );
}

function Panels({ view }: { view: View }) {
  const { props } = view;
  return (
    <div className="space-y-5">
      <SectionTitle />
      {view.banner}
      <Panel
        view={view}
        title="Payment method"
        description="Charged when your plan renews."
        footer="Card details are kept by Stripe, never by us."
        action={
          <Btn props={props} onClick={() => view.portal("payment method")}>
            {view.details.paymentMethod ? "Update card" : "Add card"}
          </Btn>
        }
      >
        <CardFact view={view} />
      </Panel>
      <Panel
        view={view}
        title="Invoices"
        description="Every invoice, newest first."
        footer={view.details.profile.email ? `Each one is also emailed to ${view.details.profile.email}.` : "Each one is also emailed to you."}
        action={<ExportButton view={view} />}
        flush
      >
        {props.spendChart && (
          <div className="px-5 pb-4">
            <SpendBars invoices={view.invoices} now={view.now} props={props} />
          </div>
        )}
        <Table view={view} inset />
      </Panel>
      <Panel
        view={view}
        title="Billing details"
        description="The name, address and VAT ID printed on your invoices."
        footer="Changes apply to your next invoice."
        action={
          <Btn props={props} onClick={() => view.portal("billing details")}>
            Edit details
          </Btn>
        }
      >
        <BilledTo view={view} />
      </Panel>
    </div>
  );
}

/** Shopify: the upcoming bill as the hero with its breakdown, past bills under it, the card beside. */
function Bill({ view }: { view: View }) {
  const { props, next } = view;
  const locale = useLocale();
  const words = useNextWords(view);
  return (
    <div className="space-y-5">
      <SectionTitle />
      {view.banner}
      <section className={cn(cardClass(props), "grid @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]")}>
        <div className="p-5">
          <p className={cn(EYEBROW, words.due && "text-red-700")}>{words.due ? "Due now" : "Upcoming bill"}</p>
          <p className="mt-2 text-4xl font-bold tabular-nums text-foreground">{words.figure}</p>
          <p className="mt-1 font-inter text-sm text-muted-foreground">{words.line}</p>
        </div>
        <div className="border-t border-border p-5 @2xl:border-l @2xl:border-t-0">
          {next.kind === "scheduled" ? (
            <dl className="space-y-2 font-inter text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{view.planName} plan</dt>
                <dd className="tabular-nums text-foreground">{money(next.netCents, "EUR", locale)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{next.tax.kind === "vat" ? `VAT (${next.tax.ratePct}%)` : next.tax.kind === "reverse_charge" ? "VAT (reverse charge)" : "Tax"}</dt>
                <dd className="tabular-nums text-foreground">{money(next.taxCents, "EUR", locale)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold">
                <dt className="text-foreground">Total</dt>
                <dd className="tabular-nums text-foreground">{money(next.totalCents, "EUR", locale)}</dd>
              </div>
            </dl>
          ) : view.outstanding ? (
            <dl className="space-y-2 font-inter text-sm">
              {view.outstanding.lines.map((line, i) => (
                <div key={i} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{lineLabel(line)}</dt>
                  <dd className="tabular-nums text-foreground">{money(line.amountCents, "EUR", locale)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">VAT</dt>
                <dd className="tabular-nums text-foreground">{money(view.outstanding.taxCents, "EUR", locale)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold">
                <dt className="text-red-700">Due now</dt>
                <dd className="tabular-nums text-red-700">{money(invoiceTotalCents(view.outstanding), "EUR", locale)}</dd>
              </div>
            </dl>
          ) : (
            <p className="font-inter text-sm text-muted-foreground">Nothing is due on your plan right now.</p>
          )}
        </div>
      </section>

      <div className="grid gap-5 @2xl:grid-cols-[minmax(0,1fr)_16rem]">
        <section className={cn(cardClass(props), "min-w-0")}>
          <div className="flex items-center justify-between gap-3 p-5 pb-3">
            <h3 className="text-base font-semibold text-foreground">Past bills</h3>
            <ExportButton view={view} />
          </div>
          {props.spendChart && (
            <div className="px-5 pb-4">
              <SpendBars invoices={view.invoices} now={view.now} props={props} />
            </div>
          )}
          <Table view={view} inset labels={{ date: "Date issued", number: "Bill", amount: "Total" }} />
        </section>
        <section className={cn(cardClass(props), "space-y-4 self-start p-5")}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-foreground">Payment method</h3>
            <AccentLink onClick={() => view.portal("payment method")}>{view.details.paymentMethod ? "Update" : "Add"}</AccentLink>
          </div>
          <CardFact view={view} size="lg" />
          <div className="border-t border-border pt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">Billing information</h3>
              <AccentLink onClick={() => view.portal("billing information")}>Edit</AccentLink>
            </div>
            <BilledTo view={view} compact />
          </div>
        </section>
      </div>
    </div>
  );
}

/** GitHub: two boxes with Edit, then the payment history. */
function History({ view }: { view: View }) {
  const { props } = view;
  const box = (title: string, what: string, body: React.ReactNode) => (
    <section className={cardClass(props)}>
      <div className="flex items-center justify-between gap-3 border-b border-border bg-neutral-50 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <Btn props={props} className="h-7 px-2.5 text-xs" onClick={() => view.portal(what)}>
          Edit
        </Btn>
      </div>
      <div className="p-4">{body}</div>
    </section>
  );
  return (
    <div className="space-y-5">
      <SectionTitle />
      {view.banner}
      <div className="grid gap-4 @2xl:grid-cols-2">
        {box("Payment method", "payment method", <CardFact view={view} />)}
        {box("Billing information", "billing information", <BilledTo view={view} compact />)}
      </div>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-foreground">Payment history</h3>
          <ExportButton view={view} />
        </div>
        {props.spendChart && <SpendBars invoices={view.invoices} now={view.now} props={props} />}
        <div className={cardClass(props)}>
          <Table view={view} inset labels={{ number: "ID", amount: "Amount" }} />
        </div>
      </section>
    </div>
  );
}

/** Linear: one dense card, each fact a row with its own small action, then the invoices. */
function Compact({ view }: { view: View }) {
  const { props } = view;
  const words = useNextWords(view);
  const method = view.details.paymentMethod;
  const row = "flex items-center justify-between gap-4 py-3";
  return (
    <div className={cn(cardClass(props), "space-y-4 p-5")}>
      <SectionTitle />
      {view.banner}
      <div className="divide-y divide-border border-y border-border">
        <div className={row}>
          <div className="min-w-0 font-inter text-sm">
            <p className="text-muted-foreground">{words.due ? "Due now" : "Next payment"}</p>
            <p className="font-medium text-foreground">
              {words.figure} <span className="font-normal text-muted-foreground">{words.line}</span>
            </p>
          </div>
        </div>
        <div className={row}>
          <div className="flex min-w-0 items-center gap-3">
            {method && <CardMark method={method} props={props} />}
            <div className="min-w-0 font-inter text-sm">
              <p className="text-muted-foreground">Payment method</p>
              <p className="truncate font-medium text-foreground">
                {method ? cardShort(method) : "No card on file"}
                {method && <span className="font-normal"> · <CardExpiry method={method} state={view.expiry ?? "ok"} /></span>}
              </p>
            </div>
          </div>
          <Btn props={props} className="h-8 px-3 text-xs" onClick={() => view.portal("payment method")}>
            Change
          </Btn>
        </div>
        <div className={row}>
          <div className="min-w-0 font-inter text-sm">
            <p className="text-muted-foreground">Billed to</p>
            <p className="truncate font-medium text-foreground">{view.details.profile.name ?? "Added when you first pay"}</p>
          </div>
          <Btn props={props} className="h-8 px-3 text-xs" onClick={() => view.portal("billing details")}>
            Edit
          </Btn>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 pt-1">
        <h3 className="text-sm font-semibold text-foreground">Invoices</h3>
        <ExportButton view={view} />
      </div>
      {props.spendChart && <SpendBars invoices={view.invoices} now={view.now} props={props} />}
      <Table view={view} />
    </div>
  );
}

/** Notion and Figma: a summary column beside the list. */
function Split({ view }: { view: View }) {
  const { props } = view;
  const words = useNextWords(view);
  return (
    <div className="space-y-5">
      <SectionTitle />
      {view.banner}
      <div className="grid gap-5 @2xl:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className={cn(cardClass(props), "space-y-5 self-start p-5")}>
          <div>
            <p className={cn(EYEBROW, words.due && "text-red-700")}>{words.due ? "Due now" : "Next payment"}</p>
            <p className="mt-1.5 text-3xl font-bold tabular-nums text-foreground">{words.figure}</p>
            <p className="font-inter text-sm text-muted-foreground">{words.line}</p>
            {words.note && <p className="font-inter text-xs text-muted-foreground">{words.note}</p>}
          </div>
          <div className="space-y-2 border-t border-border pt-5">
            <p className={EYEBROW}>Card</p>
            <CardFact view={view} size="lg" />
          </div>
          <div className="space-y-2 border-t border-border pt-5">
            <p className={EYEBROW}>Billed to</p>
            <BilledTo view={view} compact />
          </div>
          <Btn props={props} className="w-full" onClick={() => view.portal("manage")}>
            Manage billing
          </Btn>
        </aside>
        <section className={cn(cardClass(props), "min-w-0")}>
          <div className="flex items-center justify-between gap-3 p-5 pb-3">
            <h3 className="text-base font-semibold text-foreground">Invoices</h3>
            <ExportButton view={view} />
          </div>
          {props.spendChart && (
            <div className="px-5 pb-4">
              <SpendBars invoices={view.invoices} now={view.now} props={props} />
            </div>
          )}
          <Table view={view} inset />
        </section>
      </div>
    </div>
  );
}

/** Square Share, after the Payments tab: one big figure, a ledger beside it, the year's bars, the table. */
function Ledger({ view }: { view: View }) {
  const { props } = view;
  const locale = useLocale();
  const words = useNextWords(view);
  const year = view.now.getUTCFullYear();
  const paidThisYear = view.invoices
    .filter((invoice) => invoice.status === "paid" && new Date(invoice.createdAt).getUTCFullYear() === year)
    .reduce((sum, invoice) => sum + invoiceTotalCents(invoice) - invoice.refundedCents, 0);
  const ledgerRow = "flex items-start justify-between gap-4 px-5 py-3.5";
  return (
    <div className="space-y-5">
      <SectionTitle />
      {view.banner}
      <section className={cn(cardClass(props), "grid @2xl:grid-cols-[3fr_2fr]")}>
        <div className="flex flex-col justify-between gap-6 p-5 @2xl:p-6">
          <div>
            <p className={cn(EYEBROW, "tracking-widest", words.due && "text-red-700")}>{words.due ? "Due now" : "Next payment"}</p>
            <p className="mt-2 text-4xl font-bold tabular-nums text-foreground @2xl:text-5xl">{words.figure}</p>
            <p className="mt-2 font-inter text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{words.line}</span>
              {words.note && ` · ${words.note}`}
            </p>
          </div>
          {props.spendChart && <SpendBars invoices={view.invoices} now={view.now} props={props} />}
        </div>
        <div className="divide-y divide-border border-t border-border @2xl:border-l @2xl:border-t-0">
          <div className={ledgerRow}>
            <div className="min-w-0">
              <p className={EYEBROW}>Card</p>
              <div className="mt-1.5">
                <CardFact view={view} />
              </div>
            </div>
            <AccentLink onClick={() => view.portal("payment method")}>Update</AccentLink>
          </div>
          <div className={ledgerRow}>
            <div className="min-w-0">
              <p className={EYEBROW}>Billed to</p>
              <div className="mt-1.5">
                <BilledTo view={view} compact />
              </div>
            </div>
            <AccentLink onClick={() => view.portal("billing details")}>Edit</AccentLink>
          </div>
          <div className={cn(ledgerRow, "items-baseline")}>
            <p className={EYEBROW}>Paid in {year}</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">{money(paidThisYear, "EUR", locale)}</p>
          </div>
        </div>
      </section>
      <section className={cardClass(props)}>
        <div className="flex items-center justify-between gap-3 p-5 pb-3">
          <h3 className="text-base font-semibold text-foreground">Invoices</h3>
          <ExportButton view={view} />
        </div>
        <Table view={view} inset />
      </section>
    </div>
  );
}

/** A store that never asks Stripe, or is waiting on it: the same few words in any composition. */
function NotReady({ props, scenario }: { props: Design; scenario: InvoicesScenario }) {
  const { context, data } = scenario;
  const text = !(context.hasBillingAccount && context.available)
    ? context.grant
      ? "Square Share gave your store this plan, so there is nothing to pay and no invoices."
      : context.available
        ? "Invoices and payment details appear here once you're on a paid plan."
        : "Invoices and payment details will appear here once paid plans open."
    : data.state === "error"
      ? "Your invoices can't be loaded right now. Your plan and your store are not affected."
      : null;
  return (
    <div className={cn(cardClass(props), "space-y-4 p-6")}>
      <SectionTitle />
      {text ? (
        <p className="font-inter text-sm text-muted-foreground">{text}</p>
      ) : (
        <div className="space-y-3" role="status" aria-label="Loading your invoices">
          {[0, 1, 2, 3].map((line) => (
            <span key={line} className={cn("block h-5 animate-pulse rounded-sm bg-secondary", line % 2 ? "w-2/3" : "w-full")} />
          ))}
        </div>
      )}
    </div>
  );
}

const LAYOUTS = { portal: Portal, panels: Panels, bill: Bill, history: History, compact: Compact, split: Split, ledger: Ledger } as const;

/**
 * One design of Settings › Billing & invoices: a composition and its knobs over
 * one store state. `onOpen` hears every link and portal call (nothing leaves
 * the page). Lays out by container queries, so a 390px box is its phone view.
 */
export function InvoicesDesign({
  design,
  scenario,
  now,
  onOpen,
}: {
  design: Design;
  scenario: InvoicesScenario;
  now: Date;
  onOpen: (what: string) => void;
}) {
  const [selected, setSelected] = React.useState<Invoice | null>(null);
  const { context, data } = scenario;
  const actions = React.useMemo(() => standInBillingActions(onOpen), [onOpen]);

  let body: React.ReactNode;
  if (design.layout === "current") {
    body = <InvoicesCard context={context} data={data} actions={actions} openLink={onOpen} now={now} />;
  } else if (!(context.hasBillingAccount && context.available) || data.state !== "ready") {
    body = <NotReady props={design} scenario={scenario} />;
  } else {
    const details = data.details;
    const outstanding = outstandingInvoice(details.invoices);
    const expiry = details.paymentMethod ? cardExpiryState(details.paymentMethod, now) : null;
    const view: View = {
      props: design,
      details,
      invoices: listedInvoices(details.invoices),
      next: nextInvoice(context, details.profile.tax),
      expiry,
      outstanding,
      now,
      openInvoice: (invoice) => (design.rowOpens === "dialog" ? setSelected(invoice) : onOpen(invoice.hostedUrl)),
      download: (invoice) => onOpen(invoice.pdfUrl),
      portal: (what) => onOpen(`Stripe portal: ${what}`),
      planName: `${context.plan[0]!.toUpperCase()}${context.plan.slice(1)}`,
      banner: (
        <AttentionBanner
          invoice={outstanding}
          expired={expiry === "expired" ? details.paymentMethod : null}
          props={design}
          onFix={(what) => onOpen(what === "pay" && outstanding ? outstanding.hostedUrl : "Stripe portal: update card")}
        />
      ),
    };
    const Layout = LAYOUTS[design.layout];
    body = (
      <>
        <Layout view={view} />
        <InvoiceDialog
          invoice={selected}
          method={details.paymentMethod}
          props={design}
          onClose={() => setSelected(null)}
          onOpenUrl={onOpen}
        />
      </>
    );
  }

  return (
    <div className="@container bg-background p-6" style={designVars(design)} data-invoices-design={design.layout}>
      {body}
    </div>
  );
}
