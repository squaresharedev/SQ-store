"use client";

import { cn } from "@/lib/utils";
import {
  errorTextClass,
  fieldBaseClass,
  labelClass,
} from "@/components/ui/control-styles";
import { InfoTip } from "@/components/ui/InfoTip";
import type { DetailsFieldErrors, SafetyFormValues } from "./form-values";

/**
 * The General Product Safety Regulation block, for physical goods sold in the
 * EU: who made it and how to reach them, who answers for it in the EU when the
 * maker is outside, how to identify the item, and any warnings. Optional as a
 * whole; once any field is filled the three manufacturer fields are required.
 */
export function SafetyFields({
  inputId,
  values,
  errors,
  onChange,
}: {
  inputId: string;
  values: SafetyFormValues;
  errors: DetailsFieldErrors;
  onChange: (next: SafetyFormValues) => void;
}) {
  const field = (
    key: keyof SafetyFormValues,
    label: string,
    options: { multiline?: boolean; type?: string; max: number; error?: string; hint?: string },
  ) => (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={`${inputId}-${key}`} className={labelClass}>
          {label}
        </label>
        {options.hint && <InfoTip label={`About ${label}`}>{options.hint}</InfoTip>}
      </div>
      {options.multiline ? (
        <textarea
          id={`${inputId}-${key}`}
          value={values[key]}
          maxLength={options.max}
          rows={2}
          aria-invalid={options.error ? true : undefined}
          onChange={(event) => onChange({ ...values, [key]: event.target.value })}
          data-product-field={`safety.${key}`}
          className={fieldBaseClass}
        />
      ) : (
        <input
          id={`${inputId}-${key}`}
          type={options.type ?? "text"}
          value={values[key]}
          maxLength={options.max}
          aria-invalid={options.error ? true : undefined}
          onChange={(event) => onChange({ ...values, [key]: event.target.value })}
          data-product-field={`safety.${key}`}
          className={fieldBaseClass}
        />
      )}
      {options.error && <p className={errorTextClass}>{options.error}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {field("manufacturerName", "Manufacturer", { max: 120, error: errors.manufacturerName })}
        {field("manufacturerEmail", "Manufacturer email", {
          type: "email",
          max: 254,
          error: errors.manufacturerEmail,
        })}
      </div>
      {field("manufacturerAddress", "Manufacturer address", {
        multiline: true,
        max: 300,
        error: errors.manufacturerAddress,
      })}
      <div className={cn("grid grid-cols-1 gap-5 sm:grid-cols-2")}>
        {field("responsibleName", "EU responsible person", {
          max: 120,
          hint: "Only when the manufacturer is outside the EU.",
        })}
        {field("responsibleEmail", "Responsible person email", {
          type: "email",
          max: 254,
          error: errors.responsibleEmail,
        })}
      </div>
      {field("responsibleAddress", "Responsible person address", { multiline: true, max: 300 })}
      {field("identifier", "Type, batch or serial number", { max: 80 })}
      {field("warnings", "Warnings and safety information", { multiline: true, max: 2000 })}
    </div>
  );
}
