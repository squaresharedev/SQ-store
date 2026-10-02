"use client";

import Link from "next/link";
import { Download, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonClassName } from "@/components/ui/button";
import { lastUsedBadgeClass } from "@/components/ui/control-styles";
import { saveFile } from "@/lib/utils/save-file";
import { CSV_CONTENT_TYPE } from "@/lib/format/csv";
import { analyticsReportCsv, analyticsReportFileName } from "@/lib/analytics/report-csv";
import type { AnalyticsSnapshot } from "@/lib/analytics/types";
import { cheapestPlanWith } from "@/lib/billing/features";
import { plansHref } from "@/lib/billing/paths";

/** The plan a locked report names, read from the catalog. */
const REPORT_PLAN = cheapestPlanWith("analyticsExport");

/**
 * "Download report" in the Analytics page header: the figures for the chosen
 * range as a CSV (lib/analytics/report-csv.ts), built from the page's own
 * snapshot, so nothing is fetched and the file matches the screen.
 *
 * On a plan without the perk, the same button, locked, linking to the plans
 * page and naming the plan that has it. The figures themselves stay visible
 * to everyone; only the download is the plan's to give.
 */
export function AnalyticsExportButton({ enabled, snapshot }: { enabled: boolean; snapshot: AnalyticsSnapshot }) {
  const t = useTranslations("Analytics.export");
  const tBilling = useTranslations("Billing");

  if (!enabled) {
    const plan = tBilling(`plans.${REPORT_PLAN}.name`);
    return (
      <Link
        href={plansHref("analytics_nudge")}
        className={buttonClassName("secondary")}
        title={t("lockedTitle", { plan })}
        data-analytics-export="locked"
      >
        <Lock className="size-4" strokeWidth={2} aria-hidden />
        {t("button")}
        <span className={lastUsedBadgeClass}>{plan}</span>
      </Link>
    );
  }

  return (
    <Button
      variant="secondary"
      data-analytics-export="ready"
      onClick={() => saveFile(analyticsReportCsv(snapshot), analyticsReportFileName(snapshot), CSV_CONTENT_TYPE)}
    >
      <Download className="size-4" strokeWidth={2} aria-hidden />
      {t("button")}
    </Button>
  );
}
