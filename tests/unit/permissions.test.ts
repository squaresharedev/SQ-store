import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  DEFAULT_INVITE_ROLE,
  TEAM_ACTIONS,
  TEAM_PERMISSIONS,
  can,
  canGrant,
  type TeamAction,
  type TeamRole,
} from "@/lib/team/permissions";

// Exhaustive expectation matrix. If someone edits TEAM_PERMISSIONS this file
// forces them to look here (and at the SQL mirror `public.team_role_can`) —
// which is exactly the friction we want on permission changes.
const EXPECTED: Record<TeamRole, Record<TeamAction, boolean>> = {
  owner: {
    "team.read": true,
    "team.invite": true,
    "team.change_role": true,
    "team.revoke": true,
    "store.read": true,
    "products.write": true,
    "storefront.write": true,
  },
  editor: {
    "team.read": true,
    "team.invite": true,
    "team.change_role": false,
    "team.revoke": false,
    "store.read": true,
    "products.write": true,
    "storefront.write": true,
  },
  viewer: {
    "team.read": true,
    "team.invite": false,
    "team.change_role": false,
    "team.revoke": false,
    "store.read": true,
    "products.write": false,
    "storefront.write": false,
  },
};

describe("can()", () => {
  for (const role of Object.keys(EXPECTED) as TeamRole[]) {
    for (const action of TEAM_ACTIONS) {
      it(`${role} ${EXPECTED[role][action] ? "can" : "can NOT"} ${action}`, () => {
        expect(can(role, action)).toBe(EXPECTED[role][action]);
      });
    }
  }

  it("non-members (null/undefined role) can do nothing", () => {
    for (const action of TEAM_ACTIONS) {
      expect(can(null, action)).toBe(false);
      expect(can(undefined, action)).toBe(false);
    }
  });

  it("the permission map has no action outside TEAM_ACTIONS", () => {
    for (const perms of Object.values(TEAM_PERMISSIONS)) {
      for (const action of perms) {
        expect(TEAM_ACTIONS).toContain(action);
      }
    }
  });
});

describe("canGrant()", () => {
  it("nobody can ever grant owner — not even the owner", () => {
    expect(canGrant("owner", "owner")).toBe(false);
    expect(canGrant("editor", "owner")).toBe(false);
    expect(canGrant("viewer", "owner")).toBe(false);
    expect(canGrant(null, "owner")).toBe(false);
  });

  it("owner can grant editor and viewer", () => {
    expect(canGrant("owner", "editor")).toBe(true);
    expect(canGrant("owner", "viewer")).toBe(true);
  });

  it("editor can grant at or below their rank only", () => {
    expect(canGrant("editor", "editor")).toBe(true);
    expect(canGrant("editor", "viewer")).toBe(true);
  });

  it("viewer cannot grant editor (no escalation above own rank)", () => {
    expect(canGrant("viewer", "editor")).toBe(false);
  });

  it("viewer granting viewer is rank-allowed here; the invite PERMISSION is what stops them", () => {
    // canGrant is only the rank check. A viewer lacks team.invite, so the
    // combined server-side gate (can + canGrant) still denies them.
    expect(canGrant("viewer", "viewer")).toBe(true);
    expect(can("viewer", "team.invite")).toBe(false);
  });

  it("non-members can grant nothing", () => {
    expect(canGrant(null, "viewer")).toBe(false);
    expect(canGrant(undefined, "viewer")).toBe(false);
  });
});

describe("invite form constants", () => {
  it("owner is never assignable", () => {
    expect(ASSIGNABLE_ROLES).not.toContain("owner");
  });

  it("default invite role is least-privilege", () => {
    expect(DEFAULT_INVITE_ROLE).toBe("viewer");
  });
});
