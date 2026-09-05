"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getUser, revokeOtherSessions } from "@/lib/auth/session";
import { LEGAL_VERSION } from "@/lib/settings/constants";
import { RATE_LIMITS, clientKey, rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { alertSecurityEvent } from "@/lib/security/events";
import { accountHasPassword } from "@/lib/auth/has-password";
import {
  deleteConfirmSchema,
  emailChangeSchema,
  legalAcceptSchema,
  notificationsSchema,
  passwordChangeSchema,
  taxSchema,
} from "@/lib/validation/settings";
import { passwordProblem } from "@/lib/auth/password";
import { usernameSchema } from "@/lib/validation/auth";
import type { TablesUpdate } from "@/types";
import type { z } from "zod";

export type SettingsActionState = {
  error?: string;
  success?: string;
};

const SIGNED_OUT: SettingsActionState = {
  error: "Your session expired. Sign in again.",
};
const SAVE_FAILED: SettingsActionState = {
  error: "Could not save. Give it another try.",
};

/** Shown when a signed-in write budget is spent. Deliberately vague about the
 *  exact limit: the number is an implementation detail, and naming it only
 *  helps someone pace around it. */
const TOO_MANY: SettingsActionState = {
  error: "That's a lot of changes in a short time. Try again a bit later.",
};

/**
 * Audit + notify, guaranteed not to throw AT THE CALL SITE.
 *
 * `alertSecurityEvent` already promises this, but the promise is only worth
 * what the implementation makes it worth, and these call sites run AFTER a
 * password or email has already changed. Turning a completed credential change
 * into an error the user might retry is a worse outcome than a missing audit
 * row, so the guarantee is enforced here too rather than assumed.
 */
async function safeAlert(
  ...args: Parameters<typeof alertSecurityEvent>
): Promise<void> {
  try {
    await alertSecurityEvent(...args);
  } catch (err) {
    console.error(
      "[settings] security alert failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * A native `<textarea>` posted through a real `<form>` (as opposed to a
 * React-controlled field synced on every keystroke) has its line breaks
 * normalised to CRLF by the browser's own form-data-set algorithm before this
 * action ever sees them. `multiLineText` (lib/validation/inputs.ts) rejects a
 * bare CR on purpose — it is the header-injection defence for text that might
 * end up in an email — so a real textarea's own newlines would otherwise fail
 * that gate for a reason that has nothing to do with what the seller typed.
 * Collapse back to LF-only right where the value is read, before it reaches
 * any schema.
 */
function normalizeTextareaValue(raw: string): string {
  return raw.replace(/\r\n?/g, "\n");
}

/**
 * FIELD WHITELIST (privilege-escalation guard): reject any submitted field
 * that isn't explicitly expected by the form. Combined with the strict Zod
 * schemas and column-by-column update objects below, there is no path for a
 * user to touch `id`, `is_seller`, `avatar_url` or any other column through
 * settings. React's own `$ACTION_*` bookkeeping keys are ignored.
 */
function unknownFieldError(
  formData: FormData,
  allowed: readonly string[],
): SettingsActionState | null {
  for (const key of formData.keys()) {
    if (key.startsWith("$ACTION")) continue;
    if (!allowed.includes(key)) {
      return { error: `Unexpected field "${key}" was rejected.` };
    }
  }
  return null;
}

function firstIssue(error: z.ZodError): SettingsActionState {
  return { error: error.issues[0]?.message ?? "Check the form and try again." };
}

/** Owner-scoped profile update. Only whitelisted columns ever reach this. */
async function updateOwnProfile(
  userId: string,
  update: TablesUpdate<"profiles">,
): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", userId); // owner id from the session, RLS enforces it again
  return !error;
}

/** Absolute origin for email links (mirrors the auth slice's helper). */
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

// --- Account ---------------------------------------------------------------

/**
 * The account's ONE name: the handle buyers see AND the one they sign in with.
 * Changing it changes a credential, so the value is normalized to a single
 * canonical form (lowercased by usernameSchema) before it is stored, and the
 * same lower() comparison decides uniqueness, resolution at sign-in, and this
 * write.
 *
 * Same shape as updateDisplayName and for the same reason: the raw Postgres
 * code is what tells "someone got there first" apart from a generic failure,
 * and profiles_username_lower_idx, not the availability check, is what actually
 * settles a race between two tabs.
 *
 * Releasing a handle makes it immediately claimable by someone else. That is
 * the accepted cost of letting people change it at all; nothing grants access
 * by handle, so a released one confers nothing on whoever takes it next.
 */
export async function updateUsername(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownFieldError(formData, ["username"]);
  if (rejected) return rejected;

  const parsed = usernameSchema.safeParse({
    username: String(formData.get("username") ?? ""),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  if (!(await rateLimit("settings_write", RATE_LIMITS.settingsWrite))) {
    return TOO_MANY;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      username: parsed.data.username,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) {
    return error.code === "23505"
      ? { error: "That username is taken. Try another." }
      : SAVE_FAILED;
  }
  revalidatePath("/settings/account");
  return { success: "Username saved." };
}

/**
 * Email changes go through Supabase's re-verification flow, never a DB
 * write. The address only switches once the confirmation link is clicked.
 *
 * RE-AUTHENTICATED. This is a takeover-grade action: whoever controls the
 * account's address can request a password reset to it, so an open session
 * alone must not be enough to move it. Same bar as changing the password.
 */
export async function requestEmailChange(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownFieldError(formData, ["new_email", "current_password"]);
  if (rejected) return rejected;

  const parsed = emailChangeSchema.safeParse({
    new_email: String(formData.get("new_email") ?? "").trim(),
    current_password: String(formData.get("current_password") ?? ""),
  });
  if (!parsed.success) return firstIssue(parsed.error);
  if (parsed.data.new_email === user.email) {
    return { error: "That's already your email." };
  }

  // Checked AFTER validation so a malformed request can't burn the budget,
  // but BEFORE the send: this is the one signed-in action that mails an
  // address the caller chose, so it is the one that can be aimed at someone
  // else's inbox. It also bounds the re-auth attempts below.
  if (!(await rateLimit("email_change", RATE_LIMITS.emailChange))) {
    return {
      error:
        "Too many email-change requests. Wait a while before trying again.",
    };
  }

  const origin = await siteOrigin();
  const supabase = await createClient();

  // Accounts created through an OAuth provider and never given a password have
  // none to verify, so requiring one would lock them out of a field they can
  // still legitimately change. Everyone else must prove they hold it: this is
  // a takeover-grade action, since whoever controls the address can reset the
  // password to it.
  if (await accountHasPassword(user.id)) {
    if (!parsed.data.current_password) {
      return { error: "Enter your current password to change your email." };
    }
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: parsed.data.current_password,
    });
    if (reauthError) return { error: "Current password is incorrect." };
  }

  const { error } = await supabase.auth.updateUser(
    { email: parsed.data.new_email },
    { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/settings/account")}` },
  );
  if (error) return { error: "Could not start the email change. Try again." };

  await safeAlert(user.id, "email.change_requested", {
    title: "Email change requested",
    body: "Someone asked to move this account to a new email address. It only takes effect once the link in that inbox is confirmed. If this wasn't you, change your password now.",
  });

  return {
    success: "Check your inbox. The change applies once you confirm the link.",
  };
}

/** Password changes go through Supabase auth, gated on the current password. */
export async function changePassword(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await getUser();
  if (!user || !user.email) return SIGNED_OUT;
  const rejected = unknownFieldError(formData, [
    "current_password",
    "new_password",
    "confirm_password",
  ]);
  if (rejected) return rejected;

  const parsed = passwordChangeSchema.safeParse({
    current_password: String(formData.get("current_password") ?? ""),
    new_password: String(formData.get("new_password") ?? ""),
    confirm_password: String(formData.get("confirm_password") ?? ""),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  // Same strength bar as sign-up and recovery reset. All three set a password,
  // so all three answer to one rule; a weaker one here would be the way around
  // the other two.
  const weak = passwordProblem(parsed.data.new_password, {
    email: user.email,
    username:
      typeof user.user_metadata?.username === "string"
        ? user.user_metadata.username
        : undefined,
  });
  if (weak) return { error: weak };

  // The re-auth below verifies a caller-supplied password, which makes this
  // endpoint a password ORACLE: without a budget, a hijacked session could sit
  // here guessing the current password unthrottled. Bounded before the guess
  // is checked, and shares the budget with the reset mail for the same reason.
  if (!(await rateLimit("password_reauth", RATE_LIMITS.passwordReauth))) {
    return {
      error: "Too many attempts. Wait a few minutes before trying again.",
    };
  }

  const supabase = await createClient();
  // Re-authenticate before allowing the change: a stolen open session must
  // not be enough to take over the account.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.current_password,
  });
  if (reauthError) return { error: "Current password is incorrect." };

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.new_password,
  });
  if (error) {
    return error.code === "same_password"
      ? { error: "That's already your password." }
      : { error: "Could not update the password. Try again." };
  }

  // Changing a password must not leave the OLD credential's sessions alive.
  // If the reason for the change is "someone else got in", a still-valid
  // session elsewhere defeats the entire point. `others` keeps this device
  // signed in, so the user is not logged out of the tab they are using.
  await revokeOtherSessions(supabase);

  await safeAlert(user.id, "password.changed", {
    title: "Your password was changed",
    body: "The password on this account was just changed and other devices were signed out. If this wasn't you, reset your password immediately.",
  });

  return { success: "Password updated. Other devices have been signed out." };
}

/**
 * "Forgot your current password?" escape hatch for a signed-in user who can't
 * complete the change-password form (which requires the current password).
 * Emails a recovery link to their own account address, never a
 * client-supplied one, which lands on /reset-password to set a new password
 * without the old.
 */
export async function sendPasswordReset(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await getUser();
  if (!user?.email) return SIGNED_OUT;
  const rejected = unknownFieldError(formData, []);
  if (rejected) return rejected;

  // TWO budgets, and the second is not redundant. The per-user one is spent by
  // whoever holds a session, so an attacker working through several
  // compromised accounts gets a fresh five per victim. The client-keyed one
  // caps what a single origin can send in total, so inbox-flooding cost does
  // not scale with how many accounts they have reached. Same pairing the
  // signed-out mail path uses (allowAuthEmail).
  if (!(await rateLimit("password_reset", RATE_LIMITS.passwordReset))) {
    return { error: "Too many reset emails. Wait a while before trying again." };
  }
  const perClient = await rateLimitKey(
    await clientKey(await headers()),
    "password_reset_client",
    RATE_LIMITS.passwordResetPerClient,
  );
  if (!perClient) {
    return { error: "Too many reset emails. Wait a while before trying again." };
  }

  const origin = await siteOrigin();
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
  });
  if (error) {
    return error.code === "over_email_send_rate_limit"
      ? { error: "Too many requests. Wait a minute and try again." }
      : { error: "Could not send the reset email. Try again." };
  }

  // The one alert that reliably reaches its target: requesting a link does not
  // sign anyone out, so the owner is still able to read this and act.
  await safeAlert(user.id, "password.reset_requested", {
    title: "A password reset link was requested",
    body: "Someone asked for a link to set a new password on this account. If it wasn't you, ignore the email and change your password.",
  });

  return { success: "Reset link sent. Check your inbox." };
}

// --- Legal -----------------------------------------------------------------

export async function acceptLegal(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownFieldError(formData, ["version"]);
  if (rejected) return rejected;

  const parsed = legalAcceptSchema.safeParse({
    version: String(formData.get("version") ?? ""),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  const ok = await updateOwnProfile(user.id, {
    legal_accepted_at: new Date().toISOString(),
    legal_accepted_version: LEGAL_VERSION,
  });
  if (!ok) return SAVE_FAILED;
  revalidatePath("/settings/legal");
  return { success: "Accepted. Thanks for reading the fine print." };
}

// --- Tax & seller details ---------------------------------------------------

// The account's trader identity: read by every hosted product page this
// account sells on (lib/settings/seller-identity.ts), set once here rather
// than per storefront. `tax_business_name` / `tax_vat_id` / `tax_country`
// started as VAT/invoicing fields; `seller_address` / `seller_email` /
// `seller_phone` fill in what distance-selling law also asks for.
export async function saveTaxInfo(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownFieldError(formData, [
    "tax_business_name",
    "seller_address",
    "seller_email",
    "tax_vat_id",
    "tax_country",
    "seller_phone",
  ]);
  if (rejected) return rejected;

  const parsed = taxSchema.safeParse({
    tax_business_name: String(formData.get("tax_business_name") ?? ""),
    seller_address: normalizeTextareaValue(String(formData.get("seller_address") ?? "")),
    seller_email: String(formData.get("seller_email") ?? ""),
    tax_vat_id: String(formData.get("tax_vat_id") ?? ""),
    tax_country: String(formData.get("tax_country") ?? ""),
    seller_phone: String(formData.get("seller_phone") ?? ""),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  if (!(await rateLimit("settings_write", RATE_LIMITS.settingsWrite))) {
    return TOO_MANY;
  }

  if (!(await updateOwnProfile(user.id, parsed.data))) return SAVE_FAILED;
  revalidatePath("/settings/tax");
  return { success: "Business & seller details saved." };
}

// --- Notifications ---------------------------------------------------------

export async function saveNotifications(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownFieldError(formData, [
    "notify_sales",
    "notify_product_updates",
    "notify_marketing",
  ]);
  if (rejected) return rejected;

  const parsed = notificationsSchema.safeParse({
    notify_sales: formData.get("notify_sales") === "on",
    notify_product_updates: formData.get("notify_product_updates") === "on",
    notify_marketing: formData.get("notify_marketing") === "on",
  });
  if (!parsed.success) return firstIssue(parsed.error);

  if (!(await rateLimit("settings_write", RATE_LIMITS.settingsWrite))) {
    return TOO_MANY;
  }

  if (!(await updateOwnProfile(user.id, parsed.data))) return SAVE_FAILED;
  revalidatePath("/settings/notifications");
  return { success: "Preferences saved." };
}

// --- Danger zone -----------------------------------------------------------

/**
 * Deliberately a "request deletion" soft flag, not a hard delete. A complete
 * hard delete needs a service-role job (auth.admin.deleteUser cascades to
 * profiles/products/storefronts) plus R2 object cleanup. Wiring that here
 * with the anon-key client would silently half-delete, so we flag instead.
 * Owner-scoped: the id comes from the session, never from the client.
 */
export async function requestAccountDeletion(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownFieldError(formData, ["confirm"]);
  if (rejected) return rejected;

  const parsed = deleteConfirmSchema.safeParse({
    confirm: String(formData.get("confirm") ?? ""),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  if (!(await rateLimit("settings_write", RATE_LIMITS.settingsWrite))) {
    return TOO_MANY;
  }

  const requestedAt = new Date().toISOString();
  const ok = await updateOwnProfile(user.id, {
    deletion_requested_at: requestedAt,
  });
  if (!ok) return SAVE_FAILED;
  // Deliberate audit trail for a sensitive action.
  console.warn(
    `[settings] account deletion REQUESTED user=${user.id} at=${requestedAt}`,
  );
  revalidatePath("/settings/danger");
  return { success: "Deletion requested." };
}

export async function cancelAccountDeletion(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownFieldError(formData, []);
  if (rejected) return rejected;

  if (!(await updateOwnProfile(user.id, { deletion_requested_at: null }))) {
    return SAVE_FAILED;
  }
  console.warn(`[settings] account deletion CANCELLED user=${user.id}`);
  revalidatePath("/settings/danger");
  return { success: "Deletion request cancelled. Good to have you back." };
}
