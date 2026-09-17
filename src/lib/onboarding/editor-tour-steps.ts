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
 * found by selectors the designer already renders, tried in order with the first
 * one on screen winning, which is how the desktop column and the phone's toolbar
 * button share a stop. Every step lives on the designer page it is shown on:
 * `path` here names the sample, and EditorTour swaps in the page actually
 * showing, so the overlay never navigates.
 */

export const EDITOR_TOUR_STEP_IDS = [
  "editor-add",
  "editor-design",
  "editor-page",
  "editor-finish",
] as const;

export type EditorTourStepId = (typeof EDITOR_TOUR_STEP_IDS)[number];

const PATH = "/storefront/sample";
const TOOLBAR = '[role="toolbar"][aria-label="Editor tools"]';

export const EDITOR_TOUR_STEPS: readonly TourStep<EditorTourStepId>[] = [
  {
    id: "editor-add",
    path: PATH,
    pageLabel: "Sample storefront",
    title: "Add to your grid",
    body: "Add products, text and shapes from this bar. Drag anything on the grid to move it, and pull a corner to resize it.",
    targets: [{ selector: TOOLBAR }],
    scroll: false,
    side: "top",
  },
  {
    id: "editor-design",
    path: PATH,
    pageLabel: "Sample storefront",
    title: "Set the look",
    body: "Colours, fonts, the header and how product cards look are set once for the whole storefront.",
    targets: [
      {
        // The docked settings column, from lg up.
        selector: "[data-design-panel] [data-panel-menu]",
        body: "Colours, fonts, the header and how product cards look are set here, once for the whole storefront.",
        side: "left",
      },
      {
        // Below lg the same settings are a sheet behind this button.
        selector: `${TOOLBAR} button[aria-label="Design settings"]`,
        body: "Tap here for colours, fonts, the header and how product cards look, set once for the whole storefront.",
        side: "top",
      },
    ],
    scroll: false,
  },
  {
    id: "editor-page",
    path: PATH,
    pageLabel: "Sample storefront",
    title: "Every product gets a page",
    body: "Each product on the grid has its own page to share. Open one here to see it and style it.",
    targets: [
      { selector: `${TOOLBAR} button[aria-label="Show the product page"]` },
      { selector: `${TOOLBAR} button[aria-label="Close the product pages"]` },
    ],
    scroll: false,
    side: "top",
  },
  {
    id: "editor-finish",
    path: PATH,
    pageLabel: "Sample storefront",
    title: "Make it yours",
    body: "The sample never saves, so try anything. When you're ready, create a storefront of your own.",
    targets: [{ selector: "[data-sample-create]" }],
    scroll: false,
  },
];

export function isEditorTourStepId(value: unknown): value is EditorTourStepId {
  return typeof value === "string" && (EDITOR_TOUR_STEP_IDS as readonly string[]).includes(value);
}
