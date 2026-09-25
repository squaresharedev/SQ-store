import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DangerZone } from "@/components/settings/DangerZone";
import { requireProfile, requireUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.metadata.danger");
  return { title: t("title") };
}

export default async function DangerSettingsPage() {
  await requireUser("/settings/danger");
  const profile = await requireProfile();

  return (
    <DangerZone deletionRequestedAt={profile?.deletion_requested_at ?? null} />
  );
}
