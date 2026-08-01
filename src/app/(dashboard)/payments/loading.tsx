/** Route-level loading state while the payments overview is assembled. */
export default function PaymentsLoading() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
          Payments
        </h1>
        <p className="mt-1 font-inter text-sm text-muted-foreground">
          Your balance, payouts and Stripe connection.
        </p>
      </div>

      <span className="sr-only">loading payments</span>

      {/* Balance tiles */}
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 shadow-xs"
          >
            <div className="h-3 w-24 animate-pulse rounded-sm bg-secondary motion-reduce:animate-none" />
            <div className="h-8 w-32 animate-pulse rounded-sm bg-secondary motion-reduce:animate-none" />
          </div>
        ))}
      </div>

      {/* Activity list */}
      <div aria-hidden="true" className="rounded-md border border-border bg-card">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
          >
            <div className="h-3 w-1/3 animate-pulse rounded-sm bg-secondary motion-reduce:animate-none" />
            <div className="h-3 w-16 animate-pulse rounded-sm bg-secondary motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </main>
  );
}
