import type { Metadata } from "next";
import { TaxSection } from "@/components/settings/TaxSection";
import { requireProfile, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Tax settings",
};

export default async function TaxSettingsPage() {
  await requireUser("/settings/tax");
  const profile = await requireProfile();

  return (
    <TaxSection
      businessName={profile?.tax_business_name ?? ""}
      vatId={profile?.tax_vat_id ?? ""}
      country={profile?.tax_country ?? ""}
    />
  );
}
