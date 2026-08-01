// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Hygiene guard for the design system.
 *
 * Components must spend SEMANTIC TOKENS (bg-background, text-muted-foreground,
 * border-border, duration-base, ease-standard) rather than fixed palette steps
 * or ad-hoc values. Fixed neutrals pin a component to one theme, which is what
 * blocked dark mode before; ad-hoc durations can't be retuned centrally.
 *
 * This is a lint-shaped test rather than an ESLint rule because the offending
 * values live inside className STRINGS, which the TS rules don't see.
 */

const SRC = join(process.cwd(), "src");

/** Palette steps and literal values that must not appear in class strings. */
const BANNED: { pattern: RegExp; why: string }[] = [
  {
    pattern: /\b(?:bg|text|border|divide|ring|decoration)-neutral-\d{2,3}\b/,
    why: "fixed neutral: use the semantic token (background/foreground/muted-foreground/border)",
  },
  {
    pattern: /\b(?:bg|text|border)-(?:red|green)-\d{2,3}\b/,
    why: "fixed feedback colour: use destructive / success",
  },
  {
    pattern: /\bduration-\d+\b/,
    why: "ad-hoc duration: use duration-fast / duration-base / duration-slow",
  },
  {
    pattern: /\bduration-\[[^\]]+\]/,
    why: "ad-hoc duration: use the motion scale",
  },
  {
    pattern: /\bease-\[[^\]]+\]/,
    why: "ad-hoc easing: use ease-standard / ease-entrance",
  },
];

/**
 * Files allowed to keep a literal, with the reason. Each is a value that must
 * NOT follow the theme.
 */
const ALLOWED = new Set<string>([
  // Scrims darken whatever is behind them; that is the same job on a light or
  // a dark page, so they stay a fixed black wash. (bg-black is not banned
  // above, but these files are listed to document the decision.)
  "components/ui/modal.tsx",
  "components/ui/Popover.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function relative(file: string): string {
  return file.slice(SRC.length + 1).replace(/\\/g, "/");
}

describe("design tokens", () => {
  const files = walk(SRC);

  it("finds source files to check (guards against a broken walk)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const { pattern, why } of BANNED) {
    it(`no ${pattern.source} — ${why}`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        const rel = relative(file);
        if (ALLOWED.has(rel)) continue;
        const source = readFileSync(file, "utf8");
        for (const [index, line] of source.split(/\r?\n/).entries()) {
          if (pattern.test(line)) offenders.push(`${rel}:${index + 1}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});
