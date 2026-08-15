"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, X } from "lucide-react";
import { useActionToast } from "@/components/ui/Toast";
import { SaveButton } from "@/components/ui/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { updateUsername, type SettingsActionState } from "@/lib/settings/actions";
import {
  USERNAME_MAX_LENGTH,
  normalizeUsername,
  usernameSchema,
} from "@/lib/validation/auth";
import { cn } from "@/lib/utils";
import { TYPING_DEBOUNCE_MS } from "@/lib/typing-debounce";

const INITIAL: SettingsActionState = {};

type CheckResult = "idle" | "available" | "taken";
type CheckStatus = CheckResult | "checking" | "mine";

/**
 * The account's sign-in handle, separate from the display name buyers see.
 * Claiming one is what turns on signing in by username; an account without one
 * simply keeps using its email, which never stops working.
 *
 * Same live-availability shape as DisplayNameForm, and the same caveat: the
 * network check is a UX nicety, while profiles_username_lower_idx (plus the
 * action's 23505 handling) is what actually decides a race.
 *
 * Typing is normalized as it goes, so the field always shows the value that
 * will be stored rather than accepting "BuilderBoy" and quietly saving
 * something else.
 */
export function UsernameForm({ username }: { username: string }) {
  const [state, formAction, isPending] = useActionState(updateUsername, INITIAL);
  useActionToast(state);
  const [value, setValue] = React.useState(username);
  const [checking, setChecking] = React.useState(false);
  const [checkResult, setCheckResult] = React.useState<CheckResult>("idle");

  const trimmed = normalizeUsername(value);
  const isMine = trimmed !== "" && trimmed === normalizeUsername(username);
  const isValidFormat = usernameSchema.safeParse({ username: trimmed }).success;
  const shouldCheck = isValidFormat && !isMine;

  // Derived from render-time state first, so a stale in-flight result can never
  // override "that's yours" or "that shape is invalid".
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
            `/api/settings/username-available?name=${encodeURIComponent(trimmed)}`,
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
    }, TYPING_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmed, shouldCheck]);

  return (
    <SettingsCard
      title="Username"
      description="Sign in with this instead of your email. Letters, numbers and underscores only, and no two accounts can share one."
      decoration="dots"
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="username">Username</Label>
          <div className="flex max-w-lg items-stretch gap-2">
            <div className="relative min-w-0 flex-1">
              <Input
                id="username"
                name="username"
                value={value}
                onChange={(e) => setValue(normalizeUsername(e.target.value))}
                placeholder="yourhandle"
                // Typing hint only. usernameSchema is re-parsed on the server on
                // every write path, and a hand-rolled POST never sees this.
                maxLength={USERNAME_MAX_LENGTH}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                // scroll-mt: this input is universal search's landing point for
                // /settings/account#username, and without it the anchor lands
                // under the sticky top bar.
                className="pr-12 scroll-mt-24"
                required
              />
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
          {/* "mine" deliberately says nothing. Telling someone the handle
              already in their own field is theirs is a line of text for a
              non-event; the tick in the field is all the confirmation that
              state needs. */}
          {status !== "idle" && status !== "mine" && (
            <p
              aria-live="polite"
              className={cn(
                "font-inter text-xs",
                status === "taken"
                  ? "text-danger-strong"
                  : "text-muted-foreground",
              )}
            >
              {status === "available" && "Available."}
              {status === "taken" &&
                "Someone already has this username, try another."}
              {status === "checking" && "Checking…"}
            </p>
          )}
        </div>
      </form>
    </SettingsCard>
  );
}
