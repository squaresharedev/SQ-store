# The storefront editor upgrade

What it added, where each part lives, and the rules it was built under. Read
this before changing any of it.

## Why

A non-designer should be able to build a storefront that looks good. Every
item came from building a real storefront through the MCP and hitting a wall:
white studio photos looked like white boxes on a colored board, the serif
looked like Times, every color was typed as hex, the board always kept side
margins, small things could not be placed precisely, and nothing linked
anywhere except product cards.

## The rules it was built under

1. Good by default. A new storefront with zero edits should already look good.
2. One control per feature: a toggle or 3 to 5 named presets. Numbers live
   behind "More" or are MCP-only.
3. Palette first: every color picker opens on the theme's five colors.
4. Theme first, block second: set it once for the board; per-block overrides
   sit in the block's "More".
5. A control budget: at most 5 new visible controls in the whole-storefront
   panel, at most 2 per block panel.
6. Grid mode stays bulletproof; the phone layout is automatic.
7. Plain words in the UI.

## The one hard rule: nothing live changes

Storefronts are embedded on sellers' own websites. Every field this upgrade
added is OPTIONAL, and an absent field draws exactly as before.

- The nicer starting point is `NEW_STOREFRONT_THEME` (`src/types/storefront.ts`),
  applied by `createStorefront` only. Never add to `DEFAULT_STOREFRONT_CONFIG`:
  an old stored config falls back to it.
- A writer drops a key when its value returns to the default, so an untouched
  storefront stays byte-identical.
- `tests/unit/storefront/editor-upgrade-contract.test.ts` pins both: a
  storefront saved before the upgrade parses to exactly what was stored.
- `tests/component/photo-cards-legacy.test.tsx` compares legacy cards with a
  snapshot taken before the card look was written.

Two readability fixes are the only intended changes to existing storefronts:

- A card's labels (price, sale chip, name) are never drawn under 11px
  (`TILE_LABEL_READABLE_PX`). On a small card a price that used to draw at 8 to
  10px now draws at 11px.
- A card narrower than 8.5rem with its price in the name strip stacks the name
  over the price (`globals.css`), so a phone's small cards keep a readable name.

Neither applies to a MINIATURE of a board (`StorefrontPreview`, the storefront
list's cards): it sets `--tile-label-floor: 0px` and is left out of the
stacking, so it draws as it always did.

## What it added

| Area | Fields | Where |
| --- | --- | --- |
| Palette | `theme.palette` (background, text, accent, surface, muted) | `lib/storefront/palette.ts`, `ThemePanel`, `ColorPanel` |
| Font pairings | `theme.fontPairing` (editorial, classic, modern, soft, studio) | `lib/theme/font-pairings.ts`, `src/app/fonts/` (with `LICENSES.md`), `TypographySection` |
| Text styles | `theme.textStyles`, a fourth `variant` (`label`), `TextBlock.valign` | `lib/storefront/text-styles.ts`, `TextTileContent`, `TextBlockEditor` |
| Card look | `cardColor`, `whiteBlend`, `titleBarColor`, `titleTextColor`, `titleFont`, `photoShape`, `shadow` on the theme and per card; `ProductBlock.photoEdge` | `components/storefront/card-look.ts`, `lib/storefront/photo-edge.ts`, `CardLookControls` |
| Images, shapes | `ImageBlock.shape`, `.shadow`; `ShapeBlock.shadow`, `.gradient` | `ImageTileContent`, `ShapeTileContent`, `shape-fill.ts` |
| Gradients | a third stop (`via`) on the background; ready-made palette gradients | `lib/storefront/gradients.ts` |
| Motion, finish | `theme.motion`, `theme.texture` | `lib/storefront/motion.ts`, `BoardMotion`, `FinishControls` |
| Bands | `config.bands` (a color, a gradient or a photo behind a run of rows) | `lib/storefront/bands.ts`, `BandPaint`, `BandEditor`, `Grid` underlays |
| Fine placement | `fine` on text, shape and button blocks (half-cell insets) | `components/grid/`, `lib/storefront/layout-blocks.ts` |
| Links | `LinkTarget`: a product on the board, another storefront of the store, a band, an https address | `lib/storefront/links.ts`, `layout-save.ts` |
| Button block | `{type: "button", label, link, look}` | `ButtonTileContent`, `ButtonBlockEditor` |
| Header | `header.logo`, `header.links`, a cart icon where the cart is live | `StorefrontMasthead`, `MastheadNav`, `HeaderLogoMenu` |
| Scrolling text | `{type: "marquee", text, speed, variant, color}` | `MarqueeTileContent`, `lib/storefront/marquee.ts` |
| Product carousel | `{type: "carousel", id, productIds}` (1 to 12, each once, in order) | `CarouselTileContent`, `CarouselBlockEditor`, `lib/storefront/carousel.ts` |
| MCP | `palette`, `add_button`, `add_marquee`, `add_carousel`, `add_band`, `edit_band`, `remove_band` operations; `preview_storefront` full resolution and region; `upload_font`; `copy_product_photo` | `lib/storefront/design-ops.ts`, `lib/agent/` (see `docs/mcp.md`) |

Copy for the four editor workstreams is in its own catalogs, in all ten
locales: `EditorCards`, `EditorType`, `EditorLayout`, `EditorFinish`, each with
a `panel` half (the editor) and a `board` half (what a buyer can read).

## Decisions worth knowing before changing something

- **The palette recolors by value, it does not link.** Every color field holds
  plain hex. Changing a palette color replaces that hex wherever the storefront
  wears it (`recolourPalette`), so no renderer and no live embed can meet a
  value it does not understand. Colors are found by field NAME: `color`,
  `accent`, `from`, `via`, `to`, or ending in `Color`. A new color field that
  follows the rule is recolored with no further wiring. When two palette
  slots share a color, only the slot itself moves.
- **A band is not a block.** It lives in `config.bands`, so reading order, the
  phone reflow, the block cap, overlap and layering have no new case. On a
  phone a band follows the blocks that sit on it.
- **Fine placement is insets.** A block's rectangle stays whole cells and
  `fine` pulls each named side in by half a cell, so the block never leaves its
  cells and every whole-cell rule holds. Product cards never carry it.
- **"Auto" white blend needs a measurement only the designer takes.** Product
  photos are on another origin, so a buyer's page cannot read their pixels.
  The designer measures each photo's edges through the seller's same-origin
  photo route and stores `photoEdge` on the card. A board built through the MCP
  does not blend on "auto" until it is opened in the designer; an assistant
  sets `whiteBlend: "on"` per card instead.
- **A buyer's page is handed a built payload.** Bands, band photos, the logo
  and every link's address are put into `StorefrontPageData` by `boardLayout`
  (`lib/storefront/storefront-page.ts`), which the MCP preview also calls. A
  link that leads nowhere a buyer may go is dropped there.
- **A link never costs a seller their storefront.** The schema refuses a link
  to a product the board does not show. A save drops such links with the
  product block it dropped, and a stored config whose only fault is a dead link
  is read back without it (`parseStoredStorefrontConfig`).
- **Words on a band pick a readable ink** where the seller chose none
  (`textInkOnBackdrop`, WCAG AA). A block off a band keeps the ink it always had.
- **A carousel shows products that are not product blocks, so every "is this
  product on this storefront" counts its members.** The one answer is
  `boardProductIds` (`types/storefront.ts`): product blocks and carousel
  members, each once, in reading order. The product page and checkout gate
  (`placementOf` in `lib/products/purchasable.ts`, used by
  `lib/products/public.ts`), the sitemap, the structured data, the storefront
  list's previews (`placedProductIds`), the setup checklist, the dashboard's
  placements and the product cards' "on these storefronts" all ask it. A
  product only a carousel shows has its own page and can be bought; it has no
  block, so no manual sold-out mark (`Purchasable.block` is null).
- **A board sheds a product one way: `keepProducts`
  (`lib/storefront/carousel.ts`).** A product block naming a product that is
  not kept goes whole, a carousel loses that member, and a carousel left with
  none goes too. The save's ownership check (the ACTIVE account's products,
  so a team member saves the owner's store), the buyer's payload
  (`buildStorefrontPage`: live, this owner's, not taken down) and the MCP
  preview all call it. `settleLayout` then drops any link the change left
  pointing nowhere, and the designer does the same when a product is taken
  out of a carousel in its panel (`withoutDeadLinks`).
- **A carousel's cards are the board's cards.** Each is `ProductTileContent`
  with the theme's card style (no per-card overrides), in a product card's
  frame, with the cell's corner radius; the card look's shadow is drawn on
  the carousel's cell (`blockShadow`), where a drop shadow falls under each
  card. A card's product reaches the buyer as the same built
  `StorefrontTileProduct` a tile gets (a stock STATE, never a count), and opens
  its page exactly as a product block's card does: a link (a new tab in the
  embed frame), or `QuickAddTile` where the card adds to the cart.
- **Two things a carousel's cards do not do.** They hold still on hover: the
  board's hover effects answer to the grid cell, and a row of cards is one
  cell, so every card would lift at once. And they are never measured for
  "auto" white blend (`photoEdge` is a product block's), so they blend only
  where `whiteBlend` is "on".
- **Swiping is the browser's.** Native CSS scroll snap (`snap-x
  snap-mandatory`, the `swipe-x` utility for no scrollbar), no library, no
  autoplay. A card is as wide as the row is tall (container units), the board's
  gap apart, so a 6 by 2 carousel shows three cards on the board's columns. The
  previous and next arrows show on a fine pointer only (`pointer-fine`), step
  a page at a time, jump instead of gliding under reduced motion, and stay
  focusable but faded (`aria-disabled`) at an end. On a phone the automatic
  reflow scales the block like any other (a 6 by 2 row on a 2 column phone
  board is 2 by 1, two cards in view), and `block.mobile` places it like any
  other.
- **The embed's JSON route (`/api/embed/[key]`) leaves carousels out, as it
  leaves out buttons and scrolling text.** That payload has no consumer (the
  embed is the frame, `/e/...`, drawn by `StorefrontBoard`), so its removal
  check still asks only about the product tiles it emits.
- **Motion never hides a board.** Blocks arrive by a CSS animation that ends
  visible with no script; script only hides a block the observer has reported
  off screen. Nothing moves under reduced motion. The MCP preview draws the
  board still.

## Not built

- **One-click background removal.** The existing in-browser cut-out
  (`lib/share-card/cutout`) loads its runtime and model from third parties at
  run time, which a storefront may not do. Self-host them first.
- **Editor search entries** for the new controls (`lib/storefront/setting-ref.ts`).

## Looking at it

Dev-only pages, no sign-in and no database:

- `/dev/editor-demo` is ONE storefront wearing every feature above, the
  carousel included (`?view=embed` for the embed frame, `&motion=0` to draw
  it still).
- `/dev/editor-cards`, `/dev/editor-type`, `/dev/editor-layout`,
  `/dev/editor-finish` and `/dev/editor-mcp` are each workstream's gallery.
  `/dev/editor-layout` ends on a carousel of the sample's five products, and
  `?view=designer` there has its panel (`+ carousel` adds one).
- `/dev/sample-storefront?tour=0` is the real designer on the sample storefront.
