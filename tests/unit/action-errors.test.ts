// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  notFound,
  permissionDenied,
  rateLimited,
  serverError,
  sessionExpired,
  traderIdentityRequired,
  unexpectedError,
} from "@/lib/errors";
import { DELETE_CONFIRM_PHRASES, isDeleteConfirmPhrase } from "@/lib/settings/constants";
import { LOCALES } from "@/i18n/locales";
import { firstIssue, issueKey, issueMessage } from "@/lib/validation/messages";
import {
  boundedInt,
  multiLineText,
  referenceCode,
  singleLineText,
  uniqueList,
  hostname,
} from "@/lib/validation/inputs";
import { deleteConfirmSchema } from "@/lib/validation/settings";
import { english } from "../setup/translate";

/**
 * The factories used to build English sentences in code. They now return
 * message keys, and the English a reader sees must not have moved by a
 * character: these are the strings the old factories produced.
 */
describe("ActionError factories: English is unchanged", () => {
  it("sessionExpired", () => {
    const error = sessionExpired();
    expect(error.code).toBe("session_expired");
    expect(english(error.message)).toBe("Your session has expired.");
    expect(english(error.fix!)).toBe(
      "Sign in again, then retry. Work you typed in this tab is kept until you leave the page.",
    );
  });

  it("permissionDenied names the role as data, and says the same without one", () => {
    expect(english(permissionDenied("viewer", "editProducts").message)).toBe(
      "Your Viewer role can't edit products in this store.",
    );
    expect(english(permissionDenied("editor", "deleteStorefronts").message)).toBe(
      "Your Editor role can't delete storefronts in this store.",
    );
    expect(english(permissionDenied(null, "previewProductPages").message)).toBe(
      "You don't have permission to preview product pages in this store.",
    );
    expect(english(permissionDenied("viewer", "viewStorefronts").fix!)).toBe(
      "Only the store owner can change roles. Ask them to upgrade you to Editor in Team settings.",
    );
  });

  it("notFound, rateLimited, serverError", () => {
    expect(english(notFound("storefront").message)).toBe("That storefront could not be found.");
    expect(english(rateLimited("rotateEmbedKeys").message)).toBe(
      "Too many attempts to rotate embed keys in a short time.",
    );
    expect(english(serverError("verifyImageUpload").message)).toBe(
      "Could not verify your image upload because of a problem on our side.",
    );
  });

  it("unexpectedError passes a thrown detail through as data", () => {
    expect(english(unexpectedError().message)).toBe("Something went wrong.");
    expect(english(unexpectedError("Failed to fetch").message)).toBe("Failed to fetch");
  });

  it("traderIdentityRequired words every combination of missing fields", () => {
    const fix = (missing: Parameters<typeof traderIdentityRequired>[0]) =>
      english(traderIdentityRequired(missing).fix!);
    expect(fix(["email"])).toBe(
      "Add your contact email in Settings › Business & seller details, then publish.",
    );
    expect(fix(["businessName", "email"])).toBe(
      "Add your trader name and contact email in Settings › Business & seller details, then publish.",
    );
    expect(fix(["businessName", "address", "email"])).toBe(
      "Add your trader name, business address and contact email in Settings › Business & seller details, then publish.",
    );
    expect(fix(["address", "emailVerified"])).toBe(
      "Add your business address in Settings › Business & seller details, and confirm your contact email from the link we sent you.",
    );
    expect(fix(["emailVerified"])).toBe(
      "Open the confirmation link we emailed to your contact address. You can send a new one from Settings › Business & seller details.",
    );
    expect(fix([])).toBe("Complete Settings › Business & seller details, then publish.");

    const error = traderIdentityRequired(["address"]);
    expect(english(error.message)).toBe(
      "You can't publish or sell until your seller details are complete.",
    );
    expect(error.action?.href).toBe("/settings/tax#address");
    expect(english(error.action!.label)).toBe("Add seller details");
  });
});

describe("issueMessage / firstIssue", () => {
  const first = (schema: z.ZodType, value: unknown) => {
    const parsed = schema.safeParse(value);
    if (parsed.success) throw new Error("expected a failure");
    return english(firstIssue(parsed.error));
  };

  it("carries Zod's own bounds as values, formatted as before", () => {
    expect(first(singleLineText({ field: "productTitle", max: 200 }), "")).toBe(
      "A product title is required.",
    );
    expect(first(multiLineText({ field: "productDescription", max: 5000 }), "x".repeat(5001))).toBe(
      "A product description must be 5000 characters or fewer.",
    );
    expect(first(boundedInt({ field: "price", min: 1, max: 100_000_000 }), 100_000_001)).toBe(
      "Price must be 100000000 or fewer.",
    );
    expect(first(singleLineText({ field: "searchQuery", min: 2, max: 50 }), "a")).toBe(
      "Search query needs at least 2 characters.",
    );
    expect(first(uniqueList(hostname(), { field: "domains", max: 2 }), ["a.com", "b.com", "c.com"])).toBe(
      "List up to 2 domains.",
    );
  });

  it("carries a refine's params as values", () => {
    expect(first(referenceCode({ field: "vatId", min: 2, max: 32 }), "x")).toBe(
      "A VAT ID must be 2 to 32 letters, digits, spaces, dots or hyphens.",
    );
  });

  it("never shows Zod's own default text: a check with no message of ours is generic", () => {
    const cases: [z.ZodType, unknown][] = [
      [z.number(), "nope"],
      [z.string().min(3), "a"],
      [z.strictObject({ a: z.string() }), { a: "x", b: 1 }],
      [z.enum(["one", "two"]), "three"],
      [z.string().refine((value) => value === "ok"), "no"],
      [z.string().min(1, "A literal English message"), ""],
    ];
    for (const [schema, value] of cases) {
      const parsed = schema.safeParse(value);
      if (parsed.success) throw new Error("expected a failure");
      const ref = issueMessage(parsed.error.issues[0]!);
      expect(ref).toEqual({ key: "Validation.generic.invalid" });
      expect(english(ref)).toBe("Check the form and try again.");
      expect(english(firstIssue(parsed.error))).toBe("Check the form and try again.");
    }
  });

  it("does not mistake a string that merely looks like a key for one", () => {
    const schema = z.string().min(1, "Validation.not.a.real.key");
    const parsed = schema.safeParse("");
    if (parsed.success) throw new Error("expected a failure");
    expect(issueMessage(parsed.error.issues[0]!).key).toBe("Validation.generic.invalid");
    expect(issueKey("Validation.checkForm")).toBe("Validation.checkForm");
  });
});

describe("the delete-account confirmation phrase", () => {
  it("has a phrase for every supported locale", () => {
    for (const locale of LOCALES) {
      expect(DELETE_CONFIRM_PHRASES[locale].trim().length, locale).toBeGreaterThan(0);
    }
  });

  it("accepts the phrase in any language, whatever language is on screen", () => {
    for (const phrase of Object.values(DELETE_CONFIRM_PHRASES)) {
      expect(isDeleteConfirmPhrase(phrase), phrase).toBe(true);
    }
    expect(isDeleteConfirmPhrase("smazat můj účet")).toBe(true);
    expect(isDeleteConfirmPhrase("delete my account")).toBe(true);
  });

  it("forgives surrounding space, case, Unicode composition and missing accents", () => {
    expect(isDeleteConfirmPhrase("  Delete My Account ")).toBe(true);
    expect(isDeleteConfirmPhrase("SMAZAT MŮJ ÚČET")).toBe(true);
    expect(isDeleteConfirmPhrase("smazat můj účet".normalize("NFD"))).toBe(true);
    expect(isDeleteConfirmPhrase("mein konto löschen".normalize("NFD"))).toBe(true);
    // Typed on an English keyboard layout.
    expect(isDeleteConfirmPhrase("smazat muj ucet")).toBe(true);
    expect(isDeleteConfirmPhrase("usun moje konto")).toBe(true);
  });

  it("rejects near misses", () => {
    for (const bad of [
      "",
      "delete my acount",
      "delete account",
      "delete  my account",
      "delete my account.",
      "please delete my stuff",
      "smazat můj",
    ]) {
      expect(isDeleteConfirmPhrase(bad), bad).toBe(false);
    }
  });

  it("is the gate the server schema applies, and its message names the phrase", () => {
    expect(deleteConfirmSchema.safeParse({ confirm: "supprimer mon compte" }).success).toBe(true);
    const parsed = deleteConfirmSchema.safeParse({ confirm: "nope" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const ref = firstIssue(parsed.error);
    expect(english(ref)).toBe('Type "delete my account" exactly to confirm.');
    expect(english(ref.key, { ...ref.values, phrase: DELETE_CONFIRM_PHRASES.cs })).toBe(
      'Type "smazat můj účet" exactly to confirm.',
    );
  });
});
