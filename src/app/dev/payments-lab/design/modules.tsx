"use client";

import { ArrowDownLeft, ArrowUpRight, CalendarClock, Landmark, ReceiptText, Undo2 } from "lucide-react";
import { useLocale } from "next-intl";
import { useState, type ReactNode } from "react";
import type { Locale } from "@/i18n/locales";
import type { BalanceTransaction, Payout, PayoutMethod, TransactionType } from "@/lib/payments/types";
import { cn } from "@/lib/utils";
import { labPhoto, splitDescription } from "../fixtures";
import type { PaymentsDesignProps } from "../lab-model";
import { clock, daysUntil, DeltaChip, Money, shortDate, StatusMark, weekday } from "./bits";
import { ScrubChart } from "./ScrubChart";
import { cardClass, figureClass, innerRadiusClass, isDark, isInk } from "./theme";

/** How many activity rows show before "Show all". */
const ACTIVITY_ROWS = 7;

/** A row's amounts set their cents back by colour only: a raised cent reads as a footnote at this size. */
const rowCents = (design: PaymentsDesignProps) => (design.cents === "muted" ? "soft" : "inline");

type P = { design: PaymentsDesignProps };

/** A card's heading row: title on the left, anything on the right. */
export function CardHead({ title, right, className }: { title: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {right}
    </div>
  );
}

/** The small uppercase name over a figure. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("font-inter text-[11px] font-medium uppercase tracking-[0.08em] opacity-60", className)}>{children}</p>;
}

/** 7D / 30D / 90D as a pill group. */
export function RangeTabs({
  value,
  onChange,
  onDark = false,
  design,
}: {
  value: number;
  onChange: (range: 7 | 30 | 90) => void;
  onDark?: boolean;
} & P) {
  return (
    <div className={cn("inline-flex gap-0.5 p-0.5", design.radius === "sharp" ? "rounded-none" : "rounded-full", onDark ? "bg-white/10" : "bg-black/[0.05]")}>
      {([7, 30, 90] as const).map((range) => (
        <button
          key={range}
          type="button"
          onClick={() => onChange(range)}
          aria-pressed={value === range}
          className={cn(
            "px-2.5 py-1 font-inter text-xs font-medium transition-colors duration-base",
            design.radius === "sharp" ? "rounded-none" : "rounded-full",
            value === range
              ? onDark
                ? "bg-white text-card-base"
                : "bg-card text-foreground shadow-sm"
              : onDark
                ? "text-white/70 hover:text-white"
                : "text-muted-foreground hover:text-foreground",
          )}
        >
          {range}D
        </button>
      ))}
    </div>
  );
}

const TYPE_ICON: Record<TransactionType, typeof ArrowDownLeft> = {
  charge: ArrowDownLeft,
  refund: Undo2,
  payout: ArrowUpRight,
  stripe_fee: ReceiptText,
  adjustment: ReceiptText,
};

const TYPE_TONE: Record<TransactionType, string> = {
  charge: "bg-emerald-50 text-emerald-600",
  refund: "bg-amber-50 text-amber-600",
  payout: "bg-[var(--lab-accent-soft)] text-[var(--lab-accent)]",
  stripe_fee: "bg-muted text-muted-foreground",
  adjustment: "bg-muted text-muted-foreground",
};

const INITIAL_TONES = [
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-800",
  "bg-emerald-100 text-emerald-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-teal-100 text-teal-700",
];

function initialsOf(name: string) {
  const words = name.replace(/['"(),]/g, "").split(/\s+/).filter(Boolean);
  return (words[0]?.[0] ?? "?").toUpperCase() + (words[1]?.[0] ?? "").toUpperCase();
}

/** What leads an activity row: the product's photo, a type icon, or initials. */
export function Avatar({ transaction, design, size = 36 }: { transaction: BalanceTransaction; size?: number } & P) {
  const { name } = splitDescription(transaction.description);
  const Icon = TYPE_ICON[transaction.type] ?? ReceiptText;
  const round = design.radius === "sharp" ? "rounded-none" : design.avatars === "photo" ? innerRadiusClass(design) : "rounded-full";
  const product = transaction.type === "charge" || transaction.type === "refund";
  const style = { width: size, height: size };
  if (design.avatars === "photo" && product) {
    return (
      <span className="relative shrink-0" style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element -- lab stand-in photo */}
        <img src={labPhoto(name)} alt="" className={cn("size-full bg-muted object-cover ring-1 ring-black/5", round)} />
        {transaction.type === "refund" && (
          <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-amber-500 text-white ring-2 ring-card">
            <Undo2 className="size-2.5" strokeWidth={3} aria-hidden />
          </span>
        )}
      </span>
    );
  }
  if (design.avatars === "initials" && product) {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return (
      <span className={cn("flex shrink-0 items-center justify-center font-inter text-xs font-semibold", round, INITIAL_TONES[hash % INITIAL_TONES.length])} style={style}>
        {initialsOf(name)}
      </span>
    );
  }
  return (
    <span className={cn("flex shrink-0 items-center justify-center", design.avatars === "photo" ? innerRadiusClass(design) : round, TYPE_TONE[transaction.type])} style={style}>
      {transaction.type === "payout" ? <Landmark className="size-4" strokeWidth={2} aria-hidden /> : <Icon className="size-4" strokeWidth={2} aria-hidden />}
    </span>
  );
}

const KIND_LABEL: Record<TransactionType, string> = {
  charge: "Sale",
  refund: "Refund",
  payout: "Payout",
  stripe_fee: "Fee",
  adjustment: "Adjustment",
};

function dayLabel(iso: string, locale: Locale) {
  const ago = -daysUntil(iso);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  return `${weekday(iso, locale).slice(0, 3)}, ${shortDate(iso, locale)}`;
}

function AmountCell({ transaction, design }: { transaction: BalanceTransaction } & P) {
  const positive = transaction.amountCents > 0;
  return (
    <Money
      cents={transaction.amountCents}
      currency={transaction.currency}
      sign
      centsStyle={rowCents(design)}
      className={cn("shrink-0 text-sm font-semibold", positive ? "text-emerald-600" : "text-foreground")}
    />
  );
}

function PendingTag() {
  return <span className="rounded-full bg-amber-50 px-1.5 py-px font-inter text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-600/15">Clearing</span>;
}

/** Recent activity, grouped under a light heading per day or as a table with a date column. */
export function ActivityFeed({
  transactions,
  design,
  onSelect,
  title = "Activity",
  filters = false,
  className,
}: {
  transactions: BalanceTransaction[];
  onSelect: (transaction: BalanceTransaction) => void;
  title?: string;
  /** Chips over the list (All, Sales, Payouts, Refunds) that filter it. */
  filters?: boolean;
  className?: string;
} & P) {
  const locale = useLocale();
  const [filter, setFilter] = useState<"all" | "charge" | "payout" | "refund">("all");
  const [all, setAll] = useState(false);
  const matching = transactions.filter((txn) => filter === "all" || txn.type === filter);
  const shown = all ? matching : matching.slice(0, ACTIVITY_ROWS);
  const chips = filters && (
    <div className="flex gap-1">
      {(["all", "charge", "payout", "refund"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={filter === value}
          onClick={() => setFilter(value)}
          className={cn(
            "px-2.5 py-1 font-inter text-xs font-medium transition-colors duration-base",
            design.radius === "sharp" ? "rounded-none" : "rounded-full",
            filter === value ? "bg-foreground text-background" : "text-muted-foreground hover:bg-black/5 hover:text-foreground",
          )}
        >
          {value === "all" ? "All" : value === "charge" ? "Sales" : value === "payout" ? "Payouts" : "Refunds"}
        </button>
      ))}
    </div>
  );

  const row = (txn: BalanceTransaction, withDate: boolean) => {
    const { kind, name } = splitDescription(txn.description);
    const label = txn.type === "payout" ? "To your bank" : name;
    return (
      <li key={txn.id}>
        <button
          type="button"
          onClick={() => onSelect(txn)}
          className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors duration-base hover:bg-black/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {withDate && (
            <span className="hidden w-16 shrink-0 font-inter text-xs text-muted-foreground tabular-nums @2xl:block">{shortDate(txn.createdAt, locale)}</span>
          )}
          <Avatar transaction={txn} design={design} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{label}</span>
            <span className="flex items-center gap-1.5 font-inter text-xs text-muted-foreground">
              {KIND_LABEL[txn.type] ?? kind} · {clock(txn.createdAt, locale)}
              {txn.status === "pending" && <PendingTag />}
            </span>
          </span>
          <AmountCell transaction={txn} design={design} />
        </button>
      </li>
    );
  };

  let body: ReactNode;
  if (shown.length === 0) {
    body = <p className="px-5 py-10 text-center font-inter text-sm text-muted-foreground">Nothing here yet. Your first sale shows up the moment it is paid.</p>;
  } else if (design.rows === "dated") {
    body = <ul className="divide-y divide-border/70">{shown.map((txn) => row(txn, true))}</ul>;
  } else {
    const groups: { day: string; rows: BalanceTransaction[]; net: number }[] = [];
    for (const txn of shown) {
      const day = dayLabel(txn.createdAt, locale);
      const last = groups[groups.length - 1];
      if (last?.day === day) {
        last.rows.push(txn);
        last.net += txn.amountCents;
      } else groups.push({ day, rows: [txn], net: txn.amountCents });
    }
    body = (
      <div className="pb-2">
        {groups.map((group) => (
          <section key={group.day}>
            <div className="flex items-baseline justify-between px-5 pt-3 pb-1">
              <h3 className="font-inter text-xs font-medium text-muted-foreground">{group.day}</h3>
              <Money cents={group.net} sign centsStyle="inline" className="font-inter text-xs text-muted-foreground" />
            </div>
            <ul>{group.rows.map((txn) => row(txn, false))}</ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <section aria-label={title} className={cn(cardClass(design), "overflow-hidden", className)}>
      <CardHead title={title} right={chips} className={design.rows === "dated" ? "border-b border-border/70" : undefined} />
      {body}
      {matching.length > ACTIVITY_ROWS && (
        <button type="button" onClick={() => setAll((on) => !on)} className="w-full border-t border-border/70 px-5 py-3 text-center font-inter text-xs font-medium text-muted-foreground transition-colors duration-base hover:bg-black/[0.025] hover:text-foreground">
          {all ? "Show less" : `Show all ${matching.length}`}
        </button>
      )}
    </section>
  );
}

/** The payouts: the next one first, then every past one with its status. */
export function PayoutList({
  payouts,
  upcoming,
  method,
  design,
  onSelect,
  className,
}: {
  payouts: Payout[];
  upcoming: { amountCents: number; currency: string; expectedAt: string } | null;
  method: PayoutMethod | null;
  onSelect: (payout: Payout) => void;
  className?: string;
} & P) {
  const locale = useLocale();
  return (
    <section aria-label="Payouts" className={cn(cardClass(design), "overflow-hidden", className)}>
      <CardHead title="Payouts" right={method && <span className="font-inter text-xs text-muted-foreground">To {method.bankName} ···· {method.last4}</span>} />
      {upcoming && (
        <div className={cn("mx-3 mb-2 flex items-center gap-3 bg-[var(--lab-accent-soft)] px-3 py-2.5", innerRadiusClass(design))}>
          <span className={cn("flex size-8 shrink-0 items-center justify-center bg-[var(--lab-accent)] text-[var(--lab-on-accent)]", design.radius === "sharp" ? "rounded-none" : "rounded-full")}>
            <CalendarClock className="size-4" strokeWidth={2} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">Next payout</span>
            <span className="block font-inter text-xs text-muted-foreground">
              {daysUntil(upcoming.expectedAt) <= 1 ? "Tomorrow" : weekday(upcoming.expectedAt, locale)}, {shortDate(upcoming.expectedAt, locale)}
            </span>
          </span>
          <Money cents={upcoming.amountCents} currency={upcoming.currency} centsStyle={rowCents(design)} className="text-sm font-semibold text-foreground" />
        </div>
      )}
      {payouts.length === 0 ? (
        <p className="px-5 pt-2 pb-6 font-inter text-sm text-muted-foreground">No payouts yet. Money you earn is sent to your bank automatically.</p>
      ) : (
        <ul className="pb-2">
          {payouts.slice(0, 6).map((payout) => (
            <li key={payout.id}>
              <button
                type="button"
                onClick={() => onSelect(payout)}
                className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors duration-base hover:bg-black/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground tabular-nums">{shortDate(payout.arrivalDate, locale)}</span>
                  <span className="block font-inter text-xs text-muted-foreground">{payout.method === "instant" ? "Instant" : "Automatic"}</span>
                </span>
                <StatusMark status={payout.status} variant={design.status} />
                <Money
                  cents={payout.amountCents}
                  currency={payout.currency}
                  centsStyle={rowCents(design)}
                  className={cn("w-20 shrink-0 text-right text-sm font-semibold", payout.status === "failed" || payout.status === "canceled" ? "text-muted-foreground line-through decoration-1" : "text-foreground")}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The bank payouts go to: a drawn card, or a plain row. Masked, always. */
export function BankCard({ method, design, className, compact = false }: { method: PayoutMethod | null; className?: string; compact?: boolean } & P) {
  if (!method) {
    return (
      <section className={cn(cardClass(design), "p-5", className)}>
        <h2 className="text-sm font-semibold text-foreground">Payout account</h2>
        <p className="mt-1 font-inter text-sm text-muted-foreground">Connect Stripe to choose the bank your money goes to.</p>
      </section>
    );
  }
  if (design.bank === "row") {
    return (
      <section className={cn(cardClass(design), "flex items-center gap-3 p-4", className)}>
        <span className={cn("flex size-10 shrink-0 items-center justify-center bg-[var(--lab-accent-soft)] text-[var(--lab-accent)]", innerRadiusClass(design))}>
          <Landmark className="size-5" strokeWidth={2} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">
            {method.bankName} ···· {method.last4}
          </span>
          <span className="block font-inter text-xs text-muted-foreground">
            {method.currency} · {method.country} · Default
          </span>
        </span>
        <button type="button" className="font-inter text-xs font-medium text-foreground underline-offset-4 hover:underline">
          Manage in Stripe ↗
        </button>
      </section>
    );
  }
  const ink = isInk(design.accent);
  return (
    <section className={cn("space-y-3", className)}>
      <div
        className={cn("relative overflow-hidden p-5 text-white shadow-lg", compact ? "aspect-[2/1]" : "aspect-[1.586/1]", design.radius === "sharp" ? "rounded-none" : "rounded-2xl")}
        style={{
          background: ink
            ? "radial-gradient(120% 120% at 100% 0%, #3f3f46, transparent 55%), linear-gradient(135deg, #18181b, #000)"
            : "radial-gradient(120% 120% at 100% 0%, color-mix(in oklab, var(--lab-accent-2) 80%, transparent), transparent 60%), linear-gradient(135deg, var(--lab-accent), color-mix(in oklab, var(--lab-accent) 55%, black))",
        }}
      >
        <div className="flex items-start justify-between">
          <span className="text-sm font-semibold tracking-wide">{method.bankName}</span>
          <span className="font-inter text-xs font-medium opacity-80">{method.currency}</span>
        </div>
        <span aria-hidden className="mt-4 block h-6 w-8 rounded-[5px] bg-gradient-to-br from-amber-200 to-amber-400 opacity-90" />
        <div className="absolute inset-x-5 bottom-4 flex items-end justify-between">
          <span className="font-mono text-base tracking-[0.2em]">···· {method.last4}</span>
          <span className="font-inter text-[11px] opacity-75">Payouts · {method.country}</span>
        </div>
        <span aria-hidden className="pointer-events-none absolute -right-10 -bottom-16 size-48 rounded-full border border-white/15" />
        <span aria-hidden className="pointer-events-none absolute -right-2 -bottom-24 size-48 rounded-full border border-white/10" />
      </div>
      <div className="flex items-center justify-between px-1">
        <span className="font-inter text-xs text-muted-foreground">Your money lands here, automatically.</span>
        <button type="button" className="font-inter text-xs font-medium text-foreground underline-offset-4 hover:underline">
          Manage ↗
        </button>
      </div>
    </section>
  );
}

/** A trend tile: name, figure, change against the period before, and a sparkline. */
export function KpiTile({
  label,
  value,
  before,
  spark,
  design,
  format = "money",
  invert = false,
}: {
  label: string;
  value: number;
  before: number | null;
  spark: number[];
  format?: "money" | "count";
  /** Down is good. */
  invert?: boolean;
} & P) {
  return (
    <section className={cn(cardClass(design), "flex flex-col gap-1 overflow-hidden p-4 pb-0")}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-inter text-xs font-medium text-muted-foreground">{label}</p>
        {before !== null && <DeltaChip now={value} before={before} invert={invert} />}
      </div>
      <p className={cn("text-2xl text-foreground", figureClass(design))}>
        {format === "money" ? <Money cents={value} centsStyle={design.cents} /> : <span className="tabular-nums">{value}</span>}
      </p>
      <p className="font-inter text-xs text-muted-foreground">
        {before === null ? "No earlier period yet" : <>vs {format === "money" ? <Money cents={before} centsStyle="inline" /> : before} before</>}
      </p>
      <ScrubChart
        values={spark}
        style={design.chart === "bars" ? "bars" : design.chart === "hatch" ? "hatch" : "area"}
        color={design.accent}
        height={52}
        strokeWidth={1.5}
        baseline={false}
        className="-mx-4 mt-2 text-foreground"
        ariaLabel={`${label} by day`}
      />
    </section>
  );
}

/** Available against clearing as one divided bar, with the figures under it. */
export function BalanceSplit({
  available,
  pending,
  design,
  onDark = false,
}: {
  available: number;
  pending: number;
  onDark?: boolean;
} & P) {
  const total = Math.max(1, available + pending);
  const bar = design.radius === "sharp" ? "rounded-none" : "rounded-full";
  return (
    <div className="space-y-2.5">
      <div className={cn("flex h-2 gap-0.5 overflow-hidden", bar)}>
        <span className={cn("h-full", bar)} style={{ width: `${(available / total) * 100}%`, background: onDark && isDark(design.accent) ? "#fff" : "var(--lab-accent)" }} />
        <span className={cn("h-full flex-1", bar)} style={{ background: onDark ? "rgb(255 255 255 / 0.25)" : "var(--lab-accent-line)" }} />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 font-inter text-xs">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: onDark && isDark(design.accent) ? "#fff" : "var(--lab-accent)" }} aria-hidden />
          <span className="opacity-70">Available</span>
          <Money cents={available} centsStyle="inline" className="font-semibold" />
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: onDark ? "rgb(255 255 255 / 0.25)" : "var(--lab-accent-line)" }} aria-hidden />
          <span className="opacity-70">Clearing</span>
          <Money cents={pending} centsStyle="inline" className="font-semibold" />
        </span>
      </div>
    </div>
  );
}
