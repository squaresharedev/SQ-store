import { Globe } from "lucide-react";

// Buyer demographics (country) — honestly pending: orders carry no buyer
// country today (no such column in the orders contract, and inventing one
// would fake data). The card holds the layout slot so the module lands
// without a reshuffle once checkout starts capturing buyer country.
// TODO(analytics-events): live once checkout records buyer country.

/** "Coming soon" placeholder card for the country demographics module. */
export function DemographicsCard() {
  return (
    <div className="rounded-md border border-dashed border-border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Buyer countries
          </h2>
          <p className="font-inter text-sm text-muted-foreground">
            Where your buyers are.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 font-inter text-xs text-muted-foreground">
          Coming soon
        </span>
      </div>

      <div className="mt-4 flex h-64 flex-col items-center justify-center gap-2">
        <Globe className="size-5 text-muted-foreground/60" aria-hidden="true" />
        <p className="max-w-xs text-center font-inter text-sm text-muted-foreground">
          Country breakdowns arrive once checkout starts recording where buyers
          purchase from. No invented numbers in the meantime.
        </p>
      </div>
    </div>
  );
}
