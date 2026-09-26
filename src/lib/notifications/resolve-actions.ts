import { createClient } from "@/lib/supabase/server";
import {
  legacyInviteDetails,
  storedNotificationAction,
  type NotificationActionView,
} from "@/lib/notifications/inline-actions";
import type { Notification } from "@/lib/notifications/types";

/**
 * Server side of inline notification actions: working out, for the reader,
 * what each row can still do (the view), and which invite a click on it means
 * (the target). Both read LIVE state through the invitee's own self-gated RPCs,
 * never the row alone, so a row can never offer, or run, more than the reader
 * could do from the Team & access page.
 *
 * Fail-soft: if the lookups fail, rows simply show no inline action. The row
 * still links to the page where the same thing can be done, so a lookup
 * problem costs a shortcut, never the ability.
 */

type PendingInvite = {
  id: string;
  account_owner_id: string;
  role: string;
  store_name: string;
};

type InviteState = {
  pending: PendingInvite[];
  /** Stores the reader is an active member of (not their own). */
  memberOf: { accountOwnerId: string; storeName: string }[];
};

async function readInviteState(): Promise<InviteState | null> {
  const supabase = await createClient();
  const [pending, accounts] = await Promise.all([
    supabase.rpc("team_my_pending_invites"),
    supabase.rpc("team_my_accounts"),
  ]);
  if (pending.error || accounts.error) {
    console.warn(
      "[notifications] invite state unavailable",
      pending.error?.message ?? accounts.error?.message,
    );
    return null;
  }
  return {
    pending: (pending.data ?? []) as PendingInvite[],
    memberOf: (accounts.data ?? [])
      .filter((row) => !row.is_self)
      .map((row) => ({ accountOwnerId: row.account_owner_id, storeName: row.store_name })),
  };
}

type Target =
  | { kind: "team.acceptInvite"; inviteId: string; accountOwnerId: string }
  | null;

/**
 * What an invite notification points at, against live state. Rows written
 * since invites carried `data.action` name their invite; older ones only say
 * which store and role, so they are matched on that, and only when exactly one
 * pending invite fits (never a guess between two).
 */
function resolveInvite(
  row: Pick<Notification, "type" | "data">,
  state: InviteState,
): { view: NotificationActionView; target: Target } | null {
  const stored = storedNotificationAction(row.data);
  if (stored) {
    const pending = state.pending.find((invite) => invite.id === stored.inviteId);
    if (pending) {
      return {
        view: { kind: stored.kind, status: "pending" },
        target: { kind: stored.kind, inviteId: pending.id, accountOwnerId: pending.account_owner_id },
      };
    }
    const joined = state.memberOf.some((m) => m.accountOwnerId === stored.accountOwnerId);
    return {
      view: { kind: stored.kind, status: joined ? "done" : "expired" },
      target: null,
    };
  }

  const legacy = legacyInviteDetails(row.type, row.data);
  if (!legacy?.store) return null;
  const matches = state.pending.filter(
    (invite) =>
      invite.store_name === legacy.store && (legacy.role === null || invite.role === legacy.role),
  );
  if (matches.length === 1) {
    const [invite] = matches;
    return {
      view: { kind: "team.acceptInvite", status: "pending" },
      target: { kind: "team.acceptInvite", inviteId: invite.id, accountOwnerId: invite.account_owner_id },
    };
  }
  if (matches.length === 0 && state.memberOf.some((m) => m.storeName === legacy.store)) {
    return { view: { kind: "team.acceptInvite", status: "done" }, target: null };
  }
  // Ambiguous, or nothing to match (revoked, or sent by an editor under their
  // own name): no inline button. The row still opens Team & access.
  return null;
}

function mayCarryAction(row: Pick<Notification, "type" | "data">): boolean {
  return storedNotificationAction(row.data) !== null || legacyInviteDetails(row.type, row.data) !== null;
}

/**
 * Attach each row's inline action as the reader can use it now. One pair of
 * RPC reads per call, and none at all when no row could carry an action.
 */
export async function withResolvedActions<T extends Notification>(rows: T[]): Promise<T[]> {
  if (!rows.some(mayCarryAction)) return rows.map((row) => ({ ...row, action: null }));
  const state = await readInviteState();
  return rows.map((row) => {
    if (!state || !mayCarryAction(row)) return { ...row, action: null };
    return { ...row, action: resolveInvite(row, state)?.view ?? null };
  });
}

/**
 * The invite a click on this row should accept, or null when there is none
 * to accept now. The row must already have been read as the caller's own.
 */
export async function resolveActionTarget(
  row: Pick<Notification, "type" | "data">,
): Promise<{ target: Target; accountOwnerId: string | null }> {
  const stored = storedNotificationAction(row.data);
  if (!mayCarryAction(row)) return { target: null, accountOwnerId: null };
  const state = await readInviteState();
  if (!state) return { target: null, accountOwnerId: stored?.accountOwnerId ?? null };
  const resolved = resolveInvite(row, state);
  return {
    target: resolved?.target ?? null,
    accountOwnerId: resolved?.target?.accountOwnerId ?? stored?.accountOwnerId ?? null,
  };
}

/** Whether the reader is now an active member of this store. */
export async function isMemberOf(accountOwnerId: string): Promise<boolean> {
  const state = await readInviteState();
  return state?.memberOf.some((m) => m.accountOwnerId === accountOwnerId) ?? false;
}
