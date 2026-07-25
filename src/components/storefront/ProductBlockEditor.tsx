"use client";

import { useId, useState } from "react";
import { Image as ImageIcon, Trash2 } from "lucide-react";
import type { Product } from "@/types/product";
import type { ProductBlock } from "@/types/storefront";
import type { ActionError } from "@/lib/errors";
import { formatPrice } from "@/lib/format";
import { updateProduct } from "@/lib/products/actions";
import {
  PRICE_CENTS_MAX,
  type ProductWriteInput,
} from "@/lib/validation/product";
import { cn } from "@/lib/utils";
import { ActionErrorNotice } from "@/components/ui/ActionErrorNotice";
import {
  destructiveButtonClass,
  errorTextClass,
  fieldBaseClass,
  helpTextClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/control-styles";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";

/** Decimal input string -> integer cents, or null when not a finite number. */
function centsOf(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/**
 * Inspector card body for a PRODUCT block in the side panel. Block-level
 * settings (sold-out, remove) patch immediately like the other block editors.
 * The catalog facts (name, price) edit the PRODUCT itself, so they get a
 * draft + explicit save with a confirmation modal, since the change lands on every
 * storefront, checkout, and the product list, not just this grid.
 */
export function ProductBlockEditor({
  block,
  product,
  onToggleSoldOut,
  onRemove,
  onProductSaved,
}: {
  block: ProductBlock;
  product: Product | null;
  onToggleSoldOut: () => void;
  onRemove: () => void;
  onProductSaved: (product: Product) => void;
}) {
  const fieldId = useId();
  const [draftTitle, setDraftTitle] = useState(product?.title ?? "");
  const [draftPrice, setDraftPrice] = useState(
    product ? String(product.price) : "",
  );
  const [errors, setErrors] = useState<{ title?: string; price?: string }>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [submitError, setSubmitError] = useState<ActionError | null>(null);

  // Null product: catalog entry was deleted; only offer a remove action.
  if (product === null) {
    return (
      <div className="space-y-4">
        <p className="font-inter text-sm text-destructive">
          This product was removed from your catalog.
        </p>
        <button
          type="button"
          onClick={onRemove}
          className={destructiveButtonClass + " w-full"}
        >
          <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
          Remove from grid
        </button>
      </div>
    );
  }

  const trimmedTitle = draftTitle.trim();
  const draftCents = centsOf(draftPrice);
  const titleChanged = trimmedTitle !== product.title;
  const priceChanged = draftCents !== Math.round(product.price * 100);
  const dirty = titleChanged || priceChanged;

  function editField(field: "title" | "price", value: string) {
    if (field === "title") setDraftTitle(value);
    else setDraftPrice(value);
    setSaved(false);
    setSubmitError(null);
    setErrors((current) =>
      current[field] ? { ...current, [field]: undefined } : current,
    );
  }

  // Same rules as ProductForm: UX feedback only; the server re-validates.
  function handleSaveClick() {
    const nextErrors: { title?: string; price?: string } = {};
    if (!trimmedTitle) nextErrors.title = "Give your product a title.";
    const trimmedPrice = draftPrice.trim();
    const priceNumber = Number(trimmedPrice);
    if (!trimmedPrice) {
      nextErrors.price = "Set a price.";
    } else if (!Number.isFinite(priceNumber) || priceNumber <= 0) {
      nextErrors.price = "Price must be a number greater than zero.";
    } else if (Math.round(priceNumber * 100) > PRICE_CENTS_MAX) {
      nextErrors.price = "That price is too high.";
    }
    setErrors(nextErrors);
    if (nextErrors.title || nextErrors.price) return;
    setConfirmOpen(true);
  }

  async function confirmSave() {
    // Re-check product: function declarations hoist above the early return,
    // so the null narrowing doesn't reach this closure.
    if (product === null || draftCents === null) return;
    setSaving(true);
    setSubmitError(null);
    // Full write payload: pass the stored values through for everything the
    // panel doesn't edit. Omitted keys (image/file/stock) mean "keep as is".
    const input: ProductWriteInput = {
      title: trimmedTitle,
      description: product.description,
      priceCents: draftCents,
      currency: product.currency,
      status: product.status,
    };
    const result = await updateProduct(product.id, input);
    setSaving(false);
    setConfirmOpen(false);
    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }
    const price = draftCents / 100;
    setDraftTitle(trimmedTitle);
    setDraftPrice(String(price));
    setSaved(true);
    onProductSaved({ ...product, title: trimmedTitle, price });
  }

  // Stock status line: display-only, independent from the manual sold-out flag.
  let stockLine: string | null = null;
  if (product.trackStock) {
    if (product.stockQuantity === 0) {
      stockLine = "Out of stock in inventory (0 on hand).";
    } else if (
      product.stockQuantity !== null &&
      product.stockQuantity <= product.lowStockThreshold
    ) {
      stockLine = `Low stock: ${product.stockQuantity} on hand.`;
    } else if (product.stockQuantity !== null) {
      stockLine = `${product.stockQuantity} in stock.`;
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary row: thumbnail + the stored (saved) title and price */}
      <div className="flex items-center gap-3">
        <div className="size-12 shrink-0 overflow-hidden rounded-sm bg-muted">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL with query params; next/image adds no value here.
            <img
              src={product.imageUrl}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <ImageIcon
                className="size-4 text-muted-foreground"
                strokeWidth={2}
                aria-hidden="true"
              />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {product.title}
          </p>
          <p className="font-inter text-xs text-muted-foreground">
            {formatPrice(product.price, product.currency)}
          </p>
        </div>
      </div>

      {/* Catalog facts: edit the product itself (saved via confirmation) */}
      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-title`} className={labelClass}>
          Name
        </label>
        <input
          id={`${fieldId}-title`}
          value={draftTitle}
          maxLength={200}
          disabled={saving}
          aria-invalid={errors.title ? true : undefined}
          onChange={(event) => editField("title", event.target.value)}
          className={cn(fieldBaseClass, "text-sm")}
        />
        {errors.title && <p className={errorTextClass}>{errors.title}</p>}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${fieldId}-price`} className={labelClass}>
          Price ({product.currency})
        </label>
        <input
          id={`${fieldId}-price`}
          value={draftPrice}
          inputMode="decimal"
          disabled={saving}
          aria-invalid={errors.price ? true : undefined}
          onChange={(event) => editField("price", event.target.value)}
          className={cn(fieldBaseClass, "text-sm")}
        />
        {errors.price && <p className={errorTextClass}>{errors.price}</p>}
        <p className={helpTextClass}>
          Name and price belong to the product, so saving updates them
          everywhere it appears, not just this storefront.
        </p>
      </div>

      {submitError && <ActionErrorNotice error={submitError} variant="inline" />}
      {saved && !dirty && (
        <p role="status" className={helpTextClass}>
          Product updated everywhere.
        </p>
      )}
      {dirty && (
        <button
          type="button"
          onClick={handleSaveClick}
          disabled={saving}
          className={primaryButtonClass + " w-full"}
        >
          {saving ? "Updating…" : "Save product…"}
        </button>
      )}

      {/* Sold-out toggle */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`${fieldId}-soldout`} className={labelClass}>
            Mark as sold out
          </label>
          <Switch
            id={`${fieldId}-soldout`}
            checked={block.soldOut === true}
            onCheckedChange={onToggleSoldOut}
          />
        </div>
        <p className={helpTextClass}>
          The sold-out badge follows the Cards section setting.
        </p>
      </div>

      {/* Inventory hint (display-only, only when stock tracking is on) */}
      {stockLine !== null && (
        <p className="font-inter text-xs text-muted-foreground">{stockLine}</p>
      )}

      {/* Remove action */}
      <button
        type="button"
        onClick={onRemove}
        className={destructiveButtonClass + " w-full"}
      >
        <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
        Remove from grid
      </button>

      <Modal
        open={confirmOpen}
        onClose={() => {
          if (!saving) setConfirmOpen(false);
        }}
        title="Update product everywhere?"
        description="This edits the product itself. Every storefront, checkout link, and your product catalog will show the new details, not just this grid."
      >
        <div className="space-y-4">
          <ul className="space-y-1 font-inter text-sm text-neutral-600">
            {titleChanged && (
              <li>
                Name: <span className="line-through">{product.title}</span>{" "}
                <span className="font-medium text-neutral-900">
                  {trimmedTitle}
                </span>
              </li>
            )}
            {priceChanged && draftCents !== null && (
              <li>
                Price:{" "}
                <span className="line-through">
                  {formatPrice(product.price, product.currency)}
                </span>{" "}
                <span className="font-medium text-neutral-900">
                  {formatPrice(draftCents / 100, product.currency)}
                </span>
              </li>
            )}
          </ul>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={saving}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmSave}
              disabled={saving}
              className={primaryButtonClass}
            >
              {saving ? "Updating…" : "Update everywhere"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
