"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionStateToast, useResolveMessage, useSaveResult } from "@/components/ui/ActionErrorNotice";
import { SaveButton } from "@/components/ui/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { updateUsername } from "@/lib/settings/actions";
import type { ActionState } from "@/lib/errors";
import {
  USERNAME_MAX_LENGTH,
  normalizeUsername,
  usernameSchema,
} from "@/lib/validation/auth";
import { firstIssue } from "@/lib/validation/messages";
import { cn } from "@/lib/utils";
import { TYPING_DEBOUNCE_MS } from "@/lib/typing-debounce";

const INITIAL: ActionState = {};

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
 *
 * INLINE VALIDATION. usernameSchema runs on every keystroke so the failing
 * rule appears inline rather than only after a failed save. The reserved-word
 * list is static, so it is checked client-side too. The server remains the
 * real boundary; the availability round trip stays debounced.
 */
export function UsernameForm({ username }: { username: string }) {
  const t = useTranslations("Settings.account.username");
  const [state, formAction, isPending] = useActionState(updateUsername, INITIAL);
  useActionStateToast(state);
  const saveResult = useSaveResult(state);
  const resolveMessage = useResolveMessage();
  const [value, setValue] = React.useState(username);
  const [checking, setChecking] = React.useState(false);
  const [checkResult, setCheckResult] = React.useState<CheckResult>("idle");

  const trimmed = normalizeUsername(value);
  const isMine = trimmed !== "" && trimmed === normalizeUsername(username);

  // Parse on every render so the message is always current. usernameSchema
  // is a shared, pure Zod schema with no async work, so the call is cheap.
  const parseResult = usernameSchema.safeParse({ username: trimmed });
  const isValidFormat = parseResult.success;

  // Show the failing rule inline when the user has typed something that does
  // not pass: too short, spaces, hyphens, reserved words. Stays null when
  // the field is blank or when it already holds their own saved handle.
  const validationHint =
    !isValidFormat && trimmed !== "" && !isMine
      ? resolveMessage(firstIssue(parseResult.error))
      : null;

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
      title={t("cardTitle")}
      description={t("cardDescription")}
      decoration="dots"
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="username">{t("label")}</Label>
          <div className="flex max-w-lg items-stretch gap-2">
            <div className="relative min-w-0 flex-1">
              <Input
                id="username"
                name="username"
                value={value}
                onChange={(e) => setValue(normalizeUsername(e.target.value))}
                placeholder={t("placeholder")}
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
              state={saveResult}
              disabled={status === "taken"}
              className="shrink-0"
            />
          </div>
          {/* The inline validation hint fires as soon as the typed value
              fails the schema: too short, disallowed characters (spaces,
              hyphens), or a reserved word. This is the same rule the server
              runs, so there are no surprises at save time. The server check
              remains the real boundary. */}
          {validationHint && (
            <p
              aria-live="polite"
              className="font-inter text-xs text-destructive"
            >
              {validationHint}
            </p>
          )}
          {/* "mine" deliberately says nothing. Telling someone the handle
              already in their own field is theirs is a line of text for a
              non-event; the tick in the field is all the confirmation that
              state needs. */}
          {!validationHint && status !== "idle" && status !== "mine" && (
            <p
              aria-live="polite"
              className={cn(
                "font-inter text-xs",
                status === "taken"
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {status === "available" && t("available")}
              {status === "taken" && t("taken")}
              {status === "checking" && t("checking")}
            </p>
          )}
        </div>
      </form>
    </SettingsCard>
  );
}
