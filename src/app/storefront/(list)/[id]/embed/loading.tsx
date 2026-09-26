import { useTranslations } from "next-intl";
import { pageColumnNarrowClass, pageShellClass } from "@/components/ui/surface-styles";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/layout/PageHeader";
import { STOREFRONT_LIST_PATH } from "@/lib/storefront/paths";

/** The header stands in for the page while the storefront loads, so the title
 *  and back link do not move when the settings arrive. */
export default function StorefrontEmbedLoading() {
  const t = useTranslations("Storefront.embed");
  const tDesigner = useTranslations("Storefront.designer.header");
  return (
    <main className={pageShellClass}>
      <div className={pageColumnNarrowClass}>
        <BackLink href={STOREFRONT_LIST_PATH}>{tDesigner("back")}</BackLink>
        <PageHeader className="mb-6 mt-4 text-center" title={t("title")} />
      </div>
    </main>
  );
}
