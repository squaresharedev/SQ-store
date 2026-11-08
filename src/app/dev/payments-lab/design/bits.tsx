"use client";

import { useLocale } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { formatCents } from "@/lib/format/money";
import { dateTimeFormat, intlTag } from "@/lib/format/intl";
import type { PayoutStatus } from "@/lib/payments/types";
import { cn } from "@/lib/utils";

// Small pieces every design in the payments lab shares: an amount with its
// cents set back, a payout status, short dates. Prototype code: anything that
// wins moves to lib/format and components/payments as tokens before shipping.

const CENTS = /([.,]\d{2})(\D*)$/;

/** An amount in three parts, so the cents can be set back: "€462" ".95" "". */
export function moneyParts(cents: number, currency: string, locale: Locale) {
  const text = formatCents(cents, currency, locale);
  const match = CENTS.exec(text);
  if (!match) return { main: text, cents: "", tail: "" };
  return { main: text.slice(0, match.index), cents: match[1], tail: match[2] };
}

/**
 * An amount. `cents="muted"` sets the cents back a size and a shade, the way
 * banking apps print a balance; `sign` puts a + on money in.
 */
export function Money({
  cents,
  currency = "EUR",
  centsStyle = "muted",
  sign = false,
  className,
  centsClassName,
}: {
  cents: number;
  currency?: string;
  /** muted: smaller and lighter, raised (a headline); soft: lighter only (a row); inline: as written. */
  centsStyle?: "muted" | "soft" | "inline";
  sign?: boolean;
  className?: string;
  centsClassName?: string;
}) {
  const locale = useLocale();
  const parts = moneyParts(cents === 0 ? 0 : cents, currency, locale);
  return (
    <span className={cn("tabular-nums", className)}>
      {sign && cents > 0 ? "+" : ""}
      {parts.main}
      <span className={cn(centsStyle === "muted" && "text-[0.6em] align-[0.42em] opacity-55", centsStyle === "soft" && "opacity-50", centsClassName)}>
        {parts.cents}
      </span>
      {parts.tail}
    </span>
  );
}

/** "7 Nov". */
export function shortDate(iso: string, locale: Locale): string {
  return dateTimeFormat(intlTag(locale, "en-IE"), { day: "numeric", month: "short" }).format(new Date(iso));
}

/** "Saturday". */
export function weekday(iso: string, locale: Locale): string {
  return dateTimeFormat(intlTag(locale, "en-IE"), { weekday: "long" }).format(new Date(iso));
}

/** "16:00". */
export function clock(iso: string, locale: Locale): string {
  return dateTimeFormat(intlTag(locale, "en-IE"), { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Days from today to `iso`, whole: 0 today, 1 tomorrow. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((day(new Date(iso)) - day(now)) / 86_400_000);
}

/** Each payout status's hue: one colour per state, the way payment dashboards code them. */
export const STATUS_TONE: Record<PayoutStatus, { dot: string; text: string; pill: string; label: string }> = {
  paid: { dot: "bg-emerald-500", text: "text-emerald-700", pill: "bg-emerald-50 text-emerald-700 ring-emerald-600/15", label: "Paid" },
  in_transit: { dot: "bg-sky-500", text: "text-sky-700", pill: "bg-sky-50 text-sky-700 ring-sky-600/15", label: "On its way" },
  pending: { dot: "bg-amber-500", text: "text-amber-700", pill: "bg-amber-50 text-amber-800 ring-amber-600/20", label: "Pending" },
  failed: { dot: "bg-red-500", text: "text-red-700", pill: "bg-red-50 text-red-700 ring-red-600/15", label: "Failed" },
  canceled: { dot: "bg-neutral-400", text: "text-neutral-500", pill: "bg-neutral-100 text-neutral-600 ring-neutral-500/15", label: "Canceled" },
};

/** A payout's status as a tinted pill or a coloured dot with its word. */
export function StatusMark({ status, variant }: { status: PayoutStatus; variant: "pill" | "dot" | "mono" }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.pending;
  if (variant === "pill") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-inter text-xs font-medium ring-1 ring-inset", tone.pill)}>
        <span className={cn("size-1.5 rounded-full", tone.dot)} aria-hidden />
        {tone.label}
      </span>
    );
  }
  if (variant === "dot") {
    return (
      <span className="inline-flex items-center gap-1.5 font-inter text-xs font-medium text-foreground">
        <span className={cn("size-2 rounded-full", tone.dot)} aria-hidden />
        {tone.label}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center rounded-full bg-secondary px-2 py-0.5 font-inter text-xs font-medium", status === "failed" ? "text-danger-strong" : status === "paid" ? "text-success" : "text-foreground")}>
      {tone.label}
    </span>
  );
}

/** A percentage change as a small up/down chip; null when there is nothing to compare with. */
export function DeltaChip({ now, before, invert = false, className }: { now: number; before: number; /** Down is good (refunds, fees). */ invert?: boolean; className?: string }) {
  if (before <= 0) return null;
  const change = (now - before) / before;
  const up = change >= 0;
  const good = invert ? !up : up;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 font-inter text-xs font-semibold tabular-nums",
        good ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
        className,
      )}
    >
      {up ? "▲" : "▼"} {Math.abs(Math.round(change * 100))}%
    </span>
  );
}
