import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationItem } from "@/components/notifications/NotificationItem";
import type { Notification } from "@/lib/notifications/types";

afterEach(cleanup);

const mockPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notif-1",
    user_id: "user-1",
    type: "system",
    title: "Test notification",
    body: null,
    read: false,
    created_at: new Date().toISOString(),
    data: null,
    ...overrides,
  } as Notification;
}

describe("NotificationItem", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  // --- Text-only rendering (XSS guard) ---

  it("renders title as plain text — no HTML injection", () => {
    const xssTitle = '<img src=x onerror="window.__xss=1">';
    const onActivate = vi.fn();
    render(
      <NotificationItem
        notification={makeNotification({ title: xssTitle })}
        onActivate={onActivate}
      />,
    );
    // The literal string must appear as text content...
    expect(screen.getByText(xssTitle)).toBeInTheDocument();
    // ...and no <img> element should have been injected.
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders body as plain text when present", () => {
    const xssBody = "<script>alert(1)</script>";
    render(
      <NotificationItem
        notification={makeNotification({ body: xssBody })}
        onActivate={vi.fn()}
      />,
    );
    expect(screen.getByText(xssBody)).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  // --- Click / onActivate ---

  it("calls onActivate with the notification id on click", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(
      <NotificationItem
        notification={makeNotification({ id: "notif-abc", data: null })}
        onActivate={onActivate}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(onActivate).toHaveBeenCalledWith("notif-abc", null);
  });

  // --- Safe in-app href ---

  it("safe in-app href: navigates via router.push", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(
      <NotificationItem
        notification={makeNotification({ data: { href: "/orders/123" } })}
        onActivate={onActivate}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(mockPush).toHaveBeenCalledWith("/orders/123");
    expect(onActivate).toHaveBeenCalledWith(expect.any(String), "/orders/123");
  });

  // --- Unsafe hrefs must NOT navigate ---

  it("external https href does NOT call router.push", async () => {
    const user = userEvent.setup();
    render(
      <NotificationItem
        notification={makeNotification({ data: { href: "https://evil.com" } })}
        onActivate={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("protocol-relative href //evil.com does NOT call router.push", async () => {
    const user = userEvent.setup();
    render(
      <NotificationItem
        notification={makeNotification({ data: { href: "//evil.com" } })}
        onActivate={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("javascript: href does NOT call router.push", async () => {
    const user = userEvent.setup();
    render(
      <NotificationItem
        notification={makeNotification({ data: { href: "javascript:alert(1)" } })}
        onActivate={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("null data does NOT call router.push", async () => {
    const user = userEvent.setup();
    render(
      <NotificationItem
        notification={makeNotification({ data: null })}
        onActivate={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(mockPush).not.toHaveBeenCalled();
  });

  // --- Read / unread state ---

  it("unread notification shows 'Unread' indicator", () => {
    render(
      <NotificationItem
        notification={makeNotification({ read: false })}
        onActivate={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Unread")).toBeInTheDocument();
  });

  it("read notification has no unread indicator", () => {
    render(
      <NotificationItem
        notification={makeNotification({ read: true })}
        onActivate={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Unread")).not.toBeInTheDocument();
  });
});
