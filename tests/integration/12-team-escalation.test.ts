/**
 * Team & Access — escalation guards, invite lifecycle, owner immutability.
 * Exercises the RLS policies + the BEFORE UPDATE guard trigger + the
 * team_accept_invite SECURITY DEFINER RPC exactly as PostgREST would.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asService,
  asSuper,
  asUser,
  closePool,
  createUser,
  expectDbError,
  type TestUser,
} from "../db/client";

let owner: TestUser;
let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let editorRowId: string;
let viewerRowId: string;
let ownerRowId: string;

async function memberRow(id: string) {
  const { rows } = await asSuper((q) =>
    q.query(
      `select role::text, status::text, member_user_id, invited_email, accepted_at
       from public.team_members where id = $1`,
      [id],
    ),
  );
  return rows[0];
}

beforeAll(async () => {
  owner = await createUser("own-esc@test.squareshare.to");
  editor = await createUser("edi-esc@test.squareshare.to");
  viewer = await createUser("vie-esc@test.squareshare.to");
  outsider = await createUser("out-esc@test.squareshare.to");

  await asService(async (q) => {
    const { rows } = await q.query(
      `insert into public.team_members (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
       values ($1, $2, $3, 'editor', 'active', now()),
              ($1, $4, $5, 'viewer', 'active', now())
       returning id`,
      [owner.id, editor.id, editor.email, viewer.id, viewer.email],
    );
    editorRowId = rows[0].id;
    viewerRowId = rows[1].id;
  });
  const { rows } = await asSuper((q) =>
    q.query(
      `select id from public.team_members where account_owner_id = $1 and role = 'owner'`,
      [owner.id],
    ),
  );
  ownerRowId = rows[0].id;
});

afterAll(closePool);

describe("self-escalation is impossible", () => {
  it("a viewer cannot promote themselves to editor", async () => {
    const res = await asUser(viewer, (q) =>
      q.query(`update public.team_members set role = 'editor' where id = $1`, [viewerRowId]),
    );
    // The manage policy's USING clause already excludes viewers → 0 rows.
    expect(res.rowCount).toBe(0);
    expect((await memberRow(viewerRowId)).role).toBe("viewer");
  });

  it("an editor cannot promote themselves to owner", async () => {
    const msg = await expectDbError(
      asUser(editor, (q) =>
        q.query(`update public.team_members set role = 'owner' where id = $1`, [editorRowId]),
      ),
    );
    expect(msg).toMatch(/ownership cannot be granted|row-level security|violates/i);
    expect((await memberRow(editorRowId)).role).toBe("editor");
  });

  it("an editor cannot change anyone's role (lacks team.change_role)", async () => {
    const msg = await expectDbError(
      asUser(editor, (q) =>
        q.query(`update public.team_members set role = 'editor' where id = $1`, [viewerRowId]),
      ),
    );
    expect(msg).toMatch(/permission to change roles/i);
  });

  it("an outsider cannot touch the roster at all", async () => {
    const read = await asUser(outsider, (q) =>
      q.query(`select * from public.team_members where account_owner_id = $1`, [owner.id]),
    );
    expect(read.rows).toHaveLength(0);

    const upd = await asUser(outsider, (q) =>
      q.query(`update public.team_members set role = 'editor' where id = $1`, [viewerRowId]),
    );
    expect(upd.rowCount).toBe(0);
  });
});

describe("owner row is immutable for everyone", () => {
  it("owner cannot demote or revoke their own owner row", async () => {
    const demote = await asUser(owner, (q) =>
      q.query(`update public.team_members set role = 'viewer' where id = $1`, [ownerRowId]),
    );
    expect(demote.rowCount).toBe(0); // manage policy excludes role='owner' rows

    const revoke = await asUser(owner, (q) =>
      q.query(`update public.team_members set status = 'revoked' where id = $1`, [ownerRowId]),
    );
    expect(revoke.rowCount).toBe(0);
  });

  it("nobody can delete any membership row (audit trail)", async () => {
    for (const actor of [owner, editor, viewer]) {
      const res = await asUser(actor, (q) =>
        q.query(`delete from public.team_members where account_owner_id = $1`, [owner.id]),
      );
      expect(res.rowCount).toBe(0);
    }
  });

  it("ownership can never be granted to another member", async () => {
    const msg = await expectDbError(
      asUser(owner, (q) =>
        q.query(`update public.team_members set role = 'owner' where id = $1`, [editorRowId]),
      ),
    );
    expect(msg).toMatch(/ownership cannot be granted|row-level security|violates/i);
  });
});

describe("owner CAN manage below themselves", () => {
  it("owner changes viewer→editor and back", async () => {
    const up = await asUser(owner, (q) =>
      q.query(`update public.team_members set role = 'editor' where id = $1`, [viewerRowId]),
    );
    expect(up.rowCount).toBe(1);
    expect((await memberRow(viewerRowId)).role).toBe("editor");

    const down = await asUser(owner, (q) =>
      q.query(`update public.team_members set role = 'viewer' where id = $1`, [viewerRowId]),
    );
    expect(down.rowCount).toBe(1);
    expect((await memberRow(viewerRowId)).role).toBe("viewer");
  });

  it("owner revokes and re-invites a member; guard resets acceptance", async () => {
    const revoke = await asUser(owner, (q) =>
      q.query(`update public.team_members set status = 'revoked' where id = $1`, [viewerRowId]),
    );
    expect(revoke.rowCount).toBe(1);

    // Re-invite must clear the link + acceptance.
    const reinvite = await asUser(owner, (q) =>
      q.query(
        `update public.team_members
         set status = 'invited', member_user_id = null, accepted_at = null, invited_at = now()
         where id = $1`,
        [viewerRowId],
      ),
    );
    expect(reinvite.rowCount).toBe(1);
    const row = await memberRow(viewerRowId);
    expect(row).toMatchObject({ status: "invited", member_user_id: null, accepted_at: null });

    // Restore active for later tests via the real accept RPC.
    const accepted = await asUser(viewer, (q) =>
      q.query(`select public.team_accept_invite($1) as ok`, [viewerRowId]),
    );
    expect(accepted.rows[0].ok).toBe(true);
  });

  it("re-invite carrying a stale accepted_at is rejected by the guard", async () => {
    await asUser(owner, (q) =>
      q.query(`update public.team_members set status = 'revoked' where id = $1`, [viewerRowId]),
    );
    const msg = await expectDbError(
      asUser(owner, (q) =>
        q.query(
          `update public.team_members
           set status = 'invited', member_user_id = null, invited_at = now()
           where id = $1`,
          [viewerRowId],
        ),
      ),
    );
    expect(msg).toMatch(/re-invites must reset acceptance|violates/i);
    // restore
    await asUser(owner, (q) =>
      q.query(
        `update public.team_members
         set status = 'invited', member_user_id = null, accepted_at = null, invited_at = now()
         where id = $1`,
        [viewerRowId],
      ),
    );
    await asUser(viewer, (q) =>
      q.query(`select public.team_accept_invite($1)`, [viewerRowId]),
    );
  });

  it("identity columns are frozen even for the owner", async () => {
    const msg = await expectDbError(
      asUser(owner, (q) =>
        q.query(`update public.team_members set invited_email = 'other@evil.com' where id = $1`, [
          viewerRowId,
        ]),
      ),
    );
    expect(msg).toMatch(/identity columns are immutable/i);

    const msg2 = await expectDbError(
      asUser(owner, (q) =>
        q.query(`update public.team_members set invited_at = now() where id = $1`, [viewerRowId]),
      ),
    );
    expect(msg2).toMatch(/invited_at is immutable/i);
  });

  it("active→invited without passing through revoked is not a legal transition", async () => {
    const msg = await expectDbError(
      asUser(owner, (q) =>
        q.query(
          `update public.team_members set status = 'invited', member_user_id = null, accepted_at = null
           where id = $1`,
          [viewerRowId],
        ),
      ),
    );
    expect(msg).toMatch(/not allowed|member link|violates/i);
  });
});

describe("invites", () => {
  it("editor may invite at or below their rank; viewer may not invite at all", async () => {
    const byEditor = await asUser(editor, (q) =>
      q.query(
        `insert into public.team_members (account_owner_id, invited_email, role)
         values ($1, 'newpal@test.squareshare.to', 'viewer') returning id`,
        [owner.id],
      ),
    );
    expect(byEditor.rows).toHaveLength(1);

    const msg = await expectDbError(
      asUser(viewer, (q) =>
        q.query(
          `insert into public.team_members (account_owner_id, invited_email, role)
           values ($1, 'nope@test.squareshare.to', 'viewer')`,
          [owner.id],
        ),
      ),
    );
    expect(msg).toMatch(/row-level security/i);
  });

  it("nobody can insert an owner invite or a pre-activated row", async () => {
    const ownerInvite = await expectDbError(
      asUser(owner, (q) =>
        q.query(
          `insert into public.team_members (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
           values ($1, $1, 'second-owner@x.com', 'owner', 'active', now())`,
          [owner.id],
        ),
      ),
    );
    expect(ownerInvite).toMatch(/row-level security|duplicate|violates/i);

    const preActivated = await expectDbError(
      asUser(owner, (q) =>
        q.query(
          `insert into public.team_members (account_owner_id, member_user_id, invited_email, role, status, accepted_at)
           values ($1, $2, $3, 'editor', 'active', now())`,
          [owner.id, outsider.id, outsider.email],
        ),
      ),
    );
    expect(preActivated).toMatch(/row-level security/i);
  });

  it("an outsider cannot invite themselves into someone else's store", async () => {
    const msg = await expectDbError(
      asUser(outsider, (q) =>
        q.query(
          `insert into public.team_members (account_owner_id, invited_email, role)
           values ($1, $2, 'editor')`,
          [owner.id, outsider.email],
        ),
      ),
    );
    expect(msg).toMatch(/row-level security/i);
  });

  it("invitee sees their pending invite; wrong-email user cannot accept it", async () => {
    const inviteId = await asUser(owner, async (q) => {
      const { rows } = await q.query(
        `insert into public.team_members (account_owner_id, invited_email, role)
         values ($1, $2, 'viewer') returning id`,
        [owner.id, outsider.email],
      );
      return rows[0].id;
    });

    // Invitee sees it via RLS...
    const visible = await asUser(outsider, (q) =>
      q.query(`select id from public.team_members where id = $1`, [inviteId]),
    );
    expect(visible.rows).toHaveLength(1);
    // ...and via the RPC.
    const pending = await asUser(outsider, (q) =>
      q.query(`select id from public.team_my_pending_invites()`),
    );
    expect(pending.rows.map((r) => r.id)).toContain(inviteId);

    // A different signed-in user cannot accept it.
    const stolen = await asUser(editor, (q) =>
      q.query(`select public.team_accept_invite($1) as ok`, [inviteId]),
    );
    expect(stolen.rows[0].ok).toBe(false);

    // The invitee cannot accept via a direct UPDATE (policy dropped on purpose).
    const direct = await asUser(outsider, (q) =>
      q.query(
        `update public.team_members set status = 'active', member_user_id = $2, accepted_at = now()
         where id = $1`,
        [inviteId, outsider.id],
      ),
    );
    expect(direct.rowCount).toBe(0);

    // The real path works and binds to the accepter.
    const ok = await asUser(outsider, (q) =>
      q.query(`select public.team_accept_invite($1) as ok`, [inviteId]),
    );
    expect(ok.rows[0].ok).toBe(true);
    const row = await memberRow(inviteId);
    expect(row).toMatchObject({ status: "active", member_user_id: outsider.id });

    // Accepting twice is a no-op false, not an error.
    const again = await asUser(outsider, (q) =>
      q.query(`select public.team_accept_invite($1) as ok`, [inviteId]),
    );
    expect(again.rows[0].ok).toBe(false);
  });

  it("duplicate invites to the same email are rejected by the unique index", async () => {
    const msg = await expectDbError(
      asUser(owner, (q) =>
        q.query(
          `insert into public.team_members (account_owner_id, invited_email, role)
           values ($1, 'newpal@test.squareshare.to', 'editor')`,
          [owner.id],
        ),
      ),
    );
    expect(msg).toMatch(/duplicate key/i);
  });

  it("emails are normalized to lowercase on insert", async () => {
    const id = await asUser(owner, async (q) => {
      const { rows } = await q.query(
        `insert into public.team_members (account_owner_id, invited_email, role)
         values ($1, 'MixedCase@Example.COM', 'viewer') returning id, invited_email`,
        [owner.id],
      );
      expect(rows[0].invited_email).toBe("mixedcase@example.com");
      return rows[0].id;
    });
    expect(id).toBeTruthy();
  });
});

describe("roster reads", () => {
  it("team_roster returns rows for members, empty for outsiders", async () => {
    const forViewer = await asUser(viewer, (q) =>
      q.query(`select * from public.team_roster($1)`, [owner.id]),
    );
    expect(forViewer.rows.length).toBeGreaterThanOrEqual(3);

    const stranger = await createUser("stranger-roster@test.squareshare.to");
    const forStranger = await asUser(stranger, (q) =>
      q.query(`select * from public.team_roster($1)`, [owner.id]),
    );
    expect(forStranger.rows).toHaveLength(0);
  });

  it("team_my_accounts lists own store plus memberships with roles", async () => {
    const { rows } = await asUser(viewer, (q) =>
      q.query(`select account_owner_id, role::text, is_self from public.team_my_accounts()`),
    );
    const self = rows.find((r) => r.is_self);
    const membership = rows.find((r) => r.account_owner_id === owner.id);
    expect(self?.account_owner_id).toBe(viewer.id);
    expect(self?.role).toBe("owner");
    expect(membership?.role).toBe("viewer");
  });

  it("team_actor_role reports the caller's role and null for outsiders", async () => {
    const e = await asUser(editor, (q) =>
      q.query(`select public.team_actor_role($1)::text as r`, [owner.id]),
    );
    expect(e.rows[0].r).toBe("editor");

    const o = await asUser(outsider, (q) =>
      q.query(`select public.team_actor_role($1)::text as r`, [editor.id]),
    );
    expect(o.rows[0].r).toBeNull();
  });
});
