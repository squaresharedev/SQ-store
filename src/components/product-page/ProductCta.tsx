"use client";

import { ArrowUpRight, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CtaTarget } from "./cta-target";
import { ctaStyle } from "./product-page-maps";
import { useOptionSelection } from "./OptionContext";

// TODO(checkout): when in-house checkout ships, add a "checkout" mode here
// that posts to the order route (and calls decrementStock with the service
// role). The label, style and disabled logic below are already the seam; the
// purchase link stays as the fallback for sellers who sell elsewhere.
// Where the button goes is decided in ./cta-target.ts (server-callable).
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
  accent,
  ink,
  cornerRadius,
  soldOut,
  preview,
  className,
}: {
  target: CtaTarget;
  label: string;
  /** The theme's accent, which the button is always filled with: it is the
   *  seller's brand colour, so there was never a second right answer. */
  accent: string;
  ink: string;
  cornerRadius: number;
  soldOut: boolean;
  /** Editor preview: the button paints but never navigates. */
  preview: boolean;
  className?: string;
}) {
  const { unavailableIn } = useOptionSelection();

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
          style={{
            ...ctaStyle("outline", accent, ink, cornerRadius),
            boxShadow: `inset 0 0 0 2px ${ink}`,
            opacity: 0.45,
          }}
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
  const unavailable = soldOut || unavailableIn !== null;
  const text = soldOut
    ? "Sold out"
    : unavailableIn
      ? `Unavailable in this ${unavailableIn.name.toLowerCase()}`
      : target.kind === "mail"
        ? "Ask about this product"
        : label;
  const Icon = target.kind === "mail" ? Mail : ArrowUpRight;

  const button = (
    <span
      className={cn(
        "inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-sm font-semibold transition-opacity duration-base ease-standard",
        unavailable ? "opacity-50" : "hover:opacity-90",
      )}
      style={ctaStyle("accent", accent, ink, cornerRadius)}
    >
      {text}
      {!unavailable && <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />}
    </span>
  );

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-product-cta={target.kind}>
      {unavailable || preview ? (
        <span aria-disabled="true" className="block cursor-default select-none">
          {button}
        </span>
      ) : (
        <a
          href={target.href}
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
