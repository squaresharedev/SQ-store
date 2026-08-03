import { ProductFormSkeleton } from "@/components/products/ProductFormSkeleton";

/** Same reason as the edit route: otherwise the products LIST skeleton shows. */
export default function NewProductLoading() {
  return <ProductFormSkeleton title="New product" />;
}
