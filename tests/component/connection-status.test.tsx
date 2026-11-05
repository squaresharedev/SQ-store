import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderWithoutToasts, screen } from "../setup/render";
import { ConnectionStatus } from "@/components/pwa/ConnectionStatus";
import { ToastProvider } from "@/components/ui/Toast";
import { BACK_ONLINE_FLAG } from "@/lib/pwa/paths";
import { english } from "../setup/translate";

const pathname = vi.hoisted(() => ({ value: "/orders" }));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  usePathname: () => pathname.value,
}));

const OFFLINE = english("Common.connection.offline");
const BACK_ONLINE = english("Common.connection.backOnline");

/** Past the short blip the component stays quiet for. */
const PAST_BLIP_MS = 2000;

function setOnline(online: boolean) {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(online);
}

function fire(event: "online" | "offline") {
  setOnline(event === "online");
  act(() => {
    window.dispatchEvent(new Event(event));
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function mount() {
  renderWithoutToasts(
    <ToastProvider>
      <ConnectionStatus />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  setOnline(true);
  pathname.value = "/orders";
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ConnectionStatus", () => {
  it("says nothing on an ordinary page load", () => {
    mount();
    advance(PAST_BLIP_MS);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps saying offline for as long as it is, then swaps to back online", () => {
    mount();
    fire("offline");
    advance(PAST_BLIP_MS);
    expect(screen.getByText(OFFLINE)).toBeTruthy();

    // Pinned: far past any toast's normal lifetime.
    advance(60_000);
    expect(screen.getByText(OFFLINE)).toBeTruthy();

    fire("online");
    expect(screen.getByText(BACK_ONLINE)).toBeTruthy();
    advance(500);
    expect(screen.queryByText(OFFLINE)).toBeNull();

    // And the good news leaves by itself.
    advance(10_000);
    expect(screen.queryByText(BACK_ONLINE)).toBeNull();
  });

  it("stays silent through a drop too short to matter", () => {
    mount();
    fire("offline");
    advance(500);
    fire("online");
    advance(PAST_BLIP_MS);
    expect(screen.queryByText(OFFLINE)).toBeNull();
    expect(screen.queryByText(BACK_ONLINE)).toBeNull();
  });

  it("says offline straight away for a page that opens with no connection", () => {
    setOnline(false);
    mount();
    advance(PAST_BLIP_MS);
    expect(screen.getByText(OFFLINE)).toBeTruthy();
  });

  it("says back online after the offline page reloaded into this one, once", () => {
    sessionStorage.setItem(BACK_ONLINE_FLAG, "1");
    mount();
    expect(screen.getByText(BACK_ONLINE)).toBeTruthy();
    expect(sessionStorage.getItem(BACK_ONLINE_FLAG)).toBeNull();
  });

  it("leaves the flag for later when the connection is still down", () => {
    sessionStorage.setItem(BACK_ONLINE_FLAG, "1");
    setOnline(false);
    mount();
    expect(screen.queryByText(BACK_ONLINE)).toBeNull();
    expect(sessionStorage.getItem(BACK_ONLINE_FLAG)).toBe("1");
  });

  it("stays out of the embed frame, which is someone else's page", () => {
    pathname.value = "/e/key/example.com";
    mount();
    fire("offline");
    advance(PAST_BLIP_MS);
    expect(screen.queryByText(OFFLINE)).toBeNull();
  });
});
