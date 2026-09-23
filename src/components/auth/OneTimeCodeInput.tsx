"use client";

import * as React from "react";
import { Input, type InputProps } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The six-digit box for an authenticator code, wherever one is asked for (the
 * sign-in challenge, setup, and the step-up field on sensitive forms).
 *
 * - `autoComplete="one-time-code"` lets iOS and password managers offer the
 *   current code, and `inputMode="numeric"` brings up the number pad.
 * - `maxLength` 7 leaves room for the space most apps show mid-code
 *   ("123 456"); the server strips it.
 * - UNCONTROLLED on purpose: React 19 resets a form after its action runs, so
 *   a wrong code clears itself and the next attempt starts from an empty box
 *   rather than from a code that has already failed.
 * - `submitOnComplete` sends the form the moment six digits are in, which is
 *   what people expect from this field. Once per distinct value, so a failed
 *   code is never re-sent on its own.
 */
export function OneTimeCodeInput({
  className,
  submitOnComplete = false,
  onInput,
  ...props
}: Omit<InputProps, "type"> & { submitOnComplete?: boolean }) {
  const lastSubmitted = React.useRef("");

  return (
    <Input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9 ]*"
      maxLength={7}
      spellCheck={false}
      placeholder="123456"
      className={cn("font-mono tabular-nums tracking-[0.3em]", className)}
      onInput={(event) => {
        onInput?.(event);
        if (!submitOnComplete) return;
        const input = event.currentTarget;
        const digits = input.value.replace(/\s+/g, "");
        if (!/^[0-9]{6}$/.test(digits) || digits === lastSubmitted.current) return;
        lastSubmitted.current = digits;
        input.form?.requestSubmit();
      }}
      {...props}
    />
  );
}
