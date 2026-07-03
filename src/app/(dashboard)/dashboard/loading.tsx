/** Route-level loading state: pulsing placeholders in the final layout's
 *  shape, so the page does not jump when data arrives. */
export default function DashboardOverviewLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div className="h-9 w-40 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
          />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-64 animate-pulse rounded-md bg-muted motion-reduce:animate-none lg:col-span-2" />
        <div className="h-64 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      </div>
      <span className="sr-only">Loading overview…</span>
    </div>
  );
}
