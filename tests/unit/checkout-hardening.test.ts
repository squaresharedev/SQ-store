// @vitest-environment node
/**
 * The mechanical defences around the public checkout routes: the streaming
 * body cap, the same-origin gate, and the headers the purchase pages carry.
 */
import { describe, expect, it, vi } from "vitest";
import { readBoundedJson } from "@/lib/security/read-json";
import { isSameOriginRequest } from "@/lib/security/same-origin";

function post(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request("https://squareshare.test/api/x", { method: "POST", body, headers });
}

describe("readBoundedJson", () => {
  it("reads a small JSON body", async () => {
    expect(await readBoundedJson(post('{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 } });
  });

  it("turns away an honest oversized Content-Length without reading it", async () => {
    const body = new ReadableStream({
      pull() {
        throw new Error("the body must not be read");
      },
    });
    const request = new Request("https://squareshare.test/api/x", {
      method: "POST",
      body,
      headers: { "content-length": "5000" },
      // @ts-expect-error duplex is required for stream bodies in undici
      duplex: "half",
    });
    expect(await readBoundedJson(request, 100)).toEqual({ ok: false, reason: "too_large" });
  });

  it("stops reading a body that outgrows the cap, whatever it claimed", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode("x".repeat(60)));
        if (pulls > 50) controller.close();
      },
    });
    const request = new Request("https://squareshare.test/api/x", {
      method: "POST",
      body,
      // @ts-expect-error duplex is required for stream bodies in undici
      duplex: "half",
    });
    expect(await readBoundedJson(request, 100)).toEqual({ ok: false, reason: "too_large" });
    expect(pulls).toBeLessThan(10);
  });

  it("refuses non-JSON, invalid UTF-8 and a missing body", async () => {
    expect(await readBoundedJson(post("not json"), 100)).toEqual({ ok: false, reason: "not_json" });
    expect(await readBoundedJson(post(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])), 100)).toEqual({
      ok: false,
      reason: "not_json",
    });
    expect(await readBoundedJson(new Request("https://squareshare.test/api/x", { method: "POST" }), 100)).toEqual({
      ok: false,
      reason: "not_json",
    });
  });
});

describe("isSameOriginRequest", () => {
  it("accepts a same-origin fetch and an Origin equal to the app's own", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://squareshare.eu");
    expect(isSameOriginRequest(post("{}", { "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginRequest(post("{}", { origin: "https://squareshare.eu" }))).toBe(true);
    vi.unstubAllEnvs();
  });

  it("refuses cross-site, same-site, another origin, and no signal at all", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://squareshare.eu");
    expect(isSameOriginRequest(post("{}", { "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginRequest(post("{}", { "sec-fetch-site": "same-site" }))).toBe(false);
    expect(isSameOriginRequest(post("{}", { origin: "https://evil.example" }))).toBe(false);
    // A forged Sec-Fetch-Site cannot rescue a request that names a foreign Origin.
    expect(isSameOriginRequest(post("{}", { "sec-fetch-site": "cross-site", origin: "https://squareshare.eu" }))).toBe(
      false,
    );
    expect(isSameOriginRequest(post("{}"))).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("the purchase pages' headers", () => {
  it("never let a credential travel in a Referer or sit in a cache", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const config = (await import("../../next.config")).default as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    const rules = await config.headers();
    const value = (source: string, key: string) =>
      rules.find((rule) => rule.source === source)?.headers.find((header) => header.key === key)?.value;
    for (const source of [
      "/s/:storefrontId/order/:path*",
      "/s/:storefrontId/orders",
      "/s/:storefrontId/p/:productId/checkout",
      "/api/orders/:path*",
      "/api/checkout/:path*",
    ]) {
      expect(value(source, "Referrer-Policy"), source).toBe("no-referrer");
      expect(value(source, "Cache-Control"), source).toContain("no-store");
      expect(value(source, "X-Robots-Tag"), source).toContain("noindex");
    }
    vi.unstubAllEnvs();
  });
});
