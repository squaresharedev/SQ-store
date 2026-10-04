import { useTranslations } from "next-intl";
import { pageShellClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { DiscountsSkeleton } from "@/components/discounts/DiscountsSkeleton";

/** Route-level loading state while the server reads the discounts. */
export default function DiscountsLoading() {
  const t = useTranslations("Discounts.page");
  return (
    <main className={cn(pageShellClass, "space-y-6")}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <DiscountsSkeleton />
    </main>
  );
}
