import type { LabPreset } from "./lab-model";

/** The tab that lists LAB_SHORTLIST, ranked, instead of a group of its own. */
export const SHORTLIST_GROUP = "shortlist";

/** The tab the lab opens on: the look picked from round two, "Oak floating boards", without the cube faces. */
export const PICK_GROUP = "pick";

/** The tabs, in the order to look at them. */
export const LAB_GROUPS: readonly { id: string; label: string }[] = [
  { id: PICK_GROUP, label: "Your pick" },
  { id: SHORTLIST_GROUP, label: "Shortlist" },
  { id: "floating", label: "Floating boards" },
  { id: "bookcase", label: "Bookcases" },
  { id: "rack", label: "Racks" },
  { id: "cubbies", label: "Cubbies" },
  { id: "hands", label: "Cursor" },
  { id: "frames", label: "Frames" },
];

export const LAB_PRESETS: readonly LabPreset[] = [
  // Your pick
  {
    id: "pick",
    name: "Walnut floating boards, loose products",
    group: PICK_GROUP,
    note: "Your pick: two walnut boards on brackets, the products cut out of their photos and standing on them; the arrow takes one and drags it straight into the dashboard, drawn as the real app (its rail, top bar and Products page), where the product turns into its card. The quickest pace.",
    fit: "on-brand",
    look: {},
  },

  // Floating boards
  {
    id: "float-tile",
    name: "Walnut boards, flat photos",
    group: "floating",
    note: "The pick with the photos standing as flat prints instead of cut-outs.",
    fit: "stretch",
    look: { form: "tile" },
  },
  {
    id: "float-hand",
    name: "Walnut boards, hand",
    group: "floating",
    note: "The pick with a hand that closes on the product instead of the arrow.",
    fit: "on-brand",
    look: { cursor: "hand" },
  },
  {
    id: "float-four",
    name: "Walnut boards, four products",
    group: "floating",
    note: "Two rows of two: bigger products, a shorter loop.",
    fit: "on-brand",
    look: { count: 4 },
  },
  {
    id: "float-oak",
    name: "Oak boards",
    group: "floating",
    note: "The pick in lighter wood.",
    fit: "on-brand",
    look: { material: "oak" },
  },
  {
    id: "float-white",
    name: "White boards",
    group: "floating",
    note: "White boards on the wall: light, almost no furniture.",
    fit: "on-brand",
    look: { material: "white" },
  },
  {
    id: "float-black",
    name: "Black boards",
    group: "floating",
    note: "Black boards on the pale wall, hard lines.",
    fit: "stretch",
    look: { material: "black" },
  },

  // Bookcases
  {
    id: "case-oak",
    name: "Oak bookcase",
    group: "bookcase",
    note: "An oak cabinet with a back panel; the products stand on its boards.",
    fit: "on-brand",
    look: { shelf: "bookcase", material: "oak" },
  },
  {
    id: "case-white",
    name: "White bookcase",
    group: "bookcase",
    note: "A painted white cabinet: the quietest, closest to the app's own paper.",
    fit: "on-brand",
    look: { shelf: "bookcase", material: "white" },
  },
  {
    id: "case-walnut",
    name: "Walnut bookcase",
    group: "bookcase",
    note: "A rich, dark cabinet, the pick's wood.",
    fit: "stretch",
    look: { shelf: "bookcase", material: "walnut" },
  },
  {
    id: "case-black",
    name: "Black bookcase",
    group: "bookcase",
    note: "A black cabinet with a dark back, the products lit against it.",
    fit: "stretch",
    look: { shelf: "bookcase", material: "black" },
  },

  // Racks
  {
    id: "rack-black",
    name: "Black open rack",
    group: "rack",
    note: "Thin black uprights and boards, like a shop's shelving: open at the back.",
    fit: "on-brand",
    look: { shelf: "rack", material: "black" },
  },
  {
    id: "rack-white",
    name: "White open rack",
    group: "rack",
    note: "The same rack in white.",
    fit: "on-brand",
    look: { shelf: "rack", material: "white" },
  },
  {
    id: "rack-oak",
    name: "Oak open rack",
    group: "rack",
    note: "A light wooden frame, open at the back.",
    fit: "on-brand",
    look: { shelf: "rack", material: "oak" },
  },

  // Cubbies
  {
    id: "cubbies-oak",
    name: "Oak cubbies",
    group: "cubbies",
    note: "A cabinet divided into compartments, one product in each.",
    fit: "on-brand",
    look: { shelf: "cubbies", material: "oak" },
  },
  {
    id: "cubbies-white",
    name: "White cubbies",
    group: "cubbies",
    note: "Painted white compartments.",
    fit: "on-brand",
    look: { shelf: "cubbies", material: "white" },
  },
  {
    id: "cubbies-four",
    name: "Four walnut cubbies",
    group: "cubbies",
    note: "A square of four compartments, a product each.",
    fit: "stretch",
    look: { shelf: "cubbies", count: 4, material: "walnut" },
  },

  // Cursor
  {
    id: "lift-level",
    name: "Lifted level",
    group: "hands",
    note: "The held product grows and casts a shadow but stays level, no lean.",
    fit: "on-brand",
    look: { lift: "float" },
  },
  {
    id: "ring-landing",
    name: "Ink ring on landing",
    group: "hands",
    note: "Where a product lands, a thin ink ring answers it (no colour).",
    fit: "on-brand",
    look: { landing: "ring" },
  },
  {
    id: "unhurried",
    name: "Unhurried",
    group: "hands",
    note: "The pick at a slower pace, the loop about a third longer.",
    fit: "on-brand",
    look: { pace: 1 },
  },
  {
    id: "calm",
    name: "Calm",
    group: "hands",
    note: "Slower still, each grab given time.",
    fit: "on-brand",
    look: { pace: 1.35 },
  },

  // Frames
  {
    id: "browser",
    name: "Browser window",
    group: "frames",
    note: "The catalogue in a drawn browser tab at squareshare.eu/products, as the review import draws its product page.",
    fit: "on-brand",
    look: { frame: "browser" },
  },
  {
    id: "stack",
    name: "Shelf above",
    group: "frames",
    note: "The boards over the catalogue, products dragged down into it: what every layout becomes on a phone.",
    fit: "on-brand",
    look: { layout: "stack" },
  },
  {
    id: "stack-white-browser",
    name: "Shelf above, white, browser",
    group: "frames",
    note: "Stacked, white boards, the catalogue in a browser window.",
    fit: "on-brand",
    look: { layout: "stack", material: "white", frame: "browser" },
  },
];

/** The closest alternatives to the pick, best first, each with why. */
export const LAB_SHORTLIST: readonly { id: string; why: string }[] = [
  { id: "float-white", why: "The same boards in the app's own paper, so nothing competes with the products." },
  { id: "float-hand", why: "A hand that closes on the product instead of the arrow." },
  { id: "float-four", why: "Half the trips and bigger products." },
  { id: "float-oak", why: "The same boards in lighter wood." },
  { id: "browser", why: "Closer to the review import's graphic, if the two should match." },
  { id: "case-oak", why: "The same oak in a cabinet, if boards alone feel too bare." },
];
