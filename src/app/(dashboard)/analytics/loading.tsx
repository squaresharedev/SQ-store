import { useTranslations } from "next-intl";
import { pageShellClass } from "@/components/ui/surface-styles";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
import { AnalyticsSkeleton } from "@/components/analytics/AnalyticsSkeleton";

/** Route-level loading state while the server aggregates orders. */
export default function AnalyticsLoading() {
  // The page's own heading, so nothing changes under the seller's eyes when
  // the data lands.
  const t = useTranslations("Analytics.page");
  return (
    <main className={cn(pageShellClass, "space-y-6")}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />
      <AnalyticsSkeleton />
    </main>
  );
}
