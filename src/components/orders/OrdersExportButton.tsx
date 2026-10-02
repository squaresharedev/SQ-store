"use client";

import * as React from "react";
import Link from "next/link";
import { Download, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, buttonClassName } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/Toast";
import { lastUsedBadgeClass } from "@/components/ui/control-styles";
import { attachmentFileName, saveFile } from "@/lib/utils/save-file";
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
 * On a plan with the perk, it fetches the file and saves it in place, so an
 * error (a rate limit, a failed read) is a toast on this page rather than a
 * browser tab of JSON. On a plan without it, the same button, locked, and a
 * link to the plans page naming the plan that has it: the feature is shown
 * where it would be used, never hidden. The route re-checks the plan either
 * way; this only decides what to show.
 */
export function OrdersExportButton({ enabled }: { enabled: boolean }) {
  const t = useTranslations("Orders.export");
  const tBilling = useTranslations("Billing");
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

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
        {t("button")}
        <span className={lastUsedBadgeClass}>{plan}</span>
      </Link>
    );
  }

  async function download() {
    setBusy(true);
    try {
      const response = await fetch(ORDERS_EXPORT_PATH, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string; fix?: string } | null;
        toast.error(body?.error ?? t("failed"), { lines: body?.fix ? [body.fix] : undefined });
        return;
      }
      saveFile(await response.blob(), attachmentFileName(response) ?? t("fileName"));
      const cap = response.headers.get(ORDERS_EXPORT_TRUNCATED_HEADER);
      if (cap) toast.info(t("truncated", { count: Number(cap) }));
    } catch {
      toast.error(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" disabled={busy} onClick={download} data-orders-export="ready">
      {busy ? <Spinner /> : <Download className="size-4" strokeWidth={2} aria-hidden />}
      {busy ? t("preparing") : t("button")}
    </Button>
  );
}
