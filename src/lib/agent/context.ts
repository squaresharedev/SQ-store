import { AsyncLocalStorage } from "node:async_hooks";
import type { User } from "@supabase/supabase-js";
import type { AgentScope } from "@/lib/agent/scopes";

/**
 * WHO IS CALLING, when the caller is an assistant rather than a browser.
 *
 * Everything server-side finds its identity through three functions:
 * createClient (lib/supabase/server.ts), getSessionState (lib/auth/session.ts)
 * and getActiveAccount (lib/team/account-context.ts). All three read cookies.
 * Rather than a second copy of every action that takes a token, each of them
 * looks here first, so one agent request runs the SAME actions and queries a
 * browser does: same validation, same publish gate, same plan limits, same
 * moderation, with row level security underneath all of it.
 *
 * Outside runAsAgent this returns null and those functions behave exactly as
 * they always did. It cannot be entered from a request: only the /mcp route
 * calls runAsAgent, after lib/agent/authenticate.ts has checked the token.
 */
export type AgentContext = {
  user: User;
  /** The one store this connection may act on, chosen when it was approved. */
  accountId: string;
  grantId: string;
  clientId: string;
  scopes: ReadonlySet<AgentScope>;
  /** A 5-minute user JWT (lib/agent/mint.ts). It never leaves this server. */
  jwt: string;
};

const storage = new AsyncLocalStorage<AgentContext>();

/** The calling assistant, or null for an ordinary browser request. */
export function agentContext(): AgentContext | null {
  return storage.getStore() ?? null;
}

/** Run `fn`, and everything it awaits, as this assistant. */
export function runAsAgent<T>(context: AgentContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}
