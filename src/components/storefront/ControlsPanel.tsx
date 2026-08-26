"use client";

import { useState } from "react";
import type { StorefrontHeader, StorefrontTheme } from "@/types/storefront";
import {
  CONTROLS_GROUPS,
  GROUP_LABELS,
  isSameSettingRef,
  settingGroup,
  type ControlsGroup,
  type SettingRef,
} from "@/lib/storefront/setting-ref";
import { useSettingTarget } from "@/lib/storefront/setting-context";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { PanelBackRow, PanelMenu, PanelMenuItem } from "@/components/ui/PanelMenu";
import { PanelSearchField } from "./PanelSearchField";
import { FONT_LABELS } from "./config-maps";
import { ThemePanel } from "./ThemePanel";
import { HeaderSection } from "./HeaderSection";
import { CardsSection } from "./CardsSection";
import { PriceTagSection } from "./PriceTagSection";
import { LayoutSection } from "./LayoutSection";
import { TypographySection } from "./TypographySection";
import { SoldOutSection } from "./SoldOutSection";

/**
 * GLOBAL design settings, as a menu of named groups rather than one column of
 * everything.
 *
 * WHY A MENU. Seven sections stacked open-able in a 320px column meant the
 * settings that shape the whole storefront were a scroll away from each other
 * and from the block editor sitting above them. Six rows fit on screen at once,
 * so the question "where does that live" is answered by looking rather than by
 * scrolling.
 *
 * WHY ONE LEVEL. Groups whose controls constrain each other stay in the SAME
 * submenu — card roundness decides where the price tag is allowed to sit, so
 * Card style and Price tag are siblings under "Product cards", each a
 * CollapsibleSection so both can be open together. A submenu per control would
 * have made that pair four navigation steps apart.
 *
 * The rows are spelled out here rather than driven from a table: at six entries
 * a table only adds a hop between an id and the branch that renders it.
 */

// The groups, and their titles, come from the settings catalogue so the panel
// and everything that can ask the panel to open (search, the filter field)
// cannot end up with two different ideas of what a group is called.
const GROUPS = CONTROLS_GROUPS;
type Group = ControlsGroup;
const GROUP_TITLES = GROUP_LABELS;

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
  // View state, deliberately local: which group is open is not part of the
  // design, so it never reaches the undo history or the saved document.
  const [group, setGroup] = useState<Group | null>(null);

  // Something outside named a setting (universal search, or the field above
  // the menu). Navigate DURING render rather than in an effect, so the right
  // group paints on the first frame; the ref comparison is what stops it
  // firing again on every later render. Same pattern DesignPanel already uses
  // to follow a new selection.
  const setting = useSettingTarget();
  const activeRef = setting?.activeRef ?? null;
  // Seeded null so a panel that MOUNTS with a request already standing (the
  // editor opened straight from a search result elsewhere) still navigates.
  const [lastRef, setLastRef] = useState<SettingRef | null>(null);
  if (!isSameSettingRef(activeRef, lastRef)) {
    setLastRef(activeRef);
    if (activeRef) setGroup(settingGroup(activeRef));
  }

  /** Which half of Product cards a summons is pointing at, if any. */
  const summoned = activeRef?.kind === "cards" ? activeRef.section : null;

  if (group === null) {
    return (
      <PanelMenu>
        {/* With a provider (the designer) this routes through the same opener
            universal search uses, so the section is flashed as well as opened.
            Without one (the dev gallery, a test) the panel still navigates
            itself, because a filter field that did nothing would be worse. */}
        <PanelSearchField
          onPick={(ref) => {
            if (setting) setting.open(ref);
            else setGroup(settingGroup(ref));
          }}
        />
        {GROUPS.map((id) => (
          <PanelMenuItem
            key={id}
            label={GROUP_TITLES[id]}
            // Only where one value really represents the group. "Theme" has a
            // background that may be a gradient or a photo, with no single
            // thing to show, so it shows nothing.
            hint={
              id === "typography"
                ? theme.customFont && theme.font === "custom"
                  ? theme.customFont.name
                  : FONT_LABELS[theme.font]
                : undefined
            }
            onClick={() => setGroup(id)}
          />
        ))}
      </PanelMenu>
    );
  }

  return (
    <div>
      <PanelBackRow
        title={GROUP_TITLES[group]}
        path="Design"
        onBack={() => setGroup(null)}
      />

      {/* Cards is the one group with halves rather than a flat body: they are
          full-width sections drawing their own dividers, and both can be open
          at once because the roundness in one bounds the tag position in the
          other. Everything else gets the padded body below. */}
      {group === "cards" ? (
        <>
          <CollapsibleSection
            title="Card style"
            collapsible
            summon={summoned === "cardStyle"}
          >
            <CardsSection theme={theme} onChange={onThemeChange} />
          </CollapsibleSection>
          <CollapsibleSection
            title="Price tag"
            collapsible
            defaultOpen={false}
            summon={summoned === "priceTag"}
          >
            <PriceTagSection theme={theme} onChange={onThemeChange} />
          </CollapsibleSection>
        </>
      ) : (
        /* No section chrome around a single group's controls: the back row
           already names them, so a heading here would say it twice. */
        <div className="py-4 lg:px-4">
          {group === "theme" && (
            <ThemePanel
              theme={theme}
              onChange={onThemeChange}
              backgroundImageUrl={backgroundImageUrl}
              onBackgroundImageChange={onBackgroundImageChange}
            />
          )}

          {group === "header" && (
            <HeaderSection header={header} onChange={onHeaderChange} />
          )}

          {group === "typography" && (
            <TypographySection
              theme={theme}
              onChange={onThemeChange}
              fontUrl={customFontUrl}
              onFontUrlChange={onCustomFontUrlChange}
            />
          )}

          {group === "canvas" && (
            <LayoutSection
              theme={theme}
              onChange={onThemeChange}
              onCanvasChange={onCanvasChange}
              showGrid={showGrid}
              onShowGridChange={onShowGridChange}
            />
          )}

          {group === "soldOut" && (
            <SoldOutSection theme={theme} onChange={onThemeChange} />
          )}
        </div>
      )}
    </div>
  );
}
