"use client";

import { useId } from "react";
import {
  STOREFRONT_FONTS,
  type StorefrontFont,
  type StorefrontHeader,
  type StorefrontTheme,
} from "@/types/storefront";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { labelClass } from "@/components/ui/control-styles";
import { Select, type SelectOption } from "@/components/ui/select";
import { ThemePanel } from "./ThemePanel";
import { HeaderSection } from "./HeaderSection";
import { CardsSection } from "./CardsSection";
import { LayoutSection } from "./LayoutSection";
import { AdvancedSection } from "./AdvancedSection";

const FONT_OPTIONS: readonly SelectOption<StorefrontFont>[] =
  STOREFRONT_FONTS.map((font) => ({
    value: font,
    label: {
      sans: "Sans (default)",
      serif: "Serif",
      mono: "Mono",
      display: "Display",
      hand: "Handwritten",
    }[font],
  }));

/**
 * Right side panel: GLOBAL design settings only, organized for progressive
 * disclosure — Theme (the essentials) starts open; the rest starts collapsed.
 * Inserting content and editing individual blocks happen through the bottom
 * toolbar + the left inspector panel, not here.
 */
export function ControlsPanel({
  theme,
  header,
  onThemeChange,
  onHeaderChange,
}: {
  theme: StorefrontTheme;
  header: StorefrontHeader;
  onThemeChange: (theme: StorefrontTheme) => void;
  onHeaderChange: (header: StorefrontHeader) => void;
}) {
  const fontFieldId = useId();
  return (
    <div className="space-y-4">
      <CollapsibleSection title="Theme" collapsible>
        <ThemePanel theme={theme} onChange={onThemeChange} />
      </CollapsibleSection>

      <CollapsibleSection title="Header" collapsible defaultOpen={false}>
        <HeaderSection header={header} onChange={onHeaderChange} />
      </CollapsibleSection>

      <CollapsibleSection title="Cards" collapsible defaultOpen={false}>
        <CardsSection theme={theme} onChange={onThemeChange} />
      </CollapsibleSection>

      <CollapsibleSection title="Layout" collapsible defaultOpen={false}>
        <LayoutSection theme={theme} onChange={onThemeChange} />
      </CollapsibleSection>

      <CollapsibleSection title="Typography" collapsible defaultOpen={false}>
        <div className="space-y-1.5">
          <label htmlFor={`${fontFieldId}-font`} className={labelClass}>
            Font
          </label>
          <Select
            id={`${fontFieldId}-font`}
            value={theme.font}
            options={FONT_OPTIONS}
            onChange={(font) => onThemeChange({ ...theme, font })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Advanced" collapsible defaultOpen={false}>
        <AdvancedSection theme={theme} onChange={onThemeChange} />
      </CollapsibleSection>
    </div>
  );
}
