"use client";

import { useId } from "react";
import { Minus, Plus } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  errorTextClass,
  fieldBaseClass,
  helpTextClass,
  iconButtonClass,
  labelClass,
} from "@/components/ui/control-styles";
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
  const thresholdHintId = `${fieldId}-threshold-hint`;

  function stepQuantity(delta: 1 | -1) {
    const parsed = parseInt(values.stockQuantity, 10);
    const current = Number.isFinite(parsed) ? parsed : 0;
    const next = Math.max(0, Math.min(STOCK_QUANTITY_MAX, current + delta));
    onChange("stockQuantity", String(next));
  }

  return (
    <div className="space-y-4">
      {/* Track stock toggle */}
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={switchId} className={labelClass}>
          Track stock
        </label>
        <Switch
          id={switchId}
          checked={values.trackStock}
          onCheckedChange={(checked) => onChange("trackStock", checked)}
        />
      </div>
      <p className={helpTextClass}>
        Off = unlimited. Turn on to show sold-out and low-stock badges and stop
        overselling.
      </p>

      {/* Quantity fields — only rendered when tracking is on */}
      {values.trackStock && (
        <div className="space-y-4 pt-1">
          {/* In stock */}
          <div className="space-y-1.5">
            <label htmlFor={stockQtyId} className={labelClass}>
              In stock
            </label>
            <div className="flex items-stretch gap-0 sm:max-w-xs">
              <button
                type="button"
                aria-label="Decrease stock"
                onClick={() => stepQuantity(-1)}
                className={iconButtonClass}
              >
                <Minus className="size-4" aria-hidden="true" />
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
                className={`${fieldBaseClass} rounded-none text-center`}
              />
              <button
                type="button"
                aria-label="Increase stock"
                onClick={() => stepQuantity(1)}
                className={iconButtonClass}
              >
                <Plus className="size-4" aria-hidden="true" />
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
              Low-stock alert at{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
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
              aria-describedby={
                errors.lowStockThreshold
                  ? `${thresholdErrorId} ${thresholdHintId}`
                  : thresholdHintId
              }
              className={fieldBaseClass}
            />
            <p id={thresholdHintId} className={helpTextClass}>
              Shows &quot;Only N left&quot; at or below this number.
            </p>
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
