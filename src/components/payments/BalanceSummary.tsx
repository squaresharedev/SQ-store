import { formatCents } from "@/lib/format/money";
import { formatOrderDate } from "@/lib/format/date";
import type { Balance, MoneyAmount, UpcomingPayout } from "@/lib/payments/types";

/** Join per-currency buckets for display; null means "show the zero state". */
function formatBuckets(buckets: MoneyAmount[]): string | null {
  if (buckets.length === 0) return null;
  return buckets
    .map((bucket) => formatCents(bucket.amountCents, bucket.currency))
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
    <div className="rounded-md border border-border bg-card p-4 shadow-xs">
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
 * The three headline money tiles: available now, pending clearance, and the
 * next scheduled payout. All amounts arrive as integer cents and go through
 * the shared formatter; empty buckets render calm zero states, never €0.00.
 */
export function BalanceSummary({
  balance,
  upcomingPayout,
}: {
  balance: Balance;
  upcomingPayout: UpcomingPayout;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Tile
        label="Available"
        value={formatBuckets(balance.available)}
        zeroText="Nothing to pay out yet"
        hint="Ready for your next payout"
        emphasis
      />
      <Tile
        label="Pending"
        value={formatBuckets(balance.pending)}
        zeroText="No pending sales"
        hint="Clearing from recent sales"
      />
      <Tile
        label="Next payout"
        value={
          upcomingPayout
            ? formatCents(upcomingPayout.amountCents, upcomingPayout.currency)
            : null
        }
        zeroText="No payout scheduled"
        hint={
          upcomingPayout
            ? `Expected ${formatOrderDate(upcomingPayout.expectedAt)}`
            : undefined
        }
      />
    </div>
  );
}
