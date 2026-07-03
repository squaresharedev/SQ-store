"use client";

import { useActionState } from "react";
import { resetPassword, type AuthState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";

const INITIAL: AuthState = {};

/**
 * Set-a-new-password form, shown after following a recovery link. The server
 * action verifies the recovery session and calls updateUser, then redirects
 * into the app on success.
 */
export function ResetPasswordForm({ email }: { email?: string }) {
  const [state, formAction, isPending] = useActionState(resetPassword, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {email && (
        <p className="font-inter text-sm text-neutral-500">
          Setting a new password for{" "}
          <span className="font-medium text-neutral-900">{email}</span>
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">New password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          placeholder="••••••••"
          required
        />
        <p className="font-inter text-xs text-neutral-400">At least 8 characters.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm_password">Confirm new password</Label>
        <PasswordInput
          id="confirm_password"
          name="confirm_password"
          autoComplete="new-password"
          placeholder="••••••••"
          required
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm font-medium text-red-500">
          {state.error}
        </p>
      )}

      <Button
        type="submit"
        disabled={isPending}
        suppressHydrationWarning
        className="mt-1 w-full px-8 py-3.5 text-base"
      >
        {isPending ? (
          <>
            <Spinner />
            Updating…
          </>
        ) : (
          "Update password"
        )}
      </Button>
    </form>
  );
}
