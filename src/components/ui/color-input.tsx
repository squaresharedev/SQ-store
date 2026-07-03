"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { errorTextClass, fieldBaseClass, labelClass } from "./control-styles";
import { isStrictHexColor } from "@/lib/validation/storefront";

/**
 * Color field constrained to strict 6-digit hex (#rrggbb). The swatch is a
 * native color picker (always emits valid hex); the text input only propagates
 * values that pass the strict regex, so `value` upstream is always safe to
 * place in a style attribute (server-side Zod re-checks on save regardless).
 */
export function ColorInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);

  // Adopt external changes (e.g. the swatch picker) — render-time state reset
  // on prop change, same pattern the codebase uses elsewhere.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value);
    setInvalid(false);
  }

  function handleText(next: string) {
    setText(next);
    if (isStrictHexColor(next)) {
      setInvalid(false);
      onChange(next.toLowerCase());
    } else {
      setInvalid(true);
    }
  }

  const errorId = `${id}-error`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          aria-label={`${label} color picker`}
          className="size-10 shrink-0 cursor-pointer rounded-sm border border-input bg-background p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        <input
          id={id}
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
          className={cn(fieldBaseClass, "font-mono")}
        />
      </div>
      {invalid && (
        <p id={errorId} className={errorTextClass}>
          Use a 6-digit hex color like #a855f7.
        </p>
      )}
    </div>
  );
}
