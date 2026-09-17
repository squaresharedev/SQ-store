import type { Metadata } from "next";
import { ShippingSection } from "@/components/settings/ShippingSection";
import { requireUser } from "@/lib/auth/session";
import { getShippingPolicy } from "@/lib/settings/shipping-policy";
import { getPrimaryStorefrontId } from "@/lib/storefront/queries";

export const metadata: Metadata = {
  title: "Shipping & returns settings",
};

/**
 * The account's shipping and returns terms. Read for the SIGNED-IN USER's own
 * account, which is what makes this the one settings page whose data the
 * designer's panel can only show and never write: Settings is scoped to the
 * person signed in, never to the active account, so a team member working in
 * someone else's store sees the owner's terms rather than editing them.
 */
export default async function ShippingSettingsPage() {
  const user = await requireUser("/settings/shipping");
  const [policy, storefrontId] = await Promise.all([
    getShippingPolicy(user.id),
    getPrimaryStorefrontId(),
  ]);

  return (
    <ShippingSection
      policy={policy}
      // Where "Continue to your storefront" goes after a successful save: the
      // storefront the seller last worked on, or the list if they have none.
      continueHref={storefrontId ? `/storefront/${storefrontId}` : "/storefront"}
    />
  );
}
