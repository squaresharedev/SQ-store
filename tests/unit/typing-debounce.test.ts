import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TYPING_DEBOUNCE_MS } from "@/lib/typing-debounce";

/**
 * Every field that reaches the server WHILE YOU TYPE waits the same amount of
 * time first, and gets that number from one place.
 *
 * This is a drift guard, not a behaviour test (the behaviour is covered in
 * tests/component/search-overlay.test.tsx). The interval had grown three
 * different values across four fields — 300, 300, 250 and 400 — because each
 * one declared its own constant. Nothing in a type checker or a runtime test
 * notices that, so the check is on the source: none of these files may define
 * a debounce of its own again.
 */

/** Every input in the app that queries the server as the seller types. */
const TYPING_LOOKUPS = [
  // Universal search (⌘K).
  "src/components/search/SearchOverlay.tsx",
  // The orders search box, which re-queries through the URL.
  "src/components/orders/OrdersPage.tsx",
  // The storefront designer's product picker.
  "src/components/storefront/ProductPicker.tsx",
  // Username availability in settings.
  "src/components/settings/UsernameForm.tsx",
];

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("typing debounce", () => {
  it("is 300ms", () => {
    expect(TYPING_DEBOUNCE_MS).toBe(300);
  });

  it("is what every typing-driven lookup waits", () => {
    for (const path of TYPING_LOOKUPS) {
      const code = source(path);
      expect(code, `${path} should import the shared interval`).toContain(
        'from "@/lib/typing-debounce"',
      );
      expect(code, `${path} should USE it`).toContain("TYPING_DEBOUNCE_MS");
    }
  });

  it("has no field declaring a debounce of its own", () => {
    for (const path of TYPING_LOOKUPS) {
      // A local `const SOMETHING_DEBOUNCE_MS = 250` is exactly how the four
      // drifted apart the first time.
      expect(
        source(path),
        `${path} should not declare its own debounce constant`,
      ).not.toMatch(/const\s+\w*DEBOUNCE\w*\s*=/);
    }
  });
});
