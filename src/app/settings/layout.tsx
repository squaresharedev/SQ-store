import type { Metadata } from "next";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { getProfile, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Settings shell — PROTECTED. Session is read server-side here (and again in
 * every page/action); never in middleware.
 *
 * Settings is NOT a separate overlay: it renders inside the same dashboard
 * chrome as the rest of the app. The main `Sidebar` stays visible on the left
 * (with "Settings" highlighted), and `SettingsShell` adds the settings
 * sub-navigation as a second rail right beside it.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("/settings");
  const profile = await getProfile();
  const username = profile?.display_name || user.email?.split("@")[0] || "Account";

  return (
    <div className="min-h-screen bg-background">
      <Sidebar username={username} />
      <div className="md:pl-64">
        <SettingsShell>{children}</SettingsShell>
      </div>
    </div>
  );
}
