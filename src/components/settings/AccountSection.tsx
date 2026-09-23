import { TourReplayCard } from "@/components/onboarding/TourReplayCard";
import { AvatarUpload } from "@/components/settings/AvatarUpload";
import { BioForm } from "@/components/settings/BioForm";
import { EmailChangeForm } from "@/components/settings/EmailChangeForm";
import { PasswordCard } from "@/components/settings/PasswordCard";
import { SignOutSection } from "@/components/settings/SignOutSection";
import { TwoFactorPrompt } from "@/components/settings/TwoFactorPrompt";
import { UsernameForm } from "@/components/settings/UsernameForm";

/**
 * Account section: profile photo, username, bio, email (Supabase
 * re-verification flow) and password.
 *
 * ONE name. The username is both what buyers see and what you sign in with;
 * there is no separate display name, so the two can never disagree and "is this
 * taken?" is a single question. The bio sits right under it: both are public
 * facts about this account with no legal weight, unlike the trader identity in
 * Settings › Business & seller details (name, address, contact email) that the
 * publish gate actually requires.
 */
export function AccountSection({
  username,
  bio,
  email,
  avatarUrl,
  hasPassword,
  twoFactorEnabled = true,
}: {
  /** The account's only identifier, or "" if it has not claimed one yet. */
  username: string;
  /** The account's public bio, or "" if unset. See BioForm for why it lives
   *  here rather than in Business & seller details. */
  bio: string;
  email: string;
  avatarUrl: string | null;
  /** Whether the account has a password HASH, resolved server-side rather than
   *  guessed from `identities`. Drives whether the email change asks for
   *  re-authentication and which way the password card reads. */
  hasPassword: boolean;
  /** Whether 2FA is on; off shows the prompt to turn it on. */
  twoFactorEnabled?: boolean;
}) {
  const name = username || email.split("@")[0] || "Account";
  // The ids are universal search's landing points: the registry maps "handle",
  // "log out", "change my email" and friends to /settings/account#<id>, so a
  // search lands on the CONTROL rather than the top of a long page. `scroll-mt`
  // clears the sticky h-14 top bar, which would otherwise cover the anchor.
  return (
    <div className="flex flex-col gap-6 [&>div]:scroll-mt-20">
      <div id="avatar">
        <AvatarUpload avatarUrl={avatarUrl} name={name} />
      </div>
      {/* No wrapper id here: the handle INPUT already owns `username`, and a
          second element with that id would be a duplicate — which quietly
          breaks the field's own <label for>. The input is the anchor instead. */}
      <div>
        <UsernameForm username={username} />
      </div>
      {/* No wrapper id either: BioForm's SettingsCard carries id="bio" itself. */}
      <BioForm bio={bio} />
      <div id="email">
        <EmailChangeForm email={email} hasPassword={hasPassword} />
      </div>
      {/* Always rendered. An account with no password needs this card MORE
          than one that has it, since it is the only way to get one. */}
      <div id="password">
        <PasswordCard hasPassword={hasPassword} email={email} />
      </div>
      {/* Right under the password, where people are already thinking about
          how they sign in. Gone once 2FA is on. */}
      <TwoFactorPrompt enabled={twoFactorEnabled} />
      {/* Also the guided tour's last stop, which points here so a seller knows
          where to find it again. */}
      <div id="tour">
        <TourReplayCard />
      </div>
      <div id="sign-out">
        <SignOutSection />
      </div>
    </div>
  );
}
