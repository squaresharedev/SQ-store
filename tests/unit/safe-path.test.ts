import { describe, it, expect } from "vitest";
import { safeInternalPath } from "@/lib/utils/safe-path";

// Regression suite for the post-auth redirect guard. The previous inline check
// was `startsWith("/") && !startsWith("//")`, which several of these inputs walk
// straight through — each one is a real open redirect, so they stay tested.
describe("safeInternalPath", () => {
  it("keeps ordinary internal paths intact", () => {
    expect(safeInternalPath("/dashboard")).toBe("/dashboard");
    expect(safeInternalPath("/settings/team")).toBe("/settings/team");
  });

  it("preserves query strings and fragments", () => {
    expect(safeInternalPath("/orders?status=paid&page=2")).toBe(
      "/orders?status=paid&page=2",
    );
    expect(safeInternalPath("/products#top")).toBe("/products#top");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeInternalPath("//evil.com")).toBe("/");
    expect(safeInternalPath("//evil.com/path")).toBe("/");
  });

  it("rejects absolute URLs and scheme payloads", () => {
    expect(safeInternalPath("https://evil.com")).toBe("/");
    expect(safeInternalPath("http://evil.com")).toBe("/");
    expect(safeInternalPath("javascript:alert(1)")).toBe("/");
    expect(safeInternalPath("data:text/html,<script>alert(1)</script>")).toBe("/");
  });

  // The bypasses the old prefix check allowed. A browser strips these
  // characters while parsing, so "/\t/evil.com" navigates to "//evil.com".
  it("rejects control characters that a URL parser strips", () => {
    expect(safeInternalPath("/\t/evil.com")).toBe("/");
    expect(safeInternalPath("/\n/evil.com")).toBe("/");
    expect(safeInternalPath("/\r/evil.com")).toBe("/");
    expect(safeInternalPath("/\u0000/evil.com")).toBe("/");
  });

  // A backslash is treated as a slash in the authority position.
  it("rejects backslash-smuggled authorities", () => {
    expect(safeInternalPath("/\\evil.com")).toBe("/");
    expect(safeInternalPath("/\\\\evil.com")).toBe("/");
  });

  it("rejects non-string and empty input", () => {
    expect(safeInternalPath(undefined)).toBe("/");
    expect(safeInternalPath(null)).toBe("/");
    expect(safeInternalPath("")).toBe("/");
    expect(safeInternalPath(42)).toBe("/");
    expect(safeInternalPath(["/a"])).toBe("/");
  });

  it("rejects relative paths that are not root-relative", () => {
    expect(safeInternalPath("dashboard")).toBe("/");
    expect(safeInternalPath("../etc/passwd")).toBe("/");
  });

  it("normalizes traversal segments instead of passing them through", () => {
    expect(safeInternalPath("/a/../b")).toBe("/b");
  });

  it("honours a custom fallback", () => {
    expect(safeInternalPath("//evil.com", "/login")).toBe("/login");
  });
});
