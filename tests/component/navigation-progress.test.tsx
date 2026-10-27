import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "../setup/render";
import { AppLink, PREFETCH_INTENT_MS } from "@/components/ui/AppLink";
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
  // The prefetch prop is shown as data-prefetch, for the tests to read.
  default: ({
    href,
    children,
    prefetch,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    prefetch?: boolean | "auto" | null;
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
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

/**
 * Every page fetched ahead is a server render on the Worker. Fetching every
 * link on screen ran it out of CPU (Cloudflare Error 1102), so a link fetches
 * its page ahead only once someone shows they mean to follow it.
 */
describe("AppLink prefetching", () => {
  const prefetch = () => screen.getByRole("link").getAttribute("data-prefetch");

  it("fetches nothing ahead while the link is merely on screen", () => {
    render(<AppLink href="/orders">Orders</AppLink>);
    elapse(PREFETCH_INTENT_MS * 10);
    expect(prefetch()).toBe("false");
  });

  it("fetches ahead once the pointer rests on it", () => {
    render(<AppLink href="/orders">Orders</AppLink>);
    fireEvent.mouseEnter(screen.getByRole("link"));
    elapse(PREFETCH_INTENT_MS - 1);
    expect(prefetch()).toBe("false");
    elapse(1);
    // null is next/link's own default: fetch now that the link is on screen.
    expect(prefetch()).toBe("null");
  });

  it("fetches nothing for a pointer passing over on its way elsewhere", () => {
    render(<AppLink href="/orders">Orders</AppLink>);
    const anchor = screen.getByRole("link");
    fireEvent.mouseEnter(anchor);
    elapse(PREFETCH_INTENT_MS / 2);
    fireEvent.mouseLeave(anchor);
    elapse(PREFETCH_INTENT_MS * 10);
    expect(prefetch()).toBe("false");
  });

  it("counts keyboard focus resting on it as intent", () => {
    render(<AppLink href="/orders">Orders</AppLink>);
    fireEvent.focus(screen.getByRole("link"));
    elapse(PREFETCH_INTENT_MS);
    expect(prefetch()).toBe("null");
  });

  it("leaves a prefetch prop passed in as it is", () => {
    render(
      <AppLink href="/orders" prefetch>
        Orders
      </AppLink>,
    );
    expect(prefetch()).toBe("true");
  });

  it("still runs the caller's own pointer and focus handlers", () => {
    const onMouseEnter = vi.fn();
    const onFocus = vi.fn();
    render(
      <AppLink href="/orders" onMouseEnter={onMouseEnter} onFocus={onFocus}>
        Orders
      </AppLink>,
    );
    fireEvent.mouseEnter(screen.getByRole("link"));
    fireEvent.focus(screen.getByRole("link"));
    expect(onMouseEnter).toHaveBeenCalledOnce();
    expect(onFocus).toHaveBeenCalledOnce();
  });
});
