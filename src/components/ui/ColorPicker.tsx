"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { errorTextClass, fieldBaseClass, labelClass } from "./control-styles";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { hexToHsv, hsvToHex, type Hsv } from "@/lib/format/color";
import { COLOR_PRESETS } from "@/lib/theme/color-presets";
import { Popover } from "./Popover";
import { ColorArea } from "./ColorArea";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Keep the working hue when the color collapses to grey/black (where hue is
 *  mathematically undefined), so the hue slider never jumps under the user. */
function preserveHue(next: Hsv, prev: Hsv): Hsv {
  return next.s < 1 || next.v < 1 ? { ...next, h: prev.h } : next;
}

/**
 * Controlled color picker replacing `<input type="color">`. `value`/`onChange`
 * are STRICT 6-digit hex (`#rrggbb`) — the component never emits anything else,
 * preserving the storefront security contract. A saturation/brightness square,
 * hue slider, validated hex field, and the shared preset allowlist all resolve
 * to a single known-safe hex. Chrome is tokens-only; sharp CTAs where present.
 */
export function ColorPicker({
  id,
  label,
  value,
  onChange,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const hexId = useId();
  const errorId = `${hexId}-error`;
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 0 });
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);

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

  const swatch = isStrictHexColor(value) ? value : "transparent";

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
            onClick={() => setOpen((prev) => !prev)}
            className={cn(fieldBaseClass, "flex items-center gap-2 text-left")}
          >
            <span
              className="size-5 shrink-0 rounded-sm border border-border"
              style={{ backgroundColor: swatch }}
              aria-hidden="true"
            />
            <span className="truncate font-mono">{value}</span>
          </button>
        }
      >
        <div className="space-y-3">
          <ColorArea hsv={hsv} onChange={handleArea} />

          <div className="space-y-1">
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
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? errorId : undefined}
              placeholder="#a855f7"
              className={cn(fieldBaseClass, "font-mono")}
            />
            {invalid && (
              <p id={errorId} className={errorTextClass}>
                Use a 6-digit hex color like #a855f7.
              </p>
            )}
          </div>

          <div
            role="group"
            aria-label="Color presets"
            className="grid grid-cols-6 gap-1.5"
          >
            {COLOR_PRESETS.map((preset) => {
              const active = value.toLowerCase() === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => applyHex(preset.value)}
                  aria-label={`${preset.name} (${preset.value})`}
                  aria-pressed={active}
                  title={preset.name}
                  style={{ backgroundColor: preset.value }}
                  className={cn(
                    "size-8 rounded-sm border border-border transition-shadow duration-180 ease-in-out motion-reduce:transition-none",
                    FOCUS_RING,
                    active
                      ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
                      : "hover:border-foreground/40",
                  )}
                />
              );
            })}
          </div>
        </div>
      </Popover>
    </div>
  );
}
