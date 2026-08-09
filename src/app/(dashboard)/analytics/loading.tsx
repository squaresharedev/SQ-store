import { pageShellClass } from "@/components/ui/surface-styles";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
import { AnalyticsSkeleton } from "@/components/analytics/AnalyticsSkeleton";

/** Route-level loading state while the server aggregates orders. */
export default function AnalyticsLoading() {
  return (
    <main className={cn(pageShellClass, "space-y-6")}>
      <PageHeader
        title="Analytics"
        subtitle="How your store is performing across the embed and the marketplace."
      />
      <AnalyticsSkeleton />
    </main>
  );
}
