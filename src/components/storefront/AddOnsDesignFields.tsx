"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { hasContactOrPaymentDetails } from "@/lib/validation/inputs";
import { sanitizeHeaderText } from "@/lib/storefront/header-text";
import { isProductPageSectionShown, normalizeSections } from "@/lib/storefront/product-page";
import {
  DEFAULT_PRODUCT_PAGE_ADD_ON_LAYOUT,
  DEFAULT_PRODUCT_PAGE_ADD_ON_PLACEMENT,
  PRODUCT_PAGE_ADD_ON_LAYOUTS,
  PRODUCT_PAGE_ADD_ON_PLACEMENTS,
  PRODUCT_PAGE_ADD_ONS_TITLE_MAX,
  type ProductPageAddOnLayout,
  type ProductPageConfig,
} from "@/types/storefront";
import { panelSettingClass } from "@/components/ui/control-styles";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/switch";
import { AddOnsProductsField } from "./AddOnsProductsField";
import { OptionCardPicker } from "./OptionCardPicker";
import { PanelField, PanelTextField } from "./PanelField";

/** Each look's and place's name in the catalogue (the config-maps pattern:
 *  a closed list of keys rather than a key built from a string). */
const LAYOUT_LABELS = { list: "layout.list", tiles: "layout.tiles" } as const;
const PLACEMENT_LABELS = {
  beforeButton: "placement.beforeButton",
  afterButton: "placement.afterButton",
} as const;

/** The three design keys, each stored only when it is not the default. */
type AddOnKey = "addOnsTitle" | "addOnsLayout" | "addOnsPlacement";

function withoutKey(config: ProductPageConfig, key: AddOnKey): ProductPageConfig {
  const next = { ...config };
  delete next[key];
  return next;
}

/** A look, drawn: three rows, or a row of small photo tiles. The picture IS
 *  the choice, like the sale look's price line. */
function LayoutGlyph({ layout }: { layout: ProductPageAddOnLayout }) {
  if (layout === "tiles") {
    return (
      <span className="grid w-14 grid-cols-3 gap-0.5" aria-hidden="true">
        {[0, 1, 2].map((tile) => (
          <span key={tile} className="flex flex-col gap-0.5 rounded-sm border border-border p-0.5">
            <span className="aspect-square rounded-sm bg-muted" />
            <span className="h-0.5 w-3/4 rounded-full bg-muted-foreground/40" />
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="flex w-14 flex-col gap-1" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <span key={row} className="flex items-center gap-1 rounded-sm border border-border p-0.5">
          <span className="size-2.5 shrink-0 rounded-sm bg-muted" />
          <span className="h-1 flex-1 rounded-full bg-muted-foreground/40" />
        </span>
      ))}
    </span>
  );
}

/**
 * "ADD TO YOUR ORDER" IN THE DESIGNER: which products it offers (each product's
 * own choice, see AddOnsProductsField), then how it looks on this storefront:
 * whether it shows, its heading in the seller's own words, rows or tiles, and
 * whether it comes before or after Buy now.
 *
 * Shared by the designer's Product page panel and the /dev/checkout harness.
 */
export function AddOnsDesignFields({
  productPage,
  onProductPageChange,
}: {
  productPage: ProductPageConfig;
  onProductPageChange: (next: ProductPageConfig) => void;
}) {
  const fieldId = useId();
  const t = useTranslations("Storefront.productPage.addOns");
  const tRoot = useTranslations();
  const shown = isProductPageSectionShown(productPage, "addOns");
  const title = productPage.addOnsTitle;

  return (
    <div className="space-y-5" data-add-ons-design="">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${fieldId}-show`} className={cn(panelSettingClass, "min-w-0 flex-1 truncate")}>
          {t("show")}
        </label>
        <Switch
          id={`${fieldId}-show`}
          checked={shown}
          // Over the normalised rows: a config saved before the section existed
          // has no entry for it, and mapping the stored list would do nothing.
          onCheckedChange={(show) =>
            onProductPageChange({
              ...productPage,
              sections: normalizeSections(productPage.sections).map((entry) =>
                entry.id === "addOns" ? { ...entry, show } : entry,
              ),
            })
          }
        />
      </div>

      <AddOnsProductsField />

      <PanelTextField
        id={`${fieldId}-title`}
        label={t("heading.label")}
        value={title ?? ""}
        max={PRODUCT_PAGE_ADD_ONS_TITLE_MAX}
        placeholder={tRoot("ProductPage.addOns.title")}
        problem={title && hasContactOrPaymentDetails(title) ? tRoot("Validation.generic.sellerProse") : null}
        charsLeft={(count) => t("heading.charsLeft", { count })}
        onChange={(raw) => {
          const next = sanitizeHeaderText(raw, false);
          onProductPageChange(
            next.trim() === "" ? withoutKey(productPage, "addOnsTitle") : { ...productPage, addOnsTitle: next },
          );
        }}
      />

      <PanelField label={t("layout.label")}>
        <OptionCardPicker
          ariaLabel={t("layout.label")}
          value={productPage.addOnsLayout ?? DEFAULT_PRODUCT_PAGE_ADD_ON_LAYOUT}
          options={PRODUCT_PAGE_ADD_ON_LAYOUTS.map((layout) => ({
            value: layout,
            label: t(LAYOUT_LABELS[layout]),
            glyph: <LayoutGlyph layout={layout} />,
          }))}
          onChange={(layout) =>
            onProductPageChange(
              layout === DEFAULT_PRODUCT_PAGE_ADD_ON_LAYOUT
                ? withoutKey(productPage, "addOnsLayout")
                : { ...productPage, addOnsLayout: layout },
            )
          }
        />
      </PanelField>

      <PanelField label={t("placement.label")}>
        <SegmentedControl
          ariaLabel={t("placement.label")}
          value={productPage.addOnsPlacement ?? DEFAULT_PRODUCT_PAGE_ADD_ON_PLACEMENT}
          options={PRODUCT_PAGE_ADD_ON_PLACEMENTS.map((placement) => ({
            value: placement,
            label: t(PLACEMENT_LABELS[placement]),
          }))}
          onChange={(placement) =>
            onProductPageChange(
              placement === DEFAULT_PRODUCT_PAGE_ADD_ON_PLACEMENT
                ? withoutKey(productPage, "addOnsPlacement")
                : { ...productPage, addOnsPlacement: placement },
            )
          }
        />
      </PanelField>
    </div>
  );
}
