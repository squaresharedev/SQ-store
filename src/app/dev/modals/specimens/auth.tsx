"use client";

import { History, LogIn, ShieldAlert, ShieldX, TimerOff, UserX } from "lucide-react";
import { useTranslations } from "next-intl";
import { ApproveSignIn } from "@/components/auth/ApproveSignIn";
import { AuthNotice } from "@/components/auth/AuthNotice";
import type { FactorChoice } from "@/components/auth/FactorPicker";
import { PasswordResetModal } from "@/components/auth/PasswordResetModal";
import { StepUpProvider } from "@/components/auth/StepUp";
import { SuccessMark } from "@/components/auth/SuccessMark";
import { TwoFactorChallenge } from "@/components/auth/TwoFactorChallenge";
import { PasswordModal } from "@/components/settings/PasswordModal";
import { RecoveryCodesCard } from "@/components/settings/security/RecoveryCodesCard";
import type { SecurityFactor } from "@/components/settings/security/SecuritySection";
import { SignInApprovalRow } from "@/components/settings/security/SignInApprovalRow";
import { TwoFactorCard } from "@/components/settings/security/TwoFactorCard";
import { TwoFactorSetupModal } from "@/components/settings/security/TwoFactorSetupModal";
import { Button } from "@/components/ui/button";
import { HeroMark } from "@/components/ui/HeroMark";
import { PressOnMount, type Specimen } from "./types";

/** The approval page's dead ends and end states, each with the mark the real
 *  page gives it (app/(auth)/approve/[token]/page.tsx, auth/ApproveSignIn). */
const APPROVAL_NOTICES = {
  expired: { mark: <HeroMark icon={TimerOff} />, action: null },
  signIn: { mark: <HeroMark icon={LogIn} />, action: "signIn.button" },
  otherAccount: { mark: <HeroMark icon={UserX} />, action: null },
  stale: { mark: <HeroMark icon={History} />, action: "stale.button" },
  approved: { mark: <SuccessMark kind="device" size="md" />, action: null },
  denied: { mark: <HeroMark icon={ShieldX} />, action: "denied.changePassword" },
  mismatch: { mark: <HeroMark icon={ShieldAlert} tone="danger" />, action: "denied.changePassword" },
} as const;

/** The states that end with a Back button, as the real page and ApproveSignIn do. */
const DEAD_ENDS: ReadonlySet<keyof typeof APPROVAL_NOTICES> = new Set([
  "expired",
  "otherAccount",
  "approved",
  "denied",
  "mismatch",
]);

function ApprovalNotice({ state }: { state: keyof typeof APPROVAL_NOTICES }) {
  const t = useTranslations("Auth.approve");
  const { mark, action } = APPROVAL_NOTICES[state];
  return (
    <AuthNotice
      visual={mark}
      heading={t(`${state}.heading`)}
      body={t(`${state}.body`)}
      back={DEAD_ENDS.has(state)}
    >
      {action && <Button className="w-full">{t(action)}</Button>}
    </AuthNotice>
  );
}

const approvalNotice = (state: keyof typeof APPROVAL_NOTICES, label: string): Specimen => ({
  id: `approve-${state}`,
  group: "Sign-in approval (phone)",
  label,
  kind: "page",
  render: () => <ApprovalNotice state={state} />,
});

/** A pretend account for the setup dialog: which passkeys and apps it already
 *  has decides how "confirm it's you" is asked. The buttons call the real
 *  actions, which refuse a visitor with no session; only the first step shows. */
const SETUP_ACCOUNTS = {
  none: [],
  passkey: [{ id: "dev-passkey", name: "Passkey", type: "passkey" }],
  app: [{ id: "dev-app", name: "Authenticator app", type: "totp" }],
} as const satisfies Record<string, readonly FactorChoice[]>;

const setupDialog = (
  id: string,
  label: string,
  account: keyof typeof SETUP_ACCOUNTS,
  props: { adding: boolean; signedInRecently: boolean; signsInWithGoogle?: boolean },
): Specimen => ({
  id: `setup-${id}`,
  group: "Two-factor setup",
  label,
  kind: "dialog",
  render: ({ onClose }) => (
    <StepUpProvider
      enrolled={account !== "none"}
      freshUntil={account === "none" ? null : 0}
      factors={[...SETUP_ACCOUNTS[account]]}
    >
      <TwoFactorSetupModal
        open
        onClose={onClose}
        adding={props.adding}
        hasPassword
        signedInRecently={props.signedInRecently}
        signsInWithGoogle={props.signsInWithGoogle ?? false}
        passkeysAvailable
        existingNames={SETUP_ACCOUNTS[account].map((factor) => factor.name)}
      />
    </StepUpProvider>
  ),
});

const DEV_FACTORS: Record<"passkey" | "app", SecurityFactor> = {
  passkey: { id: "dev-passkey", name: "Passkey", createdAt: "2026-09-12T10:00:00Z", type: "passkey" },
  app: { id: "dev-app", name: "Authenticator app", createdAt: "2026-09-12T10:00:00Z", type: "totp" },
};

/** The two-factor card with a pretend account, and its Remove pressed: the
 *  confirm it opens is the specimen. `factors` decides how it asks for proof. */
const removeDialog = (
  id: string,
  label: string,
  factors: readonly ("passkey" | "app")[],
  /** Which row's Remove is pressed. */
  press: "passkey" | "app",
): Specimen => ({
  id: `security-remove-${id}`,
  group: "Security confirms",
  label,
  kind: "dialog",
  render: () => (
    <StepUpProvider
      enrolled
      freshUntil={0}
      factors={factors.map((kind) => SETUP_ACCOUNTS[kind][0])}
    >
      {/* By its English name: the gallery always runs in English. */}
      <PressOnMount selector={`[data-dev-security] button[aria-label="Remove ${DEV_FACTORS[press].name}"]`}>
        <div className="mx-auto max-w-2xl px-6" data-dev-security>
          <TwoFactorCard
            enrolled
            factors={factors.map((kind) => DEV_FACTORS[kind])}
            hasPassword
            signedInRecently={false}
            signsInWithGoogle={false}
            passkeysAvailable
            openSetup={false}
          />
        </div>
      </PressOnMount>
    </StepUpProvider>
  ),
});

/** The sign-in challenge, opening on one way through. The passkey way asks the
 *  server for its options, which a visitor with no session is refused. */
const challenge = (id: string, label: string, factors: FactorChoice[]): Specimen => ({
  id: `challenge-${id}`,
  group: "Two-factor at sign-in",
  label,
  kind: "page",
  render: () => <TwoFactorChallenge next="/dashboard" email="edwardsadrianj@gmail.com" factors={factors} />,
});

export const AUTH: readonly Specimen[] = [
  challenge("passkey", "Passkey", [...SETUP_ACCOUNTS.passkey, ...SETUP_ACCOUNTS.app]),
  challenge("code", "Authenticator code", [...SETUP_ACCOUNTS.app]),
  challenge("recovery", "Recovery code", []),
  removeDialog("last-code", "Turn off 2FA (a code)", ["app"], "app"),
  removeDialog("last-passkey", "Turn off 2FA (a passkey)", ["passkey"], "passkey"),
  removeDialog("one-of-two", "Remove one of two", ["passkey", "app"], "app"),
  {
    id: "security-approval",
    group: "Security confirms",
    label: "Turn on sign-in approval",
    kind: "dialog",
    render: () => (
      <PressOnMount selector="[data-sign-in-approval] button">
        <div className="mx-auto max-w-2xl px-6">
          <SignInApprovalRow enabled={false} offByDefault />
        </div>
      </PressOnMount>
    ),
  },
  {
    id: "security-regenerate",
    group: "Security confirms",
    label: "Generate new recovery codes",
    kind: "dialog",
    render: () => (
      <StepUpProvider enrolled freshUntil={0} factors={[...SETUP_ACCOUNTS.app]}>
        <PressOnMount selector="#recovery-codes button">
          <div className="mx-auto max-w-2xl px-6">
            <RecoveryCodesCard remaining={7} />
          </div>
        </PressOnMount>
      </StepUpProvider>
    ),
  },
  {
    id: "approve-open",
    group: "Sign-in approval (phone)",
    label: "Approve?",
    kind: "page",
    render: () => (
      <ApproveSignIn
        token="dev"
        email="edwardsadrianj@gmail.com"
        device={{ browser: "Chrome", os: "Windows" }}
        location={null}
        choices={[24, 69, 41]}
      />
    ),
  },
  {
    id: "approve-open-phone-known",
    group: "Sign-in approval (phone)",
    label: "Approve? (a phone, country known)",
    kind: "page",
    render: () => (
      <ApproveSignIn
        token="dev"
        email="edwardsadrianj@gmail.com"
        device={{ browser: "Safari", os: "iOS" }}
        location="Austria"
        choices={[17, 42, 88]}
      />
    ),
  },
  approvalNotice("approved", "Approved"),
  approvalNotice("denied", "Denied"),
  approvalNotice("mismatch", "Wrong number"),
  approvalNotice("expired", "Expired"),
  approvalNotice("signIn", "Signed out"),
  approvalNotice("otherAccount", "Other account"),
  approvalNotice("stale", "Stale approver"),
  setupDialog("add-passkey", "Add (confirm with passkey)", "passkey", { adding: true, signedInRecently: false }),
  setupDialog("add-code", "Add (confirm with a code)", "app", { adding: true, signedInRecently: false }),
  setupDialog("enable-recent", "Turn on (just signed in)", "none", { adding: false, signedInRecently: true }),
  setupDialog("enable-password", "Turn on (asks the password)", "none", { adding: false, signedInRecently: false }),
  setupDialog("enable-google", "Turn on (Google account)", "none", {
    adding: false,
    signedInRecently: false,
    signsInWithGoogle: true,
  }),
  {
    id: "password-email",
    group: "Password",
    label: "Reset from Settings",
    kind: "dialog",
    render: ({ onClose }) => (
      <PasswordModal open onClose={onClose} hasPassword email="edwardsadrianj@gmail.com" />
    ),
  },
  {
    id: "password-forgot",
    group: "Password",
    label: "Forgot? (sign-in page)",
    kind: "dialog",
    render: ({ onClose }) => <PasswordResetModal open onClose={onClose} />,
  },
];
