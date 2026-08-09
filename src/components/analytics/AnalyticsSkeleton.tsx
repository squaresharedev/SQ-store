import { Skeleton } from "@/components/ui/skeleton";
import { cardClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";

/**
 * Module-level loading skeleton mirroring the analytics layout: controls
 * bar, five metric tiles, one full-width chart card and a 2-col pair below.
 */
export function AnalyticsSkeleton() {
  return (
    <div
      className="flex flex-col gap-4"
      aria-hidden="true"
    >
      <span className="sr-only">loading analytics</span>

      {/* Range controls placeholder */}
      <Skeleton className="h-9 w-64" />

      {/* Metric tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className={cn(cardClass, "flex flex-col gap-3 p-4")}
          >
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>

      {/* Full-width chart card */}
      <div className={cn(cardClass, "p-4")}>
        <Skeleton className="h-64" />
      </div>

      {/* Secondary chart pairs */}
      {Array.from({ length: 3 }, (_, row) => (
        <div key={row} className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className={cn(cardClass, "p-4")}>
              <Skeleton className="h-64" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
