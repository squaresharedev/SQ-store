import { ErrorScreen } from "@/components/error/ErrorScreen";

/**
 * The one answer for every way a product page can be unavailable: unknown
 * ids, a draft, a product not on this storefront, product pages switched off.
 * They all look the same so nothing about a seller's catalogue can be probed.
 *
 * No dashboard link: the person here is a buyer, and the dashboard is not
 * theirs. The way back is the site they came from.
 */
export default function ProductNotFound() {
  return (
    <ErrorScreen
      code="404"
      readout="err_product_unavailable"
      title="This product isn't available"
      description="It may have been removed, or the link you followed is out of date. Head back to the shop you came from to see what's on offer now."
      action={
        <p className="text-sm text-muted-foreground">
          If you were sent this link, ask the seller for a current one.
        </p>
      }
    />
  );
}
