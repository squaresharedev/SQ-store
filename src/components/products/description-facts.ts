// What AI writing help is told about a product (lib/suggestions/describe.ts),
// read off the form as it stands: everything the seller has entered that a
// buyer would read, labelled in the words the form shows them. Never the
// maker's or the EU contact's names and addresses: those are people's details,
// and a description does not need them.

import { DESCRIBE_LIMITS, type ListingFact } from "@/lib/suggestions/describe";
import type { ProductOptionGroup } from "@/types/product";
import type { BadgeFormValue, DetailsFormValues } from "./form-values";

/** The form's own words for each fact, in the dashboard's language. */
export type FactLabels = {
  materials: string;
  madeIn: string;
  care: string;
  contents: string;
  dimensions: string;
  weight: string;
  badges: string;
  kind: string;
  download: string;
};

export function descriptionFacts(
  form: {
    optionGroups: readonly ProductOptionGroup[];
    details: DetailsFormValues;
    badges: readonly BadgeFormValue[];
    isDigital: boolean;
  },
  labels: FactLabels,
): ListingFact[] {
  const { details } = form;
  const measures = [details.length, details.width, details.height].map((value) => value.trim()).filter(Boolean);
  const facts: [string, string][] = [
    ...(form.isDigital ? ([[labels.kind, labels.download]] as [string, string][]) : []),
    ...form.optionGroups.map((group): [string, string] => [
      group.name,
      group.options.map((option) => option.name.trim()).filter(Boolean).join(", "),
    ]),
    [labels.materials, details.materials],
    [labels.madeIn, details.origin],
    [labels.care, details.care],
    [labels.contents, details.included.split("\n").map((line) => line.trim()).filter(Boolean).join(", ")],
    ...details.specs.map((spec): [string, string] => [spec.label, spec.value]),
    [labels.dimensions, measures.length > 0 ? `${measures.join(" x ")} ${details.dimensionUnit}` : ""],
    [labels.weight, details.weight.trim() ? `${details.weight.trim()} ${details.weightUnit}` : ""],
    [labels.badges, form.badges.map((badge) => badge.label.trim()).filter(Boolean).join(", ")],
  ];
  return facts
    .map(([label, value]) => ({ label: label.trim(), value: value.trim() }))
    .filter((fact) => fact.label && fact.value)
    .slice(0, DESCRIBE_LIMITS.facts)
    .map((fact) => ({
      label: fact.label.slice(0, DESCRIBE_LIMITS.factLabel),
      value: fact.value.slice(0, DESCRIBE_LIMITS.factValue),
    }));
}
