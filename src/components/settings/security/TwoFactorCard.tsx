"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, Fingerprint, Plus, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { DURATION, EASE_ENTRANCE, POP, SETTLE } from "@/components/ui/motion-tokens";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { useActionStateToast, useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { dangerNoticeClass, helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { StepUpField } from "@/components/auth/StepUp";
import { SignInApprovalRow } from "@/components/settings/security/SignInApprovalRow";
import { TwoFactorSetupModal } from "@/components/settings/security/TwoFactorSetupModal";
import type { SecurityFactor } from "@/components/settings/security/SecuritySection";
import type { Locale } from "@/i18n/locales";
import { removeAuthenticator, type ManageState } from "@/lib/auth/mfa-actions";
import type { ActionState } from "@/lib/errors";
import { dateTimeFormat, intlTag } from "@/lib/format/intl";
import { cn } from "@/lib/utils";

const MANAGE_INITIAL: ManageState = {};

const ADDED_DAY: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
};

function formatDay(iso: string, locale: Locale): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : dateTimeFormat(intlTag(locale, "en-GB"), ADDED_DAY).format(date);
}

/** The glyph for each kind of factor in the list. */
const FACTOR_ICON = {
  passkey: Fingerprint,
  totp: Smartphone,
  unknown: TriangleAlert,
} as const satisfies Record<SecurityFactor["type"], unknown>;

/** Its kind, as the line under the name says it. */
const FACTOR_KIND_LABEL = {
  passkey: "kindPasskey",
  totp: "kindApp",
  unknown: "kindUnknown",
} as const satisfies Record<SecurityFactor["type"], string>;

/** Why bother, in the three sentences a busy seller will actually read. */
const BENEFITS = ["password", "changesBusiness", "alerts"] as const;

/**
 * The two-factor switch. Off: the case for turning it on, and the button that
 * starts it. On: the authenticators that can sign in, each removable, plus
 * "add another" for a backup phone.
 */
export function TwoFactorCard({
  enrolled,
  factors,
  hasPassword,
  signedInRecently,
  signsInWithGoogle,
  passkeysAvailable,
  approvalsEnabled = null,
  approvalsOffByDefault = false,
  openSetup,
}: {
  enrolled: boolean;
  factors: SecurityFactor[];
  hasPassword: boolean;
  signedInRecently: boolean;
  signsInWithGoogle: boolean;
  passkeysAvailable: boolean;
  /** Sign-in approval on or off; null (the default) when it is not available here. */
  approvalsEnabled?: boolean | null;
  /** Approval is off unless asked for on this account (passkeys only). */
  approvalsOffByDefault?: boolean;
  openSetup: boolean;
}) {
  const t = useTranslations("Settings.security.twoFactor");
  const tCommon = useTranslations("Common.actions");
  const locale = useLocale();
  const [setupOpen, setSetupOpen] = React.useState(openSetup);
  const [removing, setRemoving] = React.useState<SecurityFactor | null>(null);
  const closeSetup = React.useCallback(() => setSetupOpen(false), []);
  const closeRemove = React.useCallback(() => setRemoving(null), []);
  // Changes animate (2FA turning on, a way in added or removed); the page as
  // first drawn does not.
  const still = Boolean(useReducedMotion());
  // The ways in the app itself made. An unknown factor is listed (so it can be
  // seen and removed) but is never counted as one of them.
  const knownCount = factors.filter((factor) => factor.type !== "unknown").length;
  const hasUnknown = knownCount < factors.length;

  return (
    <SettingsCard
      id="two-factor"
      title={t("cardTitle")}
      description={enrolled ? t("descriptionOn") : t("descriptionOff")}
      decoration={enrolled ? undefined : "dots"}
    >
      <div className="flex flex-col gap-5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={enrolled ? "on" : "off"}
            className={cn(
              "inline-flex w-fit items-center gap-1.5 border px-2 py-1 font-inter text-xs font-semibold",
              enrolled
                ? "border-foreground text-foreground"
                : "border-border text-muted-foreground",
            )}
            data-two-factor-status={enrolled ? "on" : "off"}
            // Turning on is the news: it pops. Turning off just changes.
            initial={still ? false : { opacity: 0, scale: enrolled ? 0.8 : 1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={still ? undefined : { opacity: 0, transition: { duration: DURATION.fast } }}
            transition={enrolled ? POP : SETTLE}
          >
            <ShieldCheck aria-hidden className="size-3.5" />
            {enrolled ? t("statusOn") : t("statusOff")}
          </motion.p>
        </AnimatePresence>

        {enrolled ? (
          <>
            {hasUnknown && (
              <div role="alert" className={dangerNoticeClass} data-unknown-factor-warning>
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="font-inter text-sm text-foreground">{t("unknownWarning")}</p>
              </div>
            )}
            <ul className="divide-y divide-border border-y border-border" aria-label={t("listLabel")}>
              <AnimatePresence initial={false}>
                {factors.map((factor) => {
                  const Icon = FACTOR_ICON[factor.type];
                  return (
                  <motion.li
                    key={factor.id}
                    className="overflow-hidden"
                    initial={still ? false : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={still ? undefined : { opacity: 0, height: 0 }}
                    transition={{ duration: DURATION.slow, ease: EASE_ENTRANCE }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="flex min-w-0 items-center gap-2.5" data-factor-type={factor.type}>
                        <Icon
                          aria-hidden
                          className={cn(
                            "size-4 shrink-0",
                            factor.type === "unknown" ? "text-destructive" : "text-muted-foreground",
                          )}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-inter text-sm font-medium text-foreground">
                            {factor.name}
                          </p>
                          <p className={infoTextClass}>
                            {t(FACTOR_KIND_LABEL[factor.type])}
                            {" · "}
                            {t("added", { date: formatDay(factor.createdAt, locale) })}
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost-danger"
                        onClick={() => setRemoving(factor)}
                        aria-label={t("removeLabel", { name: factor.name })}
                      >
                        {tCommon("remove")}
                      </Button>
                    </div>
                  </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
            <div>
              <Button type="button" variant="secondary" onClick={() => setSetupOpen(true)}>
                <Plus aria-hidden className="size-4" />
                {t("addAnother")}
              </Button>
            </div>
            {approvalsEnabled !== null && (
              <div className="border-t border-border pt-4">
                <SignInApprovalRow
                  enabled={approvalsEnabled}
                  offByDefault={approvalsOffByDefault}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {BENEFITS.map((benefit) => (
                <li key={benefit} className={cn(helpTextClass, "flex items-start gap-2")}>
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-foreground" />
                  <span>{t(`benefits.${benefit}`)}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => setSetupOpen(true)}>
                <ShieldCheck aria-hidden className="size-4" />
                {t("setUp")}
              </Button>
              <span className={infoTextClass}>{t("takesAMinute")}</span>
            </div>
          </>
        )}
      </div>

      {/* Mounted outside the on/off branches above: finishing setup flips the
          card to "on" underneath the modal, and the modal (with the recovery
          codes it is about to show) must survive that re-render. */}
      <TwoFactorSetupModal
        key={setupOpen ? "open" : "closed"}
        open={setupOpen}
        onClose={closeSetup}
        adding={enrolled}
        hasPassword={hasPassword}
        signedInRecently={signedInRecently}
        signsInWithGoogle={signsInWithGoogle}
        passkeysAvailable={passkeysAvailable}
        existingNames={factors.map((factor) => factor.name)}
      />
      <RemoveAuthenticatorModal
        key={removing?.id ?? "none"}
        factor={removing}
        // Removing the last KNOWN way in turns 2FA off; an unknown one never does.
        isLast={removing?.type !== "unknown" && knownCount <= 1}
        onClose={closeRemove}
      />
    </SettingsCard>
  );
}

/**
 * Removing an authenticator always takes a code in the same request: turning
 * the protection off must require the protection. Removing the LAST one turns
 * 2FA off entirely and voids the recovery codes, and says so first.
 */
function RemoveAuthenticatorModal({
  factor,
  isLast,
  onClose,
}: {
  factor: SecurityFactor | null;
  isLast: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("Settings.security");
  const tCommon = useTranslations("Common.actions");
  const resolve = useResolveMessage();
  const [state, formAction, isPending] = useActionState(removeAuthenticator, MANAGE_INITIAL);
  // Success as a toast (the modal closes, so an inline line would vanish with
  // it); errors stay inline beside the code they are about. Memoised on the
  // state object, because the toast hook announces each NEW object it sees.
  const announced = React.useMemo<ActionState | undefined>(
    () => (state.success ? { success: state.success } : undefined),
    [state],
  );
  useActionStateToast(announced);

  React.useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  if (!factor) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={isLast ? t("remove.titleLast") : t("remove.title", { name: factor.name })}
      description={
        isLast
          ? t("remove.descriptionLast")
          : t("remove.description", { name: factor.name })
      }
      className="rounded-none sm:rounded-none"
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="factor_id" value={factor.id} />
        <StepUpField
          id="remove-factor"
          state={state}
          always
          description={t("stepUpConfirm")}
        />
        {state.error && (
          <p role="alert" className="font-inter text-sm font-medium text-destructive">
            {resolve(state.error.message)}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" variant="destructive" disabled={isPending} suppressHydrationWarning>
            {isPending ? (
              <>
                <Spinner />
                {t("remove.removing")}
              </>
            ) : isLast ? (
              t("remove.turnOff")
            ) : (
              tCommon("remove")
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
