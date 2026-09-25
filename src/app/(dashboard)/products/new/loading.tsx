import { useTranslations } from "next-intl";
import { ProductFormSkeleton } from "@/components/products/ProductFormSkeleton";

/** Same reason as the edit route: otherwise the products LIST skeleton shows. */
export default function NewProductLoading() {
  const t = useTranslations("Products.page.new");
  return <ProductFormSkeleton title={t("title")} />;
}
