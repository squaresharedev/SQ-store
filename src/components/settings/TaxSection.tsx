"use client";

import { useActionState } from "react";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/settings/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { saveTaxInfo, type SettingsActionState } from "@/lib/settings/actions";
import { EU_COUNTRIES } from "@/lib/settings/constants";

const INITIAL: SettingsActionState = {};

/**
 * EU tax details. Collected ahead of the VAT/invoicing work — nothing
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

  return (
    <SettingsCard
      title="Business & VAT"
      description="For EU sellers. We store this now so invoices and VAT are ready the day payouts need them, it isn't used anywhere yet."
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tax_business_name">Business name</Label>
          <Input
            id="tax_business_name"
            name="tax_business_name"
            defaultValue={businessName}
            placeholder="Studio Builderboy e.U."
            maxLength={200}
            autoComplete="organization"
          />
          <p className="font-inter text-xs text-neutral-400">
            Selling as yourself? Leave it empty.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tax_vat_id">VAT ID</Label>
          <Input
            id="tax_vat_id"
            name="tax_vat_id"
            defaultValue={vatId}
            placeholder="ATU12345678"
            maxLength={32}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tax_country">Country</Label>
          <Select id="tax_country" name="tax_country" defaultValue={country}>
            <option value="">Not in the EU / prefer not to say</option>
            {EU_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <FormStatus state={state} />
        <div>
          <SaveButton pending={isPending} />
        </div>
      </form>
    </SettingsCard>
  );
}
