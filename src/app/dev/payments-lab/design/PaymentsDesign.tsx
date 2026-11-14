"use client";

import { ArrowDownLeft, ArrowUpRight, CalendarClock, Clock3, FileText, Settings2 } from "lucide-react";
import { useLocale } from "next-intl";
import { useState, type CSSProperties, type ReactNode } from "react";
import { ConnectStripeModal } from "@/components/payments/ConnectStripeModal";
import { PaymentsHeader } from "@/components/payments/PaymentsHeader";
import { PaymentsPage } from "@/components/payments/PaymentsPage";
import { PayoutDetailModal } from "@/components/payments/PayoutDetailModal";
import { TransactionDetailModal } from "@/components/payments/TransactionDetailModal";
import type { Locale } from "@/i18n/locales";
import type { BalanceTransaction, Payout } from "@/lib/payments/types";
import { cn } from "@/lib/utils";
import type { LabData } from "../fixtures";
import type { LabRange, PaymentsDesignProps } from "../lab-model";
import { daysUntil, DeltaChip, Money, shortDate, STATUS_TONE, weekday } from "./bits";
import { rangeView, topProducts, type RangeView } from "./derive";
import { ActivityFeed, BalanceSplit, BankCard, CardHead, Eyebrow, KpiTile, PayoutList, RangeTabs } from "./modules";
import { ScrubChart } from "./ScrubChart";
import { cardClass, chartColor, designVars, figureClass, heroSurface, innerRadiusClass, pageClass, radiusClass } from "./theme";

/**
 * One design of the Payments tab, drawn from a set of knobs (lab-model.ts)
 * over a simulated story. Every layout shares the same data, the real
 * header (title and Stripe connection) and the real detail modals; only the
 * composition and the surfaces differ. Breakpoints are CONTAINER queries
 * (@2xl ~ sm, @3xl ~ md, @5xl ~ lg) so the lab can draw a phone inside a
 * desktop window; a shipped page goes back to the screen ones. Prototype.
 */

type Ctx = {
  design: PaymentsDesignProps;
  data: LabData;
  view: RangeView;
  range: LabRange;
  setRange: (range: LabRange) => void;
  locale: Locale;
  available: number;
  pending: number;
  onTxn: (transaction: BalanceTransaction) => void;
  onPayout: (payout: Payout) => void;
  onConnect: () => void;
};

/** A running total, for sparklines that should rise rather than spike. */
const running = (values: number[]) => {
  let sum = 0;
  return values.map((value) => (sum += value));
};

const euro = (buckets: { amountCents: number; currency: string }[]) =>
  buckets.filter((bucket) => bucket.currency === "EUR").reduce((sum, bucket) => sum + bucket.amountCents, 0);

/** What the chart draws and what the headline says, idle or with a day under the pointer. */
function chartModel(ctx: Ctx) {
  const { design, view } = ctx;
  const bars = design.chart === "bars";
  const balance = design.metric === "balance";
  const values = balance ? view.days.map((day) => day.balance) : bars ? view.days.map((day) => day.earned) : view.cumulative;
  const compare =
    !design.compare || bars || !view.previous
      ? undefined
      : balance
        ? view.previous.map((day) => day.balance)
        : (view.cumulativeBefore ?? undefined);
  const headline = (index: number | null) => {
    if (index === null) return balance ? ctx.available + ctx.pending : view.now.earned;
    return values[index] ?? 0;
  };
  const label = (index: number | null) => {
    if (index === null) return balance ? "Balance" : `Earned, last ${ctx.range} days`;
    const day = shortDate(view.days[index].day, ctx.locale);
    if (balance) return `Balance on ${day}`;
    return bars ? `Earned on ${day}` : `Earned by ${day}`;
  };
  return { values, compare, headline, label };
}

/** The first, middle and last dates under a chart. */
function Axis({ ctx, className }: { ctx: Ctx; className?: string }) {
  const days = ctx.view.days;
  const mid = days[Math.floor(days.length / 2)];
  return (
    <div className={cn("flex justify-between font-inter text-[11px] opacity-55", className)}>
      <span>{shortDate(days[0].day, ctx.locale)}</span>
      <span>{shortDate(mid.day, ctx.locale)}</span>
      <span>Today</span>
    </div>
  );
}

function CompareLegend({ ctx, color, className }: { ctx: Ctx; color: string; className?: string }) {
  if (!ctx.design.compare || ctx.design.chart === "bars" || ctx.design.chart === "none" || !ctx.view.previous) return null;
  return (
    <div className={cn("flex gap-4 font-inter text-[11px] opacity-70", className)}>
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-3 rounded-full" style={{ background: color }} aria-hidden />
        These {ctx.range} days
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3 border-t border-dashed border-current opacity-60" aria-hidden />
        The {ctx.range} before
      </span>
    </div>
  );
}

/** The scrubbable chart with its headline: the shared heart of most layouts. */
function useScrub() {
  return useState<number | null>(null);
}

function Chart({ ctx, onDark, height, scrub, setScrub, className, hero }: { ctx: Ctx; onDark: boolean; height: number; scrub: number | null; setScrub: (index: number | null) => void; className?: string; /** The surface it sits on, when that is not the design's hero. */ hero?: PaymentsDesignProps["hero"] }) {
  const model = chartModel(ctx);
  if (ctx.design.chart === "none") return null;
  const empty = model.values.every((value) => value === 0) && !model.compare?.some((value) => value !== 0);
  return (
    <div className="relative">
      {empty && (
        <p className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center font-inter text-sm opacity-60">
          Your first sale starts this line.
        </p>
      )}
    <ScrubChart
      values={model.values}
      compare={model.compare}
      style={ctx.design.chart}
      color={chartColor(ctx.design, onDark, hero)}
      height={height}
      glow={ctx.design.glow}
      active={scrub}
      onScrub={setScrub}
      grid={ctx.design.chart !== "bars"}
      className={cn(onDark ? "text-white" : "text-foreground", className)}
      ariaLabel={model.label(null)}
    />
    </div>
  );
}

/** The surface a hero sits on, with the tokens flipped under a dark one. */
function Hero({ ctx, className, style, children, hero }: { ctx: Ctx; className?: string; style?: CSSProperties; children: (onDark: boolean) => ReactNode; hero?: PaymentsDesignProps["hero"] }) {
  const surface = heroSurface(ctx.design, hero);
  return (
    <section className={cn(surface.className, radiusClass(ctx.design), surface.dark && "dark", "relative overflow-hidden text-foreground", surface.dark && "text-white", className)} style={{ ...surface.style, ...style }}>
      {children(surface.dark)}
    </section>
  );
}

function NextPayoutLine({ ctx }: { ctx: Ctx }) {
  const upcoming = ctx.data.overview.upcomingPayout;
  const method = ctx.data.overview.payoutMethod;
  if (!upcoming) return <span className="opacity-70">No payout scheduled yet.</span>;
  return (
    <>
      <span className="opacity-70">Next payout</span>{" "}
      <Money cents={upcoming.amountCents} centsStyle="inline" className="font-semibold" />{" "}
      <span className="opacity-70">
        {daysUntil(upcoming.expectedAt) <= 1 ? "tomorrow" : `on ${shortDate(upcoming.expectedAt, ctx.locale)}`}
        {method && ` to ${method.bankName} ···· ${method.last4}`}
      </span>
    </>
  );
}

function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="font-inter text-xs opacity-60">{label}</p>
      <p className="mt-0.5 truncate text-lg font-semibold">{children}</p>
      {hint && <p className="font-inter text-[11px] opacity-55">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- layouts

function Pulse({ ctx }: { ctx: Ctx }) {
  const { design, view, data } = ctx;
  const [scrub, setScrub] = useScrub();
  const model = chartModel(ctx);
  const upcoming = data.overview.upcomingPayout;
  return (
    <>
      <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-3">
        <Hero ctx={ctx} className="p-5 @2xl:p-6 @5xl:col-span-2">
          {(onDark) => (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Eyebrow>{model.label(scrub)}</Eyebrow>
                  <p className={cn("mt-1 text-4xl tracking-tight @2xl:text-5xl", figureClass(design))}>
                    <Money cents={model.headline(scrub)} centsStyle={design.cents} />
                  </p>
                  {scrub === null && view.before && (
                    <div className="mt-2 flex items-center gap-2">
                      <DeltaChip now={view.now.earned} before={view.before.earned} />
                      <span className="font-inter text-xs opacity-60">
                        vs <Money cents={view.before.earned} centsStyle="inline" /> the {ctx.range} days before
                      </span>
                    </div>
                  )}
                </div>
                <RangeTabs value={ctx.range} onChange={ctx.setRange} design={design} onDark={onDark} />
              </div>
              <CompareLegend ctx={ctx} color={chartColor(design, onDark)} className="mt-5 justify-end" />
              <Chart ctx={ctx} onDark={onDark} height={220} scrub={scrub} setScrub={setScrub} className="mt-2" />
              <Axis ctx={ctx} className="mt-2" />
            </>
          )}
        </Hero>
        <div className="grid gap-4">
          <section className={cn(cardClass(design), "p-5")}>
            <Eyebrow>Balance</Eyebrow>
            <p className={cn("mt-1 text-3xl", figureClass(design))}>
              <Money cents={ctx.available + ctx.pending} centsStyle={design.cents} />
            </p>
            <div className="mt-4">
              <BalanceSplit available={ctx.available} pending={ctx.pending} design={design} />
            </div>
            {data.feesThisMonth.length > 0 && (
              <div className="mt-4 flex items-baseline justify-between border-t border-border/70 pt-3 font-inter text-xs">
                <span className="text-muted-foreground">Square Share fees this month</span>
                <Money cents={euro(data.feesThisMonth)} centsStyle="inline" className="font-semibold text-foreground" />
              </div>
            )}
          </section>
          <section className={cn(cardClass(design), "p-5")}>
            <div className="flex items-center justify-between">
              <Eyebrow>Next payout</Eyebrow>
              <CalendarClock className="size-4 text-[var(--lab-accent)]" strokeWidth={2} aria-hidden />
            </div>
            {upcoming ? (
              <>
                <p className={cn("mt-1 text-3xl", figureClass(design))}>
                  <Money cents={upcoming.amountCents} centsStyle={design.cents} />
                </p>
                <p className="mt-1 font-inter text-sm text-muted-foreground">
                  {daysUntil(upcoming.expectedAt) <= 1 ? "Tomorrow" : weekday(upcoming.expectedAt, ctx.locale)}, {shortDate(upcoming.expectedAt, ctx.locale)}
                  {data.overview.payoutMethod && ` · ${data.overview.payoutMethod.bankName} ···· ${data.overview.payoutMethod.last4}`}
                </p>
              </>
            ) : (
              <p className="mt-2 font-inter text-sm text-muted-foreground">Nothing to send yet. Payouts go out on their own once a sale clears.</p>
            )}
          </section>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-4">
        <KpiTile design={design} label="Gross sales" value={view.now.gross} before={view.before?.gross ?? null} spark={running(view.days.map((d) => d.gross))} />
        <KpiTile design={design} label="Sales" format="count" value={view.now.sales} before={view.before?.sales ?? null} spark={running(view.days.map((d) => d.sales))} />
        <KpiTile design={design} label="Refunds and fees" invert value={-view.now.costs} before={view.before ? -view.before.costs : null} spark={running(view.days.map((d) => -d.costs))} />
        <KpiTile design={design} label="Paid out" value={view.now.paidOut} before={view.before?.paidOut ?? null} spark={running(view.days.map((d) => d.paidOut))} />
      </div>

      <Lists ctx={ctx} showUpcoming={false} />
    </>
  );
}

function Account({ ctx }: { ctx: Ctx }) {
  const { design, view, data } = ctx;
  const [scrub, setScrub] = useScrub();
  const model = chartModel(ctx);
  const moneyOut = view.now.paidOut - view.now.costs;
  return (
    <>
      <Hero ctx={ctx} className="px-5 pt-6 @2xl:px-7">
        {(onDark) => (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Eyebrow>{scrub === null ? (design.metric === "balance" ? "Balance · EUR" : model.label(null)) : model.label(scrub)}</Eyebrow>
                <p className={cn("mt-1 text-5xl tracking-tight @2xl:text-6xl", figureClass(design))}>
                  <Money cents={model.headline(scrub)} centsStyle={design.cents} />
                </p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  <span className="flex items-center gap-1.5">
                    <ArrowDownLeft className={cn("size-4", onDark ? "text-emerald-400" : "text-emerald-600")} strokeWidth={2.25} aria-hidden />
                    <span className="opacity-60">In</span>
                    <Money cents={view.now.earned} centsStyle="inline" className="font-semibold" />
                  </span>
                  <span className="flex items-center gap-1.5">
                    <ArrowUpRight className="size-4 opacity-70" strokeWidth={2.25} aria-hidden />
                    <span className="opacity-60">Out</span>
                    <Money cents={moneyOut} centsStyle="inline" className="font-semibold" />
                  </span>
                  <span className="opacity-60">last {ctx.range} days</span>
                </div>
              </div>
              <RangeTabs value={ctx.range} onChange={ctx.setRange} design={design} onDark={onDark} />
            </div>
            <Chart ctx={ctx} onDark={onDark} height={200} scrub={scrub} setScrub={setScrub} className="-mx-5 mt-8 @2xl:-mx-7" />
            <Axis ctx={ctx} className="py-3" />
          </>
        )}
      </Hero>
      <div className="grid grid-cols-1 items-start gap-4 @5xl:grid-cols-3">
        <ActivityFeed transactions={data.overview.transactions} design={design} onSelect={ctx.onTxn} filters title="Transactions" className="@5xl:col-span-2" />
        <div className="space-y-4">
          <PayoutList payouts={data.overview.payouts} upcoming={data.overview.upcomingPayout} method={data.overview.payoutMethod} design={design} onSelect={ctx.onPayout} />
          <BankCard method={data.overview.payoutMethod} design={design} />
        </div>
      </div>
    </>
  );
}

function Wallet({ ctx }: { ctx: Ctx }) {
  const { design, data, view } = ctx;
  const [scrub, setScrub] = useScrub();
  const model = chartModel(ctx);
  const pockets = ["EUR", "USD"].flatMap((currency) => {
    const available = data.overview.balance.available.find((b) => b.currency === currency)?.amountCents ?? 0;
    const pending = data.overview.balance.pending.find((b) => b.currency === currency)?.amountCents ?? 0;
    return currency === "EUR" || available || pending ? [{ currency, available, pending }] : [];
  });
  const action = (Icon: typeof Clock3, label: string, onDark: boolean) => (
    <button type="button" className="group flex flex-col items-center gap-1.5">
      <span className={cn("flex size-11 items-center justify-center transition-transform duration-base group-hover:-translate-y-0.5", design.radius === "sharp" ? "rounded-none" : "rounded-full", onDark ? "bg-white/15 text-white" : "bg-[var(--lab-accent)] text-[var(--lab-on-accent)]")}>
        <Icon className="size-5" strokeWidth={2} aria-hidden />
      </span>
      <span className="font-inter text-xs font-medium opacity-80">{label}</span>
    </button>
  );
  return (
    <>
      <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-5">
        <Hero ctx={ctx} className="flex min-h-72 flex-col justify-between gap-6 p-6 @5xl:col-span-3">
          {(onDark) => (
            <>
              <div className="flex items-center justify-between">
                <Eyebrow>Total balance</Eyebrow>
                <span className={cn("px-2 py-0.5 font-inter text-xs font-semibold", design.radius === "sharp" ? "rounded-none" : "rounded-full", onDark ? "bg-white/15" : "bg-black/5")}>EUR</span>
              </div>
              <div>
                <p className={cn("text-5xl tracking-tight @2xl:text-6xl", figureClass(design))}>
                  <Money cents={ctx.available + ctx.pending} centsStyle={design.cents} />
                </p>
                <p className="mt-2 text-sm">
                  <NextPayoutLine ctx={ctx} />
                </p>
              </div>
              <BalanceSplit available={ctx.available} pending={ctx.pending} design={design} onDark={onDark} />
              <div className="flex gap-6">
                {action(CalendarClock, "Schedule", onDark)}
                {action(FileText, "Statements", onDark)}
                {action(Settings2, "In Stripe", onDark)}
              </div>
            </>
          )}
        </Hero>
        <div className="grid content-start gap-4 @5xl:col-span-2">
          {pockets.map((pocket) => (
            <section key={pocket.currency} className={cn(cardClass(design), "flex items-center gap-4 p-4")}>
              <span className={cn("flex size-11 shrink-0 items-center justify-center text-lg font-semibold text-[var(--lab-on-accent)]", design.radius === "sharp" ? "rounded-none" : "rounded-full")} style={{ background: pocket.currency === "EUR" ? "var(--lab-accent)" : "var(--lab-accent-2)" }}>
                {pocket.currency === "EUR" ? "€" : "$"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">{pocket.currency === "EUR" ? "Euro" : "US dollar"}</span>
                <span className="block font-inter text-xs text-muted-foreground">
                  <Money cents={pocket.pending} currency={pocket.currency} centsStyle="inline" /> clearing
                </span>
              </span>
              <Money cents={pocket.available} currency={pocket.currency} centsStyle={design.cents} className={cn("text-xl text-foreground", figureClass(design))} />
            </section>
          ))}
          <BankCard method={data.overview.payoutMethod} design={design} compact />
        </div>
      </div>
      {design.chart !== "none" && (
        <section className={cn(cardClass(design), "p-5")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Eyebrow className="text-foreground">{model.label(scrub)}</Eyebrow>
              <p className={cn("mt-1 text-2xl text-foreground", figureClass(design))}>
                <Money cents={model.headline(scrub)} centsStyle={design.cents} />
              </p>
            </div>
            <div className="flex items-center gap-3">
              {view.before && scrub === null && <DeltaChip now={view.now.earned} before={view.before.earned} />}
              <RangeTabs value={ctx.range} onChange={ctx.setRange} design={design} />
            </div>
          </div>
          <Chart ctx={ctx} onDark={false} height={150} scrub={scrub} setScrub={setScrub} className="mt-4" hero="plain" />
          <Axis ctx={ctx} className="mt-2 text-foreground" />
        </section>
      )}
      <Lists ctx={ctx} showUpcoming bank={false} />
    </>
  );
}

/** Every payout as a bar, coloured by its status; the newest on the right. */
function PayoutBars({ ctx }: { ctx: Ctx }) {
  const { design, data } = ctx;
  const payouts = [...data.overview.payouts].reverse();
  const max = Math.max(1, ...payouts.map((p) => p.amountCents));
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover === null ? null : payouts[hover];
  return (
    <section className={cn(cardClass(design), "p-5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow className="text-foreground">{shown ? `Payout of ${shortDate(shown.arrivalDate, ctx.locale)}` : "Every payout"}</Eyebrow>
          <p className={cn("mt-1 text-2xl text-foreground", figureClass(design))}>
            {shown ? (
              <Money cents={shown.amountCents} centsStyle={design.cents} />
            ) : (
              <Money cents={payouts.filter((p) => p.status === "paid").reduce((s, p) => s + p.amountCents, 0)} centsStyle={design.cents} />
            )}
          </p>
          <p className="font-inter text-xs text-muted-foreground">{shown ? STATUS_TONE[shown.status].label : "Paid out, the payouts shown"}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {(["paid", "in_transit", "pending", "failed"] as const).map((status) => (
            <span key={status} className="flex items-center gap-1.5 font-inter text-xs text-muted-foreground">
              <span className={cn("size-2 rounded-full", STATUS_TONE[status].dot)} aria-hidden />
              {STATUS_TONE[status].label}
            </span>
          ))}
        </div>
      </div>
      {payouts.length === 0 ? (
        <p className="mt-6 font-inter text-sm text-muted-foreground">Your payouts line up here, one bar each.</p>
      ) : (
        <div className="mt-6 flex h-40 items-end gap-2" onPointerLeave={() => setHover(null)}>
          {payouts.map((payout, i) => (
            <button
              key={payout.id}
              type="button"
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onClick={() => ctx.onPayout(payout)}
              className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
              aria-label={`Payout ${shortDate(payout.arrivalDate, ctx.locale)}, ${STATUS_TONE[payout.status].label}`}
            >
              <span
                className={cn("w-full max-w-12 transition-opacity duration-base", design.radius === "sharp" ? "rounded-none" : "rounded-t-md", STATUS_TONE[payout.status].dot, hover !== null && hover !== i && "opacity-35")}
                style={{ height: `${Math.max(4, (payout.amountCents / max) * 100)}%` }}
              />
              <span className="font-inter text-[11px] text-muted-foreground tabular-nums">{shortDate(payout.arrivalDate, ctx.locale)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Payday({ ctx }: { ctx: Ctx }) {
  const { design, data, view } = ctx;
  const upcoming = data.overview.upcomingPayout;
  const method = data.overview.payoutMethod;
  return (
    <>
      <Hero ctx={ctx} className="grid grid-cols-1 items-center gap-8 p-6 @2xl:p-8 @5xl:grid-cols-[1fr_22rem]">
        {() => (
          <>
            <div>
              <Eyebrow>Next payout</Eyebrow>
              {upcoming ? (
                <>
                  <p className={cn("mt-1 text-5xl tracking-tight @2xl:text-6xl", figureClass(design))}>
                    <Money cents={upcoming.amountCents} centsStyle={design.cents} />
                  </p>
                  <p className="mt-3 text-lg font-medium">
                    Arrives {daysUntil(upcoming.expectedAt) <= 1 ? "tomorrow" : "on"} {weekday(upcoming.expectedAt, ctx.locale)}, {shortDate(upcoming.expectedAt, ctx.locale)}
                  </p>
                  <p className="mt-1 font-inter text-sm opacity-65">Sent automatically{method ? ` to ${method.bankName} ···· ${method.last4}` : ""}. Nothing for you to do.</p>
                </>
              ) : (
                <>
                  <p className={cn("mt-1 text-4xl opacity-60", figureClass(design))}>Nothing yet</p>
                  <p className="mt-2 font-inter text-sm opacity-65">The next payout appears here as soon as a sale clears.</p>
                </>
              )}
              <div className="mt-8 grid grid-cols-2 gap-6 border-t border-current/10 pt-5 @2xl:grid-cols-3">
                <Stat label="Clearing" hint="Ready in about 3 days">
                  <Money cents={ctx.pending} centsStyle="inline" />
                </Stat>
                <Stat label={`Paid out, ${ctx.range} days`}>
                  <Money cents={view.now.paidOut} centsStyle="inline" />
                </Stat>
                {data.feesThisMonth.length > 0 && (
                  <Stat label="Fees this month">
                    <Money cents={euro(data.feesThisMonth)} centsStyle="inline" />
                  </Stat>
                )}
              </div>
            </div>
            <BankCard method={method} design={{ ...design, bank: "card" }} />
          </>
        )}
      </Hero>
      <PayoutBars ctx={ctx} />
      <div className="grid grid-cols-1 items-start gap-4 @5xl:grid-cols-3">
        <ActivityFeed transactions={data.overview.transactions} design={design} onSelect={ctx.onTxn} className="@5xl:col-span-2" />
        <PayoutList payouts={data.overview.payouts} upcoming={null} method={method} design={design} onSelect={ctx.onPayout} />
      </div>
    </>
  );
}

function Studio({ ctx }: { ctx: Ctx }) {
  const { design, data, view } = ctx;
  const [scrub, setScrub] = useScrub();
  const model = chartModel(ctx);
  const best = topProducts(data.ledger, view.days[0].day);
  return (
    <>
      <Hero ctx={ctx} className="grid grid-cols-1 @5xl:grid-cols-3">
        {(onDark) => (
          <>
            <div className="p-6 @2xl:p-7 @5xl:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <Eyebrow>{model.label(scrub)}</Eyebrow>
                <RangeTabs value={ctx.range} onChange={ctx.setRange} design={design} onDark={onDark} />
              </div>
              <p className={cn("text-6xl tracking-tighter @2xl:text-7xl", figureClass(design))}>
                <Money cents={model.headline(scrub)} centsStyle={design.cents} />
              </p>
              {scrub === null && view.before && (
                <div className="mt-2 flex items-center gap-2">
                  <DeltaChip now={view.now.earned} before={view.before.earned} />
                  <span className="font-inter text-xs opacity-60">
                    vs <Money cents={view.before.earned} centsStyle="inline" /> the {ctx.range} days before
                  </span>
                </div>
              )}
              <CompareLegend ctx={ctx} color={chartColor(design, onDark)} className="mt-5 justify-end" />
              <Chart ctx={ctx} onDark={onDark} height={170} scrub={scrub} setScrub={setScrub} className="mt-2" />
              <Axis ctx={ctx} className="mt-2" />
            </div>
            <div className={cn("grid divide-y border-t @5xl:border-t-0 @5xl:border-l", onDark ? "divide-white/10 border-white/10" : "divide-border border-border")}>
              <div className="p-5">
                <Stat label="Available" hint={<NextPayoutLine ctx={ctx} />}>
                  <Money cents={ctx.available} centsStyle="inline" />
                </Stat>
              </div>
              <div className="p-5">
                <Stat label="Clearing" hint="From the last 3 days of sales">
                  <Money cents={ctx.pending} centsStyle="inline" />
                </Stat>
              </div>
              <div className="p-5">
                <Stat label={`Paid out, ${ctx.range} days`}>
                  <Money cents={view.now.paidOut} centsStyle="inline" />
                </Stat>
              </div>
              {data.feesThisMonth.length > 0 && (
                <div className="p-5">
                  <Stat label="Square Share fees this month">
                    <Money cents={euro(data.feesThisMonth)} centsStyle="inline" />
                  </Stat>
                </div>
              )}
            </div>
          </>
        )}
      </Hero>
      {best.length > 0 && (
        <section className={cn(cardClass(design), "pb-5")}>
          <CardHead title={`Selling best, last ${ctx.range} days`} />
          <ul className="grid grid-cols-2 gap-4 px-5 @3xl:grid-cols-4">
            {best.map((product) => (
              <li key={product.name} className="min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- lab stand-in photo */}
                <img src={product.photo} alt="" className={cn("aspect-square w-full bg-muted object-cover", innerRadiusClass(design))} />
                <p className="mt-2 truncate text-sm font-medium text-foreground">{product.name}</p>
                <p className="flex justify-between gap-2 font-inter text-xs text-muted-foreground">
                  <span>{product.count} sold</span>
                  <Money cents={product.earned} centsStyle="inline" className="font-semibold text-foreground" />
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Lists ctx={ctx} showUpcoming={false} />
    </>
  );
}

function Night({ ctx }: { ctx: Ctx }) {
  const { design, view, data } = ctx;
  const [scrub, setScrub] = useScrub();
  const model = chartModel(ctx);
  const hero = design.hero === "plain" || design.hero === "tint" ? "ink" : design.hero;
  const upcoming = data.overview.upcomingPayout;
  return (
    <Hero ctx={ctx} hero={hero} className="-mx-6 -mt-8 rounded-none px-6 pt-8 pb-8 ring-0">
      {(onDark) => (
        <div className="mx-auto max-w-7xl">
          <PaymentsHeader account={data.overview.account} onConnect={ctx.onConnect} />
          <div className="mt-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <Eyebrow>{model.label(scrub)}</Eyebrow>
              <p className={cn("mt-1 text-5xl tracking-tight @2xl:text-6xl", figureClass(design))}>
                <Money cents={model.headline(scrub)} centsStyle={design.cents} />
              </p>
              {scrub === null && view.before && (
                <div className="mt-2 flex items-center gap-2">
                  <DeltaChip now={view.now.earned} before={view.before.earned} />
                  <span className="font-inter text-xs opacity-60">against the {ctx.range} days before</span>
                </div>
              )}
            </div>
            <RangeTabs value={ctx.range} onChange={ctx.setRange} design={design} onDark={onDark} />
          </div>
          <CompareLegend ctx={ctx} color={chartColor(design, onDark, hero)} className="mt-5 justify-end" />
          <Chart ctx={ctx} onDark={onDark} height={230} scrub={scrub} setScrub={setScrub} className="mt-2" hero={hero} />
          <Axis ctx={ctx} className="mt-2" />
          <div className={cn("mt-8 grid grid-cols-2 gap-6 border-t pt-6 @2xl:grid-cols-4", onDark ? "border-white/10" : "border-black/10")}>
            <Stat label="Available">
              <Money cents={ctx.available} centsStyle="inline" />
            </Stat>
            <Stat label="Clearing">
              <Money cents={ctx.pending} centsStyle="inline" />
            </Stat>
            <Stat label="Next payout" hint={upcoming ? (daysUntil(upcoming.expectedAt) <= 1 ? "Tomorrow" : shortDate(upcoming.expectedAt, ctx.locale)) : "None scheduled"}>
              {upcoming ? <Money cents={upcoming.amountCents} centsStyle="inline" /> : "–"}
            </Stat>
            <Stat label={`Sales, ${ctx.range} days`}>{view.now.sales}</Stat>
          </div>
        </div>
      )}
    </Hero>
  );
}

/** Activity beside payouts and the bank: the lower half most layouts share. */
function Lists({ ctx, showUpcoming, bank = true }: { ctx: Ctx; showUpcoming: boolean; bank?: boolean }) {
  const { design, data } = ctx;
  return (
    <div className="grid grid-cols-1 items-start gap-4 @5xl:grid-cols-3">
      <ActivityFeed transactions={data.overview.transactions} design={design} onSelect={ctx.onTxn} className="@5xl:col-span-2" />
      <div className="space-y-4">
        <PayoutList payouts={data.overview.payouts} upcoming={showUpcoming ? data.overview.upcomingPayout : null} method={data.overview.payoutMethod} design={design} onSelect={ctx.onPayout} />
        {bank && <BankCard method={data.overview.payoutMethod} design={design} />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- root

type Modal = { kind: "none" } | { kind: "connect" } | { kind: "payout"; payout: Payout } | { kind: "transaction"; transaction: BalanceTransaction };

export function PaymentsDesign({ design, data }: { design: PaymentsDesignProps; data: LabData }) {
  const locale = useLocale();
  const [range, setRange] = useState<LabRange>(design.range);
  const [modal, setModal] = useState<Modal>({ kind: "none" });
  const close = () => setModal({ kind: "none" });

  if (design.layout === "current") {
    return <PaymentsPage overview={data.overview} feesThisMonth={data.feesThisMonth} />;
  }

  const ctx: Ctx = {
    design,
    data,
    view: rangeView(data.days, range),
    range,
    setRange,
    locale,
    available: euro(data.overview.balance.available),
    pending: euro(data.overview.balance.pending),
    onTxn: (transaction) => setModal({ kind: "transaction", transaction }),
    onPayout: (payout) => setModal({ kind: "payout", payout }),
    onConnect: () => setModal({ kind: "connect" }),
  };
  const Layout = { pulse: Pulse, account: Account, wallet: Wallet, payday: Payday, studio: Studio, night: Night }[design.layout];

  return (
    // A container, so the layout follows the box it is drawn in (the lab's phone frame) and not the window.
    <div className={cn(pageClass(design), "@container min-h-full text-foreground")} style={designVars(design)} data-design={design.layout}>
      {design.layout === "night" ? (
        <div className="px-6 pt-8">
          <Night ctx={ctx} />
          <main className="mx-auto max-w-7xl space-y-4 py-6">
            <Lists ctx={ctx} showUpcoming={false} />
          </main>
        </div>
      ) : (
        <main className="mx-auto max-w-7xl space-y-4 px-6 py-8">
          <div className="pb-2">
            <PaymentsHeader account={data.overview.account} onConnect={ctx.onConnect} />
          </div>
          <Layout ctx={ctx} />
        </main>
      )}

      <ConnectStripeModal open={modal.kind === "connect"} onClose={close} />
      {modal.kind === "payout" && <PayoutDetailModal open onClose={close} payout={modal.payout} method={data.overview.payoutMethod} />}
      {modal.kind === "transaction" && <TransactionDetailModal open onClose={close} transaction={modal.transaction} />}
    </div>
  );
}
