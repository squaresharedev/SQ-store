"use client";

import Link from "@/components/ui/AppLink";
import { Plus } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { topBarIconButtonClass } from "@/components/ui/control-styles";
import { OVERVIEW_PATH } from "@/lib/dashboard/paths";
import { NEW_PRODUCT_PATH } from "@/lib/products/paths";

/**
 * A compact icon-button that appears in the mobile top bar only on the Overview
 * page. Gives sellers a direct Add product shortcut without navigating to
 * Products first (the desktop version is in DashboardHome's header row).
 *
 * Uses usePathname so it renders only on /dashboard; on every other page it
 * returns null and costs nothing. The shell leaves it out for anyone who may
 * not add products (a viewer-role teammate), like the desktop button.
 */
export function OverviewAddButton() {
  const pathname = usePathname();
  const t = useTranslations("Dashboard.overview");
  if (pathname !== OVERVIEW_PATH) return null;
  return (
    <Link href={NEW_PRODUCT_PATH} aria-label={t("addProduct")} className={topBarIconButtonClass}>
      <Plus className="size-5" strokeWidth={2} aria-hidden="true" />
    </Link>
  );
}
