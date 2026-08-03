"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, X } from "lucide-react";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/ui/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { fadeRightScrimClass } from "@/components/ui/control-styles";
import {
  updateDisplayName,
  type SettingsActionState,
} from "@/lib/settings/actions";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/settings/constants";
import { displayNameSchema } from "@/lib/validation/settings";
import { cn } from "@/lib/utils";

const INITIAL: SettingsActionState = {};
const CHECK_DEBOUNCE_MS = 400;

type CheckResult = "idle" | "available" | "taken";
type CheckStatus = CheckResult | "checking" | "mine";

/**
 * The username IS the profile's display name — one field, no separate handle.
 * Shows a live availability indicator next to the input: checkmark when the
 * typed value is already theirs or free, cross when someone else has it.
 * The network check is a UX nicety only — the DB's case-insensitive unique
 * index (+ the update action's 23505 handling) is the real guard against a
 * race between two tabs or two users.
 *
 * Save sits beside the field rather than under it, so the input is deliberately
 * narrow. A username longer than the visible width stays reachable by scrolling
 * the input (native), with a gradient scrim fading the clipped end so it reads
 * as "there's more" instead of a hard cut. The scrim lifts on focus — a caret
 * must never sit under a fade.
 */
export function DisplayNameForm({ displayName }: { displayName: string }) {
  const [state, formAction, isPending] = useActionState(
    updateDisplayName,
    INITIAL,
  );
  const [value, setValue] = React.useState(displayName);
  const [checking, setChecking] = React.useState(false);
  const [checkResult, setCheckResult] = React.useState<CheckResult>("idle");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [overflowing, setOverflowing] = React.useState(false);
  const [focused, setFocused] = React.useState(false);

  const trimmed = value.trim();
  // Already saved as this exact name (case-insensitive) — this is the
  // "that username is theirs" checkmark, no network round trip needed.
  const isMine =
    trimmed !== "" && trimmed.toLowerCase() === displayName.trim().toLowerCase();
  const isValidFormat = displayNameSchema.safeParse({
    display_name: trimmed,
  }).success;
  const shouldCheck = isValidFormat && !isMine;

  // Derived from render-time state (isMine / format) first, so a stale
  // in-flight result can never override them — only a real network answer
  // for the CURRENT value ever reaches "available"/"taken".
  const status: CheckStatus = isMine
    ? "mine"
    : !isValidFormat
      ? "idle"
      : checking
        ? "checking"
        : checkResult;

  React.useEffect(() => {
    if (!shouldCheck) return;

    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      async function run() {
        setChecking(true);
        try {
          const res = await fetch(
            `/api/settings/display-name-available?name=${encodeURIComponent(trimmed)}`,
            { signal: controller.signal },
          );
          if (cancelled) return;
          const data: { available?: boolean } = res.ok ? await res.json() : {};
          setCheckResult(
            typeof data.available === "boolean"
              ? data.available
                ? "available"
                : "taken"
              : "idle",
          );
        } catch {
          if (!cancelled) setCheckResult("idle");
        } finally {
          if (!cancelled) setChecking(false);
        }
      }
      void run();
    }, CHECK_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmed, shouldCheck]);

  // Whether the typed name is wider than the field. Re-measured on every value
  // change AND on resize, since the same name overflows or doesn't depending on
  // how much room the row has left after the Save button.
  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    // +1 absorbs sub-pixel rounding, which would otherwise flicker the scrim on
    // a name that exactly fits.
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <SettingsCard
      title="Username"
      description="What buyers see on your storefront and in the marketplace. It's also your unique handle, so no two accounts can share one."
      decoration="dots"
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="display_name">Username</Label>
          {/* `items-stretch` so Save is exactly as tall as the field beside it,
              `min-w-0` so the input yields room to the button instead of
              pushing it off the card on a narrow screen. */}
          <div className="flex max-w-lg items-stretch gap-2">
            <div className="relative min-w-0 flex-1">
              <Input
                ref={inputRef}
                id="display_name"
                name="display_name"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder="builderboy"
                // Typing hint only. DISPLAY_NAME_MAX_LENGTH is enforced server
                // side by displayNameSchema on every write path.
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                autoComplete="nickname"
                className="pr-12"
                required
              />
              {overflowing && !focused && (
                <div
                  aria-hidden
                  className={cn(
                    fadeRightScrimClass,
                    // Stops short of the status icon (pr-12) and clears the
                    // 2px border top and bottom.
                    "absolute inset-y-0.5 right-12 w-8",
                  )}
                />
              )}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3.5"
              >
                {status === "checking" && (
                  <Spinner className="text-muted-foreground" />
                )}
                {(status === "available" || status === "mine") && (
                  <Check className="size-4 text-success" />
                )}
                {status === "taken" && <X className="size-4 text-destructive" />}
              </div>
            </div>
            <SaveButton
              pending={isPending}
              state={state}
              disabled={status === "taken"}
              className="shrink-0"
            />
          </div>
          {status !== "idle" && (
            <p
              aria-live="polite"
              className={cn(
                "font-inter text-xs",
                status === "taken" ? "text-danger-strong" : "text-muted-foreground",
              )}
            >
              {status === "mine" && "That's your username."}
              {status === "available" && "Available."}
              {status === "taken" && "Someone already has this username, try another."}
              {status === "checking" && "Checking…"}
            </p>
          )}
        </div>
        <FormStatus state={state} />
      </form>
    </SettingsCard>
  );
}
