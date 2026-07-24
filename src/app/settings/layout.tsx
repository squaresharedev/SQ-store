import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { getProfile, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Settings",
};

// force-dynamic: see (dashboard)/layout.tsx — requireUser()'s cookies() call
// happens after an env-var guard that can throw first, so implicit dynamic
// detection isn't reliable if NEXT_PUBLIC_SUPABASE_* is unset at build time.
export const dynamic = "force-dynamic";

/**
 * Settings shell — PROTECTED. Session is read server-side here (and again in
 * every page/action); never in middleware.
 *
 * Settings is NOT a separate overlay: it renders inside the SAME chrome as the
 * rest of the app. `DashboardShell` supplies the left Sidebar, the top bar
 * (notification bell + account menu), the "viewing another store" banner and
 * the notifications provider; `SettingsShell` then adds the settings
 * sub-navigation as a second rail beside the main one. Assembling that chrome
 * by hand here is what previously left settings with no top bar.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("/settings");
  const profile = await getProfile();
  const username =
    profile?.display_name || user.email?.split("@")[0] || "Account";

  return (
    <DashboardShell username={username}>
      <SettingsShell>{children}</SettingsShell>
    </DashboardShell>
  );
}
