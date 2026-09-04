"use client";

import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  errorTextClass,
  fieldBaseClass,
  iconButtonClass,
  labelClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { Select } from "@/components/ui/select";
import { DIMENSION_UNITS, SPECS_MAX, WEIGHT_UNITS } from "@/types/product";
import type { DetailsFieldErrors, DetailsFormValues } from "./form-values";

const DIMENSION_OPTIONS = DIMENSION_UNITS.map((unit) => ({ value: unit, label: unit }));
const WEIGHT_OPTIONS = WEIGHT_UNITS.map((unit) => ({ value: unit, label: unit }));

/** Dimensions, weight, materials, care, what's included and free spec rows. */
export function DetailsFields({
  inputId,
  values,
  errors,
  onChange,
}: {
  inputId: string;
  values: DetailsFormValues;
  errors: DetailsFieldErrors;
  onChange: (next: DetailsFormValues) => void;
}) {
  function set<Key extends keyof DetailsFormValues>(key: Key, value: DetailsFormValues[Key]) {
    onChange({ ...values, [key]: value });
  }

  const measure = (key: "length" | "width" | "height" | "weight", label: string) => (
    <div className="space-y-1">
      <label htmlFor={`${inputId}-${key}`} className={cn(labelClass, "text-xs")}>
        {label}
      </label>
      <input
        id={`${inputId}-${key}`}
        type="text"
        inputMode="decimal"
        value={values[key]}
        onChange={(event) => set(key, event.target.value)}
        aria-invalid={errors[key] ? true : undefined}
        data-product-field={key}
        data-product-unit="measure"
        className={cn(fieldBaseClass, "py-1.5 text-sm")}
      />
      {errors[key] && <p className={errorTextClass}>{errors[key]}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      <fieldset className="space-y-2">
        <legend className={labelClass}>Dimensions</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {measure("length", "Length")}
          {measure("width", "Width")}
          {measure("height", "Height")}
          <div className="space-y-1" data-product-field="dimensionUnit" data-product-value={values.dimensionUnit}>
            <label htmlFor={`${inputId}-dimension-unit`} className={cn(labelClass, "text-xs")}>
              Unit
            </label>
            <Select
              id={`${inputId}-dimension-unit`}
              value={values.dimensionUnit}
              options={DIMENSION_OPTIONS}
              onChange={(dimensionUnit) => set("dimensionUnit", dimensionUnit)}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className={labelClass}>Weight</legend>
        <div className="grid grid-cols-2 gap-3 sm:max-w-xs">
          {measure("weight", "Weight")}
          <div className="space-y-1" data-product-field="weightUnit" data-product-value={values.weightUnit}>
            <label htmlFor={`${inputId}-weight-unit`} className={cn(labelClass, "text-xs")}>
              Unit
            </label>
            <Select
              id={`${inputId}-weight-unit`}
              value={values.weightUnit}
              options={WEIGHT_OPTIONS}
              onChange={(weightUnit) => set("weightUnit", weightUnit)}
            />
          </div>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`${inputId}-materials`} className={labelClass}>
            Materials
          </label>
          <textarea
            id={`${inputId}-materials`}
            value={values.materials}
            maxLength={300}
            rows={2}
            placeholder="e.g. Solid oak, brass fittings"
            onChange={(event) => set("materials", event.target.value)}
            data-product-field="materials"
            className={fieldBaseClass}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${inputId}-origin`} className={labelClass}>
            Made in
          </label>
          <input
            id={`${inputId}-origin`}
            type="text"
            value={values.origin}
            maxLength={60}
            placeholder="Country of origin"
            onChange={(event) => set("origin", event.target.value)}
            data-product-field="origin"
            className={fieldBaseClass}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${inputId}-care`} className={labelClass}>
          Care instructions
        </label>
        <textarea
          id={`${inputId}-care`}
          value={values.care}
          maxLength={1000}
          rows={3}
          onChange={(event) => set("care", event.target.value)}
          data-product-field="care"
          className={fieldBaseClass}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${inputId}-included`} className={labelClass}>
          What&apos;s included
        </label>
        <textarea
          id={`${inputId}-included`}
          value={values.included}
          rows={3}
          placeholder={"One item per line\ne.g. 1 × lamp\n1 × 2 m cable"}
          onChange={(event) => set("included", event.target.value)}
          data-product-field="included"
          className={fieldBaseClass}
        />
      </div>

      <div className="space-y-2">
        <span className={labelClass}>Specifications</span>
        {values.specs.length > 0 && (
          <ul className="space-y-2" aria-label="Specifications">
            {values.specs.map((spec, index) => (
              <li key={index} className="flex gap-2" data-product-spec-row={index}>
                <input
                  type="text"
                  value={spec.label}
                  maxLength={40}
                  placeholder="Name, e.g. Wattage"
                  aria-label={`Specification ${index + 1} name`}
                  data-product-field={`spec.${index}.label`}
                  onChange={(event) =>
                    set(
                      "specs",
                      values.specs.map((candidate, i) =>
                        i === index ? { ...candidate, label: event.target.value } : candidate,
                      ),
                    )
                  }
                  className={cn(fieldBaseClass, "w-2/5 py-1.5 text-sm")}
                />
                <input
                  type="text"
                  value={spec.value}
                  maxLength={200}
                  placeholder="Value, e.g. 40 W"
                  aria-label={`Specification ${index + 1} value`}
                  data-product-field={`spec.${index}.value`}
                  onChange={(event) =>
                    set(
                      "specs",
                      values.specs.map((candidate, i) =>
                        i === index ? { ...candidate, value: event.target.value } : candidate,
                      ),
                    )
                  }
                  className={cn(fieldBaseClass, "flex-1 py-1.5 text-sm")}
                />
                <button
                  type="button"
                  className={cn(iconButtonClass, "size-9 shrink-0")}
                  aria-label={`Remove specification ${index + 1}`}
                  onClick={() => set("specs", values.specs.filter((_, i) => i !== index))}
                >
                  <X className="size-4" strokeWidth={2} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {errors.specs && <p className={errorTextClass}>{errors.specs}</p>}
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={values.specs.length >= SPECS_MAX}
          onClick={() => set("specs", [...values.specs, { label: "", value: "" }])}
        >
          <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
          Add specification
        </button>
      </div>
    </div>
  );
}
