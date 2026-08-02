import { AvatarUpload } from "@/components/settings/AvatarUpload";
import { DisplayNameForm } from "@/components/settings/DisplayNameForm";
import { EmailChangeForm } from "@/components/settings/EmailChangeForm";
import { PasswordChangeForm } from "@/components/settings/PasswordChangeForm";
import { SignOutSection } from "@/components/settings/SignOutSection";

/**
 * Account section: profile photo, display name (also the account's unique
 * handle), email (Supabase re-verification flow) and password.
 */
export function AccountSection({
  displayName,
  email,
  avatarUrl,
  hasPassword,
}: {
  displayName: string;
  email: string;
  avatarUrl: string | null;
  /** Whether this account has a password identity (i.e. is not OAuth-only).
   *  Drives whether the email change asks for re-authentication. */
  hasPassword: boolean;
}) {
  const name = displayName || email.split("@")[0] || "Account";
  return (
    <div className="flex flex-col gap-6">
      <AvatarUpload avatarUrl={avatarUrl} name={name} />
      <DisplayNameForm displayName={displayName} />
      <EmailChangeForm email={email} hasPassword={hasPassword} />
      {hasPassword && <PasswordChangeForm />}
      <SignOutSection />
    </div>
  );
}
