"use client";

import * as React from "react";
import { useActionState } from "react";
import { authenticate, type AuthState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { PasswordResetModal } from "@/components/auth/PasswordResetModal";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup" | "magic";

const INITIAL: AuthState = {};

export function LoginForm({ next = "/" }: { next?: string }) {
  const [mode, setMode] = React.useState<Mode>("signin");
  const [state, formAction, isPending] = useActionState(authenticate, INITIAL);
  const formRef = React.useRef<HTMLFormElement>(null);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetEmail, setResetEmail] = React.useState("");

  React.useEffect(() => {
    if (state.error) {
      console.error("[LoginForm] Auth error:", state.error);
    }
  }, [state.error]);

  const isMagic = mode === "magic";
  // The clicked submit button carries the intent, so exactly one is submitted.
  const primaryIntent = isMagic ? "magic" : mode;
  const cta =
    mode === "signup"
      ? "Create account"
      : mode === "magic"
        ? "Send magic link"
        : "Sign in";

  // "Forgot?" opens the reset modal, prefilled with whatever email was typed.
  function openReset() {
    const typed =
      formRef.current?.querySelector<HTMLInputElement>("#email")?.value ?? "";
    setResetEmail(typed);
    setResetOpen(true);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Google OAuth (separate form — never nests in the email form) */}
      <GoogleButton next={next} />

      {/* Divider */}
      <div className="flex items-center gap-4">
        <span className="h-px flex-1 bg-border" />
        <span className="font-inter text-xs text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form
        ref={formRef}
        action={formAction}
        className="flex flex-col gap-3"
        noValidate
      >
        <input type="hidden" name="next" value={next} />

        {/* Sign in / Sign up switch (hidden in magic-link mode) */}
        {!isMagic && (
          <div className="grid grid-cols-2 border border-border">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                suppressHydrationWarning
                className={cn(
                  "py-2 font-inter text-sm font-medium transition-colors",
                  mode === m
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {m === "signin" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>
        )}

        {/* Email */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@studio.com"
            required
          />
        </div>

        {/* Password (hidden in magic-link mode) */}
        {!isMagic && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="password">Password</Label>
              {mode === "signin" && (
                <button
                  type="button"
                  onClick={openReset}
                  suppressHydrationWarning
                  className="font-inter text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Forgot?
                </button>
              )}
            </div>
            <PasswordInput
              id="password"
              name="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              placeholder="••••••••"
              required
            />
            {mode === "signup" && (
              <p className="font-inter text-xs text-muted-foreground">
                At least 8 characters.
              </p>
            )}
          </div>
        )}

        {/* Confirm password (sign-up only) */}
        {mode === "signup" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm_password">Confirm password</Label>
            <PasswordInput
              id="confirm_password"
              name="confirm_password"
              autoComplete="new-password"
              placeholder="••••••••"
              required
            />
          </div>
        )}

        {/* Status: error (red) or confirmation (neutral) */}
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

        {/* Primary CTA — the only submit button, so Enter always lands here. */}
        <Button
          type="submit"
          name="intent"
          value={primaryIntent}
          disabled={isPending}
          suppressHydrationWarning
          data-testid="login-submit"
          className="mt-1 w-full px-8 py-3.5 text-base"
        >
          {isPending ? (
            <>
              <Spinner />
              Working…
            </>
          ) : (
            cta
          )}
        </Button>

        {/* Magic-link toggle — visible container on hover */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setMode((m) => (m === "magic" ? "signin" : "magic"))}
            suppressHydrationWarning
            className="rounded-md px-3 py-1.5 font-inter text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {isMagic
              ? "Use a password instead"
              : "Email me a magic link instead"}
          </button>
        </div>
      </form>

      <PasswordResetModal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        defaultEmail={resetEmail}
        next={next}
      />
    </div>
  );
}
