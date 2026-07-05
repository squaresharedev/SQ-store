"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Boxes,
  Eye,
  ImageIcon,
  Package,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  Product,
  ProductFormValues,
  ProductStatus,
} from "@/types/product";
import { createProduct, updateProduct } from "@/lib/products/actions";
import { uploadToR2 } from "@/lib/products/upload";
import type { ProductWriteInput } from "@/lib/validation/product";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
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
    errors.title = "Give your product a title.";
  }

  const trimmedPrice = values.price.trim();
  const priceNumber = Number(trimmedPrice);
  if (!trimmedPrice) {
    errors.price = "Set a price.";
  } else if (!Number.isFinite(priceNumber) || priceNumber <= 0) {
    errors.price = "Price must be a number greater than zero.";
  }

  if (values.trackStock) {
    const trimmedQty = values.stockQuantity.trim();
    if (!trimmedQty) {
      errors.stockQuantity = "How many are in stock?";
    } else if (
      !Number.isInteger(Number(trimmedQty)) ||
      Number(trimmedQty) < 0
    ) {
      errors.stockQuantity = "Stock must be a whole number of 0 or more.";
    }
  }

  const trimmedThreshold = values.lowStockThreshold.trim();
  if (trimmedThreshold) {
    if (
      !Number.isInteger(Number(trimmedThreshold)) ||
      Number(trimmedThreshold) < 0
    ) {
      errors.lowStockThreshold = "Threshold must be a whole number of 0 or more.";
    }
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
  const statusHintId = `${fieldId}-status-hint`;
  const hasErrors = submitAttempted && Object.keys(errors).length > 0;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
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

      <FormSection
        icon={Package}
        title="Details"
        description="What you are selling, in your words."
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
        </div>
      </FormSection>

      <FormSection
        icon={Tag}
        title="Pricing"
        description="What buyers pay. You keep it minus the platform cut."
      >
        <div className="sm:max-w-sm">
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
