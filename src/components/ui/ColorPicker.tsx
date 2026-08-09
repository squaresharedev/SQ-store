"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Check, Copy, Pipette, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  errorTextClass,
  fieldBaseClass,
  focusRingClass,
  labelClass,
  transitionClass,
} from "./control-styles";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { hexToHsv, hsvToHex, isLightColor, type Hsv } from "@/lib/format/color";
import { COLOR_PRESETS } from "@/lib/theme/color-presets";
import { Popover } from "./Popover";
import { ColorArea } from "./ColorArea";

/**
 * `EyeDropper` is Chromium-only (no Safari/Firefox as of 2026) and absent from
 * the DOM lib, so it is declared here and always feature-detected before use.
 */
declare global {
  interface Window {
    EyeDropper?: new () => {
      open: (options?: { signal?: AbortSignal }) => Promise<{ sRGBHex: string }>;
    };
  }
}

// Whether this browser can sample screen pixels. Read through
// `useSyncExternalStore` rather than an effect: the server snapshot is `false`,
// so the button is absent in the SSR markup and appears on hydration without a
// mismatch. The capability never changes at runtime, hence the no-op subscribe.
const subscribeNever = () => () => {};
const readEyeDropper = () =>
  typeof window !== "undefined" && "EyeDropper" in window;
const readEyeDropperOnServer = () => false;

/** The rainbow ring on the "custom color" button. Values, not chrome. */
const COLOR_WHEEL_GRADIENT =
  "conic-gradient(#ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)";

/** Every circle in the inline row is the same size and shape. */
const DOT_BASE =
  "flex aspect-square w-full items-center justify-center rounded-full";

/**
 * The row sizes its columns to however many circles it actually has, so it is
 * always exactly ONE line — a fixed column count leaves an optional field that
 * shows both an inherit dot and a custom dot wrapping a single lonely swatch
 * onto a second row. Static class strings, because Tailwind cannot see a
 * computed `grid-cols-${n}`.
 */
const ROW_COLUMNS: Record<number, string> = {
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
  9: "grid-cols-9",
};

/**
 * A "follow the theme" option, offered as its own dot in the inline row for
 * fields whose stored value is optional (absent = inherit). Without this, every
 * editor invents its own reset affordance and they drift apart.
 */
export type ColorInheritOption = {
  /** Names the source, e.g. "Theme color". */
  label: string;
  /** The hex actually rendered while inheriting — fills the dot. */
  value: string;
  /** True when nothing is overridden. */
  active: boolean;
  /** Clear the override. */
  onSelect: () => void;
};

/** Solid color dot; shows a check (in readable ink) when it is the current one. */
function ColorDot({
  color,
  label,
  active,
  onSelect,
}: {
  color: string;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={active}
      title={label}
      style={{ backgroundColor: color }}
      className={cn(
        DOT_BASE,
        "transition-[transform,box-shadow] duration-base ease-standard motion-reduce:transition-none",
        focusRingClass,
        // The selection ring sits OUTSIDE the dot, so it can't be confused with
        // the hairline that merely gives white and pale tints a visible edge.
        active
          ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
          : "ring-1 ring-inset ring-black/10 hover:scale-110 hover:shadow-md motion-reduce:hover:scale-100",
      )}
    >
      {active && (
        <Check
          className={cn("size-3.5", isLightColor(color) ? "text-black" : "text-white")}
          strokeWidth={3}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

/** Keep the working hue when the color collapses to grey/black (where hue is
 *  mathematically undefined), so the hue slider never jumps under the user. */
function preserveHue(next: Hsv, prev: Hsv): Hsv {
  return next.s < 1 || next.v < 1 ? { ...next, h: prev.h } : next;
}

/**
 * The one color picker in the product — every field that chooses a color uses
 * this, so accent, background, text and shape colors all behave identically.
 *
 * SHAPE: a single row of circles, inline. The first two are actions — a color
 * wheel that opens the full picker, and an eyedropper — followed by the quick
 * swatches. The common case is one tap and no overlay at all; the saturation
 * square, hue slider and hex field only appear when the wheel is opened.
 *
 * `value`/`onChange` are STRICT 6-digit hex (`#rrggbb`); the component never
 * emits anything else, preserving the storefront security contract. Every path
 * in (dots, dragging, typing, eyedropper) passes the strict hex gate first.
 *
 * Pass `inherit` for fields whose stored value is optional — it becomes its own
 * dot in the row instead of each editor bolting on its own reset link.
 */
export function ColorPicker({
  id,
  label,
  value,
  onChange,
  inherit,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (hex: string) => void;
  inherit?: ColorInheritOption;
}) {
  const hexId = useId();
  const errorId = `${hexId}-error`;
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 0 });
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasEyeDropper = useSyncExternalStore(
    subscribeNever,
    readEyeDropper,
    readEyeDropperOnServer,
  );

  // Clear the "Copied" flash without leaving a timer behind on unmount.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  const inheriting = inherit?.active ?? false;

  // Adopt external value changes — but skip re-seeding when the incoming value
  // is just the hex our own HSV already produces (re-seeding grey/black would
  // wipe the working hue). Comparing against the canonical hex keeps this pure,
  // with no ref read during render.
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

  function emit(hex: string, nextHsv: Hsv) {
    const lower = hex.toLowerCase();
    setHsv(nextHsv);
    setText(lower);
    setInvalid(false);
    onChange(lower);
  }

  function handleArea(next: Hsv) {
    emit(hsvToHex(next), next);
  }

  function applyHex(hex: string) {
    const parsed = hexToHsv(hex);
    if (parsed) emit(hex, preserveHue(parsed, hsv));
  }

  function handleText(next: string) {
    setText(next);
    // Only ever propagate a value that passes the strict hex gate.
    if (isStrictHexColor(next)) applyHex(next);
    else setInvalid(true);
  }

  async function pickFromScreen() {
    if (typeof window === "undefined" || !window.EyeDropper) return;
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      // The API is specified to return sRGB hex, but it is still an external
      // string: re-gate it rather than trusting it into the contract.
      const lower = sRGBHex.toLowerCase();
      if (isStrictHexColor(lower)) applyHex(lower);
    } catch {
      // The user pressed Esc or the browser refused — nothing to report.
    }
  }

  async function copyHex() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure context, denied permission) — stay quiet.
    }
  }

  const current = value.toLowerCase();
  const isPreset = COLOR_PRESETS.some((preset) => preset.value === current);
  // A custom color earns its own dot so the row always shows what is selected.
  // Presets already have one, and an inherited field has no override to show.
  const showCustomDot = !inheriting && !isPreset && isStrictHexColor(current);

  // wheel + eyedropper? + inherit? + custom? + the quick swatches.
  const dotCount =
    1 +
    (hasEyeDropper ? 1 : 0) +
    (inherit ? 1 : 0) +
    (showCustomDot ? 1 : 0) +
    COLOR_PRESETS.length;

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label &&
        (id ? (
          <label htmlFor={id} className={labelClass}>
            {label}
          </label>
        ) : (
          <span className={labelClass}>{label}</span>
        ))}

      <div
        role="group"
        aria-label={label ? `${label} swatches` : "Color swatches"}
        className={cn("grid gap-1.5", ROW_COLUMNS[dotCount] ?? "grid-cols-8")}
      >
        <Popover
          open={open}
          onOpenChange={setOpen}
          label={label ? `${label} color picker` : "Color picker"}
          panelClassName="sm:w-[17rem]"
          trigger={
            <button
              id={id}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-label="Custom color"
              title="Custom color"
              data-testid="color-picker-trigger"
              onClick={() => setOpen((prev) => !prev)}
              className={cn(
                DOT_BASE,
                "relative transition-transform duration-base ease-standard motion-reduce:transition-none",
                focusRingClass,
                "hover:scale-110",
                // Deliberately never carries the selection ring: whenever a
                // custom color is live the custom dot is rendered and rings
                // itself, and ringing both would read as two selections.
              )}
              style={{ background: COLOR_WHEEL_GRADIENT }}
            >
              <span className="absolute inset-[3px] flex items-center justify-center rounded-full bg-background">
                <Plus className="size-4 text-foreground" strokeWidth={2.5} aria-hidden="true" />
              </span>
            </button>
          }
        >
          <div className="space-y-3">
            <ColorArea hsv={hsv} onChange={handleArea} />

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
                <label htmlFor={hexId} className="sr-only">
                  Hex color
                </label>
                <input
                  id={hexId}
                  type="text"
                  value={text}
                  onChange={(event) => handleText(event.target.value)}
                  onBlur={() => {
                    // Snap back to the last valid value instead of leaving junk.
                    if (invalid) {
                      setText(value);
                      setInvalid(false);
                    }
                  }}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={invalid ? true : undefined}
                  aria-describedby={invalid ? errorId : undefined}
                  placeholder="#a855f7"
                  className={cn(fieldBaseClass, "h-10 rounded-none py-0 font-mono text-sm")}
                />
                <button
                  type="button"
                  onClick={copyHex}
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
                <p id={errorId} className={errorTextClass}>
                  Use a 6-digit hex color like #a855f7.
                </p>
              )}
            </div>
          </div>
        </Popover>

        {hasEyeDropper && (
          <button
            type="button"
            onClick={pickFromScreen}
            aria-label="Pick a color from the screen"
            title="Pick from screen"
            className={cn(
              DOT_BASE,
              "border border-border bg-background text-foreground",
              "transition-transform duration-base ease-standard motion-reduce:transition-none",
              focusRingClass,
              "hover:scale-110",
            )}
          >
            <Pipette className="size-4" strokeWidth={2} aria-hidden="true" />
          </button>
        )}

        {inherit && (
          <ColorDot
            color={inherit.value}
            label={`Use ${inherit.label}`}
            active={inheriting}
            onSelect={inherit.onSelect}
          />
        )}

        {showCustomDot && (
          <ColorDot
            color={current}
            label={`Current color ${current}`}
            active
            onSelect={() => setOpen(true)}
          />
        )}

        {COLOR_PRESETS.map((preset) => (
          <ColorDot
            key={preset.value}
            color={preset.value}
            label={`${preset.name} (${preset.value})`}
            active={!inheriting && current === preset.value}
            onSelect={() => applyHex(preset.value)}
          />
        ))}
      </div>
    </div>
  );
}
