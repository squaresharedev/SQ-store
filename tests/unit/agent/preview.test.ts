// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMeasurements } from "@/lib/agent/preview/targets";
import { mintPreviewToken, verifyPreviewToken } from "@/lib/agent/preview/token";
import { MCP_APP_MIME_TYPE, STOREFRONT_PREVIEW_VIEW_HTML } from "@/lib/agent/preview/view";

const STOREFRONT = "11111111-1111-4111-8111-111111111111";
const GRANT = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.stubEnv("AGENT_JWT_SIGNING_KEY", JSON.stringify({ kty: "oct", k: Buffer.from("x".repeat(40)).toString("base64url") }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the key to one preview page", () => {
  it("opens the storefront it names, for the grant it names", async () => {
    const token = await mintPreviewToken({ kind: "storefront", id: STOREFRONT }, GRANT);
    expect(await verifyPreviewToken(token)).toMatchObject({ kind: "storefront", id: STOREFRONT, grantId: GRANT });
  });

  it("is refused once anything in it is changed", async () => {
    const token = await mintPreviewToken({ kind: "storefront", id: STOREFRONT }, GRANT);
    const [body, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, id: "33333333-3333-4333-8333-333333333333" })).toString("base64url");
    expect(await verifyPreviewToken(`${forged}.${signature}`)).toBeNull();
    expect(await verifyPreviewToken(`${body}.${"A".repeat(43)}`)).toBeNull();
    expect(await verifyPreviewToken("not a token")).toBeNull();
    expect(await verifyPreviewToken(undefined)).toBeNull();
  });

  it("runs out after two minutes", async () => {
    const token = await mintPreviewToken({ kind: "storefront", id: STOREFRONT }, GRANT);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 121_000);
    expect(await verifyPreviewToken(token)).toBeNull();
  });

  it("is signed by a key derived from the agent key: a different agent key refuses it", async () => {
    const token = await mintPreviewToken({ kind: "storefront", id: STOREFRONT }, GRANT);
    vi.stubEnv("AGENT_JWT_SIGNING_KEY", JSON.stringify({ kty: "oct", k: Buffer.from("y".repeat(40)).toString("base64url") }));
    expect(await verifyPreviewToken(token)).toBeNull();
  });
});

describe("what a preview page measured", () => {
  const page = (json: string) => `<html><body><main></main><script type="application/json" id="ss-preview-targets">${json}</script></body></html>`;

  it("is read back out of the rendered page", () => {
    const measured = { page: { width: 1280, height: 900 }, tiles: [{ productId: "p", title: "Lamp", status: "active", x: 1, y: 2, w: 3, h: 4 }] };
    expect(readMeasurements(page(JSON.stringify(measured)))).toEqual(measured);
  });

  it("keeps only well-formed tiles, and nothing at all from a page without them", () => {
    const measured = { page: { width: 10, height: 10 }, tiles: [{ productId: "p", title: "ok", status: "active", x: 0, y: 0, w: 1, h: 1 }, { productId: 1 }, { title: "no box" }] };
    expect(readMeasurements(page(JSON.stringify(measured)))?.tiles).toHaveLength(1);
    expect(readMeasurements("<html></html>")).toBeNull();
    expect(readMeasurements(page("{not json"))).toBeNull();
  });
});

describe("the storefront preview view", () => {
  it("is an MCP App: the right type, the stable protocol revision, the handshake", () => {
    expect(MCP_APP_MIME_TYPE).toBe("text/html;profile=mcp-app");
    expect(STOREFRONT_PREVIEW_VIEW_HTML).toMatch(/^<!DOCTYPE html>/);
    expect(STOREFRONT_PREVIEW_VIEW_HTML).toContain('"2026-01-26"');
    for (const method of ["ui/initialize", "ui/notifications/initialized", "ui/notifications/tool-result", "ui/notifications/size-changed", "ui/open-link", "ui/update-model-context"]) {
      expect(STOREFRONT_PREVIEW_VIEW_HTML).toContain(method);
    }
  });

  it("loads nothing from anywhere, so the host's default CSP is all it needs", () => {
    expect(STOREFRONT_PREVIEW_VIEW_HTML).not.toMatch(/<script[^>]+src=/);
    expect(STOREFRONT_PREVIEW_VIEW_HTML).not.toMatch(/<link[^>]+href=/);
    expect(STOREFRONT_PREVIEW_VIEW_HTML).not.toMatch(/@import|url\(/);
    expect(STOREFRONT_PREVIEW_VIEW_HTML).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket/);
  });

  it("puts words in as text, never as markup", () => {
    expect(STOREFRONT_PREVIEW_VIEW_HTML).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});
