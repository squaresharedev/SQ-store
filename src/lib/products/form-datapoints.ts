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
 * cannot, so append rather than rename.
 *
 * `required` marks a section the product cannot be saved without — which is
 * what lets the rail show a seller the two things standing between them and a
 * saved product, on a form with nine sections and forty fields.
 */
export const PRODUCT_FORM_SECTIONS = [
  {
    id: "basics",
    label: "Basics",
    description: "What you are selling, in your words — and what it costs.",
    required: true,
  },
  {
    id: "stock",
    label: "Stock",
    // THE SECTION'S ONLY EXPLANATION, which is why it also covers the alert.
    // Track stock and the low-stock alert had a "?" each, saying between them
    // what this one sentence says: three buttons on a card with two controls,
    // opening three windows onto the same idea. One section, one explanation.
    description:
      "Unlimited by default. Track it to stop overselling and show buyers sold-out and “Only N left” badges. The alert number is when that second badge appears.",
    required: false,
  },
  {
    id: "media",
    label: "Media and delivery",
    // NO DESCRIPTION, so this section shows no "?" beside its heading. Its
    // three fields — display image, digital file, purchase link — each carry
    // their own, and a fourth info button restating them in the header made a
    // card of four "?"s where the header's was the one you could skip. Empty
    // is the opt-out; see FormSection.
    description: "",
    required: false,
  },
  {
    id: "shipping",
    label: "Shipping",
    description:
      "Written once for your whole store, not per product. Pick a profile only if this one ships differently.",
    required: false,
  },
  {
    id: "options",
    label: "Options",
    description:
      "Colours, sizes, power outputs — however this product varies. Buyers pick one of each.",
    required: false,
  },
  {
    id: "photos",
    label: "Photos",
    description: "More angles for the product page. Drop photos onto an option to show them only for it.",
    required: false,
  },
  {
    id: "specs",
    label: "Specifications",
    description: "Dimensions, materials and specifications for the product page.",
    required: false,
  },
  {
    id: "documents",
    label: "Documents",
    description:
      "Certificates, manuals, or spec sheets buyers and regulators can check before buying.",
    required: false,
  },
  {
    id: "safety",
    label: "Safety and compliance",
    description:
      "Who made it and how to reach them. EU product-safety law asks for this on physical goods.",
    required: false,
  },
  {
    id: "visibility",
    label: "Visibility",
    // Both states, because the point of the setting is the difference between
    // them — this is where STATUS_HINTS went when the form stopped printing a
    // sentence under a two-button control that already says Active and Draft.
    description:
      "Active is live: buyers can see it and buy it right away. Draft is hidden from buyers until you switch it.",
    required: false,
  },
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

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

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
function summarize(input: ProductFormStateInput): Record<ProductFormSectionId, string> {
  const { values, details } = input;
  const optionCount = input.optionGroups.reduce((total, g) => total + g.options.length, 0);
  const ownSpecs = versionsWithOwnSpecs(input);
  // EVERY field in the section, not a sample of them. A summary that ignores
  // some of what it summarises is worse than none: filling "Made in" and
  // being told the section is still Empty teaches a seller not to trust it.
  //
  // Named the way the FIELDS are named, not the way the state is. "Made in"
  // is what the seller filled in; "origin" is what we happen to call it, and
  // a summary is no place to make someone translate.
  const specParts = [
    details.length.trim() || details.width.trim() || details.height.trim() ? "Dimensions" : "",
    details.weight.trim() ? "Weight" : "",
    details.materials.trim() ? "Materials" : "",
    details.care.trim() ? "Care" : "",
    details.included.trim() ? "Contents" : "",
    details.specs.filter((spec) => spec.label.trim()).length > 0 ? "Specs" : "",
    details.origin.trim() ? "Made in" : "",
    // Named the way the seller thinks of it: "2 versions" is the count of
    // versions measuring something of their own, not a field they filled in.
    ownSpecs > 0 ? plural(ownSpecs, "version") : "",
  ].filter(Boolean);

  return {
    basics: values.title.trim() || "",
    stock: values.trackStock
      ? // Show the actual quantity rather than a misleading "0": an empty
        // field means the seller hasn't answered yet, not that they have zero
        // units. The toggle flip now seeds a real value, so this branch reads
        // as unanswered only in the edge case where seeding hasn't run.
        values.stockQuantity.trim()
        ? `Tracking ${values.stockQuantity.trim()}`
        : "Set quantity"
      : "Unlimited",
    media: [
      input.hasCoverImage ? "Image" : "",
      input.hasDigitalFile ? "Download" : "",
      input.purchaseUrl.trim() ? "Buy link" : "",
    ]
      .filter(Boolean)
      .join(" · "),
    // NEVER EMPTY, unlike every other summary here. "Store terms" is a real
    // answer and the right one for nearly every product, so a section that
    // read "Empty" would be telling a seller to go and fix something that is
    // already correct.
    shipping: input.isDigital
      ? ""
      : (input.shippingProfileName ?? (input.shippingProfileId ? "Removed profile" : "Store terms")),
    options:
      input.optionGroups.length === 0
        ? ""
        : `${plural(input.optionGroups.length, "group")}, ${plural(optionCount, "option")}`,
    photos: input.gallery.length === 0 ? "" : plural(input.gallery.length, "photo"),
    specs: specParts.join(" · "),
    documents: input.documents.length === 0 ? "" : plural(input.documents.length, "document"),
    safety: safetyStarted(details.safety)
      ? details.safety.manufacturerName.trim() || "Started"
      : "",
    visibility: values.status === "active" ? "Active" : "Draft",
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
  const summaries = summarize(input);
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
    label: section.label,
    required: section.required,
    state: invalid.has(section.id) ? "invalid" : summaries[section.id] ? "filled" : "empty",
    summary: summaries[section.id],
  }));

  const requiredMissing: string[] = [];
  if (!values.title.trim()) requiredMissing.push("title");
  if (toPriceCents(values.price) === null) requiredMissing.push("price");
  if (values.trackStock && toCount(values.stockQuantity) === null) {
    requiredMissing.push("stockQuantity");
  }

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
