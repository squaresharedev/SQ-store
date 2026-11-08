import { describe, expect, it, vi } from "vitest";

/**
 * Tests for lib/storefront/public-gate.ts (openStorefront) and
 * lib/settings/seller-identity.ts (sellerMaySell).
 *
 * Both are pure functions over their arguments; no DB mocks are needed.
 * emailProofRequired is controlled via the email/send mock so the test suite
 * does not depend on the deployment's SMTP configuration.
 */

// emailSendingEnabled returning false => emailProofRequired() returns false
// => email verification is NOT required. Each test block opts in or out.
const emailSendingEnabled = vi.fn(() => false);

vi.mock("@/lib/email/send", () => ({
  emailSendingEnabled: () => emailSendingEnabled(),
  sendEmail: vi.fn(),
}));

const { openStorefront } = await import("@/lib/storefront/public-gate");
const { sellerMaySell } = await import("@/lib/settings/seller-identity");
const { DEFAULT_PRODUCT_PAGE_CONFIG } = await import("@/types/storefront");

// ---- fixtures ---------------------------------------------------------------

/** Config stored as JSONB: productPage enabled, so the storefront has pages. */
function validConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    theme: {
      background: { kind: "solid", color: "#ffffff" },
      accent: "#171717",
      font: "sans",
      columns: 6,
      rows: 6,
      cornerRadius: 0,
      titleStyle: "bar",
      titleDisplay: "always",
      priceDisplay: "always",
      priceTagPosition: "below",
      showTitle: true,
      gridGap: 8,
      soldOutBadge: true,
      hideSoldOut: false,
    },
    blocks: [],
    productPage: { enabled: true, allowIndexing: false },
    ...overrides,
  };
}

/** A seller profile with everything the publish gate requires.
 *  Mirrors COMPLETE_PROFILE from tests/unit/og-image-route.test.ts; the
 *  seller_email_verified_at field is included here because sellerMaySell reads
 *  TraderGateRow which includes it. */
const COMPLETE_PROFILE = {
  tax_business_name: "Lamp Studio Ltd",
  tax_vat_id: null,
  tax_country: null,
  // Address must have street AND town; a street alone fails addressQualityProblem.
  seller_address: "12 Market Street\nDublin",
  seller_email: "hi@lamp-studio.ie",
  seller_phone: null,
  seller_phone_verified_at: null,
  seller_bio: null,
  seller_email_verified_at: null,
};

// ---- openStorefront ---------------------------------------------------------

describe("openStorefront", () => {
  it("refuses a row with moderation_status = removed", () => {
    expect(openStorefront({ config: validConfig(), moderation_status: "removed" })).toBeNull();
  });

  it("refuses a row with moderation_status = null (fails closed)", () => {
    expect(openStorefront({ config: validConfig(), moderation_status: null })).toBeNull();
  });

  it("refuses a row with an unparseable config", () => {
    expect(openStorefront({ config: "not-valid-json-or-object", moderation_status: "ok" })).toBeNull();
  });

  it("refuses a row where product pages are off (enabled=false)", () => {
    // A complete productPage config (all required fields) with enabled=false.
    const config = validConfig({ productPage: { ...DEFAULT_PRODUCT_PAGE_CONFIG, enabled: false } });
    expect(openStorefront({ config, moderation_status: "ok" })).toBeNull();
  });

  it("opens a valid storefront and returns its parsed config and productPage", () => {
    const result = openStorefront({ config: validConfig(), moderation_status: "ok" });
    expect(result).not.toBeNull();
    expect(result?.productPage.enabled).toBe(true);
    // allowIndexing defaults to false (seller has not opted in); opening does
    // not require indexing, which is a separate check the sitemap makes.
    expect(result?.productPage.allowIndexing).toBe(false);
    expect(Array.isArray(result?.config.blocks)).toBe(true);
  });

  it("opens a valid storefront even with no productPage stored (defaults to enabled=true)", () => {
    // A config with no productPage key should default to enabled=true.
    const config: Record<string, unknown> = {
      theme: {
        background: { kind: "solid", color: "#ffffff" },
        accent: "#171717",
        font: "sans",
        columns: 6,
        rows: 6,
        cornerRadius: 0,
        titleStyle: "bar",
        titleDisplay: "always",
        priceDisplay: "always",
        priceTagPosition: "below",
        showTitle: true,
        gridGap: 8,
        soldOutBadge: true,
        hideSoldOut: false,
      },
      blocks: [],
    };
    const result = openStorefront({ config, moderation_status: "ok" });
    expect(result).not.toBeNull();
    expect(result?.productPage.enabled).toBe(true);
  });
});

// ---- sellerMaySell ----------------------------------------------------------

describe("sellerMaySell", () => {
  it("refuses null (read failed: fails closed)", () => {
    expect(sellerMaySell(null)).toBe(false);
  });

  it("refuses a profile with no business name", () => {
    expect(sellerMaySell({ ...COMPLETE_PROFILE, tax_business_name: null })).toBe(false);
  });

  it("refuses a profile with no seller address", () => {
    expect(sellerMaySell({ ...COMPLETE_PROFILE, seller_address: null })).toBe(false);
  });

  it("refuses a profile with no contact email", () => {
    expect(sellerMaySell({ ...COMPLETE_PROFILE, seller_email: null })).toBe(false);
  });

  it("accepts a complete profile when email verification is not required", () => {
    // emailSendingEnabled() returns false => emailProofRequired() returns false
    emailSendingEnabled.mockReturnValue(false);
    expect(sellerMaySell(COMPLETE_PROFILE)).toBe(true);
  });

  it("accepts a complete profile with a proven email when verification is required", () => {
    emailSendingEnabled.mockReturnValue(true);
    const verified = { ...COMPLETE_PROFILE, seller_email_verified_at: "2026-10-01T00:00:00Z" };
    expect(sellerMaySell(verified)).toBe(true);
    emailSendingEnabled.mockReturnValue(false); // restore
  });

  it("refuses a profile with an unverified email when verification is required", () => {
    emailSendingEnabled.mockReturnValue(true);
    // seller_email_verified_at is null so the email is unproven.
    expect(sellerMaySell(COMPLETE_PROFILE)).toBe(false);
    emailSendingEnabled.mockReturnValue(false); // restore
  });
});
