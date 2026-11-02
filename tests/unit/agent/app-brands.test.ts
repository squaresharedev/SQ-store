// @vitest-environment node
import { describe, expect, it } from "vitest";
import { brandForHost } from "@/lib/agent/app-brands";

describe("whose logo a connected app wears", () => {
  it("is Claude's for Claude's own hosts", () => {
    expect(brandForHost("claude.ai")).toBe("claude");
    expect(brandForHost("CLAUDE.AI")).toBe("claude");
    expect(brandForHost("www.claude.ai")).toBe("claude");
    expect(brandForHost("claude.com")).toBe("claude");
  });

  it("is nobody's for a host that only looks like it", () => {
    expect(brandForHost("evilclaude.ai")).toBeNull();
    expect(brandForHost("claude.ai.example.com")).toBeNull();
    expect(brandForHost("claude-ai.example")).toBeNull();
  });

  it("is nobody's for an app on this machine or with no host at all", () => {
    expect(brandForHost("localhost")).toBeNull();
    expect(brandForHost("127.0.0.1")).toBeNull();
    expect(brandForHost(null)).toBeNull();
  });
});
