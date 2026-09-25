import { useTranslations } from "next-intl";
import { pageShellClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrdersSkeleton } from "@/components/orders/OrdersSkeleton";

/** Route-level loading state while the server queries orders. */
export default function OrdersLoading() {
  const t = useTranslations("Orders.loading");
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
