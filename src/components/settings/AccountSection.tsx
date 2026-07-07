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
}: {
  displayName: string;
  email: string;
  avatarUrl: string | null;
}) {
  const name = displayName || email.split("@")[0] || "Account";
  return (
    <div className="flex flex-col gap-6">
      <AvatarUpload avatarUrl={avatarUrl} name={name} />
      <DisplayNameForm displayName={displayName} />
      <EmailChangeForm email={email} />
      <PasswordChangeForm />
      <SignOutSection />
    </div>
  );
}
