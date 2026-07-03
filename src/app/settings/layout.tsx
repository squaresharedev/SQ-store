import type { Metadata } from "next";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { BackgroundArrow } from "@/components/ui/BackgroundArrow";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * Settings shell — PROTECTED. Session is read server-side here (and again in
 * every page/action); never in middleware. The giant faint arrows are the
 * same background motif as the sign-in page, layered behind all content.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser("/settings");

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <BackgroundArrow side="left" />
      <BackgroundArrow side="right" />
      <SettingsShell>{children}</SettingsShell>
    </main>
  );
}
