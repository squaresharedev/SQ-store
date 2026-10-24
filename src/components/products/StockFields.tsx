"use client";

import { useId } from "react";
import { Boxes, Hash, Infinity as InfinityIcon, Minus, Plus, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { ChoiceCards } from "@/components/ui/ChoiceCards";
import { Disclosure } from "@/components/ui/Disclosure";
import { HeroMark } from "@/components/ui/HeroMark";
import {
  errorTextClass,
  fieldBaseClass,
  labelClass,
  stepperButtonClass,
  stepperFieldClass,
} from "@/components/ui/control-styles";
import { RequiredMark } from "@/components/ui/RequiredMark";
import {
  LOW_STOCK_THRESHOLD_DEFAULT,
  MAX_PER_ORDER_DEFAULT,
  PURCHASE_QUANTITY_MAX,
  STOCK_QUANTITY_MAX,
} from "@/lib/validation/product";

type StockMode = "unlimited" | "counted";

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
  const t = useTranslations("Products.stockFields");
  const fieldId = useId();

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

  // Open from the start whenever a number in the fold is not the one it
  // starts on, or is wrong: nothing the seller set is ever hidden from them.
  const fineTuneOpen =
    Boolean(errors.lowStockThreshold || errors.maxPerOrder) ||
    values.maxPerOrder.trim() !== String(MAX_PER_ORDER_DEFAULT) ||
    (values.trackStock && values.lowStockThreshold.trim() !== String(LOW_STOCK_THRESHOLD_DEFAULT));

  function stepQuantity(delta: 1 | -1) {
    const next = Math.max(
      0,
      Math.min(STOCK_QUANTITY_MAX, currentQuantity + delta),
    );
    onChange("stockQuantity", String(next));
  }

  return (
    <div className="space-y-4">
      {/* TWO PICTURES, NOT A SWITCH. "Track stock: off" asked the seller to
          work out what off means; the tiles say both answers outright, and
          the common one (nothing to count) is already chosen. No "?" on the
          fields below: the Stock heading's own "?" explains all of them. */}
      <ChoiceCards<StockMode>
        name={`${fieldId}-stock-mode`}
        legend={t("trackStock")}
        legendHidden
        variant="tiles"
        columns={2}
        value={values.trackStock ? "counted" : "unlimited"}
        onChange={(mode) => onChange("trackStock", mode === "counted")}
        fieldsetData={{
          "data-product-field": "trackStock",
          "data-product-value": values.trackStock ? "true" : "false",
        }}
        options={[
          {
            value: "unlimited",
            label: t("unlimited"),
            hint: t("unlimitedHint"),
            icon: <HeroMark icon={InfinityIcon} />,
          },
          {
            value: "counted",
            label: t("counted"),
            hint: t("countedHint"),
            icon: <HeroMark icon={Boxes} badge={Hash} />,
          },
        ]}
      />

      {/* Quantity fields — only rendered when tracking is on */}
      {values.trackStock && (
        <div className="space-y-4 pt-1">
          {/* In stock */}
          <div className="space-y-1.5">
            <div className="flex items-center">
              <label htmlFor={stockQtyId} className={labelClass}>
                {t("inStock")}
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
                aria-label={t("decrease")}
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
                aria-label={t("increase")}
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
        </div>
      )}

      {/* THE FINE PRINT, FOLDED. Both numbers start on a sensible answer
          (an alert at a handful left, a per-order cap shoppers never hit), so
          most sellers never need to see them; a changed or refused one keeps
          the fold open. */}
      <Disclosure
        icon={SlidersHorizontal}
        open={fineTuneOpen}
        className="border-t border-border pt-4"
        attributes={{ "data-stock-fine-tune": "" }}
        summary={
          <span className="font-inter text-sm text-muted-foreground">
            {values.trackStock ? t("fineTuneTracked") : t("fineTune")}
          </span>
        }
      >
        <div className="space-y-4 pt-2">
          {/* Low-stock threshold: only a counted shelf can run low. */}
          {values.trackStock && (
            <div className="space-y-1.5 sm:max-w-xs">
              <label htmlFor={thresholdId} className={labelClass}>
                {t("lowStockAlert")}
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
          )}
          {/* OUTSIDE the tracking condition, deliberately. A per-order limit
              is not a fact about the shelf: an unlimited, made-to-order or
              digital product still has a number of them a seller is willing to
              sell in one go, and hiding this behind counting would mean the
              only way to cap an order is to count inventory you do not count. */}
          <div className="space-y-1.5 sm:max-w-xs">
            <label htmlFor={maxPerOrderId} className={labelClass}>
              {t("maxPerOrder")}
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
                {t("maxPerOrderHint", { max: PURCHASE_QUANTITY_MAX })}
              </p>
            )}
          </div>
        </div>
      </Disclosure>
    </div>
  );
}
