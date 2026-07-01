"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode = "password" | "magic";

/**
 * Auth screen — UI ONLY.
 *
 * ⚠️ NEXT AGENT: wire the auth logic here. Nothing below talks to Supabase yet.
 * Recommended approach (works with the HttpOnly, server-driven session):
 *   • password sign-in  -> a Server Action calling `supabase.auth.signInWithPassword`
 *                          using the SERVER client (@/lib/supabase/server), then redirect.
 *   • magic link        -> Server Action calling `supabase.auth.signInWithOtp`,
 *                          with a `/auth/callback` Route Handler to exchange the code.
 *   • surface real errors in the `formError` slot and drive the loading state
 *     off the action's pending status (e.g. useActionState / useFormStatus).
 * See @/lib/supabase/server.ts and cookie-options.ts for the session model.
 */
export function LoginForm() {
  const [mode, setMode] = React.useState<Mode>("password");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");

  // Static placeholder — the next agent replaces this with real error state.
  const formError: string | null = null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // TODO(next agent): call the sign-in Server Action here.
    // - mode === "password": signInWithPassword({ email, password })
    // - mode === "magic":    signInWithOtp({ email })
    // Intentionally a no-op for now (auth screen UI only).
    console.warn("[login] auth not wired yet", { mode, email });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {/* Email */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@studio.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      {/* Password (hidden in magic-link mode) */}
      {mode === "password" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="password">Password</Label>
            {/* TODO(next agent): route to a real password-reset flow. */}
            <a
              href="#"
              className="font-mono text-xs uppercase tracking-[0.2em] text-white/30 transition-colors hover:text-acid"
            >
              Forgot?
            </a>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
      )}

      {/* Error slot (reserved; static for now) */}
      {formError && (
        <p role="alert" className="text-sm font-medium text-red-500">
          {formError}
        </p>
      )}

      {/* Primary CTA */}
      <Button type="submit" className="mt-1 w-full px-8 py-4 text-base">
        {mode === "password" ? "Sign in" : "Send magic link"}
      </Button>

      {/* Mode toggle */}
      <div className="flex items-center justify-center pt-1">
        <button
          type="button"
          onClick={() =>
            setMode((m) => (m === "password" ? "magic" : "password"))
          }
          className="font-mono text-xs uppercase tracking-[0.2em] text-white/40 transition-colors hover:text-acid"
        >
          {mode === "password"
            ? "Email me a magic link instead"
            : "Use a password instead"}
        </button>
      </div>
    </form>
  );
}
