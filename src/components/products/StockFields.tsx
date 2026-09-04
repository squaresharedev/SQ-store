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
import { InfoTip } from "@/components/ui/InfoTip";
import { STOCK_QUANTITY_MAX } from "@/lib/validation/product";

export interface StockFieldValues {
  trackStock: boolean;
  stockQuantity: string;
  lowStockThreshold: string;
}

export interface StockFieldErrors {
  stockQuantity?: string;
  lowStockThreshold?: string;
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
        <div className="flex items-center gap-1.5">
          <label htmlFor={switchId} className={labelClass}>
            Track stock
          </label>
          <InfoTip label="What tracking stock does">
            Off, this product is unlimited. On, buyers see sold-out and
            low-stock badges and cannot order more than you have.
          </InfoTip>
        </div>
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
            <label htmlFor={stockQtyId} className={labelClass}>
              In stock
            </label>
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
                placeholder="0"
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
            <div className="flex items-center gap-1.5">
              <label htmlFor={thresholdId} className={labelClass}>
                Low-stock alert at
              </label>
              <InfoTip label="What the low-stock alert does">
                At or below this number the product page shows
                &quot;Only N left&quot;. Leave it blank for no badge.
              </InfoTip>
            </div>
            <input
              id={thresholdId}
              type="text"
              inputMode="numeric"
              value={values.lowStockThreshold}
              onChange={(event) =>
                onChange("lowStockThreshold", event.target.value)
              }
              placeholder="5"
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
    </div>
  );
}
