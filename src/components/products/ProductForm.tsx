"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Eye,
  ImageIcon,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  Product,
  ProductFormValues,
  ProductStatus,
} from "@/types/product";
import { unexpectedError, type ActionError } from "@/lib/errors";
import { createProduct, updateProduct } from "@/lib/products/actions";
import { UploadError, uploadToR2 } from "@/lib/products/upload";
import { SaveButton, type SaveResult } from "@/components/ui/SaveButton";
import { useToast } from "@/components/ui/Toast";
import type { ProductWriteInput } from "@/lib/validation/product";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Modal } from "@/components/ui/modal";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useUnsavedChangesGuard } from "@/lib/hooks/useUnsavedChangesGuard";
import {
  destructiveButtonClass,
  errorTextClass,
  fieldBaseClass,
  helpTextClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { FormSection } from "./FormSection";
import { PriceField } from "./PriceField";
import { ImageDropzone } from "./ImageDropzone";
import { FileDropzone } from "./FileDropzone";
import { StockFields } from "./StockFields";

const STATUS_OPTIONS: readonly { value: ProductStatus; label: string }[] = [
  // Active first: it is the default for new products — a seller adding a
  // product almost always wants it on sale immediately.
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
];

const STATUS_HINTS: Record<ProductStatus, string> = {
  active: "Live. Buyers can see and purchase it right away.",
  draft: "Hidden from buyers until you switch it to Active.",
};

/** Long enough to read the green check before the list replaces the form. */
const SAVED_HOLD_MS = 1100;

type FieldErrors = Partial<
  Record<"title" | "price" | "stockQuantity" | "lowStockThreshold", string>
>;

function initialValues(product?: Product): ProductFormValues {
  return {
    title: product?.title ?? "",
    description: product?.description ?? "",
    price: product ? String(product.price) : "",
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

  const trimmedPrice = values.price.trim();
  const priceNumber = Number(trimmedPrice);
  if (!trimmedPrice) {
    errors.price = "Set a price before saving.";
  } else if (!Number.isFinite(priceNumber) || priceNumber <= 0) {
    errors.price = "Price must be a number greater than zero.";
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

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const fieldId = useId();
  const toast = useToast();

  const [values, setValues] = useState<ProductFormValues>(() =>
    initialValues(product),
  );
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
    what: "image" | "file";
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
  const dirty =
    !saved &&
    (JSON.stringify(values) !== pristine || imageFile !== null || digitalTouched);
  const leaveGuard = useUnsavedChangesGuard(dirty, "/products");

  function updateField<Key extends keyof ProductFormValues>(
    key: Key,
    value: ProductFormValues[Key],
  ) {
    setValues((previous) => {
      const next = { ...previous, [key]: value };
      if (submitAttempted) setErrors(validate(next));
      return next;
    });
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

    const foundErrors = validate(values);
    setErrors(foundErrors);
    const problems = Object.values(foundErrors);
    if (problems.length > 0) {
      // The fields carry their own messages, but on a form this long the
      // offending one is usually off-screen when Save is pressed — without
      // this the click reads as "nothing happened".
      toast({
        tone: "error",
        title:
          problems.length === 1
            ? "This product can't be saved yet"
            : `This product can't be saved yet — ${problems.length} things to fix`,
        lines: problems,
      });
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
      setUpload(null);

      const input: ProductWriteInput = {
        title: values.title.trim(),
        description: values.description.trim(),
        // The form shows decimal major units; the DB stores integer cents.
        priceCents: Math.round(Number(values.price) * 100),
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
        toast({
          tone: "error",
          title: result.error.message,
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
      toast({
        tone: "error",
        title: info.message,
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
  const imageHintId = `${fieldId}-image-hint`;
  const fileHintId = `${fieldId}-file-hint`;
  const statusHintId = `${fieldId}-status-hint`;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* No summary banner here any more. It said only "fix the highlighted
          fields", sat at the top of a long form, and was the thing a seller
          had to scroll up to find. The toast raised on a blocked save names
          every problem, announces itself, and appears where the Save button
          is; the fields still carry their own inline messages. */}

      <FormSection
        icon={Package}
        title="Details"
        description="What you are selling, in your words — and what it costs."
      >
        <div className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-title`} className={labelClass}>
              Title
            </label>
            {/* The one field every product needs — visually the biggest. */}
            <input
              id={`${fieldId}-title`}
              type="text"
              value={values.title}
              onChange={(event) => updateField("title", event.target.value)}
              placeholder="e.g. Ambient Loops Vol. 1"
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? titleErrorId : undefined}
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
              className={cn(fieldBaseClass, "resize-y")}
            />
          </div>

          {/* Price lives here rather than in a section of its own: title,
              description and price are the three things every product needs
              before it can be saved, and splitting them put one field behind
              its own heading. The platform-cut note moved with it, onto the
              field it actually describes. */}
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
            <p className={helpTextClass}>
              What buyers pay. You keep this minus the platform cut.
            </p>
          </div>
        </div>
      </FormSection>

      <FormSection
        icon={Boxes}
        title="Stock"
        description="Unlimited by default. Track it to prevent overselling."
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
          onChange={(key, value) =>
            updateField(key as keyof ProductFormValues, value)
          }
        />
      </FormSection>

      <FormSection
        icon={ImageIcon}
        title="Media and delivery"
        description="How it looks in the grid, and what the buyer receives."
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-image`} className={labelClass}>
              Display image
            </label>
            <p id={imageHintId} className={helpTextClass}>
              Shown on your storefront and embeds.
            </p>
            <ImageDropzone
              inputId={`${fieldId}-image`}
              describedById={imageHintId}
              initialPreviewUrl={product?.imageUrl ?? null}
              onFileChange={setImageFile}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-file`} className={labelClass}>
              Digital file
            </label>
            <p id={fileHintId} className={helpTextClass}>
              The file your buyer downloads after purchase.
            </p>
            <FileDropzone
              inputId={`${fieldId}-file`}
              describedById={fileHintId}
              initialFileName={product?.digitalFileName ?? null}
              onFileChange={(file) => {
                setDigitalFile(file);
                setDigitalTouched(true);
              }}
            />
          </div>
        </div>
      </FormSection>

      <FormSection
        icon={Eye}
        title="Visibility"
        description="Whether buyers can see this product."
      >
        <div className="space-y-2 sm:max-w-xs">
          <SegmentedControl
            value={values.status}
            options={STATUS_OPTIONS}
            onChange={(status) => updateField("status", status)}
            ariaLabel="Product status"
          />
          <p id={statusHintId} className={helpTextClass} aria-live="polite">
            {STATUS_HINTS[values.status]}
          </p>
        </div>
      </FormSection>

      {/* Actions */}
      <div className="border-t border-border pt-6">
        {/* Upload progress. Two honest phases: a real percentage while bytes
            move, then an indeterminate bar once they are all sent and the
            server is sniffing, moderating and storing the file. Reporting a
            flat 100% through that second phase made a working upload look
            hung, because the slow part happens after the bytes leave. */}
        {upload && (
          <div className="mb-4 flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-inter text-sm text-muted-foreground">
                {upload.fraction === null
                  ? `Processing ${upload.what === "image" ? "image" : "file"}…`
                  : `Uploading ${upload.what === "image" ? "image" : "file"}…`}
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
                  ? `Processing ${upload.what === "image" ? "image" : "file"}`
                  : `Uploading ${upload.what === "image" ? "image" : "file"}`
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
            onClick={() => leaveGuard.requestLeave("/products")}
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
            className={secondaryButtonClass}
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={leaveGuard.leave}
            disabled={submitting}
            className={destructiveButtonClass}
          >
            Discard changes
          </button>
          <button
            type="button"
            onClick={handleSaveAndLeave}
            disabled={submitting}
            className={primaryButtonClass}
          >
            {submitting ? "Saving…" : "Save and leave"}
          </button>
        </div>
      </Modal>
    </form>
  );
}
