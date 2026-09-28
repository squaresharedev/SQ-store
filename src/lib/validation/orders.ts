import { referenceCode } from "@/lib/validation/inputs";
import { TRACKING_NUMBER_MAX, TRACKING_NUMBER_MIN } from "@/types/order-view";

/**
 * THE WRITE BOUNDARY for what a seller types about an order.
 *
 * A tracking number is a reference code, not free text: it is printed in the
 * "your order has shipped" email sent from our domain, so it is held to letters,
 * digits and the separators carriers use, never a link or prose. The same
 * character set and bounds as the orders.tracking_number CHECK. Empty is
 * allowed and means "no tracking number".
 */
export const trackingNumberSchema = referenceCode({
  field: "trackingNumber",
  min: TRACKING_NUMBER_MIN,
  max: TRACKING_NUMBER_MAX,
});
