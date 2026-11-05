"use client";

import { useEffect, useId, useState } from "react";
import { EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { AddOnsPicker } from "@/components/products/AddOnsPicker";
import { helpTextClass, infoTextClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { ProductThumb } from "@/components/ui/ProductThumb";
import { Select } from "@/components/ui/select";
import { getAddOnPicker, type AddOnPicker } from "@/lib/products/add-on-actions";
import type { AddOnChoice } from "@/lib/products/add-on-choices";
import { chosenAddOns, hiddenAddOns, offeredAddOnCards } from "@/lib/products/add-on-visibility";
import { deriveStockBadge } from "@/lib/stock/badge";
import { NO_ADD_ON_HABITS } from "@/lib/predictions";
import { useSampleMode } from "@/lib/storefront/sample-mode";
import type { Product } from "@/types/product";
import { useProductAddOnsEditor } from "./ProductAddOnsEditor";

/** The sample storefront's products exist only in code, so its catalogue row is
 *  all there is to choose from. */
function sampleChoice(product: Product): AddOnChoice {
  const cents = (price: number) => Math.round(price * 100);
  return {
    id: product.id,
    title: product.title,
    priceCents: cents(product.sale?.price ?? product.price),
    sale: product.sale
      ? {
          regularPriceCents: cents(product.price),
          priorPriceCents: null,
          percentOff: null,
          offerPercent: product.sale.offerPercent,
          endsAt: null,
        }
      : null,
    currency: product.currency,
    imageUrl: product.imageUrl,
    status: product.status === "active" ? "active" : "draft",
    isDigital: product.digitalFileName !== null,
    soldOut: deriveStockBadge(product)?.state === "sold_out",
    takenDown: product.removal !== undefined,
  };
}

function samplePicker(product: Product, catalog: readonly Product[]): AddOnPicker {
  return {
    choices: catalog.map(sampleChoice),
    addOnIds: [],
    isDigital: product.digitalFileName !== null,
    currency: product.currency,
    ownBuyLink: false,
    // Made-up products have no buyers to learn from.
    habits: NO_ADD_ON_HABITS,
  };
}

/**
 * WHICH PRODUCTS "ADD TO YOUR ORDER" OFFERS, chosen where the seller is looking
 * at the section, for the product page out on the canvas (a choice of them when
 * several are out). The artboard beside it is the preview, so unlike the product
 * form's field this draws none of its own, and says little: whose list it is,
 * how full it is, and the list. That a press saves at once, for every
 * storefront, is the section's "?" to say.
 *
 * Read each time the section opens, so a change made in the product form since
 * shows up here. Renders nothing outside the designer.
 */
export function AddOnsProductsField() {
  const fieldId = useId();
  const t = useTranslations("Storefront.productPage.addOns.products");
  const tField = useTranslations("Products.addOnsField");
  const tActions = useTranslations("Common.actions");
  const sample = useSampleMode();
  const editor = useProductAddOnsEditor();
  const target = editor?.target ?? null;
  const targetId = target?.id ?? null;

  const [loaded, setLoaded] = useState<{ id: string; picker: AddOnPicker | null } | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (sample || !targetId) return;
    let cancelled = false;
    getAddOnPicker(targetId)
      .then((result) => {
        if (!cancelled) setLoaded({ id: targetId, picker: result.ok ? result.picker : null });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: targetId, picker: null });
      });
    return () => {
      cancelled = true;
    };
  }, [targetId, tries, sample]);

  if (!editor) return null;
  if (!target) {
    return (
      <p className={helpTextClass} data-add-ons-products="no-page">
        {t("noPage")}
      </p>
    );
  }

  const answer = loaded?.id === target.id ? loaded : null;
  const picker = sample ? samplePicker(target, editor.catalog) : (answer?.picker ?? null);
  const value = editor.edits[target.id]?.ids ?? picker?.addOnIds ?? [];
  const listName = t("offeredWithOne", { title: target.title });

  // Whose list this is: the page out on the canvas, or a choice of them.
  const whose =
    editor.pages.length > 1 ? (
      <>
        <label htmlFor={`${fieldId}-page`} className="sr-only">
          {t("offeredWith")}
        </label>
        <Select
          id={`${fieldId}-page`}
          value={target.id}
          options={editor.pages.map((page) => ({
            value: page.id,
            label: page.title,
            leading: <ProductThumb src={page.imageUrl} loading="lazy" className="size-5" />,
          }))}
          onChange={editor.aim}
        />
      </>
    ) : (
      <span className="flex min-w-0 items-center gap-2" data-add-ons-products-for={target.id}>
        <ProductThumb src={target.imageUrl} loading="lazy" className="size-6" />
        <span className="truncate">{target.title}</span>
      </span>
    );

  return (
    <div className="space-y-2" data-add-ons-products={picker ? "ready" : answer ? "failed" : "loading"}>
      {picker ? (
        <>
          <AddOnsPicker
            // Its rows hold still while pressed, and start over for another page.
            key={target.id}
            inputId={`${fieldId}-picker`}
            label={whose}
            listName={listName}
            productId={target.id}
            isDigital={picker.isDigital}
            currency={picker.currency}
            choices={picker.choices}
            habits={picker.habits}
            value={value}
            onChange={(next) => {
              const chosen = chosenAddOns(picker.choices, next);
              const host = { isDigital: picker.isDigital, currency: picker.currency };
              editor.write(target.id, next, {
                cards: offeredAddOnCards(chosen, host),
                hidden: hiddenAddOns(chosen, host),
              });
            }}
          />
          {picker.ownBuyLink && (
            <p
              className={cn(infoTextClass, "flex items-center gap-1.5")}
              title={tField("ownBuyLink")}
              data-add-ons-products-own-link=""
            >
              <EyeOff className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
              {t("ownLink")}
            </p>
          )}
        </>
      ) : answer ? (
        <div className="space-y-2">
          <p className={helpTextClass} role="alert">
            {t("loadFailed")}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoaded(null);
              setTries((count) => count + 1);
            }}
            className={cn(secondaryButtonClass, "w-full justify-center")}
          >
            {tActions("tryAgain")}
          </button>
        </div>
      ) : (
        <p className={infoTextClass} role="status">
          {tActions("loading")}
        </p>
      )}
    </div>
  );
}
