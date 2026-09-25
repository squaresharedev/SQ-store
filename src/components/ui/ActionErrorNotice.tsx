"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { errorTextClass, helpTextClass } from "@/components/ui/control-styles";
import { useToast } from "@/components/ui/Toast";
import type { SaveResult } from "@/components/ui/SaveButton";
import type { MessageRef, MessageValues } from "@/i18n/types";
import type { ActionError, ActionState } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * THE way to turn a MessageRef (from a server action, a Zod issue, an
 * ActionError) into text in the reader's language. `values` merges over the
 * ref's own, for the rare message whose data only the render site knows.
 */
export function useResolveMessage(): (ref: MessageRef, values?: MessageValues) => string {
  const t = useTranslations();
  return useCallback(
    (ref: MessageRef, values?: MessageValues) =>
      t(ref.key, values ? { ...ref.values, ...values } : ref.values),
    [t],
  );
}

/**
 * Raise an ActionError as a toast: the message, with the fix as its second
 * line. Every structured failure a component reports without an inline notice
 * goes through here.
 */
export function useActionErrorToast(): (error: ActionError) => void {
  const toast = useToast();
  const resolve = useResolveMessage();
  return useCallback(
    (error: ActionError) => {
      toast.error(resolve(error.message), {
        lines: error.fix ? [resolve(error.fix)] : undefined,
      });
    },
    [toast, resolve],
  );
}

/**
 * Bridge from a `useActionState` result to a toast: one line in a form
 * component.
 *
 * WHY IT WATCHES IDENTITY rather than the message: a resend that fails the same
 * way twice returns the same message both times, so comparing messages would
 * announce the first failure and silently swallow every one after it. Each
 * dispatch settles into a fresh object, so the object IS the occurrence.
 *
 * Whatever state is present at mount is never announced: that is a page load,
 * not something the user just did.
 */
export function useActionStateToast(
  state: ActionState | undefined,
  options: { values?: MessageValues } = {},
) {
  const toast = useToast();
  const resolve = useResolveMessage();
  const announced = useRef(state);
  const { values } = options;

  useEffect(() => {
    if (state === announced.current) return;
    announced.current = state;
    if (!state) return;
    if (state.error) {
      toast.error(resolve(state.error.message, values), {
        lines: state.error.fix ? [resolve(state.error.fix, values)] : undefined,
      });
      return;
    }
    if (state.success) toast.success(resolve(state.success, values));
  }, [state, toast, resolve, values]);
}

/**
 * An ActionState as SaveButton reads it. Memoised on the state itself, so the
 * button's "has this result been dismissed" identity check still sees one
 * object per dispatch.
 */
export function useSaveResult(state: ActionState): SaveResult {
  const resolve = useResolveMessage();
  return useMemo(
    () => ({
      error: state.error ? resolve(state.error.message) : undefined,
      success: state.success ? resolve(state.success) : undefined,
    }),
    [state, resolve],
  );
}

/**
 * Standard renderer for a structured ActionError: it always shows what happened
 * AND how to fix it, so no consumer can accidentally drop the fix line.
 * `banner` is the boxed alert used above forms and lists; `inline` is compact
 * stacked text for tight side panels and modals.
 *
 * An error carrying `action` (see lib/errors.ts) also gets the link that
 * resolves it, in BOTH variants: the errors that carry one are the ones whose
 * fix lives on another page, and a fix line naming a page the user then has to
 * go and find is half an answer.
 */
export function ActionErrorNotice({
  error,
  variant = "banner",
  className,
}: {
  error: ActionError;
  variant?: "banner" | "inline";
  className?: string;
}) {
  const resolve = useResolveMessage();
  const action = error.action ? (
    <Link
      href={error.action.href}
      // Outlined rather than filled, matching SellerDetailsNotice: the only
      // solid buttons in this dashboard are its black primaries.
      className="mt-1 inline-flex items-center rounded-sm border border-destructive/40 px-3 py-1.5 font-inter text-xs font-medium text-destructive transition-colors duration-base ease-standard hover:bg-destructive hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
    >
      {resolve(error.action.label)}
    </Link>
  ) : null;

  if (variant === "inline") {
    return (
      <div role="alert" className={cn("space-y-0.5", className)}>
        <p className={errorTextClass}>{resolve(error.message)}</p>
        {error.fix && <p className={helpTextClass}>{resolve(error.fix)}</p>}
        {action}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3",
        className,
      )}
    >
      <AlertCircle
        className="mt-0.5 size-4 shrink-0 text-destructive"
        strokeWidth={2}
        aria-hidden="true"
      />
      <div className="space-y-0.5">
        <p className={errorTextClass}>{resolve(error.message)}</p>
        {error.fix && (
          <p className="font-inter text-sm text-destructive/80">{resolve(error.fix)}</p>
        )}
        {action}
      </div>
    </div>
  );
}
