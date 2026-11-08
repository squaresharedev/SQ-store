import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { joinedCardsClass, joinedCellClass, pageShellClass, sharpCardClass } from "@/components/ui/surface-styles";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
/** Route-level loading state while the payments overview is assembled. */
export default function PaymentsLoading() {
  const t = useTranslations("Dashboard.loading.payments");
  return (
    <main className={cn(pageShellClass, "space-y-6")}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />

      <span className="sr-only">{t("srLoading")}</span>

      {/* Balance */}
      <div aria-hidden="true" className={cn(sharpCardClass, "flex flex-col gap-3 p-5 sm:p-6")}>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-3 w-64 max-w-full" />
      </div>

      {/* Earnings chart and trend tiles */}
      <div aria-hidden="true" className={joinedCardsClass}>
        <div className={cn(joinedCellClass,"flex flex-col gap-3 p-5 sm:p-6")}>
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-10 w-48" />
          <Skeleton className="mt-4 h-52 w-full" />
        </div>
        <div className="grid grid-cols-2 gap-px lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className={cn(joinedCellClass, "flex flex-col gap-3 p-4")}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-28 max-w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Activity list */}
      <div aria-hidden="true" className={sharpCardClass}>
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
