import type {
  Currency,
  ProductFormValues,
  ProductOptionGroup,
  ProductStatus,
} from "@/types/product";
import type {
  DetailsFormValues,
  DocumentFormValue,
  GalleryFormImage,
  OptionDetailsFormValues,
} from "@/components/products/form-values";
import { optionDetailsEmpty, safetyStarted } from "@/components/products/form-values";
import { parseFormPriceCents } from "@/lib/products/price";
import { createTranslator } from "next-intl";
import { msg, type MessageRef } from "@/i18n/types";
import products from "../../../messages/en/products.json";

/**
 * THE PRODUCT FORM, AS DATA.
 *
 * One object, built once per render from the form's own state, and consumed
 * twice: by the section headers and the index rail a person scans, and by the
 * JSON island a machine reads (see docs/product-form-datapoints.md). That is
 * the same discipline `getAnalyticsSnapshot` established — the reason to trust
 * the machine-readable copy is that there is no second computation to drift
 * away from what is on the screen.
 *
 * It is also why the scannability work and the agent work are one change and
 * not two: "which sections have anything in them, and what is still missing"
 * is the question a seller asks by looking and an assistant asks by reading.
 *
 * TWO RULES THIS FILE ENFORCES, both from docs/agent-surface.md:
 *
 *   B3 — MONEY IS INTEGER CENTS. The form holds a decimal string because that
 *        is what a person types; `priceCents` here is the integer the database
 *        stores. No float ever appears in the snapshot.
 *   B6 — NO OBJECT KEYS, EVER. A cover image, a gallery photo, a document and
 *        the paid download are all R2 keys, and `digital_file_key` IS the
 *        paywall. This file emits counts, labels and booleans about them and
 *        never a key or a signed URL. The snapshot is BUILT field by field for
 *        that reason; nothing is spread in, so a field added to the form later
 *        cannot leak by default.
 */

export const PRODUCT_FORM_SNAPSHOT_VERSION = 1;

/** The DOM id of the JSON island, and the attribute that marks it. */
export const PRODUCT_FORM_SNAPSHOT_ID = "product-form-snapshot";

/**
 * Every section of the form, in the order it is rendered.
 *
 * The ids are the stable contract: they name the anchor a person jumps to
 * (`#product-section-<id>`), the `data-product-section` an automation matches,
 * and the entry in the snapshot. Labels and copy can change freely; an id
 * cannot, so append rather than rename. The copy (label, the "?" explanation)
 * lives in the catalogue under `Products.form.sections.<id>`. The Stock
 * explanation also covers the alert; Media has none (its three fields carry
 * their own), and an empty explanation is what suppresses its "?".
 *
 * `required` marks a section the product cannot be saved without — which is
 * what lets the rail show a seller the two things standing between them and a
 * saved product, on a form with nine sections and forty fields.
 */
export const PRODUCT_FORM_SECTIONS = [
  { id: "basics", required: true },
  { id: "stock", required: false },
  { id: "media", required: false },
  { id: "shipping", required: false },
  { id: "options", required: false },
  { id: "photos", required: false },
  { id: "specs", required: false },
  { id: "documents", required: false },
  { id: "safety", required: false },
  { id: "visibility", required: false },
] as const;

export type ProductFormSectionId = (typeof PRODUCT_FORM_SECTIONS)[number]["id"];

/**
 * What a section is showing at a glance.
 *
 *   empty    — nothing filled in. Fine for most sections; the page simply
 *              omits what it has nothing to say about.
 *   filled   — has content.
 *   invalid  — has a problem the seller must fix before saving. Only ever set
 *              after a save has been attempted, so the form does not shout at
 *              someone still filling it in.
 */
export type ProductFormSectionState = "empty" | "filled" | "invalid";

export type ProductFormSectionSnapshot = {
  id: ProductFormSectionId;
  label: string;
  state: ProductFormSectionState;
  /** One short phrase, e.g. "3 photos" or "2 groups, 5 options". Empty when
   *  there is nothing to say; the UI then prints its own placeholder. */
  summary: string;
  /** Whether the product can be saved without this section. */
  required: boolean;
};

export type ProductFormOptionGroupSnapshot = {
  id: string;
  name: string;
  display: string;
  optionCount: number;
  /** Options the seller has marked as not currently available. */
  unavailableCount: number;
};

export type ProductFormSnapshot = {
  version: number;
  mode: "create" | "edit";
  /** Null while the product has never been saved. */
  productId: string | null;
  title: string;
  /** INTEGER CENTS (agent-surface B3), or null when the field is empty or not
   *  yet a number. Never a float, and never a formatted string. */
  priceCents: number | null;
  currency: Currency;
  status: ProductStatus;
  hasDescription: boolean;
  descriptionLength: number;
  trackStock: boolean;
  /** Units on hand when tracking, else null. */
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  /** How many one buyer may take in a single order, 1..PURCHASE_QUANTITY_MAX.
   *  Independent of tracking; null only while the field is mid-edit. */
  maxPerOrder: number | null;
  /** A download rather than a physical good: shipping and safety do not apply. */
  isDigital: boolean;
  hasCoverImage: boolean;
  hasDigitalFile: boolean;
  /** https only, already what the field holds; null when unset. */
  purchaseUrl: string | null;
  /** Which of the store's named shipping profiles this product ships under,
   *  or null for the store's default terms — which is the common answer and
   *  the one nobody has to choose. */
  shippingProfileId: string | null;
  /** The chosen profile's name, so the snapshot says which terms apply
   *  without a second lookup. Null when the store default applies. */
  shippingProfileName: string | null;
  optionGroups: ProductFormOptionGroupSnapshot[];
  /** Across every group. */
  optionCount: number;
  galleryCount: number;
  /** Photos tied to a specific option rather than shown for every version. */
  galleryTiedCount: number;
  /** Seller labels only — never the object keys behind them (B6). */
  documentLabels: string[];
  documentCount: number;
  specs: {
    hasDimensions: boolean;
    hasWeight: boolean;
    hasMaterials: boolean;
    hasCare: boolean;
    includedCount: number;
    specCount: number;
    hasOrigin: boolean;
    /** Options stating measurements of their own, which the product page shows
     *  instead of the product's when that version is picked. */
    versionsWithOwnSpecs: number;
  };
  safety: {
    /** The seller has begun the block, so its three required fields apply. */
    started: boolean;
    /** Manufacturer name, address and email are all present. */
    complete: boolean;
    hasResponsiblePerson: boolean;
    hasWarnings: boolean;
  };
  sections: ProductFormSectionSnapshot[];
  /** Field ids that must be filled before this product can be saved. Empty
   *  means the form would submit. */
  requiredMissing: string[];
  /** Unsaved changes are pending. */
  dirty: boolean;
  generatedAt: string;
};

/** Everything the snapshot is derived from: exactly the form's own state. */
export type ProductFormStateInput = {
  mode: "create" | "edit";
  productId: string | null;
  values: ProductFormValues;
  optionGroups: ProductOptionGroup[];
  gallery: GalleryFormImage[];
  documents: DocumentFormValue[];
  details: DetailsFormValues;
  /** Per-version measurements, keyed by option id. Entries whose option is
   *  gone are ignored, exactly as the save path ignores them. */
  optionDetails: Record<string, OptionDetailsFormValues>;
  purchaseUrl: string;
  shippingProfileId: string | null;
  /** The chosen profile's name, resolved by the form against the store's
   *  profiles. Null when none is chosen or the id no longer resolves. */
  shippingProfileName: string | null;
  hasCoverImage: boolean;
  hasDigitalFile: boolean;
  isDigital: boolean;
  dirty: boolean;
  /** Section ids currently carrying a validation message. */
  invalidSections: readonly ProductFormSectionId[];
};

/** A decimal the seller typed to the integer cents the database stores, or
 *  null when it is blank or not a valid price yet. Uses the same strict parser
 *  as the form's own validate() so the snapshot and validation never disagree
 *  about whether the price is present. */
function toPriceCents(price: string): number | null {
  const result = parseFormPriceCents(price);
  return result.ok ? result.cents : null;
}

function toCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * One piece of a section summary: a catalogue message, or text the SELLER
 * typed (a title, a profile name), shown as it is. The pieces of one summary
 * are separate labels ("Image · Download"), never parts of a sentence.
 */
export type SummaryPart = MessageRef | string;

/** A summary as text, in the language `resolve` answers in. */
export function summaryText(
  parts: readonly SummaryPart[],
  resolve: (ref: MessageRef) => string,
): string {
  return parts.map((part) => (typeof part === "string" ? part : resolve(part))).join(" · ");
}

const englishCatalogue = createTranslator({
  locale: "en",
  messages: { Products: products },
  timeZone: "UTC",
});

type ProductsKey = Extract<MessageRef["key"], `Products.${string}`>;

/**
 * The snapshot is a MACHINE contract (docs/product-form-datapoints.md), so its
 * labels and summaries stay English whatever language the seller reads the
 * form in. The form resolves the same parts in the reader's language.
 */
function english(ref: MessageRef): string {
  return englishCatalogue(ref.key as ProductsKey, ref.values);
}

/** A section's name, as a message. */
export function sectionLabel(id: ProductFormSectionId): MessageRef {
  return msg(`Products.form.sections.${id}.label`);
}

/** Versions stating measurements of their own. Only options the product still
 *  has count, because only those are saved. */
function versionsWithOwnSpecs(input: ProductFormStateInput): number {
  const live = new Set<string>();
  for (const group of input.optionGroups) {
    for (const option of group.options) live.add(option.id);
  }
  return Object.entries(input.optionDetails).filter(
    ([optionId, values]) => live.has(optionId) && !optionDetailsEmpty(values),
  ).length;
}

/** The section summaries, which are also what the headers and the rail print. */
export function sectionSummaries(
  input: ProductFormStateInput,
): Record<ProductFormSectionId, SummaryPart[]> {
  const { values, details } = input;
  const optionCount = input.optionGroups.reduce((total, g) => total + g.options.length, 0);
  const ownSpecs = versionsWithOwnSpecs(input);
  const when = (condition: unknown, ref: MessageRef): SummaryPart[] => (condition ? [ref] : []);
  // EVERY field in the section, not a sample of them. A summary that ignores
  // some of what it summarises is worse than none: filling "Made in" and
  // being told the section is still Empty teaches a seller not to trust it.
  //
  // Named the way the FIELDS are named, not the way the state is. "Made in"
  // is what the seller filled in; "origin" is what we happen to call it, and
  // a summary is no place to make someone translate.
  const specParts: SummaryPart[] = [
    ...when(
      details.length.trim() || details.width.trim() || details.height.trim(),
      msg("Products.form.summary.dimensions"),
    ),
    ...when(details.weight.trim(), msg("Products.form.summary.weight")),
    ...when(details.materials.trim(), msg("Products.form.summary.materials")),
    ...when(details.care.trim(), msg("Products.form.summary.care")),
    ...when(details.included.trim(), msg("Products.form.summary.contents")),
    ...when(
      details.specs.filter((spec) => spec.label.trim()).length > 0,
      msg("Products.form.summary.specs"),
    ),
    ...when(details.origin.trim(), msg("Products.form.summary.madeIn")),
    // Named the way the seller thinks of it: "2 versions" is the count of
    // versions measuring something of their own, not a field they filled in.
    ...when(ownSpecs > 0, msg("Products.form.summary.versions", { count: ownSpecs })),
  ];

  const title = values.title.trim();
  const manufacturer = details.safety.manufacturerName.trim();

  return {
    basics: title ? [title] : [],
    // BOTH answers, because the section now holds two independent ones and a
    // summary that reported only the shelf would call a product with a limit
    // of 1 "Unlimited". The order limit is always stated, default or not: the
    // rule in this file is every field in the section, and a seller who cannot
    // see the number cannot tell it is the one they meant.
    stock: [
      values.trackStock
        ? // Show the actual quantity rather than a misleading "0": an empty
          // field means the seller hasn't answered yet, not that they have zero
          // units. The toggle flip now seeds a real value, so this branch reads
          // as unanswered only in the edge case where seeding hasn't run.
          values.stockQuantity.trim()
          ? msg("Products.form.summary.tracking", { quantity: values.stockQuantity.trim() })
          : msg("Products.form.summary.setQuantity")
        : msg("Products.form.summary.unlimited"),
      ...when(
        values.maxPerOrder.trim(),
        msg("Products.form.summary.maxPerOrder", { max: values.maxPerOrder.trim() }),
      ),
    ],
    media: [
      ...when(input.hasCoverImage, msg("Products.form.summary.image")),
      ...when(input.hasDigitalFile, msg("Products.form.summary.download")),
      ...when(input.purchaseUrl.trim(), msg("Products.form.summary.buyLink")),
    ],
    // NEVER EMPTY, unlike every other summary here. "Store terms" is a real
    // answer and the right one for nearly every product, so a section that
    // read "Empty" would be telling a seller to go and fix something that is
    // already correct.
    shipping: input.isDigital
      ? []
      : [
          input.shippingProfileName ??
            (input.shippingProfileId
              ? msg("Products.form.summary.removedProfile")
              : msg("Products.form.summary.storeTerms")),
        ],
    options:
      input.optionGroups.length === 0
        ? []
        : [
            msg("Products.form.summary.options", {
              groups: input.optionGroups.length,
              options: optionCount,
            }),
          ],
    photos:
      input.gallery.length === 0
        ? []
        : [msg("Products.form.summary.photos", { count: input.gallery.length })],
    specs: specParts,
    documents:
      input.documents.length === 0
        ? []
        : [msg("Products.form.summary.documents", { count: input.documents.length })],
    safety: safetyStarted(details.safety)
      ? [manufacturer || msg("Products.form.summary.started")]
      : [],
    visibility: [
      values.status === "active"
        ? msg("Products.form.summary.active")
        : msg("Products.form.summary.draft"),
    ],
  };
}

/**
 * The whole form as one object. Pure: same state in, same snapshot out, with
 * no reads of the DOM, the clock beyond `generatedAt`, or anything else.
 */
export function buildProductFormSnapshot(
  input: ProductFormStateInput,
): ProductFormSnapshot {
  const { values, details } = input;
  const summaries = sectionSummaries(input);
  const invalid = new Set<string>(input.invalidSections);

  // Sections that are never SHOWN cannot be reported on: a download has no
  // shipping and no product-safety block, and the form hides both rather than
  // storing values nobody will read.
  const visible = PRODUCT_FORM_SECTIONS.filter(
    (section) =>
      !input.isDigital || (section.id !== "safety" && section.id !== "shipping"),
  );

  const sections: ProductFormSectionSnapshot[] = visible.map((section) => ({
    id: section.id,
    label: english(sectionLabel(section.id)),
    required: section.required,
    state: invalid.has(section.id)
      ? "invalid"
      : summaries[section.id].length > 0
        ? "filled"
        : "empty",
    summary: summaryText(summaries[section.id], english),
  }));

  const requiredMissing: string[] = [];
  if (!values.title.trim()) requiredMissing.push("title");
  if (toPriceCents(values.price) === null) requiredMissing.push("price");
  if (values.trackStock && toCount(values.stockQuantity) === null) {
    requiredMissing.push("stockQuantity");
  }
  // Every product has an order limit, so a blank one is a cleared field rather
  // than an unanswered question, and the form will not submit on it. Zero is
  // not a limit either: it would mean a product nobody may buy.
  const maxPerOrder = toCount(values.maxPerOrder);
  if (maxPerOrder === null || maxPerOrder < 1) requiredMissing.push("maxPerOrder");

  const safety = details.safety;
  const included = details.included
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    version: PRODUCT_FORM_SNAPSHOT_VERSION,
    mode: input.mode,
    productId: input.productId,
    title: values.title.trim(),
    priceCents: toPriceCents(values.price),
    currency: values.currency,
    status: values.status,
    hasDescription: values.description.trim() !== "",
    descriptionLength: values.description.trim().length,
    trackStock: values.trackStock,
    stockQuantity: values.trackStock ? toCount(values.stockQuantity) : null,
    lowStockThreshold: toCount(values.lowStockThreshold),
    maxPerOrder: toCount(values.maxPerOrder),
    isDigital: input.isDigital,
    hasCoverImage: input.hasCoverImage,
    hasDigitalFile: input.hasDigitalFile,
    purchaseUrl: input.purchaseUrl.trim() || null,
    shippingProfileId: input.shippingProfileId,
    shippingProfileName: input.shippingProfileName,
    optionGroups: input.optionGroups.map((group) => ({
      id: group.id,
      name: group.name.trim(),
      display: group.display,
      optionCount: group.options.length,
      unavailableCount: group.options.filter((option) => !option.available).length,
    })),
    optionCount: input.optionGroups.reduce((total, g) => total + g.options.length, 0),
    galleryCount: input.gallery.length,
    galleryTiedCount: input.gallery.filter((image) => image.optionId).length,
    documentLabels: input.documents.map((document) => document.label.trim()).filter(Boolean),
    documentCount: input.documents.length,
    specs: {
      hasDimensions: Boolean(
        details.length.trim() || details.width.trim() || details.height.trim(),
      ),
      hasWeight: details.weight.trim() !== "",
      hasMaterials: details.materials.trim() !== "",
      hasCare: details.care.trim() !== "",
      includedCount: included.length,
      specCount: details.specs.filter((spec) => spec.label.trim()).length,
      hasOrigin: details.origin.trim() !== "",
      versionsWithOwnSpecs: versionsWithOwnSpecs(input),
    },
    safety: {
      started: safetyStarted(safety),
      complete: Boolean(
        safety.manufacturerName.trim() &&
          safety.manufacturerAddress.trim() &&
          safety.manufacturerEmail.trim(),
      ),
      hasResponsiblePerson: Boolean(
        safety.responsibleName.trim() ||
          safety.responsibleAddress.trim() ||
          safety.responsibleEmail.trim(),
      ),
      hasWarnings: safety.warnings.trim() !== "",
    },
    sections,
    requiredMissing,
    dirty: input.dirty,
    generatedAt: new Date().toISOString(),
  };
}
