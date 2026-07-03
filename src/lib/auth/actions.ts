"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AuthError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type AuthIntent = "signin" | "signup" | "magic" | "reset";

export type AuthState = {
  error?: string;
  /** Non-error confirmation (e.g. "check your email"). */
  message?: string;
};

/** Only allow internal, absolute paths as post-login redirect targets. */
function sanitizeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return "/";
}

/** Absolute origin for building email redirect links. */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Map Supabase auth errors to friendly, non-leaky copy. */
function friendly(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      return "Incorrect email or password.";
    case "email_not_confirmed":
      return "Confirm your email first — check your inbox for the link.";
    case "user_already_exists":
    case "email_exists":
      return "An account with that email already exists. Try signing in.";
    case "weak_password":
      return "That password is too weak. Use at least 8 characters.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts. Wait a minute and try again.";
    case "validation_failed":
      return "Enter a valid email address.";
    default:
      return error.message || "Something went wrong. Please try again.";
  }
}

/**
 * Single entry point for the auth screen. The submitted `intent` (carried by the
 * clicked submit button) selects the flow. On success for password sign-in (and
 * for sign-up when email confirmation is disabled) we redirect into the app;
 * otherwise we return a friendly message to render.
 */
export async function authenticate(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const intent = (formData.get("intent") as AuthIntent) ?? "signin";
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = sanitizeNext(formData.get("next"));

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return {
      error: "Could not connect to authentication service. Please try again.",
    };
  }

  // --- Magic link (passwordless OTP) ---
  if (intent === "magic") {
    if (!email) return { error: "Enter your email." };
    const origin = await siteOrigin();
    const result = await supabase.auth
      .signInWithOtp({
        email,
        options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
      })
      .catch(() => ({ error: null, networkError: true }) as const);
    if ("networkError" in result) {
      return { error: "Could not send email. Please check your connection and try again." };
    }
    if (result.error) return { error: friendly(result.error) };
    return { message: "Check your email for a link to sign in." };
  }

  // --- Password reset ---
  if (intent === "reset") {
    if (!email) return { error: "Enter your email to reset your password." };
    const origin = await siteOrigin();
    const result = await supabase.auth
      .resetPasswordForEmail(email, {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      })
      .catch(() => ({ error: null, networkError: true }) as const);
    if ("networkError" in result) {
      return { error: "Could not send reset email. Please check your connection and try again." };
    }
    if (result.error) return { error: friendly(result.error) };
    return { message: "If that email has an account, a reset link is on its way." };
  }

  // --- Password sign-up / sign-in ---
  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  if (intent === "signup") {
    const confirmPassword = String(formData.get("confirm_password") ?? "");
    if (password.length < 8) {
      return { error: "Password must be at least 8 characters." };
    }
    if (password !== confirmPassword) {
      return { error: "Passwords do not match." };
    }
    const origin = await siteOrigin();
    const result = await supabase.auth
      .signUp({
        email,
        password,
        options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
      })
      .catch(() => ({ data: null, error: null, networkError: true }) as const);
    if ("networkError" in result) {
      return { error: "Could not create account. Please check your connection and try again." };
    }
    if (result.error) return { error: friendly(result.error) };
    // With email confirmation ON, there is no session yet.
    if (!result.data.session) {
      return {
        message: "Account created. Check your email to confirm, then sign in.",
      };
    }
    // Confirmation disabled -> already signed in.
    redirect(next);
  }

  // intent === "signin"
  const result = await supabase.auth
    .signInWithPassword({ email, password })
    .catch(() => ({ error: null, networkError: true }) as const);
  if ("networkError" in result) {
    return { error: "Could not sign in. Please check your connection and try again." };
  }
  if (result.error) return { error: friendly(result.error) };
  redirect(next);
}

/**
 * Start the Google OAuth flow. Runs server-side (PKCE): Supabase returns a URL
 * to Google and stores the code-verifier cookie; after consent Google returns to
 * Supabase, which redirects to /auth/callback?code=... where we exchange it.
 * Requires the Google provider to be enabled in the Supabase dashboard.
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = sanitizeNext(formData.get("next"));
  const origin = await siteOrigin();

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    redirect("/login?error=oauth");
  }

  const result = await supabase.auth
    .signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })
    .catch(() => ({ data: null, error: null }) as const);

  if (result.error || !result.data?.url) {
    redirect("/login?error=oauth");
  }
  redirect(result.data.url);
}

/** Sign out and return to the login screen. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
