// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __clearSnapshotCache,
  fetchSnapshot,
  getCachedSnapshot,
} from "@/lib/search/snapshot-cache";
import { EMPTY_SNAPSHOT, type SearchSnapshot } from "@/lib/search/types";

function snapshotNamed(title: string): SearchSnapshot {
  return {
    ...EMPTY_SNAPSHOT,
    products: [{ id: "p1", title, status: "active" }],
  };
}

function ok(snapshot: SearchSnapshot): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ snapshot }),
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __clearSnapshotCache();
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => ok(snapshotNamed("Lamp")));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("snapshot cache — basics", () => {
  it("is empty before any fetch", () => {
    expect(getCachedSnapshot("a1")).toBeNull();
  });

  it("fetches on a miss and populates the cache", async () => {
    const result = await fetchSnapshot("a1");
    expect(result?.products[0]?.title).toBe("Lamp");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getCachedSnapshot("a1")?.products[0]?.title).toBe("Lamp");
  });

  it("resolves null on HTTP failure and caches nothing", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
    expect(await fetchSnapshot("a1")).toBeNull();
    expect(getCachedSnapshot("a1")).toBeNull();
  });

  it("resolves null when fetch throws (offline) and caches nothing", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await fetchSnapshot("a1")).toBeNull();
    expect(getCachedSnapshot("a1")).toBeNull();
  });

  it("resolves null on a malformed body", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ nope: true }),
    } as Response);
    expect(await fetchSnapshot("a1")).toBeNull();
  });
});

describe("snapshot cache — SWR semantics", () => {
  it("a fresh entry answers without a new request", async () => {
    await fetchSnapshot("a1");
    vi.advanceTimersByTime(30_000); // still inside the 300s TTL
    const again = await fetchSnapshot("a1");
    expect(again?.products[0]?.title).toBe("Lamp");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a stale entry answers immediately AND refreshes behind", async () => {
    await fetchSnapshot("a1");
    fetchMock.mockResolvedValue(ok(snapshotNamed("Newer lamp")));
    vi.advanceTimersByTime(301_000); // past the 300s TTL

    // The stale answer comes back without waiting for the refresh...
    const stale = await fetchSnapshot("a1");
    expect(stale?.products[0]?.title).toBe("Lamp");
    expect(fetchMock).toHaveBeenCalledTimes(2); // ...which is already running.

    await vi.runAllTimersAsync();
    expect(getCachedSnapshot("a1")?.products[0]?.title).toBe("Newer lamp");
  });

  it("a failed background refresh keeps the stale data", async () => {
    await fetchSnapshot("a1");
    fetchMock.mockRejectedValue(new TypeError("offline"));
    vi.advanceTimersByTime(301_000); // past the 300s TTL
    await fetchSnapshot("a1");
    await vi.runAllTimersAsync();
    // Stale beats gone: the old snapshot is still served.
    expect(getCachedSnapshot("a1")?.products[0]?.title).toBe("Lamp");
  });

  it("concurrent callers share one in-flight request", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    const first = fetchSnapshot("a1");
    const second = fetchSnapshot("a1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(ok(snapshotNamed("Shared")));
    expect((await first)?.products[0]?.title).toBe("Shared");
    expect((await second)?.products[0]?.title).toBe("Shared");
  });
});

describe("snapshot cache — accounts", () => {
  it("keys entries per account — a switch never serves the other store", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(snapshotNamed("Alice's lamp")))
      .mockResolvedValueOnce(ok(snapshotNamed("Vera's lamp")));
    await fetchSnapshot("alice");
    await fetchSnapshot("vera");
    expect(getCachedSnapshot("alice")?.products[0]?.title).toBe("Alice's lamp");
    expect(getCachedSnapshot("vera")?.products[0]?.title).toBe("Vera's lamp");
  });

  it("evicts the oldest account past the cap of three", async () => {
    for (const id of ["a1", "a2", "a3", "a4"]) {
      await fetchSnapshot(id);
      vi.advanceTimersByTime(1_000); // distinct fetchedAt for a stable sort
    }
    expect(getCachedSnapshot("a1")).toBeNull(); // oldest, evicted
    expect(getCachedSnapshot("a2")).not.toBeNull();
    expect(getCachedSnapshot("a3")).not.toBeNull();
    expect(getCachedSnapshot("a4")).not.toBeNull();
  });
});
