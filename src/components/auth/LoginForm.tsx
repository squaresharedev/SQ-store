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
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup" | "magic";

const INITIAL: AuthState = {};

export function LoginForm({ next = "/" }: { next?: string }) {
  const [mode, setMode] = React.useState<Mode>("signin");
  const [state, formAction, isPending] = useActionState(authenticate, INITIAL);
  const formRef = React.useRef<HTMLFormElement>(null);

  const isMagic = mode === "magic";
  // The clicked submit button carries the intent, so exactly one is submitted.
  const primaryIntent = isMagic ? "magic" : mode;
  const cta =
    mode === "signup"
      ? "Create account"
      : mode === "magic"
        ? "Send magic link"
        : "Sign in";

  // "Forgot?" reuses the current form (email) but with the reset intent. It is a
  // plain button (not a second submit) so Enter always triggers the primary CTA.
  function submitReset() {
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    data.set("intent", "reset");
    React.startTransition(() => formAction(data));
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Google OAuth (separate form — never nests in the email form) */}
      <GoogleButton next={next} />

      {/* Divider */}
      <div className="flex items-center gap-4">
        <span className="h-px flex-1 bg-neutral-200" />
        <span className="font-inter text-xs text-neutral-400">or</span>
        <span className="h-px flex-1 bg-neutral-200" />
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
          <div className="grid grid-cols-2 border border-neutral-200">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                suppressHydrationWarning
                className={cn(
                  "py-2 font-inter text-sm font-medium transition-colors",
                  mode === m
                    ? "bg-neutral-100 text-neutral-900"
                    : "text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700",
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
                  onClick={submitReset}
                  disabled={isPending}
                  suppressHydrationWarning
                  className="font-inter text-xs text-neutral-400 transition-colors hover:text-neutral-700 disabled:opacity-50"
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
              <p className="font-inter text-xs text-neutral-400">
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
              <p role="alert" className="text-sm font-medium text-red-500">
                {state.error}
              </p>
            )}
            {state.message && (
              <p className="text-sm font-medium text-neutral-700">
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
            className="rounded-md px-3 py-1.5 font-inter text-sm text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
          >
            {isMagic
              ? "Use a password instead"
              : "Email me a magic link instead"}
          </button>
        </div>
      </form>
    </div>
  );
}
