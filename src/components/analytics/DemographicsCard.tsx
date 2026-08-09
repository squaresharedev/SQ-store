import { Globe } from "lucide-react";
import { helpTextClass } from "@/components/ui/control-styles";
import { badgeClass, cardClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";

// Buyer demographics (country) — honestly pending: orders carry no buyer
// country today (no such column in the orders contract, and inventing one
// would fake data). The card holds the layout slot so the module lands
// without a reshuffle once checkout starts capturing buyer country.
// TODO(analytics-events): live once checkout records buyer country.

/** "Coming soon" placeholder card for the country demographics module. */
export function DemographicsCard() {
  return (
    <div className={cn(cardClass, "border-dashed p-4")}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            Buyer countries
          </h2>
          <p className={helpTextClass}>
            Where your buyers are.
          </p>
        </div>
        <span className={cn(badgeClass, "shrink-0 font-normal text-muted-foreground")}>
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
