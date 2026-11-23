# The MCP server

Square Share runs a remote MCP server at `https://dashboard.squareshare.eu/mcp`.
A seller adds that one URL to Claude or any other MCP client, approves it once in
the browser, and the assistant can then work on their store.

See [agent-surface.md](./agent-surface.md) for what each datapoint means and what
an assistant must and must not do with it.

## Connecting

1. Add `https://dashboard.squareshare.eu/mcp` as a connector in the client.
2. The client sends the seller to a Square Share page that names the app and where
   its access goes.
3. The seller chooses a store and what the app may do, then presses Connect. That
   is all for an account without 2FA, or one that passed it in the last 10 minutes.
   Otherwise the usual step-up applies: a passkey makes Connect "Confirm with
   passkey" (one press), and only an account with an authenticator app types a code.

Settings > Connected apps lists every connected app, with a Disconnect button.

## How it works

```
client --opaque bearer token--> /mcp
  lib/agent/authenticate.ts     hash lookup: grant, store, scopes, expiry
  lib/agent/context.ts          runAsAgent: identity for everything underneath
  lib/agent/mcp-transport.ts    the only file that knows MCP
  lib/agent/dispatch.ts         scope and role check, budget, secret check, trail
  lib/agent/tools/*             a thin layer over the existing actions and queries
  lib/supabase/server.ts        a 5-minute user JWT, so RLS is still the boundary
```

**Why the actions run unchanged.** `createClient`, `getSessionState` and
`getActiveAccount` look for an agent context first. Inside one, the same action a
browser calls runs with the same validation, publish gate, plan limits and
moderation. There is no second write path to keep in step.

**Why the client holds an opaque token.** A real Supabase JWT would work directly
against the database and ignore every scope. So the client's token is only a
lookup key, stored as its SHA-256, and each request mints its own JWT that goes
from this server to Supabase and nowhere else.

**The signing key** is a dedicated ES256 key imported into Supabase as a STANDBY
signing key. Auth never signs with it, and revoking it stops agent access and
nothing else. It is the Worker secret `AGENT_JWT_SIGNING_KEY`, as a private JWK.
Never press Rotate onto it. A new standby key takes about 10 minutes to be trusted.

## Adding a tool

Add one `defineTool` entry in `src/lib/agent/tools/<domain>.ts`, and list a new
file in `tools/index.ts`:

```ts
defineTool({
  name: "end_sale",
  title: "End a sale",
  description: "End a running sale now.", // written for the model
  scope: "discounts:write",               // a grant must hold this...
  permission: "products.write",           // ...and the person's role must allow this
  annotations: WRITE,                     // READ, WRITE or DESTRUCTIVE
  input: z.strictObject({ id: z.string() }),
  handler: async ({ id }) => unwrap(await endSale(id)),
});
```

The dispatcher does the rest. A new server action fails
`tests/unit/agent/registry.test.ts` until it is classified there as `tool`,
`person`, `browser` or `deferred`, so the surface cannot quietly fall behind.

A new scope is one entry in `src/lib/agent/scopes.ts` plus its copy. The consent
page, the settings page and the OAuth metadata all read that list.

## Rules a tool must follow

- **Build payloads field by field** (`lib/agent/present.ts`). Money is integer
  cents, with the unit in the name.
- **Never return an object key.** `withholdObjectKeys` turns keys into `ref:`
  handles and `restoreObjectKeys` turns them back on a save. A secret check on every
  result refuses anything that slips through.
- **Nothing behind a step-up.** `checkStepUp` always refuses an agent, and a test
  fails if a tool wraps an action that calls it.
- **Buyer-written text is data.** Say so in the description of any tool returning it.
- **Anything that cannot be undone** takes an opt-in scope and `DESTRUCTIVE`.

## Designing a storefront

`edit_storefront` takes a list of small operations (add, move, resize, rotate,
layer, style, remove, theme, header), saved together or not at all, so an assistant
never resends blocks it was not asked about. The rules are pure data in
`lib/storefront/design-ops.ts`; the result goes through `storefrontConfigSchema` and
`saveStorefront` like a save from the designer. `upload_element` stores artwork for
`add_image` through `lib/uploads/store-element.ts`, shared with the upload route.
`save_storefront` remains for renaming and for replacing a whole config member.

The editor upgrade (`docs/editor-upgrade.md`) is reachable two ways. Every
field the schema accepts is a `theme`, `header` or `style` change, and
`get_schema` shows it with its description. What a plain change cannot do has an
operation of its own:

| Operation | Why it is not a plain change |
|---|---|
| `palette` | Sets palette colours through `recolourPalettes`, so everything painted in the old colour follows. Two slots changing at once go through an unused colour first, so a light board turned dark does not merge its ink into its background. A `palette` given in `theme` changes takes the same path. |
| `add_button`, `add_marquee`, `add_carousel` | New block kinds, placed like any other (a marquee and a carousel default to the board's full width; a carousel to 2 rows). `add_carousel` takes `productIds`, this store's products in order, 1 to 12, each once; a `style` change `{productIds}` replaces them. |
| `add_band`, `edit_band`, `remove_band` | A band is not a block. `add_band` takes an optional own `id`, so a button in the same list can link to it. A background change without a `kind` is laid over the band's current one. |
| half cells on `move`, `resize`, `add_*` | Text, shape and button blocks take `x: 2.5, w: 1.5`; design-ops turns that into whole cells plus `fine` insets, and `board.blocks` reports where blocks are drawn in the same half cells. Other kinds and the phone board are refused in words. |

Refused here in words rather than by the schema's one generic sentence: a link to a
product not on the board or a band that does not exist (naming the button or menu
link), a photo key on an image block or artwork on a band (`elements/` against
`images/`), a carousel with no, repeated or more than 12 products, and, in the
tool, a product that is not this store's, a tile's or a carousel's member alike
(the save would drop it without a word). `boardSummary` carries the palette
(stored, or derived and marked `paletteDerived`), the bands, and the new kinds'
labels, links and products. A new text block with no `variant` starts in `heading` for a few words
and `body` for a sentence or more, and carries no size of its own, so it follows
`theme.textStyles`.

Files for a storefront come in as upload ids, never keys:

- `upload_element` (artwork, `lib/uploads/store-element.ts`) and `upload_image`
  (photos, `lib/uploads/store-image.ts`), as before.
- `upload_font` stores a typeface through `lib/uploads/store-font.ts`, the one
  function `/api/uploads/font` also calls: WOFF2, WOFF, TTF or OTF by its bytes,
  2 MB at most, under the uploader's own `fonts/` key. `theme` changes
  `{customFont: {file, name}, font: "custom", fontPairing: null}` use it; the save
  checks it with the same `verifyUpload` a font chosen in the editor gets.
- `copy_product_photo` puts one of the store's product photos on a storefront
  without a re-upload (`lib/agent/product-photo.ts`): the product is read under
  row level security and the store's id, a taken-down or paused one is refused,
  and the photo's bytes are read back from R2 (`getObject`, bounded) and stored
  anew through `storeElement` (as artwork, 2 MB at most) or `storeImage` (as a
  photo, for a band or the board), so the copy is the caller's own upload under
  the prefix its place demands, with that door's own type, size and moderation
  rules. It takes a product id and which photo, never a key or a URL.

`file` is the word everywhere an operation takes one: `add_image`, a band's
background, `header.logo`, `theme.customFont` and an image `theme.background`.
Each is checked to have come through the right door (artwork, photo, font) and
refused in words if not.

Phone layouts (`viewport: "mobile"`, `mobile_reset`, `theme.mobileColumns`) and
`preview_storefront`, which returns screenshots of the real renderer and an MCP
Apps view, are designed in `docs/mcp-apps.md`.

## Not exposed yet

Digital file and document uploads; review CSV import and export;
payments (`getPaymentsOverview`), until Stripe Connect is live.

## Operations

- **Off switch:** `AGENT_ACCESS_ENABLED` in `wrangler.jsonc`. Set to anything but
  `"true"`, `/mcp`, `/oauth/*` and the discovery documents answer 404. Grants are kept.
- **Emergency stop:** revoke the signing key in Supabase: every request fails, and
  nothing else is affected.
- **One seller:** Connected apps, or a password change, sign-out everywhere, or a
  deletion request, each of which revokes all that person's grants.
- **Clean-up:** `.github/workflows/scheduled.yml` calls `/api/cron/agent-cleanup`
  daily for expired tokens, the 90-day trail and apps that were never connected.
- **Protocol:** both 2026-07-28 and the 2025 revisions, through
  `@modelcontextprotocol/server`. Stateless JSON, so GET and DELETE answer 405.
