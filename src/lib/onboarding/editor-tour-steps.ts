import type { TourStep } from "./tour-steps";

/**
 * THE STOREFRONT DESIGNER'S TOUR: four stops, shown the first time a seller
 * opens the sample storefront (and again from its "Take the tour" button).
 *
 * Short on purpose. The designer has dozens of controls, and a first visit only
 * needs the four ideas everything else hangs off: things go on the grid from the
 * toolbar, the look is set once for the whole storefront, every product has a
 * page, and a sample is for trying things before making your own.
 *
 * Same engine and rules as the dashboard tour (tour-steps.ts): real controls
 * found by language-independent selectors (`data-tour` ids and data attributes,
 * never a translated label), tried in order with the first one on screen
 * winning, which is how the desktop column and the phone's toolbar button share
 * a stop. Every step lives on the designer page it is shown on: `path` here
 * names the sample, and EditorTour swaps in the page actually showing, so the
 * overlay never navigates.
 */

export const EDITOR_TOUR_STEP_IDS = [
  "editor-add",
  "editor-design",
  "editor-page",
  "editor-finish",
] as const;

export type EditorTourStepId = (typeof EDITOR_TOUR_STEP_IDS)[number];

const PATH = "/storefront/sample";

export const EDITOR_TOUR_STEPS: readonly TourStep<EditorTourStepId>[] = [
  {
    id: "editor-add",
    path: PATH,
    page: "sampleStorefront",
    title: "Onboarding.editorTour.steps.editorAdd.title",
    body: "Onboarding.editorTour.steps.editorAdd.body",
    targets: [{ selector: '[data-tour="editor-toolbar"]' }],
    scroll: false,
    side: "top",
  },
  {
    id: "editor-design",
    path: PATH,
    page: "sampleStorefront",
    title: "Onboarding.editorTour.steps.editorDesign.title",
    body: "Onboarding.editorTour.steps.editorDesign.body",
    targets: [
      {
        // The docked settings column, from lg up.
        selector: "[data-design-panel] [data-panel-menu]",
        body: "Onboarding.editorTour.steps.editorDesign.bodyPanel",
        side: "left",
      },
      {
        // Below lg the same settings are a sheet behind this button.
        selector: '[data-tour="editor-design-settings"]',
        body: "Onboarding.editorTour.steps.editorDesign.bodyButton",
        side: "top",
      },
    ],
    scroll: false,
  },
  {
    id: "editor-page",
    path: PATH,
    page: "sampleStorefront",
    title: "Onboarding.editorTour.steps.editorPage.title",
    body: "Onboarding.editorTour.steps.editorPage.body",
    // One button, whether the pages are showing or not.
    targets: [{ selector: '[data-tour="editor-product-pages"]' }],
    scroll: false,
    side: "top",
  },
  {
    id: "editor-finish",
    path: PATH,
    page: "sampleStorefront",
    title: "Onboarding.editorTour.steps.editorFinish.title",
    body: "Onboarding.editorTour.steps.editorFinish.body",
    targets: [{ selector: "[data-sample-create]" }],
    scroll: false,
  },
];

export function isEditorTourStepId(value: unknown): value is EditorTourStepId {
  return typeof value === "string" && (EDITOR_TOUR_STEP_IDS as readonly string[]).includes(value);
}
