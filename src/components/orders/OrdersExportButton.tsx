"use client";

import Link from "@/components/ui/AppLink";
import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonClassName } from "@/components/ui/button";
import { DownloadButton } from "@/components/ui/DownloadButton";
import { lastUsedBadgeClass } from "@/components/ui/control-styles";
import { cheapestPlanWith } from "@/lib/billing/features";
import { plansHref } from "@/lib/billing/paths";
import { ORDERS_EXPORT_PATH } from "@/lib/orders/paths";
import { ORDERS_EXPORT_TRUNCATED_HEADER } from "@/lib/orders/csv";

/** The plan a locked export names, read from the catalog. */
const EXPORT_PLAN = cheapestPlanWith("ordersExport");

/**
 * "Export CSV" at the top of the Orders page: the store's orders as a file
 * for its bookkeeping (app/api/orders/export).
 *
 * On a plan with the perk, it fetches the file and saves it in place
 * (ui/DownloadButton). On a plan without it, the same button, locked, and a
 * link to the plans page naming the plan that has it: the feature is shown
 * where it would be used, never hidden. The route re-checks the plan either
 * way; this only decides what to show.
 */
export function OrdersExportButton({ enabled }: { enabled: boolean }) {
  const t = useTranslations("Orders.export");
  const tExport = useTranslations("Common.export");
  const tBilling = useTranslations("Billing");

  if (!enabled) {
    const plan = tBilling(`plans.${EXPORT_PLAN}.name`);
    return (
      <Link
        href={plansHref("orders_export")}
        className={buttonClassName("secondary")}
        title={t("lockedTitle", { plan })}
        data-orders-export="locked"
      >
        <Lock className="size-4" strokeWidth={2} aria-hidden />
        {tExport("button")}
        <span className={lastUsedBadgeClass}>{plan}</span>
      </Link>
    );
  }

  return (
    <DownloadButton
      href={ORDERS_EXPORT_PATH}
      fallbackFileName={t("fileName")}
      truncated={{ header: ORDERS_EXPORT_TRUNCATED_HEADER, message: (count) => t("truncated", { count }) }}
      data-orders-export="ready"
    />
  );
}
