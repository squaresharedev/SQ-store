// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { embedOrigin } from "@/lib/app-url";
import {
  EMBED_FRAME_PREFIX,
  EMBED_FRAME_SANDBOX,
  EMBED_MAX_SITES,
  embedFramePath,
  embedFramePolicy,
  isEmbedFramePath,
  parseEmbedSite,
  parseEmbedSites,
} from "@/lib/storefront/embed-frame";
import { embedFrameSites, embedFrameSnippet } from "@/lib/storefront/embed-snippet";

/**
 * The embed frame's address and the site name it carries. That name ends up in
 * a response header and decides which site may show a seller's storefront, so
 * what counts as one is pinned here case by case.
 */

describe("parseEmbedSite", () => {
  const prod = { allowPort: false };
  const dev = { allowPort: true };

  it("reads a plain lowercase host", () => {
    expect(parseEmbedSite("www.example.com", prod)).toEqual({
      site: "www.example.com",
      hostname: "www.example.com",
    });
    expect(parseEmbedSite("my-shop.example.co.uk", prod)?.hostname).toBe("my-shop.example.co.uk");
  });

  it("carries a port only where one is allowed, and never into the hostname", () => {
    expect(parseEmbedSite("shop.localhost:3100", dev)).toEqual({
      site: "shop.localhost:3100",
      hostname: "shop.localhost",
    });
    // Production's header rule has no port in its pattern, so a segment with
    // one was never given a frame-ancestors: it must not be served a board.
    expect(parseEmbedSite("shop.localhost:3100", prod)).toBeNull();
  });

  it("refuses a port that is not one", () => {
    expect(parseEmbedSite("shop.localhost:65535", dev)?.hostname).toBe("shop.localhost");
    for (const port of ["65536", "99999", "00000a"]) {
      expect(parseEmbedSite(`shop.localhost:${port}`, dev), port).toBeNull();
    }
  });

  it("refuses anything that is not a bare host", () => {
    for (const raw of [
      "",
      "EXAMPLE.com",
      "https:",
      "https://example.com",
      "example.com/path",
      "example.com;script-src",
      "example.com x",
      "example.com:",
      "example.com:abc",
      "example.com:123456",
      "a@example.com",
      "*.example.com",
      "'none'",
    ]) {
      expect(parseEmbedSite(raw, dev), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe("parseEmbedSites", () => {
  const prod = { allowPort: false };

  it("reads every site a frame names, in order", () => {
    expect(parseEmbedSites(["www-shop-com.filesusr.com", "www.shop.com"], prod)).toEqual([
      { site: "www-shop-com.filesusr.com", hostname: "www-shop-com.filesusr.com" },
      { site: "www.shop.com", hostname: "www.shop.com" },
    ]);
  });

  it("refuses the whole list for one bad site, wherever it stands", () => {
    // The browser checks the list as a whole, so the server does too.
    expect(parseEmbedSites(["www.shop.com", "EVIL.com"], prod)).toBeNull();
    expect(parseEmbedSites(["evil.com;x", "www.shop.com"], prod)).toBeNull();
    expect(parseEmbedSites(["www.shop.com", ""], prod)).toBeNull();
  });

  it("names at least one site and no more than the header rules cover", () => {
    expect(parseEmbedSites([], prod)).toBeNull();
    const sites = (count: number) => Array.from({ length: count }, (_, n) => `s${n}.example`);
    expect(parseEmbedSites(sites(EMBED_MAX_SITES), prod)).toHaveLength(EMBED_MAX_SITES);
    expect(parseEmbedSites(sites(EMBED_MAX_SITES + 1), prod)).toBeNull();
  });
});

describe("the frame's policy", () => {
  it("lets exactly the named sites frame it, and closes the rest", () => {
    expect(embedFramePolicy(["a.example", "b.example"])).toBe(
      "frame-ancestors a.example b.example; base-uri 'none'; form-action 'none'; object-src 'none'",
    );
  });
});

describe("the frame's address", () => {
  it("is the prefix, the key, then the sites", () => {
    expect(embedFramePath("k", ["www.example.com"])).toBe("/e/k/www.example.com");
    expect(embedFramePath("k", ["x.filesusr.com", "www.example.com"])).toBe("/e/k/x.filesusr.com/www.example.com");
    expect(embedFramePath("k", ["s"]).startsWith(EMBED_FRAME_PREFIX)).toBe(true);
  });

  it("is told apart from every other page by its prefix", () => {
    expect(isEmbedFramePath("/e/k/www.example.com")).toBe(true);
    for (const other of ["/", "/embed", "/eggs", "/s/abc", "/storefront/x/embed", "/dev/embed-host"]) {
      expect(isEmbedFramePath(other), other).toBe(false);
    }
  });
});

describe("the plain-iframe snippet", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("names each saved site, then the www. twins, as many as one address carries", () => {
    expect(embedFrameSites(["shop.com"])).toEqual(["shop.com", "www.shop.com"]);
    expect(embedFrameSites(["www.shop.com"])).toEqual(["www.shop.com", "shop.com"]);
    // Every domain the seller listed comes before any twin.
    expect(embedFrameSites(["a.com", "b.com", "c.com"])).toEqual(["a.com", "b.com", "c.com", "www.a.com"]);
    expect(embedFrameSites(["a.com", "www.a.com"])).toEqual(["a.com", "www.a.com"]);
    expect(embedFrameSites(["a.com", "b.com", "c.com", "d.com", "e.com"])).toHaveLength(EMBED_MAX_SITES);
  });

  it("is the frame's own address, sandboxed as the loader sandboxes it", () => {
    vi.stubEnv("NEXT_PUBLIC_EMBED_URL", "https://embed.test");
    const snippet = embedFrameSnippet("k", ["shop.com", "www.shop.com"]);
    expect(snippet).toContain('src="https://embed.test/e/k/shop.com/www.shop.com"');
    expect(snippet).toContain(`sandbox="${EMBED_FRAME_SANDBOX}"`);
    expect(snippet).toContain('referrerpolicy="no-referrer"');
  });
});

describe("embedOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is the configured origin, without a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_EMBED_URL", "https://embed.squareshare.eu/");
    expect(embedOrigin()).toBe("https://embed.squareshare.eu");
  });

  it("is nothing until one is configured, so the embed is not offered", () => {
    // A test run is not development: it sees what production starts with.
    vi.stubEnv("NEXT_PUBLIC_EMBED_URL", "");
    expect(embedOrigin()).toBeNull();
  });

  it("borrows the app's origin in development alone", () => {
    vi.stubEnv("NEXT_PUBLIC_EMBED_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(embedOrigin()).toBe("http://localhost:3000");

    vi.stubEnv("NODE_ENV", "production");
    expect(embedOrigin()).toBeNull();
  });
});
