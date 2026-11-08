/**
 * InstallOffer: Overview's one-time "add to your home screen".
 *
 * What these pin: nothing shows until the browser offers to install, and only
 * on a touch screen; the browser's own banner is held back for it; a tap hands
 * over to the browser's own question, once; and an answer either way is
 * remembered on this device, so the offer never comes back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, cleanup, render, screen, waitFor } from "../setup/render";
import { INSTALL_OFFER_DISMISSED_KEY, InstallOffer } from "@/components/pwa/InstallOffer";

const TITLE = "Add Square Share to your home screen";

/** jsdom has no matchMedia; the offer asks it whether the screen is touch. */
function pointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/** The browser saying it can install the app: Chromium's event, with its prompt. */
function offerInstall() {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(async () => undefined),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  localStorage.clear();
  pointer(true);
});
afterEach(cleanup);

describe("InstallOffer", () => {
  it("shows nothing until the browser offers to install, then holds its banner back", () => {
    render(<InstallOffer />);
    expect(screen.queryByText(TITLE)).toBeNull();

    const event = offerInstall();
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(event.defaultPrevented).toBe(true);
  });

  it("hands a tap to the browser's question, once, and remembers it", async () => {
    const user = userEvent.setup();
    render(<InstallOffer />);
    const event = offerInstall();

    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    expect(localStorage.getItem(INSTALL_OFFER_DISMISSED_KEY)).toBe("1");
  });

  it("remembers being closed, so it does not come back on this device", async () => {
    const user = userEvent.setup();
    const first = render(<InstallOffer />);
    offerInstall();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull());
    first.unmount();

    render(<InstallOffer />);
    offerInstall();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it("stays away without a touch screen, where home screen is the wrong word", () => {
    pointer(false);
    render(<InstallOffer />);
    offerInstall();
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});
