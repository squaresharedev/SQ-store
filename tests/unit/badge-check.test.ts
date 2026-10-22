// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The approved list, as a map from subject to its stored verdict, behind the
// two calls checkBadgeText makes: one read of a subject, one insert.
const stored = new Map<string, { subject: string; verdict: string; ground: string | null; paths: string[] }>();
const upserts: unknown[] = [];
let readError: { code?: string; message: string } | null = null;

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, subject: string) => ({
          maybeSingle: async () =>
            readError ? { data: null, error: readError } : { data: stored.get(subject) ?? null, error: null },
        }),
      }),
      upsert: async (row: { subject: string; verdict: string; ground: string | null; paths: string[] }) => {
        upserts.push(row);
        stored.set(row.subject, row);
        return { error: null };
      },
    }),
  }),
}));

const classifyTextMock = vi.fn();
vi.mock("@/lib/moderation/auto/classify", () => ({
  classifyText: (...args: unknown[]) => classifyTextMock(...args),
  classifyMedia: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({ presignGetUrl: vi.fn() }));
vi.mock("@/lib/notifications/create", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/moderation/admin-ping", () => ({ pingAdminModeration: vi.fn() }));

import { BADGE_TEXT_PATH, checkBadgeText } from "@/lib/moderation/auto/check";
import { fixFieldForPath } from "@/lib/moderation/fix-fields";

beforeEach(() => {
  stored.clear();
  upserts.length = 0;
  readError = null;
  classifyTextMock.mockReset();
});

describe("checkBadgeText: one badge's words, judged and remembered", () => {
  it("asks about the words as the row's own path, in a namespace of their own", async () => {
    classifyTextMock.mockResolvedValue({ verdict: "clean", ground: null, paths: [] });

    expect(await checkBadgeText("  Handmade  ")).toEqual({ verdict: "clean", ground: null, paths: [] });

    expect(classifyTextMock).toHaveBeenCalledWith("product", [`${BADGE_TEXT_PATH}=Handmade`]);
    const [row] = upserts as { subject: string; source: string }[];
    expect(row!.subject).toMatch(/^text:badge:[0-9a-f]{64}$/);
    expect(row!.source).toBe("model");
  });

  it("names the same path the database names, so a flag lands on the same fix field", () => {
    expect(BADGE_TEXT_PATH).toBe("details.badges[].label");
    expect(fixFieldForPath("product", BADGE_TEXT_PATH)).toBe("specs");
  });

  it("never asks twice about the same words: a preset is judged once for everyone", async () => {
    classifyTextMock.mockResolvedValue({ verdict: "clean", ground: null, paths: [] });
    await checkBadgeText("Eco friendly");
    await checkBadgeText("Eco friendly");
    await checkBadgeText(" Eco friendly ");
    expect(classifyTextMock).toHaveBeenCalledTimes(1);
  });

  it("answers from what is already recorded for the words without asking the classifier", async () => {
    // Content-addressed: the subject is the SHA-256 of the trimmed words.
    const subject = `text:badge:${createHash("sha256").update("Get rich quick").digest("hex")}`;
    stored.set(subject, { subject, verdict: "violation", ground: "scam", paths: [BADGE_TEXT_PATH] });

    expect(await checkBadgeText("Get rich quick")).toEqual({
      verdict: "violation",
      ground: "scam",
      paths: [BADGE_TEXT_PATH],
    });
    expect(classifyTextMock).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });

  it("answers null when no verdict can be had, and records nothing", async () => {
    classifyTextMock.mockResolvedValue(null);
    expect(await checkBadgeText("Ships fast")).toBeNull();
    expect(upserts).toHaveLength(0);

    readError = { message: "connection reset" };
    expect(await checkBadgeText("Ships fast")).toBeNull();
  });

  it("treats no words as nothing to object to", async () => {
    expect(await checkBadgeText("   ")).toEqual({ verdict: "clean", ground: null, paths: [] });
    expect(classifyTextMock).not.toHaveBeenCalled();
  });
});
