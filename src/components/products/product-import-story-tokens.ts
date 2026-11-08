/**
 * The looks of the product import's motion graphic (components/products/
 * ProductImportStory): a cursor takes a product off a real-looking shelf,
 * drags it straight across and lets go of it in the Square Share catalogue.
 * Pure data, so the dev lab (app/dev/product-import-lab) tunes exactly what
 * ships. Not on the import page yet: it waits for a pick from the lab.
 */

/**
 * The products on the shelf, in the order the cursor takes them: their photo,
 * the same product cut out of it (a transparent PNG, so it can stand on a
 * board with nothing round it) and a price in euros. `fit` is how the photo
 * fills a catalogue card: `cover` for a full photo, `contain` for a cut-out
 * that has no background of its own. Their names are copy
 * (Products.import.story.items).
 */
const cutout = (id: string) => `/import-story/${id}.webp`;
export const STORY_ITEMS = [
  { id: "headphones", photo: "/sample-storefront/headphones.webp", cutout: cutout("headphones"), fit: "cover", price: 89 },
  { id: "succulent", photo: "/sample-storefront/succulent.webp", cutout: cutout("succulent"), fit: "cover", price: 19 },
  { id: "watch", photo: "/sample-storefront/watch.webp", cutout: cutout("watch"), fit: "cover", price: 149 },
  { id: "sunglasses", photo: cutout("sunglasses"), cutout: cutout("sunglasses"), fit: "contain", price: 49 },
  { id: "tshirt", photo: cutout("tshirt"), cutout: cutout("tshirt"), fit: "contain", price: 29 },
  { id: "camera", photo: cutout("camera"), cutout: cutout("camera"), fit: "contain", price: 129 },
] as const;
export type StoryItem = (typeof STORY_ITEMS)[number];

/** How many products travel. Four sit two across; more sit three across. */
export const STORY_COUNTS = [4, 6] as const;
export type StoryCount = (typeof STORY_COUNTS)[number];

/** How many to a row on the shelf and in the catalogue. */
export const storyColumns = (count: StoryCount) => (count > 4 ? 3 : 2);

/** Where the shelf sits: beside the catalogue, or above it (what every layout becomes where the stage is narrow). */
export const STORY_LAYOUTS = ["split", "stack"] as const;
export type StoryLayout = (typeof STORY_LAYOUTS)[number];

/**
 * What the shelf is. `bookcase`: a cabinet, uprights either side and a back
 * panel. `floating`: boards fixed to the wall on brackets. `rack`: open
 * shelving, thin uprights and thin boards. `cubbies`: a cabinet divided into
 * compartments, one product to each.
 */
export const STORY_SHELVES = ["bookcase", "floating", "rack", "cubbies"] as const;
export type StoryShelf = (typeof STORY_SHELVES)[number];

/**
 * What the shelf is made of: its colours. Raw values on purpose, for the lab
 * (a place for trying things); the winner is promoted to theme tokens in
 * globals.css before it ships. `grain` draws wood grain along the boards.
 */
export const STORY_MATERIALS = ["oak", "walnut", "white", "black"] as const;
export type StoryMaterial = (typeof STORY_MATERIALS)[number];

export type MaterialColours = {
  /** The back panel (and the wall behind open shelving). */
  back: string;
  /** A board's front edge, and the uprights. */
  front: string;
  /** A board's top surface, where products stand. */
  top: string;
  /** The hairline along an edge. */
  edge: string;
  grain: boolean;
};

export const MATERIAL_COLOURS: Record<StoryMaterial, MaterialColours> = {
  oak: { back: "#efe6d6", front: "#c9a577", top: "#dcbf92", edge: "#a67d4b", grain: true },
  walnut: { back: "#ddd3c7", front: "#6b4a35", top: "#82593f", edge: "#4b3123", grain: true },
  white: { back: "#f3f3f2", front: "#ffffff", top: "#f6f6f5", edge: "#d6d6d4", grain: false },
  black: { back: "#2c2c2f", front: "#18181a", top: "#2a2a2d", edge: "#08080a", grain: false },
};

/** Wood grain along a board: fine pale and dark lines, over the material's own colour. */
export const GRAIN_BACKGROUND =
  "repeating-linear-gradient(90deg, rgba(0,0,0,0.05) 0 2px, rgba(255,255,255,0.04) 2px 9px, rgba(0,0,0,0.03) 9px 11px)";

/** The shade a board throws on whatever is under it (a gradient: the board's own colour does not enter). */
export const BOARD_SHADOW_BACKGROUND = "linear-gradient(to bottom, rgba(0,0,0,0.24), rgba(0,0,0,0))";

/**
 * How a product stands on the shelf. `loose`: the product itself, cut out of
 * its photo, standing on the board with a shadow. `tile`: its photo, flat,
 * like a framed print.
 */
export const STORY_FORMS = ["loose", "tile"] as const;
export type StoryForm = (typeof STORY_FORMS)[number];

/** The pointer: the app's arrow, or a hand that opens to reach and closes to hold. */
export const STORY_CURSORS = ["arrow", "hand"] as const;
export type StoryCursor = (typeof STORY_CURSORS)[number];

/** How a held product reads: `tilt` leans as it is lifted; `float` only grows and casts a shadow. */
export const STORY_LIFTS = ["tilt", "float"] as const;
export type StoryLift = (typeof STORY_LIFTS)[number];

/** A held product's lean (degrees) and how much bigger it grows. */
export const LIFT_TILT: Record<StoryLift, number> = { tilt: -4, float: 0 };
export const LIFT_SCALE = 1.06;

/** What the catalogue is drawn in: a browser window on the page, or Square Share's own app shell. */
export const STORY_FRAMES = ["browser", "app"] as const;
export type StoryFrame = (typeof STORY_FRAMES)[number];

/**
 * What the catalogue does where a product lands. `settle`: the card sits down
 * with a small bounce. `ring`: and an ink ring answers it. The slot a product is
 * heading for is marked in ink, never in the accent.
 */
export const STORY_LANDINGS = ["settle", "ring"] as const;
export type StoryLanding = (typeof STORY_LANDINGS)[number];

/** The slot a product is heading for. */
export const SLOT_TARGET_CLASS = "border-foreground bg-accent";

/**
 * The width (px) the app is drawn at before it is scaled down into the stage:
 * the dashboard at desktop size, or its phone layout (rail gone, a top bar with
 * the menu) where the stage is narrow.
 */
export const STORY_APP_WIDTH = { desktop: 1040, compact: 600 } as const;

/** The beat lengths' multiplier: over 1 is slower. */
export const STORY_PACE = { min: 0.6, max: 1.6 } as const;

export type ProductImportStoryLook = {
  layout: StoryLayout;
  count: StoryCount;
  shelf: StoryShelf;
  material: StoryMaterial;
  form: StoryForm;
  cursor: StoryCursor;
  lift: StoryLift;
  frame: StoryFrame;
  landing: StoryLanding;
  pace: number;
};

/** What the lab opens on: picked from the lab (walnut boards, loose products, the arrow, at the quickest pace). */
export const PRODUCT_IMPORT_STORY_LOOK: ProductImportStoryLook = {
  layout: "split",
  count: 6,
  shelf: "floating",
  material: "walnut",
  form: "loose",
  cursor: "arrow",
  lift: "tilt",
  frame: "app",
  landing: "settle",
  pace: 0.6,
};

/** `look` over the default one, put right where it asks for what cannot be drawn. */
export function storyLook(look: Partial<ProductImportStoryLook> = {}): ProductImportStoryLook {
  const full = { ...PRODUCT_IMPORT_STORY_LOOK, ...look };
  return { ...full, pace: Math.min(STORY_PACE.max, Math.max(STORY_PACE.min, full.pace)) };
}
