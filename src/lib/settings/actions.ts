"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getAssurance, getUser } from "@/lib/auth/session";
import { STEP_UP_FIELDS, requireStepUpState } from "@/lib/auth/mfa";
import { checkPassword } from "@/lib/auth/reauth";
import { LEGAL_VERSION } from "@/lib/settings/constants";
import { RATE_LIMITS, clientKey, rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { alertSecurityEvent } from "@/lib/security/events";
import { accountHasPassword } from "@/lib/auth/has-password";
import {
  bioSchema,
  deleteConfirmSchema,
  emailChangeSchema,
  legalAcceptSchema,
  notificationsSchema,
  taxSchema,
} from "@/lib/validation/settings";
import { hasMailExchanger } from "@/lib/validation/email-domain";
import { normalizeSellerPhone } from "@/lib/validation/phone";
import { unknownField } from "@/lib/validation/form-fields";
import { contactChannelAvailable } from "@/lib/contact-verification/availability";
import { issueContactCode } from "@/lib/contact-verification/service";
import type { ContactChannel } from "@/lib/contact-verification/policy";
import { usernameSchema } from "@/lib/validation/auth";
import { firstIssue } from "@/lib/validation/messages";
import {
  actionError,
  failed,
  invalidInput,
  succeeded,
  type ActionState,
} from "@/lib/errors";
import { msg } from "@/i18n/types";
import type { Tables, TablesUpdate } from "@/types";
import type { z } from "zod";

const SIGNED_OUT: ActionState = failed(
  actionError("session_expired", msg("Errors.form.sessionExpired")),
);
const SAVE_FAILED: ActionState = failed(
  actionError("server_error", msg("Errors.form.saveFailed")),
);

/** Shown when a signed-in write budget is spent. Deliberately vague about the
 *  exact limit: the number is an implementation detail, and naming it only
 *  helps someone pace around it. */
const TOO_MANY: ActionState = failed(
  actionError("rate_limited", msg("Errors.form.tooManyChanges")),
);

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

// Every action below starts with `unknownField` (lib/validation/form-fields.ts),
// the field whitelist: with the strict Zod schemas and column-by-column update
// objects, there is no path for a user to touch `id`, `is_seller`,
// `avatar_url`, a contact proof or any other column through settings.

function invalid(error: z.ZodError): ActionState {
  return failed(invalidInput(firstIssue(error)));
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
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownField(formData, ["username"]);
  if (rejected) return rejected;

  const parsed = usernameSchema.safeParse({
    username: String(formData.get("username") ?? ""),
  });
  if (!parsed.success) return invalid(parsed.error);

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
      ? failed(invalidInput(msg("Errors.settings.usernameTaken")))
      : SAVE_FAILED;
  }
  revalidatePath("/settings/account");
  return succeeded(msg("Settings.account.success.usernameSaved"));
}

/**
 * The account's public bio: a short line shown in the Seller section of every
 * hosted product page this account sells on (lib/settings/seller-identity.ts
 * reads it into `StorefrontSeller.bio` alongside the trader-identity fields,
 * because it is shown in the same place — but it carries no legal weight and
 * the publish gate never asks for it, which is why it lives here, next to the
 * account's other public-identity fact, rather than in saveTaxInfo below).
 *
 * Writes the SAME `seller_bio` column that field started on before this split;
 * only the settings page that edits it, and the schema that gates the write,
 * moved.
 */
export async function updateBio(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownField(formData, ["seller_bio"]);
  if (rejected) return rejected;

  const parsed = bioSchema.safeParse({
    seller_bio: String(formData.get("seller_bio") ?? ""),
  });
  if (!parsed.success) return invalid(parsed.error);

  if (!(await rateLimit("settings_write", RATE_LIMITS.settingsWrite))) {
    return TOO_MANY;
  }

  if (!(await updateOwnProfile(user.id, { seller_bio: parsed.data.seller_bio }))) {
    return SAVE_FAILED;
  }
  revalidatePath("/settings/account");
  return succeeded(msg("Settings.account.success.bioSaved"));
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
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownField(formData, [
    "new_email",
    "current_password",
    ...STEP_UP_FIELDS,
  ]);
  if (rejected) return rejected;

  const parsed = emailChangeSchema.safeParse({
    new_email: String(formData.get("new_email") ?? "").trim(),
    current_password: String(formData.get("current_password") ?? ""),
  });
  if (!parsed.success) return invalid(parsed.error);
  if (parsed.data.new_email === user.email) {
    return failed(invalidInput(msg("Errors.settings.emailUnchanged")));
  }

  // Checked AFTER validation so a malformed request can't burn the budget,
  // but BEFORE the send: this is the one signed-in action that mails an
  // address the caller chose, so it is the one that can be aimed at someone
  // else's inbox. It also bounds the re-auth attempts below.
  if (!(await rateLimit("email_change", RATE_LIMITS.emailChange))) {
    return failed(actionError("rate_limited", msg("Errors.settings.emailChangeRateLimited")));
  }

  const hasPassword = await accountHasPassword(user.id);

  // With 2FA on, the address is a second-factor-grade change too. With a
  // password as well, a code from the last few minutes will do (the password
  // below is the other half). WITHOUT a password (a Google-only account) the
  // code is the ONLY proof, so it must come with this very request: otherwise
  // a session cookie lifted within ten minutes of its owner's sign-in could
  // move the address with no proof at all, and then reset its way in.
  const stepUp = await requireStepUpState(formData, hasPassword ? {} : { maxAgeSeconds: 0 });
  if (stepUp) return stepUp;

  const origin = await siteOrigin();
  const supabase = await createClient();
  const twoFactor = (await getAssurance())?.enrolled === true;

  // Accounts created through an OAuth provider and never given a password have
  // none to verify, so requiring one would lock them out of a field they can
  // still legitimately change. Everyone else must prove they hold it: this is
  // a takeover-grade action, since whoever controls the address can reset the
  // password to it.
  if (hasPassword) {
    if (!parsed.data.current_password) {
      return failed(invalidInput(msg("Errors.settings.emailChangeNeedsPassword")));
    }
    if (twoFactor) {
      // Checked on a throwaway client: signing in on THIS one would swap the
      // two-factor session for a password-only one mid-task.
      const check = await checkPassword(user.email ?? "", parsed.data.current_password);
      if (check === "unavailable") {
        return failed(actionError("server_error", msg("Errors.settings.passwordCheckUnavailable")));
      }
      if (check === "incorrect") return failed(invalidInput(msg("Errors.settings.wrongPassword")));
    } else {
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email!,
        password: parsed.data.current_password,
      });
      if (reauthError) return failed(invalidInput(msg("Errors.settings.wrongPassword")));
    }
  }

  const { error } = await supabase.auth.updateUser(
    { email: parsed.data.new_email },
    { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/settings/account")}` },
  );
  if (error) {
    return failed(actionError("server_error", msg("Errors.settings.emailChangeFailed")));
  }

  await safeAlert(user.id, "email.change_requested", {
    title: { key: "Notifications.messages.security.emailChangeRequested.title" },
    body: { key: "Notifications.messages.security.emailChangeRequested.body" },
    // To the CURRENT address: the one an intruder is trying to take away.
    emailTo: user.email,
  });

  return succeeded(msg("Settings.account.success.emailChangeStarted"));
}

const RESET_RATE_LIMITED: ActionState = failed(
  actionError("rate_limited", msg("Errors.settings.resetRateLimited")),
);

/**
 * THE way a signed-in person changes their password from Settings: a link to
 * their own account address (never a client-supplied one), which lands on
 * /reset-password to set a new password (lib/auth/actions.ts resetPassword
 * signs out the other devices and sends the security alert).
 *
 * There is deliberately no "change" action that takes the current password.
 * Settings never asks for, holds or shows the existing password on the way to a
 * new one: a field for it is one a browser fills, and one a toggle can reveal.
 * The emailed link proves the inbox instead, and with two-factor on, the link
 * asks for a code as well.
 */
export async function sendPasswordReset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user?.email) return SIGNED_OUT;
  const rejected = unknownField(formData, []);
  if (rejected) return rejected;

  // TWO budgets, and the second is not redundant. The per-user one is spent by
  // whoever holds a session, so an attacker working through several
  // compromised accounts gets a fresh five per victim. The client-keyed one
  // caps what a single origin can send in total, so inbox-flooding cost does
  // not scale with how many accounts they have reached. Same pairing the
  // signed-out mail path uses (allowAuthEmail).
  if (!(await rateLimit("password_reset", RATE_LIMITS.passwordReset))) {
    return RESET_RATE_LIMITED;
  }
  const perClient = await rateLimitKey(
    await clientKey(await headers()),
    "password_reset_client",
    RATE_LIMITS.passwordResetPerClient,
  );
  if (!perClient) return RESET_RATE_LIMITED;

  const origin = await siteOrigin();
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
  });
  if (error) {
    return error.code === "over_email_send_rate_limit"
      ? failed(actionError("rate_limited", msg("Errors.settings.resetSendRateLimited")))
      : failed(actionError("server_error", msg("Errors.settings.resetFailed")));
  }

  // The one alert that reliably reaches its target: requesting a link does not
  // sign anyone out, so the owner is still able to read this and act.
  await safeAlert(user.id, "password.reset_requested", {
    title: { key: "Notifications.messages.security.resetRequested.title" },
    body: { key: "Notifications.messages.security.resetRequested.body" },
  });

  return succeeded(msg("Settings.account.success.resetSent"));
}

// --- Legal -----------------------------------------------------------------

/**
 * Record that the signed-in person agrees to the Terms of Service: the moment,
 * and WHICH Terms (LEGAL_VERSION). Called from the welcome flow's terms step
 * and from Settings › Legal, both of which only offer it once the summary has
 * been read to its end.
 *
 * The form posts the version it showed, and anything but the current one is
 * refused (legalAcceptSchema), so an agreement can never be recorded against
 * Terms the person was not looking at. Their own row only (id from the
 * session, RLS underneath).
 */
export async function acceptLegal(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownField(formData, ["version"]);
  if (rejected) return rejected;

  const parsed = legalAcceptSchema.safeParse({
    version: String(formData.get("version") ?? ""),
  });
  if (!parsed.success) return invalid(parsed.error);

  const ok = await updateOwnProfile(user.id, {
    legal_accepted_at: new Date().toISOString(),
    legal_accepted_version: LEGAL_VERSION,
  });
  if (!ok) return SAVE_FAILED;
  revalidatePath("/settings/legal");
  // Overview's attention row asks for this until it is on file.
  revalidatePath("/dashboard");
  return succeeded(msg("Settings.legal.success.termsAgreed"));
}

// --- Tax & seller details ---------------------------------------------------

// The account's trader identity: read by every hosted product page this
// account sells on (lib/settings/seller-identity.ts), set once here rather
// than per storefront. `tax_business_name` / `tax_vat_id` / `tax_country`
// started as VAT/invoicing fields; `seller_address` / `seller_email` /
// `seller_phone` fill in what distance-selling law also asks for. The bio
// (`seller_bio`) is edited from Settings › Account instead (see updateBio
// above) — it carries no legal weight, so it is not one of these fields.
/** The columns saveTaxInfo may write, in the order the settings form asks for
 *  them. The field whitelist and the partial-write rule both read this list,
 *  so they cannot disagree about what counts as a tax field. */
const TAX_FIELDS = [
  "tax_business_name",
  "seller_address",
  "seller_email",
  "tax_vat_id",
  "tax_country",
  "seller_phone",
] as const;
type TaxField = (typeof TAX_FIELDS)[number];

export async function saveTaxInfo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownField(formData, [...TAX_FIELDS, ...STEP_UP_FIELDS]);
  if (rejected) return rejected;

  // ONLY WHAT WAS SENT IS WRITTEN. The settings form posts every field, so
  // for it nothing changes. The dashboard welcome flow posts just the three
  // the publish gate needs, and must not blank a VAT ID, a country or a phone
  // number it never showed. A key that is ABSENT leaves its column alone; a
  // key sent EMPTY still clears it, which is how the settings form removes a
  // value on purpose.
  const present = TAX_FIELDS.filter((field) => formData.has(field));
  if (present.length === 0) return failed(invalidInput(msg("Validation.checkForm")));

  const input: Partial<Record<TaxField, string>> = {};
  for (const field of present) {
    const raw = String(formData.get(field) ?? "");
    input[field] = field === "seller_address" ? normalizeTextareaValue(raw) : raw;
  }
  const parsed = taxSchema.partial().safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  // The legal identity buyers see and the address their questions go to: an
  // intruder rewriting these redirects a seller's customers, so with 2FA on it
  // takes a recent code.
  const stepUp = await requireStepUpState(formData);
  if (stepUp) return stepUp;

  if (!(await rateLimit("settings_write", RATE_LIMITS.settingsWrite))) {
    return TOO_MANY;
  }

  // The one check that needs the network, so it sits AFTER the budget: the
  // sync filters (format, placeholder, throwaway provider) have already thrown
  // out everything that can be settled for free, and a resolver query is only
  // spent on an address that has passed them all.
  //
  // Only a definitive "this domain takes no mail" refuses the save; a resolver
  // that did not answer means the address is accepted. See
  // lib/validation/email-domain.ts for why this end fails open while the rest
  // of the gate does not.
  if (parsed.data.seller_email) {
    if ((await hasMailExchanger(parsed.data.seller_email)) === "no") {
      return failed(invalidInput(msg("Errors.settings.contactEmailTakesNoMail")));
    }
  }

  // What is stored now decides two things: which contact details CHANGED (and
  // so need a fresh code), and how a phone typed without its country code is
  // read. Read before the write, since the write is what makes it unknowable.
  // Only asked when a contact detail was sent at all: a submission that leaves
  // both out (the welcome flow never shows the phone) cannot have changed them.
  const sentContact = present.includes("seller_email") || present.includes("seller_phone");
  let current: Pick<Tables<"profiles">, "seller_email" | "seller_phone" | "tax_country"> | null =
    null;
  if (sentContact) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("profiles")
      .select("seller_email, seller_phone, tax_country")
      .eq("id", user.id)
      .maybeSingle();
    current = data;
  }

  const update: TablesUpdate<"profiles"> = { ...parsed.data };

  // One canonical spelling per number (E.164), and only a number that can be
  // proven by text: see lib/validation/phone.ts. "087 …" is read in the
  // country this same form sets, or the one already on file.
  if (parsed.data.seller_phone) {
    const phone = normalizeSellerPhone(
      parsed.data.seller_phone,
      present.includes("tax_country") ? parsed.data.tax_country : current?.tax_country,
    );
    if (!phone.ok) return failed(invalidInput(msg(phone.problem)));
    update.seller_phone = phone.e164;
  }

  // Which details now need proving. The proof itself is never touched here:
  // the guard_contact_proof trigger drops it in the same statement that
  // changes the value, whoever writes it, so no code path can forget to.
  const changed = (["email", "phone"] as const satisfies readonly ContactChannel[]).filter(
    (channel) => {
      const column = channel === "email" ? "seller_email" : "seller_phone";
      if (!present.includes(column)) return false;
      const next = update[column] ?? null;
      return next !== null && next !== (current?.[column] ?? null);
    },
  );

  if (!(await updateOwnProfile(user.id, update))) return SAVE_FAILED;
  revalidatePath("/settings/tax");

  // A code goes out for each changed detail this deployment can prove. The
  // DETAILS ARE SAVED either way: reporting a failed send as a failed save
  // would be a lie, and "Send code" beside the field is the recovery.
  const toProve = changed.filter(contactChannelAvailable);
  const sent: Partial<Record<ContactChannel, string>> = {};
  for (const channel of toProve) {
    const issued = await issueContactCode(user.id, channel);
    if (!issued.ok) {
      return failed(
        actionError("server_error", msg("Errors.contactVerification.savedButNotSent")),
      );
    }
    if (issued.status === "sent") sent[channel] = issued.target;
  }

  if (sent.email || sent.phone) {
    return succeeded(
      msg("Settings.tax.success.savedCodeSent", {
        which: sent.email && sent.phone ? "both" : sent.email ? "email" : "phone",
        email: sent.email ?? "",
        phone: sent.phone ?? "",
      }),
    );
  }
  return succeeded(msg("Settings.tax.success.sellerDetailsSaved"));
}

// --- Notifications ---------------------------------------------------------

export async function saveNotifications(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownField(formData, [
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
  if (!parsed.success) return invalid(parsed.error);

  if (!(await rateLimit("settings_write", RATE_LIMITS.settingsWrite))) {
    return TOO_MANY;
  }

  if (!(await updateOwnProfile(user.id, parsed.data))) return SAVE_FAILED;
  revalidatePath("/settings/notifications");
  return succeeded(msg("Settings.notifications.success.notificationsSaved"));
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
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownField(formData, ["confirm", ...STEP_UP_FIELDS]);
  if (rejected) return rejected;

  const parsed = deleteConfirmSchema.safeParse({
    confirm: String(formData.get("confirm") ?? ""),
  });
  if (!parsed.success) return invalid(parsed.error);

  const stepUp = await requireStepUpState(formData);
  if (stepUp) return stepUp;

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
  return succeeded(msg("Settings.danger.success.deletionRequested"));
}

export async function cancelAccountDeletion(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownField(formData, []);
  if (rejected) return rejected;

  if (!(await updateOwnProfile(user.id, { deletion_requested_at: null }))) {
    return SAVE_FAILED;
  }
  console.warn(`[settings] account deletion CANCELLED user=${user.id}`);
  revalidatePath("/settings/danger");
  return succeeded(msg("Settings.danger.success.deletionCancelled"));
}
