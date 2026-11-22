# Editor upgrade: the shared brief

Five agents build this in one parallel round, each in its own worktree. This
file is everything they share. Read all of it before writing code, then read
your own workstream at the end.

## The goal

Make it easy for a non-designer to build a storefront that looks good. Every
item comes from building a real storefront through the Square Share MCP and
hitting a wall. The end goal is simplicity for the person designing the shop.
More power is only welcome if it adds no visible complexity.

## Simplicity rules (non-negotiable, every item)

1. Good by default. A new storefront with zero edits should already look good.
   Prefer automatic behavior over a new control.
2. One control per feature in the default UI: a toggle, or 3 to 5 named presets
   (with a tiny visual preview where possible). Sliders and raw numbers live
   behind "More" or are MCP-only.
3. Palette first. Every color picker opens on the theme palette swatches. Free
   hex input sits behind "Custom".
4. Theme first, block second. Set things once for the whole board. Per-block
   overrides live in the block's "More".
5. Budget: the whole-storefront design panel gains at most 5 new visible
   controls in total, each block panel at most 2. Your share is in your
   workstream. Over budget means combine, automate, or make it MCP-only.
6. Grid mode stays bulletproof. No new feature may create overlaps or
   unreadable text in grid mode. Freeform may do more.
7. Phone is automatic. A user never has to fix the phone layout because of a
   new feature.
8. Plain words in the UI. No "multiply", "box-shadow", "z-index", "opacity".
   Sentence case, short labels, no em dashes.
9. Escape hatch: if a capability cannot meet these rules, ship it MCP-only
   (the schema accepts it, the editor does not show it) and say so in your
   report.

"Visible" means on screen when the panel or section is opened. A control
behind a collapsed "More" disclosure does not count.

## What is true about this codebase (verified, differs from the original ask)

- EVERYTHING is in this one repo (`SQ-store`, the dashboard and editor):
  the storefront schema, the renderer, the hosted storefront page, the embed,
  the product page and the MCP server. Do not look in other repos.
- The schema is `src/types/storefront.ts` (types, constants, resolvers) and
  `src/lib/validation/storefront.ts` (Zod, parsed on every save).
  `@squaresharedev/schemas` is a drifted mirror this app does not import.
- ONE renderer draws a board for buyers: `StorefrontBoard`
  (`src/components/storefront-page/`), shared by the hosted page
  `/s/[storefrontId]` (`StorefrontPageView`) and the embed frame
  `/e/[key]/...` (`EmbedFrameView`). It is built from the designer's own
  pieces: the shared `<Grid>` (`src/components/grid/`), `BlockFace` and the
  `*TileContent` faces, `StorefrontMasthead`, and the enum-to-class maps in
  `components/storefront/config-maps.ts`. The designer's canvas is
  `DesignerCanvas` + `BlockTile` with the same faces.
- The embed is an IFRAME (`public/widget.js` inserts it), not a Shadow DOM
  widget. Fonts and styles inside it are an ordinary page's. There is no
  Preact bundle. "Embed bundle size" here means what the frame route ships.
- What a buyer's page is handed is BUILT, never spread: `buildStorefrontPage`
  in `src/lib/storefront/storefront-page.ts` produces `StorefrontPageData`
  (`src/types/storefront-page.ts`). A new thing a buyer must see has to be put
  into that payload on purpose (and signed there, if it is a file).
- The MCP server is `src/lib/agent/` (`docs/mcp.md`). `get_schema` is
  generated from the Zod schema, so a `.describe()` on a schema field IS its
  MCP documentation. `edit_storefront` applies `lib/storefront/design-ops.ts`.
- Editor panels: the whole-storefront side is `ControlsPanel` (groups Theme,
  Header, Product cards, Typography, Sold out, Product page, Checkout, Cart);
  a selected block's side is its `*BlockEditor`. Both are mounted by
  `StorefrontDesigner.tsx` (4,900 lines).
- Fonts are local woff2 files in `src/app/fonts/`, declared with
  `next/font/local` in `src/app/layout.tsx`. Nothing is fetched from a font
  CDN and nothing may be.
- Copy is next-intl, ten locales: `cs de en es fr it nl pl pt-PT sk`.
- This is Next.js 16. Read `AGENTS.md` and the relevant guide under
  `node_modules/next/dist/docs/` before using a Next API from memory.
- Read `CLAUDE.md` ("Tokenize everything" applies to all new code).

## Backwards compatibility (hard rule)

Live storefronts are embedded on sellers' own websites.

- Every new field is OPTIONAL, and an ABSENT field renders EXACTLY as today:
  same pixels, same DOM where practical, no new inline style or class on the
  unchanged path. Write the absent path first and keep it the plain one.
- Nicer defaults go to NEW storefronts only: `NEW_STOREFRONT_THEME` in
  `src/types/storefront.ts`, applied by `createStorefront`. Never add one to
  `DEFAULT_STOREFRONT_CONFIG` (it is what an old stored config falls back to).
- A writer DROPS a key when a value returns to its default (see
  `withRotation`, `setHeaderStyle`, `mergeCardStyleOverrides`,
  `patchThemeCardStyle`), so an untouched storefront stays byte-identical.
- The two "Fix" items in Photo cards deliberately change how broken cases
  draw. Those are the only intended visual changes to existing storefronts;
  the owner lists exactly what changes and when.
- The orchestrator runs a before/after render of fixture configs after
  integration. Help it: your dev gallery (below) includes one "legacy" board
  that uses none of your fields.

## The contract (already written, do not edit)

The orchestrator wrote and committed the schema for all five workstreams. You
build against it. DO NOT EDIT `src/types/storefront.ts` or
`src/lib/validation/storefront.ts`. If the contract is wrong or missing
something, do not work around it by widening a type: put the exact change you
need under "CONTRACT REQUESTS" in your report, and in the meantime keep your
feature inside what the contract allows.

Read the block in `src/types/storefront.ts` headed `EDITOR UPGRADE CONTRACT`
and the matching block in the validation file. In short:

| Area | Contract |
| --- | --- |
| Palette | `theme.palette?: {background,text,accent,surface,muted}` (hex). Helpers: `lib/storefront/palette.ts` (`derivePalette`, `recolourPalette`, `replaceColor`, `isColorKey`). |
| Fonts | `theme.fontPairing?: editorial/classic/modern/soft/studio`. Roles `heading`/`body`. `lib/theme/font-roles.ts` (`fontRoleStyle`, `FONT_ROLE_VARS`). |
| Text styles | `theme.textStyles?: {heading,subheading,body,label}` of `TextStyleDef`; a text block names one with `variant` (now four values). `lib/storefront/text-styles.ts` (`resolveTextStyle`). |
| Text | `TextBlock.valign?: top/middle/bottom`. |
| Card look | On the theme AND per card (`CardStyle`): `cardColor?`, `whiteBlend?: auto/on/off`, `titleBarColor?`, `titleTextColor?`, `titleFont?: heading/body`, `photoShape?: rectangle/rounded/arch/circle`, `shadow?: none/soft/lifted`. `ProductBlock.photoEdge?: white/other` (a cached measurement). |
| Images, shapes | `ImageBlock.shape?`, `ImageBlock.shadow?`, `ShapeBlock.shadow?`, `ShapeBlock.gradient?: {from,via?,to,angle}`. |
| Background | gradient gains `via?` (a third stop). |
| Motion, finish | `theme.motion?: none/subtle/lively`, `theme.texture?: none/light/strong`. |
| Bands | `config.bands?: [{id,y,h,background}]`, background solid / gradient / image (`images/` key, `dim?: none/light/dark`). NOT blocks. `lib/storefront/backdrop.ts` (`bandBehind`, `backdropHex`). |
| Fine placement | `fine?: {left?,right?,top?,bottom?: true}` on text, shape and button blocks: half-cell INSETS of the block's own cells. `blockFine(block)`. |
| Links | `LinkTarget`: product (must be on this board) / storefront / band / url (https). |
| Button | new block `{type:"button",id,label,link,look?,fine?}`. Stub face: `ButtonTileContent.tsx`. |
| Header | `header.logo?: {key,alt?,size?}`, `header.links?: [{label,link}]` (max 4). |
| Marquee | new block `{type:"marquee",id,text,speed?,variant?,color?}`. Stub: `MarqueeTileContent.tsx`. |
| Carousel | new block `{type:"carousel",id,productIds}`. Stub: `CarouselTileContent.tsx`. `boardProductIds(blocks)`. |
| New storefronts | `NEW_STOREFRONT_THEME`, `newStorefrontConfig()`. |

Shared seams already in place:

- `BlockFace` dispatches the three new kinds to their stub faces and takes a
  `backdrop?: string` prop (the hex the block is read against), which it
  hands to the text, button and marquee faces. A face with no color of its own
  picks an ink that reads on it (WCAG AA). Absent = keep today's ink.
- COLOR FIELD NAMING: a color is strict `#rrggbb` in a field named `color`,
  `accent`, `from`, `via`, `to` or ending in `Color`. The palette recolors by
  that rule.
- The contract test `tests/unit/storefront/editor-upgrade-contract.test.ts`
  pins all of it. It must keep passing.

## Who owns what

You may freely change files you own, and create new files (prefer new modules
in your own area). In a file someone else owns, and in the shared entry points,
make HOOKS ONLY: an import and the few lines that call into your own module.

| Owner | Files |
| --- | --- |
| 1 Photo cards | `ProductTileContent.tsx`, `ImageTileContent.tsx`, `config-maps.ts`, `CardsSection.tsx`, `CardStyleControls.tsx`, `ChipScaleControl.tsx`, `PriceTag*.tsx`, `ProductBlockEditor.tsx`, `ImageBlockEditor.tsx`, `TileImageFramer.tsx`, new `lib/storefront/photo-edge.ts`, shadows for cards, images AND shapes |
| 2 Type, color, text | `lib/theme/**` (except `font-roles.ts` signatures), `lib/storefront/palette.ts`, `lib/storefront/text-styles.ts`, `src/app/fonts/**`, `ColorPanel.tsx`, `ui/ColorPicker*`, `ThemePanel.tsx`, `LooksSection.tsx`, `TypographySection.tsx`, `TextTileContent.tsx`, `TextBlockEditor.tsx`, `TextFormatControls.tsx`, `TextSpacingFields.tsx`, `FontSizeField.tsx`, `CustomFontFace.tsx`, `useAutoFitTextSize.ts` |
| 3 Layout, navigation | `components/grid/**`, `StorefrontBoard.tsx`, `StorefrontPageView.tsx`, `EmbedFrameView.tsx`, `DesignerCanvas.tsx`, `BlockTile.tsx`, `StorefrontMasthead.tsx`, `HeaderSection.tsx`, `LayoutSection.tsx`, `lib/storefront/mobile-layout.ts`, `phone-grid.ts`, `lib/storefront/storefront-page.ts`, `types/storefront-page.ts`, `ButtonTileContent.tsx`, `lib/storefront/backdrop.ts`, new `lib/storefront/bands.ts`, `lib/storefront/links.ts` |
| 4 Motion, finish | `BackgroundEditor.tsx`, `background-presets.ts`, `ShapeTileContent.tsx`, `ShapeBlockEditor.tsx`, `shape-*.ts`, `MarqueeTileContent.tsx`, `CarouselTileContent.tsx`, new motion, texture and gradient modules |
| 5 Agent tooling | `src/lib/agent/**`, `lib/storefront/design-ops.ts`, `src/app/api/uploads/font/**` and the font upload pipeline, `lib/r2.ts`, the agent preview pages and components, `docs/mcp.md`, `docs/mcp-apps.md`, `tests/unit/agent/**`, `tests/unit/storefront/design-ops.test.ts` |
| Orchestrator | `src/types/storefront.ts`, `src/lib/validation/storefront.ts`, `src/i18n/scopes.ts`, `messages/*/index.ts`, `messages/*/storefront.json`, `messages/*/validation.json`, `lib/storefront/setting-ref.ts`, `editor-search.ts` |

SHARED ENTRY POINTS (everyone hooks, nobody rewrites): `StorefrontDesigner.tsx`,
`ControlsPanel.tsx`, `BlockFace.tsx`, `LibraryPanel.tsx`, `ShapesPanel.tsx`,
`SelectionToolbar.tsx`, `lib/storefront/actions.ts`, `src/app/layout.tsx`,
`src/app/globals.css`, `next.config.ts`, `sample.ts`.

Hook rules, so five branches merge:

- Never reformat, reorder or re-indent a line you are not changing. Never run
  a formatter over a shared file.
- Add an import on its own line; add to `globals.css` only at the END, under a
  comment naming your workstream.
- Keep the hook thin: the logic lives in your module, the shared file gets the
  call. If your hook needs more than about 15 lines in one shared file, the
  design is wrong: move the logic out.
- KEEP EACH FILE'S LINE ENDINGS. This repo mixes CRLF and LF files. The Edit
  tool preserves them; a scripted rewrite must too. A whole-file diff of line
  endings makes a branch unmergeable.
- Do not add editor-search entries (`setting-ref.ts`, `editor-search.ts`):
  list the controls you added in your report instead.
- The other agents are adding hooks to the same shared files right now. You
  cannot see their work. Do not import from a module the contract does not
  list as existing: if you need another workstream's piece, use the seam the
  contract gives you (`fontRoleStyle`, `resolveTextStyle`, `derivePalette`,
  `backdrop`, `blockFine`, `boardProductIds`) and note the dependency.

## Copy

- Your workstream has its own catalog in every locale, already wired:
  `messages/<locale>/editorCards.json` (1), `editorType.json` (2),
  `editorLayout.json` (3), `editorFinish.json` (4). Namespaces `EditorCards`,
  `EditorType`, `EditorLayout`, `EditorFinish`. Agent 5's tool text is English
  in code, as the rest of the MCP's is.
- Two halves: `panel` (the editor's words; shipped to the editor only) and
  `board` (anything a BUYER can read or hear, such as an arrow's label;
  shipped to the public pages). A buyer-facing string outside `board` fails
  `tests/unit/i18n-client-scopes.test.ts`.
- Write all ten locales, as real translations (not English copies), same keys
  in each. `tests/unit/i18n-messages.test.ts` checks parity.
- Reuse an existing key where the meaning is the same. Do not edit the other
  catalogs; if you truly need a key in one, ask in your report.
- Sentence case, plain words, no em dashes anywhere (UI, comments, commits).

## Running things on this machine (read carefully)

The machine is shared with other sessions and has little free memory. It has
crashed before from parallel test and dev-server runs. These rules are not
optional.

- Work ONLY inside your worktree. Start EVERY shell command with
  `cd /c/dev/sq-ed-N && ` (your shell starts in another tree that other people
  are editing). Never read from, write to or run anything in
  `C:\Squareshare\Store`.
- Never run `git stash`, `git worktree`, `git checkout <other branch>`,
  `git push`, `pnpm install`, `pnpm exec`, `pnpm dev`, `pnpm build` or
  `next build`. Dependencies are installed. Call tools as
  `./node_modules/.bin/<tool>`. Do not add or upgrade a dependency without
  writing why in your report (and never one that is not permissively licensed).
- HEAVY COMMANDS go through the lock (two run at once across all agents):
  `cd /c/dev/sq-ed-N && bash /c/dev/sq-ed-tools/heavy.sh ./node_modules/.bin/tsc --noEmit`
  (about 100 s cold, faster after), the same for `eslint <files>` and
  `vitest run --project unit <files>`. Give the Bash call a 10 minute timeout.
  Exit 75 means every slot was busy: do something else and try again.
- Test ONLY the files you touched plus the contract test. Never run the whole
  suite, never the `db` project (it cannot start here), never Playwright's own
  runner.
- NO dev server of your own. To look at your work, use the one shared slot:
  `cd /c/dev/sq-ed-N && bash /c/dev/sq-ed-tools/devshot.sh <your port> shot "/dev/editor-<name>?x=1|shot-name|1280x900|full" "/dev/editor-<name>|phone|390x844|full"`
  It starts your worktree's dev server, takes the pictures into
  `/c/dev/sq-ed-tools/shots/sq-ed-N/`, and stops the server. Read the PNGs with
  the Read tool. For clicks and typing use
  `... devshot.sh <port> run <your-script.mjs>` (it gets `BASE_URL` and
  `SHOT_DIR`; `playwright` resolves from your worktree). One call takes one to
  three minutes; batch your pictures into few calls, and expect to wait for
  the slot. Open ONLY `/dev/*` pages: the server has no database credentials
  and must not be signed in to.
- BUILD A DEV GALLERY for your workstream: `src/app/dev/editor-<name>/page.dev.tsx`
  (copy the shape of `src/app/dev/embed-frame/page.dev.tsx`: sample
  storefront, no database, options from the query string, `notFound()` in
  production). It must show every feature you ship on a real board at desktop
  and phone width, in grid and freeform, plus one legacy board with none of
  your fields. It is how you check your work and how the orchestrator and the
  owner will judge it. Name: `editor-cards`, `editor-type`, `editor-layout`,
  `editor-finish`, `editor-mcp` (optional for 5).
- Known and not yours: `tests/unit` has pre-existing noise from jsdom
  ("Not implemented: getContext"). A failure in a file you did not touch is
  reported, not fixed.

## Definition of done

- `tsc --noEmit` clean, `eslint` clean on every file you touched, your tests
  and the contract test pass.
- New tests for renderer behavior and for anything with rules (pure helpers
  first; component tests with the existing `tests/setup/render.tsx`).
- Works in grid and freeform, desktop and phone layout, hosted page and embed
  frame, designer canvas. All three renderers share the faces; check the
  payload (`buildStorefrontPage`) carries what yours need.
- Text on new card backgrounds, bands and photos meets WCAG AA. Where the
  seller did not choose a color, pick light or dark ink automatically
  (`contrastRatio`, `legibleInkOn`, `readableOn` in `lib/format/color.ts` and
  `product-page-maps.ts`).
- No new third-party runtime request, from any page.
- Nothing moves under `prefers-reduced-motion`; nothing shifts layout.
- Editor strings in all ten locales.
- Committed on your branch in your worktree, in a few sensible commits, with
  messages that say what and why. Do NOT push and do NOT open a pull request:
  the orchestrator integrates the five branches and opens them.
- Priorities: P1 must ship, P2 should ship, P3 only if P1 and P2 are done,
  verified and committed. A solid P1 beats a thin everything. If you run short,
  stop adding and finish what is in.

## Your final report (your last message; it is all the orchestrator sees)

1. Per item: shipped / partly shipped / not shipped, with its P level and one
   line on what a seller now sees.
2. Every shared file you hooked into, with what the hook does (so a merge
   conflict can be resolved by someone who has not read your code).
3. Visible controls you added, per panel, against your budget; what sits
   behind "More"; what is MCP-only.
4. What you verified and how (tests by name, pictures by path), and exactly
   what you could NOT verify.
5. Intended visual changes to existing storefronts, if any.
6. CONTRACT REQUESTS: schema changes you need, exactly.
7. Open decisions for the owner, risks, and anything unfinished.
8. Your branch name and `git log --oneline main..HEAD`.

---

# Workstreams

## 1. Photo cards (worktree `C:\dev\sq-ed-1`, branch `feat/editor-photo-cards`, port 3311, gallery `/dev/editor-cards`)

Why: product photos are white studio shots. On any colored board they look
like white boxes.

- P1 Blend white background. One setting, "Blend white background: Auto / On
  / Off" (`whiteBlend`), theme default and per card. Blending lets the card
  color show through a photo's white so the product sits on the card.
  "Auto" blends only a photo whose edges are near-white. Decide where the
  measurement happens and say why: at render in the browser (a canvas read
  needs the image served with CORS; presigned R2 pixels are cross-origin and
  the bucket's CORS rules are not yours to change, so check before relying on
  it), in the designer (which can write the result to `ProductBlock.photoEdge`
  so buyers' pages blend on first paint with no measuring and no flash), or
  both. There is a same-origin photo route for the signed-in seller
  (`GET /api/products/[id]/photo`). A photo that cannot be measured is left
  alone, never blended on a guess. No database migration.
- P1 Card background color (`cardColor`) from the palette: theme default, per
  card override. Absent = the surfaces cards have today.
- P1 Name strip: `titleBarColor`, `titleTextColor` (absent = an ink that reads
  on the strip, automatically), `titleFont` ("Name font: Headline / Body",
  via `fontRoleStyle`). Size stays automatic.
- P1 Fix: the `shadow` title style turns into a muddy gray blur on bright
  photos. Detect a bright photo edge and switch to a readable treatment
  automatically. No new control.
- P1 Fix: price tags are unreadable with `chipScale: "cell"` at the default
  size, and card names get tiny on small phone cards. Clamp both to a minimum
  readable rendered size (`tileLabelSize`, `titleBandFontStyle`). Consider
  taking `chipScale` out of the UI (keep the field working).
- P2 Photo shape presets (`photoShape`): Rectangle / Rounded / Arch / Circle,
  on cards and on image blocks (`ImageBlock.shape`).
- P2 Shadow presets (`shadow`): None / Soft / Lifted, for cards, images and
  shapes. You own all three, including the small hook in
  `ShapeTileContent.tsx` and `ShapeBlockEditor.tsx` (agent 4 owns those files
  and is adding gradients there). Note that a grid cell clips its content
  (`tileClipStyle`, `blockTileClipStyle`): a shadow has to be drawn where it
  is not clipped away.
- P3 One-click background removal: investigate, and ship only if the library
  license is permissive and it runs in the browser or costs nothing per
  image. The share-card work already evaluated this
  (`src/lib/share-card/cutout/`: ormbg, Apache 2.0, in the browser, weak on
  white-on-white; BiRefNet fails in browsers; RMBG is non-commercial; ISNet is
  AGPL). No paid per-image API. Most likely outcome: a short written
  recommendation in your report.

Budget: whole-storefront panel, 2 visible ("Card color", "Blend white
background", in Product cards > Card style). Product card inspector, 2 visible
(the same two, per card). Image block inspector, 2 visible (shape, shadow).
Shape inspector, 1 visible (shadow; agent 4 has the other). Everything else
(name strip colors, name font, photo shape and shadow for cards) behind
"More" in its section.

## 2. Type, color and text (worktree `C:\dev\sq-ed-2`, branch `feat/editor-type-color`, port 3312, gallery `/dev/editor-type`)

Why: the built-in serif renders like Times New Roman, and every color is typed
as hex by hand.

- P1 Font pairings (`theme.fontPairing`): five named pairings, each a heading
  and a body face. The contract names them editorial, classic, modern, soft,
  studio; the intended faces are Editorial (Fraunces + Inter), Classic
  (Playfair Display + Source Sans 3), Modern (Space Grotesk + Inter), Soft (DM
  Serif Display + DM Sans), Studio (Instrument Serif + Manrope). Verify each is
  OFL-licensed and record the license and source for every file you add (a
  `LICENSES.md` beside the fonts). Self-host: woff2 files in
  `src/app/fonts/`, declared with `next/font/local`, never a font CDN and no
  runtime request to one. Subset to what the ten locales need (Latin and Latin
  Extended: Czech, Polish and Slovak need it). Do not make every page download
  them: a face is fetched only where it is used. Get the files by a method you
  can show is the upstream OFL release (for example the `@fontsource` packages
  from the npm registry as a download source, not as a dependency). Set the
  two role variables (`FONT_ROLE_VARS`) on the board root next to the custom
  font's variables (`storefrontSurface` in `StorefrontBoard.tsx`, the designer
  canvas, the agent preview page, the product page if it inherits the board's
  font). Absent pairing = `theme.font` exactly as today. Existing font enum
  values keep working. The picker shows each pairing by name with a small live
  sample.
- P1 Theme palette (`theme.palette`): a row of five named swatches
  (Background, Text, Accent, Surface, Muted). Every color picker opens on the
  palette first; free hex sits behind "Custom" (`ColorPanel.tsx` is the one
  picker; it has standard colors, palettes, recents and "in this design"
  today, so decide what stays behind Custom). Changing a palette color goes
  through `recolourPalette`, which recolors everything painted in it. Without
  a stored palette the pickers show `derivePalette(theme)`. When a palette is
  stored, the board's ink is the palette's Text color where that reads on the
  background (guard with `contrastRatio`), else the automatic ink as today.
- P1 Saved text styles (`theme.textStyles`): Headline, Subheading, Body, Small
  label, set once for the storefront. A text block picks one (`variant`, now
  with `label`); its own overrides sit behind "More". Render through
  `resolveTextStyle`. Absent styles = today's rendering for the three old
  variants.
- P1 Vertical alignment (`valign`): Top / Middle / Bottom. Absent = middle,
  which is what blocks do today. New text blocks may store nothing.
- P2 The font upload pipeline already exists (`/api/uploads/font`,
  `theme.customFont`, `CustomFontFace`) and belongs to agent 5 this round.
  Yours is only that the Typography section still reads well with pairings
  beside "Your font".

Budget: whole-storefront panel, 2 visible (the palette row in Theme; the
pairing picker in Typography, which should take the place of the single font
select as the first thing shown, with the old font list behind "More").
Text block inspector, 1 visible (vertical alignment; the style picker is the
existing variant control with a fourth option). Text style editing (sizes,
weights per style) behind "More" in Typography.

## 3. Layout and navigation (worktree `C:\dev\sq-ed-3`, branch `feat/editor-layout-nav`, port 3313, gallery `/dev/editor-layout`)

Why: the board always keeps side margins, small elements cannot be placed
precisely, and nothing links anywhere except product cards.

- P1 Full-width band (`config.bands`): a strip behind chosen rows that spans
  the full width of the storefront's container (edge to edge on the hosted
  page, the whole frame in the embed), in a palette color, a palette gradient
  or a photo. Blocks sit on top. On a phone it follows the blocks that sit on
  it, in the reflow AND in an explicit phone layout (`mobile-layout.ts`),
  with no setting. In the designer a band is added from the library, dragged
  by its rows, and edited in a small panel (background only). Pass `backdrop`
  (`backdropHex`) to `BlockFace` from the board and the canvas so words on a
  band pick a readable ink. Put bands, and the signed URL of a band photo,
  into `StorefrontPageData`. A band's `id` is an anchor a link can scroll to.
- P1 Fine placement (`fine`): text, shape and button blocks can sit on half
  cells. The stored rectangle stays whole cells and `fine` insets it by half a
  cell per side, so the block never leaves its cells: draw the face inset
  (every renderer, phone layout included), and make dragging and resizing a
  small text, shape or button block snap to half cells in the designer.
  Product cards stay on the main grid. No new visible control (a "Fine
  placement" toggle only if automatic snapping proves confusing). If
  half-cell dragging cannot be made solid in `Grid.tsx`, ship the rendering
  plus keyboard nudging and say so: the field is then mostly MCP-driven.
- P2 Button block: a label and a destination (a product on this board,
  another storefront of this store, a band on this page, or an https URL).
  Its paint is the storefront's own button (`tileBuyButtonPaint`,
  `resolveTileLook`). An external URL opens in a new tab with
  `rel="noopener noreferrer nofollow"`; inside the embed frame every link
  opens in a new tab (see `tilesOpenNewTab`). A `storefront` target must
  belong to the same store: check it in `saveStorefront` (hook) and build its
  address on the server. Resolve every link's href in the page payload, never
  in the browser from raw ids.
- P2 Header: a logo (`header.logo`, reusing the element upload flow and its
  SVG review, signed in the payload like an image block), up to four menu
  links (`header.links`, same destinations), and a cart icon wherever the
  cart is live (the cart exists: `components/cart/`, `useCart`). Collapses
  sensibly on a phone without a menu the seller must design.

Budget: whole-storefront panel, 0 visible: logo and menu go behind a "Logo
and menu" disclosure in the Header group. Text and shape inspectors, 0 (fine
placement is automatic). The button's own panel: label, destination, look.
The band's own panel: background.

## 4. Motion and finish (worktree `C:\dev\sq-ed-4`, branch `feat/editor-motion-finish`, port 3314, gallery `/dev/editor-finish`)

Why: the board is flat and static. A little texture and motion makes it feel
finished.

- P2 Motion preset (`theme.motion`): None / Subtle (blocks fade in as they
  scroll into view) / Lively (a fade with a slight rise, staggered). CSS
  first; a block holds its place before it is revealed (no layout shift);
  nothing moves under `prefers-reduced-motion`; a board must never be left
  invisible if script fails or the observer never fires (reveal by default,
  hide only once you know you can show). Buyers' pages and the embed frame
  only: the designer canvas stays still. Use the motion tokens
  (`duration-base`, `duration-slow`, `ease-standard`, `ease-entrance`).
- P2 Gradients from the palette: the board background accepts a third stop
  (`via`), and shapes accept a gradient (`ShapeBlock.gradient`). The UI offers
  READY-MADE gradients built from `derivePalette(theme)`, as swatches, never a
  gradient editor. (Band gradients are drawn by agent 3 with the same
  `GradientFill` shape: export your ready-made list and your
  gradient-to-CSS helper from one module so it can be reused.)
- P3 Paper texture (`theme.texture`): Off / Light / Strong, as CSS or inline
  SVG noise. No image fetch.
- P3 Scrolling text strip (`marquee` block): text and a speed (Slow /
  Normal), set in a saved text style (`resolveTextStyle`, `fontRoleStyle`),
  ink from `backdrop` when it has no color. Pauses under the pointer and on
  focus, static under reduced motion, readable by a screen reader once (not
  once per repeat).
- P3 Product carousel (`carousel` block): pick products, swipe on a phone
  (scroll snap), arrows on a desktop. This one reaches the server: a
  carousel's products must be owner-checked in `saveStorefront` exactly like a
  product block's (unknown ids dropped), loaded and gated in
  `buildStorefrontPage` like tiles (drafts, deleted and taken-down products
  never reach a buyer), and counted wherever "products on this storefront" is
  asked (`boardProductIds`; see `lib/storefront/placed-products.ts`). If you
  cannot do all of that soundly, do not ship the block: say so and leave the
  stub.

Budget: whole-storefront panel, 1 visible ("Motion", in Theme). Texture
behind "More". Background gradients extend the existing background control (0
new). Shape inspector, 1 visible (the gradient choice inside its fill
picker). Marquee and carousel have their own small panels.

## 5. Agent tooling, MCP (worktree `C:\dev\sq-ed-5`, branch `feat/editor-mcp`, port 3315)

Why: agents design stores through the MCP, so every feature must be reachable
there, and the preview must be sharp enough to judge.

You build against the CONTRACT, not against the other agents' renderers: a
field the schema accepts is yours to expose even while its drawing is being
written elsewhere.

- P1 Expose every new field and block in `edit_storefront`,
  `save_storefront` and `get_schema`. `get_schema` already carries the
  contract's descriptions; check it reads well as JSON Schema and that every
  new field is there. In `design-ops.ts` add what cannot be done with the
  generic ops: `add_button`, `add_marquee`, `add_carousel`; bands
  (`add_band`, `edit_band`, `remove_band`: a band is not a block); a
  `palette` op that sets one or more palette colors through
  `recolourPalettes` (so the whole design follows); `fine` on move and
  resize for the kinds that allow it; `valign`. New text blocks should start
  from a saved style. Rewrite the `edit_storefront` description so it steers
  an assistant to presets and the palette (set the palette first, take every
  color from it, prefer `fontPairing` to `font`, use text styles) while
  staying well inside what a tool description should cost. `boardSummary`
  should report bands, the palette and the new kinds.
- P1 `preview_storefront`: a full-resolution option and a region zoom (crop
  to a grid area, in cells). Today the desktop picture is 800 px wide (0.625
  scale), too small to judge type and spacing. Keep the existing rate limit
  and the result-size budget (a host drops a view past about 150,000
  characters: see `PICTURE_BUDGET_CHARS` and `docs/mcp-apps.md`; a full
  resolution crop of a region is how both can hold).
- P2 `upload_font` (url or base64) returning an upload id usable as
  `theme.customFont`. The upload route exists (`src/app/api/uploads/font`):
  move its core into one function both the route and the tool call (as
  `lib/uploads/store-element.ts` does for elements), keep its validation
  (woff2, ttf, otf; magic bytes, not the file name; a size cap) and its tests,
  and classify anything new in `tests/unit/agent/registry.test.ts`.
- P2 Existing product photos as artwork: let `add_image` and a band's photo
  background take a product photo of this store directly, so an assistant
  does not re-upload (product image URLs are signed and expire). An image
  block's key must be under `elements/` and a band's under `images/`, so this
  is a server-side copy into the right prefix, owner-checked, never a raw key
  from the assistant.

`docs/mcp.md` explains how tools are added, tested and what must be classified.
What you cannot verify locally (the Worker's Browser binding, a real Claude
host) say plainly; cover the rest with `tests/unit/agent/**` and
`tests/unit/storefront/design-ops.test.ts`.
