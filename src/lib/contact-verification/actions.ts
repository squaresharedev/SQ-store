"use server";

// The two controls a seller has over proving their contact details: "send me
// a code" and "here is the code". Both act on the SIGNED-IN user's own
// profile only (Settings is scoped to the session, never the active store),
// and neither takes the address or number from the request: see
// lib/contact-verification/service.ts for the guarantees and the budgets.

import { revalidatePath } from "next/cache";
import { getUser } from "@/lib/auth/session";
import { actionError, failed, invalidInput, succeeded, type ActionState } from "@/lib/errors";
import { msg } from "@/i18n/types";
import { unknownField } from "@/lib/validation/form-fields";
import { firstIssue } from "@/lib/validation/messages";
import {
  confirmContactCodeSchema,
  sendContactCodeSchema,
} from "@/lib/validation/contact-verification";
import { issueContactCode, redeemContactCode } from "@/lib/contact-verification/service";
import { TRADER_IDENTITY_HREF } from "@/lib/settings/trader-identity";

const SIGNED_OUT: ActionState = failed(
  actionError("session_expired", msg("Errors.form.sessionExpired")),
);

/** Send a code to the stored email or phone. */
export async function sendContactCode(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownField(formData, ["channel"]);
  if (rejected) return rejected;

  const parsed = sendContactCodeSchema.safeParse({ channel: formData.get("channel") });
  if (!parsed.success) return failed(invalidInput(firstIssue(parsed.error)));
  const { channel } = parsed.data;

  const result = await issueContactCode(user.id, channel);
  if (!result.ok) return failed(result.error);
  if (result.status === "alreadyConfirmed") {
    return succeeded(msg("Settings.contactVerification.success.alreadyConfirmed"));
  }
  return succeeded(
    msg("Settings.contactVerification.success.sent", { channel, target: result.target }),
  );
}

/** Check the typed code and, if right, prove the detail it was sent to. */
export async function confirmContactCode(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownField(formData, ["channel", "code"]);
  if (rejected) return rejected;

  const parsed = confirmContactCodeSchema.safeParse({
    channel: formData.get("channel"),
    code: String(formData.get("code") ?? ""),
  });
  if (!parsed.success) return failed(invalidInput(firstIssue(parsed.error)));
  const { channel, code } = parsed.data;

  const result = await redeemContactCode(user.id, channel, code);
  if (!result.ok) return failed(result.error);

  // Proof changes what the publish gate says (dashboard banner, checklist,
  // product form) and whether buyers see the phone, so every surface that
  // shows either is re-rendered.
  revalidatePath(TRADER_IDENTITY_HREF);
  revalidatePath("/dashboard");
  return succeeded(msg("Settings.contactVerification.success.confirmed", { channel }));
}
