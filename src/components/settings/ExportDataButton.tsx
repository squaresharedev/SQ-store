"use client";

import * as React from "react";
import { useActionState } from "react";
import { Download } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StepUpField, useStepUpRequired } from "@/components/auth/StepUp";
import { confirmIdentity, type ManageState } from "@/lib/auth/mfa-actions";

const INITIAL: ManageState = {};
const EXPORT_URL = "/settings/export";

/**
 * "Download my data". The export itself is a plain GET (the browser saves the
 * file directly), and a GET cannot carry a two-factor code in a form. So when
 * the account has 2FA and its last code is too old, the button first posts
 * the code to confirmIdentity, and only once that succeeds does it start the
 * download. The route re-checks the same window server-side regardless.
 */
export function ExportDataButton() {
  const required = useStepUpRequired();
  const [state, formAction, isPending] = useActionState(confirmIdentity, INITIAL);

  // Download as soon as the code has been accepted.
  React.useEffect(() => {
    if (state.success) window.location.assign(EXPORT_URL);
  }, [state]);

  if (!required && !state.stepUp) {
    return (
      <a href={EXPORT_URL} download className={buttonClassName("secondary")}>
        <Download aria-hidden className="size-4" />
        Download my data
      </a>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <StepUpField
        id="export-step-up"
        state={state}
        always
        description="Your export contains your whole account. Enter the current code from your authenticator app to download it."
      />
      {state.error && (
        <p role="alert" className="font-inter text-sm font-medium text-destructive">
          {state.error}
        </p>
      )}
      <div>
        <Button type="submit" variant="secondary" disabled={isPending} suppressHydrationWarning>
          {isPending ? <Spinner /> : <Download aria-hidden className="size-4" />}
          Download my data
        </Button>
      </div>
    </form>
  );
}
