// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const uploads = new Map<string, { object_key: string; expires_at: string; grant_id: string }>();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const filters: Record<string, string> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: string) => {
          filters[column] = value;
          return builder;
        },
        maybeSingle: async () => {
          const row = uploads.get(filters.id);
          return { data: row && row.grant_id === filters.grant_id ? row : null, error: null };
        },
      };
      return builder;
    },
  }),
}));

import { collectObjectKeys, restoreObjectKeys, UnknownHandleError, withholdObjectKeys } from "@/lib/agent/object-refs";
import { findSecret } from "@/lib/agent/secrets";

const OWNER = "11111111-2222-4333-8444-555555555555";
const KEY = `images/${OWNER}/66666666-7777-4888-9999-aaaaaaaaaaaa-photo.jpg`;
const OTHER_KEY = `images/${OWNER}/66666666-7777-4888-9999-bbbbbbbbbbbb-other.jpg`;
const GRANT = "grant-1";

describe("the last check on what goes out", () => {
  it("passes an ordinary payload", () => {
    expect(findSecret({ id: "x", priceCents: 100, tags: ["a"], nested: { title: "Lamp" }, imageUrl: "https://r2/x" })).toBeNull();
  });

  it("finds a credential by its field name, however deep", () => {
    expect(findSecret({ a: [{ embedKey: "x" }] })).toBe("$.a[0].embedKey");
    expect(findSecret({ digital_file_key: "x" })).toBe("$.digital_file_key");
  });

  it("finds a storage key by what it IS, in a field nobody listed", () => {
    expect(findSecret({ newColumn: KEY })).toBe("$.newColumn");
    expect(findSecret([{ a: { b: [KEY] } }])).toBe("$[0].a.b[0]");
  });
});

describe("object keys become handles on the way out", () => {
  it("replaces every key, wherever it sits, and nothing else", async () => {
    const out = await withholdObjectKeys({
      title: "Lamp",
      background: { key: KEY, overlay: true },
      list: [{ key: OTHER_KEY }, "plain text"],
    });
    expect(findSecret(out)).toBeNull();
    expect(out.title).toBe("Lamp");
    expect(out.background.key).toMatch(/^ref:[0-9a-f]{32}$/);
    expect(out.background.overlay).toBe(true);
    expect(out.list[1]).toBe("plain text");
  });

  it("gives the same key the same handle, so a read can be compared", async () => {
    const [a, b] = await Promise.all([withholdObjectKeys(KEY), withholdObjectKeys(KEY)]);
    expect(a).toBe(b);
    expect(a).not.toBe(await withholdObjectKeys(OTHER_KEY));
  });

  it("finds a record's keys to resolve handles against", () => {
    expect(collectObjectKeys({ a: KEY, b: [{ c: OTHER_KEY }], d: "text" }).sort()).toEqual([KEY, OTHER_KEY].sort());
  });
});

describe("handles become keys on the way in", () => {
  it("round-trips a read back into a save", async () => {
    const stored = { background: { key: KEY }, title: "Lamp" };
    const read = await withholdObjectKeys(stored);
    expect(await restoreObjectKeys(read, collectObjectKeys(stored), GRANT)).toEqual(stored);
  });

  it("refuses a handle from any other record: a hash cannot name someone else's file", async () => {
    const elsewhere = await withholdObjectKeys(OTHER_KEY);
    await expect(restoreObjectKeys({ key: elsewhere }, [KEY], GRANT)).rejects.toBeInstanceOf(UnknownHandleError);
  });

  it("refuses a raw object key outright", async () => {
    await expect(restoreObjectKeys({ key: KEY }, [KEY], GRANT)).rejects.toBeInstanceOf(UnknownHandleError);
  });

  it("resolves an upload made on this connection", async () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    uploads.set(id, { object_key: KEY, grant_id: GRANT, expires_at: new Date(Date.now() + 60_000).toISOString() });
    expect(await restoreObjectKeys({ image: `upload:${id}` }, [], GRANT)).toEqual({ image: KEY });
  });

  it("refuses an upload from another connection, an expired one, and a malformed id", async () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
    uploads.set(id, { object_key: KEY, grant_id: "someone-else", expires_at: new Date(Date.now() + 60_000).toISOString() });
    await expect(restoreObjectKeys(`upload:${id}`, [], GRANT)).rejects.toBeInstanceOf(UnknownHandleError);

    const old = "aaaaaaaa-bbbb-4ccc-8ddd-000000000000";
    uploads.set(old, { object_key: KEY, grant_id: GRANT, expires_at: new Date(Date.now() - 1).toISOString() });
    await expect(restoreObjectKeys(`upload:${old}`, [], GRANT)).rejects.toBeInstanceOf(UnknownHandleError);

    await expect(restoreObjectKeys("upload:not-a-uuid", [], GRANT)).rejects.toBeInstanceOf(UnknownHandleError);
  });

  it("leaves ordinary text alone", async () => {
    expect(await restoreObjectKeys({ name: "A shop: ref to nothing" }, [], GRANT)).toEqual({ name: "A shop: ref to nothing" });
  });
});
