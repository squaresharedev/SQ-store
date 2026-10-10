import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { DangerZone } from "@/components/settings/DangerZone";
import { requireUser } from "@/lib/auth/session";
import { getDeletionStatus } from "@/lib/account-deletion/requests";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.metadata.danger");
  return { title: t("title") };
}

export default async function DangerSettingsPage() {
  const user = await requireUser("/settings/danger");
  // From the record the deletion job acts on, not the flag on the profile: the
  // page then says exactly what will happen, and when.
  return <DangerZone deletion={await getDeletionStatus(user.id)} />;
}
