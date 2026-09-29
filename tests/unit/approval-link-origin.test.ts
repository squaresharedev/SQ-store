// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { approvalLinkOrigin } from "@/lib/auth/sign-in-approval";

/**
 * Where a sign-in approval QR code sends the phone. On a development server
 * it may be the deployed app (a phone cannot open localhost); anywhere else it
 * is always this app. The override is a way for a trusted dev server to reach
 * the real approve page, so it must never be able to point production's QR
 * codes somewhere else.
 */

const LOCAL = "http://localhost:3000";
const LIVE = "https://dashboard.squareshare.eu";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("approvalLinkOrigin", () => {
  it("is the app itself when nothing overrides it", () => {
    expect(approvalLinkOrigin({ NODE_ENV: "development", NEXT_PUBLIC_APP_URL: LOCAL })).toBe(LOCAL);
    expect(approvalLinkOrigin({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: LIVE })).toBe(LIVE);
  });

  it("on a development server, sends the phone to the deployed app", () => {
    expect(
      approvalLinkOrigin({ NODE_ENV: "development", NEXT_PUBLIC_APP_URL: LOCAL, APPROVAL_ORIGIN: LIVE }),
    ).toBe(LIVE);
    expect(
      approvalLinkOrigin({ NODE_ENV: "development", NEXT_PUBLIC_APP_URL: LOCAL, APPROVAL_ORIGIN: `${LIVE}/` }),
    ).toBe(LIVE);
  });

  it("is IGNORED in a production build, whatever it says", () => {
    expect(
      approvalLinkOrigin({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: LIVE,
        APPROVAL_ORIGIN: "https://evil.example",
      }),
    ).toBe(LIVE);
  });

  it("refuses anything but a bare https origin", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of [
      "http://dashboard.squareshare.eu",
      "https://dashboard.squareshare.eu/approve",
      "https://dashboard.squareshare.eu?x=1",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(
        approvalLinkOrigin({ NODE_ENV: "development", NEXT_PUBLIC_APP_URL: LOCAL, APPROVAL_ORIGIN: bad }),
        bad,
      ).toBe(LOCAL);
    }
    expect(warn).toHaveBeenCalled();
  });

  it("is null when the app has no origin to fall back on", () => {
    expect(approvalLinkOrigin({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "" })).toBeNull();
  });
});
