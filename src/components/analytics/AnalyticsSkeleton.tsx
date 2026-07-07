/**
 * Module-level loading skeleton mirroring the analytics layout: controls
 * bar, five metric tiles, one full-width chart card and a 2-col pair below.
 */
export function AnalyticsSkeleton() {
  return (
    <div
      className="flex flex-col gap-4 animate-pulse motion-reduce:animate-none"
      aria-hidden="true"
    >
      <span className="sr-only">loading analytics</span>

      {/* Range controls placeholder */}
      <div className="h-9 w-64 rounded-sm bg-muted" />

      {/* Metric tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
          >
            <div className="h-3 w-16 rounded-sm bg-muted" />
            <div className="h-8 w-24 rounded-sm bg-muted" />
          </div>
        ))}
      </div>

      {/* Full-width chart card */}
      <div className="rounded-md border border-border bg-card p-4">
        <div className="h-64 rounded-sm bg-muted" />
      </div>

      {/* Secondary chart pairs */}
      {Array.from({ length: 3 }, (_, row) => (
        <div key={row} className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="rounded-md border border-border bg-card p-4">
              <div className="h-64 rounded-sm bg-muted" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
