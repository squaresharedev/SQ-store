"use client";

import { useActionState, useId } from "react";
import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { infoTextClass, labelClass } from "@/components/ui/control-styles";
import { useActionStateToast, useSaveResult } from "@/components/ui/ActionErrorNotice";
import { SaveButton } from "@/components/ui/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { TermsSummary } from "@/components/legal/TermsSummary";
import { acceptLegal } from "@/lib/settings/actions";
import type { ActionState } from "@/lib/errors";
import { formatLongDate } from "@/lib/format/date";
import { TermsChangeNotice, TermsChangesList } from "@/components/legal/TermsChangeNotice";
import type { TermsStatus } from "@/lib/legal/terms-versions";
import { LEGAL_VERSION } from "@/lib/settings/constants";

const INITIAL: ActionState = {};

/**
 * Settings › Legal: the Terms of Service agreement on file, and the way to give
 * it when there is none for the current version (a seller who skipped past the
 * welcome before it asked, or Terms that changed since).
 *
 * The SAME summary and the same rule as the welcome flow's terms step
 * (components/onboarding/WelcomeFlow.tsx): the summary, then "I have read and
 * agree to the Terms", recorded by acceptLegal with the time and version.
 * Two places that record one agreement must ask for it the same way, so the
 * note under the button is the welcome flow's own sentence.
 *
 * The version is recorded, never shown: a slug ("tos-2026-11-06") reads as a
 * database key, and an account that agreed before the dated versions holds an
 * older shape of it. The summary above already says when these Terms are from.
 */
export function LegalSection({
  acceptedAt,
  acceptedVersion,
  upcoming = null,
}: {
  acceptedAt: string | null;
  acceptedVersion: string | null;
  /** The Terms version on its way, if any. */
  upcoming?: TermsStatus["upcoming"];
}) {
  const t = useTranslations("Settings.legal");
  const tWelcome = useTranslations("Onboarding.welcome.terms");
  const locale = useLocale();
  const [state, formAction, isPending] = useActionState(acceptLegal, INITIAL);
  useActionStateToast(state);
  const saveResult = useSaveResult(state);
  const hintId = useId();
  const isCurrent = acceptedAt !== null && acceptedVersion === LEGAL_VERSION;
  const isOutdated = acceptedAt !== null && !isCurrent;

  return (
    <SettingsCard
      title={t("termsTitle")}
      description={t("termsDescription")}
    >
      <div className="flex flex-col gap-4">
        {/* Agreeing early settles it: the notice would only contradict the
            "nothing more to do" below, as the shell's banner already knows. */}
        {upcoming && !isCurrent && (
          <>
            <TermsChangeNotice upcoming={upcoming} />
            {/* The notice just said the current Terms still apply; the summary
                and the button below are the new ones, so say which. */}
            <p className={labelClass}>{t("notice.summaryIsNew")}</p>
          </>
        )}
        <TermsSummary />

        {isCurrent ? (
          <p
            className="flex items-start gap-2 border border-border bg-accent px-4 py-3 text-sm text-foreground"
            data-terms-agreed
          >
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
            <span>{t("agreed", { date: formatLongDate(acceptedAt, locale) })}</span>
          </p>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            {isOutdated && (
              <div
                className="flex flex-col gap-2 border border-border bg-accent px-4 py-3 font-inter text-sm text-muted-foreground"
                data-terms-outdated
              >
                <p>{t("agreedOutdated", { date: formatLongDate(acceptedAt, locale) })}</p>
                {/* Once the new Terms apply, the notice above is gone; what it
                    listed is what this agreement is being asked for again. */}
                {!upcoming && (
                  <>
                    <p className={labelClass}>{t("whatChanged")}</p>
                    <TermsChangesList version={LEGAL_VERSION} />
                  </>
                )}
              </div>
            )}
            <input type="hidden" name="version" value={LEGAL_VERSION} />
            <div className="flex flex-col items-start gap-2">
              <SaveButton
                pending={isPending}
                state={saveResult}
                pendingLabel={t("recording")}
                aria-describedby={hintId}
              >
                {t("agreeButton")}
              </SaveButton>
              <p id={hintId} className={infoTextClass} aria-live="polite">
                {tWelcome("agreeNote")}
              </p>
            </div>
          </form>
        )}
      </div>
    </SettingsCard>
  );
}
