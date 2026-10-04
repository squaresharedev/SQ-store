import { useTranslations } from "next-intl";
import { pageBleedShellClass, pageGutterClass } from "@/components/ui/surface-styles";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
import { AnalyticsSkeleton } from "@/components/analytics/AnalyticsSkeleton";

/** Route-level loading state while the server aggregates orders. */
export default function AnalyticsLoading() {
  const t = useTranslations("Analytics.loading");
  return (
    // The same gutterless shell as the page, so nothing shifts sideways when
    // the data lands.
    <main className={cn(pageBleedShellClass, "space-y-6")}>
      <PageHeader
        className={pageGutterClass}
        title={t("title")}
        subtitle={t("subtitle")}
      />
      <AnalyticsSkeleton />
    </main>
  );
}
