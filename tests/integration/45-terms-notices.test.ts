/**
 * Terms notices (20261031_terms_notices), against the replayed schema.
 *
 * The promise in section 19 of the Terms, held by the database and not just by
 * the job that writes these rows: a version cannot take effect sooner than 30
 * days after its notices finished, and a date cannot be moved once it is written.
 */
import { afterAll, describe, expect, it } from "vitest";
import { asAnon, asService, asSuper, closePool, createUser, expectDbError } from "../db/client";

afterAll(closePool);

const DAYS_30 = "30 days";

/** The write must be refused, with a message that says why. */
async function refused(run: Promise<unknown>, reason: string): Promise<void> {
  expect(await expectDbError(run)).toContain(reason);
}

async function insertVersion(version: string): Promise<void> {
  await asService((client) => client.query("insert into public.terms_versions (version) values ($1) on conflict do nothing", [version]));
}

/** A version whose notices finished, with the date under test written alongside. */
function finish(version: string, gap: string) {
  return asService((client) =>
    client.query(
      `update public.terms_versions
          set notice_completed_at = '2099-01-01T00:00:00Z',
              effective_at = '2099-01-01T00:00:00Z'::timestamptz + $2::interval
        where version = $1`,
      [version, gap],
    ),
  );
}

describe("the 30 days", () => {
  it("refuses a date under 30 days after the notices finished", async () => {
    const version = "tos-2098-01-01";
    await insertVersion(version);
    await refused(finish(version, "29 days 23 hours"), "terms_versions_thirty_days");
  });

  it("refuses a date with no finished notice behind it", async () => {
    const version = "tos-2098-01-02";
    await insertVersion(version);
    await refused(
      asService((client) =>
        client.query("update public.terms_versions set effective_at = now() where version = $1", [version]),
      ),
      "terms_versions_thirty_days",
    );
  });

  it("accepts exactly 30 days", async () => {
    const version = "tos-2098-01-03";
    await insertVersion(version);
    await finish(version, DAYS_30);
  });

  it("lets a version skip the wait only by recording why, from a fixed list", async () => {
    await asService((client) =>
      client.query(
        "insert into public.terms_versions (version, short_notice_reason, effective_at) values ('tos-2098-01-04', 'law', now())",
      ),
    );
    await refused(
      asService((client) =>
        client.query(
          "insert into public.terms_versions (version, short_notice_reason, effective_at) values ('tos-2098-01-05', 'in a hurry', now())",
        ),
      ),
      "short_notice_reason",
    );
  });

  it("will not let anyone bring a date forward, or change it at all, once written", async () => {
    const version = "tos-2098-01-06";
    await insertVersion(version);
    await finish(version, "45 days");
    await refused(
      asService((client) =>
        client.query("update public.terms_versions set effective_at = effective_at - interval '10 days' where version = $1", [version]),
      ),
      "fixed once set",
    );
    await refused(
      asService((client) =>
        client.query("update public.terms_versions set short_notice_reason = 'law' where version = $1", [version]),
      ),
      "fixed once set",
    );
  });

  it("takes only real version names", async () => {
    await refused(insertVersion("new-terms"), "terms_versions_version_check");
  });
});

describe("who can see what", () => {
  it("starts with the Terms already in force", async () => {
    const { rows } = await asAnon((client) =>
      client.query("select effective_at from public.terms_versions where version = 'tos-2026-10-11'"),
    );
    expect(rows[0].effective_at).not.toBeNull();
  });

  it("lets the public read the dates, which the marketing site needs, and write nothing", async () => {
    await refused(
      asAnon((client) => client.query("insert into public.terms_versions (version) values ($1)", ["tos-2098-03-01"])),
      "permission denied",
    );
    await refused(
      asAnon((client) => client.query("update public.terms_versions set effective_at = now()")),
      "permission denied",
    );
  });

  it("keeps who was emailed away from everyone but the service role", async () => {
    await refused(asAnon((client) => client.query("select * from public.terms_notice_sends")), "permission denied");
  });

  it("drops an account's notice record when the account goes", async () => {
    const user = await createUser();
    const version = "tos-2098-02-01";
    await insertVersion(version);
    await asService((client) =>
      client.query("insert into public.terms_notice_sends (version, user_id, attempts) values ($1, $2, 1)", [version, user.id]),
    );
    await asSuper((client) => client.query("delete from auth.users where id = $1", [user.id]));
    const { rows } = await asService((client) =>
      client.query("select 1 from public.terms_notice_sends where user_id = $1", [user.id]),
    );
    expect(rows).toHaveLength(0);
  });
});
