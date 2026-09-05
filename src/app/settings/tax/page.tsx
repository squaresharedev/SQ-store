import type { Metadata } from "next";
import { TaxSection } from "@/components/settings/TaxSection";
import { requireProfile, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  // The nav label, the page h1 and this title all say the same thing so a
  // seller who arrives via search or a direct link immediately knows where
  // they are. "Tax" was the original name when only VAT lived here; the page
  // now carries the full trader identity distance-selling law asks for.
  title: "Business & seller details",
};

export default async function TaxSettingsPage() {
  await requireUser("/settings/tax");
  const profile = await requireProfile();

  return (
    <TaxSection
      businessName={profile?.tax_business_name ?? ""}
      address={profile?.seller_address ?? ""}
      email={profile?.seller_email ?? ""}
      vatId={profile?.tax_vat_id ?? ""}
      country={profile?.tax_country ?? ""}
      phone={profile?.seller_phone ?? ""}
    />
  );
}
