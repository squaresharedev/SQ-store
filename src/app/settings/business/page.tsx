import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { TaxSection } from "@/components/settings/TaxSection";
import { requireProfile, requireUser } from "@/lib/auth/session";
import { contactVerificationStatus } from "@/lib/contact-verification/availability";
import { pendingContactCodes } from "@/lib/contact-verification/service";
import { formatPhoneInternational } from "@/lib/validation/phone";
import { getPrimaryStorefrontId } from "@/lib/storefront/queries";
import { TRADER_IDENTITY_HREF } from "@/lib/settings/trader-identity";
import { getAccessibleAccounts, getActiveAccount } from "@/lib/team/account-context";
import { helpTextClass, noteStripClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

// The nav label, the page h1, this title AND the address all say the same
// thing, so a seller who arrives via search, a shared link or their history
// knows where they are. "Tax" was the original name when only VAT lived here
// (/settings/tax still redirects here); the page now carries the full trader
// identity distance-selling law asks for.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.metadata.tax");
  return { title: t("title") };
}

export default async function BusinessSettingsPage() {
  const user = await requireUser(TRADER_IDENTITY_HREF);
  const [profile, storefrontId, pendingCodes, account, accounts, t] = await Promise.all([
    requireProfile(),
    getPrimaryStorefrontId(),
    // Reopens on the code box after a reload, instead of offering another send.
    pendingContactCodes(user.id),
    getActiveAccount(),
    getAccessibleAccounts(),
    getTranslations("Settings.tax"),
  ]);
  // A member working in someone else's store sees THEIR OWN details here,
  // blank more often than not: said first, so they do not fill them in
  // thinking it fixes the store they are working on.
  const workingIn =
    account && !account.isOwner
      ? (accounts.find((option) => option.accountId === account.accountId)?.storeName ?? null)
      : null;

  return (
    <>
    {workingIn && (
      <p role="note" className={cn(noteStripClass, helpTextClass, "mb-4")} data-member-scope="">
        {t("memberScope", { store: workingIn })}
      </p>
    )}
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
    </>
  );
}
