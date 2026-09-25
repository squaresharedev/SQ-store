import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountSection } from "@/components/settings/AccountSection";
import { accountHasPassword } from "@/lib/auth/has-password";
import { getAssurance, requireProfile, requireUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.metadata.account");
  return { title: t("title") };
}

export default async function AccountSettingsPage() {
  // Overlapped: requireProfile redirects to /login itself when signed out
  // (and throws on a failed read rather than seeding the form with blanks),
  // so starting both together only costs a discarded read in that case.
  const [user, profile] = await Promise.all([
    requireUser("/settings/account"),
    requireProfile(),
  ]);
  const [hasPassword, assurance] = await Promise.all([
    accountHasPassword(user.id),
    getAssurance(),
  ]);

  return (
    <AccountSection
      username={profile?.username ?? ""}
      bio={profile?.seller_bio ?? ""}
      email={user.email ?? ""}
      avatarUrl={profile?.avatar_url ?? null}
      // From the password HASH, not from `identities`: setting a password on an
      // OAuth account writes the hash without creating an `email` identity, so
      // the old check reported "no password" for accounts that had one. See
      // lib/auth/has-password.ts for what that broke.
      hasPassword={hasPassword}
      // Null (a failed read) counts as "on": never nag on a guess.
      twoFactorEnabled={assurance ? assurance.enrolled : true}
    />
  );
}
