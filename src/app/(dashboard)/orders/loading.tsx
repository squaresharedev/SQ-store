import { useTranslations } from "next-intl";
import { pageShellClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersSkeleton } from "@/components/orders/OrdersSkeleton";

/** Route-level loading state while the server queries orders. */
export default function OrdersLoading() {
  // The page's own heading, so nothing changes when the data lands.
  const t = useTranslations("Orders.page");
  return (
    <main className={cn(pageShellClass, "space-y-6")}>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />
      <OrdersSkeleton />
    </main>
  );
}
