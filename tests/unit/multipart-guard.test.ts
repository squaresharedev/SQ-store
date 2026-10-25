// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "@/middleware";
import { isMalformedMultipart, multipartBoundary } from "@/lib/security/multipart-guard";

const URL_ = "https://dashboard.squareshare.eu/no-such-page";

function post(contentType: string, body?: BodyInit) {
  return new NextRequest(URL_, { method: "POST", headers: { "content-type": contentType }, body });
}

const VALID = '--xyz\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--xyz--\r\n';

describe("multipart guard", () => {
  it("reads the boundary, quoted or not", () => {
    expect(multipartBoundary("multipart/form-data; boundary=xyz")).toBe("xyz");
    expect(multipartBoundary('multipart/form-data; boundary="a b"')).toBe("a b");
    expect(multipartBoundary("multipart/form-data")).toBeNull();
    expect(multipartBoundary("application/json")).toBeNull();
  });

  it.each([
    ["no boundary", "multipart/form-data", "abc"],
    ["an empty body", "multipart/form-data; boundary=xyz", undefined],
    ["a body that is not a form", "multipart/form-data; boundary=xyz", "garbage"],
  ])("refuses %s", async (_why, contentType, body) => {
    expect(await isMalformedMultipart(post(contentType, body))).toBe(true);
  });

  it("lets a real form through, and leaves its body readable", async () => {
    const request = post("multipart/form-data; boundary=xyz", VALID);
    expect(await isMalformedMultipart(request)).toBe(false);
    expect((await request.formData()).get("a")).toBe("1");
  });

  it("ignores everything that is not a multipart POST", async () => {
    expect(await isMalformedMultipart(new NextRequest(URL_))).toBe(false);
    expect(await isMalformedMultipart(post("application/json", "{}"))).toBe(false);
  });

  it("answers junk with a 400 before Next's action handler sees it", async () => {
    const response = await middleware(post("multipart/form-data; boundary=xyz", ""));
    expect(response.status).toBe(400);
  });

  it("runs for multipart requests to pages, never the API", () => {
    const entry = config.matcher.find((item) => typeof item !== "string");
    expect(entry).toMatchObject({ has: [{ type: "header", key: "content-type" }] });
    const source = new RegExp(`^${(entry as { source: string }).source}$`);
    expect(source.test("/_not-found")).toBe(true);
    expect(source.test("/s/abc/p/def")).toBe(true);
    expect(source.test("/api/uploads")).toBe(false);
    expect(source.test("/_next/static/x.js")).toBe(false);
  });
});
