"use client";

import { useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { PanelTabs, panelProps } from "@/components/ui/PanelTabs";
import { useSettingTarget } from "@/lib/storefront/setting-context";
import type { SettingRef } from "@/lib/storefront/setting-ref";
import {
  INSPECTOR_CLOSE_CLASS,
  PANEL_TAB_CLASS,
  SHEET_ON_MOBILE_CLASS,
} from "./panel-chrome";
import { CANVAS_PANEL_ATTR } from "./useCanvasAnchor";

/**
 * The right-hand design column: chrome, resize handle, and the two scopes a
 * seller edits in.
 *
 * WHY TABS. The panel used to stack the selected block's editor ON TOP of every
 * global section, which put "Tile style" and "Price tag" for one tile directly
 * above the theme-wide "Cards" and "Price tag" — the same names twice in one
 * column, with nothing on screen saying which one wins. A tab is the cheapest
 * thing that says it: the label names the scope, so the two stop competing.
 *
 * The strip appears only when there IS a selection. With nothing selected there
 * is only one scope, and a tab bar offering a choice of one is furniture.
 *
 * DESKTOP ONLY. On mobile these are two bottom sheets reached by two different
 * affordances (selecting a block, and the toolbar's Design button), which
 * already separates them; a tab strip inside a sheet would offer a second way
 * to do what the sheet's own opener just did.
 *
 * Contents arrive as slots rather than as props to unpack. The inspector closes
 * over a dozen-plus mutation callbacks that live in StorefrontDesigner's own
 * scope; threading those through here would trade one long file for a component
 * with fifteen props and no clearer story.
 */

const TAB_OPTIONS = [
  { value: "selection", label: "Selection" },
  { value: "design", label: "Design" },
] as const;

type PanelTab = (typeof TAB_OPTIONS)[number]["value"];

export function DesignPanel({
  panelOpen,
  onPanelOpenChange,
  panelWidth,
  minWidth,
  maxWidth,
  onResizePointerDown,
  onResizeKeyDown,
  selectionKey,
  showInspector,
  inspectorTitle,
  onCloseInspector,
  inspectorHiddenOnMobile,
  inspector,
  settingsOpen,
  onCloseSettings,
  controls,
  layersOpen,
  layers,
}: {
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  panelWidth: number;
  minWidth: number;
  maxWidth: number;
  onResizePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Identifies the current selection so a NEW one can pull the panel back to
   *  the Selection tab. Empty string when nothing is selected. */
  selectionKey: string;
  showInspector: boolean;
  inspectorTitle: string;
  onCloseInspector: () => void;
  /** The colour sheet and the inspector share the one mobile slot; the colour
   *  sheet wins while it is open. */
  inspectorHiddenOnMobile: boolean;
  inspector: React.ReactNode;
  /** Mobile only: the global settings sheet, opened from the toolbar. */
  settingsOpen: boolean;
  onCloseSettings: () => void;
  controls: React.ReactNode;
  /** The stack, opened from either scope. It takes the WHOLE panel body rather
   *  than becoming a third tab: it is a detour off whichever scope you were in,
   *  and it comes back to it. A tab would make it a place you can sit. */
  layersOpen: boolean;
  layers: React.ReactNode;
}) {
  const [tab, setTab] = useState<PanelTab>("selection");

  // Selecting something new pulls the panel back to Selection — reaching for a
  // block is a request to see that block. Compared during render rather than in
  // an effect so the right tab paints on the first frame (the same pattern the
  // dashboard Sidebar uses to close itself on a route change).
  const [lastSelection, setLastSelection] = useState(selectionKey);
  if (selectionKey !== lastSelection) {
    setLastSelection(selectionKey);
    if (selectionKey !== "") setTab("selection");
  }

  // A setting opened by name pulls the panel to whichever side holds it. The
  // designer has already cleared the selection when the answer is the
  // storefront's copy, so the rule here is only: a per-tile setting with a
  // selection still standing means the inspector.
  const settingRef = useSettingTarget()?.activeRef ?? null;
  // Null, for the same reason ControlsPanel seeds null: a request can already
  // be standing on the very first render.
  //
  // Compared by REFERENCE — see the matching comment in ControlsPanel. The
  // opener mints a fresh object per explicit open() call, so identity (not
  // isSameSettingRef's field-by-field equality) is what tells "a new request
  // just arrived" apart from "the same standing one, re-rendering for an
  // unrelated reason." A seller who flips to Selection by hand while a
  // "cards" setting is still standing, then opens that exact setting again,
  // needs the second request to move the tab even though it names the same
  // section — comparing by value would read it as already handled.
  const [lastRef, setLastRef] = useState<SettingRef | null>(null);
  if (settingRef !== lastRef) {
    setLastRef(settingRef);
    if (settingRef) {
      setTab(
        settingRef.kind === "cards" && selectionKey !== "" ? "selection" : "design",
      );
    }
  }

  // With nothing selected there is no Selection tab to be on, so the Design
  // side is simply what the panel is.
  const showTabs = showInspector && !layersOpen;
  const onSelection = showTabs && tab === "selection";

  return (
    <>
      {/* Reopen tab, pinned to the screen edge while the panel is away. */}
      {!panelOpen && (
        <button
          type="button"
          onClick={() => onPanelOpenChange(true)}
          aria-label="Show design panel"
          title="Show design panel"
          className={cn(PANEL_TAB_CLASS, "fixed right-0")}
        >
          <ChevronRight
            className="size-4 rotate-180"
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>
      )}

      <div
        // Same as the colour panel: pressing in here does not end an in-place
        // text edit, so the selected words survive the trip.
        data-design-panel=""
        // Width only binds on lg+; on mobile the children are fixed sheets.
        style={{ "--panel-w": `${panelWidth}px` } as React.CSSProperties}
        className={cn(
          "relative shrink-0 lg:w-[var(--panel-w)] lg:border-l lg:border-border",
          !panelOpen && "lg:hidden",
        )}
      >
        {/* Drag handle straddling the border. Focusable + arrow-key resizable,
            per the ARIA separator pattern. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize design panel"
          aria-valuenow={panelWidth}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          tabIndex={0}
          onPointerDown={onResizePointerDown}
          onKeyDown={onResizeKeyDown}
          className="absolute inset-y-0 -left-1 z-20 hidden w-2 cursor-col-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:block"
        />

        {/* Collapse tab, clipped to the panel's own left edge. */}
        <button
          type="button"
          onClick={() => onPanelOpenChange(false)}
          aria-label="Hide design panel"
          title="Hide design panel"
          className={cn(PANEL_TAB_CLASS, "left-0 -translate-x-full")}
        >
          <ChevronRight className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>

        {/* No padding here: each section pads itself so the dividers can run
            the full width of the panel. */}
        <div className="contents lg:block lg:h-full lg:overflow-y-auto">
          {/* The stack takes the whole body while it is open. On mobile it is
              the same bottom sheet as everything else here, and it is the LAST
              sheet in the tree, so it lands on top of the library or colour
              sheet rather than under one — it was opened deliberately, from a
              panel, and it wins. */}
          {layersOpen && (
            <div
              {...{ [CANVAS_PANEL_ATTR]: "" }}
              className={SHEET_ON_MOBILE_CLASS}
            >
              {layers}
            </div>
          )}

          {!layersOpen && showTabs && (
            <PanelTabs
              id="design-panel"
              value={tab}
              options={TAB_OPTIONS}
              onChange={setTab}
              ariaLabel="Panel scope"
              className="hidden lg:flex"
            />
          )}

          {showInspector && (
            <div
              {...(showTabs ? panelProps("design-panel", "selection") : {})}
              // The canvas measures this to decide whether it is being covered.
              // On lg+ it is laid out beside the board and costs it nothing; as
              // a bottom sheet it lies over the board and the board gets out of
              // its way. See useCanvasAnchor.
              {...{ [CANVAS_PANEL_ATTR]: "" }}
              className={cn(
                SHEET_ON_MOBILE_CLASS,
                inspectorHiddenOnMobile && "hidden lg:block",
                !onSelection && "lg:hidden",
                // HIDDEN, not unmounted, for the trip through the stack: the
                // block editors hold drafts (a half-typed product name) that
                // a detour to the layers list has no business discarding.
                layersOpen && "hidden lg:hidden",
              )}
            >
              <CollapsibleSection
                title={inspectorTitle}
                headerAction={
                  <button
                    type="button"
                    onClick={onCloseInspector}
                    aria-label={`Close ${inspectorTitle.toLowerCase()} panel`}
                    className={INSPECTOR_CLOSE_CLASS}
                  >
                    <X className="size-4" strokeWidth={2} aria-hidden="true" />
                  </button>
                }
              >
                {inspector}
              </CollapsibleSection>
            </div>
          )}

          {/* Global settings: on lg+ this is the Design tab; on mobile it is
              its own sheet behind the toolbar's Design button. */}
          <div
            {...(showTabs ? panelProps("design-panel", "design") : {})}
            {...{ [CANVAS_PANEL_ATTR]: "" }}
            className={cn(
              settingsOpen ? SHEET_ON_MOBILE_CLASS : "hidden lg:block",
              onSelection && "lg:hidden",
              layersOpen && "hidden lg:hidden",
            )}
          >
            <div className="mb-4 flex items-center justify-between lg:hidden">
              <h2 className="text-sm font-semibold text-foreground">Design</h2>
              <button
                type="button"
                onClick={onCloseSettings}
                aria-label="Close design settings"
                className={INSPECTOR_CLOSE_CLASS}
              >
                <X className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            {controls}
          </div>
        </div>
      </div>
    </>
  );
}
