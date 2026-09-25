import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { english } from "../setup/translate";
import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";
import { EDITOR_TOUR_STEPS } from "@/lib/onboarding/editor-tour-steps";
import { MAIN_NAV, SETTINGS_LINK } from "@/lib/search/nav-constants";
import {
  isTourStepId,
  tourStep,
  tourStepsFor,
  TOUR_STEP_IDS,
  TOUR_STEPS,
} from "@/lib/onboarding/tour-steps";

/**
 * The guided tour's script. These pin what can quietly go wrong in data: a stop
 * on a page that redirects (the tour would never "arrive" and would end), a
 * selector that does not parse, a selector that depends on translated words, a
 * data-tour anchor nothing renders, a stop a viewer cannot act on, and copy
 * that drifts from the house rules.
 */

const APP_DIR = join(process.cwd(), "src", "app");
const SRC_DIR = join(process.cwd(), "src");

/** Same resolver as onboarding-steps.test.ts: route groups are transparent,
 *  "[param]" matches any one segment, a route needs a page.tsx. */
function routeExists(href: string): boolean {
  const segments = href.split(/[?#]/)[0].split("/").filter(Boolean);
  const walk = (dir: string, rest: string[]): boolean => {
    if (rest.length === 0 && existsSync(join(dir, "page.tsx"))) return true;
    const [head, ...tail] = rest;
    for (const entry of readdirSync(dir)) {
      if (!statSync(join(dir, entry)).isDirectory()) continue;
      if (entry.startsWith("(") && entry.endsWith(")")) {
        if (walk(join(dir, entry), rest)) return true;
        continue;
      }
      if (rest.length === 0) continue;
      if ((entry === head || /^\[.+\]$/.test(entry)) && walk(join(dir, entry), tail)) {
        return true;
      }
    }
    return false;
  };
  return walk(APP_DIR, segments);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** En and em dash, spelled by code point so this file contains neither. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

describe("tour steps", () => {
  it("has exactly one step per id, in the declared order", () => {
    expect(TOUR_STEPS.map((step) => step.id)).toEqual([...TOUR_STEP_IDS]);
  });

  it("starts by showing the way around, and ends where the replay lives", () => {
    expect(TOUR_STEPS[0].id).toBe("overview-nav");
    const last = TOUR_STEPS[TOUR_STEPS.length - 1];
    expect(last.id).toBe("finish");
    expect(last.path).toBe("/settings/account");
    expect(last.targets.map((target) => target.selector)).toEqual(["#tour"]);
  });

  it("only stops on real pages, named by the pathname they actually show", () => {
    for (const step of TOUR_STEPS) {
      // No query or hash: the overlay compares against usePathname().
      expect(step.path, step.id).toMatch(/^\/[a-z-]+(\/[a-z-]+)*$/);
      expect(routeExists(step.path), step.path).toBe(true);
    }
    // Both redirect, so the tour would push, never see its path, and end.
    const paths = TOUR_STEPS.map((step) => step.path);
    expect(paths).not.toContain("/settings");
    expect(paths).not.toContain("/");
  });

  it("gives every step at least one selector, and every selector parses", () => {
    for (const step of TOUR_STEPS) {
      expect(step.targets.length, step.id).toBeGreaterThan(0);
      const selectors = [
        ...step.targets.map((target) => target.selector),
        ...(step.waitFor ? [step.waitFor] : []),
      ];
      for (const selector of selectors) {
        expect(() => document.querySelector(selector), `${step.id}: ${selector}`).not.toThrow();
      }
    }
  });

  it("points data-tour selectors only at anchors the app renders", () => {
    const rendered = new Set<string>();
    for (const file of sourceFiles(SRC_DIR)) {
      // src/app/dev holds fixtures that mirror the anchors; they prove nothing.
      if (file.includes(join("src", "app", "dev"))) continue;
      for (const match of readFileSync(file, "utf8").matchAll(/data-tour="([a-z-]+)"/g)) {
        rendered.add(match[1]);
      }
    }
    const referenced = [...TOUR_STEPS, ...EDITOR_TOUR_STEPS]
      .flatMap((step) => [...step.targets.map((target) => target.selector), step.waitFor ?? ""])
      .flatMap((selector) => [...selector.matchAll(/data-tour="([a-z-]+)"/g)].map((m) => m[1]));
    expect(referenced.length).toBeGreaterThan(0);
    for (const anchor of referenced) expect(rendered, anchor).toContain(anchor);
  });

  it("never finds a control by words a translation changes", () => {
    // Labels, names and text are in the reader's language; a lookup by the
    // English ones finds nothing in any other. data-* values, ids, hrefs and
    // roles are never translated.
    const LANGUAGE_DEPENDENT =
      /aria-label|aria-description|aria-placeholder|aria-roledescription|aria-valuetext|\[(title|alt|placeholder|value|name)\b|:has-text|:contains|:text/i;
    for (const step of [...TOUR_STEPS, ...EDITOR_TOUR_STEPS]) {
      const selectors = [
        ...step.targets.map((target) => target.selector),
        ...(step.waitFor ? [step.waitFor] : []),
      ];
      for (const selector of selectors) {
        expect(selector, `${step.id}: ${selector}`).not.toMatch(LANGUAGE_DEPENDENT);
      }
    }
  });

  it("names each page in the words of its own sidebar label", () => {
    const opening = (page: string) =>
      english("Onboarding.tourOverlay.openingPage", { page });
    // Every sidebar destination has its own whole sentence, reading exactly as
    // "Opening {label}…" always did.
    const sidebarPages = [...MAIN_NAV, SETTINGS_LINK].map((entry) => {
      const page = entry.label.split(".")[2];
      expect(opening(page)).toBe(`Opening ${english(entry.label)}…`);
      return page;
    });
    for (const step of TOUR_STEPS) {
      expect(sidebarPages, step.id).toContain(step.page);
    }
    for (const step of EDITOR_TOUR_STEPS) {
      expect(opening(step.page)).toBe(`Opening ${english("Storefront.sample.name")}…`);
    }
    expect(opening(tourStep("products-add")!.page)).toBe("Opening Products…");
    expect(opening(tourStep("finish")!.page)).toBe("Opening Settings…");
  });

  it("drops the stops a viewer cannot act on, keeping the rest in order", () => {
    const viewer = tourStepsFor("viewer").map((step) => step.id);
    expect(viewer).toEqual([
      "overview-nav",
      "search",
      "orders-search",
      "orders-filters",
      "analytics",
      "payments",
      "finish",
    ]);
    expect(tourStepsFor(null).map((step) => step.id)).toEqual(viewer);
    expect(tourStepsFor("owner")).toHaveLength(TOUR_STEPS.length);
    expect(tourStepsFor("editor")).toHaveLength(TOUR_STEPS.length);
  });

  it("writes its copy without dashes standing in for punctuation", () => {
    for (const step of TOUR_STEPS) {
      const copy = [
        step.title,
        step.body,
        ...(step.fallbackBody ? [step.fallbackBody] : []),
        ...step.targets.flatMap((target) => (target.body ? [target.body] : [])),
      ]
        .map((key) => english(key))
        .concat(english("Onboarding.tourOverlay.openingPage", { page: step.page }))
        .join(" ");
      expect(copy, step.id).not.toMatch(DASHES);
    }
  });

  it("is honest about Stripe, in whichever state the switch is in", () => {
    const payments = english(tourStep("payments")!.body);
    if (STRIPE_CONNECT_AVAILABLE) {
      expect(payments).toMatch(/connect stripe/i);
    } else {
      expect(payments).toMatch(/coming soon/i);
      expect(payments).not.toMatch(/connect stripe here/i);
    }
  });

  it("says the embed widget is still in development, with or without a storefront", () => {
    const embed = tourStep("storefront-embed")!;
    expect(english(embed.targets[0].body!)).toMatch(/still in development/i);
    expect(english(embed.fallbackBody!)).toMatch(/still in development/i);
    expect(embed.targets[0].extra).toBe("embed-snippet");
    expect(embed.fallbackExtra).toBe("embed-snippet");
  });

  it("shows the Orders toolbar only on the orders stops", () => {
    expect(
      TOUR_STEPS.filter((step) => step.reveal === "orders-toolbar").map((step) => step.id),
    ).toEqual(["orders-search", "orders-filters"]);
  });

  it("recognises only its own step ids", () => {
    expect(isTourStepId("products-add")).toBe(true);
    expect(isTourStepId("tour")).toBe(false);
    expect(isTourStepId(42)).toBe(false);
    expect(tourStep("nope")).toBeUndefined();
  });
});
