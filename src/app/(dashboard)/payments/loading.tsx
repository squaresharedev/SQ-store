import { Skeleton } from "@/components/ui/skeleton";
import { cardClass, pageShellClass } from "@/components/ui/surface-styles";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
/** Route-level loading state while the payments overview is assembled. */
export default function PaymentsLoading() {
  return (
    <main className={cn(pageShellClass, "space-y-6")}>
      <PageHeader
        title="Payments"
        subtitle="Your balance, payouts and Stripe connection."
      />

      <span className="sr-only">loading payments</span>

      {/* Balance tiles */}
      <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className={cn(cardClass, "flex flex-col gap-3 p-4")}
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-32" />
          </div>
        ))}
      </div>

      {/* Activity list */}
      <div aria-hidden="true" className={cardClass}>
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
          >
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </main>
  );
}
