import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, render, screen } from "../setup/render";
import { AppLink } from "@/components/ui/AppLink";
import { NavigationProgress } from "@/components/layout/NavigationProgress";
import { PENDING_DELAY_MS } from "@/components/ui/motion-tokens";
import { useProgressWhile } from "@/lib/hooks/useProgressWhile";

/**
 * "I clicked and nothing happened" has one answer for the whole app: the bar.
 * It must come up for slow work, stay away from quick work, and leave when the
 * work does. Links report through AppLink (the next/link wrapper every link
 * in the app uses), anything else through useProgressWhile.
 */

const link = vi.hoisted(() => ({ pending: false }));
vi.mock("next/link", () => ({
  // What Next reports for the link under the pointer.
  useLinkStatus: () => ({ pending: link.pending }),
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.useFakeTimers();
  link.pending = false;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const bar = () => document.querySelector(".nav-progress-bar");

function elapse(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function Busy({ on }: { on: boolean }) {
  useProgressWhile(on);
  return null;
}

function Page({ children }: { children?: ReactNode }) {
  return (
    <>
      <NavigationProgress />
      {children}
    </>
  );
}

describe("NavigationProgress", () => {
  it("shows nothing at rest", () => {
    render(<Page />);
    elapse(PENDING_DELAY_MS * 3);
    expect(bar()).toBeNull();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("comes up once work has outlasted the delay, and announces it", () => {
    render(
      <Page>
        <Busy on />
      </Page>,
    );
    elapse(PENDING_DELAY_MS - 1);
    expect(bar()).toBeNull();

    elapse(1);
    expect(bar()).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });

  it("never shows for work that finishes in time", () => {
    const { rerender } = render(
      <Page>
        <Busy on />
      </Page>,
    );
    elapse(PENDING_DELAY_MS - 50);
    rerender(
      <Page>
        <Busy on={false} />
      </Page>,
    );
    elapse(PENDING_DELAY_MS * 3);
    expect(bar()).toBeNull();
  });

  it("leaves when the work does", () => {
    const { rerender } = render(
      <Page>
        <Busy on />
      </Page>,
    );
    elapse(PENDING_DELAY_MS);
    expect(bar()).not.toBeNull();

    rerender(
      <Page>
        <Busy on={false} />
      </Page>,
    );
    elapse(1000);
    expect(bar()).toBeNull();
  });

  it("stays up until the last of several things is done", () => {
    const { rerender } = render(
      <Page>
        <Busy on />
        <Busy on />
      </Page>,
    );
    elapse(PENDING_DELAY_MS);
    rerender(
      <Page>
        <Busy on={false} />
        <Busy on />
      </Page>,
    );
    elapse(2000);
    expect(bar()).not.toBeNull();
  });
});

describe("AppLink", () => {
  it("renders the link as next/link does, with its label and attributes", () => {
    render(
      <AppLink href="/orders" className="x" aria-label="Orders page">
        Orders
      </AppLink>,
    );
    const anchor = screen.getByRole("link", { name: "Orders page" });
    expect(anchor).toHaveAttribute("href", "/orders");
    expect(anchor).toHaveClass("x");
    expect(anchor).toHaveTextContent("Orders");
  });

  it("raises the bar while its page change is slow", () => {
    link.pending = true;
    render(
      <Page>
        <AppLink href="/orders">Orders</AppLink>
      </Page>,
    );
    elapse(PENDING_DELAY_MS);
    expect(bar()).not.toBeNull();
  });

  it("raises nothing when no page change is under way", () => {
    render(
      <Page>
        <AppLink href="/orders">Orders</AppLink>
      </Page>,
    );
    elapse(PENDING_DELAY_MS * 3);
    expect(bar()).toBeNull();
  });
});
