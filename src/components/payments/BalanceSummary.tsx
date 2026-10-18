import { useTranslations, useLocale } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import { cardClass } from "@/components/ui/surface-styles";
import { formatCents } from "@/lib/format/money";
import { formatOrderDate } from "@/lib/format/date";
import type { Balance, MoneyAmount, UpcomingPayout } from "@/lib/payments/types";

/** Join per-currency buckets for display; null means "show the zero state". */
function formatBuckets(buckets: MoneyAmount[], locale: Locale): string | null {
  if (buckets.length === 0) return null;
  return buckets
    .map((bucket) => formatCents(bucket.amountCents, bucket.currency, locale))
    .join(" · ");
}

function Tile({
  label,
  value,
  zeroText,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string | null;
  zeroText: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={cn(cardClass, "p-4")}>
      <span className="font-inter text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="mt-2">
        {value ? (
          <p
            className={
              emphasis
                ? "truncate text-3xl font-bold text-foreground sm:text-4xl"
                : "truncate text-2xl font-semibold text-foreground"
            }
          >
            {value}
          </p>
        ) : (
          <p className="text-base font-medium text-muted-foreground">{zeroText}</p>
        )}
        {hint && (
          <p className="mt-1 font-inter text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
    </div>
  );
}

/**
 * The headline money tiles: available now, pending clearance, the next
 * scheduled payout and, where the store's fees are known, what Square Share
 * took this month. All amounts arrive as integer cents and go through the
 * shared formatter; empty buckets render calm zero states, never €0.00.
 */
export function BalanceSummary({
  balance,
  upcomingPayout,
  feesThisMonth,
}: {
  balance: Balance;
  upcomingPayout: UpcomingPayout;
  /** What the store paid Square Share this month, per currency, after
   *  refunds (the fee ledger). Null or absent when it is not known, and the
   *  tile is then left out rather than drawn empty. */
  feesThisMonth?: MoneyAmount[] | null;
}) {
  const t = useTranslations("Payments.balance");
  const locale = useLocale();
  const showFees = feesThisMonth != null;
  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", showFees ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
      {/* A hint explains a figure. Under a zero state it contradicts it
          ("Nothing to pay out yet" over "Ready for your next payout"), so it
          only appears when there is a figure to explain. */}
      <Tile
        label={t("available.label")}
        value={formatBuckets(balance.available, locale)}
        zeroText={t("available.zero")}
        hint={balance.available.length > 0 ? t("available.hint") : undefined}
        emphasis
      />
      <Tile
        label={t("pending.label")}
        value={formatBuckets(balance.pending, locale)}
        zeroText={t("pending.zero")}
        hint={balance.pending.length > 0 ? t("pending.hint") : undefined}
      />
      <Tile
        label={t("nextPayout.label")}
        value={
          upcomingPayout
            ? formatCents(upcomingPayout.amountCents, upcomingPayout.currency, locale)
            : null
        }
        zeroText={t("nextPayout.zero")}
        hint={
          upcomingPayout
            ? t("nextPayout.hint", { date: formatOrderDate(upcomingPayout.expectedAt, locale) })
            : undefined
        }
      />
      {showFees && (
        <div data-fees-this-month="">
          <Tile
            label={t("fees.label")}
            value={formatBuckets(feesThisMonth, locale)}
            zeroText={t("fees.zero")}
            hint={feesThisMonth.length > 0 ? t("fees.hint") : undefined}
          />
        </div>
      )}
    </div>
  );
}
