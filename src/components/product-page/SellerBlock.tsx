import { EU_COUNTRIES } from "@/lib/settings/constants";
import type { StorefrontSeller } from "@/types/storefront";

/** The trader identity a distance seller owes the buyer. Every value is a
 *  text node; the email becomes a mailto only because it parsed as one. */
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
    <address className="flex flex-col gap-1 text-sm not-italic">
      <p className="font-medium">{seller.businessName || fallbackName}</p>
      {seller.address && <p className="whitespace-pre-line">{seller.address}</p>}
      {country && <p>{country}</p>}
      {seller.email && (
        <p>
          <a href={`mailto:${seller.email}`} className="underline underline-offset-2">
            {seller.email}
          </a>
        </p>
      )}
      {seller.phone && <p>{seller.phone}</p>}
      {seller.vatId && <p className="opacity-70">VAT ID {seller.vatId}</p>}
    </address>
  );
}

export function hasSellerDetails(seller: StorefrontSeller): boolean {
  return Boolean(
    seller.businessName || seller.address || seller.email || seller.phone || seller.vatId,
  );
}
