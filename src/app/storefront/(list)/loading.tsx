import { useTranslations } from "next-intl";
import { pageShellClass } from "@/components/ui/surface-styles";
import { PageHeader } from "@/components/layout/PageHeader";
import { CardGridSkeleton } from "@/components/ui/CardGridSkeleton";

/** Route-level loading state while the server queries storefronts. */
export default function StorefrontsLoading() {
  const t = useTranslations("Storefront.metadata");
  return (
    <main className={pageShellClass}>
      <PageHeader
        className="mb-6"
        title={t("storefronts.title")}
        subtitle={t("storefronts.subtitle")}
      />
      <CardGridSkeleton loadingLabel="Storefront.routes.list.loading" cards={4} />
    </main>
  );
}
