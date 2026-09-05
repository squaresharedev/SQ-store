"use client";

import { useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  errorTextClass,
  fieldBaseClass,
  focusRingClass,
  helpTextClass,
  iconButtonClass,
  infoTextClass,
  labelClass,
  secondaryButtonClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { InfoTip } from "@/components/ui/InfoTip";
import {
  OPTION_SPEC_VALUE_MAX,
  OPTION_SPECS_MAX,
  type DimensionUnit,
  type ProductOptionGroup,
  type WeightUnit,
} from "@/types/product";
import {
  EMPTY_OPTION_DETAILS,
  optionDetailsEmpty,
  type OptionDetailsFormValues,
} from "./form-values";

type Units = { dimensionUnit: DimensionUnit; weightUnit: WeightUnit };

/**
 * WHAT EACH VERSION MEASURES.
 *
 * A product sold in two sizes has two sets of dimensions, and one spec table
 * cannot be right for both. So every option gets a place to state the numbers
 * that are ITS own, and the product page shows the chosen version's instead of
 * the product's.
 *
 * BLANK MEANS INHERIT, everywhere. A seller states the two or three numbers
 * that actually differ and nothing else: materials, care, contents and origin
 * stay written once, above, because they do not change with the pick.
 *
 * ONE SLIM ROW PER VERSION UNTIL IT HAS SOMETHING IN IT, the lesson
 * GalleryField already learned: there is a row here for every option on the
 * product (up to 48 of them), and a wall of open forms would bury the section
 * a seller was actually looking for.
 */
export function OptionSpecsField({
  inputId,
  optionGroups,
  byOption,
  units,
  errors,
  onChange,
}: {
  inputId: string;
  optionGroups: ProductOptionGroup[];
  /** Keyed by option id; an option with nothing of its own has no entry. */
  byOption: Record<string, OptionDetailsFormValues>;
  /** The product's own units, printed beside each number. */
  units: Units;
  /** One message per option, keyed by option id. */
  errors: Record<string, string>;
  onChange: (byOption: Record<string, OptionDetailsFormValues>) => void;
}) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set<string>());

  const rows = optionGroups.flatMap((group) =>
    group.options.map((option) => ({ group, option })),
  );
  if (rows.length === 0) return null;

  function update(optionId: string, next: OptionDetailsFormValues) {
    const nextByOption = { ...byOption };
    // An entry that says nothing is dropped rather than stored empty, so a
    // version opened and left alone is not an unsaved change.
    if (optionDetailsEmpty(next)) delete nextByOption[optionId];
    else nextByOption[optionId] = next;
    onChange(nextByOption);
  }

  function toggle(optionId: string) {
    setOpenIds((previous) => {
      const next = new Set(previous);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  }

  return (
    <div
      className="space-y-2"
      data-product-field="optionDetails"
      data-product-value={Object.keys(byOption).length}
    >
      <div className="flex items-center gap-1.5">
        <span className={labelClass}>Different for each version</span>
        <InfoTip label="How per-version specifications work">
          Sizes and weights that change with the version go here. Anything left
          blank uses what you filled in above, so state only what actually
          differs. Buyers see the numbers for the version they have picked.
        </InfoTip>
      </div>

      <ul className={cn("divide-y divide-border rounded-sm border border-border")}>
        {rows.map(({ group, option }) => {
          const values = byOption[option.id] ?? EMPTY_OPTION_DETAILS;
          const error = errors[option.id];
          // A version carrying a problem opens itself: a message under a shut
          // row is a message nobody reads.
          const open = openIds.has(option.id) || Boolean(error);
          const filled = !optionDetailsEmpty(values);
          const optionName = option.name.trim() || "Unnamed option";
          const groupName = group.name.trim() || "Options";

          return (
            <li key={option.id} data-option-details={option.id}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`${inputId}-${option.id}-fields`}
                onClick={() => toggle(option.id)}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-2 text-left",
                  "hover:bg-accent/40",
                  transitionClass,
                  focusRingClass,
                )}
              >
                {group.display === "swatch" && option.swatch && (
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full border border-border"
                    style={{ backgroundColor: option.swatch }}
                  />
                )}
                <span className={cn(helpTextClass, "shrink-0 text-xs")}>{groupName}:</span>
                <span className={cn(labelClass, "shrink-0 text-xs")}>{optionName}</span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-right font-inter text-xs tabular-nums",
                    filled ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {filled ? summarize(values, units) : "Same as above"}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground",
                    transitionClass,
                    open && "rotate-180",
                  )}
                  strokeWidth={2}
                />
              </button>

              {open && (
                <div id={`${inputId}-${option.id}-fields`} className="space-y-3 px-2.5 pb-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Measure
                      id={`${inputId}-${option.id}-length`}
                      label="Length"
                      suffix={units.dimensionUnit}
                      value={values.length}
                      onChange={(length) => update(option.id, { ...values, length })}
                    />
                    <Measure
                      id={`${inputId}-${option.id}-width`}
                      label="Width"
                      suffix={units.dimensionUnit}
                      value={values.width}
                      onChange={(width) => update(option.id, { ...values, width })}
                    />
                    <Measure
                      id={`${inputId}-${option.id}-height`}
                      label="Height"
                      suffix={units.dimensionUnit}
                      value={values.height}
                      onChange={(height) => update(option.id, { ...values, height })}
                    />
                    <Measure
                      id={`${inputId}-${option.id}-weight`}
                      label="Weight"
                      suffix={units.weightUnit}
                      value={values.weight}
                      onChange={(weight) => update(option.id, { ...values, weight })}
                    />
                  </div>

                  {values.specs.length > 0 && (
                    <ul className="space-y-2" aria-label={`${optionName} specifications`}>
                      {values.specs.map((spec, index) => (
                        <li key={index} className="flex gap-2" data-option-spec-row={index}>
                          <input
                            type="text"
                            value={spec.label}
                            maxLength={40}
                            placeholder="Name, e.g. Seats"
                            aria-label={`${optionName} specification ${index + 1} name`}
                            onChange={(event) =>
                              update(option.id, {
                                ...values,
                                specs: values.specs.map((candidate, i) =>
                                  i === index ? { ...candidate, label: event.target.value } : candidate,
                                ),
                              })
                            }
                            className={cn(fieldBaseClass, "w-2/5 py-1 text-xs")}
                          />
                          <input
                            type="text"
                            value={spec.value}
                            maxLength={OPTION_SPEC_VALUE_MAX}
                            placeholder="Value, e.g. 6"
                            aria-label={`${optionName} specification ${index + 1} value`}
                            onChange={(event) =>
                              update(option.id, {
                                ...values,
                                specs: values.specs.map((candidate, i) =>
                                  i === index ? { ...candidate, value: event.target.value } : candidate,
                                ),
                              })
                            }
                            className={cn(fieldBaseClass, "flex-1 py-1 text-xs")}
                          />
                          <button
                            type="button"
                            className={cn(iconButtonClass, "size-8 shrink-0")}
                            aria-label={`Remove ${optionName} specification ${index + 1}`}
                            onClick={() =>
                              update(option.id, {
                                ...values,
                                specs: values.specs.filter((_, i) => i !== index),
                              })
                            }
                          >
                            <X className="size-3.5" strokeWidth={2} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {error && <p className={errorTextClass}>{error}</p>}

                  <button
                    type="button"
                    className={cn(secondaryButtonClass, "px-2.5 py-1 text-xs")}
                    disabled={values.specs.length >= OPTION_SPECS_MAX}
                    onClick={() =>
                      update(option.id, {
                        ...values,
                        specs: [...values.specs, { label: "", value: "" }],
                      })
                    }
                  >
                    <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
                    {/* A row that replaces one from above by name, which is
                        worth saying where the seller is about to add one. */}
                    Specification for this version
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className={infoTextClass}>
        A specification with the same name as one above replaces it for that version.
      </p>
    </div>
  );
}

/** One number, with the product's unit printed after it rather than a second
 *  unit picker: one product, one unit. */
function Measure({
  id,
  label,
  suffix,
  value,
  onChange,
}: {
  id: string;
  label: string;
  suffix: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={cn(labelClass, "text-xs")}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(fieldBaseClass, "py-1 pr-8 text-xs")}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-inter text-xs text-muted-foreground"
        >
          {suffix}
        </span>
      </div>
    </div>
  );
}

/** What a shut row says it changes: the numbers themselves, not a count. */
function summarize(values: OptionDetailsFormValues, units: Units): string {
  const parts: string[] = [];
  const dimensions = [values.length, values.width, values.height]
    .map((value) => value.trim())
    .filter(Boolean);
  if (dimensions.length > 0) {
    parts.push(`${dimensions.join(" × ")} ${units.dimensionUnit}`);
  }
  if (values.weight.trim()) parts.push(`${values.weight.trim()} ${units.weightUnit}`);
  for (const spec of values.specs) {
    if (spec.label.trim() && spec.value.trim()) {
      parts.push(`${spec.label.trim()} ${spec.value.trim()}`);
    }
  }
  return parts.join(" · ");
}
