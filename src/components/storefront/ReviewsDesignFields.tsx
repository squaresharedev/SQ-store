"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { isProductPageSectionShown, normalizeSections } from "@/lib/storefront/product-page";
import { DEFAULT_PRODUCT_PAGE_STAR_COLOR, type ProductPageConfig } from "@/types/storefront";
import { panelCaptionClass, panelSettingClass } from "@/components/ui/control-styles";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { Switch } from "@/components/ui/switch";

/**
 * HOW BUYERS' REVIEWS LOOK ON THIS STOREFRONT: whether the section shows, and
 * the colour of the stars, both the section's and the rating under the title.
 * The inherit dot is the way back to yellow, and it deletes the key rather than
 * storing the yellow, so an untouched page never grows one.
 *
 * Shared by the designer's Product page panel and the /dev/checkout harness.
 */
export function ReviewsDesignFields({
  productPage,
  onProductPageChange,
}: {
  productPage: ProductPageConfig;
  onProductPageChange: (next: ProductPageConfig) => void;
}) {
  const fieldId = useId();
  const t = useTranslations("Storefront.productPage.reviews");

  return (
    <div className="space-y-5" data-reviews-design="">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${fieldId}-show`} className={cn(panelSettingClass, "min-w-0 flex-1 truncate")}>
          {t("show")}
        </label>
        <Switch
          id={`${fieldId}-show`}
          checked={isProductPageSectionShown(productPage, "reviews")}
          // Over the normalised rows: a config saved before the section existed
          // has no entry for it, and mapping the stored list would do nothing.
          onCheckedChange={(show) =>
            onProductPageChange({
              ...productPage,
              sections: normalizeSections(productPage.sections).map((entry) =>
                entry.id === "reviews" ? { ...entry, show } : entry,
              ),
            })
          }
        />
      </div>

      <ColorPicker
        label={t("starColor")}
        labelClassName={panelCaptionClass}
        value={productPage.starColor ?? DEFAULT_PRODUCT_PAGE_STAR_COLOR}
        onChange={(starColor) => onProductPageChange({ ...productPage, starColor })}
        inherit={{
          label: t("defaultStarColor"),
          useLabel: t("useDefaultStarColor"),
          value: DEFAULT_PRODUCT_PAGE_STAR_COLOR,
          active: productPage.starColor === undefined,
          onSelect: () => {
            const { starColor, ...rest } = productPage;
            void starColor;
            onProductPageChange(rest);
          },
        }}
      />
    </div>
  );
}
