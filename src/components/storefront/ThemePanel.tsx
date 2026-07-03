"use client";

import { useId } from "react";
import {
  CARD_STYLES,
  PRICE_DISPLAYS,
  STOREFRONT_FONTS,
  STOREFRONT_RADII,
  type CardStyle,
  type PriceDisplay,
  type StorefrontFont,
  type StorefrontRadius,
  type StorefrontTheme,
} from "@/types/storefront";
import { ColorInput } from "@/components/ui/color-input";
import { Select, type SelectOption } from "@/components/ui/select";
import { labelClass } from "@/components/ui/control-styles";

const FONT_OPTIONS: readonly SelectOption<StorefrontFont>[] =
  STOREFRONT_FONTS.map((font) => ({
    value: font,
    label: { sans: "Sans (default)", serif: "Serif", mono: "Mono" }[font],
  }));

const RADIUS_OPTIONS: readonly SelectOption<StorefrontRadius>[] =
  STOREFRONT_RADII.map((radius) => ({
    value: radius,
    label: { none: "Square", sm: "Small", md: "Medium", lg: "Large" }[radius],
  }));

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

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
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

/** Theme controls, each bound to the schema's enums / strict hex rule. */
export function ThemePanel({
  theme,
  onChange,
}: {
  theme: StorefrontTheme;
  onChange: (theme: StorefrontTheme) => void;
}) {
  const fieldId = useId();

  return (
    <div className="space-y-4">
      <ColorInput
        id={`${fieldId}-background`}
        label="Background"
        value={theme.background}
        onChange={(background) => onChange({ ...theme, background })}
      />
      <ColorInput
        id={`${fieldId}-accent`}
        label="Accent"
        value={theme.accent}
        onChange={(accent) => onChange({ ...theme, accent })}
      />

      <Field id={`${fieldId}-font`} label="Font">
        <Select
          id={`${fieldId}-font`}
          value={theme.font}
          options={FONT_OPTIONS}
          onChange={(font) => onChange({ ...theme, font })}
        />
      </Field>

      <Field id={`${fieldId}-radius`} label="Corners">
        <Select
          id={`${fieldId}-radius`}
          value={theme.radius}
          options={RADIUS_OPTIONS}
          onChange={(radius) => onChange({ ...theme, radius })}
        />
      </Field>

      <Field id={`${fieldId}-card-style`} label="Product cards">
        <Select
          id={`${fieldId}-card-style`}
          value={theme.cardStyle}
          options={CARD_STYLE_OPTIONS}
          onChange={(cardStyle) => onChange({ ...theme, cardStyle })}
        />
      </Field>

      <Field id={`${fieldId}-price-display`} label="Price">
        <Select
          id={`${fieldId}-price-display`}
          value={theme.priceDisplay}
          options={PRICE_DISPLAY_OPTIONS}
          onChange={(priceDisplay) => onChange({ ...theme, priceDisplay })}
        />
      </Field>
    </div>
  );
}
