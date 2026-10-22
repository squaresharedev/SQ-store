import { useTranslations } from "next-intl";
import { pageShellClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/layout/PageHeader";
import { STOREFRONT_LIST_PATH } from "@/lib/storefront/paths";

/** The header stands in for the page while the storefront loads, so the title
 *  and back link do not move when the settings arrive. */
export default function StorefrontEmbedLoading() {
  const t = useTranslations("Storefront.embed");
  const tDesigner = useTranslations("Storefront.designer.header");
  return (
    <main className={cn(pageShellClass, "space-y-6")}>
      <BackLink href={STOREFRONT_LIST_PATH}>{tDesigner("back")}</BackLink>
      <PageHeader title={t("title")} />
    </main>
  );
}
