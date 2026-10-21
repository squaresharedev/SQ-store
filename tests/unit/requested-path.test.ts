// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "@/middleware";
import {
  REQUESTED_PATH_HEADER,
  SIGNED_IN_PREFIXES,
  isSignedInPath,
  requestedPathOf,
  returnPathFrom,
} from "@/lib/auth/requested-path";

describe("where sign-in returns a signed-out visitor to", () => {
  it("keeps a deep link whole: the record and the query", () => {
    expect(returnPathFrom("/orders?view=to-ship&order=SQ-1042")).toBe("/orders?view=to-ship&order=SQ-1042");
    expect(returnPathFrom("/products/7f1c/edit")).toBe("/products/7f1c/edit");
    expect(returnPathFrom("/settings/security?setup=1")).toBe("/settings/security?setup=1");
    expect(returnPathFrom("/")).toBe("/");
  });

  it.each([
    ["another site", "https://evil.example/orders"],
    ["a protocol-relative address", "//evil.example/orders"],
    ["a backslash authority", "/\\evil.example"],
    ["a tab trick", "/\t/evil.example"],
    ["a public page", "/s/abc/p/def"],
    ["the embed frame", "/e/key/site"],
    ["an API route", "/api/orders/export"],
    ["the sign-in page itself", "/login?next=/orders"],
    ["a look-alike prefix", "/ordersmalicious"],
    ["nothing", ""],
    ["no header", null],
    ["an absurd length", `/orders?${"x".repeat(3000)}`],
  ])("ignores %s", (_why, value) => {
    expect(returnPathFrom(value)).toBeNull();
  });

  it("drops Next's own cache-busting parameter but keeps the seller's", () => {
    expect(requestedPathOf(new URL("https://d.example/orders?view=all&_rsc=abc123"))).toBe("/orders?view=all");
    expect(requestedPathOf(new URL("https://d.example/dashboard?_rsc=1"))).toBe("/dashboard");
  });

  it("knows the signed-in areas", () => {
    expect(isSignedInPath("/storefront/abc")).toBe(true);
    expect(isSignedInPath("/plans")).toBe(true);
    expect(isSignedInPath("/approve/token")).toBe(false);
  });
});

describe("src/middleware.ts", () => {
  const forwarded = (response: Response) => response.headers.get(`x-middleware-request-${REQUESTED_PATH_HEADER}`);

  it("records the requested path and query on the request", () => {
    const response = middleware(new NextRequest("https://dashboard.squareshare.eu/orders?view=to-ship&_rsc=9"));
    expect(forwarded(response)).toBe("/orders?view=to-ship");
    expect(response.headers.get("x-middleware-override-headers")).toContain(REQUESTED_PATH_HEADER);
  });

  it("overwrites a value a client tried to send", () => {
    const response = middleware(
      new NextRequest("https://dashboard.squareshare.eu/settings/team", {
        headers: { [REQUESTED_PATH_HEADER]: "//evil.example" },
      }),
    );
    expect(forwarded(response)).toBe("/settings/team");
  });

  it("never redirects or answers by itself", () => {
    const response = middleware(new NextRequest("https://dashboard.squareshare.eu/products"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  });

  it("matches exactly the signed-in areas (the literal matcher mirrors SIGNED_IN_PREFIXES)", () => {
    expect(config.matcher).toEqual(["/", ...SIGNED_IN_PREFIXES.map((prefix) => `${prefix}/:path*`)]);
  });
});
