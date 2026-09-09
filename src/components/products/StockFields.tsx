"use client";

import { useId } from "react";
import { Minus, Plus } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  errorTextClass,
  fieldBaseClass,
  labelClass,
  stepperButtonClass,
  stepperFieldClass,
} from "@/components/ui/control-styles";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { PURCHASE_QUANTITY_MAX, STOCK_QUANTITY_MAX } from "@/lib/validation/product";

export interface StockFieldValues {
  trackStock: boolean;
  stockQuantity: string;
  lowStockThreshold: string;
  maxPerOrder: string;
}

export interface StockFieldErrors {
  stockQuantity?: string;
  lowStockThreshold?: string;
  maxPerOrder?: string;
}

interface Props {
  values: StockFieldValues;
  errors: StockFieldErrors;
  onChange: <K extends keyof StockFieldValues>(
    key: K,
    value: StockFieldValues[K],
  ) => void;
}

export function StockFields({ values, errors, onChange }: Props) {
  const fieldId = useId();

  const switchId = `${fieldId}-track-stock`;
  const stockQtyId = `${fieldId}-stock-qty`;
  const stockQtyErrorId = `${fieldId}-stock-qty-error`;
  const thresholdId = `${fieldId}-threshold`;
  const thresholdErrorId = `${fieldId}-threshold-error`;
  const maxPerOrderId = `${fieldId}-max-per-order`;
  const maxPerOrderErrorId = `${fieldId}-max-per-order-error`;

  // The typed value as a number. A field mid-edit can hold "" or junk, which
  // is not an error yet — it reads as 0 for stepping and for the bounds.
  const parsedQuantity = parseInt(values.stockQuantity, 10);
  const currentQuantity = Number.isFinite(parsedQuantity) ? parsedQuantity : 0;

  function stepQuantity(delta: 1 | -1) {
    const next = Math.max(
      0,
      Math.min(STOCK_QUANTITY_MAX, currentQuantity + delta),
    );
    onChange("stockQuantity", String(next));
  }

  return (
    <div className="space-y-4">
      {/* Track stock toggle */}
      <div className="flex items-center justify-between gap-3">
        {/* NO "?" ANYWHERE IN THIS SECTION'S FIELDS. The toggle and the alert
            each had one, and between them they said what the Stock heading's
            own "?" already says: three info buttons on a card with two
            controls. The heading keeps the single explanation (it now names
            the alert too); see PRODUCT_FORM_SECTIONS. */}
        <label htmlFor={switchId} className={labelClass}>
          Track stock
        </label>
        <Switch
          id={switchId}
          checked={values.trackStock}
          onCheckedChange={(checked) => onChange("trackStock", checked)}
          data-product-field="trackStock"
          data-product-value={values.trackStock ? "true" : "false"}
        />
      </div>

      {/* Quantity fields — only rendered when tracking is on */}
      {values.trackStock && (
        <div className="space-y-4 pt-1">
          {/* In stock */}
          <div className="space-y-1.5">
            <div className="flex items-center">
              <label htmlFor={stockQtyId} className={labelClass}>
                In stock
              </label>
              <RequiredMark />
            </div>
            {/* One control, three parts: the buttons and the field share a
                height and sit flush, with no gap to break them apart.
                `w-fit` rather than `inline-flex` — a <label> is inline, so an
                inline-level stepper wraps up onto the label's line. */}
            <div className="flex w-fit items-stretch">
              <button
                type="button"
                aria-label="Decrease stock"
                onClick={() => stepQuantity(-1)}
                // Nothing below zero is a real stock level, and the stepper
                // clamps there anyway — say so rather than letting the button
                // look live at the floor.
                disabled={currentQuantity <= 0}
                className={stepperButtonClass}
              >
                <Minus className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
              <input
                id={stockQtyId}
                type="text"
                inputMode="numeric"
                value={values.stockQuantity}
                onChange={(event) =>
                  onChange("stockQuantity", event.target.value)
                }
                required
                aria-invalid={errors.stockQuantity ? true : undefined}
                aria-describedby={
                  errors.stockQuantity ? stockQtyErrorId : undefined
                }
                data-product-field="stockQuantity"
                data-product-value={values.stockQuantity.trim() || undefined}
                data-product-unit="count"
                className={stepperFieldClass}
              />
              <button
                type="button"
                aria-label="Increase stock"
                onClick={() => stepQuantity(1)}
                disabled={currentQuantity >= STOCK_QUANTITY_MAX}
                className={stepperButtonClass}
              >
                <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            {errors.stockQuantity && (
              <p id={stockQtyErrorId} className={errorTextClass}>
                {errors.stockQuantity}
              </p>
            )}
          </div>

          {/* Low-stock threshold */}
          <div className="space-y-1.5 sm:max-w-xs">
            <label htmlFor={thresholdId} className={labelClass}>
              Low-stock alert at
            </label>
            <input
              id={thresholdId}
              type="text"
              inputMode="numeric"
              value={values.lowStockThreshold}
              onChange={(event) =>
                onChange("lowStockThreshold", event.target.value)
              }
              aria-invalid={errors.lowStockThreshold ? true : undefined}
              aria-describedby={errors.lowStockThreshold ? thresholdErrorId : undefined}
              data-product-field="lowStockThreshold"
              data-product-value={values.lowStockThreshold.trim() || undefined}
              data-product-unit="count"
              className={fieldBaseClass}
            />
            {errors.lowStockThreshold && (
              <p id={thresholdErrorId} className={errorTextClass}>
                {errors.lowStockThreshold}
              </p>
            )}
          </div>
        </div>
      )}

      {/* OUTSIDE the tracking block, deliberately. A per-order limit is not a
          fact about the shelf: an unlimited, made-to-order or digital product
          still has a number of them a seller is willing to sell in one go, and
          hiding this behind Track stock would mean the only way to cap an
          order is to start counting inventory you do not count. */}
      <div className="space-y-1.5 border-t border-border pt-4 sm:max-w-xs">
        <label htmlFor={maxPerOrderId} className={labelClass}>
          Maximum per order
        </label>
        <input
          id={maxPerOrderId}
          type="text"
          inputMode="numeric"
          value={values.maxPerOrder}
          onChange={(event) => onChange("maxPerOrder", event.target.value)}
          aria-invalid={errors.maxPerOrder ? true : undefined}
          aria-describedby={
            errors.maxPerOrder ? maxPerOrderErrorId : `${maxPerOrderId}-hint`
          }
          data-product-field="maxPerOrder"
          data-product-value={values.maxPerOrder.trim() || undefined}
          data-product-unit="count"
          className={fieldBaseClass}
        />
        {errors.maxPerOrder ? (
          <p id={maxPerOrderErrorId} className={errorTextClass}>
            {errors.maxPerOrder}
          </p>
        ) : (
          <p id={`${maxPerOrderId}-hint`} className="font-inter text-xs text-muted-foreground">
            How many one buyer can take at once. Buyers pick from a list that
            stops here, and the limit is checked again when they order. Up to{" "}
            {PURCHASE_QUANTITY_MAX}; 1 sells them one at a time.
          </p>
        )}
      </div>
    </div>
  );
}
