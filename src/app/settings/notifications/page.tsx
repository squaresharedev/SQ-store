import type { Metadata } from "next";
import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { getProfile, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Notification settings",
};

export default async function NotificationsSettingsPage() {
  await requireUser("/settings/notifications");
  const profile = await getProfile();

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
