/**
 * The sample storefront in the storefront list.
 *
 * What these pin: the sample is a quiet LINK at the foot of the list, never a
 * card, so the list holds the seller's own storefronts and nothing else (and
 * with none, the empty state alone, with no "0 storefronts" above it); the link
 * opens the sample in the designer and carries the guided tour's hook; and it
 * stays away for a read-only role, an unreadable flag, and anyone who hid the
 * sample back when it was a card.
 */

import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "../setup/render";
import type { StorefrontSummary } from "@/lib/storefront/queries";
import { DEFAULT_STOREFRONT_CONFIG } from "@/types/storefront";
// Static, so its (large) import is paid once before the tests start rather than
// inside the first test's time limit. vi.mock calls are hoisted above it.
import { StorefrontsList } from "@/components/storefront/StorefrontsList";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});
afterAll(() => vi.unstubAllGlobals());

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/storefront",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/storefront/actions", () => ({
  deleteStorefront: vi.fn(),
  fetchStorefrontsPage: vi.fn(),
  createStorefront: vi.fn(),
  rotateEmbedKey: vi.fn(),
  updateEmbedSettings: vi.fn(),
}));

// The setup flow is its own component with its own tests; here it only has to
// say whether it is open.
vi.mock("@/components/storefront/CreateStorefrontWizard", () => ({
  CreateStorefrontWizard: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Create storefront setup" /> : null,
}));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

function storefront(name: string): StorefrontSummary {
  return {
    id: "60000000-0000-4000-8000-000000000006",
    name,
    blockCount: 0,
    updatedAt: "2026-09-01T00:00:00.000Z",
    config: DEFAULT_STOREFRONT_CONFIG,
    embedKey: "70000000-0000-4000-8000-000000000007",
    brief: {},
  };
}

function renderList(props: {
  storefronts?: StorefrontSummary[];
  canWrite?: boolean;
  sample?: "shown" | "hidden" | null;
}) {
  const storefronts = props.storefronts ?? [];
  return render(
    <main>
      <StorefrontsList
        storefronts={storefronts}
        total={storefronts.length}
        products={[]}
        canWrite={props.canWrite ?? true}
        sample={props.sample}
      />
    </main>,
  );
}

const sampleLink = () => screen.queryByRole("link", { name: "Open the sample storefront" });

describe("sample storefront in the list", () => {
  it("is a link under the empty state for a seller with no storefront, never a card", async () => {
    await renderList({ sample: "shown" });
    expect(screen.getByRole("heading", { name: "No storefronts yet" })).toBeInTheDocument();
    expect(sampleLink()).toHaveAttribute("href", "/storefront/sample");
    // The tour's hook hugs the link.
    expect(sampleLink()?.closest("[data-storefront-sample]")).not.toBeNull();
    // Nothing in the list but the seller's own: no sample card, no grid of
    // cards (the empty state's mini boards have grids of their own, deeper in).
    expect(document.querySelector("main > ul")).toBeNull();
    expect(screen.queryByText("0 storefronts")).toBeNull();
  });

  it("opens the setup flow from the empty state's create card", async () => {
    const user = userEvent.setup();
    await renderList({ sample: "shown" });
    await user.click(screen.getByRole("button", { name: "Create storefront" }));
    expect(await screen.findByRole("dialog", { name: "Create storefront setup" })).toBeInTheDocument();
  });

  it("sits at the foot of the list, after the seller's own cards", async () => {
    await renderList({ sample: "shown", storefronts: [storefront("Gilt & Grain")] });
    const items = [...document.querySelectorAll("main > ul > li")];
    expect(items).toHaveLength(1);
    expect(screen.getByText("1 storefront")).toBeInTheDocument();
    const list = document.querySelector("main > ul")!;
    const link = sampleLink()!;
    expect(list.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("stays away for a read-only role, an unreadable flag, or someone who hid the sample", async () => {
    await renderList({ sample: "shown", canWrite: false });
    expect(sampleLink()).toBeNull();
    cleanup();

    await renderList({ sample: null });
    expect(sampleLink()).toBeNull();
    expect(screen.getByRole("heading", { name: "No storefronts yet" })).toBeInTheDocument();
    cleanup();

    await renderList({ sample: "hidden" });
    expect(sampleLink()).toBeNull();
    expect(document.querySelector("[data-storefront-sample]")).toBeNull();
  });
});
