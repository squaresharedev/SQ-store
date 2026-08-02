"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getUser, revokeOtherSessions } from "@/lib/auth/session";
import { LEGAL_VERSION } from "@/lib/settings/constants";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import {
  deleteConfirmSchema,
  displayNameSchema,
  emailChangeSchema,
  legalAcceptSchema,
  notificationsSchema,
  passwordChangeSchema,
  taxSchema,
} from "@/lib/validation/settings";
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
 * Whether this account can be re-authenticated with a password.
 *
 * Accounts created purely through an OAuth provider have no password, so
 * asking for one would be an unanswerable question rather than a security
 * control. Checked against the identity list rather than assumed from the
 * presence of an email, since OAuth accounts have an email too.
 */
function hasPasswordIdentity(user: User): boolean {
  return (user.identities ?? []).some((identity) => identity.provider === "email");
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
 * A user's name is also their unique handle (case-insensitive) — no separate
 * username field. The live availability check (see
 * /api/settings/display-name-available) is a UX nicety only; the real guard
 * is the DB's partial unique index on lower(display_name), so a race between
 * two tabs still can't produce a collision. We don't use updateOwnProfile
 * here because we need the raw Postgres error code to tell "taken" apart
 * from a generic save failure.
 */
export async function updateDisplayName(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownFieldError(formData, ["display_name"]);
  if (rejected) return rejected;

  const parsed = displayNameSchema.safeParse({
    display_name: String(formData.get("display_name") ?? ""),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  if (!(await rateLimit("settings_write", RATE_LIMITS.settingsWrite))) {
    return TOO_MANY;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.display_name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) {
    return error.code === "23505"
      ? { error: "That name is taken. Try another." }
      : SAVE_FAILED;
  }
  revalidatePath("/settings/account");
  return { success: "Name saved." };
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

  // Accounts created through an OAuth provider have no password to verify.
  // Their address is the provider's, so requiring one would lock them out of
  // a field they can still legitimately change.
  if (hasPasswordIdentity(user)) {
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

  // Only ever mails the account's own address, so this bounds nuisance volume
  // rather than a vector at a third party. Supabase enforces its own send
  // limit too; ours keeps the request from reaching it in the first place.
  if (!(await rateLimit("password_reset", RATE_LIMITS.passwordReset))) {
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

// --- Tax -------------------------------------------------------------------

// Collected for upcoming EU VAT/invoicing work. Nothing downstream consumes
// these fields yet.
export async function saveTaxInfo(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownFieldError(formData, [
    "tax_business_name",
    "tax_vat_id",
    "tax_country",
  ]);
  if (rejected) return rejected;

  const parsed = taxSchema.safeParse({
    tax_business_name: String(formData.get("tax_business_name") ?? ""),
    tax_vat_id: String(formData.get("tax_vat_id") ?? ""),
    tax_country: String(formData.get("tax_country") ?? ""),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  if (!(await rateLimit("settings_write", RATE_LIMITS.settingsWrite))) {
    return TOO_MANY;
  }

  if (!(await updateOwnProfile(user.id, parsed.data))) return SAVE_FAILED;
  revalidatePath("/settings/tax");
  return { success: "Tax details saved." };
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
