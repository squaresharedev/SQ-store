import { buildScenario, PAYMENTS_SCENARIOS, type PaymentsScenario } from "@/lib/payments/scenarios";
import type { BalanceTransaction, MoneyAmount, PaymentsOverview } from "@/lib/payments/types";

/**
 * The payments lab's data: each simulated story (lib/payments/scenarios.ts)
 * as the tab receives it, plus what only a redesign needs, a day-by-day series
 * of the WHOLE ledger (the tab's own slice stops at 12 rows). All figures are
 * the scenario's own, in integer cents, euro only, so a chart and the
 * balance beside it always agree.
 */

/** One day of the euro ledger. */
export type LabDay = {
  /** Midnight UTC of the day, ISO. */
  day: string;
  /** Net from sales made that day (after fees). */
  earned: number;
  /** Sales made that day, before fees. */
  gross: number;
  /** How many sales. */
  sales: number;
  /** Refunds, fees and corrections that day (zero or less). */
  costs: number;
  /** Sent to the bank that day (zero or more). */
  paidOut: number;
  /** Available plus pending at the end of the day. */
  balance: number;
};

export type LabData = {
  overview: PaymentsOverview;
  /** The last `LAB_HISTORY_DAYS` days, oldest first, today last. */
  days: LabDay[];
  /** Every transaction the story has, newest first (the tab itself gets `overview.transactions`). */
  ledger: BalanceTransaction[];
  /** What the store paid Square Share this month (the real page reads our ledger). */
  feesThisMonth: MoneyAmount[];
};

/** How far back the series runs: the longest range a design offers. */
export const LAB_HISTORY_DAYS = 90;

const MS_PER_DAY = 86_400_000;

/** A pretend month of fees for a store that sells, as the dev gallery shows it. */
const FEES_THIS_MONTH: MoneyAmount[] = [{ amountCents: 4310, currency: "EUR" }];

const dayStart = (iso: string) => {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

function series(ledger: BalanceTransaction[], now: Date): LabDay[] {
  const today = dayStart(now.toISOString());
  const first = today - (LAB_HISTORY_DAYS - 1) * MS_PER_DAY;
  const days: LabDay[] = Array.from({ length: LAB_HISTORY_DAYS }, (_, i) => ({
    day: new Date(first + i * MS_PER_DAY).toISOString(),
    earned: 0,
    gross: 0,
    sales: 0,
    costs: 0,
    paidOut: 0,
    balance: 0,
  }));
  let opening = 0;
  for (const txn of ledger) {
    if (txn.currency !== "EUR") continue;
    const index = (dayStart(txn.createdAt) - first) / MS_PER_DAY;
    if (index < 0) {
      opening += txn.netCents;
      continue;
    }
    const day = days[index];
    if (!day) continue;
    if (txn.type === "charge") {
      day.earned += txn.netCents;
      day.gross += txn.amountCents;
      day.sales += 1;
    } else if (txn.type === "payout") day.paidOut -= txn.netCents;
    else day.costs += txn.netCents;
  }
  let running = opening;
  for (const day of days) {
    running += day.earned + day.costs - day.paidOut;
    day.balance = running;
  }
  return days;
}

/** Every story's lab data, dated from `now`. */
export function buildLabData(now: Date = new Date()): Record<PaymentsScenario, LabData> {
  return Object.fromEntries(
    PAYMENTS_SCENARIOS.map((scenario) => {
      const overview = buildScenario(scenario, now);
      const ledger = buildScenario(scenario, now, { payouts: 1_000, transactions: 10_000 }).transactions;
      return [
        scenario,
        {
          overview,
          days: series(ledger, now),
          ledger,
          feesThisMonth: overview.transactions.length > 0 ? FEES_THIS_MONTH : [],
        },
      ];
    }),
  ) as Record<PaymentsScenario, LabData>;
}

/** Stand-in product photos for sale rows (the sample storefront's), one per title. */
const PHOTOS = ["camera", "headphones", "mouse", "speaker", "succulent", "watch"] as const;

/** A transaction's description as its two halves: "Sale · Ceramic mug" is a kind and a name. */
export function splitDescription(description: string): { kind: string; name: string } {
  const at = description.indexOf(" · ");
  return at < 0 ? { kind: "", name: description } : { kind: description.slice(0, at), name: description.slice(at + 3) };
}

/** The stand-in photo for a product, stable per title. Prices in the lab are the scenario's, the pictures are not. */
const PHOTO_OF: Record<string, (typeof PHOTOS)[number]> = {
  "Roundhouse coffee table": "speaker",
  "Screen print, A2": "camera",
  "Riso print 'Night swim'": "headphones",
  "Ceramic mug": "succulent",
  "Linen tote": "watch",
  "Enamel pin set": "watch",
  "Zine, issue 4": "mouse",
  "Sticker pack": "mouse",
};

export function labPhoto(name: string): string {
  const base = name.replace(/\s*\((embed|US)\)$/, "");
  if (PHOTO_OF[base]) return `/sample-storefront/${PHOTO_OF[base]}.webp`;
  let hash = 0;
  for (const char of base) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `/sample-storefront/${PHOTOS[hash % PHOTOS.length]}.webp`;
}
