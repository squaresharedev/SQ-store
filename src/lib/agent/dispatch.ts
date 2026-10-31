import { getTranslations } from "next-intl/server";
import { agentContext } from "@/lib/agent/context";
import { UnknownHandleError } from "@/lib/agent/object-refs";
import { recordToolCall } from "@/lib/agent/oauth/grants";
import { findSecret } from "@/lib/agent/secrets";
import { ToolFailure, type AgentTool } from "@/lib/agent/tool";
import { appUrl } from "@/lib/app-url";
import { msg, type MessageRef } from "@/i18n/types";
import {
  invalidInput,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  type ActionError,
} from "@/lib/errors";
import { RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { firstIssue } from "@/lib/validation/messages";
import type { ActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import type { AgentScope } from "@/lib/agent/scopes";

/**
 * One tool call, from a name and arguments to a result. Everything every tool
 * needs is here, so a tool is only what is particular to it.
 */

/** What comes back: the data, or the app's error envelope. */
export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: ToolErrorEnvelope };

/**
 * The app's ActionError, in words, with an absolute link. `fix` says what to do
 * next and `action.href` where, which is the part an assistant can pass on to
 * the seller when the next step is theirs.
 */
export type ToolErrorEnvelope = {
  code: string;
  message: string;
  fix?: string;
  action?: { href: string; label: string };
};

/** Whether this person may use this tool on this store, on this grant. */
export function toolAvailable(
  tool: AgentTool,
  scopes: ReadonlySet<AgentScope>,
  account: ActiveAccount,
): boolean {
  if (!scopes.has(tool.scope)) return false;
  if (!can(account.role, tool.permission)) return false;
  if (tool.ownerOnly && !account.isOwner) return false;
  return true;
}

async function toEnvelope(error: ActionError): Promise<ToolErrorEnvelope> {
  const t = await getTranslations();
  const text = (ref: MessageRef) => t(ref.key, ref.values);
  return {
    code: error.code,
    message: text(error.message),
    ...(error.fix ? { fix: text(error.fix) } : {}),
    ...(error.action
      ? { action: { href: appUrl(error.action.href), label: text(error.action.label) } }
      : {}),
  };
}

/** Whether this call changes anything, which decides its budget and its trail. */
function isWrite(tool: AgentTool): boolean {
  return tool.annotations.readOnlyHint !== true;
}

export async function callTool(tool: AgentTool, rawInput: unknown, account: ActiveAccount): Promise<ToolResult> {
  const agent = agentContext();
  if (!agent) return { ok: false, error: await toEnvelope(sessionExpired()) };

  const finish = async (outcome: string, result: ToolResult): Promise<ToolResult> => {
    if (isWrite(tool)) {
      await recordToolCall({ grantId: agent.grantId, accountId: agent.accountId, tool: tool.name, outcome });
    }
    return result;
  };

  try {
    if (!toolAvailable(tool, agent.scopes, account)) {
      throw new ToolFailure(permissionDenied(account.role, "viewStorefronts"));
    }
    const budget = isWrite(tool) ? RATE_LIMITS.agentWrite : RATE_LIMITS.agentRead;
    if (!(await rateLimitKey(`grant:${agent.grantId}`, isWrite(tool) ? "agent_write" : "agent_read", budget))) {
      throw new ToolFailure(rateLimited("agentTools"));
    }

    const parsed = tool.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      throw new ToolFailure(invalidInput(firstIssue(parsed.error, msg("Errors.agent.invalidInput"))));
    }

    const data = await tool.handler(parsed.data, { account, grantId: agent.grantId });

    const secret = findSecret(data);
    if (secret) {
      console.error(`[agent] ${tool.name} tried to return a secret at ${secret}. Refused.`);
      throw new ToolFailure(serverError("agentTools"));
    }
    return finish("ok", { ok: true, data });
  } catch (error) {
    if (error instanceof ToolFailure) {
      return finish(error.error.code, { ok: false, error: await toEnvelope(error.error) });
    }
    if (error instanceof UnknownHandleError) {
      return finish("invalid_input", {
        ok: false,
        error: await toEnvelope(invalidInput(msg("Errors.agent.unknownFile"), msg("Errors.agent.unknownFileFix"))),
      });
    }
    // The message may name a table or a column: it goes to the log, not out.
    console.error(`[agent] ${tool.name} failed:`, error instanceof Error ? error.message : String(error));
    return finish("server_error", { ok: false, error: await toEnvelope(serverError("agentTools")) });
  }
}
