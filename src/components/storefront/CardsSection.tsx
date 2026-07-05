"use client";

import { useId } from "react";
import {
  CARD_STYLES,
  PRICE_DISPLAYS,
  PRICE_TAG_POSITIONS,
  type CardShape,
  type CardStyle,
  type PriceDisplay,
  type PriceTagPosition,
  type PriceTagStyle,
  type StorefrontTheme,
} from "@/types/storefront";
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

const PRICE_TAG_POSITION_OPTIONS: readonly SelectOption<PriceTagPosition>[] =
  PRICE_TAG_POSITIONS.map((position) => ({
    value: position,
    label: {
      below: "Below the image",
      onImage: "On the image",
      corner: "Top corner",
      hidden: "Hidden",
    }[position],
  }));

const PRICE_TAG_STYLE_OPTIONS: readonly { value: PriceTagStyle; label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "pill", label: "Pill" },
];

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

      <Field id={`${fieldId}-price-tag-position`} label="Price tag position">
        <Select
          id={`${fieldId}-price-tag-position`}
          value={theme.priceTagPosition}
          options={PRICE_TAG_POSITION_OPTIONS}
          onChange={(priceTagPosition) => onChange({ ...theme, priceTagPosition })}
        />
      </Field>

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
