# MCP Apps and phone layouts: design

How an assistant connected over MCP can see what it builds and lay a storefront
out for phones. The tools themselves are in `docs/mcp.md`.

## 1. How a storefront is drawn on a phone today

The public board (`components/storefront-page/StorefrontBoard`, used by the hosted
page `/s/[id]` and the embed frame) draws through the shared grid
(`components/grid/Grid`). The grid measures its own width and works out how many
columns fit at a readable cell size: 72 px per cell plus the gap
(`columnsThatFit`). Three things can then happen:

| Board | On a 390 px phone (about 358 px of board) |
|---|---|
| Fits (3 columns at gap 8) | Drawn as designed |
| Too wide, level, nothing stacked | **Reflowed** (`reflowBlocks`): blocks taken in reading order, spans scaled by the column ratio, repacked first-fit. A 6-column board becomes 4 columns. Coordinates are lost |
| Any block tilted or stacked (`isFreelyArranged`) | **Not reflowed**: the whole board shrinks (`responsive={false}`), so cells can get very small |

Nothing in the config described the phone, so neither a seller nor an assistant
had any say in it, and an assistant could not even read where things landed.
"The Fireside Edit" (9 blocks, three tilted) is in the third row: on a phone it
is the desktop board at about a third of the size.

## 2. Phone layout: the schema change

**Chosen: optional per-block overrides plus a phone width.**

```ts
theme.mobileColumns?: 2..6           // absent = today's behaviour, unchanged
block.mobile?: { x, y, w, h, hidden? } // bounded ints, the phone board's own cells
```

- With `mobileColumns` set, below 640 px of board (`MOBILE_LAYOUT_MAX_WIDTH_PX`)
  the board is drawn from its phone layout (`lib/storefront/mobile-layout.ts`):
  a block with `mobile` is pinned there, one with `mobile.hidden` is left off
  phones, and **every other block is placed automatically** around the pinned
  ones, in reading order, the way the reflow places blocks. So an assistant can
  pin one hero tile and let the rest follow.
- Tilt and paint order are kept on the phone. The phone layout also applies to
  tilted boards, which until now could only shrink.
- Validation is in `lib/validation/storefront.ts`: strict objects, bounded
  integers, and a config-level rule that a pinned block fits the phone width.
  Rects are kept (inert) when `mobileColumns` is removed, so turning the phone
  layout off and on again is lossless.
- **No migration and no stored data touched.** Every existing board parses
  byte-identical (a unit test pins this).

| Option | For | Against |
|---|---|---|
| **Per-block `mobile` + `theme.mobileColumns`** (chosen) | One block list, so a product is still on the board once; deleting a block deletes it everywhere; partial layouts are natural (pin some, auto the rest) | The renderer needs a narrow-layout mode (added to the grid as `narrowLayout`) |
| A separate `mobileBlocks` array | Simple to render | Two copies of every block to keep in step: a product added on desktop is missing on phones, and a delete leaves a ghost. Duplicates the moderation and ownership checks |
| Reflow rules only (order, hide, span) | Smallest change | Cannot express "this tile first and full width" for tilted or stacked boards, which is exactly where the reflow gives up |

The designer's phone preview draws the same layout (`DesignerCanvas` passes
`narrowLayout` too). Hand-editing it in the designer is not built yet: a seller
sees it there, read-only, like a reflowed board.

**MCP:** `edit_storefront` takes `viewport: "mobile"` on `move`, `resize` and
`remove` (which then hides on phones only), plus `mobile_reset`. The first phone
operation starts a phone layout at 4 columns. `theme` changes
`{ mobileColumns: null }` turn it off. Every edit result and `get_storefront` now
carry `board.phone`, which says what a phone draws whether or not there is a phone
layout: `same`, `reflow` (with every block's cells), `scaled`, or `own`.
`get_schema` shows the new fields automatically.

## 3. MCP Apps: architecture

Based on the stable spec **2026-01-26** (`io.modelcontextprotocol/ui`) and SDK
`@modelcontextprotocol/ext-apps` 2.0.4, read directly rather than from memory.

```
Claude ──tools/call preview_storefront──▶ /mcp (Worker)
                                           │ getStorefront under RLS (404 if not this store)
                                           │ mint a 2-minute preview token (grant + storefront)
                                           │ Browser Run quickAction("snapshot") × 2 viewports
                                           ▼
                       /agent-preview/storefront/<id>?t=…  (same Worker)
                       verify token → live grant → act AS the grant (RLS)
                       StorefrontPageView, the buyer's own renderer
                       + PreviewProbe: measures each product tile, sets html[data-preview-ready]
                                           │ JPEG + rendered HTML (with the measurements)
                                           ▼
   result: content = [text JSON, image desktop, image phone]   ← the model reads all of it
           structuredContent = { imageIndex, viewports.tiles, links, notes }  ← the view
   Claude (MCP Apps) ──resources/read ui://square-share/storefront-preview──▶ the view
```

- **Resource:** `ui://square-share/storefront-preview`, `text/html;profile=mcp-app`,
  one self-contained HTML document (`lib/agent/preview/view.ts`). The tool names it
  in `_meta.ui.resourceUri` (and the deprecated flat `ui/resourceUri`, for older
  hosts). The resource is registered only for a grant that can see the tool.
- **CSP:** the view loads nothing: no script, style, font or image from any origin.
  The screenshots arrive in the tool result and are shown as `data:` URLs, which the
  host's restrictive default CSP already allows, so **no `csp` domains are
  declared**. Signed R2 URLs never reach the view; the page Browser Run renders
  loads them on our own origin.
- **postMessage protocol (hand-written, about 10 messages):** `ui/initialize`
  (`appInfo`, `appCapabilities.availableDisplayModes`, `protocolVersion`) then
  `ui/notifications/initialized`; it receives `ui/notifications/tool-result`,
  `tool-cancelled`, `host-context-changed` (theme, style variables),
  `resource-teardown` and `ping`; it sends `ui/notifications/size-changed`,
  `ui/open-link` (product page, designer) and `ui/update-model-context`.
- **Interactivity:** a desktop / phone switch, and every product tile is a target
  measured on the real page. Picking one shows its title, id and status, offers
  its product page when it is public, and offers the designer.
- **Consent:** the view calls no tool. `ui/open-link` goes through the host, which
  may ask the person. The publish card (section 6) will call `update_product` via
  `tools/call`, which the host proxies with its own consent prompt, on top of the
  `products:write` scope the seller granted.
- **Text fallback:** the result is a normal tool result in every host: text JSON
  first (what was taken, notes, where every tile is, the phone summary), then the
  images. A host without MCP Apps ignores `_meta` and shows that. If no picture
  can be taken, the text says which are missing and the view says so.
- **RLS:** the tool reads the storefront under the grant before minting anything,
  so another store's id is `not_found`. The preview page accepts only a valid,
  unexpired token whose grant is still live and holds `store:read`, then reads AS
  that grant. A draft is drawn (it is the owner's own preview) and named in the
  notes, because buyers do not see it.
- **Switches:** `AGENT_PREVIEW_ENABLED` (under `AGENT_ACCESS_ENABLED`) removes the
  tool from every tool list and 404s the preview pages. Previews are rate limited
  to 30 an hour per connection (`agentPreview`).

## 4. Model visibility

MCP Apps does let a view report back (`ui/update-model-context`; the view uses it
to say which tile the seller picked), but hosts **may** ignore it, and it only
starts once the person looks at the view. So the model is given the pictures
directly: **server-side screenshots** from Cloudflare **Browser Run**, through the
Worker's `BROWSER` binding (`quickAction("snapshot")`: screenshot and rendered
HTML in one browser session, no API token, nothing added to the bundle). Desktop
1280×800 and phone 390×844, full length, JPEG quality 80. The model sees the same
pixels the seller sees.

The e2e stack has no Browser Run, so it answers the same request with its own
headless Chromium (`/__test/snapshot` in `tests/e2e/stack/server.mjs`), enabled
only by `AGENT_PREVIEW_TEST_SNAPSHOT_URL`, which a production build never reads.

## 5. Costs and limits

- Each preview is two browser sessions of a few seconds each on Workers Paid
  (billed per browser hour). The 30-per-hour limit bounds a looping assistant.
- Browser Run identifies itself as a bot. If the zone's bot protection ever blocks
  it, previews degrade to words, never to an error.
- A very tall board makes a tall phone picture; Claude accepts up to 8000 px.

## 6. Not built yet (priority order from the brief)

1. ~~`preview_storefront`~~ (built, desktop and phone).
2. `preview_product_page` as a view: the same pipeline with a product page route
   and the existing JSON alongside.
3. **Publish confirmation card:** a view showing the photo, title, price and what
   is missing (photo, GPSR safety information, shipping profile, the store's
   trader details), with a Publish button that calls `update_product`
   (`status: "active"`) through the host's `tools/call` consent.
4. A thumbnail after each `edit_storefront` batch: cheap once the publish card
   exists, but it would spend a browser session per edit, so it should be opt-in
   (`preview: true` on the call).
5. Editing the phone layout by hand in the designer.
