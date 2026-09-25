"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { useActionStateToast, useSaveResult } from "@/components/ui/ActionErrorNotice";
import { SaveButton } from "@/components/ui/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/lib/errors";
import { updateBio } from "@/lib/settings/actions";
import { BIO_MAX } from "@/lib/settings/constants";
import { helpTextClass } from "@/components/ui/control-styles";

const INITIAL: ActionState = {};

/**
 * A short public line about the seller, shown in the Seller section of every
 * hosted product page this account sells on (lib/settings/seller-identity.ts).
 * Lives right under the username on purpose: both are public-identity facts
 * about the ACCOUNT, not the legally-weighted trader details in Settings ›
 * Business & seller details, which is why this is its own small card and its
 * own action (updateBio) rather than a field on saveTaxInfo.
 *
 * Optional everywhere: never part of the publish gate, so a blank bio never
 * blocks anything.
 */
export function BioForm({ bio: savedBio }: { bio: string }) {
  const t = useTranslations("Settings.account.bio");
  const [state, formAction, isPending] = useActionState(updateBio, INITIAL);
  useActionStateToast(state);
  const saveResult = useSaveResult(state);

  // Controlled, same reasoning as UsernameForm/TaxSection: a failed save must
  // not revert what was typed.
  const [bio, setBio] = useState(savedBio);

  return (
    <SettingsCard id="bio" title={t("cardTitle")} description={t("cardDescription")}>
      <form action={formAction} className="flex flex-col gap-1.5" noValidate>
        <span className="flex items-baseline gap-1.5">
          <Label htmlFor="seller_bio">{t("label")}</Label>
          {/* Not aria-hidden, unlike RequiredMark: this is information a
              screen reader user needs too ("must I fill this in?"), not
              decoration. */}
          <span className="font-inter text-xs text-muted-foreground">{t("optional")}</span>
        </span>
        <Textarea
          id="seller_bio"
          name="seller_bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder={t("placeholder")}
          maxLength={BIO_MAX}
          rows={2}
          // Thinner than the shared Textarea's default 2px border-input: a
          // one-off dial-down for this field alone, set inline so it wins
          // regardless of Tailwind's own class-order rather than fighting
          // `border-2` with another border-width utility of equal specificity.
          style={{ borderWidth: 1 }}
          aria-describedby="seller-bio-count"
          disabled={isPending}
          className="max-w-lg"
        />
        <div className="flex max-w-lg items-center justify-between gap-2">
          <p id="seller-bio-count" className={helpTextClass}>
            {t("charactersLeft", { count: BIO_MAX - bio.length })}
          </p>
          <SaveButton pending={isPending} state={saveResult} className="shrink-0" />
        </div>
      </form>
    </SettingsCard>
  );
}
