import { z } from "zod";
import { ASSIGNABLE_ROLES } from "@/lib/team/permissions";
import { issueKey } from "@/lib/validation/messages";

/**
 * Team & Access validation schemas, shared by the client (UX hints) and the
 * server actions (the real gate — every team write re-validates here).
 *
 * SECURITY: these schemas double as the FIELD WHITELIST. Each write schema
 * enumerates exactly the inputs for that action; server actions build DB
 * writes only from parsed output, and separately reject any unexpected
 * submitted field. `account_owner_id` is always included so the server can
 * look up the actor's role against the right store — it is NEVER trusted as
 * proof of permission; `getActorRole()` confirms the caller actually belongs.
 */

export const teamInviteSchema = z.strictObject({
  account_owner_id: z.uuid(issueKey("Validation.team.invalidStore")),
  invited_email: z
    .email(issueKey("Validation.team.invalidEmail"))
    .max(254, issueKey("Validation.team.emailTooLong"))
    .trim()
    .transform((v) => v.toLowerCase()),
  role: z.enum(ASSIGNABLE_ROLES, {
    error: issueKey("Validation.team.invalidRole"),
  }),
});

export const teamAcceptSchema = z.strictObject({
  invite_id: z.uuid(issueKey("Validation.team.invalidInvite")),
});

export const teamChangeRoleSchema = z.strictObject({
  account_owner_id: z.uuid(issueKey("Validation.team.invalidStore")),
  member_id: z.uuid(issueKey("Validation.team.invalidMember")),
  role: z.enum(ASSIGNABLE_ROLES, {
    error: issueKey("Validation.team.invalidRole"),
  }),
});

export const teamRevokeSchema = z.strictObject({
  account_owner_id: z.uuid(issueKey("Validation.team.invalidStore")),
  member_id: z.uuid(issueKey("Validation.team.invalidMember")),
});
