import { cn } from "@/lib/utils";
import { cardClass, skeletonClass } from "@/components/ui/surface-styles";

/** The list's shape while the discounts load: three row-sized cards. */
export function DiscountsSkeleton() {
  return (
    <ul className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <li key={row} className={cn(cardClass, "flex flex-col gap-2 p-4")}>
          <span className={cn(skeletonClass, "h-4 w-20")} />
          <span className={cn(skeletonClass, "h-6 w-40")} />
          <span className={cn(skeletonClass, "h-4 w-64")} />
        </li>
      ))}
    </ul>
  );
}

/** The form's sections as placeholders. Also what the form itself draws for
 *  the moment before the browser has said what time (and time zone) it is. */
export function DiscountFormSectionsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      {[0, 1, 2].map((section) => (
        <div key={section} className="flex flex-col gap-3 border border-border p-6">
          <span className={cn(skeletonClass, "h-5 w-40")} />
          <span className={cn(skeletonClass, "h-10 w-full")} />
        </div>
      ))}
    </div>
  );
}

/** The form's page while the products it offers load. */
export function DiscountFormSkeleton() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8" aria-hidden="true">
      <span className={cn(skeletonClass, "block h-4 w-32")} />
      <span className={cn(skeletonClass, "mb-8 mt-4 block h-8 w-56")} />
      <DiscountFormSectionsSkeleton />
    </main>
  );
}
