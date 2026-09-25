"use client";

import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { ShippingSection } from "@/components/settings/ShippingSection";
import type { SellerShippingPolicy } from "@/types/shipping-policy";

/**
 * The account's shipping & returns settings, opened ON TOP of the product
 * form instead of navigating to it. Same form, same save action
 * (`saveShippingPolicy`) as Settings › Shipping & returns — this is not a
 * second editor, just the existing one in an overlay.
 *
 * WHY A MODAL, NOT A REDIRECT-AND-RETURN. The product form has no draft
 * persistence (it is plain React state) and already blocks navigation away
 * from unsaved changes, so sending a seller to a full settings page and back
 * would either lose their in-progress product edits or need its own
 * autosave just to make the round trip safe. Keeping the product form
 * mounted underneath sidesteps that entirely.
 *
 * The parent closes this and calls `router.refresh()` so the product form's
 * shipping summary picks up whatever was just saved — see ShippingField.
 */
export function ShippingTermsModal({
  open,
  onClose,
  policy,
}: {
  open: boolean;
  onClose: () => void;
  policy: SellerShippingPolicy;
}) {
  const t = useTranslations("Products.shippingField");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("modalTitle")}
      className="sm:max-w-2xl"
    >
      {/* No `continueHref`: "Continue to your storefront" has nowhere sensible
          to go from mid-product-edit, so ShippingSection omits it entirely
          when the prop isn't passed. */}
      <ShippingSection policy={policy} />
    </Modal>
  );
}
