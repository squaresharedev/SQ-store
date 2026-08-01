import type { Metadata } from "next";
import { AccountSection } from "@/components/settings/AccountSection";
import { requireProfile, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Account settings",
};

export default async function AccountSettingsPage() {
  // Overlapped: requireProfile redirects to /login itself when signed out
  // (and throws on a failed read rather than seeding the form with blanks),
  // so starting both together only costs a discarded read in that case.
  const [user, profile] = await Promise.all([
    requireUser("/settings/account"),
    requireProfile(),
  ]);

  return (
    <AccountSection
      displayName={profile?.display_name ?? ""}
      email={user.email ?? ""}
      avatarUrl={profile?.avatar_url ?? null}
      // Password-backed accounts must re-authenticate to move their email;
      // OAuth-only accounts have no password to ask for.
      hasPassword={(user.identities ?? []).some((i) => i.provider === "email")}
    />
  );
}
