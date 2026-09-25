import { describe, expect, it } from "vitest";
import { english } from "../setup/translate";
import {
  EDITOR_TOUR_STEP_IDS,
  EDITOR_TOUR_STEPS,
  isEditorTourStepId,
} from "@/lib/onboarding/editor-tour-steps";
import { SAMPLE_STOREFRONT_PATH } from "@/lib/storefront/sample";

/**
 * The storefront designer's tour, as data. Short by design, so what these pin
 * is that it stays short, stays on one page (the overlay must never navigate out
 * of the designer), and that its selectors and copy are sound.
 */

const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

describe("editor tour steps", () => {
  it("is four stops, one per id, in the declared order", () => {
    expect(EDITOR_TOUR_STEPS.map((step) => step.id)).toEqual([...EDITOR_TOUR_STEP_IDS]);
    expect(EDITOR_TOUR_STEPS).toHaveLength(4);
  });

  it("stays on the sample's own page and never scrolls it", () => {
    for (const step of EDITOR_TOUR_STEPS) {
      expect(step.path, step.id).toBe(SAMPLE_STOREFRONT_PATH);
      // The designer page does not scroll: the canvas pans instead.
      expect(step.scroll, step.id).toBe(false);
      expect(step.requires, step.id).toBeUndefined();
    }
  });

  it("gives every stop a selector that parses", () => {
    for (const step of EDITOR_TOUR_STEPS) {
      expect(step.targets.length, step.id).toBeGreaterThan(0);
      for (const { selector } of step.targets) {
        expect(() => document.querySelector(selector), `${step.id}: ${selector}`).not.toThrow();
      }
    }
  });

  it("ends on the way out of the sample", () => {
    const last = EDITOR_TOUR_STEPS[EDITOR_TOUR_STEPS.length - 1];
    expect(last.targets.map((target) => target.selector)).toEqual(["[data-sample-create]"]);
    expect(english(last.body)).toMatch(/never saves/i);
  });

  it("writes its copy without dashes standing in for punctuation", () => {
    for (const step of EDITOR_TOUR_STEPS) {
      const copy = [
        step.title,
        step.body,
        ...step.targets.flatMap((target) => (target.body ? [target.body] : [])),
      ]
        .map((key) => english(key))
        .join(" ");
      expect(copy, step.id).not.toMatch(DASHES);
    }
  });

  it("recognises only its own step ids", () => {
    expect(isEditorTourStepId("editor-design")).toBe(true);
    expect(isEditorTourStepId("overview-nav")).toBe(false);
    expect(isEditorTourStepId(null)).toBe(false);
  });
});
