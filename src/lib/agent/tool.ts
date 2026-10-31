import type { z } from "zod";
import type { AgentScope } from "@/lib/agent/scopes";
import type { ActionError, ActionState } from "@/lib/errors";
import type { ActiveAccount } from "@/lib/team/account-context";
import type { TeamAction } from "@/lib/team/permissions";

/**
 * WHAT A TOOL IS. Adding a capability for assistants means adding one
 * defineTool entry in lib/agent/tools/<domain>.ts and listing it in
 * lib/agent/tools/index.ts: scope and role checks, rate limits, the audit
 * trail, error shaping and the secret check are all the dispatcher's job
 * (lib/agent/dispatch.ts), once.
 *
 * Independent of MCP on purpose. lib/agent/mcp-transport.ts is the only file
 * that knows the protocol, so another transport could serve the same tools.
 */

/** MCP's hints about what a tool does. Clients use them to decide when to ask. */
export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  /** It reaches outside the store: it emails a buyer, or fetches a URL. */
  openWorldHint?: boolean;
};

export type ToolCall = {
  account: ActiveAccount;
  grantId: string;
};

export type AgentTool<Schema extends z.ZodObject = z.ZodObject> = {
  name: string;
  title: string;
  /** Written for the model: when to use it, and what it must not assume. */
  description: string;
  scope: AgentScope;
  /** The role permission it needs. Hidden from a person without it. */
  permission: TeamAction;
  /** Only on your own store: it writes to the person, not to the store. */
  ownerOnly?: boolean;
  annotations: ToolAnnotations;
  input: Schema;
  handler: (input: z.output<Schema>, call: ToolCall) => Promise<unknown>;
};

export function defineTool<Schema extends z.ZodObject>(tool: AgentTool<Schema>): AgentTool {
  return tool as unknown as AgentTool;
}

/** Annotation presets, so each tool says what it is in one word. */
export const READ: ToolAnnotations = { readOnlyHint: true, idempotentHint: true };
export const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false };
export const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true };

/** A refusal the seller's assistant should read. */
export class ToolFailure extends Error {
  constructor(public readonly error: ActionError) {
    super(error.code);
    this.name = "ToolFailure";
  }
}

/** The `{ ok: false, error }` half of an action result becomes a ToolFailure. */
export function unwrap<T extends { ok: boolean }>(
  result: T,
): Extract<T, { ok: true }> {
  if (result.ok) return result as Extract<T, { ok: true }>;
  throw new ToolFailure((result as unknown as { error: ActionError }).error);
}

/** The same for a form action's state. */
export function unwrapState(state: ActionState): { ok: true } {
  if (state.error) throw new ToolFailure(state.error);
  return { ok: true };
}

/** Plain fields to the FormData a form action reads. `undefined` is left out. */
export function formDataFrom(fields: Record<string, string | boolean | Blob | undefined>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === false) continue;
    // A checked checkbox, which is all the form actions test for.
    if (value === true) form.set(name, "on");
    else form.set(name, value);
  }
  return form;
}
