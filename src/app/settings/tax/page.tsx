import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TaxSection } from "@/components/settings/TaxSection";
import { requireProfile, requireUser } from "@/lib/auth/session";
import { contactVerificationStatus } from "@/lib/contact-verification/availability";
import { pendingContactCodes } from "@/lib/contact-verification/service";
import { formatPhoneInternational } from "@/lib/validation/phone";
import { getPrimaryStorefrontId } from "@/lib/storefront/queries";

// The nav label, the page h1 and this title all say the same thing so a
// seller who arrives via search or a direct link immediately knows where
// they are. "Tax" was the original name when only VAT lived here; the page
// now carries the full trader identity distance-selling law asks for.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.metadata.tax");
  return { title: t("title") };
}

export default async function TaxSettingsPage() {
  const user = await requireUser("/settings/tax");
  const [profile, storefrontId, pendingCodes] = await Promise.all([
    requireProfile(),
    getPrimaryStorefrontId(),
    // Reopens on the code box after a reload, instead of offering another send.
    pendingContactCodes(user.id),
  ]);

  return (
    <TaxSection
      businessName={profile?.tax_business_name ?? ""}
      address={profile?.seller_address ?? ""}
      email={profile?.seller_email ?? ""}
      vatId={profile?.tax_vat_id ?? ""}
      country={profile?.tax_country ?? ""}
      phone={profile?.seller_phone ? formatPhoneInternational(profile.seller_phone) : ""}
      emailVerified={Boolean(profile?.seller_email_verified_at)}
      phoneVerified={Boolean(profile?.seller_phone_verified_at)}
      verification={contactVerificationStatus()}
      pendingCodes={pendingCodes}
      // Where "Continue to your storefront" goes after a successful save: the
      // storefront the seller last worked on, or the list if they have none.
      continueHref={storefrontId ? `/storefront/${storefrontId}` : "/storefront"}
    />
  );
}
