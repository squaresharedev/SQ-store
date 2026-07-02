import { DisplayNameForm } from "@/components/settings/DisplayNameForm";
import { EmailChangeForm } from "@/components/settings/EmailChangeForm";
import { PasswordChangeForm } from "@/components/settings/PasswordChangeForm";

/**
 * Account section: display name, email (Supabase re-verification flow) and
 * password. Avatar upload is deferred — image uploads live in the storefront
 * slice's R2 path, and settings won't grow a second one.
 */
export function AccountSection({
  displayName,
  email,
}: {
  displayName: string;
  email: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <DisplayNameForm displayName={displayName} />
      <EmailChangeForm email={email} />
      <PasswordChangeForm />
      <p className="font-inter text-sm text-neutral-400">
        Profile photos are coming soon, right after storefront images land.
      </p>
    </div>
  );
}
