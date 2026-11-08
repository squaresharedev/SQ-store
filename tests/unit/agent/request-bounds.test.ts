// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// What a stranger, or a connected app, can make the two public OAuth/MCP
// endpoints read: /oauth/revoke reads a few KB and looks up only tokens shaped
// like ours; /mcp reads up to its cap and hands the SDK exactly what was sent.

const revokeToken = vi.hoisted(() => vi.fn(async () => {}));
const sdkSaw = vi.hoisted(() => ({ body: null as string | null }));

vi.mock("@/lib/agent/access", async (original) => ({
  ...(await original<typeof import("@/lib/agent/access")>()),
  agentAccessEnabled: () => true,
}));
vi.mock("@/lib/agent/oauth/grants", () => ({ revokeToken }));
vi.mock("@/lib/agent/authenticate", () => ({
  authenticateAgentRequest: async () => ({ kind: "ok", context: { scopes: new Set(["store:read"]) } }),
}));
vi.mock("@/lib/agent/context", () => ({ runAsAgent: (_context: unknown, work: () => unknown) => work() }));
vi.mock("@/lib/team/account-context", () => ({ getActiveAccount: async () => ({ accountId: "acct" }) }));
vi.mock("@modelcontextprotocol/server", () => ({
  McpServer: class {},
  createMcpHandler: () => ({
    fetch: async (request: Request) => {
      sdkSaw.body = await request.text();
      return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
    },
  }),
}));

import { POST as revoke } from "@/app/oauth/revoke/route";
import { handleMcpRequest } from "@/lib/agent/mcp-transport";
import { ACCESS_TOKEN_PREFIX, REFRESH_TOKEN_PREFIX, isCredential, randomCredential } from "@/lib/agent/oauth/crypto";

beforeEach(() => {
  revokeToken.mockClear();
  sdkSaw.body = null;
});

function form(token: string, extra = ""): Request {
  return new Request("https://app.test/oauth/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `${new URLSearchParams({ token })}${extra}`,
  });
}

describe("isCredential", () => {
  it("knows our own credentials by prefix and length", () => {
    expect(isCredential(randomCredential(ACCESS_TOKEN_PREFIX), ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(isCredential(randomCredential(REFRESH_TOKEN_PREFIX), REFRESH_TOKEN_PREFIX)).toBe(true);
    expect(isCredential(randomCredential(REFRESH_TOKEN_PREFIX), ACCESS_TOKEN_PREFIX)).toBe(false);
    expect(isCredential(`${ACCESS_TOKEN_PREFIX}short`, ACCESS_TOKEN_PREFIX)).toBe(false);
    expect(isCredential(`${randomCredential(ACCESS_TOKEN_PREFIX)}x`, ACCESS_TOKEN_PREFIX)).toBe(false);
  });
});

describe("POST /oauth/revoke", () => {
  it("looks up a real-shaped token, and answers 200 either way", async () => {
    const token = randomCredential(REFRESH_TOKEN_PREFIX);
    const response = await revoke(form(token));
    expect(response.status).toBe(200);
    expect(revokeToken).toHaveBeenCalledWith(token);
  });

  it("never touches the database for something that could not be ours", async () => {
    for (const token of ["abc", "sqa_", `sqx_${"A".repeat(43)}`, "' or 1=1 --"]) {
      expect((await revoke(form(token))).status).toBe(200);
    }
    expect(revokeToken).not.toHaveBeenCalled();
  });

  it("stops reading past its cap, and still answers 200", async () => {
    const response = await revoke(form(randomCredential(ACCESS_TOKEN_PREFIX), `&pad=${"x".repeat(64 * 1024)}`));
    expect(response.status).toBe(200);
    expect(revokeToken).not.toHaveBeenCalled();
  });
});

function mcp(body: string): Request {
  return new Request("https://app.test/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sqa_x" },
    body,
  });
}

describe("POST /mcp body bounds", () => {
  it("refuses a body over the cap before the SDK sees it", async () => {
    const huge = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", pad: "x".repeat(6 * 1024 * 1024) });
    const response = await handleMcpRequest(mcp(huge));
    expect(response.status).toBe(413);
    expect(sdkSaw.body).toBeNull();
  });

  it("hands the SDK exactly the bytes that were sent", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { note: "café ✓" } });
    const response = await handleMcpRequest(mcp(body));
    expect(response.status).toBe(200);
    expect(sdkSaw.body).toBe(body);
  });

  it("refuses a body that is not UTF-8", async () => {
    const response = await handleMcpRequest(
      new Request("https://app.test/mcp", { method: "POST", body: new Uint8Array([0xff, 0xfe, 0x7b]) }),
    );
    expect(response.status).toBe(400);
    expect(sdkSaw.body).toBeNull();
  });
});
