"use client";

import type { StorefrontHeader, StorefrontTheme } from "@/types/storefront";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ThemePanel } from "./ThemePanel";
import { HeaderSection } from "./HeaderSection";
import { CardsSection } from "./CardsSection";
import { PriceTagSection } from "./PriceTagSection";
import { LayoutSection } from "./LayoutSection";
import { TypographySection } from "./TypographySection";
import { AdvancedSection } from "./AdvancedSection";

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
  backgroundImageUrl,
  onBackgroundImageChange,
  customFontUrl,
  onCustomFontUrlChange,
  showGrid,
  onShowGridChange,
  onCanvasChange,
}: {
  theme: StorefrontTheme;
  header: StorefrontHeader;
  onThemeChange: (theme: StorefrontTheme) => void;
  onHeaderChange: (header: StorefrontHeader) => void;
  /** Canvas resize, guarded against cutting off placed blocks. */
  onCanvasChange: (columns: number, rows: number) => void;
  /** Display URL for an image background (signed or local object URL). */
  backgroundImageUrl: string | null;
  onBackgroundImageChange: (url: string | null) => void;
  /** Display URL for the uploaded font (signed or local object URL). */
  customFontUrl: string | null;
  onCustomFontUrlChange: (url: string | null) => void;
  /** Editor-only view preference, not part of the saved config. */
  showGrid: boolean;
  onShowGridChange: (show: boolean) => void;
}) {
  return (
    // No gaps: the sections are flush and read as one column, divided by the
    // lines they draw themselves.
    <div>
      <CollapsibleSection title="Theme" collapsible>
        <ThemePanel
          theme={theme}
          onChange={onThemeChange}
          backgroundImageUrl={backgroundImageUrl}
          onBackgroundImageChange={onBackgroundImageChange}
          showGrid={showGrid}
          onShowGridChange={onShowGridChange}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Header" collapsible defaultOpen={false}>
        <HeaderSection
          header={header}
          onChange={onHeaderChange}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Cards" collapsible defaultOpen={false}>
        <CardsSection theme={theme} onChange={onThemeChange} />
      </CollapsibleSection>

      {/* Its own section rather than a corner of Cards: the price tag carries
          seven settings of its own, which buried the four that shape a card. */}
      <CollapsibleSection title="Price tag" collapsible defaultOpen={false}>
        <PriceTagSection theme={theme} onChange={onThemeChange} />
      </CollapsibleSection>

      <CollapsibleSection title="Layout" collapsible defaultOpen={false}>
        <LayoutSection
          theme={theme}
          onChange={onThemeChange}
          onCanvasChange={onCanvasChange}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Typography" collapsible defaultOpen={false}>
        <TypographySection
          theme={theme}
          onChange={onThemeChange}
          fontUrl={customFontUrl}
          onFontUrlChange={onCustomFontUrlChange}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Advanced" collapsible defaultOpen={false}>
        <AdvancedSection theme={theme} onChange={onThemeChange} />
      </CollapsibleSection>
    </div>
  );
}
