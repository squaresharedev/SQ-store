"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CURRENCIES,
  PRODUCT_STATUSES,
  type Currency,
  type Product,
  type ProductFormValues,
  type ProductStatus,
} from "@/types/product";
import { createProduct, updateProduct } from "@/lib/products/actions";
import { uploadToR2 } from "@/lib/products/upload";
import type { ProductWriteInput } from "@/lib/validation/product";
import { Select, type SelectOption } from "@/components/ui/select";
import {
  errorTextClass,
  fieldBaseClass,
  helpTextClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { ImageDropzone } from "./ImageDropzone";
import { FileDropzone } from "./FileDropzone";

const CURRENCY_OPTIONS: readonly SelectOption<Currency>[] = CURRENCIES.map(
  (currency) => ({ value: currency, label: currency }),
);

const STATUS_OPTIONS: readonly SelectOption<ProductStatus>[] =
  PRODUCT_STATUSES.map((status) => ({
    value: status,
    label: { draft: "Draft", active: "Active" }[status],
    description: {
      draft: "Hidden from buyers",
      active: "Visible for sale",
    }[status],
  }));

type FieldErrors = Partial<Record<"title" | "price", string>>;

function initialValues(product?: Product): ProductFormValues {
  return {
    title: product?.title ?? "",
    description: product?.description ?? "",
    price: product ? String(product.price) : "",
    currency: product?.currency ?? "EUR",
    status: product?.status ?? "draft",
  };
}

// Client-side validation is for UX feedback only. It is NOT a security
// boundary: the server actions re-validate everything with Zod
// (lib/validation/product.ts) before any write.
function validate(values: ProductFormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.title.trim()) {
    errors.title = "Give your product a title.";
  }

  const trimmedPrice = values.price.trim();
  const priceNumber = Number(trimmedPrice);
  if (!trimmedPrice) {
    errors.price = "Set a price.";
  } else if (!Number.isFinite(priceNumber) || priceNumber <= 0) {
    errors.price = "Price must be a number greater than zero.";
  }

  return errors;
}

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const fieldId = useId();

  const [values, setValues] = useState<ProductFormValues>(() =>
    initialValues(product),
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [digitalFile, setDigitalFile] = useState<File | null>(null);
  // Whether the seller interacted with the digital-file picker at all. Needed
  // to tell "left the stored file alone" (keep) apart from "removed it" (clear).
  const [digitalTouched, setDigitalTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  // Only surface errors after the first submit, so the form does not shout at
  // the seller while they are still filling it in.
  const [submitAttempted, setSubmitAttempted] = useState(false);

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
    setSubmitAttempted(true);
    setSubmitError(null);

    const foundErrors = validate(values);
    setErrors(foundErrors);
    if (Object.keys(foundErrors).length > 0) return;

    setSubmitting(true);
    try {
      // Upload straight to R2 via short-lived presigned URLs, then store only
      // the returned keys. `undefined` keeps a stored key, `null` clears it.
      const imageKey = imageFile ? await uploadToR2(imageFile, "image") : undefined;
      const digitalFileKey = digitalFile
        ? await uploadToR2(digitalFile, "file")
        : digitalTouched
          ? null
          : undefined;

      const input: ProductWriteInput = {
        title: values.title.trim(),
        description: values.description.trim(),
        // The form shows decimal major units; the DB stores integer cents.
        priceCents: Math.round(Number(values.price) * 100),
        currency: values.currency,
        status: values.status,
        imageKey,
        digitalFileKey,
      };

      const result = product
        ? await updateProduct(product.id, input)
        : await createProduct(input);
      if (!result.ok) {
        setSubmitError(result.error);
        return;
      }

      router.push("/products");
      router.refresh();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "Something went wrong. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const titleErrorId = `${fieldId}-title-error`;
  const priceErrorId = `${fieldId}-price-error`;
  const imageHintId = `${fieldId}-image-hint`;
  const fileHintId = `${fieldId}-file-hint`;
  const hasErrors = submitAttempted && Object.keys(errors).length > 0;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-8">
      {submitError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3"
        >
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-destructive"
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="font-inter text-sm text-destructive">{submitError}</p>
        </div>
      )}

      {hasErrors && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3"
        >
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-destructive"
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="font-inter text-sm text-destructive">
            Please fix the highlighted fields before saving.
          </p>
        </div>
      )}

      {/* Details */}
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-title`} className={labelClass}>
            Title
          </label>
          <input
            id={`${fieldId}-title`}
            type="text"
            value={values.title}
            onChange={(event) => updateField("title", event.target.value)}
            placeholder="e.g. Ambient Loops Vol. 1"
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? titleErrorId : undefined}
            className={fieldBaseClass}
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
            <span className="font-normal text-muted-foreground">(optional)</span>
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

        <div className="flex flex-col gap-5 sm:flex-row">
          <div className="flex-1 space-y-1.5">
            <label htmlFor={`${fieldId}-price`} className={labelClass}>
              Price
            </label>
            <input
              id={`${fieldId}-price`}
              type="text"
              inputMode="decimal"
              value={values.price}
              onChange={(event) => updateField("price", event.target.value)}
              placeholder="0.00"
              aria-invalid={errors.price ? true : undefined}
              aria-describedby={errors.price ? priceErrorId : undefined}
              className={fieldBaseClass}
            />
            {errors.price && (
              <p id={priceErrorId} className={errorTextClass}>
                {errors.price}
              </p>
            )}
          </div>

          <div className="space-y-1.5 sm:w-40">
            <label htmlFor={`${fieldId}-currency`} className={labelClass}>
              Currency
            </label>
            <Select
              id={`${fieldId}-currency`}
              value={values.currency}
              options={CURRENCY_OPTIONS}
              onChange={(currency) => updateField("currency", currency)}
            />
          </div>
        </div>

        <div className="space-y-1.5 sm:max-w-xs">
          <label htmlFor={`${fieldId}-status`} className={labelClass}>
            Status
          </label>
          <Select
            id={`${fieldId}-status`}
            value={values.status}
            options={STATUS_OPTIONS}
            onChange={(status) => updateField("status", status)}
          />
        </div>
      </div>

      {/* Uploads */}
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

      {/* Actions */}
      <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-end">
        <Link href="/products" className={secondaryButtonClass}>
          Cancel
        </Link>
        <button type="submit" disabled={submitting} className={primaryButtonClass}>
          {submitting ? "Saving…" : product ? "Save changes" : "Save product"}
        </button>
      </div>
    </form>
  );
}
