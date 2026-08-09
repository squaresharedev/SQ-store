import { Skeleton } from "@/components/ui/skeleton";
import { pageShellClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";

/** Route-level loading state: pulsing placeholders in the final layout's
 *  shape, so the page does not jump when data arrives. */
export default function DashboardOverviewLoading() {
  return (
    <div className={cn(pageShellClass, "space-y-6")}>
      <Skeleton className="h-9 w-40" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-md" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-md lg:col-span-2" />
        <Skeleton className="h-64 rounded-md" />
      </div>
      <span className="sr-only">Loading overview…</span>
    </div>
  );
}
