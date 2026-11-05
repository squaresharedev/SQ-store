// "Add to your order": whether a chosen product is OFFERED to buyers right now,
// and if not, why. Pure, so the buyer's page (lib/products/add-ons.ts), the
// editor's panel and the product form's picture all decide it the same way and
// a preview can never promise more than the page, or hide something it shows.

import type { AddOnChoice } from "@/lib/products/add-on-choices";
import type { AddOnCard, AddOnHiddenReason, Currency, HiddenAddOn } from "@/types/product";

/** The few facts the rule reads about a chosen product. */
export type AddOnFacts = Pick<AddOnChoice, "status" | "isDigital" | "currency" | "soldOut" | "takenDown">;

/** The product offering it: one order is sent one way and charged in one currency. */
export type AddOnHost = { isDigital: boolean; currency: Currency };

/** Null when buyers are offered it; otherwise the first reason they are not. */
export function addOnHiddenReason(facts: AddOnFacts, host: AddOnHost): AddOnHiddenReason | null {
  if (facts.takenDown) return "takenDown";
  if (facts.isDigital !== host.isDigital) return "otherKind";
  if (facts.currency !== host.currency) return "otherCurrency";
  if (facts.status !== "active") return "draft";
  if (facts.soldOut) return "soldOut";
  return null;
}

/** The chosen ids the catalogue still has, in order. A stored id it no longer
 *  has (deleted since) is left out, and so dropped by the next save. */
export function chosenAddOns(choices: readonly AddOnChoice[], value: readonly string[]): AddOnChoice[] {
  const byId = new Map(choices.map((choice) => [choice.id, choice]));
  return value.flatMap((id) => {
    const choice = byId.get(id);
    return choice ? [choice] : [];
  });
}

/** A choice as the buyer's section draws it, before the page's own answer. */
function choiceCard(choice: AddOnChoice): AddOnCard {
  return {
    id: choice.id,
    title: choice.title,
    description: "",
    priceCents: choice.priceCents,
    currency: choice.currency,
    sale: choice.sale,
    images: choice.imageUrl ? [{ url: choice.imageUrl, alt: "" }] : [],
    optionGroups: [],
    isDigital: choice.isDigital,
    digitalFormat: null,
    shippingProfileId: null,
    pagePath: null,
    rating: null,
  };
}

/** What a buyer would be offered of what was chosen, drawn at once from the
 *  picker's own rows until the server's answer (with photos and versions). */
export function offeredAddOnCards(chosen: readonly AddOnChoice[], host: AddOnHost): AddOnCard[] {
  return chosen.filter((choice) => addOnHiddenReason(choice, host) === null).map(choiceCard);
}

/** The chosen products buyers are not offered, in the seller's order, as the
 *  seller's previews draw them. */
export function hiddenAddOns(chosen: readonly AddOnChoice[], host: AddOnHost): HiddenAddOn[] {
  return chosen.flatMap((choice) => {
    const reason = addOnHiddenReason(choice, host);
    return reason
      ? [
          {
            id: choice.id,
            title: choice.title,
            imageUrl: choice.imageUrl,
            priceCents: choice.priceCents,
            currency: choice.currency,
            reason,
          },
        ]
      : [];
  });
}
