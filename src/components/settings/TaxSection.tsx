"use client";

import { useActionState, useState } from "react";
import { infoTextClass } from "@/components/ui/control-styles";
import { useActionToast } from "@/components/ui/Toast";
import { SaveButton } from "@/components/ui/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { saveTaxInfo, type SettingsActionState } from "@/lib/settings/actions";
import { EU_COUNTRIES } from "@/lib/settings/constants";

const INITIAL: SettingsActionState = {};

/** "" is a real choice (non-EU / declined), so it leads the list. */
const COUNTRY_OPTIONS: readonly SelectOption<string>[] = [
  { value: "", label: "Not in the EU / prefer not to say" },
  ...EU_COUNTRIES.map((c) => ({ value: c.code, label: c.name })),
];

/**
 * EU tax details. Collected ahead of the VAT/invoicing work: nothing
 * downstream reads these fields yet, they're stored so launch day is a
 * non-event.
 */
export function TaxSection({
  businessName,
  vatId,
  country,
}: {
  businessName: string;
  vatId: string;
  country: string;
}) {
  const [state, formAction, isPending] = useActionState(saveTaxInfo, INITIAL);
  useActionToast(state);
  // The shared Select is a button + listbox, so it can't be submitted by the
  // form on its own — its value rides along in a hidden input, the same pattern
  // the invite modal uses for its role picker.
  const [countryCode, setCountryCode] = useState(country);

  return (
    <SettingsCard
      title="Business & VAT"
      description="For EU sellers. We're saving this now so invoices and VAT are all set the day payouts need it."
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
          <Label htmlFor="tax_business_name">Business name</Label>
          <Input
            id="tax_business_name"
            name="tax_business_name"
            defaultValue={businessName}
            placeholder="Studio Builderboy e.U."
            maxLength={200}
            autoComplete="organization"
          />
          <p className={infoTextClass}>
            Selling as yourself? Leave it empty.
          </p>
        </div>
        <div id="vat" className="flex flex-col gap-1.5">
          <Label htmlFor="tax_vat_id">VAT ID</Label>
          <Input
            id="tax_vat_id"
            name="tax_vat_id"
            defaultValue={vatId}
            placeholder="ATU12345678"
            maxLength={32}
          />
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
        <div>
          <SaveButton pending={isPending} state={state} />
        </div>
      </form>
    </SettingsCard>
  );
}
