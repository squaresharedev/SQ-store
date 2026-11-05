"use client";

import type { AddOnChoice } from "@/lib/products/add-on-choices";
import { chosenAddOns, hiddenAddOns, offeredAddOnCards } from "@/lib/products/add-on-visibility";
import type { AddOnHabits } from "@/lib/predictions";
import type { Currency } from "@/types/product";
import { errorTextClass } from "@/components/ui/control-styles";
import { AddOnsPicker } from "./AddOnsPicker";
import { AddOnsPreview } from "./AddOnsPreview";

/**
 * "ADD TO ORDER": other products of the store that this product's page offers
 * beside Buy now (products.add_on_ids, in the order they were pressed). The
 * list is AddOnsPicker; beside it, what a buyer gets (AddOnsPreview), where each
 * press shows up.
 */
export function AddOnsField({
  inputId,
  productId,
  isDigital,
  currency,
  ownBuyLink,
  choices,
  habits,
  value,
  onChange,
  error,
}: {
  inputId: string;
  /** The product being edited, which can never be its own add-on. Null on create. */
  productId: string | null;
  /** This product's kind as the form holds it now. */
  isDigital: boolean;
  /** This product's currency as the form holds it now. */
  currency: Currency;
  /** The form holds a buy link of the seller's own, whose page offers no add-ons. */
  ownBuyLink: boolean;
  /** The store's products, read on the server (lib/products/add-on-choices.ts). */
  choices: readonly AddOnChoice[];
  /** What the store's history says goes with this product (lib/predictions.ts). */
  habits?: AddOnHabits;
  value: readonly string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  const chosen = chosenAddOns(choices, value);
  const host = { isDigital, currency };

  return (
    <div className="grid items-start gap-5 md:grid-cols-2">
      <div className="min-w-0 space-y-2" data-product-field="addOns" data-product-value={chosen.length}>
        <AddOnsPicker
          inputId={inputId}
          productId={productId}
          isDigital={isDigital}
          currency={currency}
          choices={choices}
          habits={habits}
          value={value}
          onChange={onChange}
        />
        {error && (
          <p className={errorTextClass} role="alert">
            {error}
          </p>
        )}
      </div>

      <AddOnsPreview
        cards={offeredAddOnCards(chosen, host)}
        hidden={hiddenAddOns(chosen, host)}
        ownBuyLink={ownBuyLink}
      />
    </div>
  );
}
