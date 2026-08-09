import { Skeleton } from "@/components/ui/skeleton";

export function OrdersSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="border border-border bg-card">
      <span className="sr-only">loading orders</span>

      {/* Header bar */}
      <div className="border-b border-border px-4 py-3" aria-hidden="true">
        <Skeleton className="h-4 w-1/3" />
      </div>

      {/* Row bars */}
      <ul aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
          >
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-3 w-12" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
