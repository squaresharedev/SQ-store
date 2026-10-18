// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { embedOrigin } from "@/lib/app-url";
import {
  EMBED_FRAME_PREFIX,
  embedFramePath,
  isEmbedFramePath,
  parseEmbedSite,
} from "@/lib/storefront/embed-frame";

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

describe("the frame's address", () => {
  it("is the prefix, the key, then the site", () => {
    expect(embedFramePath("k", "www.example.com")).toBe("/e/k/www.example.com");
    expect(embedFramePath("k", "s").startsWith(EMBED_FRAME_PREFIX)).toBe(true);
  });

  it("is told apart from every other page by its prefix", () => {
    expect(isEmbedFramePath("/e/k/www.example.com")).toBe(true);
    for (const other of ["/", "/embed", "/eggs", "/s/abc", "/storefront/x/embed", "/dev/embed-host"]) {
      expect(isEmbedFramePath(other), other).toBe(false);
    }
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
