"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useActionStateToast, useSaveResult } from "@/components/ui/ActionErrorNotice";
import { SaveButton } from "@/components/ui/SaveButton";
import { StepUpField } from "@/components/auth/StepUp";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import {
  resendSellerEmailVerification,
  saveTaxInfo,
} from "@/lib/settings/actions";
import type { ActionState } from "@/lib/errors";
import { SELLER_FIELD_MAX } from "@/lib/settings/constants";
import { useEuCountries } from "@/components/settings/use-eu-countries";
import { InfoTip } from "@/components/ui/InfoTip";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { LEGAL_LINKS } from "@/lib/legal/links";
import {
  helpTextClass,
  iconNudgeRightClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

const INITIAL: ActionState = {};

/**
 * Each `?verified=` outcome the confirmation route can report, and its tone.
 * The words are under Settings.tax.verifyOutcome, and every one names a next
 * step, because arriving here from a mail client with "expired" and nothing
 * else is a dead end. An outcome not listed here is never announced.
 */
const VERIFY_OUTCOMES = {
  verified: "success",
  expired: "error",
  stale: "error",
  invalid: "error",
  throttled: "error",
} as const;

type VerifyOutcome = keyof typeof VERIFY_OUTCOMES;

function isVerifyOutcome(value: string): value is VerifyOutcome {
  return Object.hasOwn(VERIFY_OUTCOMES, value);
}

/** Report a `?verified=` outcome once per arrival. */
function useVerifyOutcomeToast(outcome: string | undefined) {
  const t = useTranslations("Settings.tax.verifyOutcome");
  const toast = useToast();
  const announced = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!outcome || announced.current === outcome) return;
    announced.current = outcome;
    if (!isVerifyOutcome(outcome)) return;
    const message = t(outcome);
    if (VERIFY_OUTCOMES[outcome] === "success") toast.success(message);
    else toast.error(message);
  }, [outcome, toast, t]);
}

/**
 * VAT prefix -> ISO country code. Most EU countries use their ISO code as the
 * VAT prefix, but Greece diverges: ISO GR, VAT prefix EL. The reverse map is
 * below. Both are advisory only — the server never blocks on them.
 */
const VAT_PREFIX_TO_ISO: Record<string, string> = {
  AT: "AT", BE: "BE", BG: "BG", HR: "HR", CY: "CY", CZ: "CZ",
  DK: "DK", EE: "EE", EL: "GR", FI: "FI", FR: "FR", DE: "DE",
  HU: "HU", IE: "IE", IT: "IT", LV: "LV", LT: "LT", LU: "LU",
  MT: "MT", NL: "NL", PL: "PL", PT: "PT", RO: "RO", SK: "SK",
  SI: "SI", ES: "ES", SE: "SE",
};

/** ISO country code -> VAT prefix (GR is the one divergence from the ISO code). */
const ISO_TO_VAT_PREFIX: Partial<Record<string, string>> = {
  GR: "EL",
};

type VatAdvisory =
  | { kind: "noCountry"; issuer: string }
  | { kind: "mismatch"; issuer: string; selected: string };

/**
 * Country/VAT advisory: says which warning applies when the VAT ID's country
 * prefix and the selected country disagree, or when an EU VAT ID is paired
 * with "Not in the EU". Advisory only — the server still accepts the save.
 */
function vatAdvisory(
  vatId: string,
  countryCode: string,
  countryName: (code: string) => string,
): VatAdvisory | null {
  const raw = vatId.trim().toUpperCase();
  if (raw.length < 2) return null;

  const prefix = raw.slice(0, 2);
  const impliedIso = VAT_PREFIX_TO_ISO[prefix];
  if (!impliedIso) return null; // not a recognised EU VAT prefix

  // Find the country name for a friendlier message.
  const issuer = countryName(impliedIso);

  if (countryCode === "") {
    // A recognised EU VAT prefix alongside "not in the EU" is almost certainly
    // a mistake, since the prefix tells us which member state issued the number.
    return { kind: "noCountry", issuer };
  }

  // The expected prefix for the selected country (default: same as ISO code).
  const expectedPrefix = ISO_TO_VAT_PREFIX[countryCode] ?? countryCode;
  if (prefix !== expectedPrefix) {
    return { kind: "mismatch", issuer, selected: countryName(countryCode) };
  }

  return null;
}

/**
 * Business & seller details: the trader identity distance-selling law asks
 * for next to every offer (name, a postal address, a way to get in touch),
 * plus the VAT/invoicing fields it started as. SET ONCE HERE, not per
 * storefront: `lib/settings/seller-identity.ts` is the one place that reads
 * these six columns into what every hosted product page this account sells
 * on shows in its Seller section (see SellerBlock.tsx) — a business fact is
 * true everywhere at once, not per store, and this is the only place that
 * writes it.
 *
 * WHY CONTROLLED. Every field here is controlled from local state seeded by
 * props. React 19 resets an uncontrolled form after any form action
 * completes, success or failure — which meant that a failed save (e.g. a bad
 * email) silently reverted the two valid fields the seller had also changed.
 * Matching the pattern ShippingSection uses: state is the source of truth,
 * so a reset never touches the values, and the invariant holds both ways: a
 * failed save keeps what was typed; a successful save keeps what was saved
 * (because what was typed IS what was saved).
 */
export function TaxSection({
  businessName: savedBusinessName,
  address: savedAddress,
  email: savedEmail,
  vatId: savedVatId,
  country: savedCountry,
  phone: savedPhone,
  emailVerified = false,
  verificationOn = false,
  verifyOutcome,
  continueHref,
}: {
  businessName: string;
  address: string;
  email: string;
  vatId: string;
  country: string;
  phone: string;
  /** Has the stored contact address been proven by a clicked link? */
  emailVerified?: boolean;
  /** Can this deployment send the link at all? False hides the whole panel. */
  verificationOn?: boolean;
  /** `?verified=…` from the confirmation route, reported once as a toast. */
  verifyOutcome?: string;
  /** Where "Continue to your storefront" goes once these details are saved. */
  continueHref: string;
}) {
  const t = useTranslations("Settings");
  const tCommon = useTranslations("Common.actions");
  const { countries, countryName } = useEuCountries();
  // "" is a real choice (non-EU / declined), so it leads the list.
  const countryOptions: readonly SelectOption<string>[] = useMemo(
    () => [
      { value: "", label: t("tax.countryNotEu") },
      ...countries.map((c) => ({ value: c.code, label: c.name })),
    ],
    [countries, t],
  );
  const [state, formAction, isPending] = useActionState(saveTaxInfo, INITIAL);
  useActionStateToast(state);
  const saveResult = useSaveResult(state);

  // Controlled fields — seeded from the last saved values. The shared Select
  // is a button + listbox that can't submit via the form on its own, so its
  // value still rides in a hidden input, the same as the returns window Select
  // in ShippingSection.
  const [businessName, setBusinessName] = useState(savedBusinessName);
  const [address, setAddress] = useState(savedAddress);
  const [email, setEmail] = useState(savedEmail);
  const [vatId, setVatId] = useState(savedVatId);
  const [countryCode, setCountryCode] = useState(savedCountry);
  const [phone, setPhone] = useState(savedPhone);

  const vatWarning = vatAdvisory(vatId, countryCode, countryName);

  // Shown once a save lands, not just while SaveButton's own green flash is up
  // (that fades after a couple of seconds; the seller still needs a next
  // step after it does). Clears on the next submit's pending tick, and comes
  // back if that submit also succeeds.
  const justSaved = !isPending && Boolean(state.success);

  // What came back from a clicked confirmation link, said once. The route
  // redirects here with an outcome rather than rendering its own page, so
  // this is the single place that turns each outcome into words.
  const [resendState, resendAction, resendPending] = useActionState(
    resendSellerEmailVerification,
    INITIAL,
  );
  useActionStateToast(resendState);
  const resendResult = useSaveResult(resendState);
  useVerifyOutcomeToast(verifyOutcome);

  // The saved address is what a link would confirm; an edit in progress is
  // not confirmed by anything yet, and saying "confirmed" beside it would be
  // wrong the moment the seller types.
  const emailDirty = email.trim() !== savedEmail.trim();
  const showVerification = verificationOn && savedEmail.trim() !== "";

  return (
    <SettingsCard
      title={t("tax.cardTitle")}
      description={t("tax.cardDescription")}
    >
      {/* THE GATE, STATED WHERE IT IS RESOLVED. The three starred fields are
          what lib/settings/trader-identity.ts requires before anything of this
          account's may go on sale; a seller who arrived here from a blocked
          save needs to see which ones those are without going back. The second
          sentence is the promise the privacy policy makes on our behalf, said
          at the point of collection — a seller handing over a phone number and
          a home address is owed that before they type, not in a policy they
          would have to go and find. */}
      <div className="mb-4 rounded-md border border-border bg-muted/40 px-4 py-3">
        <p className="font-inter text-sm text-foreground">
          {t.rich("tax.gate.required", {
            strong: (chunks) => <span className="font-medium">{chunks}</span>,
          })}
        </p>
        <p className={`${helpTextClass} mt-1`}>
          {t.rich("tax.gate.privacyNoteLinked", {
            link: (chunks) => (
              <a
                href={LEGAL_LINKS.privacy.href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:no-underline"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </div>
      {/* The ids on each field wrapper are universal search's landing points
          (/settings/tax#vat and friends); scroll-mt clears the sticky top bar
          so the anchor doesn't land under it. */}
      <form
        action={formAction}
        className="flex flex-col gap-4 [&>div]:scroll-mt-20"
        noValidate
      >
        <div id="business-name" className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="tax_business_name">
              {t("tax.fields.businessName.label")}
              <RequiredMark />
            </Label>
            <InfoTip label={t("tax.fields.businessName.tipLabel")}>
              {t("tax.fields.businessName.tipBody")}
            </InfoTip>
          </span>
          <Input
            id="tax_business_name"
            name="tax_business_name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder={t("tax.fields.businessName.placeholder")}
            maxLength={200}
            autoComplete="organization"
            aria-required="true"
            disabled={isPending}
          />
        </div>
        <div id="address" className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="seller_address">
              {t("tax.fields.address.label")}
              <RequiredMark />
            </Label>
            <InfoTip label={t("tax.fields.address.tipLabel")}>
              {t("tax.fields.address.tipBody")}
            </InfoTip>
          </span>
          <Textarea
            id="seller_address"
            name="seller_address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t("tax.fields.address.placeholder")}
            maxLength={SELLER_FIELD_MAX.address}
            rows={3}
            aria-required="true"
            disabled={isPending}
          />
        </div>
        <div id="contact-email" className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="seller_email">
              {t("tax.fields.email.label")}
              <RequiredMark />
            </Label>
            <InfoTip label={t("tax.fields.email.tipLabel")}>
              {t("tax.fields.email.tipBody")}
            </InfoTip>
          </span>
          <Input
            id="seller_email"
            name="seller_email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("tax.fields.email.placeholder")}
            maxLength={254}
            autoComplete="email"
            aria-required="true"
            aria-describedby={showVerification ? "contact-email-status" : undefined}
            disabled={isPending}
          />
          {/* THE PROOF, or the lack of it. Only the SAVED address can be
              confirmed, so an unsaved edit says so rather than claiming a
              state that belongs to a different string. */}
          {showVerification && (
            <p
              id="contact-email-status"
              className={helpTextClass}
              // Not a live region: this is a standing fact about the field,
              // and the outcomes that DO need announcing arrive as toasts.
            >
              {emailDirty ? (
                t("tax.fields.email.statusDirty")
              ) : emailVerified ? (
                <span className="inline-flex items-center gap-1 text-foreground">
                  <Check aria-hidden className="size-3.5" strokeWidth={2.5} />
                  {t("tax.fields.email.statusConfirmed")}
                </span>
              ) : (
                t("tax.fields.email.statusUnconfirmed")
              )}
            </p>
          )}
        </div>

        <div id="vat" className="flex flex-col gap-1.5">
          <Label htmlFor="tax_vat_id">{t("tax.fields.vatId.label")}</Label>
          <Input
            id="tax_vat_id"
            name="tax_vat_id"
            value={vatId}
            onChange={(e) => setVatId(e.target.value)}
            placeholder={t("tax.fields.vatId.placeholder")}
            maxLength={32}
            disabled={isPending}
          />
          {/* Advisory only: the server still accepts the save, since a
              seller mid-registration must not be blocked by a warning. Under
              EU distance-selling rules a wrong VAT ID on a product page is a
              real compliance problem, so the warning is worth showing. */}
          {vatWarning && (
            <p className={helpTextClass} aria-live="polite">
              {vatWarning.kind === "noCountry"
                ? t("tax.vatAdvisory.noCountry", { issuer: vatWarning.issuer })
                : t("tax.vatAdvisory.mismatch", {
                    issuer: vatWarning.issuer,
                    selected: vatWarning.selected,
                  })}
            </p>
          )}
        </div>
        <div id="country" className="flex flex-col gap-1.5">
          <Label htmlFor="tax_country">{t("tax.fields.country.label")}</Label>
          <input type="hidden" name="tax_country" value={countryCode} />
          <Select
            id="tax_country"
            value={countryCode}
            options={countryOptions}
            onChange={setCountryCode}
            disabled={isPending}
          />
        </div>
        <div id="phone" className="flex flex-col gap-1.5">
          <Label htmlFor="seller_phone">{t("tax.fields.phone.label")}</Label>
          <Input
            id="seller_phone"
            name="seller_phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={SELLER_FIELD_MAX.phone}
            autoComplete="tel"
            disabled={isPending}
          />
        </div>
        <StepUpField id="business-details" state={state} />
        <div className="flex flex-wrap items-center gap-3">
          <SaveButton pending={isPending} state={saveResult} />
          {/* THE NEXT STEP, not just the confirmation. SaveButton already says
              "saved"; a seller who came here to clear the publish gate still
              needs to be told where to go next rather than left on a settings
              page wondering. Persists past SaveButton's own flash so the
              answer doesn't vanish before it's used. */}
          {justSaved && (
            <Link href={continueHref} className={cn(secondaryButtonClass, "w-fit")}>
              {t("continueToStorefront")}
              <ArrowRight
                className={cn("size-4", iconNudgeRightClass)}
                strokeWidth={2}
                aria-hidden
              />
            </Link>
          )}
        </div>
      </form>

      {/* A SIBLING of the save form, never nested inside it: a resend is a
          different request, and a form inside a form is invalid HTML that
          browsers resolve by dropping one of them. Shown only when there is
          something to confirm — not while the field holds an unsaved edit,
          because the link would go to the address that is stored, not the one
          on screen, which is exactly the confusion this avoids. */}
      {showVerification && !emailVerified && !emailDirty && (
        <form action={resendAction} className="mt-4">
          <SaveButton
            pending={resendPending}
            state={resendResult}
            pendingLabel={tCommon("sending")}
            savedLabel={tCommon("sent")}
            variant="secondary"
          >
            {t("tax.resend.button")}
          </SaveButton>
        </form>
      )}
    </SettingsCard>
  );
}
