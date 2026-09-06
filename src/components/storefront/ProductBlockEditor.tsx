"use client";

import { useId, useState } from "react";
import { ArrowRight, Image as ImageIcon, Trash2 } from "lucide-react";
import type { Product } from "@/types/product";
import {
  blockKey,
  resolveCardStyle,
  type CardStyleOverrides,
  type ProductBlock,
  type StorefrontTheme,
} from "@/types/storefront";
import { formatPrice } from "@/lib/format";
import { updateProduct } from "@/lib/products/actions";
import {
  PRICE_CENTS_MAX,
  type ProductWriteInput,
} from "@/lib/validation/product";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";
import { destructiveButtonClass, errorTextClass, fieldBaseClass, ghostButtonClass, infoTextClass, labelClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useSettingTarget } from "@/lib/storefront/setting-context";
import { InfoTip } from "@/components/ui/InfoTip";
import { Modal } from "@/components/ui/modal";
import { CardStyleControls } from "./CardStyleControls";
import { PriceTagControls } from "./PriceTagControls";

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
 * settings (tile style, remove) patch immediately like the other
 * block editors. The tile-style controls are the same CardStyleControls the
 * theme's Cards section uses, working on this block's overrides: they show
 * the RESOLVED style (theme + overrides) and each edit stores only the field
 * that changed, so untouched fields keep following the theme.
 * The catalog facts (name, price) edit the PRODUCT itself, so they get a
 * draft + explicit save with a confirmation modal, since the change lands on every
 * storefront, checkout, and the product list, not just this grid.
 */
export function ProductBlockEditor({
  block,
  theme,
  product,
  onStyleChange,
  onStyleReset,
  onRemove,
  onProductSaved,
  onDesignPage,
  pageOpen = false,
}: {
  block: ProductBlock;
  theme: StorefrontTheme;
  product: Product | null;
  /** Merge a card-style patch into this block's overrides. */
  onStyleChange: (patch: CardStyleOverrides) => void;
  /** Drop every override so the tile follows the theme again. */
  onStyleReset: () => void;
  onRemove: () => void;
  onProductSaved: (product: Product) => void;
  /** Put this product's page on the canvas beside the board (or take it away
   *  again). Absent (the dev gallery, a test) drops the row rather than a
   *  dead one. */
  onDesignPage?: () => void;
  /** True while that page is already out. */
  pageOpen?: boolean;
}) {
  const fieldId = useId();
  const [draftTitle, setDraftTitle] = useState(product?.title ?? "");
  const [draftPrice, setDraftPrice] = useState(
    product ? String(product.price) : "",
  );
  const [errors, setErrors] = useState<{ title?: string; price?: string }>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  // A setting opened by name lands HERE rather than on the theme's copy when a
  // tile is selected, because the seller asking about "price position" with a
  // tile in front of them means that tile's price. StorefrontDesigner decides
  // which scope wins; this only has to know which half to flash.
  const settingRef = useSettingTarget()?.activeRef ?? null;
  const summoned = settingRef?.kind === "cards" ? settingRef.section : null;

  // Null product: catalog entry was deleted; only offer a remove action.
  if (product === null) {
    return (
      <div className="space-y-4">
        <p className={errorTextClass}>
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
  const hasStyleOverrides =
    block.style !== undefined && Object.keys(block.style).length > 0;

  function editField(field: "title" | "price", value: string) {
    if (field === "title") setDraftTitle(value);
    else setDraftPrice(value);
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
      toast.error(result.error.message, { lines: [result.error.fix] });
      return;
    }
    const price = draftCents / 100;
    setDraftTitle(trimmedTitle);
    setDraftPrice(String(price));
    onProductSaved({ ...product, title: trimmedTitle, price });
    // This write reaches past the storefront being designed, so the
    // confirmation says so rather than leaving the seller to wonder whether
    // they just renamed one tile.
    toast.success(`"${trimmedTitle}" was updated everywhere it appears.`);
  }

  // Stock status line: display-only. The designer REPORTS availability and
  // never sets it — that lives on the product, in Products > Stock.
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
              draggable={false}
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
          <p className={infoTextClass}>
            {formatPrice(product.price, product.currency)}
          </p>
        </div>
      </div>

      {/* Catalog facts: edit the product itself (saved via confirmation) */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label htmlFor={`${fieldId}-title`} className={labelClass}>
            Name
          </label>
          <InfoTip label="Where a name or price change lands">
            Name and price belong to the product, so saving updates them
            everywhere it appears, not just this storefront.
          </InfoTip>
        </div>
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
      </div>

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

      {/* Availability, read-only. The switch that used to sit here belonged to
          the TILE, which made "is this sold out" a question with a different
          answer on every storefront the product appears in. Availability is a
          fact about the product, so it is edited once in Products (Stock), and
          the designer only reports it. */}
      {stockLine !== null && (
        <p className={infoTextClass}>{stockLine}</p>
      )}

      {/* Where a tap on this tile lands. The page is designed once for the
          whole storefront, so this only turns the editor towards it with this
          product in the preview. */}
      {onDesignPage && (
        <button
          type="button"
          onClick={onDesignPage}
          aria-pressed={pageOpen}
          data-product-page-row=""
          className={cn(primaryButtonClass, "w-full")}
        >
          {pageOpen ? "Hide product page" : "Open product page"}
          <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      )}

      {/* Per-tile style and the price tag, as collapsible groups rather than
          two slabs divided by a rule: between them they are a dozen controls,
          and the product's own name and price were being pushed off the top of
          the panel by settings most tiles never override. Values shown are the
          resolved style, so opening a group on an untouched tile simply shows
          the theme.

          Both are collapsible and CAN be open together on purpose: the corner
          roundness in one decides which spots the price tag in the other is
          allowed to take (see PriceTagControls), so they have to be readable
          side by side. */}
      <div className="-mx-4 border-t border-border">
        <CollapsibleSection
          title="Tile style"
          collapsible
          defaultOpen={false}
          summon={summoned === "cardStyle"}
          headerAction={
            <div className="flex items-center gap-1.5">
              {hasStyleOverrides && (
                <button
                  type="button"
                  onClick={onStyleReset}
                  className={cn(ghostButtonClass, "px-2 py-1 text-xs")}
                >
                  Reset to theme
                </button>
              )}
              <InfoTip label="How this tile's style relates to the theme">
                {hasStyleOverrides
                  ? "This tile has its own style. Settings you have not changed here keep following the theme."
                  : "Style this tile on its own. Anything you do not change keeps following the theme."}
              </InfoTip>
            </div>
          }
        >
          <CardStyleControls
            value={resolveCardStyle(theme, block.style)}
            onChange={onStyleChange}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title="Price tag"
          collapsible
          defaultOpen={false}
          summon={summoned === "priceTag"}
        >
          <PriceTagControls
            theme={theme}
            overrides={block.style ?? {}}
            onChange={onStyleChange}
            scope={{ blockKey: blockKey(block) }}
          />
        </CollapsibleSection>
      </div>

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
        // Closable even while the save is in flight: the update carries on
        // server-side and its outcome still lands as a toast either way, which
        // is what makes closing early safe. Blocking ESC and the backdrop
        // while `saving` turned a hung request into a trapped user.
        onClose={() => {
          setConfirmOpen(false);
        }}
        title="Update product everywhere?"
        description="This edits the product itself. Every storefront, checkout link, and your product catalog will show the new details, not just this grid."
      >
        <div className="space-y-4">
          <ul className="space-y-1 font-inter text-sm text-muted-foreground">
            {titleChanged && (
              <li>
                Name: <span className="line-through">{product.title}</span>{" "}
                <span className="font-medium text-foreground">
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
                <span className="font-medium text-foreground">
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
