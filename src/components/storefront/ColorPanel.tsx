"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Copy, Pipette, X } from "lucide-react";
import {
  STOREFRONT_FONTS,
  type StorefrontFont,
  type TextAlign,
} from "@/types/storefront";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { ColorArea } from "@/components/ui/ColorArea";
import { ColorDot } from "@/components/ui/ColorPicker";
import { Select, type SelectOption } from "@/components/ui/select";
import {
  errorTextClass,
  fieldBaseClass,
  focusRingClass,
  helpTextClass,
  labelClass,
  transitionClass,
} from "@/components/ui/control-styles";
import { hexToHsv, hsvToHex, type Hsv } from "@/lib/format/color";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { COLOR_PALETTES } from "@/lib/theme/color-palettes";
import { STANDARD_COLOR_ROWS } from "@/lib/theme/standard-colors";
import {
  getRecentColors,
  getRecentColorsOnServer,
  recordRecentColor,
  subscribeRecentColors,
} from "@/lib/theme/recent-colors";
import type { ResolvedColorTarget } from "@/lib/theme/color-target";
import { FONT_LABELS } from "./config-maps";
import { FontSizeField } from "./FontSizeField";
import { AlignmentToggles, FormatToggles } from "./TextFormatControls";

/**
 * The left-hand panel: one surface for choosing ANY color in the storefront.
 *
 * WHY IT IS A PANEL AND NOT A POPOVER. A standard grid, five palettes, the
 * recents and the colors already on the canvas do not fit in an overlay anchored
 * to a swatch, and an overlay that large covers the very canvas you are judging
 * the color against. Docked opposite the settings panel, the canvas stays
 * visible and every pick is seen immediately.
 *
 * It edits whatever `target` it is handed — a shape's fill, a text block's
 * color, the theme accent, a gradient stop. It does not know or care which;
 * StorefrontDesigner resolves the target and applies the result.
 *
 * The panel is built to take more than color later (imports and so on): the
 * sections are plain CollapsibleSections, so another one drops in beside them.
 */

/**
 * ONE column count for every grid in the panel, and it is load-bearing.
 *
 * `ColorDot` sizes a circle with `w-full aspect-square`, so a swatch is exactly
 * as wide as its column. Give the palettes five columns and their swatches come
 * out twice the size of the standard grid's — the same object rendered two
 * different ways in one panel, which reads as two different kinds of thing.
 * Ten everywhere: a five-colour palette simply fills the first half of its row.
 *
 * Static because Tailwind cannot see a computed `grid-cols-${n}`; the unit test
 * holds it to STANDARD_COLOR_COLUMNS.
 */
const GRID_CLASS = "grid-cols-10";

/** "Inherit" sentinel for the font select: a line that follows the canvas
 *  stores NOTHING, and the select still needs a concrete value to point at.
 *  Same trick, same reason, as TextBlockEditor's. */
const THEME_FONT = "theme";
type FontChoice = StorefrontFont | typeof THEME_FONT;

function fontOptions(hasCustomFont: boolean): SelectOption<FontChoice>[] {
  return [
    {
      value: THEME_FONT,
      label: "Theme font",
      description: "Follow the storefront font",
    },
    ...STOREFRONT_FONTS.filter(
      // Offered only once there is an upload to point at.
      (font) => font !== "custom" || hasCustomFont,
    ).map((font) => ({ value: font, label: FONT_LABELS[font] })),
  ];
}

/**
 * The type controls a field brings with it, when it has any.
 *
 * Only the masthead's two lines do today: they have no tile and no inspector
 * card of their own, so this panel is where they are styled. Everything else
 * hands the panel colors alone and it renders exactly as it always did.
 */
export type PanelTypography = {
  /** The stored size, or undefined while the line follows its default. */
  size: number | undefined;
  /** What that default renders at, for the "Auto" label. */
  autoSize: number;
  /** undefined clears the override. */
  onSizeChange: (size: number | undefined) => void;
  /** The stored typeface, or undefined while the line follows the canvas. */
  font: StorefrontFont | undefined;
  /** Whether the storefront has an uploaded face to offer as a choice. */
  hasCustomFont: boolean;
  onFontChange: (font: StorefrontFont | undefined) => void;
  /** Formatting, absent meaning off. Toggled rather than set, so the control
   *  and the shortcut cannot disagree about what the next press does. */
  bold: boolean;
  italic: boolean;
  underline: boolean;
  onFormatToggle: (key: "bold" | "italic" | "underline") => void;
  /** Alignment, absent meaning left. */
  align: TextAlign;
  onAlignChange: (align: TextAlign) => void;
};

export function ColorPanel({
  target,
  typography,
  inDesign,
  onPick,
  onInherit,
  onClose,
}: {
  /** Already resolved against live state by the designer. */
  target: ResolvedColorTarget;
  /** Type controls for fields that carry them (the masthead lines). */
  typography?: PanelTypography;
  /** Colors this storefront already uses, from collectStorefrontColors. */
  inDesign: readonly string[];
  /** Always receives strict lowercase hex. */
  onPick: (hex: string) => void;
  /** Clear the override, for targets that have one (text color). */
  onInherit?: () => void;
  onClose: () => void;
}) {
  const current = target.value.toLowerCase();
  const inheriting = target.inherit?.active ?? false;

  const recent = useSyncExternalStore(
    subscribeRecentColors,
    getRecentColors,
    getRecentColorsOnServer,
  );

  /** A deliberate one-shot pick: apply it AND remember it. Every swatch in the
   *  panel goes through here. */
  function pick(hex: string) {
    const lower = hex.toLowerCase();
    if (!isStrictHexColor(lower)) return;
    recordRecentColor(lower);
    onPick(lower);
  }

  /** Apply without remembering. For the custom section's live drag, which emits
   *  on every pointer move — recording those would bury the recents list under
   *  one gesture. It records once when the gesture ends. */
  function preview(hex: string) {
    const lower = hex.toLowerCase();
    if (isStrictHexColor(lower)) onPick(lower);
  }

  /** Ringed only when this swatch is what the target actually renders. While
   *  inheriting there is no override, so nothing is marked. */
  function isActive(hex: string) {
    return !inheriting && current === hex;
  }

  return (
    <div>
      {/* Header: what is being edited, in the color it is currently wearing. */}
      <div className="flex items-center justify-between gap-2 border-b border-border py-3 lg:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            style={{ backgroundColor: inheriting ? target.inherit!.value : current }}
            className="size-5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
          />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {target.label}
            </h2>
            <p className={cn(helpTextClass, "font-mono")}>
              {inheriting ? target.inherit!.label : current}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close color panel"
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-none text-muted-foreground",
            "hover:bg-accent hover:text-foreground",
            transitionClass,
            focusRingClass,
          )}
        >
          <X className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {/* Type first, and open: for a field whose only editor is this panel,
          size is as much "what am I doing here" as color is. */}
      {/* The masthead's lines have no tile and no inspector card, so this is
          where they get everything a text block gets from its own: typeface,
          size, formatting and alignment, through the very same controls. */}
      {typography && (
        <CollapsibleSection title="Type">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="color-panel-font" className={labelClass}>
                Font
              </label>
              <Select
                id="color-panel-font"
                value={typography.font ?? THEME_FONT}
                options={fontOptions(typography.hasCustomFont)}
                onChange={(font) =>
                  typography.onFontChange(
                    font === THEME_FONT ? undefined : font,
                  )
                }
              />
            </div>

            <FontSizeField
              id="color-panel-size"
              value={typography.size}
              autoSize={typography.autoSize}
              onChange={typography.onSizeChange}
            />

            <FormatToggles
              active={{
                bold: typography.bold,
                italic: typography.italic,
                underline: typography.underline,
              }}
              onToggle={typography.onFormatToggle}
            />

            <AlignmentToggles
              align={typography.align}
              onChange={typography.onAlignChange}
            />
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="In this design">
        {inDesign.length > 0 ? (
          <div
            role="group"
            aria-label="Colors in this design"
            className={cn("grid gap-1.5", GRID_CLASS)}
          >
            {inDesign.map((hex) => (
              <ColorDot
                key={hex}
                color={hex}
                label={`In this design (${hex})`}
                active={isActive(hex)}
                onSelect={() => pick(hex)}
              />
            ))}
          </div>
        ) : (
          <p className={helpTextClass}>
            Colors you use on the canvas collect here.
          </p>
        )}
      </CollapsibleSection>

      <CustomColorSection value={current} onPreview={preview} onCommit={pick} />

      {/* "Follow the theme" for optional colors — the same affordance the
          inline picker offers, rather than a second reset invention. */}
      {target.inherit && onInherit && (
        <CollapsibleSection title="Inherit">
          <button
            type="button"
            onClick={onInherit}
            aria-pressed={inheriting}
            className={cn(
              "flex w-full items-center gap-2 border border-border px-2 py-1.5 text-left text-sm",
              "hover:bg-accent",
              transitionClass,
              focusRingClass,
              inheriting && "ring-2 ring-ring ring-offset-1 ring-offset-background",
            )}
          >
            <span
              aria-hidden="true"
              style={{ backgroundColor: target.inherit.value }}
              className="size-4 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
            />
            <span className="min-w-0 flex-1 truncate text-foreground">
              Use {target.inherit.label}
            </span>
            {inheriting && (
              <Check className="size-4 shrink-0 text-foreground" strokeWidth={2.5} aria-hidden="true" />
            )}
          </button>
        </CollapsibleSection>
      )}

      {/* Never rendered empty: an empty labelled group is noise to a screen
          reader, and a heading over nothing reads as a bug. */}
      {recent.length > 0 && (
        <CollapsibleSection title="Recently used">
          <div
            role="group"
            aria-label="Recently used colors"
            className={cn("grid gap-1.5", GRID_CLASS)}
          >
            {recent.map((hex) => (
              <ColorDot
                key={hex}
                color={hex}
                label={`Recently used (${hex})`}
                active={isActive(hex)}
                onSelect={() => pick(hex)}
              />
            ))}
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Standard">
        {/* One grid, not three: three separate grids would let the rows fall out
            of column alignment, and the columns ARE the navigation here (each
            one is a hue family, light at the top). */}
        <div
          role="group"
          aria-label="Standard colors"
          className={cn("grid gap-1.5", GRID_CLASS)}
        >
          {STANDARD_COLOR_ROWS.flat().map((swatch) => (
            <ColorDot
              key={swatch.value}
              color={swatch.value}
              label={`${swatch.name} (${swatch.value})`}
              active={isActive(swatch.value)}
              onSelect={() => pick(swatch.value)}
            />
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Palettes">
        <div className="space-y-2.5">
          {COLOR_PALETTES.map((palette) => (
            <div key={palette.name}>
              <p className={cn(helpTextClass, "mb-1")}>{palette.name}</p>
              <div
                role="group"
                aria-label={`${palette.name} palette`}
                className={cn("grid gap-1.5", GRID_CLASS)}
              >
                {palette.colors.map((swatch) => (
                  <ColorDot
                    key={swatch.value}
                    color={swatch.value}
                    label={`${palette.name} ${swatch.name} (${swatch.value})`}
                    active={isActive(swatch.value)}
                    onSelect={() => pick(swatch.value)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleSection>

    </div>
  );
}

/**
 * The arbitrary-color escape hatch: saturation square, hue slider, hex field.
 *
 * Collapsed by default because it is the rare case — the point of the sections
 * above is that most picks never need it — and because the square is the tallest
 * thing in the panel.
 *
 * TWO callbacks, and the split matters. `onPreview` fires on every frame of a
 * drag and every valid keystroke, so the canvas follows the pointer live.
 * `onCommit` fires once when the gesture ENDS, and only that one writes to the
 * recents list. Recording per frame would bury the list under a single drag,
 * which is exactly what makes recents worthless.
 */
function CustomColorSection({
  value,
  onPreview,
  onCommit,
}: {
  value: string;
  onPreview: (hex: string) => void;
  onCommit: (hex: string) => void;
}) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 0 });
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasEyeDropper = useSyncExternalStore(
    subscribeNever,
    readEyeDropper,
    readEyeDropperOnServer,
  );

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  // Adopt outside changes (a swatch above, undo) without re-seeding from a hex
  // our own HSV already produces — re-seeding grey or black would wipe the
  // working hue, since hue is undefined there.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value);
    setInvalid(false);
    if (isStrictHexColor(value) && value.toLowerCase() !== hsvToHex(hsv)) {
      const next = hexToHsv(value);
      if (next) setHsv(preserveHue(next, hsv));
    }
  }

  function handleArea(next: Hsv) {
    setHsv(next);
    setText(hsvToHex(next));
    setInvalid(false);
    onPreview(hsvToHex(next));
  }

  function applyHex(hex: string, commit: boolean) {
    const parsed = hexToHsv(hex);
    if (!parsed) return;
    const lower = hex.toLowerCase();
    setHsv(preserveHue(parsed, hsv));
    setText(lower);
    setInvalid(false);
    (commit ? onCommit : onPreview)(lower);
  }

  async function pickFromScreen() {
    if (typeof window === "undefined" || !window.EyeDropper) return;
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      // Specified to return sRGB hex, but still an external string: re-gate it.
      const lower = sRGBHex.toLowerCase();
      // One deliberate act, not a drag: commit it.
      if (isStrictHexColor(lower)) applyHex(lower, true);
    } catch {
      // Esc, or the browser refused. Nothing to report.
    }
  }

  return (
    <CollapsibleSection title="Custom" collapsible defaultOpen={false}>
      <div className="space-y-3">
        {/* The gesture END is the commit. ColorArea emits continuously and has
            no notion of "done", so the wrapper listens for the pointer coming
            up or the key being released and records the value it landed on. */}
        <div
          onPointerUp={() => onCommit(hsvToHex(hsv))}
          onKeyUp={() => onCommit(hsvToHex(hsv))}
        >
          <ColorArea hsv={hsv} onChange={handleArea} />
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            {hasEyeDropper && (
              <button
                type="button"
                onClick={pickFromScreen}
                aria-label="Pick a color from the screen"
                title="Pick from screen"
                className={cn(
                  "inline-flex size-10 shrink-0 items-center justify-center rounded-none border border-input",
                  "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                  transitionClass,
                  focusRingClass,
                )}
              >
                <Pipette className="size-4" strokeWidth={2} aria-hidden="true" />
              </button>
            )}
            <label htmlFor="color-panel-hex" className="sr-only">
              Hex color
            </label>
            <input
              id="color-panel-hex"
              type="text"
              value={text}
              onChange={(event) => {
                const next = event.target.value;
                setText(next);
                // Live, but not a commit: every valid keystroke on the way to
                // "#ff0000" would otherwise leave five colors in recents.
                if (isStrictHexColor(next)) applyHex(next, false);
                else setInvalid(true);
              }}
              onBlur={() => {
                if (invalid) {
                  setText(value);
                  setInvalid(false);
                } else if (isStrictHexColor(text)) {
                  // Typing is finished: this is the value they meant.
                  onCommit(text);
                }
              }}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? "color-panel-hex-error" : undefined}
              placeholder="#a855f7"
              className={cn(fieldBaseClass, "h-10 rounded-none py-0 font-mono text-sm")}
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(value);
                  setCopied(true);
                } catch {
                  // Clipboard blocked (insecure context, denied). Stay quiet.
                }
              }}
              aria-label={copied ? "Hex copied" : "Copy hex"}
              title={copied ? "Copied" : "Copy hex"}
              className={cn(
                "inline-flex size-10 shrink-0 items-center justify-center rounded-none border border-input",
                "bg-background hover:bg-accent hover:text-foreground",
                copied ? "text-foreground" : "text-muted-foreground",
                transitionClass,
                focusRingClass,
              )}
            >
              {copied ? (
                <Check className="size-4" strokeWidth={2.5} aria-hidden="true" />
              ) : (
                <Copy className="size-4" strokeWidth={2} aria-hidden="true" />
              )}
            </button>
          </div>
          {invalid && (
            <p id="color-panel-hex-error" className={errorTextClass}>
              Use a 6-digit hex color like #a855f7.
            </p>
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
}

/** Keep the working hue when the color collapses to grey/black (where hue is
 *  mathematically undefined), so the hue slider never jumps under the user. */
function preserveHue(next: Hsv, prev: Hsv): Hsv {
  return next.s < 1 || next.v < 1 ? { ...next, h: prev.h } : next;
}

// Eyedropper capability, read through useSyncExternalStore so the server
// snapshot is false and the button appears on hydration without a mismatch.
const subscribeNever = () => () => {};
const readEyeDropper = () =>
  typeof window !== "undefined" && "EyeDropper" in window;
const readEyeDropperOnServer = () => false;
