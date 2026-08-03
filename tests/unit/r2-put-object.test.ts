// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `putObject` must send an explicit Content-Length.
 *
 * R2 answers a chunked PUT with 411 Length Required, and Next patches global
 * fetch — through that patch a Uint8Array body goes out streamed, with no
 * length, unless the header is set by hand. This broke every real photo while
 * a 70-byte test fixture kept passing, so the size below is deliberately past
 * the point where bodies start being streamed.
 */

const fetchMock = vi.fn(async (_input: Request | string, _init?: RequestInit) =>
  new Response(null, { status: 200 }),
);

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("R2_ACCOUNT_ID", "test-account");
  vi.stubEnv("R2_BUCKET_NAME", "test-bucket");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-key-id");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Comfortably past the streaming threshold that hid the bug. */
const LARGE = 512 * 1024;

describe("putObject", () => {
  it("sets Content-Length explicitly, so R2 does not answer 411", async () => {
    const { putObject } = await import("@/lib/r2");
    await putObject("images/x/y.png", new Uint8Array(LARGE), "image/png");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.headers.get("content-length")).toBe(String(LARGE));
    expect(request.headers.get("content-type")).toBe("image/png");
    expect(request.method).toBe("PUT");
  });

  it("reports the status when R2 refuses, rather than failing silently", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 411 }));
    const { putObject } = await import("@/lib/r2");
    await expect(
      putObject("images/x/y.png", new Uint8Array(LARGE), "image/png"),
    ).rejects.toThrow(/411/);
  });

  it("stores the content type it is given, not one inferred from the key", async () => {
    // The caller passes the SNIFFED type; the key's extension is user input.
    const { putObject } = await import("@/lib/r2");
    await putObject("images/x/y.png", new Uint8Array(LARGE), "image/webp");
    const request = fetchMock.mock.calls[0]![0] as Request;
    expect(request.headers.get("content-type")).toBe("image/webp");
  });
});
