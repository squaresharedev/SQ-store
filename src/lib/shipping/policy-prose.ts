import { createTranslator } from "next-intl";
import type { Locale } from "@/i18n/locales";
import type { MessageKey, MessageValues } from "@/i18n/types";
import { countryName as localCountryName } from "@/lib/format/country";
import type { SellerShippingPolicy } from "@/types/shipping-policy";
import productPage from "../../../messages/en/productPage.json";

/**
 * THE STRUCTURED ANSWERS, AS THE PARAGRAPHS A BUYER READS.
 *
 * Pure and client-safe, and the ONE place the translation happens: the hosted
 * product page, the designer's read-only summary and the product form's "this
 * is what buyers will read" preview all call this, so none of the three can
 * print a different policy from the others. Same discipline
 * `resolveProductShipping` already enforces for WHICH terms apply.
 *
 * WHY GENERATE AT ALL. The seller answers "where from, how long to where, how
 * many days to return, who pays the postage back": four facts they know
 * without thinking. Prose is what the page needs, and writing prose is the
 * step that was never happening. So the structure is the input and the
 * paragraph is the output, rather than asking for the paragraph and hoping.
 *
 * THE OVERRIDE WINS, ALWAYS. A seller who typed their own words gets exactly
 * those words: `shippingText`/`returnsText` short-circuit the generator
 * completely rather than being appended to it. Anything else would put
 * sentences the seller did not write next to sentences they did, in a block
 * whose whole job is to be legally accurate.
 *
 * IN THE READER'S LANGUAGE. The generated sentences are catalogue messages
 * (`ProductPage.shippingProse`), and the caller passes the resolver for whoever
 * is reading: the buyer on the product page, the seller in a preview. Every
 * seller-typed part (areas, times, costs, notes, overrides) goes in as data and
 * comes out untouched.
 *
 * WHAT THIS DOES NOT DO. It never states the statutory EU withdrawal right or
 * the two-year guarantee. Those are the page's own (see ProductPageView), they
 * are true whatever the seller typed here, and generating them from a seller's
 * answers would let a wrong answer suppress a right the buyer has anyway.
 */

/** The paragraphs a page prints. Either may be "": a section with nothing to
 *  say is omitted rather than rendered empty. */
export type ShippingProse = {
  shipping: string;
  returns: string;
};

type ProseKey = Extract<MessageKey, `ProductPage.shippingProse.${string}`>;

/** A generated sentence, not yet in any language. A MessageRef, narrowed. */
export type ProseRef = { key: ProseKey; values?: MessageValues };

/** Resolves a generated sentence in the reader's language. */
export type ProseResolver = (ref: ProseRef) => string;

const EMPTY: ShippingProse = { shipping: "", returns: "" };

function prose(key: ProseKey, values: MessageValues): ProseRef {
  return { key, values };
}

const englishCatalogue = createTranslator({
  locale: "en",
  messages: { ProductPage: productPage },
  timeZone: "UTC",
});

/** English, for {@link hasShippingPolicy}, whose answer is the same in every language. */
function english(ref: ProseRef): string {
  return englishCatalogue(ref.key, ref.values);
}

/** The country's printable name in the reader's language, or the raw code when
 *  it is not one we know (a stored value from before a list changed). Never
 *  blank: a code the reader can look up beats silently dropping where the goods
 *  ship from. */
function countryName(code: string, locale: Locale): string {
  return localCountryName(code, locale) ?? code;
}

/** "Ireland: 2-3 business days (€4.50)", with the parts that are set. */
function destinationLine(
  resolve: ProseResolver,
  area: string,
  time: string,
  cost?: string,
): string {
  const where = area.trim();
  const when = time.trim();
  const price = cost?.trim();
  if (where && when) {
    return price
      ? resolve(prose("ProductPage.shippingProse.areaAndTimeWithCost", { area: where, time: when, cost: price }))
      : resolve(prose("ProductPage.shippingProse.areaAndTime", { area: where, time: when }));
  }
  const place = where || when;
  if (!place) return "";
  return price
    ? resolve(prose("ProductPage.shippingProse.withCost", { place, cost: price }))
    : place;
}

function shippingProse(
  policy: SellerShippingPolicy,
  resolve: ProseResolver,
  locale: Locale,
): string {
  const own = policy.shippingText?.trim();
  if (own) return own;

  const paragraphs: string[] = [];

  // Two facts that belong in one opening sentence rather than two lines: where
  // it leaves from and, for a buyer comparing sellers, that is often the whole
  // answer.
  const from = policy.shipsFrom?.trim();
  if (from) {
    paragraphs.push(
      resolve(prose("ProductPage.shippingProse.shipsFrom", { country: countryName(from, locale) })),
    );
  }

  const lines = (policy.destinations ?? [])
    .map((destination) =>
      destinationLine(resolve, destination.area, destination.time, destination.cost),
    )
    .filter(Boolean);
  // One block of lines, not one paragraph each: they are a list and read as
  // one, and a blank line between "Ireland" and "Rest of EU" makes two
  // unrelated statements out of a single table.
  if (lines.length > 0) paragraphs.push(lines.join("\n"));

  const notes = policy.shippingNotes?.trim();
  if (notes) paragraphs.push(notes);

  return paragraphs.join("\n\n");
}

function returnsProse(policy: SellerShippingPolicy, resolve: ProseResolver): string {
  const own = policy.returnsText?.trim();
  if (own) return own;

  const paragraphs: string[] = [];
  const days = policy.returnsWindowDays;

  // 0 and undefined are the same answer for this block: the seller offers
  // nothing BEYOND the statutory right, so there is no voluntary policy to
  // describe. The page still states that right on its own.
  //
  // Who pays is the second thing every buyer asks and the one sellers most
  // often leave out, so it rides in the same message rather than waiting for a
  // paragraph the seller may never write.
  if (typeof days === "number" && days > 0) {
    paragraphs.push(
      resolve(
        prose("ProductPage.shippingProse.returnsWindow", {
          days,
          paidBy: policy.returnsPaidBy ?? "unset",
        }),
      ),
    );
  }

  const notes = policy.returnsNotes?.trim();
  if (notes) paragraphs.push(notes);

  return paragraphs.join("\n\n");
}

/**
 * The account's terms as the two paragraphs a product page prints, in the
 * language `resolve` answers in. `locale` is that same language, for the
 * country names the prose quotes.
 */
export function buildShippingProse(
  policy: SellerShippingPolicy | null | undefined,
  resolve: ProseResolver,
  locale: Locale,
): ShippingProse {
  if (!policy) return EMPTY;
  return {
    shipping: shippingProse(policy, resolve, locale),
    returns: returnsProse(policy, resolve),
  };
}

/**
 * Whether the seller has said anything a buyer could read.
 *
 * Deliberately asks the GENERATED output rather than counting set keys: a
 * policy holding only `returnsPaidBy` (who pays for a window that does not
 * exist) produces no prose, and a settings page that called that "set" would
 * be telling a seller they are done when their page still says nothing.
 * `dispatch` counts too, since it prints beside the buy button even when the
 * fold below has no section. Language-independent: a generated sentence is
 * never empty in any language.
 */
export function hasShippingPolicy(policy: SellerShippingPolicy | null | undefined): boolean {
  if (!policy) return false;
  const generated = buildShippingProse(policy, english, "en");
  return Boolean(generated.shipping || generated.returns || policy.dispatch?.trim());
}
