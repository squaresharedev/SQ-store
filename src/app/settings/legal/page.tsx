import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LegalSection } from "@/components/settings/LegalSection";
import { requireProfile, requireUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.metadata.legal");
  return { title: t("title") };
}

export default async function LegalSettingsPage() {
  await requireUser("/settings/legal");
  const profile = await requireProfile();

  return (
    <LegalSection
      acceptedAt={profile?.legal_accepted_at ?? null}
      acceptedVersion={profile?.legal_accepted_version ?? null}
    />
  );
}
