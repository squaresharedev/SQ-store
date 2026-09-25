import type { MessageKey } from "@/i18n/types";
import type { Enums } from "@/types";

/**
 * TEAM & ACCESS — the ONE central permission model.
 *
 * Roles are an enum mapped to a permission set here, and NOWHERE else in
 * TypeScript. Every check goes through `can()` / `canGrant()`; call sites never
 * compare role strings. Adding a role or a granular per-resource action later
 * (e.g. "products.edit", "orders.read") means editing THIS map — plus its SQL
 * mirror `public.team_role_can()` (migration `create_team_members_with_rls`),
 * which RLS policies and the guard trigger consult. Edit both in one change.
 *
 * Importable from client and server: pure data + pure functions, no secrets.
 * UI may use it to hide controls, but that is cosmetic — the server actions
 * and RLS re-check every mutation.
 */

export type TeamRole = Enums<"team_role">;
export type TeamMemberStatus = Enums<"team_member_status">;

export const TEAM_ACTIONS = [
  // Team roster management.
  "team.read",
  "team.invite",
  "team.change_role",
  "team.revoke",
  // Store data access. `store.read` covers products, storefront, orders and the
  // dashboard/analytics (everything a member views). Writes are per-resource.
  "store.read",
  "products.write",
  "storefront.write",
] as const;

export type TeamAction = (typeof TEAM_ACTIONS)[number];

/** role -> permission set. The single editable source of truth. */
export const TEAM_PERMISSIONS: Record<TeamRole, readonly TeamAction[]> = {
  owner: [
    "team.read",
    "team.invite",
    "team.change_role",
    "team.revoke",
    "store.read",
    "products.write",
    "storefront.write",
  ],
  editor: [
    "team.read",
    "team.invite",
    "store.read",
    "products.write",
    "storefront.write",
  ],
  viewer: ["team.read", "store.read"],
};

/**
 * Hierarchy used only for the "never grant above your own role" guard.
 * Mirrors `public.team_role_rank()`.
 */
const ROLE_RANK: Record<TeamRole, number> = { owner: 3, editor: 2, viewer: 1 };

/** Can this actor role perform this action? Null/undefined = not a member. */
export function can(
  actorRole: TeamRole | null | undefined,
  action: TeamAction,
): boolean {
  if (!actorRole) return false;
  return TEAM_PERMISSIONS[actorRole].includes(action);
}

/**
 * May an actor hand out `target` (on invite or role change)? Ownership is
 * never grantable, and nobody grants a role above their own.
 */
export function canGrant(
  actorRole: TeamRole | null | undefined,
  target: TeamRole,
): boolean {
  if (!actorRole || target === "owner") return false;
  return ROLE_RANK[target] <= ROLE_RANK[actorRole];
}

/** Roles that can appear in invite / role-change forms. Never includes owner. */
export const ASSIGNABLE_ROLES = ["editor", "viewer"] as const satisfies readonly TeamRole[];

/** Least-privilege default for new invites. */
export const DEFAULT_INVITE_ROLE: TeamRole = "viewer";

/**
 * Each role's name and what it can do, as message keys: this module is shared
 * by client and server, so the render site resolves them in the reader's
 * language. A sentence that names a role takes the role as an ICU select
 * value instead of splicing one of these labels in.
 */
export const ROLE_LABELS: Record<TeamRole, MessageKey> = {
  owner: "Settings.team.roles.owner.label",
  editor: "Settings.team.roles.editor.label",
  viewer: "Settings.team.roles.viewer.label",
};

export const ROLE_DESCRIPTIONS: Record<TeamRole, MessageKey> = {
  owner: "Settings.team.roles.owner.description",
  editor: "Settings.team.roles.editor.description",
  viewer: "Settings.team.roles.viewer.description",
};
