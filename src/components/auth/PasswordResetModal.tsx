"use client";

import * as React from "react";
import { useActionState } from "react";
import { authenticate, type AuthState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";

const INITIAL: AuthState = {};

/**
 * "Forgot your password?" dialog on the sign-in screen. Collects the email
 * (prefilled from whatever was typed in the main form) and sends a recovery
 * link, which lands the user on /reset-password to choose a new one.
 */
export function PasswordResetModal({
  open,
  onClose,
  defaultEmail = "",
  next = "/",
}: {
  open: boolean;
  onClose: () => void;
  defaultEmail?: string;
  next?: string;
}) {
  // Wrapped, not passed bare: if the action's POST never lands (server
  // restarting, connection dropped) the rejection propagates out of
  // useActionState and takes the whole login page down to the error boundary.
  // The reset branch never redirects, so nothing thrown here needs re-raising.
  const [state, formAction, isPending] = useActionState(
    async (prev: AuthState, formData: FormData): Promise<AuthState> => {
      try {
        return await authenticate(prev, formData);
      } catch {
        return {
          error: "Could not reach the server. Check your connection and try again.",
        };
      }
    },
    INITIAL,
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reset your password"
      description="Enter your email and we'll send a link to set a new one."
      className="rounded-none sm:rounded-none"
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        {/* The reset branch ignores `next` for its own redirect, but the hidden
            field keeps the action's contract consistent. */}
        <input type="hidden" name="intent" value="reset" />
        <input type="hidden" name="next" value={next} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset_email">Email</Label>
          <Input
            id="reset_email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            defaultValue={defaultEmail}
            placeholder="you@studio.com"
            required
          />
        </div>

        {(state.error || state.message) && (
          <div aria-live="polite">
            {state.error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {state.error}
              </p>
            )}
            {state.message && (
              <p className="text-sm font-medium text-foreground">
                {state.message}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            Back to sign in
          </Button>
          <Button type="submit" disabled={isPending} suppressHydrationWarning>
            {isPending ? (
              <>
                <Spinner />
                Sending…
              </>
            ) : (
              "Send reset link"
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
