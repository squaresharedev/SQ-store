"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { infoTextClass } from "@/components/ui/control-styles";
import { useActionStateToast, useSaveResult } from "@/components/ui/ActionErrorNotice";
import { SaveButton } from "@/components/ui/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { TermsSummary } from "@/components/legal/TermsSummary";
import { acceptLegal } from "@/lib/settings/actions";
import type { ActionState } from "@/lib/errors";
import { formatLongDate } from "@/lib/format/date";
import { LEGAL_VERSION } from "@/lib/settings/constants";

const INITIAL: ActionState = {};

/**
 * Settings › Legal: the Terms of Service agreement on file, and the way to give
 * it when there is none for the current version (a seller who skipped past the
 * welcome before it asked, or Terms that changed since).
 *
 * The SAME summary and the same rule as the welcome flow's terms step
 * (components/onboarding/WelcomeFlow.tsx): read to the end, then "I have read
 * and agree to the Terms", recorded by acceptLegal with the time and version.
 * Two places that record one agreement must ask for it the same way.
 */
export function LegalSection({
  acceptedAt,
  acceptedVersion,
}: {
  acceptedAt: string | null;
  acceptedVersion: string | null;
}) {
  const t = useTranslations("Settings.legal");
  const locale = useLocale();
  const [state, formAction, isPending] = useActionState(acceptLegal, INITIAL);
  const versionTag = (chunks: ReactNode) => (
    <span className="font-mono text-xs">{chunks}</span>
  );
  useActionStateToast(state);
  const saveResult = useSaveResult(state);
  const [read, setRead] = useState(false);
  const hintId = useId();
  const isCurrent = acceptedAt !== null && acceptedVersion === LEGAL_VERSION;
  const isOutdated = acceptedAt !== null && !isCurrent;

  return (
    <SettingsCard
      title={t("termsTitle")}
      description={t("termsDescription")}
    >
      <div className="flex flex-col gap-4">
        <TermsSummary onReadToEnd={() => setRead(true)} />

        {isCurrent ? (
          <p
            className="flex items-start gap-2 border border-border bg-accent px-4 py-3 text-sm text-foreground"
            data-terms-agreed
          >
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
            <span>
              {t.rich("agreed", {
                version: acceptedVersion,
                date: formatLongDate(acceptedAt, locale),
                code: versionTag,
              })}
            </span>
          </p>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            {isOutdated && (
              <p className="border border-border bg-accent px-4 py-3 font-inter text-sm text-muted-foreground">
                {t.rich("agreedOutdated", {
                  version: acceptedVersion ?? "",
                  date: formatLongDate(acceptedAt, locale),
                  code: versionTag,
                })}
              </p>
            )}
            <input type="hidden" name="version" value={LEGAL_VERSION} />
            <div className="flex flex-col items-start gap-2">
              <SaveButton
                pending={isPending}
                state={saveResult}
                pendingLabel={t("recording")}
                disabled={!read}
                aria-describedby={hintId}
              >
                {t("agreeButton")}
              </SaveButton>
              <p id={hintId} className={infoTextClass} aria-live="polite">
                {read
                  ? t.rich("agreeNote", {
                      version: LEGAL_VERSION,
                      code: (chunks) => <span className="font-mono">{chunks}</span>,
                    })
                  : t("scrollToAgree")}
              </p>
            </div>
          </form>
        )}
      </div>
    </SettingsCard>
  );
}
