// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const versions = vi.hoisted(() => ({
  list: [{ version: "tos-2026-10-11" }, { version: "tos-2026-10-31" }] as {
    version: string;
    urgentReason?: "law" | "danger";
  }[],
}));
const mail = vi.hoisted(() => ({ sendEmail: vi.fn() }));

vi.mock("@/lib/legal/terms-versions", async (original) => ({
  ...(await original<typeof import("@/lib/legal/terms-versions")>()),
  get TERMS_VERSIONS() {
    return versions.list;
  },
}));
vi.mock("@/lib/email/send", () => ({ emailSendingEnabled: () => true, sendEmail: mail.sendEmail }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  TermsNoticeBlocked,
  runTermsNotices,
  sendTermsNotice,
  type TermsNoticeDeps,
  type TermsRecipient,
  type TermsSendRecord,
  type TermsVersionState,
} from "@/lib/legal/terms-notices";

const NEW = "tos-2026-10-31";
const DAY = 24 * 60 * 60 * 1000;
const START = new Date("2026-11-01T03:23:00Z");

function people(count: number): TermsRecipient[] {
  return Array.from({ length: count }, (_, i) => ({ userId: `u${i}`, email: `u${i}@example.test`, locale: "en" as const }));
}

/** An in-memory stand-in for the two tables, with a clock the test moves. */
function harness(options: { recipients?: TermsRecipient[]; fail?: (r: TermsRecipient) => boolean } = {}) {
  const state = {
    now: START,
    mailOn: true,
    pageLive: true,
    rows: new Map<string, TermsVersionState & { notice_completed_at?: string }>([
      ["tos-2026-10-11", { version: "tos-2026-10-11", notice_started_at: null, planned_effective_at: null, effective_at: "2026-10-11T00:00:00Z" }],
    ]),
    sends: new Map<string, TermsSendRecord>(),
    delivered: [] as string[],
    recipients: options.recipients ?? people(3),
  };
  const deps: TermsNoticeDeps = {
    now: () => state.now,
    mailOn: () => state.mailOn,
    termsPageLive: async () => state.pageLive,
    send: async (recipient) => {
      if (options.fail?.(recipient)) return { sent: false, reason: "failed" };
      state.delivered.push(recipient.userId);
      return { sent: true };
    },
    store: {
      readVersions: async () => [...state.rows.values()],
      startNotice: async (version, startedAt, plannedEffectiveAt) => {
        state.rows.set(version, { version, notice_started_at: startedAt, planned_effective_at: plannedEffectiveAt, effective_at: null });
      },
      recipients: async () => state.recipients,
      sends: async () => [...state.sends.values()],
      recordSend: async (_version, userId, sentAt, attempts) => {
        state.sends.set(userId, { userId, sentAt, attempts });
      },
      completeNotice: async (version, completedAt, effectiveAt) => {
        const row = state.rows.get(version)!;
        state.rows.set(version, { ...row, notice_completed_at: completedAt, effective_at: effectiveAt });
      },
    },
  };
  return { state, deps };
}

beforeEach(() => {
  versions.list = [{ version: "tos-2026-10-11" }, { version: NEW }];
  mail.sendEmail.mockReset();
});

describe("runTermsNotices", () => {
  it("does nothing when every listed version already has its date", async () => {
    const { state, deps } = harness();
    state.rows.set(NEW, { version: NEW, notice_started_at: "x", planned_effective_at: "x", effective_at: "2026-12-01T00:00:00Z" });
    expect(await runTermsNotices(deps)).toMatchObject({ version: null, more: false });
    expect(state.delivered).toEqual([]);
  });

  it("refuses to start the clock while mail is off, and says so", async () => {
    const { state, deps } = harness();
    state.mailOn = false;
    await expect(runTermsNotices(deps)).rejects.toThrow(TermsNoticeBlocked);
    expect(state.rows.has(NEW)).toBe(false);
  });

  it("refuses to send anyone to Terms the site is not serving yet", async () => {
    const { state, deps } = harness();
    state.pageLive = false;
    await expect(runTermsNotices(deps)).rejects.toMatchObject({ reason: "terms_page_missing" });
    expect(state.delivered).toEqual([]);
  });

  it("emails everyone, then sets the date at least 30 days after the last email", async () => {
    const { state, deps } = harness();
    const result = await runTermsNotices(deps);
    expect(result).toMatchObject({ version: NEW, sent: 3, completed: true, more: false });
    expect(state.delivered).toEqual(["u0", "u1", "u2"]);

    const row = state.rows.get(NEW)!;
    expect(new Date(row.effective_at!).getTime() - START.getTime()).toBeGreaterThanOrEqual(30 * DAY);
    // The date the emails stated still holds, so nobody was told something false.
    expect(row.effective_at).toBe(row.planned_effective_at);
  });

  it("works through a long list over several calls without emailing anyone twice", async () => {
    const { state, deps } = harness({ recipients: people(45) });
    const first = await runTermsNotices(deps);
    expect(first).toMatchObject({ sent: 20, more: true, completed: false });
    expect(state.rows.get(NEW)!.effective_at).toBeNull();

    await runTermsNotices(deps);
    const last = await runTermsNotices(deps);
    expect(last).toMatchObject({ sent: 5, completed: true, more: false });
    expect(new Set(state.delivered).size).toBe(45);
    expect(state.delivered).toHaveLength(45);
  });

  it("moves the date later when sending runs long, and never earlier", async () => {
    const { state, deps } = harness({ recipients: people(25) });
    await runTermsNotices(deps);
    const planned = new Date(state.rows.get(NEW)!.planned_effective_at!).getTime();

    // The rest of the list goes out five days later.
    state.now = new Date(START.getTime() + 5 * DAY);
    await runTermsNotices(deps);

    const effective = new Date(state.rows.get(NEW)!.effective_at!).getTime();
    expect(effective).toBe(state.now.getTime() + 30 * DAY);
    expect(effective).toBeGreaterThan(planned);
  });

  it("waits for failed emails, but one dead mailbox cannot hold everyone up forever", async () => {
    const { state, deps } = harness({ fail: (r) => r.userId === "u1" });
    expect(await runTermsNotices(deps)).toMatchObject({ sent: 2, failed: 1, completed: false, more: true });
    expect(await runTermsNotices(deps)).toMatchObject({ failed: 1, completed: false, more: true });
    expect(await runTermsNotices(deps)).toMatchObject({ failed: 1, completed: false, more: true });
    const final = await runTermsNotices(deps);
    expect(final).toMatchObject({ gaveUp: 1, completed: true, more: false });
    expect(state.delivered.filter((id) => id === "u0")).toHaveLength(1);
  });

  it("does the next version only after the one before it has its date", async () => {
    versions.list = [{ version: "tos-2026-10-11" }, { version: NEW }, { version: "tos-2026-12-01" }];
    const { state, deps } = harness();
    await runTermsNotices(deps);
    expect(state.rows.has("tos-2026-12-01")).toBe(false);
    const result = await runTermsNotices(deps);
    expect(result.version).toBe("tos-2026-12-01");
  });

  it("skips the wait only for a version that records why", async () => {
    versions.list = [{ version: "tos-2026-10-11" }, { version: NEW, urgentReason: "law" }];
    const { state, deps } = harness();
    await runTermsNotices(deps);
    expect(state.delivered).toHaveLength(3);
    expect(state.rows.get(NEW)!.effective_at).toBe(START.toISOString());
  });
});

describe("sendTermsNotice", () => {
  const recipient = (locale: TermsRecipient["locale"]): TermsRecipient => ({ userId: "u", email: "a@example.test", locale });

  it("says when, what changes, where both versions are, and that leaving is free", async () => {
    mail.sendEmail.mockResolvedValue({ sent: true });
    await sendTermsNotice(recipient("en"), NEW, "2026-12-02T03:23:00Z");

    const message = mail.sendEmail.mock.calls[0][0];
    expect(message.to).toBe("a@example.test");
    expect(message.subject).toBe("We're updating our Terms of Service");
    expect(message.text).toContain("2 December 2026");
    expect(message.text).toContain(`https://squareshare.eu/terms/v/${NEW}/`);
    expect(message.text).toContain("https://squareshare.eu/terms/");
    expect(message.text).toContain("- We now operate only in the EU, the USA and Canada");
    expect(message.text).toContain("close your account at no charge");
  });
});
