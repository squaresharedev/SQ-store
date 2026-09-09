"use client";

import { ArrowUpRight, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { optionSummaryRows } from "@/lib/products/option-details";
import { mailtoHref, type CtaTarget } from "./cta-target";
import { ctaGhostStyle, ctaStyle, type CtaAppearance } from "./product-page-maps";
import { useOptionSelection } from "./OptionContext";
import { useQuantity } from "./QuantityContext";

// TODO(checkout): when in-house checkout ships, add a "checkout" mode here
// that posts to the order route (and calls decrementStock with the service
// role). The label, style and disabled logic below are already the seam; the
// purchase link stays as the fallback for sellers who sell elsewhere.
// Where the button goes is decided in ./cta-target.ts (server-callable).
//
// THE QUANTITY THAT MODE POSTS IS A REQUEST, NOT A PRICE. `quantity` below is
// client state: it decides what this button says and what an enquiry email
// carries, and it decides nothing else. The order route MUST pass it through
// resolveOrderQuantity (lib/products/order-quantity.ts), which re-reads the
// product's own ceiling, price and stock and refuses anything that does not
// fit, and MUST build the charge from the `totalCents` that comes back rather
// than from anything this component sent. A checkout that multiplies a price
// by a number the browser supplied is a checkout with a price field in it.
//
// NOT MERCHANT OF RECORD — this is load-bearing, not a style note. Squareshare
// is the software/platform; each SELLER is who the buyer contracts with, pays,
// and gets a refund from. That must survive into whatever "checkout" mode
// gets added here:
//   - Charge the CONNECTED (seller's) Stripe account, not the platform's own.
//     Use Direct Charges created on the connected account, or Destination
//     Charges with `on_behalf_of` set to it — never a plain destination charge
//     with no `on_behalf_of`, which puts the platform on the receipt and the
//     statement descriptor instead of the seller (see lib/payments/types.ts).
//   - Take our cut as `application_fee_amount` on that charge; never move the
//     full amount through a Squareshare-owned account first.
//   - The statement descriptor, the receipt and the checkout page must name
//     the SELLER's business — never "Squareshare" as the thing being paid.
//   - Sales tax/VAT registration and remittance, chargebacks, and buyer
//     support for the goods stay the seller's liability, matching the Seller
//     Agreement (src/components/settings/LegalSection.tsx).
// See PoweredByFooter.tsx for the buyer-facing half of the same principle.

export function ProductCta({
  target,
  label,
  cta,
  ink,
  soldOut,
  preview,
  className,
}: {
  target: CtaTarget;
  label: string;
  /** Fill, ink, roundness and outline, already resolved against the theme by
   *  `resolveCta` — this component paints what it is handed and decides none
   *  of it, so the artboard and the buyer's page cannot diverge. */
  cta: CtaAppearance;
  /** The PAGE's ink, not the button's: the focus ring and the unwired ghost
   *  belong to the surface the button sits on. */
  ink: string;
  soldOut: boolean;
  /** Editor preview: the button paints but never navigates. */
  preview: boolean;
  className?: string;
}) {
  const { unavailableIn, groups, selection } = useOptionSelection();
  const { quantity } = useQuantity();

  // NO DESTINATION SET. On a live page there is nothing honest to render: a
  // button that goes nowhere is worse than no button. In the editor it is the
  // opposite — the seller has to be able to SEE that the page's one action is
  // missing, and be told exactly where to set it, so the button is drawn as an
  // outline with the answer underneath.
  if (target.kind === "none") {
    if (!preview) return null;
    return (
      <div className={cn("flex flex-col gap-1.5", className)} data-product-cta="unset">
        <span
          className="inline-flex w-full items-center justify-center px-5 py-3 text-sm font-semibold opacity-55"
          style={{ ...ctaGhostStyle(cta, ink), opacity: 0.45 }}
        >
          {label}
        </span>
        <p className="text-center text-xs opacity-70">
          This button has nowhere to go yet. Add a purchase link on the product, or a contact
          email under Seller details.
        </p>
      </div>
    );
  }

  // NAME THE AXIS THAT IS OUT, not just "unavailable": with several groups on
  // the page, a buyer has to know whether it is the colour or the size they
  // need to change. The group's own name is what the picker prints above it,
  // so the two read as the same thing.
  //
  // BUY-06: a mail CTA is a contact link, not a purchase button, so "sold out"
  // is not a reason to disable it. A buyer who cannot buy may still want to
  // ask the seller about restocking. Only LINK CTAs (external purchase URLs)
  // are meaningless when sold out; mail CTAs remain active so the buyer still
  // has a path to the seller.
  const mailSoldOut = soldOut && target.kind !== "mail";
  const unavailable = mailSoldOut || unavailableIn !== null;
  const text = mailSoldOut
    ? "Sold out"
    : unavailableIn
      ? `Unavailable in this ${unavailableIn.name.toLowerCase()}`
      : target.kind === "mail"
        ? "Ask about this product"
        : label;
  const Icon = target.kind === "mail" ? Mail : ArrowUpRight;

  // THE ENQUIRY CARRIES THE VERSION. Only the client knows which one is on
  // screen, so the mail href is rebuilt here from the same rows the specs
  // table prints — a seller must never be told a different version than the
  // buyer was looking at.
  // THE ENQUIRY ALSO CARRIES HOW MANY, for the same reason it carries the
  // version: the buyer chose a number on this page, and a seller quoting for
  // one when six were wanted is the same avoidable mistake in a different
  // field. Nothing is appended to a seller's own purchase LINK — see
  // resolveCtaTarget on why a guessed parameter is worse than none.
  const href =
    target.kind === "mail"
      ? mailtoHref(
          target.email,
          target.productTitle,
          optionSummaryRows(groups, selection),
          quantity,
        )
      : target.href;

  const button = (
    <span
      className={cn(
        "inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-sm font-semibold transition-opacity duration-base ease-standard",
        unavailable ? "opacity-50" : "hover:opacity-90",
      )}
      style={ctaStyle(cta)}
    >
      {text}
      {!unavailable && <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />}
    </span>
  );

  return (
    <div
      className={cn("flex flex-col gap-1.5", className)}
      data-product-cta={target.kind}
      // WHAT THE BUTTON PAINTS, as data rather than as parsed CSS. Same
      // discipline as the product form's `data-product-field` and the
      // analytics page's snapshot: a test, and one day an agent asked "what
      // does my buy button look like", reads the resolved values instead of
      // scraping a style attribute and re-deriving the inheritance itself.
      data-cta-fill={cta.fill}
      data-cta-radius={cta.radius}
      data-cta-border-width={cta.borderWidth}
      data-cta-border-color={cta.borderColor}
    >
      {unavailable || preview ? (
        <span aria-disabled="true" className="block cursor-default select-none">
          {button}
        </span>
      ) : (
        <a
          href={href}
          target={target.kind === "link" ? "_blank" : undefined}
          rel={target.kind === "link" ? "noopener noreferrer nofollow" : undefined}
          className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ outlineColor: ink, borderRadius: "inherit" }}
        >
          {button}
        </a>
      )}
      {target.kind === "link" && (
        <p className="text-center text-xs opacity-70">
          Checkout on <span className="font-medium">{target.host}</span>
        </p>
      )}
    </div>
  );
}
