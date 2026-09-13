import type { Metadata } from "next";
import { TaxSection } from "@/components/settings/TaxSection";
import { requireProfile, requireUser } from "@/lib/auth/session";
import { sellerEmailVerificationRequired } from "@/lib/settings/seller-email-verification";

export const metadata: Metadata = {
  // The nav label, the page h1 and this title all say the same thing so a
  // seller who arrives via search or a direct link immediately knows where
  // they are. "Tax" was the original name when only VAT lived here; the page
  // now carries the full trader identity distance-selling law asks for.
  title: "Business & seller details",
};

export default async function TaxSettingsPage({
  searchParams,
}: {
  /** `?verified=…` is where the confirmation link lands (see
   *  app/settings/verify-seller-email/route.ts). The route redirects here
   *  rather than rendering, so one place describes what happened. */
  searchParams: Promise<{ verified?: string | string[] }>;
}) {
  await requireUser("/settings/tax");
  const [profile, params] = await Promise.all([requireProfile(), searchParams]);
  const verified = Array.isArray(params.verified)
    ? params.verified[0]
    : params.verified;

  return (
    <TaxSection
      businessName={profile?.tax_business_name ?? ""}
      address={profile?.seller_address ?? ""}
      email={profile?.seller_email ?? ""}
      vatId={profile?.tax_vat_id ?? ""}
      country={profile?.tax_country ?? ""}
      phone={profile?.seller_phone ?? ""}
      emailVerified={Boolean(profile?.seller_email_verified_at)}
      // Off entirely where the platform cannot send mail: a "confirm your
      // address" panel with no way to send the link would be a dead end.
      verificationOn={sellerEmailVerificationRequired()}
      verifyOutcome={verified}
    />
  );
}
