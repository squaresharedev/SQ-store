"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, X } from "lucide-react";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/settings/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  updateDisplayName,
  type SettingsActionState,
} from "@/lib/settings/actions";
import { displayNameSchema } from "@/lib/validation/settings";
import { cn } from "@/lib/utils";

const INITIAL: SettingsActionState = {};
const CHECK_DEBOUNCE_MS = 400;

type CheckResult = "idle" | "available" | "taken";
type CheckStatus = CheckResult | "checking" | "mine";

/**
 * Name is also the account's unique handle — no separate username field.
 * Shows a live availability indicator next to the input: checkmark when the
 * typed value is already theirs or free, cross when someone else has it.
 * The network check is a UX nicety only — the DB's case-insensitive unique
 * index (+ the update action's 23505 handling) is the real guard against a
 * race between two tabs or two users.
 */
export function DisplayNameForm({ displayName }: { displayName: string }) {
  const [state, formAction, isPending] = useActionState(
    updateDisplayName,
    INITIAL,
  );
  const [value, setValue] = React.useState(displayName);
  const [checking, setChecking] = React.useState(false);
  const [checkResult, setCheckResult] = React.useState<CheckResult>("idle");

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

  return (
    <SettingsCard
      title="Display name"
      description="What buyers see on your storefront and in the marketplace — and your unique handle, so no two accounts can share one."
      decoration="dots"
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="display_name">Name</Label>
          <div className="relative">
            <Input
              id="display_name"
              name="display_name"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="builderboy"
              maxLength={50}
              autoComplete="nickname"
              className="pr-12"
              required
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3.5"
            >
              {status === "checking" && (
                <Spinner className="text-neutral-400" />
              )}
              {(status === "available" || status === "mine") && (
                <Check className="size-4 text-success" />
              )}
              {status === "taken" && <X className="size-4 text-red-500" />}
            </div>
          </div>
          {status !== "idle" && (
            <p
              aria-live="polite"
              className={cn(
                "font-inter text-xs",
                status === "taken" ? "text-red-500" : "text-neutral-400",
              )}
            >
              {status === "mine" && "That's your name."}
              {status === "available" && "Available."}
              {status === "taken" && "Someone already has this name — try another."}
              {status === "checking" && "Checking…"}
            </p>
          )}
        </div>
        <FormStatus state={state} />
        <div>
          <SaveButton
            pending={isPending}
            state={state}
            disabled={status === "taken"}
          />
        </div>
      </form>
    </SettingsCard>
  );
}
