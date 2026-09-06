"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Eye,
  FileText,
  ImageIcon,
  Images,
  Layers,
  Package,
  Ruler,
  Save,
  ShieldCheck,
  Trash2,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  OPTIONS_PER_GROUP_MAX,
  type Product,
  type ProductDetail,
  type ProductFormValues,
  type ProductOptionGroup,
  type ProductStatus,
} from "@/types/product";
import { GalleryField } from "./GalleryField";
import { OptionsField } from "./OptionsField";
import { OptionSpecsField } from "./OptionSpecsField";
import { DetailsFields } from "./DetailsFields";
import { SafetyFields } from "./SafetyFields";
import { DocumentsField } from "./DocumentsField";
import {
  detailsToInput,
  initialDetailsValues,
  initialOptionDetails,
  optionDetailsToInput,
  validateDetails,
  validateOptionDetails,
  type DetailsFieldErrors,
  type DetailsFormValues,
  type DocumentFormValue,
  type GalleryFormImage,
  type OptionDetailsFormValues,
} from "./form-values";
import { unexpectedError, type ActionError } from "@/lib/errors";
import { createProduct, updateProduct } from "@/lib/products/actions";
import { UploadError, uploadToR2 } from "@/lib/products/upload";
import { SaveButton, type SaveResult } from "@/components/ui/SaveButton";
import { useToast } from "@/components/ui/Toast";
import { collectOptionIds, type ProductWriteInput, PRICE_CENTS_MAX } from "@/lib/validation/product";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Modal } from "@/components/ui/modal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useUnsavedChangesGuard } from "@/lib/hooks/useUnsavedChangesGuard";
import { useNavigationBlocker } from "@/lib/hooks/useNavigationBlocker";
import { parseFormPriceCents, priceErrorMessage } from "@/lib/products/price";
import {
  destructiveButtonClass,
  errorTextClass,
  fieldBaseClass,
  helpTextClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { InfoTip } from "@/components/ui/InfoTip";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { FormSection } from "./FormSection";
import { FormSectionNav } from "./FormSectionNav";
import { ProductFormSnapshotScript } from "./ProductFormSnapshotScript";
import {
  PRODUCT_FORM_SECTIONS,
  buildProductFormSnapshot,
  type ProductFormSectionId,
} from "@/lib/products/form-datapoints";
import { PriceField } from "./PriceField";
import { ImageDropzone } from "./ImageDropzone";
import { FileDropzone } from "./FileDropzone";
import { StockFields } from "./StockFields";
import { ShippingField } from "./ShippingField";
import type { ShippingChoices } from "@/lib/storefront/queries";
import { SHIPPING_SETTINGS_HREF } from "@/types/shipping-policy";

/** A seller who has written no terms yet has nothing to inherit and nothing
 *  to pick, and the section says so rather than showing an empty picker.
 *  `editHref` is never null: Settings › Shipping & returns exists whether or
 *  not the seller has a storefront. */
const NO_SHIPPING_CHOICES: ShippingChoices = {
  profiles: [],
  fallback: { dispatch: "", body: "" },
  editHref: SHIPPING_SETTINGS_HREF,
};

const STATUS_OPTIONS: readonly { value: ProductStatus; label: string }[] = [
  // Active first: it is the default for new products — a seller adding a
  // product almost always wants it on sale immediately.
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
];

/** Long enough to read the green check before the list replaces the form. */
const SAVED_HOLD_MS = 1100;

type FieldErrors = Partial<
  Record<
    "title" | "price" | "stockQuantity" | "lowStockThreshold" | "purchaseUrl" | "optionGroups",
    string
  >
>;

/** The edit route hands over the full detail row; tests and the create route
 *  may pass a bare Product, so the page-detail members are optional here. */
type FormProduct = Product &
  Partial<
    Pick<
      ProductDetail,
      | "gallery"
      | "optionGroups"
      | "details"
      | "documents"
      | "purchaseUrl"
      | "shippingProfileId"
    >
  >;

function initialGallery(product?: FormProduct): GalleryFormImage[] {
  return (product?.gallery ?? []).map((image) => ({
    localId: image.key,
    key: image.key,
    file: null,
    previewUrl: image.url,
    alt: image.alt,
    ...(image.optionId ? { optionId: image.optionId } : {}),
  }));
}

function initialDocuments(product?: FormProduct): DocumentFormValue[] {
  return (product?.documents ?? []).map((document) => ({
    localId: document.key,
    key: document.key,
    file: null,
    fileName: null,
    label: document.label,
  }));
}

function initialValues(product?: Product): ProductFormValues {
  return {
    title: product?.title ?? "",
    description: product?.description ?? "",
    price: product ? product.price.toFixed(2) : "",
    currency: product?.currency ?? "EUR",
    // Common-answer default: new products go live on save. Existing products
    // keep whatever the seller chose.
    status: product?.status ?? "active",
    trackStock: product?.trackStock ?? false,
    stockQuantity:
      product?.stockQuantity != null ? String(product.stockQuantity) : "",
    lowStockThreshold: String(product?.lowStockThreshold ?? 5),
  };
}

// Client-side validation is for UX feedback only. It is NOT a security
// boundary: the server actions re-validate everything with Zod
// (lib/validation/product.ts) before any write.
function validate(values: ProductFormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.title.trim()) {
    errors.title = "Give your product a title — buyers see it first.";
  }

  const priceResult = parseFormPriceCents(values.price);
  if (!priceResult.ok) {
    errors.price = priceErrorMessage(priceResult.error, values.currency, PRICE_CENTS_MAX);
  }

  if (values.trackStock) {
    const trimmedQty = values.stockQuantity.trim();
    if (!trimmedQty) {
      errors.stockQuantity =
        "Enter how many units are in stock, or turn Track stock off for unlimited.";
    } else if (
      !Number.isInteger(Number(trimmedQty)) ||
      Number(trimmedQty) < 0
    ) {
      errors.stockQuantity =
        "Stock must be a whole number — 0 or more, with no decimals.";
    }
  }

  const trimmedThreshold = values.lowStockThreshold.trim();
  if (trimmedThreshold) {
    if (
      !Number.isInteger(Number(trimmedThreshold)) ||
      Number(trimmedThreshold) < 0
    ) {
      errors.lowStockThreshold =
        "The low-stock alert must be a whole number of 0 or more.";
    }
  }

  return errors;
}

/** The page-detail fields' own UX checks; the server re-parses with Zod. */
function validatePage(purchaseUrl: string, optionGroups: ProductOptionGroup[]): FieldErrors {
  const errors: FieldErrors = {};
  const link = purchaseUrl.trim();
  if (link && !/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(link)) {
    errors.purchaseUrl = "The purchase link must be a full https:// address.";
  }
  // Each message names the ONE thing to fix, in the order a seller would hit
  // them: an unnamed axis, an axis with nothing to pick, then an unnamed
  // choice. The schema refuses all three, but a rejected save that only says
  // "didn't pass validation" is not a fix.
  if (optionGroups.some((group) => !group.name.trim())) {
    errors.optionGroups = "Say what each option group varies, or remove it.";
  } else if (optionGroups.some((group) => group.options.length === 0)) {
    const empty = optionGroups.find((group) => group.options.length === 0)!;
    errors.optionGroups = `Add at least one ${empty.name.trim().toLowerCase()} option, or remove the group.`;
  } else if (optionGroups.some((group) => group.options.some((option) => !option.name.trim()))) {
    errors.optionGroups = "Give every option a name, or remove the empty row.";
  } else if (optionGroups.some((group) => group.options.length > OPTIONS_PER_GROUP_MAX)) {
    errors.optionGroups = `An option group can have up to ${OPTIONS_PER_GROUP_MAX} options.`;
  }
  return errors;
}

/**
 * Which SECTION each field's error belongs to.
 *
 * The index rail and the section headers report a problem where the seller has
 * to go to fix it, which means an error on a field has to name its section.
 * Spelled out rather than derived from the field id, because the two lists are
 * genuinely independent: `purchaseUrl` lives under Media and delivery, and
 * nothing about its name says so.
 */
const FIELD_SECTIONS: Record<string, ProductFormSectionId> = {
  title: "basics",
  price: "basics",
  // Nothing here can be invalid — the shipping section is a choice from a
  // closed list, and its default answer is always available.
  stockQuantity: "stock",
  lowStockThreshold: "stock",
  purchaseUrl: "media",
  optionGroups: "options",
  length: "specs",
  width: "specs",
  height: "specs",
  weight: "specs",
  specs: "specs",
  optionDetails: "specs",
  manufacturerName: "safety",
  manufacturerAddress: "safety",
  manufacturerEmail: "safety",
  responsibleEmail: "safety",
};

/** The sections currently carrying at least one validation message. */
function sectionsWithErrors(
  errors: FieldErrors,
  detailsErrors: DetailsFieldErrors,
): ProductFormSectionId[] {
  const found = new Set<ProductFormSectionId>();
  for (const [field, message] of Object.entries({ ...errors, ...detailsErrors })) {
    const section = message ? FIELD_SECTIONS[field] : undefined;
    if (section) found.add(section);
  }
  return [...found];
}

/** The first field (in form order) actually carrying an error right now —
 *  what a click on the "can't be saved" toast jumps to. `FIELD_SECTIONS`'s
 *  own key order already matches the form's, since it was written top to
 *  bottom alongside the sections it names. */
function firstErroredField(
  errors: FieldErrors,
  detailsErrors: DetailsFieldErrors,
): string | undefined {
  const merged: Record<string, string | undefined> = { ...errors, ...detailsErrors };
  return Object.keys(FIELD_SECTIONS).find((field) => merged[field]);
}

/** Where a field's own control lives, for the fields whose `data-product-field`
 *  doesn't match its error key verbatim — the safety block's inputs carry a
 *  `safety.` prefix that the (unprefixed) validation errors don't. */
const FIELD_SELECTOR_OVERRIDES: Record<string, string> = {
  manufacturerName: "safety.manufacturerName",
  manufacturerAddress: "safety.manufacturerAddress",
  manufacturerEmail: "safety.manufacturerEmail",
  responsibleEmail: "safety.responsibleEmail",
};

/** The container itself if it's already a control, else the first control
 *  inside it — a field's `data-product-field` sometimes marks a wrapper div
 *  (a currency toggle, a unit picker) rather than the input itself. */
function focusableWithin(container: Element | null): HTMLElement | null {
  if (!container) return null;
  if (container.matches("input, textarea, select, button")) {
    return container as HTMLElement;
  }
  return container.querySelector<HTMLElement>("input, textarea, select, button");
}

/** Scrolls to and focuses the control for one problem field, so clicking the
 *  save-blocked toast takes the seller straight to what needs fixing instead
 *  of leaving them to hunt a forty-field, nine-section form for it. */
function focusProductField(field: string) {
  let target: HTMLElement | null = null;

  if (field === "specs") {
    // No single row owns this message — walk to the first one missing a
    // value, which is the only way `validateDetails` flags `specs` at all.
    for (const row of document.querySelectorAll<HTMLElement>("[data-product-spec-row]")) {
      const label = row.querySelector<HTMLInputElement>('[data-product-field$=".label"]');
      const value = row.querySelector<HTMLInputElement>('[data-product-field$=".value"]');
      if (label?.value.trim() && !value?.value.trim()) {
        target = value;
        break;
      }
    }
  } else if (field === "optionGroups") {
    const wrapper = document.querySelector<HTMLElement>('[data-product-field="optionGroups"]');
    if (wrapper) {
      for (const input of wrapper.querySelectorAll<HTMLInputElement>("input[type='text']")) {
        if (!input.value.trim()) {
          target = input;
          break;
        }
      }
      target ??= wrapper;
    }
  } else {
    const selector = FIELD_SELECTOR_OVERRIDES[field] ?? field;
    target = focusableWithin(document.querySelector(`[data-product-field="${selector}"]`));
  }

  if (!target) return;
  const control = target;
  control.scrollIntoView({ behavior: "smooth", block: "center" });
  // Focus after the scroll starts rather than instantly: an immediate focus
  // triggers the browser's OWN scroll-into-view too, which fights the smooth
  // one above and jump-cuts straight to the field.
  window.setTimeout(() => control.focus({ preventScroll: true }), 300);
}

export function ProductForm({
  product,
  shippingChoices = NO_SHIPPING_CHOICES,
}: {
  product?: FormProduct;
  /** The store's shipping terms and named profiles, read on the server. */
  shippingChoices?: ShippingChoices;
}) {
  const router = useRouter();
  const fieldId = useId();
  const toast = useToast();

  const [values, setValues] = useState<ProductFormValues>(() =>
    initialValues(product),
  );
  // The product page's facts, held apart from `values`: the gallery carries
  // Files, and the details are their own tree of in-progress strings.
  const [gallery, setGallery] = useState<GalleryFormImage[]>(() => initialGallery(product));
  const [documents, setDocuments] = useState<DocumentFormValue[]>(() => initialDocuments(product));
  const [optionGroups, setOptionGroups] = useState<ProductOptionGroup[]>(() =>
    (product?.optionGroups ?? []).map((group) => ({
      ...group,
      options: group.options.map((option) => ({ ...option })),
    })),
  );
  const [details, setDetails] = useState<DetailsFormValues>(() =>
    initialDetailsValues(product?.details),
  );
  // What each VERSION measures, keyed by option id. Kept beside the options
  // rather than on them so a half-typed number survives being typed (see
  // form-values.ts); an entry whose option is gone is simply never read.
  const [optionDetails, setOptionDetails] = useState<Record<string, OptionDetailsFormValues>>(
    () => initialOptionDetails(product?.optionGroups ?? []),
  );
  const [purchaseUrl, setPurchaseUrl] = useState(product?.purchaseUrl ?? "");
  // Null = the store's default shipping terms, which is what nearly every
  // product uses and what a new one starts on.
  const [shippingProfileId, setShippingProfileId] = useState<string | null>(
    product?.shippingProfileId ?? null,
  );
  const [detailsErrors, setDetailsErrors] = useState<DetailsFieldErrors>({});
  /** One message per option id, shown on the version that carries it. */
  const [optionDetailErrors, setOptionDetailErrors] = useState<Record<string, string>>({});
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [digitalFile, setDigitalFile] = useState<File | null>(null);
  // Whether the seller interacted with the digital-file picker at all. Needed
  // to tell "left the stored file alone" (keep) apart from "removed it" (clear).
  const [digitalTouched, setDigitalTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Which upload is in flight and how far along, or null when none is.
  // `fraction: null` means the bytes are all sent and we are waiting on the
  // far end — for an image that is the server sniffing, moderating and
  // storing it, which is not instant and must not read as a stalled 100%.
  const [upload, setUpload] = useState<{
    what: "image" | "file" | "photo" | "document";
    fraction: number | null;
  } | null>(null);
  const [submitError, setSubmitError] = useState<ActionError | null>(null);
  // Drives the shared SaveButton's green/red treatment. A save that works
  // used to navigate away instantly with no acknowledgement at all, so an
  // upload that had in fact succeeded was indistinguishable from one that
  // silently did nothing.
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  // Only surface errors after the first submit, so the form does not shout at
  // the seller while they are still filling it in.
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // Set the moment a save succeeds, so the redirect that follows is not itself
  // treated as abandoning unsaved work.
  const [saved, setSaved] = useState(false);

  // The pending "show Saved, then navigate" timer. Held in a ref and cleared
  // on unmount: a redirect that fires after this form is gone would yank a
  // seller off whatever page they had moved on to.
  const redirectTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (redirectTimer.current !== null) {
        window.clearTimeout(redirectTimer.current);
      }
    },
    [],
  );

  // Unsaved-work guard. A product form holds typed copy AND picked files, so
  // leaving by accident can cost real effort. Compared against the pristine
  // values rather than a mutation flag, so editing a field and undoing it
  // correctly counts as clean.
  const pristine = useMemo(
    () => JSON.stringify(initialValues(product)),
    [product],
  );
  const pristinePage = useMemo(
    () =>
      JSON.stringify({
        gallery: initialGallery(product).map(({ key, alt, optionId }) => ({ key, alt, optionId })),
        documents: initialDocuments(product).map(({ key, label }) => ({ key, label })),
        optionGroups: product?.optionGroups ?? [],
        details: initialDetailsValues(product?.details),
        optionDetails: initialOptionDetails(product?.optionGroups ?? []),
        purchaseUrl: product?.purchaseUrl ?? "",
        shippingProfileId: product?.shippingProfileId ?? null,
      }),
    [product],
  );
  const pageState = JSON.stringify({
    gallery: gallery.map(({ key, alt, optionId }) => ({ key, alt, optionId })),
    documents: documents.map(({ key, label }) => ({ key, label })),
    optionGroups,
    details,
    optionDetails,
    purchaseUrl,
    shippingProfileId,
  });
  const dirty =
    !saved &&
    (JSON.stringify(values) !== pristine ||
      pageState !== pristinePage ||
      imageFile !== null ||
      digitalTouched);
  const leaveGuard = useUnsavedChangesGuard(dirty, "/products");
  const navBlocker = useNavigationBlocker();
  // Destructure so the dependency array tracks the stable useCallback identity
  // rather than the leaveGuard object reference (which changes each render).
  const { requestLeave } = leaveGuard;

  // Register with the dashboard-level navigation blocker whenever the form is
  // dirty, so sidebar links, the back link in ProductFormView, and the Ctrl-K
  // palette all hit the same guard as the Cancel button and browser Back.
  // The effect returns the unregister function directly as its cleanup.
  useEffect(() => {
    if (!dirty || !navBlocker) return;
    return navBlocker.register((href) => requestLeave(href));
  }, [dirty, navBlocker, requestLeave]);

  // A download has no shipping and no product-safety block: those sections
  // hide, and their values are dropped on save rather than stored unseen.
  const isDigital =
    digitalFile !== null || (Boolean(product?.digitalFileName) && !digitalTouched);

  // THE FORM AS ONE OBJECT, built from the state above and used twice: by the
  // section headers and the index rail a seller scans, and by the JSON island
  // an assistant reads. One computation, so the two cannot disagree about
  // what this product has (see lib/products/form-datapoints.ts).
  const invalidSections = sectionsWithErrors(errors, detailsErrors);
  const snapshot = buildProductFormSnapshot({
    mode: product ? "edit" : "create",
    productId: product?.id ?? null,
    values,
    optionGroups,
    gallery,
    documents,
    details,
    optionDetails,
    purchaseUrl,
    shippingProfileId,
    shippingProfileName:
      shippingChoices.profiles.find((profile) => profile.id === shippingProfileId)?.name ?? null,
    hasCoverImage: imageFile !== null || Boolean(product?.imageUrl),
    hasDigitalFile: isDigital,
    isDigital,
    dirty,
    invalidSections,
  });
  /** The section entries by id, so each card can be handed its own summary. */
  const sectionInfo = Object.fromEntries(
    snapshot.sections.map((section) => [section.id, section]),
  ) as Record<ProductFormSectionId, (typeof snapshot.sections)[number] | undefined>;

  function updateField<Key extends keyof ProductFormValues>(
    key: Key,
    value: ProductFormValues[Key],
  ) {
    setValues((previous) => {
      const next = { ...previous, [key]: value };
      if (submitAttempted) {
        setErrors({ ...validate(next), ...validatePage(purchaseUrl, optionGroups) });
      }
      return next;
    });
  }

  function updateOptionGroups(next: ProductOptionGroup[]) {
    setOptionGroups(next);
    if (submitAttempted) setErrors({ ...validate(values), ...validatePage(purchaseUrl, next) });
  }

  function updatePurchaseUrl(next: string) {
    setPurchaseUrl(next);
    if (submitAttempted) setErrors({ ...validate(values), ...validatePage(next, optionGroups) });
  }

  function updateDetails(next: DetailsFormValues) {
    setDetails(next);
    if (submitAttempted) setDetailsErrors(detailErrorsFor(next, optionDetails).flat);
  }

  function updateOptionDetails(next: Record<string, OptionDetailsFormValues>) {
    setOptionDetails(next);
    if (!submitAttempted) return;
    const found = detailErrorsFor(details, next);
    setDetailsErrors(found.flat);
    setOptionDetailErrors(found.byOption);
  }

  /**
   * The product's own detail errors and the versions', found together.
   *
   * They share a section, so they share the section's badge and the
   * save-blocked toast: `optionDetails` is one flat message standing for
   * however many versions carry a problem, while `byOption` is what each
   * version prints under itself.
   */
  function detailErrorsFor(
    nextDetails: DetailsFormValues,
    nextByOption: Record<string, OptionDetailsFormValues>,
  ): { flat: DetailsFieldErrors; byOption: Record<string, string> } {
    const byOption = validateOptionDetails(nextByOption, collectOptionIds(optionGroups));
    const flat = validateDetails(nextDetails, isDigital);
    const count = Object.keys(byOption).length;
    if (count > 0) {
      flat.optionDetails =
        count === 1
          ? "One version's own specifications need fixing."
          : `${count} versions' own specifications need fixing.`;
    }
    return { flat, byOption };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await performSave();
  }

  /** The whole save flow (validate, upload, write, navigate on success).
   *  Shared by the submit button and the leave-guard's "Save and leave", and
   *  returns whether it succeeded so the guard can branch without re-reading
   *  async state. */
  async function performSave(): Promise<boolean> {
    setSubmitAttempted(true);
    setSubmitError(null);
    setSaveResult(null);

    const foundErrors = { ...validate(values), ...validatePage(purchaseUrl, optionGroups) };
    setErrors(foundErrors);
    const found = detailErrorsFor(details, optionDetails);
    const foundDetailErrors = found.flat;
    setDetailsErrors(foundDetailErrors);
    setOptionDetailErrors(found.byOption);
    const problems = [...Object.values(foundErrors), ...Object.values(foundDetailErrors)];
    if (problems.length > 0) {
      // The sticky action bar shows the count and a "Jump to first" button.
      // Auto-scroll to the first problem on submit so the seller lands on it
      // without needing to click; the bar stays visible for subsequent jumps.
      const firstField = firstErroredField(foundErrors, foundDetailErrors);
      if (firstField) focusProductField(firstField);
      return false;
    }

    setSubmitting(true);
    try {
      // Upload straight to R2 via short-lived presigned URLs, then store only
      // the returned keys. `undefined` keeps a stored key, `null` clears it.
      // Uploads are the slow part of a save (a file can be tens of MB), so
      // each reports real byte progress instead of leaving the button on an
      // indeterminate "Saving…" for a minute.
      const imageKey = imageFile
        ? await uploadToR2(imageFile, "image", (fraction) =>
            setUpload({ what: "image", fraction }),
          )
        : undefined;
      const digitalFileKey = digitalFile
        ? await uploadToR2(digitalFile, "file", (fraction) =>
            setUpload({ what: "file", fraction }),
          )
        : digitalTouched
          ? null
          : undefined;

      // Extra photos: stored ones keep their key, picked ones upload now, one
      // at a time so the progress bar means something.
      const galleryInput: NonNullable<ProductWriteInput["gallery"]> = [];
      // A tie to an option that has since been deleted is dropped rather than
      // sent: the action refuses the whole save over a stale one, and losing a
      // photo's grouping beats losing the save.
      const optionIds = collectOptionIds(optionGroups);
      for (const image of gallery) {
        const key =
          image.key ??
          (image.file
            ? await uploadToR2(image.file, "image", (fraction) =>
                setUpload({ what: "photo", fraction }),
              )
            : null);
        if (!key) continue;
        galleryInput.push({
          key,
          alt: image.alt.trim(),
          ...(image.optionId && optionIds.has(image.optionId)
            ? { optionId: image.optionId }
            : {}),
        });
      }

      // Documents: same pattern, but their own upload kind. A manual is public
      // the moment it is saved, so it goes through the stricter route (PDF
      // only, 20 MB, its own budget) rather than the paid download's.
      const documentsInput: NonNullable<ProductWriteInput["documents"]> = [];
      for (const document of documents) {
        const key =
          document.key ??
          (document.file
            ? await uploadToR2(document.file, "document", (fraction) =>
                setUpload({ what: "document", fraction }),
              )
            : null);
        if (!key) continue;
        documentsInput.push({ key, label: document.label.trim() || "Document" });
      }
      setUpload(null);

      const input: ProductWriteInput = {
        gallery: galleryInput,
        documents: documentsInput,
        optionGroups: optionGroups.map((group) => ({
          ...group,
          name: group.name.trim(),
          // The stored override is REPLACED, never merged: what the form holds
          // is the whole answer for that version, so clearing its numbers has
          // to clear them on the row too.
          options: group.options.map(({ details: stored, ...option }) => {
            void stored;
            const own = optionDetailsToInput(optionDetails[option.id], {
              dimensionUnit: details.dimensionUnit,
              weightUnit: details.weightUnit,
            });
            return {
              ...option,
              name: option.name.trim(),
              ...(own ? { details: own } : {}),
            };
          }),
        })),
        details: detailsToInput(details, isDigital),
        purchaseUrl: purchaseUrl.trim() || null,
        // A download has no shipping, so a profile chosen before the file was
        // added is dropped rather than stored where nothing will read it —
        // the same rule the safety block follows.
        shippingProfileId: isDigital ? null : shippingProfileId,
        title: values.title.trim(),
        description: values.description.trim(),
        // The form shows decimal major units; the DB stores integer cents.
        // validate() ensures parseFormPriceCents succeeds before we get here;
        // re-parsing avoids threading the result through the early return.
        priceCents: (() => {
          const r = parseFormPriceCents(values.price);
          return r.ok ? r.cents : 0;
        })(),
        currency: values.currency,
        status: values.status,
        imageKey,
        digitalFileKey,
        trackStock: values.trackStock,
        stockQuantity: values.trackStock
          ? Number(values.stockQuantity)
          : null,
        lowStockThreshold: values.lowStockThreshold.trim()
          ? Number(values.lowStockThreshold)
          : undefined,
      };

      const result = product
        ? await updateProduct(product.id, input)
        : await createProduct(input);
      if (!result.ok) {
        setSubmitError(result.error);
        setSaveResult({ error: result.error.message });
        toast.error(result.error.message, {
          lines: result.error.fix ? [result.error.fix] : undefined,
        });
        return false;
      }

      // Disarm the guard before navigating: the work is saved, so the
      // redirect is not an abandonment.
      setSaved(true);
      // Confirm on the button first, THEN leave. Navigating in the same tick
      // meant the only evidence a save had worked was the list happening to
      // change — nothing ever said "saved", which is indistinguishable from a
      // no-op when the thing you were checking (an image) is easy to miss.
      setSaveResult({ success: "Saved" });
      // Raised BEFORE the redirect on purpose: the toast provider lives at the
      // root layout, so this survives the navigation and lands on the product
      // list — where the seller can see the row it is talking about.
      toast.success(
        product
          ? `"${input.title}" was saved.`
          : `"${input.title}" was added to your products.`,
      );
      redirectTimer.current = window.setTimeout(() => {
        // No router.refresh() alongside this: both server actions already
        // revalidatePath("/products"), and firing a refresh in the same tick
        // as the push raced it — on the create route the push lost, leaving
        // the seller on a form whose product HAD in fact been created.
        router.push("/products");
      }, SAVED_HOLD_MS);
      return true;
    } catch (error) {
      const info =
        error instanceof UploadError
          ? error.info
          : unexpectedError(error instanceof Error ? error.message : undefined);
      setSubmitError(info);
      setSaveResult({ error: info.message });
      toast.error(info.message, {
        lines: info.fix ? [info.fix] : undefined,
      });
      return false;
    } finally {
      setSubmitting(false);
      setUpload(null);
    }
  }

  /** Guard modal's third option: save first, leave only if the save lands.
   *  On failure the prompt closes so the error notice and field messages are
   *  visible instead of hidden behind the modal. Mirrors the storefront
   *  designer's three-button guard, which shipped first. */
  async function handleSaveAndLeave() {
    await performSave();
    // Close the prompt either way: on failure so the error and field messages
    // are readable, on success so the button's "Saved" confirmation is not
    // hidden behind the modal for the moment before the redirect. Success
    // needs no leave() — performSave has already scheduled the navigation.
    leaveGuard.cancel();
  }

  const titleErrorId = `${fieldId}-title-error`;
  const priceErrorId = `${fieldId}-price-error`;
  const purchaseErrorId = `${fieldId}-purchase-error`;
  const uploadNoun =
    upload?.what === "image"
      ? "image"
      : upload?.what === "photo"
        ? "photo"
        : upload?.what === "document"
          ? "document"
          : "file";

  // Problems to show in the sticky action bar. Computed from the live error
  // state so the bar updates as the seller fixes fields without a re-save.
  const allProblems = submitAttempted
    ? (Object.values({ ...errors, ...detailsErrors }).filter(Boolean) as string[])
    : [];
  const firstErrField = submitAttempted
    ? firstErroredField(errors, detailsErrors)
    : undefined;

  /** Every section card gets its id, its live summary and its state from the
   *  one snapshot, so a header and the rail can never say different things. */
  const section = (id: ProductFormSectionId) => {
    const entry = PRODUCT_FORM_SECTIONS.find((candidate) => candidate.id === id)!;
    return {
      id,
      // One copy of the description, in the registry the snapshot reads from,
      // so the "?" and the machine-readable section can never disagree.
      description: entry.description,
      state: sectionInfo[id]?.state ?? ("empty" as const),
      summary: sectionInfo[id]?.summary,
    };
  };

  return (
    <div
      className="lg:grid lg:grid-cols-[minmax(0,1fr)_12.5rem] lg:items-start lg:gap-8"
      data-product-form={product ? "edit" : "create"}
      data-product-id={product?.id}
      data-product-form-dirty={dirty ? "1" : "0"}
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {/* No summary banner here any more. It said only "fix the highlighted
          fields", sat at the top of a long form, and was the thing a seller
          had to scroll up to find. The sticky action bar at the bottom names
          every problem inline, stays visible while the seller scrolls, and
          has a "Jump to first" button; the fields still carry their own
          inline messages. */}

      <FormSection
        {...section("basics")}
        icon={Package}
        // "Basics", not "Details" — the specifications section below was also
        // called Details, so the form had two identically named headings and
        // two sections with the same accessible name. On a page you scan by
        // heading, that is the worst possible collision.
        title="Basics"
      >
        <div className="space-y-5">
          <div className="space-y-1.5">
            <div className="flex items-center">
              <label htmlFor={`${fieldId}-title`} className={labelClass}>
                Title
              </label>
              <RequiredMark />
            </div>
            {/* The one field every product needs — visually the biggest. */}
            <input
              id={`${fieldId}-title`}
              type="text"
              value={values.title}
              onChange={(event) => updateField("title", event.target.value)}
              placeholder="e.g. Ambient Loops Vol. 1"
              required
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? titleErrorId : undefined}
              data-product-field="title"
              className={cn(fieldBaseClass, "py-3 text-lg font-medium")}
            />
            {errors.title && (
              <p id={titleErrorId} className={errorTextClass}>
                {errors.title}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-description`} className={labelClass}>
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <textarea
              id={`${fieldId}-description`}
              value={values.description}
              onChange={(event) => updateField("description", event.target.value)}
              rows={4}
              placeholder="What is it, and what does the buyer get?"
              data-product-field="description"
              className={cn(fieldBaseClass, "resize-y")}
            />
          </div>

          {/* Price lives here rather than in a section of its own: title,
              description and price are the three things every product needs
              before it can be saved, and splitting them put one field behind
              its own heading. */}
          <div className="space-y-1.5 sm:max-w-sm">
            <PriceField
              id={`${fieldId}-price`}
              errorId={priceErrorId}
              price={values.price}
              currency={values.currency}
              error={errors.price}
              onPriceChange={(price) => updateField("price", price)}
              onCurrencyChange={(currency) => updateField("currency", currency)}
            />
          </div>
        </div>
      </FormSection>

      <FormSection
        {...section("stock")}
        icon={Boxes}
        title="Stock"
      >
        <StockFields
          values={{
            trackStock: values.trackStock,
            stockQuantity: values.stockQuantity,
            lowStockThreshold: values.lowStockThreshold,
          }}
          errors={{
            stockQuantity: errors.stockQuantity,
            lowStockThreshold: errors.lowStockThreshold,
          }}
          onChange={(key, value) => {
            if (key === "trackStock") {
              // Seed stockQuantity in the same render so toggling on does
              // not immediately fire "Enter how many units are in stock".
              const checked = value as boolean;
              setValues((previous) => {
                const stockQuantityUpdate =
                  checked && !previous.stockQuantity.trim()
                    ? {
                        stockQuantity:
                          product?.stockQuantity != null
                            ? String(product.stockQuantity)
                            : "1",
                      }
                    : {};
                const next = { ...previous, trackStock: checked, ...stockQuantityUpdate };
                if (submitAttempted) {
                  setErrors({
                    ...validate(next),
                    ...validatePage(purchaseUrl, optionGroups),
                  });
                }
                return next;
              });
            } else {
              updateField(key as keyof ProductFormValues, value);
            }
          }}
        />
      </FormSection>

      <FormSection
        {...section("media")}
        icon={ImageIcon}
        title="Media and delivery"
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${fieldId}-image`} className={labelClass}>
                Display image
              </label>
              <InfoTip label="Where the display image is used">
                Shown on your storefront and embeds.
              </InfoTip>
            </div>
            <ImageDropzone
              inputId={`${fieldId}-image`}
              initialPreviewUrl={product?.imageUrl ?? null}
              onFileChange={setImageFile}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${fieldId}-file`} className={labelClass}>
                Digital file
              </label>
              <InfoTip label="What the digital file is">
                The file your buyer downloads after purchase. Adding one makes
                this a download, so shipping and product-safety stop applying.
              </InfoTip>
            </div>
            <FileDropzone
              inputId={`${fieldId}-file`}
              initialFileName={product?.digitalFileName ?? null}
              onFileChange={(file) => {
                setDigitalFile(file);
                setDigitalTouched(true);
              }}
            />
          </div>
        </div>

        {/* Where the product page's buy button goes. There is no in-house
            checkout yet, so this is the one way a page can sell: the seller's
            own checkout, payment link or marketplace listing. https only; the
            page prints the destination host beside the button. */}
        <div className="mt-6 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <label htmlFor={`${fieldId}-purchase`} className={labelClass}>
              Purchase link
            </label>
            <InfoTip label="Where the buy button sends buyers">
              The product page&apos;s buy button follows this link. Without one, it
              emails your store&apos;s contact address instead.
            </InfoTip>
          </div>
          <input
            id={`${fieldId}-purchase`}
            type="url"
            inputMode="url"
            value={purchaseUrl}
            onChange={(event) => updatePurchaseUrl(event.target.value)}
            placeholder="https://your-shop.example/checkout/this-product"
            spellCheck={false}
            aria-invalid={errors.purchaseUrl ? true : undefined}
            aria-describedby={errors.purchaseUrl ? purchaseErrorId : undefined}
            data-product-field="purchaseUrl"
            className={fieldBaseClass}
          />
          {errors.purchaseUrl && (
            <p id={purchaseErrorId} className={errorTextClass}>
              {errors.purchaseUrl}
            </p>
          )}
        </div>
      </FormSection>

      {/* SHIPPING IS A CHOICE, NOT A TEXT BOX, and it sits right after
          delivery because that is what it is the other half of: the section
          above says what a buyer receives, this one says how it reaches them.
          Hidden for downloads, which nobody posts. */}
      {!isDigital && (
        <FormSection
          {...section("shipping")}
          icon={Truck}
          title="Shipping"
        >
          <ShippingField
            inputId={`${fieldId}-shipping`}
            value={shippingProfileId}
            choices={shippingChoices}
            onChange={setShippingProfileId}
          />
        </FormSection>
      )}

      {/* OPTIONS BEFORE PHOTOS, deliberately. The photo buckets below are one
          per option, so a seller who meets Photos first has nowhere to drop a
          colour's shots and has to come back. Naming what varies first makes
          the next section already know about it. */}
      <FormSection
        {...section("options")}
        icon={Layers}
        title="Options"
      >
        <OptionsField
          inputId={`${fieldId}-options`}
          groups={optionGroups}
          onChange={updateOptionGroups}
          error={errors.optionGroups}
        />
      </FormSection>

      <FormSection
        {...section("photos")}
        icon={Images}
        title="Photos"
      >
        <GalleryField
          inputId={`${fieldId}-gallery`}
          images={gallery}
          optionGroups={optionGroups}
          onChange={setGallery}
        />
      </FormSection>

      <FormSection
        {...section("specs")}
        icon={Ruler}
        title="Specifications"
      >
        <DetailsFields
          inputId={`${fieldId}-details`}
          values={details}
          errors={detailsErrors}
          onChange={updateDetails}
        />
        {optionGroups.length > 0 && (
          <div className="mt-6 border-t border-border pt-5">
            <OptionSpecsField
              inputId={`${fieldId}-option-details`}
              optionGroups={optionGroups}
              byOption={optionDetails}
              units={{ dimensionUnit: details.dimensionUnit, weightUnit: details.weightUnit }}
              errors={optionDetailErrors}
              onChange={updateOptionDetails}
            />
          </div>
        )}
      </FormSection>

      <FormSection
        {...section("documents")}
        icon={FileText}
        title="Documents"
      >
        <DocumentsField
          inputId={`${fieldId}-documents`}
          documents={documents}
          onChange={setDocuments}
        />
      </FormSection>

      {!isDigital && (
        <FormSection
          {...section("safety")}
          icon={ShieldCheck}
          title="Safety and compliance"
        >
          <SafetyFields
            inputId={`${fieldId}-safety`}
            values={details.safety}
            errors={detailsErrors}
            onChange={(safety) => updateDetails({ ...details, safety })}
          />
        </FormSection>
      )}

      <FormSection
        {...section("visibility")}
        icon={Eye}
        title="Visibility"
      >
        {/* The datapoint sits on the WRAPPER, not on SegmentedControl:
            that component takes a closed set of props and spreads nothing
            onto the DOM, so an attribute handed to it would be dropped
            silently — and a datapoint that is quietly absent is worse than
            one that was never claimed. */}
        <div
          className="space-y-2 sm:max-w-xs"
          data-product-field="status"
          data-product-value={values.status}
        >
          <SegmentedControl
            value={values.status}
            options={STATUS_OPTIONS}
            onChange={(status) => updateField("status", status)}
            ariaLabel="Product status"
          />
        </div>
      </FormSection>

      {/* Actions — sticky so Save is always reachable without scrolling */}
      <div className="sticky bottom-0 z-10 bg-background border-t border-border py-4">
        {/* Inline error summary: appears where the seller's eyes already are
            when Save is pressed. Replaces the validation toast (which used to
            render at sm:bottom-6 and overlap this bar). The "Jump to first"
            button scrolls to the first invalid field for sellers who want to
            start there; the sticky bar stays visible while they scroll. */}
        {allProblems.length > 0 && (
          // role="alert" because this replaced a toast, and the toast was in a
          // live region: a blocked save has to be ANNOUNCED, not just drawn.
          // Without it a screen-reader user presses Save, nothing is spoken,
          // and the only evidence is a count they have to go looking for.
          <div
            role="alert"
            className="mb-4 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <div className="flex items-center justify-between gap-3">
              <span>
                {allProblems.length === 1
                  ? "1 thing to fix before saving"
                  : `${allProblems.length} things to fix before saving`}
              </span>
              {firstErrField && (
                <button
                  type="button"
                  onClick={() => focusProductField(firstErrField)}
                  className="shrink-0 font-medium underline underline-offset-2 hover:no-underline"
                >
                  Jump to first
                </button>
              )}
            </div>
          </div>
        )}

        {/* Upload progress. Two honest phases: a real percentage while bytes
            move, then an indeterminate bar once they are all sent and the
            server is sniffing, moderating and storing the file. Reporting a
            flat 100% through that second phase made a working upload look
            hung, because the slow part happens after the bytes leave. */}
        {upload && (
          <div className="mb-4 flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className={helpTextClass}>
                {upload.fraction === null
                  ? `Processing ${uploadNoun}…`
                  : `Uploading ${uploadNoun}…`}
              </span>
              {upload.fraction !== null && (
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {Math.round(upload.fraction * 100)}%
                </span>
              )}
            </div>
            <ProgressBar
              value={upload.fraction}
              label={
                upload.fraction === null
                  ? `Processing ${uploadNoun}`
                  : `Uploading ${uploadNoun}`
              }
            />
          </div>
        )}

        {/* The failure belongs NEXT TO the control that caused it. It used to
            render at the top of the form, so on a long form a failed save
            looked like nothing had happened until you scrolled up. */}
        {submitError && (
          <div className="mb-4">
            <ActionErrorNotice error={submitError} />
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {/* A button, not a Link: leaving has to run through the guard so
              half-written work isn't dropped on a stray click. */}
          <button
            type="button"
            onClick={() => requestLeave("/products")}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
          <SaveButton
            pending={submitting}
            state={saveResult ?? undefined}
            pendingLabel="Saving…"
          >
            {product ? "Save changes" : "Save product"}
          </SaveButton>
        </div>
      </div>

      <Modal
        open={leaveGuard.promptOpen}
        onClose={leaveGuard.cancel}
        title="Discard your changes?"
        description={
          product
            ? "The edits you've made to this product haven't been saved yet."
            : "This product hasn't been saved yet, so nothing will be kept."
        }
      >
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={leaveGuard.cancel}
            disabled={submitting}
            className={cn(secondaryButtonClass, "whitespace-nowrap")}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={leaveGuard.leave}
            disabled={submitting}
            className={cn(destructiveButtonClass, "whitespace-nowrap")}
          >
            <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
            Discard
          </button>
          <button
            type="button"
            onClick={handleSaveAndLeave}
            disabled={submitting}
            className={cn(primaryButtonClass, "whitespace-nowrap")}
          >
            {submitting ? (
              "Saving…"
            ) : (
              <>
                <Save className="size-4" strokeWidth={2} aria-hidden="true" />
                Save
              </>
            )}
          </button>
        </div>
      </Modal>
      </form>

      {/* The index, in the margin. Sticky so it stays with the reader on a
          form several screens tall, and hidden below `lg` where there is no
          margin to put it in — the section headers carry the same summaries,
          so nothing lives only here. */}
      <FormSectionNav
        sections={snapshot.sections}
        // Below the sticky TopBar (h-14), not under it.
        className="sticky top-20 hidden lg:block"
      />

      <ProductFormSnapshotScript snapshot={snapshot} />
    </div>
  );
}
