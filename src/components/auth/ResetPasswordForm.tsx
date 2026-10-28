"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { helpTextClass, infoTextClass } from "@/components/ui/control-styles";
import { resetPassword } from "@/lib/auth/actions";
import type { ActionState } from "@/lib/errors";
import { resilientAction, SIGN_IN_UNREACHABLE } from "@/lib/resilient-action";
import { useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";

const INITIAL: ActionState = {};

// Never sent twice: a lost answer may have changed the password already, and
// a second try would then be refused as "that's already your password". A
// request that never came back is said in place instead of taking the page
// down (lib/resilient-action.ts).
const setPassword = resilientAction(resetPassword, SIGN_IN_UNREACHABLE, []);

/**
 * Set-a-new-password form, shown after following a recovery link. The server
 * action verifies the recovery session and calls updateUser, then redirects
 * into the app on success.
 */
export function ResetPasswordForm({ email }: { email?: string }) {
  const [state, formAction, isPending] = useActionState(setPassword, INITIAL);
  const resolveMessage = useResolveMessage();
  const t = useTranslations("Auth.resetPassword");
  // The one statement of the password rule, shared with sign-up.
  const tLogin = useTranslations("Auth.login");

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {email && (
        <p className={helpTextClass}>
          {t.rich("settingFor", {
            email,
            address: (chunks) => (
              <span className="font-medium text-foreground">{chunks}</span>
            ),
          })}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{t("newPasswordLabel")}</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          placeholder="••••••••"
          required
        />
        <p className={infoTextClass}>{tLogin("passwordHint")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm_password">{t("confirmPasswordLabel")}</Label>
        <PasswordInput
          id="confirm_password"
          name="confirm_password"
          autoComplete="new-password"
          placeholder="••••••••"
          required
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {resolveMessage(state.error.message)}
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
            {t("updating")}
          </>
        ) : (
          t("update")
        )}
      </Button>
    </form>
  );
}
