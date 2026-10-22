// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  areEmbedSitesAllowed,
  decideEmbedAccess,
  embedCorsHeaders,
  originHostname,
} from "@/lib/storefront/embed";
import type { EmbedSettings } from "@/types/storefront";

/**
 * The embed endpoint is the only unauthenticated read surface in the app, so
 * these are its access rules. Pure functions, so every case is checked here
 * rather than inferred from an integration test.
 */

const settings = (over: Partial<EmbedSettings> = {}): EmbedSettings => ({
  enabled: true,
  domains: ["shop.example.com"],
  ...over,
});

describe("decideEmbedAccess - the enable flag", () => {
  it("denies when embedding is switched off", () => {
    // The stored flag is meaningless unless it is checked HERE.
    const decision = decideEmbedAccess({
      settings: settings({ enabled: false }),
      origin: "https://shop.example.com",
    });
    expect(decision).toMatchObject({ allowed: false, status: 404 });
  });

  it("denies when a storefront has no embed settings at all", () => {
    expect(
      decideEmbedAccess({ settings: undefined, origin: "https://shop.example.com" }),
    ).toMatchObject({ allowed: false, status: 404 });
  });

  it("uses 404 for 'not embeddable', so a rotated key is indistinguishable", () => {
    const off = decideEmbedAccess({ settings: settings({ enabled: false }), origin: null });
    expect(off).toMatchObject({ status: 404 });
  });
});

describe("decideEmbedAccess - the allowlist", () => {
  it("allows an exact host match", () => {
    expect(
      decideEmbedAccess({ settings: settings(), origin: "https://shop.example.com" }),
    ).toEqual({ allowed: true, origin: "https://shop.example.com" });
  });

  it("DENIES an empty allowlist rather than serving everywhere", () => {
    // "No domains" is the state before the seller has said where the embed may
    // appear. Treating that as "anywhere" would leave every newly enabled
    // embed briefly open to the whole web.
    expect(
      decideEmbedAccess({
        settings: settings({ domains: [] }),
        origin: "https://shop.example.com",
      }),
    ).toMatchObject({ allowed: false, status: 403 });
  });

  it("denies a request with no Origin header", () => {
    expect(
      decideEmbedAccess({ settings: settings(), origin: null }),
    ).toMatchObject({ allowed: false, status: 403 });
  });

  it("does not suffix-match, so a lookalike domain is refused", () => {
    // The classic allowlist bug: allowing "example.com" to cover
    // "evil-example.com", which anyone can register.
    for (const origin of [
      "https://evil-shop.example.com.attacker.com",
      "https://notshop.example.com",
      "https://shop.example.com.evil.com",
      "https://example.com",
    ]) {
      expect(
        decideEmbedAccess({ settings: settings(), origin }),
        origin,
      ).toMatchObject({ allowed: false });
    }
  });

  it("treats a site with and without www. as the same site", () => {
    // To its owner they are one website, and "I listed example.com but my site
    // answers on www" is the most common reason an embed does not show.
    const bare = settings({ domains: ["example.com"] });
    const www = settings({ domains: ["www.example.com"] });
    expect(decideEmbedAccess({ settings: bare, origin: "https://www.example.com" })).toMatchObject({
      allowed: true,
    });
    expect(decideEmbedAccess({ settings: www, origin: "https://example.com" })).toMatchObject({
      allowed: true,
    });
    // Only that one label, and only at the front.
    expect(decideEmbedAccess({ settings: bare, origin: "https://shop.example.com" })).toMatchObject({
      allowed: false,
    });
    expect(decideEmbedAccess({ settings: bare, origin: "https://www.www.example.com" })).toMatchObject({
      allowed: false,
    });
    expect(decideEmbedAccess({ settings: bare, origin: "https://wwwexample.com" })).toMatchObject({
      allowed: false,
    });
  });

  it("ignores port and path noise on an otherwise allowed origin", () => {
    // A browser sends scheme+host+port; the stored list is bare hosts.
    expect(
      decideEmbedAccess({ settings: settings(), origin: "https://shop.example.com:8443" }),
    ).toMatchObject({ allowed: true });
  });

  it("matches case-insensitively, since hosts are", () => {
    expect(
      decideEmbedAccess({ settings: settings(), origin: "https://SHOP.Example.COM" }),
    ).toMatchObject({ allowed: true });
  });

  it("returns a CANONICAL origin, never the raw header", () => {
    // The check runs on the PARSED host, so echoing the raw string into
    // Access-Control-Allow-Origin would emit an attacker-influenced value on
    // the strength of a check performed on something else.
    const decision = decideEmbedAccess({
      settings: settings(),
      origin: "https://shop.example.com\\@evil.com",
    });
    expect(decision).toEqual({ allowed: true, origin: "https://shop.example.com" });

    // A real browser origin round-trips unchanged, port included.
    expect(
      decideEmbedAccess({ settings: settings(), origin: "https://shop.example.com:8443" }),
    ).toEqual({ allowed: true, origin: "https://shop.example.com:8443" });
  });

  it("refuses non-http(s) origins outright", () => {
    for (const origin of ["null", "file://", "data:text/html,x", "chrome-extension://abc"]) {
      expect(
        decideEmbedAccess({ settings: settings(), origin }),
        origin,
      ).toMatchObject({ allowed: false });
    }
  });
});

describe("areEmbedSitesAllowed - the frame's form of the same rules", () => {
  const allowed = (hosts: string[], over: Partial<EmbedSettings> = {}) => areEmbedSitesAllowed(settings(over), hosts);

  it("allows a listed site while embedding is on", () => {
    expect(allowed(["shop.example.com"])).toBe(true);
    expect(allowed(["www.example.com"], { domains: ["example.com"] })).toBe(true);
  });

  it("refuses everything while embedding is off, or was never set up", () => {
    expect(allowed(["shop.example.com"], { enabled: false })).toBe(false);
    expect(areEmbedSitesAllowed(undefined, ["shop.example.com"])).toBe(false);
  });

  it("refuses an empty list, no sites, and an unlisted site", () => {
    expect(allowed(["shop.example.com"], { domains: [] })).toBe(false);
    expect(allowed([])).toBe(false);
    for (const host of ["example.com", "evil.com", "shop.example.com.evil.com", "notshop.example.com"]) {
      expect(allowed([host]), host).toBe(false);
    }
  });

  it("refuses the whole list for one site that is not allowed, wherever it stands", () => {
    expect(allowed(["shop.example.com", "evil.com"])).toBe(false);
    expect(allowed(["evil.com", "shop.example.com"])).toBe(false);
  });

  describe("under Wix, whose HTML element is served from the site's host with dashes", () => {
    const wix = { domains: ["www.shop.com"] };

    it("allows the frame Wix makes for a listed site, with or without www.", () => {
      expect(allowed(["www-shop-com.filesusr.com", "www.shop.com"], wix)).toBe(true);
      expect(allowed(["shop-com.filesusr.com", "shop.com"], wix)).toBe(true);
      expect(allowed(["www-shop-com.filesusr.com", "www.shop.com"], { domains: ["shop.com"] })).toBe(true);
      // A free Wix address follows the same rule.
      expect(allowed(["studio-wixsite-com.filesusr.com", "studio.wixsite.com"], { domains: ["studio.wixsite.com"] })).toBe(true);
    });

    it("refuses another site's Wix frame, and a look-alike of the seller's", () => {
      for (const frame of ["www-evil-com.filesusr.com", "www-shop-com-evil.filesusr.com", "www-shop-com.filesusr.com.evil.com", "www-shop-com.usrfiles.com"]) {
        expect(allowed([frame, "www.shop.com"], wix), frame).toBe(false);
      }
    });
  });

  describe("under Google Sites, whose embed code is served from a per-embed Google host", () => {
    const google = { domains: ["shop.com"] };

    it("allows Google's frames above a listed site", () => {
      expect(allowed(["1a2b3c-atari-embeds.googleusercontent.com", "shop.com"], google)).toBe(true);
      expect(allowed(["1a2b3c-atari-embeds.googleusercontent.com", "www.gstatic.com", "shop.com"], google)).toBe(true);
    });

    it("refuses other Google hosts, and look-alikes", () => {
      for (const frame of ["lh3.googleusercontent.com", "atari-embeds.googleusercontent.com", "x-atari-embeds.googleusercontent.com.evil.com", "gstatic.com", "evil.gstatic.com.evil.com"]) {
        expect(allowed([frame, "shop.com"], google), frame).toBe(false);
      }
    });
  });

  it("never on builder frames alone: one of the seller's own sites must be named", () => {
    expect(allowed(["1a2b3c-atari-embeds.googleusercontent.com"])).toBe(false);
    expect(allowed(["www-shop-example-com.filesusr.com"])).toBe(false);
    expect(allowed(["1a2b3c-atari-embeds.googleusercontent.com", "www.gstatic.com"])).toBe(false);
  });
});

describe("originHostname", () => {
  it("extracts the host from a normal origin", () => {
    expect(originHostname("https://a.example.com")).toBe("a.example.com");
    expect(originHostname("http://localhost:3000")).toBe("localhost");
  });

  it("returns null for anything that isn't an http(s) origin", () => {
    for (const bad of ["null", "", "not a url", "file:///etc/passwd", "javascript:alert(1)"]) {
      expect(originHostname(bad), bad).toBeNull();
    }
  });

  it("resolves a backslash authority the way a browser would", () => {
    // The backslash acts as a separator, so the real host IS shop.example.com
    // and "@evil.com" is path. Matching on the parsed host is what makes that
    // safe; see the canonical-echo test below for the other half.
    expect(originHostname("https://shop.example.com\\@evil.com")).toBe(
      "shop.example.com",
    );
  });
});

describe("embedCorsHeaders", () => {
  const headers = embedCorsHeaders("https://shop.example.com");

  it("echoes the allowed origin instead of a wildcard", () => {
    // "*" would let ANY site read the response, which is exactly what the
    // allowlist forbids.
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://shop.example.com");
    expect(Object.values(headers)).not.toContain("*");
  });

  it("varies on Origin, so a shared cache can't cross-serve", () => {
    expect(headers.Vary).toBe("Origin");
  });

  it("never allows credentials", () => {
    expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
  });
});
