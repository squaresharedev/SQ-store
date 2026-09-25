import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { requireProfile, requireUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.metadata.notifications");
  return { title: t("title") };
}

export default async function NotificationsSettingsPage() {
  await requireUser("/settings/notifications");
  const profile = await requireProfile();

  return (
    <NotificationsSection
      defaults={{
        // DB defaults for new users: sales + product updates on, marketing off.
        notify_sales: profile?.notify_sales ?? true,
        notify_product_updates: profile?.notify_product_updates ?? true,
        notify_marketing: profile?.notify_marketing ?? false,
      }}
    />
  );
}
