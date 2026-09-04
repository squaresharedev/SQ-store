import { TriangleAlert } from "lucide-react";
import { cardClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";

/**
 * The signal read failed, and the page says so.
 *
 * Revenue comes from a different query and is already correct above this, so
 * failing the whole page would take a working answer away to report a broken
 * one. What must NOT happen is the other outcome: rendering "0 views" from a
 * read that never returned. A store with no traffic and a counter that could
 * not be reached look identical on a chart, and only one of them is worth
 * acting on.
 *
 * Inline rather than a toast, per §8.12: this is a page state the reader may
 * need to re-read, not the outcome of something they just did.
 */
export function SignalsUnavailableNotice() {
  return (
    <div
      className={cn(cardClass, "flex items-start gap-3 border-dashed p-4")}
      role="status"
      data-analytics-section="signals"
      data-analytics-state="unavailable"
    >
      <TriangleAlert
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-foreground">
          Views and signups are unavailable right now
        </h2>
        <p className="mt-1 font-inter text-sm text-muted-foreground">
          Your sales figures above are unaffected. Reload the page to try again.
        </p>
      </div>
    </div>
  );
}
