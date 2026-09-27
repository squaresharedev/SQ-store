// @vitest-environment node
import { describe, expect, it } from "vitest";
import { countryFromHeader, deviceFromUserAgent } from "@/lib/auth/device-label";

/**
 * What the approving phone is told about the device asking to sign in. The
 * browsers that also claim to be Chrome or Safari must be named as themselves,
 * or "Edge on Windows" reads as "Chrome on Windows" and a person checking
 * "is that my laptop?" is misled.
 */

const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  samsungAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
  operaWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0",
  chromebook:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  ipad:
    "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

describe("deviceFromUserAgent", () => {
  it.each([
    [UA.chromeWindows, "Chrome", "Windows"],
    [UA.edgeWindows, "Edge", "Windows"],
    [UA.safariMac, "Safari", "macOS"],
    [UA.safariIphone, "Safari", "iOS"],
    [UA.chromeIphone, "Chrome", "iOS"],
    [UA.firefoxLinux, "Firefox", "Linux"],
    [UA.samsungAndroid, "Samsung Internet", "Android"],
    [UA.operaWindows, "Opera", "Windows"],
    [UA.chromebook, "Chrome", "ChromeOS"],
    [UA.ipad, "Safari", "iPadOS"],
  ])("%s", (ua, browser, os) => {
    expect(deviceFromUserAgent(ua)).toEqual({ browser, os });
  });

  it("says nothing rather than guess", () => {
    expect(deviceFromUserAgent(null)).toEqual({ browser: null, os: null });
    expect(deviceFromUserAgent("")).toEqual({ browser: null, os: null });
    expect(deviceFromUserAgent("curl/8.4.0")).toEqual({ browser: null, os: null });
  });
});

describe("countryFromHeader", () => {
  it("accepts an ISO country and normalises its case", () => {
    expect(countryFromHeader("DE")).toBe("DE");
    expect(countryFromHeader(" br ")).toBe("BR");
  });

  it("treats Cloudflare's not-a-country codes, and junk, as unknown", () => {
    for (const value of ["XX", "T1", "", null, undefined, "DEU", "1A"]) {
      expect(countryFromHeader(value), String(value)).toBeNull();
    }
  });
});
