/**
 * The server error reporter (lib/ops/report-error.ts): every unhandled server
 * error leaves one findable line, reaches a collector when one is configured,
 * and never carries anything that identifies the person who hit it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportServerError } from "@/lib/ops/report-error";

const CONTEXT = { route: "/s/[storefrontId]/order/[orderRef]", kind: "render", method: "GET" };

function failure(message = "boom"): Error & { digest?: string } {
  return Object.assign(new Error(message), { digest: "1234567890" });
}

let logged: unknown[][];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("reportServerError", () => {
  it("logs one line behind a fixed prefix, naming the route and the digest the user was shown", async () => {
    await reportServerError(failure("orders read failed"), CONTEXT);
    expect(logged).toHaveLength(1);
    expect(logged[0][0]).toBe("[server error]");
    expect(JSON.parse(String(logged[0][1]))).toMatchObject({
      digest: "1234567890",
      message: "orders read failed",
      route: "/s/[storefrontId]/order/[orderRef]",
      kind: "render",
      method: "GET",
    });
  });

  it("sends nothing anywhere unless a collector is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await reportServerError(failure(), CONTEXT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the same report to the collector, with its token, and nothing about the request", async () => {
    vi.stubEnv("ERROR_REPORT_URL", "https://errors.example.test/ingest");
    vi.stubEnv("ERROR_REPORT_TOKEN", "collector-token");
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await reportServerError(failure(), CONTEXT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://errors.example.test/ingest");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer collector-token");
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    // The route's pattern, never an address: an order link's credential is in its path.
    expect(Object.keys(sent).sort()).toEqual(["at", "digest", "kind", "message", "method", "name", "route"]);
  });

  it("caps a long message, so a dumped payload cannot ride out in one", async () => {
    await reportServerError(failure("x".repeat(5000)), CONTEXT);
    expect((JSON.parse(String(logged[0][1])) as { message: string }).message).toHaveLength(500);
  });

  it("never throws when the collector is down: one error must not become two", async () => {
    vi.stubEnv("ERROR_REPORT_URL", "https://errors.example.test/ingest");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    await expect(reportServerError(failure(), CONTEXT)).resolves.toBeUndefined();
    expect(logged.at(-1)?.[0]).toBe("[server error] could not be reported:");
  });
});
