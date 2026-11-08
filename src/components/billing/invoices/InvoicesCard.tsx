"use client";

import * as React from "react";
import { Download, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Modal, ModalActions } from "@/components/ui/modal";
import {
  dangerNoticeClass,
  destructiveButtonClass,
  helpTextClass,
  infoTextClass,
  inlineLinkClass,
} from "@/components/ui/control-styles";
import { eyebrowClass, skeletonClass, squareTagClass } from "@/components/ui/surface-styles";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { usePortalForm } from "@/components/billing/PortalButton";
import { SERVER_BILLING_ACTIONS, navigateOf, type BillingActions } from "@/components/billing/billing-actions";
import { cn } from "@/lib/utils";
import { countryName } from "@/lib/format/country";
import { formatLongDate, formatOrderDate } from "@/lib/format/date";
import { formatCents } from "@/lib/format/money";
import { formatFeeRate } from "@/lib/billing/format";
import {
  INVOICES_PAGE_SIZE,
  cardExpiryState,
  formatCardMonth,
  invoiceDisplayStatus,
  invoiceTotalCents,
  listedInvoices,
  outstandingInvoice,
  type BillingDetails,
  type Invoice,
  type InvoiceDisplayStatus,
  type InvoiceLine,
  type InvoicesData,
  type PaymentMethod,
} from "@/lib/billing/invoices";
import type { PricingContext } from "@/lib/billing/pricing-context";

/** Stripe's pages are not ours: a new tab, so the settings page stays where it is. */
export const openInNewTab = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

/** The one Customer Portal form every "Update" in the card submits (`form=`). */
const PORTAL_FORM_ID = "billing-invoices-portal";

/** The card's brand as a small bordered chip, in words: no card network artwork. */
const CARD_CHIP_CLASS =
  "flex h-7 w-11 shrink-0 items-center justify-center rounded-sm border border-border bg-background font-inter text-2xs font-black italic tracking-wider text-foreground";

const BRAND_CHIP: Record<PaymentMethod["brand"], string> = { visa: "VISA", mastercard: "MC", amex: "AMEX", other: "CARD" };

/** Each status's tint on squareTagClass: loud only for what needs the owner. */
const STATUS_TONE: Record<InvoiceDisplayStatus, string> = {
  paid: "bg-success/10 text-success ring-success/20",
  partially_refunded: "bg-secondary text-muted-foreground ring-border",
  refunded: "bg-secondary text-muted-foreground ring-border",
  due: "bg-amber-50 text-amber-900 ring-amber-200",
  payment_failed: "bg-destructive/5 text-danger-strong ring-destructive/30",
  void: "bg-secondary text-muted-foreground ring-border",
  uncollectible: "bg-secondary text-muted-foreground ring-border",
};

/** A section's rule and spacing: the first one sits straight under the card's title. */
const SECTION_CLASS = "space-y-3 border-t border-border pt-5 first:border-t-0 first:pt-0";

function StatusTag({ status }: { status: InvoiceDisplayStatus }) {
  const t = useTranslations("Billing.invoices.status");
  return <span className={cn(squareTagClass, STATUS_TONE[status])}>{t(status)}</span>;
}

/** What an invoice was for, in a few words: its plan, or the plan it moved to. */
function useDescribe() {
  const t = useTranslations("Billing");
  return (invoice: Invoice) => {
    const main = invoice.lines.find((line) => line.kind === "plan");
    if (main) return t("invoices.list.describe", { plan: t(`plans.${main.plan}.name`), interval: main.interval });
    const charge = invoice.lines.find((line) => line.amountCents > 0) ?? invoice.lines[0];
    return charge ? t("invoices.list.change", { plan: t(`plans.${charge.plan}.name`) }) : "";
  };
}

/**
 * Settings › Billing & invoices, after Stripe's customer portal: the card on
 * file, who invoices go to, and the invoice history by year, each section with
 * its own way in. A red line above them appears only while something waits on
 * the owner (a failed payment, an invoice to pay, a card that expired). A row
 * opens the invoice in full; its arrow downloads the PDF.
 *
 * Every "Update" submits ONE Customer Portal form (usePortalForm), so the
 * two-factor code is asked for in one place, at the top of the card. Card,
 * address and VAT ID are changed on Stripe's page, never here.
 *
 * `data` is what Stripe answered (lib/billing/invoices.ts): drawn while it is
 * asked for, when it fails, and when it is there. A store with no billing
 * account never asks: it gets the sentence it always had.
 */
export function InvoicesCard({
  context,
  data,
  actions = SERVER_BILLING_ACTIONS,
  openLink = openInNewTab,
  onRetry,
  now,
}: {
  context: PricingContext;
  data: InvoicesData;
  actions?: BillingActions;
  /** Opens an invoice's page or PDF. A stand-in on /dev/invoices. */
  openLink?: (url: string) => void;
  onRetry?: () => void;
  /** What "expired" is measured against. Defaults to the moment of render. */
  now?: Date;
}) {
  const t = useTranslations("Billing");
  const hasAccount = context.hasBillingAccount && context.available;

  return (
    <SettingsCard id="invoices" title={t("settings.invoicesTitle")} description={t("invoices.description")}>
      <div className="@container" data-invoices-card={hasAccount ? data.state : "none"}>
        {!hasAccount ? (
          <p className={helpTextClass}>
            {context.grant ? t("invoices.granted") : context.available ? t("settings.noBilling") : t("settings.noBillingYet")}
          </p>
        ) : data.state === "loading" ? (
          <div role="status" aria-label={t("invoices.loading")} className="space-y-3">
            {[0, 1, 2, 3].map((line) => (
              <span key={line} className={cn(skeletonClass, "block h-5", line % 2 ? "w-2/3" : "w-full")} />
            ))}
          </div>
        ) : data.state === "error" ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className={helpTextClass}>{t("invoices.loadError")}</p>
            {onRetry && (
              <Button variant="secondary" onClick={onRetry}>
                {t("invoices.retry")}
              </Button>
            )}
          </div>
        ) : (
          <InvoicesBody details={data.details} actions={actions} openLink={openLink} now={now ?? new Date()} />
        )}
      </div>
    </SettingsCard>
  );
}

function InvoicesBody({
  details,
  actions,
  openLink,
  now,
}: {
  details: BillingDetails;
  actions: BillingActions;
  openLink: (url: string) => void;
  now: Date;
}) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  const { paymentMethod, profile } = details;
  const invoices = React.useMemo(() => listedInvoices(details.invoices), [details.invoices]);
  const outstanding = outstandingInvoice(invoices);
  const expiry = paymentMethod ? cardExpiryState(paymentMethod, now) : null;
  const [selected, setSelected] = React.useState<Invoice | null>(null);
  // Which "Update" was pressed, so only that one says it is opening Stripe.
  const [pressed, setPressed] = React.useState<string | null>(null);
  const portal = usePortalForm({
    id: PORTAL_FORM_ID,
    target: { flow: "manage" },
    source: "settings",
    action: actions.openPortal,
    navigate: navigateOf(actions),
  });

  /** A submit button for the portal form, from anywhere in the card. */
  const portalTrigger = (key: string, label: string, className: string) => (
    <button
      type="submit"
      form={PORTAL_FORM_ID}
      disabled={portal.leaving}
      onClick={() => setPressed(key)}
      className={cn(className, "disabled:opacity-60")}
    >
      {portal.leaving && pressed === key ? t("portal.opening") : label}
    </button>
  );
  const linkClass = cn(inlineLinkClass, "shrink-0 font-inter text-sm");
  const place = [...profile.addressLines, countryName(profile.country, locale) ?? profile.country].filter(Boolean);

  return (
    <div className="space-y-5">
      {/* Shown only while it holds something: the two-factor box, or what went wrong. */}
      <form
        id={PORTAL_FORM_ID}
        action={portal.action}
        noValidate
        className="hidden flex-col gap-3 has-[[data-step-up-field]]:flex has-[[role=alert]]:flex"
      >
        {portal.fields}
      </form>

      {(outstanding || expiry === "expired") && (
        <Attention
          invoice={outstanding}
          expiredMonth={paymentMethod ? formatCardMonth(paymentMethod) : ""}
          action={
            outstanding && invoiceDisplayStatus(outstanding) === "due" ? (
              <Button variant="destructive" className="w-full" onClick={() => openLink(outstanding.hostedUrl)}>
                {t("invoices.attention.pay")}
              </Button>
            ) : (
              portalTrigger("attention", t("invoices.attention.updateCard"), cn(destructiveButtonClass, "w-full"))
            )
          }
        />
      )}

      <div className="space-y-5">
        <section className={SECTION_CLASS} data-invoices-section="card">
          <h3 className={eyebrowClass}>{t("invoices.sections.card")}</h3>
          <div className="flex items-center justify-between gap-4">
            {paymentMethod ? (
              <div className="flex min-w-0 items-center gap-3">
                <span aria-hidden className={CARD_CHIP_CLASS}>
                  {BRAND_CHIP[paymentMethod.brand]}
                </span>
                <div className="min-w-0 font-inter text-sm">
                  <p className="font-medium text-foreground">
                    {t("invoices.card.line", { brand: t(`invoices.brands.${paymentMethod.brand}`), last4: paymentMethod.last4 })}
                  </p>
                  <p
                    className={cn(
                      "text-xs",
                      expiry === "expired" ? "font-medium text-danger-strong" : expiry === "expiring" ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {t(expiry === "expired" ? "invoices.card.expired" : expiry === "expiring" ? "invoices.card.expiring" : "invoices.card.expires", {
                      month: formatCardMonth(paymentMethod),
                    })}
                  </p>
                </div>
              </div>
            ) : (
              <p className={helpTextClass}>{t("invoices.card.none")}</p>
            )}
            {portalTrigger("card", paymentMethod ? t("invoices.update") : t("invoices.addCard"), linkClass)}
          </div>
        </section>

        <section className={SECTION_CLASS} data-invoices-section="billing">
          <h3 className={eyebrowClass}>{t("invoices.sections.billing")}</h3>
          <div className="flex items-start justify-between gap-4">
            {profile.name || place.length ? (
              <div className="min-w-0 font-inter text-sm">
                <p className="font-medium text-foreground">{profile.name ?? profile.email}</p>
                {place.map((line) => (
                  <p key={line} className="text-muted-foreground">
                    {line}
                  </p>
                ))}
                <p className="text-muted-foreground">
                  {profile.vatId ? t("invoices.billing.vatId", { id: profile.vatId }) : t("invoices.billing.vatNone")}
                </p>
                {profile.name && profile.email && <p className="break-all text-muted-foreground">{profile.email}</p>}
              </div>
            ) : (
              <p className={helpTextClass}>{t("invoices.billing.none")}</p>
            )}
            {portalTrigger("billing", t("invoices.update"), linkClass)}
          </div>
        </section>

        <section className={SECTION_CLASS} data-invoices-section="history">
          <h3 className={eyebrowClass}>{t("invoices.sections.history")}</h3>
          {invoices.length ? (
            <InvoiceHistory invoices={invoices} onOpen={setSelected} onDownload={(invoice) => openLink(invoice.pdfUrl)} />
          ) : (
            <p className={helpTextClass}>{t("invoices.list.empty")}</p>
          )}
        </section>
      </div>

      <InvoiceDialog invoice={selected} method={paymentMethod} onClose={() => setSelected(null)} openLink={openLink} />
    </div>
  );
}

/** The one red line above everything: what is wrong, and the button that fixes it. */
function Attention({ invoice, expiredMonth, action }: { invoice: Invoice | null; expiredMonth: string; action: React.ReactNode }) {
  const t = useTranslations("Billing.invoices");
  const locale = useLocale();
  const status = invoice ? invoiceDisplayStatus(invoice) : null;
  const amount = invoice ? formatCents(invoiceTotalCents(invoice), invoice.currency, locale) : "";
  const message = !invoice
    ? t("attention.cardExpired", { month: expiredMonth })
    : status === "payment_failed"
      ? t("attention.payment_failed", {
          amount,
          date: formatOrderDate(invoice.createdAt, locale),
          reason: [
            invoice.failure ? t(`failure.${invoice.failure}`) : "",
            invoice.nextAttemptAt ? t("retryOn", { date: formatOrderDate(invoice.nextAttemptAt, locale) }) : "",
          ]
            .filter(Boolean)
            .join(" "),
        }).trim()
      : t("attention.due", { number: invoice.number, amount });
  return (
    <div role="alert" data-invoices-attention={status ?? "card_expired"} className={cn(dangerNoticeClass, "flex-col @xl:flex-row @xl:items-center")}>
      <p className="flex min-w-0 flex-1 items-start gap-2.5 font-inter text-sm text-foreground">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        {message}
      </p>
      <div className="w-full shrink-0 @xl:w-40">{action}</div>
    </div>
  );
}

/** The invoices by year, newest first, a page at a time. A row opens the invoice; its arrow takes the PDF. */
function InvoiceHistory({
  invoices,
  onOpen,
  onDownload,
}: {
  invoices: Invoice[];
  onOpen: (invoice: Invoice) => void;
  onDownload: (invoice: Invoice) => void;
}) {
  const t = useTranslations("Billing.invoices.list");
  const locale = useLocale();
  const describe = useDescribe();
  const [shown, setShown] = React.useState(INVOICES_PAGE_SIZE);
  const visible = invoices.slice(0, shown);
  const yearOf = (invoice: Invoice) => new Date(invoice.createdAt).getUTCFullYear();

  return (
    <div>
      <table aria-label={t("label")} className="w-full border-collapse font-inter text-sm" data-invoices-list>
        <tbody>
          {visible.flatMap((invoice, i) => {
            const status = invoiceDisplayStatus(invoice);
            const year = yearOf(invoice);
            const rows: React.ReactNode[] = [];
            if (i === 0 || yearOf(visible[i - 1]!) !== year) {
              rows.push(
                <tr key={`year-${year}`} className="border-b border-border">
                  <th colSpan={5} scope="colgroup" className="pb-1.5 pt-3 text-left text-xs font-semibold tracking-wide text-foreground">
                    {year}
                  </th>
                </tr>,
              );
            }
            rows.push(
              <tr
                key={invoice.id}
                data-invoice-row={invoice.number}
                data-invoice-status={status}
                tabIndex={0}
                aria-label={t("openRow", { number: invoice.number })}
                onClick={() => onOpen(invoice)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(invoice);
                  }
                }}
                className="cursor-pointer border-b border-border transition-colors duration-base ease-standard last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none motion-reduce:transition-none"
              >
                <td className="whitespace-nowrap py-3.5 pr-3 text-foreground">
                  {formatOrderDate(invoice.createdAt, locale)}
                  {/* On a phone the description rides under the date. */}
                  <span className={cn(infoTextClass, "block @xl:hidden")}>{describe(invoice)}</span>
                </td>
                <td className="hidden px-3 py-3.5 text-muted-foreground @xl:table-cell">{describe(invoice)}</td>
                <td className="whitespace-nowrap px-3 py-3.5 text-right font-medium tabular-nums text-foreground">
                  {formatCents(invoiceTotalCents(invoice), invoice.currency, locale)}
                  {/* On a phone the status rides under the amount. */}
                  <span className="mt-1 block @xl:hidden">
                    <StatusTag status={status} />
                  </span>
                </td>
                <td className="hidden px-3 py-3.5 @xl:table-cell">
                  <StatusTag status={status} />
                </td>
                <td className="w-px py-3.5 pl-3 text-right">
                  <button
                    type="button"
                    aria-label={t("download", { number: invoice.number })}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDownload(invoice);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    className="inline-flex size-8 items-center justify-center text-muted-foreground transition-colors duration-base ease-standard hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Download aria-hidden className="size-4" strokeWidth={2} />
                  </button>
                </td>
              </tr>,
            );
            return rows;
          })}
        </tbody>
      </table>
      {invoices.length > visible.length && (
        <Button variant="ghost" className="mt-2 w-full" onClick={() => setShown(invoices.length)}>
          {t("showAll", { count: invoices.length })}
        </Button>
      )}
    </div>
  );
}

/** One invoice in full, as Stripe's invoice page shows it: the total, how it was paid, its lines, and the PDF. */
function InvoiceDialog({
  invoice,
  method,
  onClose,
  openLink,
}: {
  invoice: Invoice | null;
  method: PaymentMethod | null;
  onClose: () => void;
  openLink: (url: string) => void;
}) {
  const t = useTranslations("Billing");
  const locale = useLocale();
  if (!invoice) return null;
  const status = invoiceDisplayStatus(invoice);
  const money = (cents: number) => formatCents(cents, invoice.currency, locale);
  const net = invoice.lines.reduce((sum, line) => sum + line.amountCents, 0);
  const open = status === "due" || status === "payment_failed";
  const plan = (line: InvoiceLine) => t(`plans.${line.plan}.name`);
  const lineLabel = (line: InvoiceLine) =>
    line.kind === "plan"
      ? t("invoices.dialog.plan", { plan: plan(line), interval: line.interval })
      : t(line.amountCents < 0 ? "invoices.dialog.unused" : "invoices.dialog.remaining", { plan: plan(line) });
  const taxLabel =
    invoice.tax.kind === "vat"
      ? t("invoices.dialog.vat", { rate: formatFeeRate(invoice.tax.ratePct * 100, locale) })
      : invoice.tax.kind === "reverse_charge"
        ? t("invoices.dialog.reverseCharge")
        : t("invoices.dialog.tax");
  const row = "flex justify-between gap-4";

  return (
    <Modal open onClose={onClose} title={t("invoices.dialog.title", { number: invoice.number })} size="lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-3xl font-bold tabular-nums text-foreground">{money(invoiceTotalCents(invoice))}</p>
          <p className={cn(helpTextClass, "mt-1")}>
            {invoice.paidAt
              ? method
                ? t("invoices.dialog.paidWith", {
                    date: formatLongDate(invoice.paidAt, locale),
                    card: t("invoices.card.line", { brand: t(`invoices.brands.${method.brand}`), last4: method.last4 }),
                  })
                : t("invoices.dialog.paid", { date: formatLongDate(invoice.paidAt, locale) })
              : t("invoices.dialog.issued", { date: formatLongDate(invoice.createdAt, locale) })}
          </p>
        </div>
        <StatusTag status={status} />
      </div>

      <dl className="mt-6 space-y-2 border-t border-border pt-5 font-inter text-sm">
        {invoice.lines.map((line, i) => (
          <div key={i} className={row}>
            <dt className="text-foreground">
              {lineLabel(line)}
              {line.kind === "plan" && (
                <span className={cn(infoTextClass, "block")}>
                  {t("invoices.dialog.period", {
                    start: formatOrderDate(invoice.periodStart, locale),
                    end: formatOrderDate(invoice.periodEnd, locale),
                  })}
                </span>
              )}
            </dt>
            <dd className="tabular-nums text-foreground">{money(line.amountCents)}</dd>
          </div>
        ))}
        <div className={cn(row, "border-t border-border pt-2 text-muted-foreground")}>
          <dt>{t("invoices.dialog.subtotal")}</dt>
          <dd className="tabular-nums">{money(net)}</dd>
        </div>
        <div className={cn(row, "text-muted-foreground")}>
          <dt>{taxLabel}</dt>
          <dd className="tabular-nums">{money(invoice.taxCents)}</dd>
        </div>
        <div className={cn(row, "font-semibold text-foreground")}>
          <dt>{t("invoices.dialog.total")}</dt>
          <dd className="tabular-nums">{money(invoiceTotalCents(invoice))}</dd>
        </div>
        {invoice.refundedCents > 0 && (
          <div className={cn(row, "text-muted-foreground")}>
            <dt>{t("invoices.dialog.refunded")}</dt>
            <dd className="tabular-nums">{money(-invoice.refundedCents)}</dd>
          </div>
        )}
      </dl>

      <ModalActions className="mt-6">
        <Button variant="secondary" onClick={() => openLink(invoice.pdfUrl)}>
          {t("invoices.dialog.download")}
        </Button>
        <Button onClick={() => openLink(invoice.hostedUrl)}>{open ? t("invoices.dialog.pay") : t("invoices.dialog.receipt")}</Button>
      </ModalActions>
    </Modal>
  );
}
