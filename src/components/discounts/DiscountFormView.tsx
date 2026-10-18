import { useTranslations } from "next-intl";
import { BackLink } from "@/components/ui/BackLink";
import { DISCOUNTS_PATH } from "@/lib/discounts/paths";
import type { DiscountProductChoice, DiscountView } from "@/types/discount";
import { DiscountForm } from "./DiscountForm";

/**
 * The page around the discount form, for the create and edit routes: the way
 * back, the heading, the form. Server-safe; only DiscountForm is a client
 * component.
 */
export function DiscountFormView({
  discount,
  products,
  chipHref,
}: {
  discount: DiscountView | null;
  products: readonly DiscountProductChoice[];
  /** See DiscountForm. */
  chipHref: string | null;
}) {
  const t = useTranslations("Discounts.form");
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <BackLink href={DISCOUNTS_PATH}>{t("back")}</BackLink>
      <h1
        className="mb-8 mt-4 text-2xl font-semibold text-foreground md:text-3xl"
        data-discount-kind-fixed={discount?.kind}
      >
        {discount ? t(discount.kind === "code" ? "editCode" : "editSale") : t("newTitle")}
      </h1>
      <DiscountForm discount={discount} products={products} chipHref={chipHref} />
    </main>
  );
}
