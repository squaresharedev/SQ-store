import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pageShellClass } from "@/components/ui/surface-styles";
import { primaryButtonClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { DiscountsPage } from "@/components/discounts/DiscountsPage";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import {
  getArchivedDiscountLabels,
  getDiscountPerformance,
  listDiscounts,
} from "@/lib/discounts/queries";
import { summarizeDiscounts } from "@/lib/discounts/summary";
import { NEW_DISCOUNT_PATH } from "@/lib/discounts/paths";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Discounts.metadata");
  return { title: t("title") };
}

// PROTECTED by (dashboard)/layout.tsx. Every read is scoped to the active
// store (lib/discounts/queries.ts); anyone on the team may look, and only
// owners and editors get the controls (the actions re-check regardless).
export default async function DiscountsRoute() {
  const [account, discounts, performance, t] = await Promise.all([
    getActiveAccount(),
    listDiscounts(),
    getDiscountPerformance(),
    getTranslations("Discounts.page"),
  ]);
  const canWrite = can(account?.role, "products.write");

  // Deleted discounts that still have orders: their sales still count under
  // the channel they came from.
  const live = new Set(discounts.map((discount) => discount.id));
  const archived = await getArchivedDiscountLabels([...performance.keys()].filter((id) => !live.has(id)));
  const summary = summarizeDiscounts(discounts, performance, archived);

  return (
    <main className={cn(pageShellClass, "space-y-6")}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          canWrite && summary.items.length > 0 ? (
            <Link href={NEW_DISCOUNT_PATH} className={primaryButtonClass}>
              {t("create")}
            </Link>
          ) : undefined
        }
      />
      <DiscountsPage summary={summary} canWrite={canWrite} />
    </main>
  );
}
