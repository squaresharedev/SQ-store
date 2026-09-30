import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { dangerNoticeClass } from "@/components/ui/control-styles";
import { TwoFactorCard } from "@/components/settings/security/TwoFactorCard";
import { RecoveryCodesCard } from "@/components/settings/security/RecoveryCodesCard";
import {
  SecurityActivityCard,
  type SecurityActivityItem,
} from "@/components/settings/security/SecurityActivityCard";

export type SecurityFactor = {
  id: string;
  name: string;
  createdAt: string;
  /** "unknown": a factor the app has no record of making (see lib/auth/account-factors.ts). */
  type: "totp" | "passkey" | "unknown";
};

/**
 * Settings › Security. The ids are universal search's landing points
 * (#two-factor, #recovery-codes, #activity).
 */
export function SecuritySection({
  enrolled,
  factors,
  hasPassword,
  signedInRecently,
  signsInWithGoogle,
  passkeysAvailable,
  approvalsEnabled = null,
  approvalsOffByDefault = false,
  recoveryCodesRemaining,
  activity,
  recovered,
  openSetup,
}: {
  enrolled: boolean;
  factors: SecurityFactor[];
  hasPassword: boolean;
  signedInRecently: boolean;
  signsInWithGoogle: boolean;
  /** Passkeys are configured in this deployment. */
  passkeysAvailable: boolean;
  /** Sign-in approval on or off; null (the default) when it is not available here. */
  approvalsEnabled?: boolean | null;
  /** Approval is off unless asked for on this account (passkeys only). */
  approvalsOffByDefault?: boolean;
  /** Unused recovery codes, or null when 2FA is off or the count failed. */
  recoveryCodesRemaining: number | null;
  /** Null when the log could not be read (shown as such, never as "empty"). */
  activity: SecurityActivityItem[] | null;
  recovered: boolean;
  openSetup: boolean;
}) {
  const t = useTranslations("Settings.security");

  return (
    <div className="flex flex-col gap-6">
      {recovered && !enrolled && (
        <div role="status" className={dangerNoticeClass}>
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="font-inter text-sm text-foreground">
            {t.rich("recoveredNotice", {
              strong: (chunks) => <span className="font-semibold">{chunks}</span>,
            })}
          </p>
        </div>
      )}

      <TwoFactorCard
        enrolled={enrolled}
        factors={factors}
        hasPassword={hasPassword}
        signedInRecently={signedInRecently}
        signsInWithGoogle={signsInWithGoogle}
        passkeysAvailable={passkeysAvailable}
        approvalsEnabled={approvalsEnabled}
        approvalsOffByDefault={approvalsOffByDefault}
        openSetup={openSetup && !enrolled}
      />

      {enrolled && <RecoveryCodesCard remaining={recoveryCodesRemaining} />}

      <SecurityActivityCard items={activity} />
    </div>
  );
}
