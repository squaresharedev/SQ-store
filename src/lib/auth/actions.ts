"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AuthError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { revokeOtherSessions } from "@/lib/auth/session";
import { rememberSignInMethod } from "@/lib/auth/last-method";
import { emailForUsername, isUsernameTaken } from "@/lib/auth/handles";
import { passwordProblem } from "@/lib/auth/password";
import { accountHasPassword } from "@/lib/auth/has-password";
import { alertSecurityEvent } from "@/lib/security/events";
import { safeInternalPath } from "@/lib/utils/safe-path";
import { authIntentSchema, looksLikeEmail, usernameSchema } from "@/lib/validation/auth";
import { emailAddress } from "@/lib/validation/inputs";
import { isDisposableEmailDomain } from "@/lib/validation/disposable-email";
import { isPlaceholderEmail } from "@/lib/validation/email-quality";
import { verifyTurnstile } from "@/lib/turnstile";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";

export type { AuthIntent } from "@/lib/validation/auth";

/**
 * The address every mail-sending branch is allowed to use.
 *
 * `looksLikeEmail` decides which PATH an identifier takes (handle or address);
 * it is not a format check, and on its own it let anything containing an "@"
 * through to a send. This is the format check, spent before the rate-limit
 * budget so that garbage is refused without costing the caller their quota.
 */
const emailSchema = emailAddress("That email");

/**
 * The one reply a signup attempt ever gets.
 *
 * Identical for a brand-new address and one that is already registered, because
 * anything that distinguishes them turns the signup form into a "does this
 * person have an account here" lookup — worth having for a competitor, and
 * worth more for anyone building a credential-stuffing list.
 *
 * The second sentence is the UX half of that trade, and it is why closing this
 * costs the returning user nothing. They are the case the neutral copy would
 * otherwise strand: they typed an address they forgot they had registered, and
 * a bare "check your email" would leave them waiting for a mail that (for an
 * existing account) never comes. Naming both paths tells them exactly what to
 * do next while telling an attacker nothing, because everyone reads it.
 */
const SIGNUP_CHECK_EMAIL =
  "Check your email for a link to confirm your account. " +
  "If you already have an account with that address, sign in instead — or reset your password if you've forgotten it.";

export type AuthState = {
  error?: string;
  /** Non-error confirmation (e.g. "check your email"). */
  message?: string;
};

/** Only allow internal, absolute paths as post-login redirect targets. */
function sanitizeNext(next: FormDataEntryValue | null): string {
  return safeInternalPath(next);
}

/** Absolute origin for building email redirect links. */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Shown whenever a limiter denies — deliberately identical everywhere so it
 *  reveals nothing about which budget was hit or whether an account exists. */
const TOO_MANY = "Too many attempts. Wait a while and try again.";

/**
 * THE answer to every failed password attempt, whichever way it failed: wrong
 * password, no such email, no such handle. Named once and used by both the
 * error map and the sign-in path so the two can never drift into telling an
 * attacker apart the cases we went to some trouble to make identical.
 */
const BAD_CREDENTIALS = "Incorrect email or password.";

/**
 * An address that provably belongs to no one, minted fresh each time.
 *
 * Used to spend a real password round trip on a handle nobody holds (see
 * `authenticate`). `.invalid` is reserved by RFC 6761 and can never be
 * registered; the random label matters just as much, because a CONSTANT probe
 * address would eventually trip Supabase's own per-address throttle and start
 * answering "too many attempts" instead of "wrong credentials", which is the
 * enumeration oracle back again wearing a different hat.
 */
function unclaimableAddress(): string {
  return `probe-${crypto.randomUUID()}@sign-in.invalid`;
}

/**
 * Audit + notify, guaranteed not to throw AT THE CALL SITE. The password has
 * already been set by the time this runs, so a failure here must never become
 * an error the user might act on. See the twin in lib/settings/actions.ts.
 */
async function safeAlert(
  ...args: Parameters<typeof alertSecurityEvent>
): Promise<void> {
  try {
    await alertSecurityEvent(...args);
  } catch (err) {
    console.error(
      "[auth] security alert failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Gate an outbound auth email on TWO sliding-window budgets:
 *
 *  1. per TARGET ADDRESS — the one that matters. An attacker aiming magic links
 *     or reset mails at someone else's inbox cannot dodge this by changing IP,
 *     clearing cookies, or waiting for a window boundary.
 *  2. per CLIENT — stops one client working through many addresses. Best-effort:
 *     the IP comes from a header, which is trustworthy behind Cloudflare but
 *     forgeable in local dev, so it never stands alone.
 *
 * Both are checked before the send. Supabase has its own limits, but those are
 * project-wide rather than per-recipient — this is the per-recipient guard.
 */
async function allowAuthEmail(email: string): Promise<boolean> {
  const perAddress = await rateLimitKey(
    email,
    "auth_email_address",
    RATE_LIMITS.authEmailPerAddress,
  );
  if (!perAddress) return false;

  const who = await clientKey(await headers());
  return rateLimitKey(who, "auth_email_client", RATE_LIMITS.authEmailPerClient);
}

/**
 * Resolve whatever was typed into the identifier box to an email address, since
 * that is the only thing Supabase's password grant accepts.
 *
 * "missing" covers a handle nobody holds, a handle that could not be a handle,
 * and a failed lookup. The caller must render all three exactly as it renders a
 * wrong password.
 */
type Resolution =
  | { kind: "email"; email: string }
  | { kind: "missing" }
  | { kind: "denied" };

async function resolveSignInEmail(identifier: string): Promise<Resolution> {
  // An "@" means they typed an email; hand it straight over, unchanged.
  if (looksLikeEmail(identifier)) return { kind: "email", email: identifier };

  // A SECOND budget, spent on top of the sign-in budget the caller already
  // took, never instead of it. Working through a handle list therefore costs an
  // attacker both, while the person who fat-fingered their own handle still has
  // as many goes as they would have had by email. Taken BEFORE the shape check
  // so a flood of nonsense cannot probe for free.
  const allowed = await rateLimitKey(
    await clientKey(await headers()),
    "auth_username_resolve",
    RATE_LIMITS.usernameResolvePerClient,
  );
  if (!allowed) return { kind: "denied" };

  // Something that cannot be a handle cannot match a row, so it never reaches
  // the database. Rejecting it here leaks nothing: the shape rule is public.
  const parsed = usernameSchema.safeParse({ username: identifier });
  if (!parsed.success) return { kind: "missing" };

  const email = await emailForUsername(parsed.data.username);
  return email ? { kind: "email", email } : { kind: "missing" };
}

/** Map Supabase auth errors to friendly, non-leaky copy. */
function friendly(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      return BAD_CREDENTIALS;
    case "email_not_confirmed":
      return "Confirm your email first — check your inbox for the link.";
    // NOTE: user_already_exists / email_exists are deliberately absent. They are
    // intercepted at the signup branch and answered with SIGNUP_CHECK_EMAIL,
    // the same copy a new address gets. Adding a case for them here would
    // quietly reopen the enumeration oracle, since `friendly` is what every
    // other error path renders.
    case "weak_password":
      return "That password is too weak. Use at least 8 characters.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts. Wait a minute and try again.";
    case "validation_failed":
      return "Enter a valid email address.";
    case "unexpected_failure":
      // What a raised exception inside handle_new_user surfaces as, which for
      // us means the handle was claimed between the availability check and the
      // insert. The raw message carries the Postgres error text (constraint
      // and index names included), so it must never reach the default branch
      // below and get printed at the user.
      return "Could not create that account. Try a different username.";
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
  // Parsed, not cast. An unrecognised intent resolves to "signin", the most
  // restrictive branch — it still demands a valid password — so a hand-crafted
  // post cannot steer itself into a flow that sends mail.
  const parsedIntent = authIntentSchema.safeParse(formData.get("intent"));
  const intent = parsedIntent.success ? parsedIntent.data : "signin";
  // The sign-in screen posts `identifier` (an email OR a handle). Everything
  // else on this action still posts `email`, and always will: only the password
  // grant can take a handle, because it is the only flow that has somewhere to
  // resolve one FROM. A reset or a magic link has to reach an inbox.
  const identifier = String(
    formData.get("identifier") ?? formData.get("email") ?? "",
  ).trim();
  const password = String(formData.get("password") ?? "");
  const next = sanitizeNext(formData.get("next"));

  // Every other intent has to reach an inbox, so for those the identifier is
  // read as an address and a handle is refused up front. The full format parse
  // (not just "contains an @") happens HERE, before any branch below spends a
  // rate-limit budget: a malformed address should cost the caller nothing and
  // never reach the auth server.
  const email = identifier;
  const notAnAddress =
    intent !== "signin" && email !== "" && !emailSchema.safeParse(email).success;

  let supabase;
  try {
    supabase = await createClient();
  } catch (err) {
    console.error(
      "[auth] failed to create Supabase client:",
      err instanceof Error ? err.message : String(err),
    );
    return {
      error: "Could not connect to authentication service. Please try again.",
    };
  }

  if (notAnAddress) return { error: "Enter a valid email address." };

  // --- Magic link (passwordless OTP) ---
  if (intent === "magic") {
    if (!email) return { error: "Enter your email." };
    // Deny BEFORE calling Supabase: the email is the side effect to prevent.
    if (!(await allowAuthEmail(email))) return { error: TOO_MANY };
    const origin = await siteOrigin();
    let result;
    try {
      result = await supabase.auth.signInWithOtp({
        email,
        // `method=magic` is what tells the callback to remember this option.
        // Sent here rather than inferred there: an emailed link that lands on
        // the callback might equally be a signup confirmation or a recovery,
        // and those are not a choice of sign-in method.
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}&method=magic`,
        },
      });
    } catch (err) {
      console.error("[auth] magic link failed:", err instanceof Error ? err.message : String(err));
      return { error: "Could not send email. Please check your connection and try again." };
    }
    if (result.error) return { error: friendly(result.error) };
    return { message: "Check your email for a link to sign in." };
  }

  // --- Password reset ---
  if (intent === "reset") {
    if (!email) return { error: "Enter your email to reset your password." };
    // Same gate as the magic link — this one mails a password-reset link, so
    // aiming it at someone else's inbox is the higher-value abuse.
    if (!(await allowAuthEmail(email))) {
      // Mirror the success copy exactly. The unthrottled path already refuses
      // to confirm whether an account exists; a distinct "rate limited" reply
      // here would reintroduce that oracle for anyone probing addresses.
      return { message: "If that email has an account, a reset link is on its way." };
    }
    const origin = await siteOrigin();
    // The recovery link always lands on /reset-password (where the new password
    // is chosen), regardless of the page's own post-login `next`.
    let result;
    try {
      result = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
      });
    } catch (err) {
      console.error("[auth] reset password failed:", err instanceof Error ? err.message : String(err));
      return { error: "Could not send reset email. Please check your connection and try again." };
    }
    // Supabase's own reply is NOT surfaced here. Its errors are
    // address-specific ("user_not_found", and its per-address send throttle),
    // so echoing them would undo the anti-enumeration work above: an attacker
    // could tell real addresses apart by which ones produce an error. Logged
    // server-side instead, where it is useful and not a signal to the caller.
    if (result.error) {
      console.warn(
        "[auth] reset email not sent:",
        result.error.code,
        result.error.message,
      );
    }
    return { message: "If that email has an account, a reset link is on its way." };
  }

  // --- Password sign-up / sign-in ---
  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  if (intent === "signup") {
    const confirmPassword = String(formData.get("confirm_password") ?? "");
    if (password !== confirmPassword) {
      return { error: "Passwords do not match." };
    }
    const parsedUsername = usernameSchema.safeParse({
      username: String(formData.get("username") ?? ""),
    });
    if (!parsedUsername.success) {
      return {
        error:
          parsedUsername.error.issues[0]?.message ?? "Pick a valid username.",
      };
    }
    const username = parsedUsername.data.username;
    // Strength is checked AFTER the handle is known, so "your password is your
    // username" can actually be caught. Both are in hand by this point and
    // neither has been spent on a network call yet.
    const weak = passwordProblem(password, { email, username });
    if (weak) return { error: weak };
    // Free, local, and worth refusing before anything else costs a cycle: a
    // throwaway address is never a legitimate signup on this product, and
    // neither is a placeholder — the confirmation mail has nowhere to go, so
    // the account could never be used anyway.
    if (isDisposableEmailDomain(email) || isPlaceholderEmail(email)) {
      return { error: "Please sign up with a permanent email address." };
    }
    // Bot check BEFORE the rate-limit budget is spent, so a scripted signup
    // loop is refused here rather than grinding through (and eventually
    // exhausting) the per-address/per-client budgets meant for real people.
    const turnstileToken = String(formData.get("cf_turnstile_token") ?? "");
    const clientIp = (await headers()).get("cf-connecting-ip") ?? undefined;
    if (!(await verifyTurnstile(turnstileToken, clientIp))) {
      return { error: "Verification failed. Please try again." };
    }
    // Sign-up also sends a confirmation email, so it needs the per-address gate
    // as well as a cap on how many accounts one client can spin up.
    if (!(await allowAuthEmail(email))) return { error: TOO_MANY };
    const signUpOk = await rateLimitKey(
      await clientKey(await headers()),
      "auth_signup_client",
      RATE_LIMITS.authSignUpPerClient,
    );
    if (!signUpOk) return { error: TOO_MANY };
    // Readable copy for the ordinary case. It is NOT the guard: the real one is
    // profiles_username_lower_idx, which decides the race between two people
    // submitting the same handle in the same instant. A failed check (null)
    // therefore falls through rather than blocking a legitimate signup.
    if (await isUsernameTaken(username)) {
      return { error: "That username is taken. Try another." };
    }
    const origin = await siteOrigin();
    let result;
    try {
      result = await supabase.auth.signUp({
        email,
        password,
        options: {
          // The handle travels as user metadata so handle_new_user claims it in
          // the SAME transaction as the auth.users insert. This is what makes a
          // duplicate impossible rather than merely unlikely: a collision aborts
          // the whole insert, leaving no account at all instead of an account
          // with no handle. Just as important, when the address already belongs
          // to someone GoTrue never inserts, so the handle is discarded rather
          // than stapled onto an account this signer-up does not control, which
          // is exactly what a follow-up UPDATE here would have allowed.
          data: { username },
          emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
    } catch (err) {
      console.error("[auth] signup failed:", err instanceof Error ? err.message : String(err));
      return { error: "Could not create account. Please check your connection and try again." };
    }
    // "That address is already registered" must never be answerable from out
    // here. GoTrue reveals it two different ways depending on how the project
    // is configured, so both are folded into the same reply as a brand-new
    // signup:
    //
    //   - confirmations OFF: an explicit user_already_exists / email_exists error
    //   - confirmations ON:  no error at all, but a user whose `identities` array
    //     is empty, which is GoTrue's documented signal for "already taken"
    //
    // Handling only one would leave the other as an oracle the moment someone
    // flips that setting in the dashboard.
    const alreadyRegistered =
      result.error?.code === "user_already_exists" ||
      result.error?.code === "email_exists" ||
      (!result.error && result.data.user?.identities?.length === 0);

    if (result.error && !alreadyRegistered) return { error: friendly(result.error) };

    // With email confirmation ON there is no session yet — and there is no
    // session for an existing address either, so these two cases return the
    // same thing by construction rather than by remembering to.
    if (alreadyRegistered || !result.data.session) {
      return { message: SIGNUP_CHECK_EMAIL };
    }
    // Confirmation disabled -> already signed in.
    redirect(next);
  }

  // intent === "signin"
  // Brute-force brake. Keyed on the CLIENT, not the account: keying on the
  // email would let anyone lock a victim out of their own account by burning
  // the budget on their address.
  const signInOk = await rateLimitKey(
    await clientKey(await headers()),
    "auth_signin_client",
    RATE_LIMITS.authSignInPerClient,
  );
  if (!signInOk) return { error: TOO_MANY };

  const resolution = await resolveSignInEmail(identifier);
  if (resolution.kind === "denied") return { error: TOO_MANY };

  let result;
  try {
    // A handle nobody holds STILL costs a full password round trip, against an
    // address that cannot exist. Returning early instead would make "no such
    // handle" measurably quicker than "wrong password", which hands back by the
    // clock exactly what the shared error message refuses to say in words.
    result = await supabase.auth.signInWithPassword({
      email:
        resolution.kind === "email" ? resolution.email : unclaimableAddress(),
      password,
    });
  } catch (err) {
    console.error(
      "[auth] sign-in request failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { error: "Could not sign in. Please check your connection and try again." };
  }

  // Whatever the probe came back with is discarded: an unknown handle answers
  // with the one credentials message, same as an unknown email and a wrong
  // password.
  if (resolution.kind === "missing") return { error: BAD_CREDENTIALS };
  if (result.error) return { error: friendly(result.error) };
  // Only now, with the sign-in actually through: a failed attempt must not
  // relabel the option this browser last used successfully.
  await rememberSignInMethod("password");
  redirect(next);
}

/**
 * Set a new password for the user arriving from a recovery link. The link is
 * exchanged for a session in /auth/callback, so by the time this runs the user
 * is authenticated — the emailed link itself is the proof of identity, which is
 * why (unlike the in-app settings change) no current password is required.
 *
 * Also usable by an already-signed-in user who lands on /reset-password; the
 * page is auth-gated, and updateUser is scoped to that session's own account.
 */
export async function resetPassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirm_password") ?? "");

  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }
  // The same bar as sign-up, and for a concrete reason: without it, "reset my
  // password" is a way to walk around the sign-up gate and land on `password1`.
  // Run bare first so an obviously weak password is refused before we spend a
  // round trip on the session.
  const weak = passwordProblem(password);
  if (weak) return { error: weak };

  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return { error: "Could not connect. Please try again." };
  }

  // Confirm the recovery session actually took — an expired/invalid link
  // leaves no session, and we must not silently no-op.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: "Your reset link has expired. Request a new one from the sign-in page.",
    };
  }

  // Now that we know WHO is resetting, re-check against their own identity —
  // the one rule that needs the account in hand.
  const weakForUser = passwordProblem(password, {
    email: user.email,
    username:
      typeof user.user_metadata?.username === "string"
        ? user.user_metadata.username
        : undefined,
  });
  if (weakForUser) return { error: weakForUser };

  // Captured BEFORE the update, since afterwards every account has one. Tells
  // "an OAuth user set their first password" apart from "an existing password
  // was replaced", and only the second is a credential rotation worth alarm.
  const hadPassword = await accountHasPassword(user.id);

  let result;
  try {
    result = await supabase.auth.updateUser({ password });
  } catch (err) {
    console.error("[auth] update password failed:", err instanceof Error ? err.message : String(err));
    return { error: "Could not update your password. Check your connection and try again." };
  }
  if (result.error) {
    return result.error.code === "same_password"
      ? { error: "That's already your password. Pick a new one." }
      : { error: friendly(result.error) };
  }

  // A recovery reset is the flow people reach for when they think someone
  // else is in their account, so the old credential's sessions must not
  // survive it. `others` scope keeps THIS (recovery) session alive so the
  // redirect below lands them signed in.
  await revokeOtherSessions(supabase);

  // Recorded BEFORE the redirect, which throws. `password.set` when the account
  // had none (an OAuth user establishing their first one) and `password.changed`
  // when it replaced an existing password: the distinction is worth keeping,
  // because the second one means a credential was taken over or rotated.
  await safeAlert(user.id, hadPassword ? "password.changed" : "password.set", {
    title: hadPassword ? "Your password was changed" : "A password was set on your account",
    body: hadPassword
      ? "A reset link was used to set a new password, and other devices were signed out. If this wasn't you, reset it again immediately."
      : "This account can now sign in with a password as well as Google. If this wasn't you, reset it immediately.",
  });

  // The session is valid, so drop them straight into the app.
  redirect("/");
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
        // `method=google` rides along so the callback can record the option
        // only once consent actually came back, not when we merely sent the
        // user to Google (they can still abandon it there).
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}&method=google`,
      },
    })
    .catch(() => ({ data: null, error: null }) as const);

  if (result.error || !result.data?.url) {
    redirect("/login?error=oauth");
  }
  redirect(result.data.url);
}

/**
 * Sign out of the *current* session only, then return to the login screen.
 *
 * Supabase's `signOut()` defaults to `global` scope — which revokes every
 * session on every device the user is signed in on. That's surprising for a
 * routine "Sign out" button, so we pass `local` to end just this session and
 * leave the user's other devices alone. Use `signOutEverywhere()` for the
 * deliberate all-devices sweep.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}

/**
 * Sign out of *every* device by revoking all of the user's refresh tokens
 * (Supabase `global` scope), then return to the login screen. This is the
 * "I left myself logged in somewhere" / "my account may be compromised"
 * escape hatch. Note: already-issued access-token JWTs remain valid until they
 * expire; what this guarantees is that no session can be refreshed past that.
 */
export async function signOutEverywhere(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login");
}
