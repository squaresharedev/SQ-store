import type { Metadata } from "next";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { requireUser } from "@/lib/auth/session";

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
  await requireUser("/settings");

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="md:pl-64">
        <SettingsShell>{children}</SettingsShell>
      </div>
    </div>
  );
}
