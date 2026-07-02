import type { Metadata } from "next";
import { AccountSection } from "@/components/settings/AccountSection";
import { getProfile, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Account settings",
};

export default async function AccountSettingsPage() {
  const user = await requireUser("/settings/account");
  const profile = await getProfile();

  return (
    <AccountSection
      displayName={profile?.display_name ?? ""}
      email={user.email ?? ""}
    />
  );
}
