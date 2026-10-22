import { useTranslations, useLocale } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";
import { cardClass, eyebrowClass } from "@/components/ui/surface-styles";
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

/** A secondary figure beside the headline: its name and what it means, and the amount. */
function FigureRow({
  label,
  value,
  zeroText,
  hint,
  ...rest
}: {
  label: string;
  value: string | null;
  zeroText: string;
  /** Explains a figure, so only given when there is one: under a zero state it would contradict it. */
  hint?: string;
} & React.ComponentProps<"div">) {
  return (
    <div {...rest} className="flex items-baseline justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className={eyebrowClass}>{label}</p>
        {hint && <p className="mt-0.5 font-inter text-xs text-muted-foreground">{hint}</p>}
      </div>
      <p
        className={cn(
          "shrink-0 text-lg font-semibold",
          value ? "text-foreground" : "text-sm font-medium text-muted-foreground",
        )}
      >
        {value ?? zeroText}
      </p>
    </div>
  );
}

/**
 * The balance, first and as one card. What can be taken out leads: the
 * available figure large, with the next payout under it. What is still
 * clearing and, where the store's fees are known, what Square Share took this
 * month sit beside it as a quiet ledger. All amounts arrive as integer cents
 * and go through the shared formatter; empty buckets render calm zero states,
 * never €0.00.
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
   *  row is then left out rather than drawn empty. */
  feesThisMonth?: MoneyAmount[] | null;
}) {
  const t = useTranslations("Payments.balance");
  const locale = useLocale();
  const available = formatBuckets(balance.available, locale);
  return (
    <section className={cn(cardClass, "grid grid-cols-1 lg:grid-cols-[3fr_2fr]")}>
      <div className="p-5 sm:p-6">
        <p className={cn(eyebrowClass, "tracking-widest")}>{t("available.label")}</p>
        {available ? (
          <p className="mt-2 truncate text-4xl font-bold text-foreground sm:text-5xl">{available}</p>
        ) : (
          <p className="mt-2 text-base font-medium text-muted-foreground">{t("available.zero")}</p>
        )}
        <p className="mt-3 font-inter text-sm text-muted-foreground">
          {upcomingPayout ? (
            <>
              {t("nextPayout.label")}:{" "}
              <span className="font-medium text-foreground">
                {formatCents(upcomingPayout.amountCents, upcomingPayout.currency, locale)}
              </span>{" "}
              · {t("nextPayout.hint", { date: formatOrderDate(upcomingPayout.expectedAt, locale) })}
            </>
          ) : (
            t("nextPayout.zero")
          )}
        </p>
      </div>
      <div className="divide-y divide-border border-t border-border lg:border-l lg:border-t-0">
        <FigureRow
          label={t("pending.label")}
          value={formatBuckets(balance.pending, locale)}
          zeroText={t("pending.zero")}
          hint={balance.pending.length > 0 ? t("pending.hint") : undefined}
        />
        {feesThisMonth != null && (
          <FigureRow
            data-fees-this-month=""
            label={t("fees.label")}
            value={formatBuckets(feesThisMonth, locale)}
            zeroText={t("fees.zero")}
            hint={feesThisMonth.length > 0 ? t("fees.hint") : undefined}
          />
        )}
      </div>
    </section>
  );
}
