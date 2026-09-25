import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "../setup/render";
import userEvent from "@testing-library/user-event";
import { NotificationItem } from "@/components/notifications/NotificationItem";
import type { Notification } from "@/lib/notifications/types";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en";

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
    // ...and no <img> element should have been injected (the brand logo is
    // the only image the row renders).
    expect(document.querySelector("img:not([src='/img/logo.png'])")).toBeNull();
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

  // --- Stored message keys (resolved in the reader's language) ---

  const STALE = "Stored English";

  function renderStored(data: Notification["data"], body: string | null = null) {
    render(
      <NotificationItem
        notification={makeNotification({ title: STALE, body, data })}
        onActivate={vi.fn()}
      />,
    );
  }

  it("resolves the stored keys and values instead of the stored text", () => {
    renderStored(
      {
        href: "/settings/team",
        message: {
          title: { key: "Notifications.messages.teamJoined.title", values: { name: "builderboy" } },
          body: { key: "Notifications.messages.teamJoined.body" },
        },
      },
      "Stored body",
    );
    expect(screen.getByText("builderboy joined your team")).toBeInTheDocument();
    expect(screen.getByText("They now have access to your store.")).toBeInTheDocument();
    expect(screen.queryByText(STALE)).not.toBeInTheDocument();
  });

  it("resolves in the reader's language, not the language it was sent in", () => {
    const czech = {
      ...messages,
      Notifications: {
        ...messages.Notifications,
        messages: {
          ...messages.Notifications.messages,
          teamInvite: { ...messages.Notifications.messages.teamInvite, title: "Máte pozvánku do týmu" },
        },
      },
    };
    render(
      <NextIntlClientProvider locale="cs" messages={czech} timeZone="UTC">
        <NotificationItem
          notification={makeNotification({
            title: "You have a team invite",
            data: { message: { title: { key: "Notifications.messages.teamInvite.title" } } },
          })}
          onActivate={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Máte pozvánku do týmu")).toBeInTheDocument();
  });

  it.each([
    ["no message at all", { href: "/settings/team" }],
    ["a key that does not exist", { message: { title: { key: "Notifications.messages.nope" } } }],
    ["a key naming a group, not a message", { message: { title: { key: "Notifications.messages" } } }],
    ["a key outside the Notifications namespace", { message: { title: { key: "Common.actions.save" } } }],
    ["a key that is not a string", { message: { title: { key: 42 } } }],
    [
      "a value that is not a string or number",
      { message: { title: { key: "Notifications.messages.teamJoined.title", values: { name: { html: "<b>" } } } } },
    ],
    ["a message that is not an object", { message: "Notifications.messages.teamInvite.title" }],
    [
      "a message missing a value it needs",
      { message: { title: { key: "Notifications.messages.teamJoined.title" } } },
    ],
  ])("falls back to the stored text on %s", (_label, data) => {
    renderStored(data);
    expect(screen.getByText(STALE)).toBeInTheDocument();
    expect(screen.queryByText(/Notifications./)).not.toBeInTheDocument();
  });

  it("refuses the whole payload when any part of it is invalid", () => {
    renderStored(
      {
        message: {
          title: { key: "Notifications.messages.teamInvite.title" },
          body: { key: "Settings.team.cardTitle" },
        },
      },
      "Stored body",
    );
    expect(screen.getByText(STALE)).toBeInTheDocument();
    expect(screen.getByText("Stored body")).toBeInTheDocument();
  });
});
