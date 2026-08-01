/** Route-level loading state while the first page of notifications is read. */
export default function NotificationsLoading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 md:px-6 md:py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          Notifications
        </h1>
      </div>

      <span className="sr-only">loading notifications</span>

      <ul aria-hidden="true" className="rounded-md border border-border bg-card">
        {Array.from({ length: 6 }, (_, index) => (
          <li
            key={index}
            className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
          >
            <div className="mt-0.5 size-8 shrink-0 animate-pulse rounded-full bg-secondary motion-reduce:animate-none" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="h-3.5 w-2/3 animate-pulse rounded-sm bg-secondary motion-reduce:animate-none" />
              <div className="h-3 w-1/4 animate-pulse rounded-sm bg-secondary motion-reduce:animate-none" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
