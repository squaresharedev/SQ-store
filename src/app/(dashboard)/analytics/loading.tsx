import { AnalyticsSkeleton } from "@/components/analytics/AnalyticsSkeleton";

/** Route-level loading state while the server aggregates orders. */
export default function AnalyticsLoading() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
          Analytics
        </h1>
        <p className="mt-1 font-inter text-sm text-muted-foreground">
          How your store is performing across the embed and the marketplace.
        </p>
      </div>
      <AnalyticsSkeleton />
    </main>
  );
}
