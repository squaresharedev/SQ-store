"use client";

import { useId } from "react";
import {
  CARD_STYLES,
  PRICE_DISPLAYS,
  PRICE_TAG_CORNERS,
  resolvePriceTagCorner,
  type CardShape,
  type CardStyle,
  type PriceDisplay,
  type PriceTagCorner,
  type PriceTagSize,
  type PriceTagStyle,
  type StorefrontTheme,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import { Select, type SelectOption } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { labelClass } from "@/components/ui/control-styles";

const CARD_SHAPE_OPTIONS: readonly { value: CardShape; label: string }[] = [
  { value: "square", label: "Square" },
  { value: "rounded", label: "Rounded" },
  { value: "circle", label: "Circle" },
];

const CARD_STYLE_OPTIONS: readonly SelectOption<CardStyle>[] = CARD_STYLES.map(
  (style) => ({
    value: style,
    label: {
      standard: "Standard",
      overlay: "Overlay",
      minimal: "Minimal",
    }[style],
    description: {
      standard: "Title and price under the image",
      overlay: "Title and price over the image",
      minimal: "Image only, details on hover",
    }[style],
  }),
);

const PRICE_DISPLAY_OPTIONS: readonly SelectOption<PriceDisplay>[] =
  PRICE_DISPLAYS.map((display) => ({
    value: display,
    label: {
      always: "Always visible",
      hover: "Show on hover",
      never: "Hidden",
    }[display],
  }));

/** What the position control offers. The legacy stored value "corner" is
 *  presented as "On image" (it was always just a floated tag pinned top-right);
 *  picking anything re-saves it in the new explicit shape. */
type PriceTagPlacement = "below" | "onImage" | "hidden";

const PRICE_TAG_PLACEMENT_OPTIONS: readonly {
  value: PriceTagPlacement;
  label: string;
}[] = [
  { value: "below", label: "Below" },
  { value: "onImage", label: "On image" },
  { value: "hidden", label: "Hidden" },
];

const PRICE_TAG_STYLE_OPTIONS: readonly { value: PriceTagStyle; label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "pill", label: "Pill" },
];

const PRICE_TAG_SIZE_OPTIONS: readonly { value: PriceTagSize; label: string }[] = [
  { value: "sm", label: "S" },
  { value: "md", label: "M" },
  { value: "lg", label: "L" },
];

const CORNER_LABELS: Record<PriceTagCorner, string> = {
  topLeft: "Top left",
  topRight: "Top right",
  bottomLeft: "Bottom left",
  bottomRight: "Bottom right",
};

/** Where each corner's mini-chip sits inside the preview square. */
const CORNER_PREVIEW_CLASSES: Record<PriceTagCorner, string> = {
  topLeft: "left-1.5 top-1.5",
  topRight: "right-1.5 top-1.5",
  bottomLeft: "bottom-1.5 left-1.5",
  bottomRight: "bottom-1.5 right-1.5",
};

/**
 * Visual corner picker: a mini product-card outline with a clickable price
 * chip in each corner. Radio semantics — exactly one corner is active.
 */
function CornerPicker({
  value,
  onChange,
}: {
  value: PriceTagCorner;
  onChange: (corner: PriceTagCorner) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Price tag corner"
      className="relative aspect-[4/3] w-28 rounded-sm border border-border bg-muted"
    >
      {PRICE_TAG_CORNERS.map((corner) => {
        const active = corner === value;
        return (
          <button
            key={corner}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={CORNER_LABELS[corner]}
            onClick={() => onChange(corner)}
            className={cn(
              "absolute h-4 w-7 rounded-sm border transition-colors duration-180 ease-in-out motion-reduce:transition-none",
              CORNER_PREVIEW_CLASSES[corner],
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              active
                ? "border-primary bg-primary"
                : "border-border bg-background hover:border-ring",
            )}
          />
        );
      })}
    </div>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
    </div>
  );
}

/** Card appearance controls: shape, style, title toggle, price display and tag. */
export function CardsSection({
  theme,
  onChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
}) {
  const fieldId = useId();

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className={labelClass}>Shape</span>
        <SegmentedControl
          value={theme.cardShape}
          options={CARD_SHAPE_OPTIONS}
          onChange={(cardShape) => onChange({ ...theme, cardShape })}
          ariaLabel="Card shape"
        />
      </div>

      <Field id={`${fieldId}-card-style`} label="Card style">
        <Select
          id={`${fieldId}-card-style`}
          value={theme.cardStyle}
          options={CARD_STYLE_OPTIONS}
          onChange={(cardStyle) => onChange({ ...theme, cardStyle })}
        />
      </Field>

      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${fieldId}-show-title`} className={labelClass}>
          Show title
        </label>
        <Switch
          id={`${fieldId}-show-title`}
          checked={theme.showTitle}
          onCheckedChange={(showTitle) => onChange({ ...theme, showTitle })}
        />
      </div>

      <Field id={`${fieldId}-price-display`} label="Price">
        <Select
          id={`${fieldId}-price-display`}
          value={theme.priceDisplay}
          options={PRICE_DISPLAY_OPTIONS}
          onChange={(priceDisplay) => onChange({ ...theme, priceDisplay })}
        />
      </Field>

      <div className="space-y-1.5">
        <span className={labelClass}>Price tag position</span>
        <SegmentedControl
          // Legacy "corner" reads as the floated placement it always was.
          value={
            theme.priceTagPosition === "corner"
              ? "onImage"
              : (theme.priceTagPosition as PriceTagPlacement)
          }
          options={PRICE_TAG_PLACEMENT_OPTIONS}
          onChange={(placement) =>
            onChange({
              ...theme,
              priceTagPosition: placement,
              // Switching to the floated placement pins the corner explicitly,
              // preserving what a legacy "corner" config was already showing.
              ...(placement === "onImage"
                ? { priceTagCorner: resolvePriceTagCorner(theme) }
                : {}),
            })
          }
          ariaLabel="Price tag position"
        />
      </div>

      {/* Placement details. Corner only exists for a floated tag; size applies
          anywhere the price shows (it also scales the below-the-image price). */}
      {theme.priceTagPosition !== "hidden" && (
        <div className="flex items-start justify-between gap-4">
          {(theme.priceTagPosition === "onImage" ||
            theme.priceTagPosition === "corner") && (
            <div className="space-y-1.5">
              <span className={labelClass}>Corner</span>
              <CornerPicker
                value={resolvePriceTagCorner(theme)}
                onChange={(priceTagCorner) =>
                  onChange({
                    ...theme,
                    // Normalize legacy "corner" while we're here so the stored
                    // shape is always position + explicit corner going forward.
                    priceTagPosition: "onImage",
                    priceTagCorner,
                  })
                }
              />
            </div>
          )}
          <div className="flex-1 space-y-1.5">
            <span className={labelClass}>Tag size</span>
            <SegmentedControl
              value={theme.priceTagSize ?? "md"}
              options={PRICE_TAG_SIZE_OPTIONS}
              onChange={(priceTagSize) => onChange({ ...theme, priceTagSize })}
              ariaLabel="Price tag size"
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <span className={labelClass}>Price tag style</span>
        <SegmentedControl
          value={theme.priceTagStyle}
          options={PRICE_TAG_STYLE_OPTIONS}
          onChange={(priceTagStyle) => onChange({ ...theme, priceTagStyle })}
          ariaLabel="Price tag style"
        />
      </div>

      {/* Shows the badge on blocks the seller marked sold out (the tag toggle
          on each product tile). */}
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${fieldId}-sold-out-badge`} className={labelClass}>
          Sold-out badge
        </label>
        <Switch
          id={`${fieldId}-sold-out-badge`}
          checked={theme.soldOutBadge}
          onCheckedChange={(soldOutBadge) =>
            onChange({ ...theme, soldOutBadge })
          }
        />
      </div>
    </div>
  );
}
