import { TriangleAlert } from "lucide-react";
import { TwoFactorCard } from "@/components/settings/security/TwoFactorCard";
import { RecoveryCodesCard } from "@/components/settings/security/RecoveryCodesCard";
import {
  SecurityActivityCard,
  type SecurityActivityItem,
} from "@/components/settings/security/SecurityActivityCard";

export type SecurityFactor = { id: string; name: string; createdAt: string };

/**
 * Settings › Security. The ids are universal search's landing points
 * (#two-factor, #recovery-codes, #activity).
 */
export function SecuritySection({
  enrolled,
  factors,
  hasPassword,
  signedInRecently,
  recoveryCodesRemaining,
  activity,
  recovered,
  openSetup,
}: {
  enrolled: boolean;
  factors: SecurityFactor[];
  hasPassword: boolean;
  signedInRecently: boolean;
  /** Unused recovery codes, or null when 2FA is off or the count failed. */
  recoveryCodesRemaining: number | null;
  /** Null when the log could not be read (shown as such, never as "empty"). */
  activity: SecurityActivityItem[] | null;
  recovered: boolean;
  openSetup: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      {recovered && !enrolled && (
        <div
          role="status"
          className="flex items-start gap-3 border border-destructive/40 bg-destructive/5 px-4 py-3"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="font-inter text-sm text-foreground">
            <span className="font-semibold">Two-factor authentication is off.</span>{" "}
            You signed in with a recovery code, which removed your old
            authenticator and signed out your other devices. Set it up again
            now so your password isn&rsquo;t the only thing protecting your
            account.
          </p>
        </div>
      )}

      <TwoFactorCard
        enrolled={enrolled}
        factors={factors}
        hasPassword={hasPassword}
        signedInRecently={signedInRecently}
        openSetup={openSetup && !enrolled}
      />

      {enrolled && <RecoveryCodesCard remaining={recoveryCodesRemaining} />}

      <SecurityActivityCard items={activity} />
    </div>
  );
}
