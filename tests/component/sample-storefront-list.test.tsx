/**
 * The sample storefront in the storefront list.
 *
 * What these pin: the sample shows after the seller's own cards and is never
 * counted as one of them; with none of their own it sits beside a create card
 * instead of the full empty state; hiding it is optimistic, recorded on the
 * profile, rolled back on failure, and reversible from the foot of the list;
 * read-only roles and an unreadable flag get no sample at all; and its embed
 * button explains the snippet and leads into the setup flow.
 */

import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, waitFor, within } from "../setup/render";
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

const actions = vi.hoisted(() => ({
  setSampleStorefrontHidden: vi.fn(async (_hidden: unknown) => ({ ok: true })),
}));
vi.mock("@/lib/onboarding/actions", () => actions);

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

beforeEach(() => {
  vi.clearAllMocks();
  actions.setSampleStorefrontHidden.mockImplementation(async () => ({ ok: true }));
});
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

const sampleItem = () => document.querySelector("[data-storefront-sample]");

describe("sample storefront in the list", () => {
  it("shows beside a create card for a seller with no storefront, uncounted", async () => {
    await renderList({ sample: "shown" });
    expect(sampleItem()).not.toBeNull();
    expect(screen.getByRole("link", { name: "Open the sample storefront" })).toHaveAttribute(
      "href",
      "/storefront/sample",
    );
    expect(screen.getByText("No storefronts yet")).toBeInTheDocument();
    expect(screen.queryByText("0 storefronts")).toBeNull();
    // The create card, not the full empty state.
    expect(screen.getByRole("button", { name: /create your first storefront/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No storefronts yet" })).toBeNull();
  });

  it("comes after the seller's own cards", async () => {
    await renderList({ sample: "shown", storefronts: [storefront("Gilt & Grain")] });
    // The list's own items: the previews inside them are grids of <li> too.
    const items = [...document.querySelectorAll("main > ul > li")];
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByRole("heading", { name: "Gilt & Grain" })).toBeInTheDocument();
    expect(items[1]).toBe(sampleItem());
    expect(screen.getByText("1 storefront")).toBeInTheDocument();
    // The first embed button is the seller's own storefront's.
    expect(screen.getAllByRole("button", { name: /^Embed / })[0]).toHaveAccessibleName("Embed Gilt & Grain");
  });

  it("hides on request, records it, and can be brought back", async () => {
    const user = userEvent.setup();
    await renderList({ sample: "shown" });

    await user.click(screen.getByRole("button", { name: "Hide the sample storefront" }));
    expect(sampleItem()).toBeNull();
    expect(actions.setSampleStorefrontHidden).toHaveBeenCalledWith(true);
    // With nothing left, the full empty state is back.
    expect(screen.getByRole("heading", { name: "No storefronts yet" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show the sample storefront" }));
    await waitFor(() => expect(sampleItem()).not.toBeNull());
    expect(actions.setSampleStorefrontHidden).toHaveBeenLastCalledWith(false);
  });

  it("puts the sample back when hiding it fails", async () => {
    actions.setSampleStorefrontHidden.mockImplementation(async () => ({ ok: false }));
    const user = userEvent.setup();
    await renderList({ sample: "shown" });
    await user.click(screen.getByRole("button", { name: "Hide the sample storefront" }));
    await waitFor(() => expect(sampleItem()).not.toBeNull());
    expect(await screen.findByText("Couldn't hide the sample storefront.")).toBeInTheDocument();
  });

  it("offers only the way back when this person hid it", async () => {
    await renderList({ sample: "hidden" });
    expect(sampleItem()).toBeNull();
    expect(screen.getByRole("button", { name: "Show the sample storefront" })).toBeInTheDocument();
  });

  it("offers nothing to a read-only role or when the flag could not be read", async () => {
    await renderList({ sample: "shown", canWrite: false });
    expect(sampleItem()).toBeNull();
    expect(screen.queryByRole("button", { name: "Show the sample storefront" })).toBeNull();
    cleanup();

    await renderList({ sample: null });
    expect(sampleItem()).toBeNull();
    expect(screen.queryByRole("button", { name: "Show the sample storefront" })).toBeNull();
    expect(screen.getByRole("heading", { name: "No storefronts yet" })).toBeInTheDocument();
  });

  it("explains embedding from the sample card, and leads into the setup flow", async () => {
    const user = userEvent.setup();
    await renderList({ sample: "shown" });
    await user.click(screen.getByRole("button", { name: "Embed Sample storefront" }));
    const dialog = await screen.findByRole("dialog", { name: "Embed a storefront" });
    expect(dialog).toHaveTextContent("your-storefront-key");
    expect(dialog).toHaveTextContent(/still in development/i);
    await user.click(within(dialog).getByRole("button", { name: "Create a storefront" }));
    expect(await screen.findByRole("dialog", { name: "Create storefront setup" })).toBeInTheDocument();
  });

});
