// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/i18n/locales";
import type { Messages } from "@/i18n/messages";

/**
 * POST /api/report: the one unauthenticated write, and what it SAYS.
 *
 * The gates themselves (shape, budget, visibility, dedupe) are covered where
 * they live; what this file pins is that each branch still answers with the
 * status it always did, and that the words a reporter reads come back in the
 * reporter's language. Those words are the whole point here: a report dialog
 * that answers a Czech buyer in English is one they are less likely to finish.
 */

const TARGET = "0b1f7b1e-6d3a-4f4e-9f6c-1a2b3c4d5e6f";

/**
 * The route answers in the REQUEST'S language, so the locale next-intl would
 * resolve from the cookie and Accept-Language is what this stands in for.
 * `overlay` stands in for a translation the catalogue does not carry yet.
 */
const intl = vi.hoisted(() => ({
  locale: "en" as Locale,
  overlay: null as Record<string, unknown> | null,
}));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { loadMessages, mergeMessages } = await import("@/i18n/messages");
  async function catalogue(): Promise<Messages> {
    const messages = await loadMessages(intl.locale);
    return intl.overlay ? (mergeMessages(messages, intl.overlay) as Messages) : messages;
  }
  return {
    getTranslations: async (namespace?: "ProductPage.report.api") => {
      const messages = await catalogue();
      return namespace
        ? createTranslator({ locale: intl.locale, messages, namespace, timeZone: "UTC" })
        : createTranslator({ locale: intl.locale, messages, timeZone: "UTC" });
    },
  };
});

const db = vi.hoisted(() => ({
  target: null as { id: string; moderation_status: string | null } | null,
  insertError: null as { code: string; message: string } | null,
  inserts: [] as Record<string, unknown>[],
}));
const limiter = vi.hoisted(() => ({ allow: true }));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ "cf-connecting-ip": "203.0.113.7", "user-agent": "vitest" }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("@/lib/moderation/admin-ping", () => ({
  pingAdminModeration: vi.fn(async () => {}),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  rateLimitKey: vi.fn(async () => limiter.allow),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: db.target, error: null }),
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        db.inserts.push(row);
        return { error: db.insertError };
      },
    }),
  }),
}));

const { POST } = await import("@/app/api/report/route");

const VALID = { targetType: "product", targetId: TARGET, reason: "scam" };

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function answer(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  intl.locale = "en";
  intl.overlay = null;
  db.target = { id: TARGET, moderation_status: "ok" };
  db.insertError = null;
  db.inserts.length = 0;
  limiter.allow = true;
});

describe("POST /api/report", () => {
  it("files a report and answers 202", async () => {
    expect(await answer(await post(VALID))).toEqual({
      status: 202,
      body: { ok: true, message: "Thanks. A person will review this." },
    });
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]).toMatchObject({ target_type: "product", reason: "scam" });
  });

  it("answers a duplicate and an unreportable target exactly like a first report", async () => {
    const first = await answer(await post(VALID));

    db.insertError = { code: "23505", message: "duplicate key" };
    expect(await answer(await post(VALID))).toEqual(first);

    db.insertError = null;
    db.inserts.length = 0;
    db.target = { id: TARGET, moderation_status: "removed" };
    expect(await answer(await post(VALID))).toEqual(first);
    expect(db.inserts).toHaveLength(0);
  });

  it("refuses a body it cannot read", async () => {
    expect(await answer(await post("{not json"))).toEqual({
      status: 400,
      body: { error: "That request could not be read." },
    });
  });

  it("names what to fix, word for word as it always did", async () => {
    const cases: [unknown, string][] = [
      [{ ...VALID, reason: "nudity" }, "Pick what is wrong with it."],
      [{ targetType: "product", targetId: TARGET }, "Pick what is wrong with it."],
      [{ ...VALID, targetType: "artifact" }, "That is not something you can report here."],
      [{ ...VALID, targetId: "1" }, "That item is not valid."],
      [
        { ...VALID, details: "x".repeat(1001) },
        "Your description must be 1000 characters or fewer.",
      ],
      [
        { ...VALID, details: `bell${String.fromCharCode(7)}` },
        "Your description contains unsupported characters.",
      ],
      [
        { ...VALID, reporterEmail: "not-an-address" },
        "Your email doesn't look like an email address.",
      ],
      [{ ...VALID, reporterEmail: `${"a".repeat(250)}@example.com` }, "Your email is too long."],
      // Zod's own wording, reachable only by a hand-built request (the dialog
      // cannot send an unknown key or a non-object). Passed through as it was.
      [{ ...VALID, severity: "high" }, 'Unrecognized key: "severity"'],
      ["\"x\"", "Invalid input: expected object, received string"],
    ];
    for (const [body, error] of cases) {
      expect(await answer(await post(body)), JSON.stringify(body)).toEqual({
        status: 400,
        body: { error },
      });
    }
    expect(db.inserts).toHaveLength(0);
  });

  it("refuses once the per-client budget is spent, before writing anything", async () => {
    limiter.allow = false;
    const res = await post(VALID);
    expect(res.headers.get("Retry-After")).toBe("3600");
    expect(await answer(res)).toEqual({
      status: 429,
      body: { error: "Too many reports from here. Try again later." },
    });
    expect(db.inserts).toHaveLength(0);
  });

  it("says so when the report could not be stored", async () => {
    db.insertError = { code: "XX000", message: "boom" };
    expect(await answer(await post(VALID))).toEqual({
      status: 503,
      body: { error: "That could not be submitted. Try again." },
    });
  });
});

/**
 * A buyer on a hosted page is answered in THEIR language (cookie, then
 * Accept-Language), not the seller's. The translation pass has not reached
 * these keys yet, so the overlay stands in for it: marked strings, so a
 * response that is still English cannot pass for translated.
 */
describe("POST /api/report in the reporter's language", () => {
  beforeEach(() => {
    intl.locale = "cs";
    intl.overlay = {
      ProductPage: {
        report: {
          api: {
            accepted: "[cs] accepted",
            unreadable: "[cs] unreadable",
            reason: "[cs] reason",
            rateLimited: "[cs] rate limited",
            submitFailed: "[cs] submit failed",
          },
        },
      },
      Validation: {
        text: { reportDetails: { tooLong: "[cs] at most {maximum}" } },
        uuid: { reportTarget: "[cs] report target" },
      },
    };
  });

  it("answers every branch from the request's catalogue, with the same status codes", async () => {
    expect(await answer(await post(VALID))).toEqual({
      status: 202,
      body: { ok: true, message: "[cs] accepted" },
    });
    expect(await answer(await post("{not json"))).toEqual({
      status: 400,
      body: { error: "[cs] unreadable" },
    });
    expect(await answer(await post({ ...VALID, reason: "nudity" }))).toEqual({
      status: 400,
      body: { error: "[cs] reason" },
    });

    db.insertError = { code: "XX000", message: "boom" };
    expect(await answer(await post(VALID))).toEqual({
      status: 503,
      body: { error: "[cs] submit failed" },
    });

    limiter.allow = false;
    expect(await answer(await post(VALID))).toEqual({
      status: 429,
      body: { error: "[cs] rate limited" },
    });
  });

  it("resolves the shared validation messages in that language, bound included", async () => {
    expect(await answer(await post({ ...VALID, targetId: "1" }))).toEqual({
      status: 400,
      body: { error: "[cs] report target" },
    });
    expect(await answer(await post({ ...VALID, details: "x".repeat(1001) }))).toEqual({
      status: 400,
      body: { error: "[cs] at most 1000" },
    });
  });
});
