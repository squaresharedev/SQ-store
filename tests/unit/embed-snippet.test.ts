import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { embedFrameSnippet, embedSnippet } from "@/lib/storefront/embed-snippet";

/**
 * Unit tests for the embedSnippet builder.
 *
 * The two guarantees: HTML-escaping protects against markup in the label or
 * URL, and passing no link leaves the output byte-for-byte unchanged from
 * what it was before the link parameter was added (the tour and existing
 * snippets rely on the exact shape).
 */

const KEY = "3f2b6c1e-9a4d-4e8b-b1c2-0a1b2c3d4e5f";

// Stub an embed origin so the script src is predictable.
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_EMBED_URL", "https://embed.test"));
afterEach(() => vi.unstubAllEnvs());

describe("embedSnippet without a link", () => {
  it("produces the same output as the pre-link version", () => {
    const snippet = embedSnippet(KEY);
    expect(snippet).toBe(
      `<div data-squareshare-storefront="${KEY}"></div>\n` +
        `<script async src="https://embed.test/widget.js"></script>`,
    );
  });

  it("produces byte-identical output whether link is omitted, null, or undefined", () => {
    const base = embedSnippet(KEY);
    expect(embedSnippet(KEY, null)).toBe(base);
    expect(embedSnippet(KEY, undefined)).toBe(base);
  });

  it("contains no anchor element", () => {
    expect(embedSnippet(KEY)).not.toContain("<a ");
    expect(embedSnippet(KEY)).not.toContain("href=");
  });
});

describe("embedSnippet with a link", () => {
  it("places an anchor inside the div with the given url and label", () => {
    const snippet = embedSnippet(KEY, {
      url: "https://squareshare.example/s/my-shop",
      label: "My Shop",
    });
    expect(snippet).toContain(
      `<div data-squareshare-storefront="${KEY}"><a href="https://squareshare.example/s/my-shop">My Shop</a></div>`,
    );
  });

  it("HTML-escapes ampersands and angle brackets in the label", () => {
    const snippet = embedSnippet(KEY, {
      url: "https://squareshare.example/s/abc",
      label: "Tom & Jerry's <Shop>",
    });
    expect(snippet).toContain("Tom &amp; Jerry&#39;s &lt;Shop&gt;");
    // The raw characters must not appear in the label position.
    expect(snippet).not.toContain("&<");
    expect(snippet).not.toContain("Tom & Jerry");
  });

  it("HTML-escapes special characters in the URL", () => {
    const snippet = embedSnippet(KEY, {
      url: "https://squareshare.example/s/abc?q=1&r=2",
      label: "Shop",
    });
    expect(snippet).toContain('href="https://squareshare.example/s/abc?q=1&amp;r=2"');
  });

  it("escapes a URL with a double-quote in it", () => {
    const snippet = embedSnippet(KEY, {
      url: 'https://example.com/s/a"b',
      label: "Shop",
    });
    expect(snippet).toContain("https://example.com/s/a&quot;b");
    expect(snippet).not.toContain('"b"');
  });

  it("still ends with the unmodified script tag", () => {
    const snippet = embedSnippet(KEY, {
      url: "https://squareshare.example/s/abc",
      label: "Shop",
    });
    expect(snippet).toContain(`<script async src="https://embed.test/widget.js"></script>`);
  });
});

describe("embedSnippet before the embed has a host", () => {
  // Shown with Copy off. A planned hostname in its place read as a live one,
  // so a seller who selected the code by hand pasted a tag that loaded nothing.
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_EMBED_URL", ""));

  it("names no address either snippet could load from", () => {
    expect(embedSnippet(KEY)).toContain('<script async src="…/widget.js"></script>');
    expect(embedSnippet(KEY)).not.toMatch(/src="https?:/);
    expect(embedFrameSnippet(KEY, ["shop.example"])).not.toMatch(/src="https?:/);
  });
});
