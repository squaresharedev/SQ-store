/**
 * What a sign-in approval tells the approving phone about the device asking:
 * a browser name and a system name ("Chrome", "Windows"), and the country the
 * request came from. Coarse on purpose. Enough for a person to say "yes, that's
 * my laptop" or "I'm not in Brazil", never a fingerprint or an address.
 *
 * Pure (no request context), so it is unit-tested directly; the caller reads
 * the headers. Both names are product names, the same in every language; the
 * sentence around them ("Chrome on Windows") is copy, composed where it renders.
 */

export type DeviceLabel = { browser: string | null; os: string | null };

/** First match wins, so the browsers that also claim to be Chrome or Safari come first. */
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, "Edge"],
  [/\b(OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(Firefox|FxiOS)\//, "Firefox"],
  [/\b(Chrome|CriOS)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
];

/** iPhone and iPad before Mac (an iPad can say "like Mac OS X"), Android before Linux. */
const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, "iOS"],
  [/\biPad\b/, "iPadOS"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

function firstMatch(value: string, table: [RegExp, string][]): string | null {
  for (const [pattern, name] of table) if (pattern.test(value)) return name;
  return null;
}

export function deviceFromUserAgent(userAgent: string | null | undefined): DeviceLabel {
  const ua = (userAgent ?? "").slice(0, 512);
  if (!ua) return { browser: null, os: null };
  return { browser: firstMatch(ua, BROWSERS), os: firstMatch(ua, SYSTEMS) };
}

/**
 * The ISO country Cloudflare puts on every request (CF-IPCountry), or null.
 * "XX" (unknown) and "T1" (Tor) are not countries, so they read as unknown.
 */
export function countryFromHeader(value: string | null | undefined): string | null {
  const code = (value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return null;
  return code;
}
