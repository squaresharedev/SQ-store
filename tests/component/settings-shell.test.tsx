/**
 * The settings strip on a phone: a badge ("Recommended") swiped out of sight
 * leaves a dot on the end it went past, and only that end, so the nudge is not
 * lost on whichever tab the seller is on.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "../setup/render";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/notifications",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { SettingsShell } = await import("@/components/settings/SettingsShell");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Lays the strip out 375px wide, as a phone shows it, with the badge at `left`..`right`. */
function layOut(badge: { left: number; right: number }) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const { left, right } = this.hasAttribute("data-settings-badge") ? badge : { left: 0, right: 375 };
    return { left, right, x: left, y: 0, top: 0, bottom: 40, width: right - left, height: 40, toJSON: () => ({}) } as DOMRect;
  });
}

const dot = (edge: "start" | "end") => document.querySelector(`[data-badge-dot="${edge}"]`);

describe("the settings strip's badge dots", () => {
  it("light the end the badge is cut off at", () => {
    layOut({ left: 340, right: 420 });
    render(<SettingsShell securityRecommended>page</SettingsShell>);
    expect(dot("end")).toHaveClass("opacity-100");
    expect(dot("start")).toHaveClass("opacity-0");
  });

  it("light the start once the badge has been swiped past", () => {
    layOut({ left: -160, right: -80 });
    render(<SettingsShell securityRecommended>page</SettingsShell>);
    expect(dot("start")).toHaveClass("opacity-100");
    expect(dot("end")).toHaveClass("opacity-0");
  });

  it("stay dark while the badge is in view", () => {
    layOut({ left: 120, right: 200 });
    render(<SettingsShell securityRecommended>page</SettingsShell>);
    expect(dot("start")).toHaveClass("opacity-0");
    expect(dot("end")).toHaveClass("opacity-0");
  });

  it("stay dark when nothing is badged", () => {
    layOut({ left: 340, right: 420 });
    render(<SettingsShell>page</SettingsShell>);
    expect(dot("start")).toHaveClass("opacity-0");
    expect(dot("end")).toHaveClass("opacity-0");
  });

  it("follow the Legal badge too, while the Terms in force wait for an agreement", () => {
    layOut({ left: 340, right: 420 });
    render(<SettingsShell legalActionNeeded>page</SettingsShell>);
    const legal = screen.getByRole("link", { name: /legal/i });
    expect(legal).toHaveTextContent("Action needed");
    expect(dot("end")).toHaveClass("opacity-100");
  });
});
