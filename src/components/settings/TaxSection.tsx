"use client";

import { useActionState, useState } from "react";
import { useActionToast } from "@/components/ui/Toast";
import { SaveButton } from "@/components/ui/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { saveTaxInfo, type SettingsActionState } from "@/lib/settings/actions";
import { EU_COUNTRIES, SELLER_FIELD_MAX } from "@/lib/settings/constants";
import { InfoTip } from "@/components/ui/InfoTip";
import { helpTextClass } from "@/components/ui/control-styles";

const INITIAL: SettingsActionState = {};

/** "" is a real choice (non-EU / declined), so it leads the list. */
const COUNTRY_OPTIONS: readonly SelectOption<string>[] = [
  { value: "", label: "Not in the EU / prefer not to say" },
  ...EU_COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
];

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

/**
 * Country/VAT advisory: returns a warning string when the VAT ID's country
 * prefix and the selected country disagree, or when an EU VAT ID is paired
 * with "Not in the EU". Advisory only — the server still accepts the save.
 */
function vatAdvisory(vatId: string, countryCode: string): string | null {
  const raw = vatId.trim().toUpperCase();
  if (raw.length < 2) return null;

  const prefix = raw.slice(0, 2);
  const impliedIso = VAT_PREFIX_TO_ISO[prefix];
  if (!impliedIso) return null; // not a recognised EU VAT prefix

  // Find the country name for a friendlier message.
  const countryName =
    EU_COUNTRIES.find((c) => c.code === impliedIso)?.name ?? impliedIso;

  if (countryCode === "") {
    // A recognised EU VAT prefix alongside "not in the EU" is almost certainly
    // a mistake, since the prefix tells us which member state issued the number.
    return `This VAT ID looks like it was issued by ${countryName}. You may want to set your country.`;
  }

  // The expected prefix for the selected country (default: same as ISO code).
  const expectedPrefix = ISO_TO_VAT_PREFIX[countryCode] ?? countryCode;
  if (prefix !== expectedPrefix) {
    const selectedName =
      EU_COUNTRIES.find((c) => c.code === countryCode)?.name ?? countryCode;
    return `This VAT ID looks like it was issued by ${countryName}, but your country is set to ${selectedName}. Check both are correct.`;
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
}: {
  businessName: string;
  address: string;
  email: string;
  vatId: string;
  country: string;
  phone: string;
}) {
  const [state, formAction, isPending] = useActionState(saveTaxInfo, INITIAL);
  useActionToast(state);

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

  const vatWarning = vatAdvisory(vatId, countryCode);

  return (
    <SettingsCard
      title="Business & seller details"
      description="Set once for your whole account. Shown to buyers on every product page you sell on, and used for invoices and VAT."
    >
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
            <Label htmlFor="tax_business_name">Business name</Label>
            <InfoTip label="When to fill in a business name">
              Only if you sell through a registered business. Selling as
              yourself is fine: leave it empty and your storefront&apos;s own
              name is shown instead.
            </InfoTip>
          </span>
          <Input
            id="tax_business_name"
            name="tax_business_name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Studio Builderboy e.U."
            maxLength={200}
            autoComplete="organization"
            disabled={isPending}
          />
        </div>
        <div id="address" className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="seller_address">Address</Label>
            <InfoTip label="Why buyers see this">
              Distance-selling law asks for a postal address next to every offer.
              Shown in the Seller section of your product pages.
            </InfoTip>
          </span>
          <Textarea
            id="seller_address"
            name="seller_address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={"12 Market Street\nDublin, D02 X285\nIreland"}
            maxLength={SELLER_FIELD_MAX.address}
            rows={3}
            disabled={isPending}
          />
        </div>
        <div id="contact-email" className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5">
            <Label htmlFor="seller_email">Contact email</Label>
            <InfoTip label="How this differs from your sign-in email">
              Shown to buyers as a mailto link, and used as the buy button&apos;s
              fallback when a product has no purchase link. Kept separate from
              your sign-in email on purpose: use whichever address you want
              buyers writing to.
            </InfoTip>
          </span>
          <Input
            id="seller_email"
            name="seller_email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="hello@yourshop.example"
            maxLength={254}
            autoComplete="email"
            disabled={isPending}
          />
        </div>
        <div id="vat" className="flex flex-col gap-1.5">
          <Label htmlFor="tax_vat_id">VAT ID</Label>
          <Input
            id="tax_vat_id"
            name="tax_vat_id"
            value={vatId}
            onChange={(e) => setVatId(e.target.value)}
            placeholder="ATU12345678"
            maxLength={32}
            disabled={isPending}
          />
          {/* Advisory only: the server still accepts the save, since a
              seller mid-registration must not be blocked by a warning. Under
              EU distance-selling rules a wrong VAT ID on a product page is a
              real compliance problem, so the warning is worth showing. */}
          {vatWarning && (
            <p className={helpTextClass} aria-live="polite">
              {vatWarning}
            </p>
          )}
        </div>
        <div id="country" className="flex flex-col gap-1.5">
          <Label htmlFor="tax_country">Country</Label>
          <input type="hidden" name="tax_country" value={countryCode} />
          <Select
            id="tax_country"
            value={countryCode}
            options={COUNTRY_OPTIONS}
            onChange={setCountryCode}
            disabled={isPending}
          />
        </div>
        <div id="phone" className="flex flex-col gap-1.5">
          <Label htmlFor="seller_phone">Phone</Label>
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
        <div>
          <SaveButton pending={isPending} state={state} />
        </div>
      </form>
    </SettingsCard>
  );
}
