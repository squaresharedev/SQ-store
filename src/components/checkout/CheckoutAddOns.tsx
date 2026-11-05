"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { photoForSelection, selectionChips, strictSelection } from "@/lib/checkout/selection";
import { SalePrice } from "@/components/product-page/SalePrice";
import { useAddOns } from "@/components/product-page/AddOnsContext";
import { subtleFill } from "@/components/product-page/product-page-maps";
import { VersionChips } from "./VersionChips";

/**
 * What the buyer added to the order on the product page ("Add to your order"),
 * one line each under the item, each with a way to take it out again. The
 * total beside it (CheckoutForm) reads the same picks, so taking a line out
 * here takes it out of what is charged. Nothing when nothing was added.
 */
export function CheckoutAddOns({
  ink,
  rule,
  cornerRadius,
  controlRadius,
}: {
  /** The ink of whatever the lines sit on (the page, or the showcase panel). */
  ink: string;
  rule: string;
  cornerRadius: number;
  controlRadius: number;
}) {
  const t = useTranslations("ProductPage.checkout.addOns");
  const { offered, picks, remove } = useAddOns();
  if (picks.length === 0) return null;

  return (
    <section
      aria-label={t("label")}
      className="flex flex-col border-t pt-3"
      style={{ borderColor: rule }}
      data-checkout-add-ons={picks.length}
      data-setting-skip=""
    >
      <ul className="flex flex-col gap-3">
        {picks.map((pick) => {
          const card = offered.find((candidate) => candidate.id === pick.productId);
          if (!card) return null;
          const selection = strictSelection(card.optionGroups, pick.optionIds) ?? {};
          const photo = photoForSelection(card.images, selection);
          return (
            <li key={card.id} className="flex items-center gap-3" data-checkout-add-on={card.id}>
              <span
                className="size-12 shrink-0 overflow-hidden"
                style={{ borderRadius: controlRadius, background: subtleFill(ink) }}
                aria-hidden="true"
              >
                {photo && (
                  // eslint-disable-next-line @next/next/no-img-element -- a presigned R2 URL, like the product gallery's
                  <img src={photo.url} alt="" className="size-full object-cover" decoding="async" />
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="truncate text-sm font-medium">{card.title}</p>
                <VersionChips
                  chips={selectionChips(card.optionGroups, selection)}
                  ink={ink}
                  cornerRadius={cornerRadius}
                />
                <p className="text-sm tabular-nums">
                  <SalePrice
                    priceCents={card.priceCents}
                    currency={card.currency}
                    sale={card.sale}
                    priceClassName="text-sm"
                    size="sm"
                  />
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(card.id)}
                aria-label={t("remove", { title: card.title })}
                title={t("remove", { title: card.title })}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center opacity-70 hover:opacity-100",
                  "transition-opacity duration-base ease-standard",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                )}
                style={{ borderRadius: controlRadius, outlineColor: ink }}
                data-checkout-add-on-remove={card.id}
              >
                <X className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
