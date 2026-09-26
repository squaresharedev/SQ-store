"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
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
  type ProductsTranslator,
} from "./form-values";
import { unexpectedError, type ActionError } from "@/lib/errors";
import { createProduct, updateProduct } from "@/lib/products/actions";
import { UploadError, uploadToR2 } from "@/lib/products/upload";
import { SaveButton, type SaveResult } from "@/components/ui/SaveButton";
import { useToast } from "@/components/ui/Toast";
import type { MessageRef } from "@/i18n/types";
import {
  collectOptionIds,
  type ProductWriteInput,
  MAX_PER_ORDER_DEFAULT,
  PRICE_CENTS_MAX,
  PURCHASE_QUANTITY_MAX,
} from "@/lib/validation/product";
import {
  ActionErrorNotice,
  useActionErrorToast,
  useResolveMessage,
} from "@/components/ui/ActionErrorNotice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Modal } from "@/components/ui/modal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useUnsavedChangesGuard } from "@/lib/hooks/useUnsavedChangesGuard";
import { useNavigationBlocker } from "@/lib/hooks/useNavigationBlocker";
import { parseFormPriceCents, priceErrorMessage } from "@/lib/products/price";
import { formatPercent } from "@/lib/format/intl";
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
import { flagChipClass, flaggedFieldClass } from "@/components/ui/surface-styles";
import { SellerDetailsNotice } from "@/components/settings/SellerDetailsNotice";
import type { TraderIdentityField } from "@/lib/settings/trader-identity";
import {
  fixFieldLabel,
  flaggedFieldsIn,
  flaggedProductSections,
  type ProductFixField,
} from "@/lib/moderation/fix-fields";
import { moderationNoticeId } from "@/lib/moderation/paths";
import { requestModerationReview } from "@/lib/moderation/review-request";
import { formatList } from "@/lib/format/intl";
import { productEditPath } from "@/lib/products/paths";
import { FormSection, type SectionFlag } from "./FormSection";
import { useFixProgress } from "./useFixProgress";
import { FormSectionNav } from "./FormSectionNav";
import { ProductFormSnapshotScript } from "./ProductFormSnapshotScript";
import {
  buildProductFormSnapshot,
  sectionLabel,
  sectionSummaries,
  summaryText,
  type ProductFormSectionId,
  type ProductFormStateInput,
} from "@/lib/products/form-datapoints";
import { PriceField } from "./PriceField";
import { ImageDropzone } from "./ImageDropzone";
import { FileDropzone } from "./FileDropzone";
import { StockFields } from "./StockFields";
import { ShippingField } from "./ShippingField";
import type { ShippingChoices } from "@/lib/storefront/queries";
import {
  EMPTY_SHIPPING_POLICY,
  SHIPPING_SETTINGS_HREF,
  type SellerShippingPolicy,
} from "@/types/shipping-policy";

/** A seller who has written no terms yet has nothing to inherit and nothing
 *  to pick, and the section says so rather than showing an empty picker.
 *  `editHref` is never null: Settings › Shipping & returns exists whether or
 *  not the seller has a storefront. */
const NO_SHIPPING_CHOICES: ShippingChoices = {
  profiles: [],
  fallback: { dispatch: "", body: "" },
  editHref: SHIPPING_SETTINGS_HREF,
};

// Active first: it is the default for new products — a seller adding a
// product almost always wants it on sale immediately.
const STATUS_ORDER: readonly ProductStatus[] = ["active", "draft"];

/** Long enough to read the green check before the list replaces the form. */
const SAVED_HOLD_MS = 1100;

/** No flagged parts: a live product, a draft, or a removal (nothing to fix). */
const NO_FIX_FIELDS: readonly string[] = [];

type FieldErrors = Partial<
  Record<
    | "title"
    | "price"
    | "stockQuantity"
    | "lowStockThreshold"
    | "maxPerOrder"
    | "purchaseUrl"
    | "optionGroups",
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

function initialValues(product?: Product, canPublish = true): ProductFormValues {
  return {
    title: product?.title ?? "",
    description: product?.description ?? "",
    price: product ? product.price.toFixed(2) : "",
    currency: product?.currency ?? "EUR",
    // Common-answer default: new products go live on save. Existing products
    // keep whatever the seller chose — INCLUDING `active` for one that went
    // live before the store's trader details were cleared, because showing it
    // as a draft would misreport what is stored. The status control explains
    // why saving it will not go through until the details are back.
    status: product?.status ?? (canPublish ? "active" : "draft"),
    trackStock: product?.trackStock ?? false,
    stockQuantity:
      product?.stockQuantity != null ? String(product.stockQuantity) : "",
    lowStockThreshold: String(product?.lowStockThreshold ?? 5),
    maxPerOrder: String(product?.maxPerOrder ?? MAX_PER_ORDER_DEFAULT),
  };
}

// Client-side validation is for UX feedback only. It is NOT a security
// boundary: the server actions re-validate everything with Zod
// (lib/validation/product.ts) before any write.
function validate(
  values: ProductFormValues,
  t: ProductsTranslator,
  resolve: (ref: MessageRef) => string,
  locale: Locale,
): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.title.trim()) {
    errors.title = t("form.errors.titleRequired");
  }

  const priceResult = parseFormPriceCents(values.price);
  if (!priceResult.ok) {
    errors.price = resolve(
      priceErrorMessage(priceResult.error, values.currency, PRICE_CENTS_MAX, locale),
    );
  }

  if (values.trackStock) {
    const trimmedQty = values.stockQuantity.trim();
    if (!trimmedQty) {
      errors.stockQuantity = t("form.errors.stockRequired");
    } else if (
      !Number.isInteger(Number(trimmedQty)) ||
      Number(trimmedQty) < 0
    ) {
      errors.stockQuantity = t("form.errors.stockWhole");
    }
  }

  const trimmedThreshold = values.lowStockThreshold.trim();
  if (trimmedThreshold) {
    if (
      !Number.isInteger(Number(trimmedThreshold)) ||
      Number(trimmedThreshold) < 0
    ) {
      errors.lowStockThreshold = t("form.errors.lowStockWhole");
    }
  }

  // Required, unlike the alert threshold: this field always holds a number
  // (the form seeds it, and every product has one), so a blank is a seller
  // having cleared it rather than a seller who has not answered yet.
  const trimmedMax = values.maxPerOrder.trim();
  if (!trimmedMax) {
    errors.maxPerOrder = t("form.errors.maxPerOrderRequired", { max: PURCHASE_QUANTITY_MAX });
  } else if (
    !Number.isInteger(Number(trimmedMax)) ||
    Number(trimmedMax) < 1 ||
    Number(trimmedMax) > PURCHASE_QUANTITY_MAX
  ) {
    errors.maxPerOrder = t("form.errors.maxPerOrderRange", { max: PURCHASE_QUANTITY_MAX });
  }

  return errors;
}

/** The page-detail fields' own UX checks; the server re-parses with Zod. */
function validatePage(
  purchaseUrl: string,
  optionGroups: ProductOptionGroup[],
  t: ProductsTranslator,
): FieldErrors {
  const errors: FieldErrors = {};
  const link = purchaseUrl.trim();
  if (link && !/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(link)) {
    errors.purchaseUrl = t("form.errors.purchaseUrl");
  }
  // Each message names the ONE thing to fix, in the order a seller would hit
  // them: an unnamed axis, an axis with nothing to pick, then an unnamed
  // choice. The schema refuses all three, but a rejected save that only says
  // "didn't pass validation" is not a fix.
  if (optionGroups.some((group) => !group.name.trim())) {
    errors.optionGroups = t("form.errors.optionGroupUnnamed");
  } else if (optionGroups.some((group) => group.options.length === 0)) {
    const empty = optionGroups.find((group) => group.options.length === 0)!;
    errors.optionGroups = t("form.errors.optionGroupEmpty", {
      group: empty.name.trim().toLowerCase(),
    });
  } else if (optionGroups.some((group) => group.options.some((option) => !option.name.trim()))) {
    errors.optionGroups = t("form.errors.optionUnnamed");
  } else if (optionGroups.some((group) => group.options.length > OPTIONS_PER_GROUP_MAX)) {
    errors.optionGroups = t("form.errors.optionGroupFull", { max: OPTIONS_PER_GROUP_MAX });
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
  maxPerOrder: "stock",
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
  shippingPolicy = EMPTY_SHIPPING_POLICY,
  missingTraderDetails = [],
  returnTo = null,
}: {
  product?: FormProduct;
  /** The store's shipping terms and named profiles, read on the server. */
  shippingChoices?: ShippingChoices;
  /** The full policy document, only used to seed the shipping-terms modal. */
  shippingPolicy?: SellerShippingPolicy;
  /** Trader details this store still owes buyers, from the server. Non-empty
   *  means an `active` product would be refused on save, so the form does not
   *  offer that status. UX only: lib/products/actions.ts is the real gate. */
  missingTraderDetails?: readonly TraderIdentityField[];
  /** Where a CREATE lands, and where Cancel goes, when the seller came from a
   *  storefront designer (validated by lib/products/return-path.ts). Null keeps
   *  the products list. Edits always return to the list. */
  returnTo?: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("Products");
  const locale = useLocale();
  const tCommon = useTranslations("Common.actions");
  const fieldId = useId();
  const toast = useToast();
  const showActionError = useActionErrorToast();
  const resolveMessage = useResolveMessage();

  const canPublish = missingTraderDetails.length === 0;

  const [values, setValues] = useState<ProductFormValues>(() =>
    initialValues(product, canPublish),
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
  // A paused product's save asks "send it back now?" instead of leaving.
  const [reviewPromptOpen, setReviewPromptOpen] = useState(false);
  const [reviewPending, setReviewPending] = useState(false);
  const [reviewError, setReviewError] = useState<ActionError | null>(null);

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
  // `canPublish` belongs here as well as in the initial state: it decides what
  // a NEW product's status starts as, so a pristine form built without it
  // reads as already-edited for a store that may not publish yet — and the
  // leave guard then challenges someone who has typed nothing.
  const pristine = useMemo(
    () => JSON.stringify(initialValues(product, canPublish)),
    [product, canPublish],
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
  const formState: ProductFormStateInput = {
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
  };
  const snapshot = buildProductFormSnapshot(formState);
  // The same summary parts the snapshot states in English, for the seller in
  // their own language.
  const summaries = sectionSummaries(formState);
  /** The section entries by id, so each card can be handed its own summary. */
  const sectionInfo = Object.fromEntries(
    snapshot.sections.map((section) => [section.id, section]),
  ) as Record<ProductFormSectionId, (typeof snapshot.sections)[number] | undefined>;

  // ── WHAT STAFF ASKED TO CHANGE ──────────────────────────────────────────
  // A paused product arrives with the parts staff named (the photos, the
  // title). Each one's section is outlined and says so, the field itself is
  // outlined, and the index marks the section: the banner at the top says
  // WHAT, this is WHERE. A removal has nothing left to fix, so only a pause
  // lights the form up.
  const takedown = product?.removal;
  const pausedForFix = takedown?.kind === "paused";
  const fixFields = pausedForFix ? takedown.fields : NO_FIX_FIELDS;
  const awaitingReview = Boolean(takedown?.reviewRequestedAt);
  const fixProgress = useFixProgress(pausedForFix ? takedown.decisionId : null);
  const initialPage = useMemo(() => JSON.parse(pristinePage) as Record<string, unknown>, [
    pristinePage,
  ]);
  const pristineValues = useMemo(
    () => JSON.parse(pristine) as ProductFormValues,
    [pristine],
  );

  /** Whether the seller has edited one flagged part in this visit. */
  function changedNow(field: ProductFixField): boolean {
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    switch (field) {
      case "title":
      case "description":
        return values[field] !== pristineValues[field];
      case "price":
        return values.price !== pristineValues.price || values.currency !== pristineValues.currency;
      case "image":
        return imageFile !== null;
      case "file":
        return digitalTouched;
      case "purchaseLink":
        return purchaseUrl !== initialPage.purchaseUrl;
      case "shipping":
        return shippingProfileId !== initialPage.shippingProfileId;
      case "options":
        return !same(optionGroups, initialPage.optionGroups);
      case "photos":
        return !same(
          gallery.map(({ key, alt, optionId }) => ({ key, alt, optionId })),
          initialPage.gallery,
        );
      case "documents":
        return !same(
          documents.map(({ key, label }) => ({ key, label })),
          initialPage.documents,
        );
      case "specs": {
        const { safety: _now, ...specsNow } = details;
        const { safety: _then, ...specsThen } = initialPage.details as DetailsFormValues;
        void _now;
        void _then;
        return !same(specsNow, specsThen) || !same(optionDetails, initialPage.optionDetails);
      }
      case "safety":
        return !same(details.safety, (initialPage.details as DetailsFormValues).safety);
      default:
        return false;
    }
  }

  /** Edited now, or edited and saved earlier in this browser session. */
  const fixDone = (field: string) =>
    changedNow(field as ProductFixField) || fixProgress.saved.has(field);

  const flaggedSections = new Set<string>(flaggedProductSections(fixFields));

  function sectionFlag(id: ProductFormSectionId): SectionFlag | undefined {
    const inSection = flaggedFieldsIn(id, fixFields);
    if (!product || inSection.length === 0) return undefined;
    return {
      fields: formatList(
        inSection.map((field) => resolveMessage(fixFieldLabel("product", field))),
        locale,
        { englishSeparator: ", " },
      ),
      state: awaitingReview ? "review" : inSection.every(fixDone) ? "changed" : "needs",
      noticeId: moderationNoticeId(product.id),
    };
  }

  /** The outline for one flagged field's block, or nothing. */
  const fieldFlagClass = (field: ProductFixField) =>
    fixFields.includes(field) ? flaggedFieldClass : undefined;

  /** "Change this" beside a flagged field's label, until it has been. */
  const fixMark = (field: ProductFixField) =>
    fixFields.includes(field) && !awaitingReview && !fixDone(field) ? (
      <span className={cn(flagChipClass, "ml-2")} data-fix-mark={field}>
        {t("form.moderation.fieldBadge")}
      </span>
    ) : null;

  function updateField<Key extends keyof ProductFormValues>(
    key: Key,
    value: ProductFormValues[Key],
  ) {
    setValues((previous) => {
      const next = { ...previous, [key]: value };
      if (submitAttempted) {
        setErrors({
          ...validate(next, t, resolveMessage, locale),
          ...validatePage(purchaseUrl, optionGroups, t),
        });
      }
      return next;
    });
  }

  function updateOptionGroups(next: ProductOptionGroup[]) {
    setOptionGroups(next);
    if (submitAttempted) {
      setErrors({ ...validate(values, t, resolveMessage, locale), ...validatePage(purchaseUrl, next, t) });
    }
  }

  function updatePurchaseUrl(next: string) {
    setPurchaseUrl(next);
    if (submitAttempted) {
      setErrors({ ...validate(values, t, resolveMessage, locale), ...validatePage(next, optionGroups, t) });
    }
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
    const byOption = validateOptionDetails(nextByOption, collectOptionIds(optionGroups), t);
    const flat = validateDetails(nextDetails, isDigital, t);
    const count = Object.keys(byOption).length;
    if (count > 0) {
      flat.optionDetails = t("form.errors.versionSpecs", { count });
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
   *  async state. `leaving` skips the paused product's review prompt: the
   *  seller already said where they are going. */
  async function performSave({ leaving = false }: { leaving?: boolean } = {}): Promise<boolean> {
    setSubmitAttempted(true);
    setSubmitError(null);
    setSaveResult(null);

    const foundErrors = {
      ...validate(values, t, resolveMessage, locale),
      ...validatePage(purchaseUrl, optionGroups, t),
    };
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
        documentsInput.push({
          key,
          label: document.label.trim() || t("form.documentFallbackLabel"),
        });
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
        // validate() has already refused a blank or out-of-range value, so this
        // is always a legal integer by the time it is sent. The server parses
        // it again against the same bound (PURCHASE_QUANTITY_MAX) and the
        // column's CHECK is behind that: this line is convenience, not consent.
        maxPerOrder: Number(values.maxPerOrder.trim()),
      };

      const result = product
        ? await updateProduct(product.id, input)
        : await createProduct(input);
      if (!result.ok) {
        setSubmitError(result.error);
        setSaveResult({ error: resolveMessage(result.error.message) });
        showActionError(result.error);
        return false;
      }

      // Disarm the guard before navigating: the work is saved, so the
      // redirect is not an abandonment.
      setSaved(true);
      // Confirm on the button first, THEN leave. Navigating in the same tick
      // meant the only evidence a save had worked was the list happening to
      // change — nothing ever said "saved", which is indistinguishable from a
      // no-op when the thing you were checking (an image) is easy to miss.
      setSaveResult({ success: tCommon("saved") });

      // A PAUSED product's save is usually the fix itself, and the seller's
      // next move is sending it back. Leaving for the list here would bury
      // that button a page away, so they are asked on the spot instead. What
      // they changed is remembered, so the parts stay "Changed" after the
      // reload that follows either answer.
      if (pausedForFix && !awaitingReview) {
        fixProgress.remember(
          fixFields.filter((field) => changedNow(field as ProductFixField)),
        );
        if (!leaving) {
          setReviewPromptOpen(true);
          return true;
        }
      }

      // Raised BEFORE the redirect on purpose: the toast provider lives at the
      // root layout, so this survives the navigation and lands on the product
      // list — where the seller can see the row it is talking about.
      toast.success(
        product
          ? t("form.savedToast", { title: input.title })
          : t("form.addedToast", { title: input.title }),
      );
      redirectTimer.current = window.setTimeout(() => {
        // No router.refresh() alongside this: both server actions already
        // revalidatePath("/products"), and firing a refresh in the same tick
        // as the push raced it — on the create route the push lost, leaving
        // the seller on a form whose product HAD in fact been created.
        router.push(!product && returnTo ? returnTo : "/products");
      }, SAVED_HOLD_MS);
      return true;
    } catch (error) {
      const info =
        error instanceof UploadError
          ? error.info
          : unexpectedError(error instanceof Error ? error.message : undefined);
      setSubmitError(info);
      setSaveResult({ error: resolveMessage(info.message) });
      showActionError(info);
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
    await performSave({ leaving: true });
    // Close the prompt either way: on failure so the error and field messages
    // are readable, on success so the button's "Saved" confirmation is not
    // hidden behind the modal for the moment before the redirect. Success
    // needs no leave() — performSave has already scheduled the navigation.
    leaveGuard.cancel();
  }

  /**
   * The paused product's post-save question, answered. Either way the page
   * reloads in full: the form's own state still holds the files it just
   * uploaded, and only a fresh load reads back what was actually stored (and
   * shows the banner saying it went for review).
   */
  async function sendForReview() {
    if (!product) return;
    setReviewPending(true);
    setReviewError(null);
    const result = await requestModerationReview("product", product.id).catch(() => null);
    if (!result || !result.ok) {
      setReviewPending(false);
      setReviewError(result ? result.error : unexpectedError());
      return;
    }
    window.location.assign(productEditPath(product.id));
  }

  function keepEditing() {
    if (!product) return;
    setReviewPromptOpen(false);
    window.location.assign(productEditPath(product.id));
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
  const section = (id: ProductFormSectionId) => ({
    id,
    title: resolveMessage(sectionLabel(id)),
    // Media has no description, and so no "?": its three fields each carry
    // their own, and a fourth restating them in the header is noise.
    description: id === "media" ? "" : t(`form.sections.${id}.description`),
    about: id === "media" ? "" : t(`form.sections.${id}.about`),
    state: sectionInfo[id]?.state ?? ("empty" as const),
    summary: sectionInfo[id] ? summaryText(summaries[id], resolveMessage) : undefined,
    flag: sectionFlag(id),
  });

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
      >
        <div className="space-y-5">
          <div className={cn("space-y-1.5", fieldFlagClass("title"))} data-fix-field-block="title">
            <div className="flex items-center">
              <label htmlFor={`${fieldId}-title`} className={labelClass}>
                {t("form.title")}
              </label>
              <RequiredMark />
              {fixMark("title")}
            </div>
            {/* The one field every product needs — visually the biggest. */}
            <input
              id={`${fieldId}-title`}
              type="text"
              value={values.title}
              onChange={(event) => updateField("title", event.target.value)}
              placeholder={t("form.titlePlaceholder")}
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

          <div
            className={cn("space-y-1.5", fieldFlagClass("description"))}
            data-fix-field-block="description"
          >
            <label htmlFor={`${fieldId}-description`} className={labelClass}>
              {t("form.description")}{" "}
              <span className="font-normal text-muted-foreground">
                {t("form.optional")}
              </span>
              {fixMark("description")}
            </label>
            <textarea
              id={`${fieldId}-description`}
              value={values.description}
              onChange={(event) => updateField("description", event.target.value)}
              rows={4}
              placeholder={t("form.descriptionPlaceholder")}
              data-product-field="description"
              className={cn(fieldBaseClass, "resize-y")}
            />
          </div>

          {/* Price lives here rather than in a section of its own: title,
              description and price are the three things every product needs
              before it can be saved, and splitting them put one field behind
              its own heading. */}
          <div
            className={cn("space-y-1.5 sm:max-w-sm", fieldFlagClass("price"))}
            data-fix-field-block="price"
          >
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
      >
        <StockFields
          values={{
            trackStock: values.trackStock,
            stockQuantity: values.stockQuantity,
            lowStockThreshold: values.lowStockThreshold,
            maxPerOrder: values.maxPerOrder,
          }}
          errors={{
            stockQuantity: errors.stockQuantity,
            lowStockThreshold: errors.lowStockThreshold,
            maxPerOrder: errors.maxPerOrder,
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
                    ...validate(next, t, resolveMessage, locale),
                    ...validatePage(purchaseUrl, optionGroups, t),
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
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className={cn("space-y-1.5", fieldFlagClass("image"))} data-fix-field-block="image">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${fieldId}-image`} className={labelClass}>
                {t("form.displayImage")}
              </label>
              <InfoTip label={t("form.displayImageAbout")}>
                {t("form.displayImageHelp")}
              </InfoTip>
              {fixMark("image")}
            </div>
            <ImageDropzone
              inputId={`${fieldId}-image`}
              initialPreviewUrl={product?.imageUrl ?? null}
              onFileChange={setImageFile}
            />
          </div>

          <div className={cn("space-y-1.5", fieldFlagClass("file"))} data-fix-field-block="file">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${fieldId}-file`} className={labelClass}>
                {t("form.digitalFile")}
              </label>
              <InfoTip label={t("form.digitalFileAbout")}>
                {t("form.digitalFileHelp")}
              </InfoTip>
              {fixMark("file")}
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
        <div
          className={cn("mt-6 space-y-1.5", fieldFlagClass("purchaseLink"))}
          data-fix-field-block="purchaseLink"
        >
          <div className="flex items-center gap-1.5">
            <label htmlFor={`${fieldId}-purchase`} className={labelClass}>
              {t("form.purchaseLink")}
            </label>
            <InfoTip label={t("form.purchaseLinkAbout")}>
              {t("form.purchaseLinkHelp")}
            </InfoTip>
            {fixMark("purchaseLink")}
          </div>
          <input
            id={`${fieldId}-purchase`}
            type="url"
            inputMode="url"
            value={purchaseUrl}
            onChange={(event) => updatePurchaseUrl(event.target.value)}
            placeholder={t("form.purchaseLinkPlaceholder")}
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
        >
          <ShippingField
            inputId={`${fieldId}-shipping`}
            value={shippingProfileId}
            choices={shippingChoices}
            policy={shippingPolicy}
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
      >
        {/* The datapoint sits on the WRAPPER, not on SegmentedControl:
            that component takes a closed set of props and spreads nothing
            onto the DOM, so an attribute handed to it would be dropped
            silently — and a datapoint that is quietly absent is worse than
            one that was never claimed. */}
        <div className="space-y-3">
          <div
            className="space-y-2 sm:max-w-xs"
            data-product-field="status"
            data-product-value={values.status}
          >
            {/* Only ACTIVE is barred, never the whole control. Draft has to
                stay reachable: a product that went live before the store's
                details lapsed is one the seller may well want to take down,
                and that is the single remedial move available to them here.
                The segment stays visible rather than disappearing, so the
                choice is seen to exist and the notice below can explain it. */}
            <SegmentedControl
              value={values.status}
              options={STATUS_ORDER.map((status) => ({
                value: status,
                label: t(`status.${status}`),
                ...(status === "active" && !canPublish ? { disabled: true } : {}),
              }))}
              onChange={(status) => updateField("status", status)}
              ariaLabel={t("form.statusLabel")}
            />
          </div>
          {/* Not `detailed`: the banner in the chrome has already made the
              case, and this one is here to explain why the control above is
              dead. The button still goes to the field that revives it. */}
          <SellerDetailsNotice
            missing={missingTraderDetails}
            blocks="putProductOnSale"
            detailed={false}
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
                {t("form.problems", { count: allProblems.length })}
              </span>
              {firstErrField && (
                <button
                  type="button"
                  onClick={() => focusProductField(firstErrField)}
                  className="shrink-0 font-medium underline underline-offset-2 hover:no-underline"
                >
                  {t("form.jumpToFirst")}
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
                  ? t("form.processing", { what: uploadNoun })
                  : t("form.uploading", { what: uploadNoun })}
              </span>
              {upload.fraction !== null && (
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatPercent(Math.round(upload.fraction * 100), locale)}
                </span>
              )}
            </div>
            <ProgressBar
              value={upload.fraction}
              label={
                upload.fraction === null
                  ? t("form.processingLabel", { what: uploadNoun })
                  : t("form.uploadingLabel", { what: uploadNoun })
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
            onClick={() => requestLeave(!product && returnTo ? returnTo : "/products")}
            className={secondaryButtonClass}
          >
            {tCommon("cancel")}
          </button>
          <SaveButton
            pending={submitting}
            state={saveResult ?? undefined}
            pendingLabel={tCommon("saving")}
          >
            {product ? t("form.saveChanges") : t("form.saveProduct")}
          </SaveButton>
        </div>
      </div>

      {pausedForFix && (
        <Modal
          open={reviewPromptOpen}
          onClose={keepEditing}
          title={t("form.moderation.reviewPrompt.title")}
          description={t("form.moderation.reviewPrompt.body")}
        >
          <div className="flex flex-col gap-4" data-review-prompt="">
            {reviewError && <ActionErrorNotice error={reviewError} />}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={keepEditing}
                disabled={reviewPending}
                className={cn(secondaryButtonClass, "whitespace-nowrap")}
              >
                {t("form.moderation.reviewPrompt.keepEditing")}
              </button>
              <button
                type="button"
                onClick={sendForReview}
                disabled={reviewPending}
                className={cn(primaryButtonClass, "whitespace-nowrap")}
                data-review-prompt-send=""
              >
                {reviewPending ? tCommon("sending") : t("form.moderation.reviewPrompt.send")}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <Modal
        open={leaveGuard.promptOpen}
        onClose={leaveGuard.cancel}
        title={t("form.discard.title")}
        description={
          product ? t("form.discard.editDescription") : t("form.discard.newDescription")
        }
      >
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={leaveGuard.cancel}
            disabled={submitting}
            className={cn(secondaryButtonClass, "whitespace-nowrap")}
          >
            {tCommon("cancel")}
          </button>
          <button
            type="button"
            onClick={leaveGuard.leave}
            disabled={submitting}
            className={cn(destructiveButtonClass, "whitespace-nowrap")}
          >
            <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
            {t("form.discard.discard")}
          </button>
          <button
            type="button"
            onClick={handleSaveAndLeave}
            disabled={submitting}
            className={cn(primaryButtonClass, "whitespace-nowrap")}
          >
            {submitting ? (
              tCommon("saving")
            ) : (
              <>
                <Save className="size-4" strokeWidth={2} aria-hidden="true" />
                {tCommon("save")}
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
        flagged={flaggedSections}
        // Below the sticky TopBar (h-14), not under it.
        className="sticky top-20 hidden lg:block"
      />

      <ProductFormSnapshotScript snapshot={snapshot} />
    </div>
  );
}
