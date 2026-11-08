"use client";

import * as React from "react";
import type { CSSProperties } from "react";
import { Ban, ChevronRight, CircleCheck, CircleX, Clock, CreditCard, Download, RotateCcw, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { Button } from "@/components/ui/button";
import { Modal, ModalActions } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { formatLongDate, formatOrderDate } from "@/lib/format/date";
import { formatCents } from "@/lib/format/money";
import {
  INVOICES_PAGE_SIZE,
  formatCardMonth,
  invoiceDisplayStatus,
  invoiceTotalCents,
  type CardBrand,
  type Invoice,
  type InvoiceDisplayStatus,
  type InvoiceLine,
  type PaymentMethod,
} from "@/lib/billing/invoices";
import type { InvoicesDesignProps } from "../lab-model";

// The pieces every composition of the invoices lab is built from. Lab-only:
// raw colours and English words are fine here; a winner is rebuilt on tokens
// and i18n keys when it ships.

export type Design = InvoicesDesignProps;

/** The accent as custom properties on a design's root. */
export function designVars(props: Design): CSSProperties {
  return {
    "--lab-accent": props.accent,
    "--lab-accent-soft": `color-mix(in oklab, ${props.accent} 9%, white)`,
    "--lab-accent-line": `color-mix(in oklab, ${props.accent} 30%, white)`,
  } as CSSProperties;
}

export const radiusClass = (props: Design) =>
  props.radius === "sharp" ? "rounded-none" : props.radius === "soft" ? "rounded-lg" : "rounded-2xl";

export const innerRadiusClass = (props: Design) =>
  props.radius === "sharp" ? "rounded-none" : props.radius === "soft" ? "rounded-md" : "rounded-xl";

/** A content card in the design's style. Padding is the caller's. */
export function cardClass(props: Design): string {
  const surface =
    props.cards === "hairline"
      ? "border border-border bg-card"
      : "bg-card ring-1 ring-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-16px_rgba(0,0,0,0.16)]";
  return cn(surface, radiusClass(props), "overflow-hidden");
}

/** A link-coloured word button in the accent: Stripe's "Update", GitHub's "Edit". */
export function AccentLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 font-inter text-sm font-medium text-[var(--lab-accent)] hover:underline focus-visible:underline focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

/** A button that follows the design's corners. */
export function Btn({
  props,
  variant = "secondary",
  className,
  ...rest
}: { props: Design; variant?: "primary" | "secondary" | "ghost" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      variant={variant}
      className={cn(innerRadiusClass(props), "h-9 py-0 text-sm", variant === "primary" && "bg-[var(--lab-accent)] hover:bg-[var(--lab-accent)]/90", className)}
      {...rest}
    />
  );
}

export const money = (cents: number, currency: string, locale: Locale) => formatCents(cents, currency, locale);

const BRAND_SHORT: Record<CardBrand, string> = { visa: "VISA", mastercard: "MC", amex: "AMEX", other: "CARD" };
const BRAND_NAME: Record<CardBrand, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", other: "Card" };

export const cardName = (method: PaymentMethod) => `${BRAND_NAME[method.brand]} ending in ${method.last4}`;
export const cardShort = (method: PaymentMethod) => `${BRAND_NAME[method.brand]} ···· ${method.last4}`;

/** The card on file, drawn the design's way. */
export function CardMark({ method, props, size = "sm" }: { method: PaymentMethod; props: Design; size?: "sm" | "lg" }) {
  if (props.cardMark === "text") return null;
  if (props.cardMark === "icon") {
    return (
      <span className={cn("flex size-9 shrink-0 items-center justify-center bg-secondary text-foreground", innerRadiusClass(props))}>
        <CreditCard aria-hidden className="size-4" strokeWidth={2} />
      </span>
    );
  }
  if (props.cardMark === "chip" || size === "sm") {
    return (
      <span
        aria-hidden
        className="flex h-7 w-11 shrink-0 items-center justify-center rounded-[5px] border border-border bg-background font-inter text-[9px] font-black italic tracking-wider text-foreground"
      >
        {BRAND_SHORT[method.brand]}
      </span>
    );
  }
  // The card itself, small: the accent as its colour, the chip, the last four.
  return (
    <div
      aria-hidden
      className={cn("relative h-36 w-full max-w-60 overflow-hidden p-4 text-white shadow-md", props.radius === "sharp" ? "rounded-none" : "rounded-xl")}
      style={{ background: `linear-gradient(135deg, ${props.accent}, color-mix(in oklab, ${props.accent} 45%, black))` }}
    >
      <span className="absolute -right-10 -top-12 size-40 rounded-full bg-white/10" />
      <span className="block h-6 w-8 rounded-sm bg-white/80" />
      <p className="absolute bottom-10 left-4 font-mono text-sm tracking-widest">···· ···· ···· {method.last4}</p>
      <div className="absolute inset-x-4 bottom-3 flex items-end justify-between font-inter text-[11px]">
        <span className="opacity-80">{formatCardMonth(method)}</span>
        <span className="text-sm font-black italic tracking-wider">{BRAND_SHORT[method.brand]}</span>
      </div>
    </div>
  );
}

/** "Expires 08/2028", red once it has, amber while it is about to. */
export function CardExpiry({ method, state }: { method: PaymentMethod; state: "ok" | "expiring" | "expired" }) {
  return (
    <span
      className={cn(
        "font-inter text-xs",
        state === "expired" ? "font-medium text-red-700" : state === "expiring" ? "font-medium text-amber-700" : "text-muted-foreground",
      )}
    >
      {state === "expired" ? `Expired ${formatCardMonth(method)}` : `Expires ${formatCardMonth(method)}${state === "expiring" ? ", soon" : ""}`}
    </span>
  );
}

const TONE: Record<InvoiceDisplayStatus, { pill: string; dot: string; text: string; Icon: typeof CircleCheck }> = {
  paid: { pill: "bg-green-50 text-green-700 ring-green-600/20", dot: "bg-green-600", text: "text-green-700", Icon: CircleCheck },
  partially_refunded: { pill: "bg-neutral-100 text-neutral-700 ring-neutral-500/20", dot: "bg-neutral-400", text: "text-neutral-600", Icon: RotateCcw },
  refunded: { pill: "bg-neutral-100 text-neutral-700 ring-neutral-500/20", dot: "bg-neutral-400", text: "text-neutral-600", Icon: RotateCcw },
  due: { pill: "bg-amber-50 text-amber-800 ring-amber-600/25", dot: "bg-amber-500", text: "text-amber-700", Icon: Clock },
  payment_failed: { pill: "bg-red-50 text-red-700 ring-red-600/20", dot: "bg-red-600", text: "text-red-700", Icon: CircleX },
  void: { pill: "bg-neutral-100 text-neutral-500 ring-neutral-500/20", dot: "bg-neutral-300", text: "text-neutral-500", Icon: Ban },
  uncollectible: { pill: "bg-neutral-100 text-neutral-500 ring-neutral-500/20", dot: "bg-neutral-300", text: "text-neutral-500", Icon: Ban },
};

/** An invoice's status, drawn the design's way. */
export function Status({ status, props }: { status: InvoiceDisplayStatus; props: Design }) {
  const t = useTranslations("Billing.invoices.status");
  const tone = TONE[status];
  const label = t(status);
  switch (props.status) {
    case "pill":
      return (
        <span className={cn("inline-flex items-center whitespace-nowrap px-2 py-0.5 font-inter text-xs font-medium ring-1 ring-inset", tone.pill, props.radius === "sharp" ? "rounded-none" : "rounded-full")}>
          {label}
        </span>
      );
    case "dot":
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-inter text-sm text-foreground">
          <span aria-hidden className={cn("size-1.5 rounded-full", tone.dot)} />
          {label}
        </span>
      );
    case "icon":
      return (
        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap font-inter text-sm", tone.text)}>
          <tone.Icon aria-hidden className="size-4" strokeWidth={2} />
          {label}
        </span>
      );
    default:
      return <span className={cn("whitespace-nowrap font-inter text-sm", status === "payment_failed" || status === "due" ? cn("font-medium", tone.text) : "text-muted-foreground")}>{label}</span>;
  }
}

/** What an invoice was for, in a few words. */
export function describe(invoice: Invoice): string {
  const plan = (line: InvoiceLine) => `${line.plan[0]!.toUpperCase()}${line.plan.slice(1)}`;
  const main = invoice.lines.find((line) => line.kind === "plan");
  if (main) return `${plan(main)} plan, ${main.interval === "year" ? "yearly" : "monthly"}`;
  const charge = invoice.lines.find((line) => line.amountCents > 0) ?? invoice.lines[0];
  return charge ? `Change to ${plan(charge)}` : "Invoice";
}

export function lineLabel(line: InvoiceLine): string {
  const plan = `${line.plan[0]!.toUpperCase()}${line.plan.slice(1)}`;
  if (line.kind === "plan") return `${plan} plan, ${line.interval === "year" ? "1 year" : "1 month"}`;
  return line.amountCents < 0 ? `Unused time on ${plan}` : `Remaining time on ${plan}`;
}

/** Download, the design's way. */
function DownloadControl({ invoice, props, onDownload }: { invoice: Invoice; props: Design; onDownload: (invoice: Invoice) => void }) {
  const label = `Download invoice ${invoice.number}`;
  const press = (event: React.MouseEvent) => {
    event.stopPropagation();
    onDownload(invoice);
  };
  if (props.download === "button") {
    return (
      <Btn props={props} onClick={press} aria-label={label} className="h-8 px-3 text-xs">
        Download
      </Btn>
    );
  }
  if (props.download === "link") {
    return (
      <button type="button" onClick={press} aria-label={label} className="font-inter text-sm font-medium text-[var(--lab-accent)] hover:underline">
        PDF
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={press}
      aria-label={label}
      className={cn("inline-flex size-8 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground", innerRadiusClass(props))}
    >
      <Download aria-hidden className="size-4" strokeWidth={2} />
    </button>
  );
}

const HEAD_CELL = "px-3 pb-2 pt-1 text-left font-inter text-xs font-medium text-muted-foreground first:pl-0 last:pr-0";

/**
 * The invoices as a table: date, the optional columns, amount, status and the
 * download, newest first, a page at a time. Optional columns drop out on a
 * phone. A row opens the invoice when the design says rows do.
 */
export function InvoiceTable({
  invoices,
  props,
  method,
  onOpen,
  onDownload,
  headers = true,
  inset = false,
  labels = {},
}: {
  invoices: Invoice[];
  props: Design;
  method: PaymentMethod | null;
  onOpen: (invoice: Invoice) => void;
  onDownload: (invoice: Invoice) => void;
  headers?: boolean;
  /** Pad the first and last cells to a card's edge (a table that runs edge to edge in its card). */
  inset?: boolean;
  labels?: { date?: string; number?: string; amount?: string };
}) {
  const locale = useLocale();
  const [shown, setShown] = React.useState(INVOICES_PAGE_SIZE);
  const visible = invoices.slice(0, shown);
  const hidden = invoices.length - visible.length;
  const pad = props.density === "compact" ? "py-2" : "py-3.5";
  const edge = inset ? "first:pl-5 last:pr-5" : "first:pl-0 last:pr-0";
  const opens = props.rowOpens !== "none";
  const cols =
    3 + (props.showNumber ? 1 : 0) + (props.showPlan ? 1 : 0) + (props.showMethod ? 1 : 0) + 1;

  const yearOf = (invoice: Invoice) => new Date(invoice.createdAt).getUTCFullYear();
  return (
    <div>
      <table className="w-full border-collapse font-inter text-sm">
        {headers && (
          <thead>
            <tr className="border-b border-border">
              <th className={cn(HEAD_CELL, inset && "first:pl-5")}>{labels.date ?? "Date"}</th>
              {props.showNumber && <th className={cn(HEAD_CELL, "hidden @xl:table-cell")}>{labels.number ?? "Invoice"}</th>}
              {props.showPlan && <th className={cn(HEAD_CELL, "hidden @xl:table-cell")}>Description</th>}
              {props.showMethod && <th className={cn(HEAD_CELL, "hidden @2xl:table-cell")}>Payment method</th>}
              <th className={cn(HEAD_CELL, "text-right")}>{labels.amount ?? "Amount"}</th>
              <th className={HEAD_CELL}>Status</th>
              <th className={cn(HEAD_CELL, inset && "last:pr-5")}>
                <span className="sr-only">Download</span>
              </th>
            </tr>
          </thead>
        )}
        <tbody>
          {visible.flatMap((invoice, i) => {
            const status = invoiceDisplayStatus(invoice);
            const year = yearOf(invoice);
            const rows: React.ReactNode[] = [];
            if (props.groupByYear && (i === 0 || yearOf(visible[i - 1]!) !== year)) {
              rows.push(
                <tr key={`y${year}`} className="border-b border-border">
                  <th colSpan={cols} className={cn("pb-1.5 pt-4 text-left font-inter text-xs font-semibold tracking-wide text-foreground", edge)}>
                    {year}
                  </th>
                </tr>,
              );
            }
            rows.push(
              <tr
                key={invoice.id}
                data-invoice-row={invoice.number}
                onClick={opens ? () => onOpen(invoice) : undefined}
                onKeyDown={
                  opens
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpen(invoice);
                        }
                      }
                    : undefined
                }
                tabIndex={opens ? 0 : undefined}
                aria-label={opens ? `Open invoice ${invoice.number}` : undefined}
                className={cn(
                  "border-b border-border last:border-b-0",
                  opens && "cursor-pointer transition-colors duration-base hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none",
                )}
              >
                <td className={cn("whitespace-nowrap px-3 text-foreground", pad, edge)}>
                  {formatOrderDate(invoice.createdAt, locale)}
                  {/* On a phone the description rides under the date. */}
                  {props.showPlan && <span className="block font-inter text-xs text-muted-foreground @xl:hidden">{describe(invoice)}</span>}
                </td>
                {props.showNumber && <td className={cn("hidden px-3 font-mono text-xs text-muted-foreground @xl:table-cell", pad)}>{invoice.number}</td>}
                {props.showPlan && <td className={cn("hidden px-3 text-muted-foreground @xl:table-cell", pad)}>{describe(invoice)}</td>}
                {props.showMethod && (
                  <td className={cn("hidden whitespace-nowrap px-3 text-muted-foreground @2xl:table-cell", pad)}>{method ? cardShort(method) : "None"}</td>
                )}
                <td className={cn("whitespace-nowrap px-3 text-right font-medium tabular-nums text-foreground", pad)}>
                  {money(invoiceTotalCents(invoice), invoice.currency, locale)}
                </td>
                <td className={cn("px-3", pad)}>
                  <Status status={status} props={props} />
                </td>
                <td className={cn("w-px whitespace-nowrap px-3 text-right", pad, edge)}>
                  <span className="inline-flex items-center gap-1">
                    <DownloadControl invoice={invoice} props={props} onDownload={onDownload} />
                    {props.rowOpens === "stripe" && <ChevronRight aria-hidden className="hidden size-4 text-muted-foreground @xl:block" />}
                  </span>
                </td>
              </tr>,
            );
            return rows;
          })}
        </tbody>
      </table>
      {hidden > 0 && (
        <div className={cn("pt-3", inset && "px-5 pb-4")}>
          <Btn props={props} variant="ghost" className="w-full text-muted-foreground" onClick={() => setShown(invoices.length)}>
            Show all {invoices.length} invoices
          </Btn>
        </div>
      )}
    </div>
  );
}

/** Twelve months of what the store was billed, as bars: the year at a glance. */
export function SpendBars({ invoices, now, props }: { invoices: Invoice[]; now: Date; props: Design }) {
  const locale = useLocale();
  const months = Array.from({ length: 12 }, (_, i) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1));
    const cents = invoices
      .filter((invoice) => invoice.status === "paid")
      .filter((invoice) => {
        const at = new Date(invoice.createdAt);
        return at.getUTCFullYear() === start.getUTCFullYear() && at.getUTCMonth() === start.getUTCMonth();
      })
      .reduce((sum, invoice) => sum + invoiceTotalCents(invoice), 0);
    return { start, cents };
  });
  const max = Math.max(...months.map((month) => month.cents), 1);
  const latest = months.findLastIndex((month) => month.cents > 0);
  const total = months.reduce((sum, month) => sum + month.cents, 0);
  const currency = invoices[0]?.currency ?? "EUR";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground">Last 12 months</p>
        <p className="font-inter text-sm font-semibold tabular-nums text-foreground">{money(total, currency, locale)}</p>
      </div>
      <div className="mt-3 flex h-16 items-end gap-1.5" aria-hidden>
        {months.map((month, i) => (
          <div key={i} className="flex h-full flex-1 flex-col justify-end">
            <div
              className={cn(props.radius === "sharp" ? "rounded-none" : "rounded-t-sm", month.cents ? "" : "bg-border")}
              style={{
                height: month.cents ? `${Math.max(8, (month.cents / max) * 100)}%` : 2,
                background: month.cents ? (i === latest ? "var(--lab-accent)" : "var(--lab-accent-line)") : undefined,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 font-inter text-[10px] text-muted-foreground" aria-hidden>
        {months.map((month, i) => (
          <span key={i} className="flex-1 text-center">
            {new Intl.DateTimeFormat(locale, { month: "narrow", timeZone: "UTC" }).format(month.start)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The one line that appears while something waits on the owner. */
export function AttentionBanner({
  invoice,
  expired,
  props,
  onFix,
}: {
  invoice: Invoice | null;
  expired: PaymentMethod | null;
  props: Design;
  onFix: (what: "card" | "pay") => void;
}) {
  const locale = useLocale();
  if (!invoice && !expired) return null;
  const status = invoice ? invoiceDisplayStatus(invoice) : null;
  const amount = invoice ? money(invoiceTotalCents(invoice), invoice.currency, locale) : "";
  const message = invoice
    ? status === "payment_failed"
      ? `Your ${amount} payment on ${formatOrderDate(invoice.createdAt, locale)} didn't go through${invoice.failure === "expired_card" ? ": the card has expired" : invoice.failure === "authentication_required" ? ": your bank needs you to confirm it" : ""}.${invoice.nextAttemptAt ? ` We'll try again on ${formatOrderDate(invoice.nextAttemptAt, locale)}.` : ""}`
      : `Invoice ${invoice.number} for ${amount} is waiting to be paid.`
    : `Your card expired in ${formatCardMonth(expired!)}. Add a new one before your next payment.`;
  const pay = status === "due" || (invoice?.failure === "authentication_required");
  return (
    <div
      role="alert"
      className={cn("flex flex-col gap-3 border border-red-200 bg-red-50 px-4 py-3 @xl:flex-row @xl:items-center @xl:justify-between", innerRadiusClass(props))}
    >
      <p className="flex items-start gap-2.5 font-inter text-sm text-red-900">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-red-600" />
        {message}
      </p>
      <Btn props={props} variant="primary" className="shrink-0 bg-red-700 hover:bg-red-700/90" onClick={() => onFix(pay ? "pay" : "card")}>
        {pay ? "Pay now" : "Update card"}
      </Btn>
    </div>
  );
}

/** One invoice, as Stripe's hosted invoice page shows it, in a dialog. */
export function InvoiceDialog({
  invoice,
  method,
  props,
  onClose,
  onOpenUrl,
}: {
  invoice: Invoice | null;
  method: PaymentMethod | null;
  props: Design;
  onClose: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const locale = useLocale();
  if (!invoice) return null;
  const status = invoiceDisplayStatus(invoice);
  const m = (cents: number) => money(cents, invoice.currency, locale);
  const net = invoice.lines.reduce((sum, line) => sum + line.amountCents, 0);
  const open = status === "due" || status === "payment_failed";
  return (
    <Modal open onClose={onClose} title={`Invoice ${invoice.number}`} size="lg" themeVars={designVars(props)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-3xl font-bold tabular-nums text-foreground">{m(invoiceTotalCents(invoice))}</p>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            {invoice.paidAt
              ? `Paid ${formatLongDate(invoice.paidAt, locale)}${method ? ` with ${cardShort(method)}` : ""}`
              : `Issued ${formatLongDate(invoice.createdAt, locale)}`}
          </p>
        </div>
        <Status status={status} props={props} />
      </div>
      <dl className="mt-6 space-y-2 border-t border-border pt-5 font-inter text-sm">
        {invoice.lines.map((line, i) => (
          <div key={i} className="flex justify-between gap-4">
            <dt className="text-foreground">
              {lineLabel(line)}
              {line.kind === "plan" && (
                <span className="block text-xs text-muted-foreground">
                  {formatOrderDate(invoice.periodStart, locale)} to {formatOrderDate(invoice.periodEnd, locale)}
                </span>
              )}
            </dt>
            <dd className="tabular-nums text-foreground">{m(line.amountCents)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-border pt-2 text-muted-foreground">
          <dt>Subtotal</dt>
          <dd className="tabular-nums">{m(net)}</dd>
        </div>
        <div className="flex justify-between gap-4 text-muted-foreground">
          <dt>{invoice.tax.kind === "vat" ? `VAT (${invoice.tax.ratePct}%)` : invoice.tax.kind === "reverse_charge" ? "VAT (reverse charge)" : "Tax"}</dt>
          <dd className="tabular-nums">{m(invoice.taxCents)}</dd>
        </div>
        <div className="flex justify-between gap-4 font-semibold text-foreground">
          <dt>Total</dt>
          <dd className="tabular-nums">{m(invoiceTotalCents(invoice))}</dd>
        </div>
        {invoice.refundedCents > 0 && (
          <div className="flex justify-between gap-4 text-muted-foreground">
            <dt>Refunded</dt>
            <dd className="tabular-nums">−{m(invoice.refundedCents)}</dd>
          </div>
        )}
      </dl>
      <ModalActions className="mt-6">
        <Btn props={props} onClick={() => onOpenUrl(invoice.pdfUrl)}>
          Download PDF
        </Btn>
        {open ? (
          <Btn props={props} variant="primary" onClick={() => onOpenUrl(invoice.hostedUrl)}>
            Pay now
          </Btn>
        ) : (
          <Btn props={props} variant="primary" onClick={() => onOpenUrl(invoice.hostedUrl)}>
            View receipt
          </Btn>
        )}
      </ModalActions>
    </Modal>
  );
}
