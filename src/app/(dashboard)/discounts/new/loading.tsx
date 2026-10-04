import { DiscountFormSkeleton } from "@/components/discounts/DiscountsSkeleton";

/** The form's shape while its products load (and not the list's, which the
 *  parent route's loading state would otherwise show here). */
export default function NewDiscountLoading() {
  return <DiscountFormSkeleton />;
}
