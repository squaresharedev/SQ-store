"use server";

import { revalidatePath } from "next/cache";
import { agentAccessEnabled } from "@/lib/agent/access";
import { judgeAuthorizeRequest } from "@/lib/agent/oauth/authorize";
import { createGrantWithCode, revokeGrantForUser } from "@/lib/agent/oauth/grants";
import { redirectWith } from "@/lib/agent/oauth/redirects";
import { CONNECTED_APPS_PATH, oauthIssuer } from "@/lib/agent/paths";
import { AGENT_SCOPE_IDS, AGENT_SCOPES, knownScopes } from "@/lib/agent/scopes";
import { STEP_UP_FIELDS, requireStepUpState } from "@/lib/auth/mfa";
import { getUser } from "@/lib/auth/session";
import {
  actionError,
  failed,
  invalidInput,
  type ActionState,
} from "@/lib/errors";
import { msg } from "@/i18n/types";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { alertSecurityEvent, recordSecurityEvent } from "@/lib/security/events";
import { getAccessibleAccounts } from "@/lib/team/account-context";
import { unknownField } from "@/lib/validation/form-fields";

/**
 * The seller's yes to an app, and their taking it back. Each is on the person's
 * own session: an assistant cannot approve itself (no tool reaches these) and
 * cannot grow its own grant.
 */

export type ConsentState = ActionState & {
  /** Where to send the browser: back to the app, with its code. */
  redirectTo?: string;
};

const CONSENT_FIELDS = [
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "resource",
  "account_id",
  "scope",
] as const;

const SIGNED_OUT = failed(actionError("session_expired", msg("Errors.form.sessionExpired")));
const TOO_MANY = failed(actionError("rate_limited", msg("Errors.form.tooManyChanges")));

export async function approveAgentConnection(
  _prev: ConsentState,
  formData: FormData,
): Promise<ConsentState> {
  if (!agentAccessEnabled()) return failed(invalidInput(msg("Errors.agent.requestInvalid")));
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownField(formData, [...CONSENT_FIELDS, ...STEP_UP_FIELDS]);
  if (rejected) return rejected;

  const field = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : undefined;
  };

  // Everything in this form came back through the browser, so the whole request
  // is judged again rather than trusted because the page judged it once.
  const judged = await judgeAuthorizeRequest({
    response_type: "code",
    code_challenge_method: "S256",
    client_id: field("client_id"),
    redirect_uri: field("redirect_uri"),
    state: field("state"),
    code_challenge: field("code_challenge"),
    resource: field("resource"),
  });
  if (judged.kind !== "ok") return failed(invalidInput(msg("Errors.agent.requestInvalid")));

  // Only a store this person can act on, from the database's own answer.
  const accountId = field("account_id");
  const accounts = await getAccessibleAccounts();
  if (!accounts.some((account) => account.accountId === accountId)) {
    return failed(invalidInput(msg("Errors.agent.requestInvalid")));
  }

  if (!(await rateLimit("agent_consent", RATE_LIMITS.agentConsent))) return TOO_MANY;

  // This hands out a credential that outlives the session, so an account with
  // 2FA on has to prove it is really them, as for anything else that serious.
  const stepUp = await requireStepUpState(formData);
  if (stepUp) return stepUp;

  const picked = knownScopes(formData.getAll("scope").map(String));
  const scopes = AGENT_SCOPE_IDS.filter(
    (id) => picked.includes(id) || "required" in AGENT_SCOPES[id],
  );

  const code = await createGrantWithCode(
    {
      userId: user.id,
      accountId: accountId as string,
      clientId: judged.client.id,
      scopes,
      resource: judged.params.resource,
    },
    { challenge: judged.params.codeChallenge, redirectUri: judged.params.redirectUri },
  );
  if (!code) return failed(actionError("server_error", msg("Errors.form.saveFailed")));

  // Told where they will see it even if it was not them: an approval is a new
  // way into the store, like a new sign-in.
  await alertSecurityEvent(user.id, "agent.connected", {
    title: { key: "Notifications.messages.security.agentConnected.title" },
    body: { key: "Notifications.messages.security.agentConnected.body", values: { app: judged.client.name } },
    href: CONNECTED_APPS_PATH,
    emailTo: user.email,
  });

  return {
    redirectTo: redirectWith(judged.params.redirectUri, {
      code,
      state: judged.params.state,
      iss: oauthIssuer(),
    }),
  };
}

export async function revokeConnectedApp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  const rejected = unknownField(formData, ["grant_id"]);
  if (rejected) return rejected;
  if (!(await rateLimit("settings_write", RATE_LIMITS.settingsWrite))) return TOO_MANY;

  const grantId = formData.get("grant_id");
  if (typeof grantId !== "string" || !(await revokeGrantForUser(grantId, user.id))) {
    return failed(actionError("server_error", msg("Errors.form.saveFailed")));
  }
  await recordSecurityEvent({ userId: user.id, event: "agent.revoked" });
  revalidatePath(CONNECTED_APPS_PATH);
  return { success: msg("Settings.connectedApps.revoked") };
}
