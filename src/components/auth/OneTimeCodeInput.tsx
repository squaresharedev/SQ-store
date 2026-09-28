"use client";

import * as React from "react";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** A run of example digits as long as the code, for the placeholder. */
const PLACEHOLDER_DIGITS = "1234567890";

/**
 * The box for a one-time code, wherever one is asked for: six digits from an
 * authenticator (the sign-in challenge, setup, the step-up field on sensitive
 * forms), or a longer code sent to a contact detail (`length`).
 *
 * - `autoComplete="one-time-code"` lets iOS and password managers offer the
 *   current code, and `inputMode="numeric"` brings up the number pad.
 * - `maxLength` leaves room for the one space most apps and messages show
 *   mid-code ("123 456", "1234 5678"); the server strips it.
 * - UNCONTROLLED on purpose: React 19 resets a form after its action runs, so
 *   a wrong code clears itself and the next attempt starts from an empty box
 *   rather than from a code that has already failed.
 * - `submitOnComplete` sends the form the moment the last digit is in, which
 *   is what people expect from this field. Once per distinct value, so a
 *   failed code is never re-sent on its own.
 */
export function OneTimeCodeInput({
  className,
  submitOnComplete = false,
  length = 6,
  onInput,
  ...props
}: Omit<InputProps, "type"> & { submitOnComplete?: boolean; length?: number }) {
  const lastSubmitted = React.useRef("");
  const complete = new RegExp(`^[0-9]{${length}}$`);

  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9 ]*"
      maxLength={length + 1}
      spellCheck={false}
      placeholder={PLACEHOLDER_DIGITS.slice(0, length)}
      className={cn("font-mono tabular-nums tracking-[0.3em]", className)}
      onInput={(event) => {
        onInput?.(event);
        if (!submitOnComplete) return;
        const input = event.currentTarget;
        const digits = input.value.replace(/\s+/g, "");
        if (!complete.test(digits) || digits === lastSubmitted.current) return;
        lastSubmitted.current = digits;
        input.form?.requestSubmit();
      }}
      {...props}
    />
  );
}
