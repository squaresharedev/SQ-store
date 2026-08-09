"use client";

import * as React from "react";
import { useActionState } from "react";
import { infoTextClass } from "@/components/ui/control-styles";
import { authenticate, type AuthState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { LastUsedBadge } from "@/components/auth/LastUsedBadge";
import { PasswordResetModal } from "@/components/auth/PasswordResetModal";
import type { SignInMethod } from "@/lib/auth/last-method";
import { USERNAME_MAX_LENGTH, looksLikeEmail } from "@/lib/validation/auth";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup" | "magic";

const INITIAL: AuthState = {};

/**
 * `lastUsed` comes from a cookie read on the server (see lib/auth/last-method),
 * so the badge is in the first paint. Deriving it in the browser instead would
 * flash an unbadged form on every load, which defeats the point: the hint is
 * for the moment a returning user is deciding where to click.
 */
export function LoginForm({
  next = "/",
  lastUsed = null,
}: {
  next?: string;
  /** Sign-in option this browser used last, or null if unknown. */
  lastUsed?: SignInMethod | null;
}) {
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

  /**
   * The pending label names the ACTION under way, rather than a generic
   * "Working…". Three modes share this button, so a single word cannot be
   * honest about all of them, and the wait here is real: the sign-in POST
   * spends most of a second checking the credential. Saying which thing is
   * happening is the difference between "it is thinking" and "it is stuck".
   *
   * Deliberately NOT an optimistic dashboard skeleton. Nothing is known about
   * this session yet, and painting the signed-in shell before the server has
   * agreed is how a previous user's cached view ends up on screen on a shared
   * machine. The skeleton belongs AFTER the redirect, where it already is
   * (see (dashboard)/dashboard/loading.tsx).
   */
  const pendingCta =
    mode === "signup"
      ? "Creating account…"
      : mode === "magic"
        ? "Sending link…"
        : "Signing in…";

  // "Forgot?" opens the reset modal, prefilled with whatever email was typed.
  // Only an email: the identifier box also accepts a handle, and prefilling the
  // reset field with one would look like it was about to work when a reset can
  // only ever be sent to an address.
  function openReset() {
    const typed =
      formRef.current?.querySelector<HTMLInputElement>("#identifier")?.value ??
      "";
    setResetEmail(looksLikeEmail(typed) ? typed : "");
    setResetOpen(true);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Google OAuth (separate form — never nests in the email form) */}
      <GoogleButton next={next} lastUsed={lastUsed === "google"} />

      {/* Divider */}
      <div className="flex items-center gap-4">
        <span className="h-px flex-1 bg-border" />
        <span className={infoTextClass}>or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form
        ref={formRef}
        action={formAction}
        className="flex flex-col gap-5"
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
                  "flex min-w-0 items-center justify-center px-2 py-2.5 font-inter text-sm font-medium transition-colors",
                  mode === m
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className="truncate">
                  {m === "signin" ? "Sign in" : "Sign up"}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Email, or (signing in) a username. Same element in every mode, so
            switching tabs keeps whatever was already typed. */}
        <div className="flex flex-col gap-2">
          {/* The badge sits on the FIELD, not on the tab: what a returning user
              is trying to remember is "which of these boxes did I use", and the
              identifier box is the answer. It also mirrors the password row's
              label/"Forgot?" pairing, so both rows read the same way.
              Sign-in only — in sign-up or magic mode it would be labelling a
              box that has nothing to do with the last password sign-in. */}
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="identifier">
              {mode === "signin" ? "Email or username" : "Email"}
            </Label>
            {mode === "signin" && lastUsed === "password" && <LastUsedBadge />}
          </div>
          <Input
            id="identifier"
            name="identifier"
            // A username is not an email, so in sign-in mode this cannot be
            // type="email": that would hand the field to autofill and mobile
            // keyboards as an address-only box. `autoComplete="username"` is
            // right for both, and is what password managers look for.
            type={mode === "signin" ? "text" : "email"}
            autoComplete={mode === "signin" ? "username" : "email"}
            inputMode={mode === "signin" ? "text" : "email"}
            placeholder={
              mode === "signin" ? "you@studio.com or yourhandle" : "you@studio.com"
            }
            required
          />
        </div>

        {/* Username (sign-up only) */}
        {mode === "signup" && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              placeholder="yourhandle"
              // Typing hint only. The real rule is usernameSchema, re-parsed on
              // the server, with the DB's unique index behind it.
              maxLength={USERNAME_MAX_LENGTH}
              required
            />
            <p className={infoTextClass}>
              Letters, numbers and underscores. You can sign in with this
              instead of your email.
            </p>
          </div>
        )}

        {/* Password (hidden in magic-link mode) */}
        {!isMagic && (
          <div className="flex flex-col gap-2">
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
            {/* States the ACTUAL rule. "At least 8 characters" was true before
                the strength check and is now an understatement, which is the
                worst kind of hint: it invites a password the form then
                rejects. See lib/auth/password.ts. */}
            {mode === "signup" && (
              <p className={infoTextClass}>
                At least 8 characters, mixing cases, numbers or symbols (or a
                passphrase of 16+).
              </p>
            )}
          </div>
        )}

        {/* Confirm password (sign-up only) */}
        {mode === "signup" && (
          <div className="flex flex-col gap-2">
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
          className="mt-2 w-full px-8 py-3.5 text-base"
        >
          {isPending ? (
            <>
              <Spinner />
              {pendingCta}
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
            className="inline-flex max-w-full items-center gap-1.5 rounded-md px-3 py-1.5 font-inter text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {isMagic
              ? "Use a password instead"
              : "Email me a magic link instead"}
            {/* Only while this button OFFERS the magic link. In magic mode it
                offers the password instead, and badging that would point at
                the wrong option. */}
            {!isMagic && lastUsed === "magic" && <LastUsedBadge />}
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
