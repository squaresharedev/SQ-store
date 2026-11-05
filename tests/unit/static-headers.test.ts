// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Files served straight from the build (public/, /_next/static) never pass
 * through the Worker, so the headers next.config.ts sets do not reach them.
 * public/_headers gives them the transport headers instead, and this keeps
 * the two copies saying the same thing.
 */

const root = join(__dirname, "..", "..");
const headersFile = readFileSync(join(root, "public", "_headers"), "utf8");
const nextConfig = readFileSync(join(root, "next.config.ts"), "utf8");

/** The headers public/_headers gives a path pattern, by lowercased name. */
function rule(pattern: string): Map<string, string> {
  const lines = headersFile.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === pattern);
  const found = new Map<string, string>();
  if (start < 0) return found;
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    const [name, ...value] = line.trim().split(":");
    found.set(name.trim().toLowerCase(), value.join(":").trim());
  }
  return found;
}

/** The value next.config.ts gives a header, read from its source. */
function configValue(name: string): string | undefined {
  const match = new RegExp(`key:\\s*"${name}",\\s*value:\\s*"([^"]+)"`).exec(nextConfig);
  return match?.[1];
}

describe("public/_headers", () => {
  it("gives every static file the app's HSTS and nosniff, word for word", () => {
    const all = rule("/*");
    const hsts = configValue("Strict-Transport-Security");
    const nosniff = configValue("X-Content-Type-Options");
    expect(hsts).toMatch(/max-age=\d+/);
    expect(all.get("strict-transport-security")).toBe(hsts);
    expect(nosniff).toBe("nosniff");
    expect(all.get("x-content-type-options")).toBe(nosniff);
  });

  it("keeps the font rule the preview view depends on", () => {
    expect(rule("/_next/static/media/*").get("access-control-allow-origin")).toBe("*");
  });
});
