import type { Metadata } from "next";
import { ShippingSection } from "@/components/settings/ShippingSection";
import { requireUser } from "@/lib/auth/session";
import { getShippingPolicy } from "@/lib/settings/shipping-policy";

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
  const policy = await getShippingPolicy(user.id);

  return <ShippingSection policy={policy} />;
}
