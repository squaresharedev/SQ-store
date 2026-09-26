// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  NO_NOTIFICATION_FILTER,
  isFiltered,
  notificationFilterQuery,
  parseNotificationFilter,
} from "@/lib/notifications/filters";
import {
  legacyInviteDetails,
  notificationDestination,
  storedNotificationAction,
} from "@/lib/notifications/inline-actions";
import { notificationPageSchema } from "@/lib/validation/notifications";

const INVITE = "40000000-0000-4000-8000-000000000004";
const OWNER = "10000000-0000-4000-8000-000000000001";

describe("notification filter (URL)", () => {
  it("reads a category and the unread toggle", () => {
    expect(parseNotificationFilter({ type: "security", status: "unread" })).toEqual({
      type: "security",
      unread: true,
    });
  });

  it("drops anything it does not recognise rather than echoing it", () => {
    expect(parseNotificationFilter({ type: "'; drop table", status: "read" })).toEqual(
      NO_NOTIFICATION_FILTER,
    );
    expect(parseNotificationFilter({ type: ["team", "order"] })).toEqual({ type: "team", unread: false });
    expect(parseNotificationFilter({})).toEqual(NO_NOTIFICATION_FILTER);
  });

  it("round-trips through the query string", () => {
    for (const filter of [
      NO_NOTIFICATION_FILTER,
      { type: "team", unread: false },
      { type: null, unread: true },
      { type: "policy", unread: true },
    ] as const) {
      const query = notificationFilterQuery(filter);
      const params = Object.fromEntries(new URLSearchParams(query.replace(/^\?/, "")));
      expect(parseNotificationFilter(params)).toEqual(filter);
    }
    expect(notificationFilterQuery(NO_NOTIFICATION_FILTER)).toBe("");
  });

  it("knows when a view is filtered", () => {
    expect(isFiltered(NO_NOTIFICATION_FILTER)).toBe(false);
    expect(isFiltered({ type: "team", unread: false })).toBe(true);
    expect(isFiltered({ type: null, unread: true })).toBe(true);
  });

  it("'load more' re-validates the filter it is sent", () => {
    expect(notificationPageSchema.safeParse({ type: "team", unread: true }).success).toBe(true);
    expect(notificationPageSchema.safeParse({ type: "nope" }).success).toBe(false);
    expect(notificationPageSchema.safeParse({ unread: "yes" }).success).toBe(false);
  });
});

describe("stored inline action", () => {
  it("accepts exactly the shape a producer writes", () => {
    expect(
      storedNotificationAction({
        href: "/settings/team",
        action: { kind: "team.acceptInvite", inviteId: INVITE, accountOwnerId: OWNER },
      }),
    ).toEqual({ kind: "team.acceptInvite", inviteId: INVITE, accountOwnerId: OWNER });
  });

  it.each([
    ["no action", { href: "/settings/team" }],
    ["an unknown kind", { action: { kind: "orders.refund", inviteId: INVITE, accountOwnerId: OWNER } }],
    ["a malformed id", { action: { kind: "team.acceptInvite", inviteId: "1 or 1=1", accountOwnerId: OWNER } }],
    ["an extra field", { action: { kind: "team.acceptInvite", inviteId: INVITE, accountOwnerId: OWNER, role: "owner" } }],
    ["not an object", { action: "team.acceptInvite" }],
    ["null data", null],
  ])("refuses %s", (_label, data) => {
    expect(storedNotificationAction(data)).toBeNull();
  });

  it("recognises an invite written before invites carried their id", () => {
    const data = {
      href: "/settings/team",
      message: {
        title: { key: "Notifications.messages.teamInvite.title" },
        body: { key: "Notifications.messages.teamInvite.body", values: { store: "builderboy", role: "viewer" } },
      },
    };
    expect(legacyInviteDetails("team", data)).toEqual({ store: "builderboy", role: "viewer" });
    // Only a team row can be an invite, whatever its payload says.
    expect(legacyInviteDetails("system", data)).toBeNull();
    expect(
      legacyInviteDetails("team", {
        message: { title: { key: "Notifications.messages.teamJoined.titleUnnamed" } },
      }),
    ).toBeNull();
  });
});

describe("notification destination", () => {
  it("prefers the row's own safe link", () => {
    expect(notificationDestination("policy", { href: "/products/abc/edit" })).toBe("/products/abc/edit");
  });

  it("falls back to the category's page when there is no link", () => {
    expect(notificationDestination("team", null)).toBe("/settings/team");
    expect(notificationDestination("security", {})).toBe("/settings/security");
  });

  it("has nowhere to go for a category without a home", () => {
    expect(notificationDestination("system", null)).toBeNull();
    expect(notificationDestination("policy", {})).toBeNull();
  });

  it.each(["https://evil.com", "//evil.com", "/\t/evil.com", "javascript:alert(1)", 42])(
    "rejects %s without guessing a fallback",
    (href) => {
      expect(notificationDestination("team", { href })).toBeNull();
    },
  );
});
