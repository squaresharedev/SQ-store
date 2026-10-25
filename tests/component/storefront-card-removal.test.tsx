import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../setup/render";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
import type { ProductRemoval } from "@/types/product";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import { StorefrontCard } from "@/components/storefront/StorefrontCard";

/**
 * A storefront waiting on its check has had nothing decided against it, so its
 * card must not read like a takedown. Only a real removal is red.
 */

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

function renderWith(kind: ProductRemoval["kind"]) {
  const storefront: StorefrontSummary = {
    id: "60000000-0000-4000-8000-000000000006",
    name: "Gilt & Grain",
    blockCount: 0,
    updatedAt: "2026-08-09T00:00:00.000Z",
    config: { ...DEFAULT_STOREFRONT_CONFIG, blocks: [] },
    embedKey: "70000000-0000-4000-8000-000000000007",
    brief: {},
    removal: { kind, automated: true, reviewRequestedAt: null } as ProductRemoval,
  };
  render(
    <StorefrontCard
      storefront={storefront}
      productsById={new Map()}
      canWrite
      onEmbed={() => {}}
      onDelete={() => {}}
    />,
  );
  return document.querySelector(`[data-storefront-removed="${kind}"]`);
}

describe("StorefrontCard moderation line", () => {
  it.each([
    ["pending", "Checking"],
    ["review", "In review"],
  ] as const)("a %s storefront reads as being checked, not removed", (kind, label) => {
    const line = renderWith(kind);
    expect(line).toHaveTextContent(label);
    expect(line).not.toHaveClass("text-destructive");
    expect(screen.queryByText("Removed by Square Share")).toBeNull();
  });

  it("a removed storefront still says so, in red", () => {
    const line = renderWith("removed");
    expect(line).toHaveTextContent("Removed by Square Share");
    expect(line).toHaveClass("text-destructive");
  });
});
