import type { Metadata } from "next";
import { AccountSection } from "@/components/settings/AccountSection";
import { accountHasPassword } from "@/lib/auth/has-password";
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
  const hasPassword = await accountHasPassword(user.id);

  return (
    <AccountSection
      username={profile?.username ?? ""}
      email={user.email ?? ""}
      avatarUrl={profile?.avatar_url ?? null}
      // From the password HASH, not from `identities`: setting a password on an
      // OAuth account writes the hash without creating an `email` identity, so
      // the old check reported "no password" for accounts that had one. See
      // lib/auth/has-password.ts for what that broke.
      hasPassword={hasPassword}
    />
  );
}
