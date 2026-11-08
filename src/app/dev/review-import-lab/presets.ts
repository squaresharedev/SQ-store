import type { BeamSource } from "@/components/products/review-import-beams-tokens";
import type { LabPreset } from "./lab-model";

/** The tab that lists LAB_SHORTLIST, ranked, instead of a group of its own. */
export const SHORTLIST_GROUP = "shortlist";

/** The tab the lab opens on: the look the import page ships, as the user picked it. */
export const PICK_GROUP = "pick";

/** The tabs, in the order to look at them. */
export const LAB_GROUPS: readonly { id: string; label: string }[] = [
  { id: PICK_GROUP, label: "Your pick" },
  { id: SHORTLIST_GROUP, label: "Shortlist" },
  { id: "riders", label: "What rides" },
  { id: "shapes", label: "Shapes" },
  { id: "colour", label: "Colour" },
  { id: "earlier", label: "Earlier" },
];

/** The platforms the earlier favourite was picked with: a store, Google, Etsy, Facebook. */
const EARLIER_PLATFORMS: BeamSource[] = ["shopify", "google", "etsy", "facebook"];

export const LAB_PRESETS: readonly LabPreset[] = [
  // Your pick
  {
    id: "shipped",
    name: "Docking along flowing dots (shipped)",
    group: PICK_GROUP,
    note: "Your pick, as the import page shows it: Judge.me, Loox, Yotpo and Shopify in plain icons, dotted beams flowing to the page, and each platform's review riding in and docking into the list.",
    fit: "on-brand",
    look: {},
  },

  // What rides
  {
    id: "card-dock",
    name: "Review cards that dock",
    group: "riders",
    note: "The pick with a small card (face, name, stars, words) riding each beam and settling as the newest review.",
    fit: "on-brand",
    look: { traveller: "card" },
  },
  {
    id: "card-fade",
    name: "Review cards, fading in",
    group: "riders",
    note: "The cards ride the dots and fade at the page's edge as their rows appear.",
    fit: "on-brand",
    look: { traveller: "card", landing: "fade" },
  },
  {
    id: "review-fade",
    name: "Faces, fading in",
    group: "riders",
    note: "The pick without the docking: each face fades at the page's edge.",
    fit: "on-brand",
    look: { landing: "fade" },
  },
  {
    id: "stream",
    name: "Streams of faces",
    group: "riders",
    note: "Three faces ride each dotted beam one after another: many reviews, not one.",
    fit: "on-brand",
    look: { traveller: "stream" },
  },
  {
    id: "stream-together",
    name: "Everyone at once",
    group: "riders",
    note: "Every platform sends its stream together, the count rolling up to the total.",
    fit: "stretch",
    look: { traveller: "stream", carry: "together" },
  },
  {
    id: "review-together",
    name: "All reviews at once",
    group: "riders",
    note: "Four faces leave together and dock together; the list fills in one go.",
    fit: "on-brand",
    look: { carry: "together" },
  },

  // Shapes
  {
    id: "arc",
    name: "On a curve",
    group: "shapes",
    note: "The pick with the platforms bowed towards the page like a fan.",
    fit: "on-brand",
    look: { layout: "arc" },
  },
  {
    id: "sides",
    name: "Both sides",
    group: "shapes",
    note: "Two platforms each side of the page, faces docking from left and right.",
    fit: "on-brand",
    look: { layout: "sides" },
  },
  {
    id: "stack",
    name: "Platforms above",
    group: "shapes",
    note: "The platforms in a row over the page, the dots falling in: what every layout becomes on a phone.",
    fit: "on-brand",
    look: { layout: "stack" },
  },
  {
    id: "solid-line",
    name: "Solid beams",
    group: "shapes",
    note: "The pick on plain faint lines instead of flowing dots.",
    fit: "on-brand",
    look: { line: "line" },
  },
  {
    id: "brisk",
    name: "Brisk",
    group: "shapes",
    note: "The pick at a quicker pace, the loop over in about seven seconds.",
    fit: "on-brand",
    look: { pace: 0.8 },
  },

  // Colour
  {
    id: "purple-light",
    name: "Purple light",
    group: "colour",
    note: "The pick with every beam's light in the app's own purple.",
    fit: "on-brand",
    look: { glow: "acid" },
  },
  {
    id: "lettered",
    name: "Lettered marks",
    group: "colour",
    note: "Shopify, Google, Etsy and Facebook as lettered marks in their colours. They read like the companies' logos, so they need each one's permission before they ship.",
    fit: "stretch",
    look: { sources: EARLIER_PLATFORMS, marks: "lettered" },
  },
  {
    id: "lettered-purple",
    name: "Lettered, purple light",
    group: "colour",
    note: "The lettered marks with the light in the app's purple. Needs the companies' permission too.",
    fit: "stretch",
    look: { sources: EARLIER_PLATFORMS, marks: "lettered", glow: "acid" },
  },

  // Earlier
  {
    id: "earlier-ride",
    name: "Reviews ride the beams",
    group: "earlier",
    note: "Your earlier favourite: lettered marks, solid beams, each face fading at the page's edge.",
    fit: "stretch",
    look: { sources: EARLIER_PLATFORMS, marks: "lettered", landing: "fade", line: "line" },
  },
  {
    id: "earlier-badges",
    name: "Badges along the beams",
    group: "earlier",
    note: "The first beams round's top pick: each platform sends a \"+37\" badge and the count rolls up.",
    fit: "stretch",
    look: { sources: EARLIER_PLATFORMS, marks: "lettered", traveller: "count", landing: "fade", line: "line" },
  },
  {
    id: "earlier-hub",
    name: "Hub",
    group: "earlier",
    note: "Lettered marks on both sides, light only, all at once.",
    fit: "stretch",
    look: {
      sources: EARLIER_PLATFORMS,
      marks: "lettered",
      layout: "sides",
      labels: false,
      carry: "together",
      traveller: "pulse",
      line: "line",
    },
  },
];

/** The closest alternatives to the pick, best first, each with why. */
export const LAB_SHORTLIST: readonly { id: string; why: string }[] = [
  { id: "card-dock", why: "The same motion, with each review's words travelling too." },
  { id: "purple-light", why: "The app's own purple doing the moving, the icons still plain." },
  { id: "arc", why: "The fan points every platform at the page and shortens the middle beams." },
  { id: "sides", why: "The page in the middle, balanced, reviews docking from both sides." },
  { id: "stream", why: "Three faces a beam says many reviews come over, not one each." },
  { id: "brisk", why: "The pick, a little quicker." },
  { id: "solid-line", why: "Calmer: nothing moves between the trips." },
  { id: "review-fade", why: "The pick with a lighter landing, the face fading at the edge." },
];
