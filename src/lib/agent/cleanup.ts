import { createAdminClient } from "@/lib/supabase/admin";

/** How long a tool's trail is kept. */
const AUDIT_RETENTION_DAYS = 90;
/** A revoked connection's row is kept this long for the settings trail. */
const REVOKED_GRANT_RETENTION_DAYS = 90;
/** An app that registered and was never connected is dropped after this. */
const UNUSED_CLIENT_RETENTION_DAYS = 30;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Drop expired codes and tokens, old trail rows, and apps nobody connected.
 * Registration is open, so that last table would otherwise grow without end.
 * True when every delete worked; the next run takes up whatever did not.
 */
export async function cleanUpAgentData(): Promise<boolean> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: connected, error: connectedError } = await admin.from("agent_grants").select("client_id");
  if (connectedError) {
    console.error("[agent] cleanup failed:", connectedError.message);
    return false;
  }
  const keepClients = [...new Set(connected.map((grant) => grant.client_id))];

  const unusedClients = admin
    .from("agent_clients")
    .delete()
    .lt("created_at", daysAgo(UNUSED_CLIENT_RETENTION_DAYS));

  const results = await Promise.all([
    admin.from("agent_auth_codes").delete().lt("expires_at", now),
    admin.from("agent_tokens").delete().lt("expires_at", now),
    admin.from("agent_uploads").delete().lt("expires_at", now),
    admin.from("agent_audit_log").delete().lt("created_at", daysAgo(AUDIT_RETENTION_DAYS)),
    admin
      .from("agent_grants")
      .delete()
      .not("revoked_at", "is", null)
      .lt("revoked_at", daysAgo(REVOKED_GRANT_RETENTION_DAYS)),
    keepClients.length > 0
      ? unusedClients.not("id", "in", `(${keepClients.map((id) => `"${id}"`).join(",")})`)
      : unusedClients,
  ]);

  let ok = true;
  for (const { error } of results) {
    if (error) {
      console.error("[agent] cleanup failed:", error.message);
      ok = false;
    }
  }
  return ok;
}
