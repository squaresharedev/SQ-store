import {
  DIMENSION_UNITS,
  WEIGHT_UNITS,
  type DimensionUnit,
  type ProductDetails,
  type ProductOptionDetails,
  type ProductOptionGroup,
  type ProductSafety,
  type WeightUnit,
} from "@/types/product";
import type { ProductDetailsInput } from "@/lib/validation/product";

// The product form's in-progress strings for the page-detail fields, and the
// two mappings around them: stored details -> strings for editing, and strings
// -> the validated input shape on save (empties dropped, numbers parsed). Kept
// out of ProductForm.tsx so the form stays about flow, not field plumbing.

export interface SafetyFormValues {
  manufacturerName: string;
  manufacturerAddress: string;
  manufacturerEmail: string;
  responsibleName: string;
  responsibleAddress: string;
  responsibleEmail: string;
  identifier: string;
  warnings: string;
}

export interface DetailsFormValues {
  length: string;
  width: string;
  height: string;
  dimensionUnit: DimensionUnit;
  weight: string;
  weightUnit: WeightUnit;
  materials: string;
  care: string;
  /** One item per line. */
  included: string;
  specs: { label: string; value: string }[];
  origin: string;
  safety: SafetyFormValues;
}

export type DetailsFieldErrors = Partial<
  Record<
    | "length"
    | "width"
    | "height"
    | "weight"
    | "specs"
    | "optionDetails"
    | "manufacturerName"
    | "manufacturerAddress"
    | "manufacturerEmail"
    | "responsibleEmail",
    string
  >
>;

/**
 * ONE VERSION'S OWN FACTS, as the strings the form holds while they are being
 * typed. Numbers only: the units are the product's (there is one set of unit
 * pickers, above), because a table measured in cm in one size and inches in
 * another is a mistake rather than a feature.
 */
export interface OptionDetailsFormValues {
  length: string;
  width: string;
  height: string;
  weight: string;
  specs: { label: string; value: string }[];
}

export const EMPTY_OPTION_DETAILS: OptionDetailsFormValues = {
  length: "",
  width: "",
  height: "",
  weight: "",
  specs: [],
};

const EMPTY_SAFETY: SafetyFormValues = {
  manufacturerName: "",
  manufacturerAddress: "",
  manufacturerEmail: "",
  responsibleName: "",
  responsibleAddress: "",
  responsibleEmail: "",
  identifier: "",
  warnings: "",
};

function numberToField(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

export function initialDetailsValues(details?: ProductDetails): DetailsFormValues {
  const safety = details?.safety;
  return {
    length: numberToField(details?.dimensions?.length),
    width: numberToField(details?.dimensions?.width),
    height: numberToField(details?.dimensions?.height),
    dimensionUnit: details?.dimensions?.unit ?? DIMENSION_UNITS[1],
    weight: numberToField(details?.weight?.value),
    weightUnit: details?.weight?.unit ?? WEIGHT_UNITS[0],
    materials: details?.materials ?? "",
    care: details?.care ?? "",
    included: (details?.included ?? []).join("\n"),
    specs: (details?.specs ?? []).map((spec) => ({ ...spec })),
    origin: details?.origin ?? "",
    safety: {
      ...EMPTY_SAFETY,
      manufacturerName: safety?.manufacturerName ?? "",
      manufacturerAddress: safety?.manufacturerAddress ?? "",
      manufacturerEmail: safety?.manufacturerEmail ?? "",
      responsibleName: safety?.responsibleName ?? "",
      responsibleAddress: safety?.responsibleAddress ?? "",
      responsibleEmail: safety?.responsibleEmail ?? "",
      identifier: safety?.identifier ?? "",
      warnings: safety?.warnings ?? "",
    },
  };
}

/** A typed measure: empty is "not given", anything else must be a number. */
function parseMeasure(raw: string): number | undefined | "invalid" {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 && value <= 100_000 ? value : "invalid";
}

/** Whether any safety field has been filled in, which makes the block real
 *  and its three required fields required. */
export function safetyStarted(safety: SafetyFormValues): boolean {
  return Object.values(safety).some((value) => value.trim() !== "");
}

/** UX-only checks (the server re-parses with Zod). */
export function validateDetails(values: DetailsFormValues, isDigital: boolean): DetailsFieldErrors {
  const errors: DetailsFieldErrors = {};
  for (const key of ["length", "width", "height", "weight"] as const) {
    if (parseMeasure(values[key]) === "invalid") {
      errors[key] = "Use a number, like 12 or 3.5.";
    }
  }
  if (values.specs.some((spec) => spec.label.trim() !== "" && spec.value.trim() === "")) {
    errors.specs = "Every specification needs a value.";
  }
  if (!isDigital && safetyStarted(values.safety)) {
    const { manufacturerName, manufacturerAddress, manufacturerEmail, responsibleEmail } =
      values.safety;
    if (!manufacturerName.trim()) errors.manufacturerName = "Name the manufacturer.";
    if (!manufacturerAddress.trim()) errors.manufacturerAddress = "Add the manufacturer's postal address.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(manufacturerEmail.trim())) {
      errors.manufacturerEmail = "Add a contact email for the manufacturer.";
    }
    if (responsibleEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responsibleEmail.trim())) {
      errors.responsibleEmail = "That doesn't look like an email address.";
    }
  }
  return errors;
}

/** Strings to the validated input shape. Empties are dropped so an untouched
 *  form saves `{}`, byte-identical to a product that never had details. */
export function detailsToInput(values: DetailsFormValues, isDigital: boolean): ProductDetailsInput {
  const details: ProductDetailsInput = {};

  const length = parseMeasure(values.length);
  const width = parseMeasure(values.width);
  const height = parseMeasure(values.height);
  const measures = [length, width, height].filter(
    (value): value is number => typeof value === "number",
  );
  if (measures.length > 0) {
    details.dimensions = {
      ...(typeof length === "number" ? { length } : {}),
      ...(typeof width === "number" ? { width } : {}),
      ...(typeof height === "number" ? { height } : {}),
      unit: values.dimensionUnit,
    };
  }

  const weight = parseMeasure(values.weight);
  if (typeof weight === "number") details.weight = { value: weight, unit: values.weightUnit };

  if (values.materials.trim()) details.materials = values.materials.trim();
  if (values.care.trim()) details.care = values.care.trim();

  const included = values.included
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (included.length > 0) details.included = included;

  const specs = values.specs
    .map((spec) => ({ label: spec.label.trim(), value: spec.value.trim() }))
    .filter((spec) => spec.label && spec.value);
  if (specs.length > 0) details.specs = specs;

  if (values.origin.trim()) details.origin = values.origin.trim();

  if (!isDigital && safetyStarted(values.safety)) {
    const safety = values.safety;
    const block: ProductSafety = {
      manufacturerName: safety.manufacturerName.trim(),
      manufacturerAddress: safety.manufacturerAddress.trim(),
      manufacturerEmail: safety.manufacturerEmail.trim(),
    };
    if (safety.responsibleName.trim()) block.responsibleName = safety.responsibleName.trim();
    if (safety.responsibleAddress.trim()) block.responsibleAddress = safety.responsibleAddress.trim();
    if (safety.responsibleEmail.trim()) block.responsibleEmail = safety.responsibleEmail.trim();
    if (safety.identifier.trim()) block.identifier = safety.identifier.trim();
    if (safety.warnings.trim()) block.warnings = safety.warnings.trim();
    details.safety = block;
  }

  return details;
}

// ── Per-version facts ───────────────────────────────────────────────────
//
// Held by the form as a map keyed by OPTION ID rather than on the options
// themselves, for the same reason the product's own details are strings: a
// half-typed "3." has to survive until the seller types the "5". The map is
// read back by option id on save, so an option deleted meanwhile simply takes
// its entry out of play, with nothing to reconcile.

/** Stored overrides to the form's strings, keyed by option id. Options with
 *  nothing of their own get no entry at all. */
export function initialOptionDetails(
  groups: readonly ProductOptionGroup[],
): Record<string, OptionDetailsFormValues> {
  const byOption: Record<string, OptionDetailsFormValues> = {};
  for (const group of groups) {
    for (const option of group.options) {
      const own = option.details;
      if (!own) continue;
      byOption[option.id] = {
        length: numberToField(own.dimensions?.length),
        width: numberToField(own.dimensions?.width),
        height: numberToField(own.dimensions?.height),
        weight: numberToField(own.weight?.value),
        specs: (own.specs ?? []).map((spec) => ({ ...spec })),
      };
    }
  }
  return byOption;
}

/** Nothing typed in. Kept out of the map entirely, so opening a version and
 *  closing it again cannot make the form think there are unsaved changes. */
export function optionDetailsEmpty(values: OptionDetailsFormValues): boolean {
  return (
    !values.length.trim() &&
    !values.width.trim() &&
    !values.height.trim() &&
    !values.weight.trim() &&
    values.specs.every((spec) => !spec.label.trim() && !spec.value.trim())
  );
}

/**
 * UX-only checks, one message per version (the server re-parses).
 *
 * Only options the product STILL has are judged: an entry left behind by a
 * deleted option is never saved either (see optionDetailsToInput's caller), and
 * a message about a row that is no longer on the page is a save the seller
 * cannot unblock.
 */
export function validateOptionDetails(
  byOption: Record<string, OptionDetailsFormValues>,
  liveOptionIds: ReadonlySet<string>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [optionId, values] of Object.entries(byOption)) {
    if (!liveOptionIds.has(optionId)) continue;
    const badMeasure = (["length", "width", "height", "weight"] as const).some(
      (key) => parseMeasure(values[key]) === "invalid",
    );
    if (badMeasure) {
      errors[optionId] = "Use a number, like 12 or 3.5.";
    } else if (values.specs.some((spec) => spec.label.trim() && !spec.value.trim())) {
      errors[optionId] = "Every specification needs a value.";
    }
  }
  return errors;
}

/**
 * One version's strings to the stored shape, or `undefined` when it says
 * nothing of its own, so an option that overrides nothing stays byte-identical
 * to one that never could.
 *
 * `units` are the product's own pickers: the override carries them so the
 * stored value is a complete measurement wherever it is read, but the seller
 * never chooses them twice.
 */
export function optionDetailsToInput(
  values: OptionDetailsFormValues | undefined,
  units: { dimensionUnit: DimensionUnit; weightUnit: WeightUnit },
): ProductOptionDetails | undefined {
  if (!values) return undefined;
  const details: ProductOptionDetails = {};

  const length = parseMeasure(values.length);
  const width = parseMeasure(values.width);
  const height = parseMeasure(values.height);
  if ([length, width, height].some((value) => typeof value === "number")) {
    details.dimensions = {
      ...(typeof length === "number" ? { length } : {}),
      ...(typeof width === "number" ? { width } : {}),
      ...(typeof height === "number" ? { height } : {}),
      unit: units.dimensionUnit,
    };
  }

  const weight = parseMeasure(values.weight);
  if (typeof weight === "number") details.weight = { value: weight, unit: units.weightUnit };

  const specs = values.specs
    .map((spec) => ({ label: spec.label.trim(), value: spec.value.trim() }))
    .filter((spec) => spec.label && spec.value);
  if (specs.length > 0) details.specs = specs;

  return Object.keys(details).length > 0 ? details : undefined;
}

/** A photo in the form: either already stored (has a key) or freshly picked
 *  (has a File, uploaded on save). `localId` keys the row while it has no key. */
export interface GalleryFormImage {
  localId: string;
  key: string | null;
  file: File | null;
  previewUrl: string | null;
  alt: string;
  /** The option this photo is shown for, from any group; absent = shown
   *  whatever the buyer picks. */
  optionId?: string;
}

/** A document in the form: either already stored (has a key) or freshly
 *  picked (has a File, uploaded on save), same shape as a gallery photo minus
 *  the option tie and the image preview. */
export interface DocumentFormValue {
  localId: string;
  key: string | null;
  file: File | null;
  /** The stored file's display name, or the freshly picked File's own name —
   *  shown until the seller gives it a real label. */
  fileName: string | null;
  label: string;
}
