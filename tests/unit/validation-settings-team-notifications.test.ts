import { describe, expect, it } from "vitest";
import {
  deleteConfirmSchema,
  emailChangeSchema,
  legalAcceptSchema,
  notificationsSchema,
  passwordChangeSchema,
  taxSchema,
} from "@/lib/validation/settings";
import { usernameSchema } from "@/lib/validation/auth";
import {
  teamAcceptSchema,
  teamChangeRoleSchema,
  teamInviteSchema,
  teamRevokeSchema,
} from "@/lib/validation/team";
import {
  createNotificationSchema,
  markReadSchema,
  notificationPageSchema,
} from "@/lib/validation/notifications";
import { LEGAL_VERSION } from "@/lib/settings/constants";

const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("usernameSchema (the account's one name)", () => {
  it("accepts, trims and normalizes to the stored form", () => {
    const r = usernameSchema.safeParse({ username: "  BuilderBoy  " });
    expect(r.success && r.data.username).toBe("builderboy");
  });

  it("rejects empty, whitespace and over-length", () => {
    expect(usernameSchema.safeParse({ username: "" }).success).toBe(false);
    expect(usernameSchema.safeParse({ username: "   " }).success).toBe(false);
    expect(usernameSchema.safeParse({ username: "x".repeat(31) }).success).toBe(false);
  });

  it("rejects what a free-form display name used to allow", () => {
    // This field is now half of a credential, so spaces and non-ASCII are out:
    // they invite look-alike accounts that a case-fold cannot catch.
    for (const bad of ["Builder Boy", "buildér", "builder-boy", "аdmin", "ab"]) {
      expect(usernameSchema.safeParse({ username: bad }).success, bad).toBe(false);
    }
  });

  it("strictObject: rejects smuggled profile fields (field whitelist)", () => {
    for (const extra of [
      { is_seller: true },
      { avatar_url: "https://evil" },
      { id: UUID },
      { role: "owner" },
    ]) {
      expect(
        usernameSchema.safeParse({ username: "okname", ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });
});

describe("emailChangeSchema", () => {
  it("accepts a normal email", () => {
    expect(emailChangeSchema.safeParse({ new_email: "a@b.com" }).success).toBe(true);
  });
  it("rejects junk and oversized", () => {
    expect(emailChangeSchema.safeParse({ new_email: "not-an-email" }).success).toBe(false);
    expect(
      emailChangeSchema.safeParse({ new_email: `${"a".repeat(250)}@b.com` }).success,
    ).toBe(false);
  });
});

describe("passwordChangeSchema", () => {
  const good = {
    current_password: "old-password",
    new_password: "new-password-123",
    confirm_password: "new-password-123",
  };
  it("accepts matching valid passwords", () => {
    expect(passwordChangeSchema.safeParse(good).success).toBe(true);
  });
  it("rejects mismatched confirmation", () => {
    expect(
      passwordChangeSchema.safeParse({ ...good, confirm_password: "different" }).success,
    ).toBe(false);
  });
  it("enforces 8..72 length on the NEW password (bcrypt cap)", () => {
    expect(
      passwordChangeSchema.safeParse({ ...good, new_password: "short", confirm_password: "short" })
        .success,
    ).toBe(false);
    const long = "x".repeat(73);
    expect(
      passwordChangeSchema.safeParse({ ...good, new_password: long, confirm_password: long })
        .success,
    ).toBe(false);
  });
  it("requires the current password", () => {
    expect(
      passwordChangeSchema.safeParse({ ...good, current_password: "" }).success,
    ).toBe(false);
  });
});

describe("taxSchema", () => {
  it("empty strings store as null", () => {
    const r = taxSchema.safeParse({ tax_business_name: "", tax_vat_id: "", tax_country: "" });
    expect(r.success && r.data).toEqual({
      tax_business_name: null,
      tax_vat_id: null,
      tax_country: null,
    });
  });
  it("uppercases the VAT id", () => {
    const r = taxSchema.safeParse({
      tax_business_name: "Studio",
      tax_vat_id: "ie1234567t",
      tax_country: "IE",
    });
    expect(r.success && r.data.tax_vat_id).toBe("IE1234567T");
  });
  it("rejects VAT ids with hostile characters", () => {
    for (const vat of ["<script>", "a", "x".repeat(33), "DE!123"]) {
      expect(
        taxSchema.safeParse({ tax_business_name: "", tax_vat_id: vat, tax_country: "" }).success,
        vat,
      ).toBe(false);
    }
  });
  it("country must be an EU code from the list", () => {
    expect(
      taxSchema.safeParse({ tax_business_name: "", tax_vat_id: "", tax_country: "US" }).success,
    ).toBe(false);
    expect(
      taxSchema.safeParse({ tax_business_name: "", tax_vat_id: "", tax_country: "ie" }).success,
    ).toBe(false);
    expect(
      taxSchema.safeParse({ tax_business_name: "", tax_vat_id: "", tax_country: "IE" }).success,
    ).toBe(true);
  });
});

describe("notificationsSchema", () => {
  it("booleans only — no string coercion through the boundary", () => {
    expect(
      notificationsSchema.safeParse({
        notify_sales: true,
        notify_product_updates: false,
        notify_marketing: false,
      }).success,
    ).toBe(true);
    expect(
      notificationsSchema.safeParse({
        notify_sales: "on",
        notify_product_updates: false,
        notify_marketing: false,
      }).success,
    ).toBe(false);
  });
});

describe("legalAcceptSchema", () => {
  it("only the exact current version is acceptable", () => {
    expect(legalAcceptSchema.safeParse({ version: LEGAL_VERSION }).success).toBe(true);
    expect(legalAcceptSchema.safeParse({ version: "1999-old" }).success).toBe(false);
  });
});

describe("deleteConfirmSchema", () => {
  it("accepts the phrase case-insensitively and trimmed", () => {
    expect(deleteConfirmSchema.safeParse({ confirm: "delete my account" }).success).toBe(true);
    expect(deleteConfirmSchema.safeParse({ confirm: "  DELETE MY ACCOUNT  " }).success).toBe(true);
  });
  it("rejects anything else", () => {
    expect(deleteConfirmSchema.safeParse({ confirm: "delete account" }).success).toBe(false);
    expect(deleteConfirmSchema.safeParse({ confirm: "" }).success).toBe(false);
  });
});

describe("teamInviteSchema", () => {
  it("lowercases the invited email", () => {
    const r = teamInviteSchema.safeParse({
      account_owner_id: UUID,
      invited_email: "Friend@Example.COM",
      role: "viewer",
    });
    expect(r.success && r.data.invited_email).toBe("friend@example.com");
  });
  it("owner is not an assignable role", () => {
    expect(
      teamInviteSchema.safeParse({
        account_owner_id: UUID,
        invited_email: "a@b.com",
        role: "owner",
      }).success,
    ).toBe(false);
  });
  it("rejects non-uuid account ids and junk emails", () => {
    expect(
      teamInviteSchema.safeParse({
        account_owner_id: "me",
        invited_email: "a@b.com",
        role: "viewer",
      }).success,
    ).toBe(false);
    expect(
      teamInviteSchema.safeParse({
        account_owner_id: UUID,
        invited_email: "nope",
        role: "viewer",
      }).success,
    ).toBe(false);
  });
  it("strictObject rejects extra fields (e.g. status: active smuggling)", () => {
    expect(
      teamInviteSchema.safeParse({
        account_owner_id: UUID,
        invited_email: "a@b.com",
        role: "viewer",
        status: "active",
      }).success,
    ).toBe(false);
  });
});

describe("teamChangeRole / teamRevoke / teamAccept schemas", () => {
  it("change-role never accepts owner", () => {
    expect(
      teamChangeRoleSchema.safeParse({
        account_owner_id: UUID,
        member_id: UUID,
        role: "owner",
      }).success,
    ).toBe(false);
  });
  it("uuids required everywhere", () => {
    expect(
      teamRevokeSchema.safeParse({ account_owner_id: UUID, member_id: "x" }).success,
    ).toBe(false);
    expect(teamAcceptSchema.safeParse({ invite_id: UUID }).success).toBe(true);
    expect(teamAcceptSchema.safeParse({ invite_id: "1" }).success).toBe(false);
  });
});

describe("createNotificationSchema", () => {
  it("accepts a minimal notification and defaults data to {}", () => {
    const r = createNotificationSchema.safeParse({
      userId: UUID,
      type: "team",
      title: "You were invited",
    });
    expect(r.success && r.data.data).toEqual({});
    expect(r.success && r.data.body).toBeNull();
  });
  it("empty body becomes null", () => {
    const r = createNotificationSchema.safeParse({
      userId: UUID,
      type: "team",
      title: "t",
      body: "  ",
    });
    expect(r.success && r.data.body).toBeNull();
  });
  it("caps title at 200 and body at 1000 (mirrors DB CHECKs)", () => {
    expect(
      createNotificationSchema.safeParse({
        userId: UUID,
        type: "team",
        title: "x".repeat(201),
      }).success,
    ).toBe(false);
    expect(
      createNotificationSchema.safeParse({
        userId: UUID,
        type: "team",
        title: "t",
        body: "x".repeat(1001),
      }).success,
    ).toBe(false);
  });
  it("type is a closed enum", () => {
    expect(
      createNotificationSchema.safeParse({
        userId: UUID,
        type: "phishing",
        title: "t",
      }).success,
    ).toBe(false);
  });
});

describe("markRead + page schemas", () => {
  it("markRead takes exactly one uuid", () => {
    expect(markReadSchema.safeParse({ id: UUID }).success).toBe(true);
    expect(markReadSchema.safeParse({ id: UUID, read: false }).success).toBe(false);
  });
  it("page limit is clamped to 1..50 and cursor must be ISO", () => {
    expect(notificationPageSchema.safeParse({}).data?.limit).toBe(20);
    expect(notificationPageSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(notificationPageSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(
      notificationPageSchema.safeParse({ cursor: "2026-07-10T12:00:00+00:00" }).success,
    ).toBe(true);
    expect(notificationPageSchema.safeParse({ cursor: "yesterday" }).success).toBe(false);
  });
});
