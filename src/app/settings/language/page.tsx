import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LanguageCard } from "@/components/settings/LanguageCard";
import { requireUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.metadata.language");
  return { title: t("title") };
}

export default async function LanguageSettingsPage() {
  await requireUser("/settings/language");
  return <LanguageCard />;
}
