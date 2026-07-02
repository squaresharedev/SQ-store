import type { Metadata } from "next";
import { LegalSection } from "@/components/settings/LegalSection";
import { getProfile, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Legal settings",
};

export default async function LegalSettingsPage() {
  await requireUser("/settings/legal");
  const profile = await getProfile();

  return (
    <LegalSection
      acceptedAt={profile?.legal_accepted_at ?? null}
      acceptedVersion={profile?.legal_accepted_version ?? null}
    />
  );
}
