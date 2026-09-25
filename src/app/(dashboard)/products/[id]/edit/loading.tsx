import { useTranslations } from "next-intl";
import { ProductFormSkeleton } from "@/components/products/ProductFormSkeleton";

/**
 * Without this, `products/loading.tsx` applies here (a loading.tsx covers every
 * nested route), so editing a product flashed the products LIST skeleton.
 */
export default function EditProductLoading() {
  const t = useTranslations("Products.page.edit");
  return <ProductFormSkeleton title={t("title")} />;
}
