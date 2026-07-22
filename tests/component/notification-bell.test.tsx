import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import type { UseNotifications } from "@/lib/notifications/useNotifications";

afterEach(cleanup);

// The bell reads everything from the notifications context; stub it so we can
// drive `arrivalSeq` directly (realtime itself is covered by the hook).
const mockContext = vi.hoisted(() => ({ current: null as UseNotifications | null }));

vi.mock("@/components/notifications/NotificationsProvider", () => ({
  useNotificationsContext: () => mockContext.current,
}));

function setContext(overrides: Partial<UseNotifications> = {}) {
  mockContext.current = {
    loading: false,
    notifications: [],
    unreadCount: 0,
    status: "live",
    arrivalSeq: 0,
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

const bellIcon = () => document.querySelector(".bell-icon")!;

describe("NotificationBell ring animation", () => {
  it("does not ring before any notification has arrived", () => {
    setContext({ arrivalSeq: 0 });
    render(<NotificationBell />);
    expect(bellIcon().classList.contains("animate-bell-ring")).toBe(false);
  });

  it("rings once a notification arrives", () => {
    setContext({ arrivalSeq: 1 });
    render(<NotificationBell />);
    expect(bellIcon().classList.contains("animate-bell-ring")).toBe(true);
  });

  it("remounts the icon on each new arrival so the animation restarts", () => {
    setContext({ arrivalSeq: 1 });
    const { rerender } = render(<NotificationBell />);
    const first = bellIcon();

    // Same arrival → same element (a re-render must NOT replay the ring).
    setContext({ arrivalSeq: 1, unreadCount: 1 });
    rerender(<NotificationBell />);
    expect(bellIcon()).toBe(first);

    // Next arrival → new element, so the CSS animation runs from 0 again.
    setContext({ arrivalSeq: 2, unreadCount: 2 });
    rerender(<NotificationBell />);
    expect(bellIcon()).not.toBe(first);
    expect(bellIcon().classList.contains("animate-bell-ring")).toBe(true);
  });

  it("carries the group/bell hover scope and an accessible unread label", () => {
    setContext({ arrivalSeq: 0, unreadCount: 3 });
    render(<NotificationBell />);
    const button = screen.getByRole("button", { name: /3 unread/i });
    expect(button.className).toContain("group/bell");
  });
});
