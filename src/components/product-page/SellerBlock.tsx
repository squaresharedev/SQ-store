import { Globe, Mail, MapPin, Phone, Receipt } from "lucide-react";
import { EU_COUNTRIES } from "@/lib/settings/constants";
import type { StorefrontSeller } from "@/types/storefront";

/** Icon + label styling shared by every row, matching the trust list beside
 *  the buy button (ProductPageView's own icon lines) so the two read as one
 *  visual language rather than two different components improvising. */
const ROW_ICON_CLASS = "mt-px size-3.5 shrink-0 opacity-60";
const LABEL_CLASS = "opacity-70";

/**
 * The trader identity a distance seller owes the buyer.
 *
 * LABELLED, not just laid out: "Ikea" under a bold name reads as a name, but
 * "Czechia" on its own line reads as nothing in particular — a buyer has to
 * guess whether that is where the seller is based, where the item ships
 * from, or something else. Every field below except the name itself (which
 * IS the answer to "who", right under the "Seller" heading) says what it is
 * before it says what it holds, the same way the VAT line already did.
 *
 * Every value is still a plain React text node; the email becomes a mailto
 * only because it parsed as one.
 */
export function SellerBlock({
  seller,
  fallbackName,
}: {
  seller: StorefrontSeller;
  /** The storefront's name, shown when no business name was given. */
  fallbackName: string;
}) {
  const country = EU_COUNTRIES.find((entry) => entry.code === seller.country)?.name;
  return (
    <address className="flex flex-col gap-2 text-sm not-italic">
      <p className="font-medium">{seller.businessName || fallbackName}</p>

      {seller.address && (
        <p className="flex items-start gap-2">
          <MapPin className={ROW_ICON_CLASS} strokeWidth={2} aria-hidden="true" />
          <span>
            <span className={LABEL_CLASS}>Address: </span>
            <span className="whitespace-pre-line">{seller.address}</span>
          </span>
        </p>
      )}

      {country && (
        <p className="flex items-start gap-2">
          <Globe className={ROW_ICON_CLASS} strokeWidth={2} aria-hidden="true" />
          <span>
            <span className={LABEL_CLASS}>Country: </span>
            {country}
          </span>
        </p>
      )}

      {seller.email && (
        <p className="flex items-start gap-2">
          <Mail className={ROW_ICON_CLASS} strokeWidth={2} aria-hidden="true" />
          <span>
            <span className={LABEL_CLASS}>Email: </span>
            <a href={`mailto:${seller.email}`} className="underline underline-offset-2">
              {seller.email}
            </a>
          </span>
        </p>
      )}

      {seller.phone && (
        <p className="flex items-start gap-2">
          <Phone className={ROW_ICON_CLASS} strokeWidth={2} aria-hidden="true" />
          <span>
            <span className={LABEL_CLASS}>Phone: </span>
            {seller.phone}
          </span>
        </p>
      )}

      {seller.vatId && (
        <p className="flex items-start gap-2">
          <Receipt className={ROW_ICON_CLASS} strokeWidth={2} aria-hidden="true" />
          <span className={LABEL_CLASS}>VAT ID: {seller.vatId}</span>
        </p>
      )}
    </address>
  );
}

export function hasSellerDetails(seller: StorefrontSeller): boolean {
  return Boolean(
    seller.businessName || seller.address || seller.email || seller.phone || seller.vatId,
  );
}
