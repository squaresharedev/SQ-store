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
  type ProductDraftPayload,
  type ProductFormValues,
  type ProductStatus,
} from "@/types/product";
import {
  errorTextClass,
  fieldBaseClass,
  helpTextClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "./control-styles";
import { ImageDropzone } from "./ImageDropzone";
import { FileDropzone } from "./FileDropzone";

const STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "Draft, hidden from buyers",
  active: "Active, visible for sale",
};

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

// Client-side validation is for UX feedback only. It is NOT a security boundary:
// the same rules (and anything security-relevant) must be re-checked server-side
// when this is wired to a real API in a later stage.
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);

    const foundErrors = validate(values);
    setErrors(foundErrors);
    if (Object.keys(foundErrors).length > 0) return;

    const payload: ProductDraftPayload = {
      id: product?.id ?? null,
      title: values.title.trim(),
      description: values.description.trim(),
      price: Number(values.price),
      currency: values.currency,
      status: values.status,
      hasNewImage: imageFile !== null,
      imageFileName: imageFile?.name ?? null,
      hasNewDigitalFile: digitalFile !== null,
      digitalFileName: digitalFile?.name ?? product?.digitalFileName ?? null,
    };

    // UI-ONLY STAGE: no API / Supabase / R2 call here. Log the payload shape the
    // next stage will send, then return to the list.
    console.info("[products] submit payload", payload);
    router.push("/products");
  }

  const titleErrorId = `${fieldId}-title-error`;
  const priceErrorId = `${fieldId}-price-error`;
  const imageHintId = `${fieldId}-image-hint`;
  const fileHintId = `${fieldId}-file-hint`;
  const hasErrors = submitAttempted && Object.keys(errors).length > 0;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-8">
      {hasErrors && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[0.5rem] border border-destructive/40 bg-destructive/5 px-4 py-3"
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
            <select
              id={`${fieldId}-currency`}
              value={values.currency}
              onChange={(event) =>
                updateField("currency", event.target.value as Currency)
              }
              className={fieldBaseClass}
            >
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5 sm:max-w-xs">
          <label htmlFor={`${fieldId}-status`} className={labelClass}>
            Status
          </label>
          <select
            id={`${fieldId}-status`}
            value={values.status}
            onChange={(event) =>
              updateField("status", event.target.value as ProductStatus)
            }
            className={fieldBaseClass}
          >
            {PRODUCT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
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
            onFileChange={setDigitalFile}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-end">
        <Link href="/products" className={secondaryButtonClass}>
          Cancel
        </Link>
        <button type="submit" className={primaryButtonClass}>
          {product ? "Save changes" : "Save product"}
        </button>
      </div>
    </form>
  );
}
