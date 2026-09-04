# Agent (MCP) surface: what a seller's assistant needs

An audit of every datapoint in the Store app, judged against one question: can
an MCP server expose it to an assistant that helps a creator **set up** and
**run** their shop?

Scope note: there is no MCP server for Store today. The only HTTP surface is
`/api/embed/[key]` (public, buyer-facing), `/api/embed/[key]/signal` (public,
analytics ingest), `/api/uploads/presign`, and
`/api/settings/display-name-available`. This document is the catalogue and the
contract that server has to satisfy — not a description of something shipped.

Update 2026-08-30: the analytics rows below are the first ones with a real
machine-readable shape behind them. `getAnalyticsSnapshot` returns the entire
page as one versioned object, and the page publishes that object verbatim.
See [analytics-datapoints.md](./analytics-datapoints.md). None of that removes
B1/B2 (it is still cookie-scoped and browser-only), but it does mean the
analytics tool has a payload to return rather than one to invent.

Update 2026-09-03: the product create/edit form is the second, and the first on
the WRITE side. Every control carries a `data-product-field`, every section a
state and a summary, and the whole form publishes a versioned
`ProductFormSnapshot` — including `requiredMissing`, which answers "why will
this not save" without submitting anything. See
[product-form-datapoints.md](./product-form-datapoints.md). It observes B3
(integer cents, never the typed decimal) and B6 (no object key of any kind) at
the boundary, so the product-write tool below has a settled input shape to
derive from rather than one to invent. B1/B2 still apply unchanged.

---

## The headline finding

**No datapoint in the app is reachable by an MCP today, and it is not a
per-datapoint problem.** Everything is bound to a browser session:

- **Reads** are Server Component functions (`lib/*/queries.ts`). They call
  `createClient()`, which reads the session out of the Next.js cookie store via
  `cookies()` from `next/headers`. There is no argument to pass a token.
- **Writes** are Next.js Server Actions (`lib/*/actions.ts`). These are not an
  API. They are addressed by a build-generated action id and are only invoked
  through Next's own client protocol.

That second point is not theoretical. During unrelated testing this session the
dev server returned:

```
Failed to find Server Action "60b5cf71fa…". This request might be from an
older or newer deployment.
```

An action id changes when the build changes. Anything holding one — an MCP
server included — breaks on deploy. **Server Actions must never be the agent
transport.** The agent surface has to be its own versioned, token-authenticated
route layer that calls the same underlying query/validation modules.

So the work splits in two: a set of **shared blockers** (fix once, unlock
everything) and a set of **per-datapoint notes** (mostly fine, a few genuinely
unsafe to expose as-is).

---

## Shared blockers

### B1 — Transport and authentication

Needed: a versioned route namespace (`/api/agent/v1/...`) authenticating a
**Bearer token**, not a cookie.

The token must be a scoped, revocable, per-seller credential — not the Supabase
session JWT and not the service-role key. It has to name the account it acts on
and the permissions it carries, so a seller can hand an assistant read-only
access to analytics without also handing it the ability to delete products.

Ownership stays enforced by RLS underneath, exactly as it is now. The token
layer decides *who is calling*; RLS remains the boundary that decides *what
they can touch*. Do not bypass it with the admin client — `/api/embed/[key]`
uses service-role deliberately and documents why; an agent route has a real
user and has no such excuse.

Token scopes should reuse the existing permission map rather than invent a
parallel one. `can(role, "products.write")` already gates the presign route,
and the role→permission map is mirrored in SQL — so an agent token that carries
a role gets the same answers as a human with that role, in both layers, for
free. `/api/uploads/presign` is the closest thing to a model agent route the
app has: Route Handler, permission check, rate limit, Zod-validated body,
non-leaky errors. Copy its shape; swap its cookie auth for a token.

### B2 — Account scoping is a cookie

`getActiveAccount()` ([account-context.ts](../src/lib/team/account-context.ts))
reads `ss_active_account` to decide which store the caller is operating on.
Multi-tenant: a user may be an active team member of several stores.

An MCP has no cookie. **Every agent call must take an explicit `account_id`**,
validated the same way the cookie is today — through the DB-authoritative
`team_actor_role`, falling back to nothing rather than to "your own store". A
silent fallback is correct for a browser (a stale cookie should not break the
page) and dangerous for an agent (a write would land on the wrong store).

Memory of this codebase already records the rule: *every* products / orders /
storefronts query must filter by the active account id explicitly. That applies
unchanged here.

### B3 — Money is inconsistent across the contract

The database stores integer cents (`price_cents`, `amount_cents`,
`platform_fee_cents`). Orders and analytics keep cents all the way out.

But the `Product` contract converts:

```ts
// lib/products/queries.ts
price: row.price_cents / 100,
```

`Product.price` is a float in major units. For a UI that is harmless; for an
agent doing arithmetic, reconciling a product price against an order amount, or
round-tripping a price through an update, it is a correctness hazard.

**The agent surface must emit `price_cents` (integer) and never a float.** Do
not refactor `Product` for this — it is load-bearing across forms, mocks and
tests. Convert at the agent boundary, and state the unit in the field name.

### B4 — Image URLs are short-lived signatures

`Product.imageUrl` is a presigned R2 GET
([r2.ts](../src/lib/r2.ts)) with an expiry, anchored to a time bucket so
repeated renders reuse one signature. It is a rendering detail.

An agent that stores or forwards one is storing a URL that will 403. Either
omit image URLs from agent payloads, or return them alongside an explicit
`expires_at` and document that they are not durable identifiers. Never return
the raw `image_key`: see B6.

### B5 — Payments data is fabricated

`lib/payments/` contains `mock.ts` and `types.ts` and nothing else.
`getBalance`, `getUpcomingPayout`, `listPayouts`, `listBalanceTransactions` and
`getPaymentsOverview` all return invented numbers. No Stripe integration exists.

An assistant reporting a payout date or an available balance would be stating a
fiction as fact, to someone making decisions about their income. **Withhold the
payments datapoints entirely until they are real.** If they must be exposed for
development, the payload needs an explicit `"source": "mock"` that the agent is
instructed to surface — not a footnote in a doc nobody reads at runtime.

### B6 — Three fields must never leave in an agent payload

There is already a precedent to copy. The GDPR export route
([settings/export/route.ts](../src/app/settings/export/route.ts)) selects
explicit columns, never `select("*")`, and documents the exclusions:

- **`embed_key`** — a live credential. It is the embed snippet's authentication;
  leaking it lets anyone serve the storefront payload. Rotatable precisely
  because it is a secret.
- **`digital_file_key`** — the R2 path of the paid product file. This *is* the
  paywall.
- **`image_key`** — infrastructure addressing. The product page's `gallery`
  column holds more of the same (one key per extra photo) and is covered by the
  same rule.

Agent payloads must be **built, not passed through**, for the same reason the
embed route builds its response: a column added later cannot then leak by
default. The hosted product page (`/s/[storefrontId]/p/[productId]`) is the
second live example: `lib/products/public.ts` builds a `ProductPageProduct`
field by field (signed image URLs, a stock *badge*, the download's format but
never its key), and the editor's preview action returns the very same shape, so
what a buyer may see of a product is decided in exactly one function. A future
agent read of a product should reuse that builder rather than write a third.

The embed payload's product blocks now also carry `productUrl` (the hosted
page's absolute URL, absent when the seller has switched product pages off).
The storefront config gained three members for that page: `productPage`
(bounded layout and button options), `policies` (shipping and returns text) and
`seller` (trader identity). **None of these are mirrored into
`@squaresharedev/schemas` yet**: the package was already well behind Store when
they landed, and mirroring one new field into a stale module would make the
contract look current when it is not. Reconcile the whole storefront module in
one pass (see section 3.0), then carry these three across.

### B7 — The generated database types are stale

`src/types/supabase.ts` is the machine-readable contract an agent surface would
be generated from. It is behind the migrations:

| Missing from the generated types | Added by |
|---|---|
| `collections` table | `20260711_curation_foundation.sql` |
| `artifacts` table | `20260711_curation_foundation.sql` |
| `interaction_events` table | `20260720_interaction_events.sql` |
| ~~`storefront_signals` table + `storefront_signals_aggregate`~~, DONE, hand-added alongside `20260830_storefront_signals.sql` | (the discipline this section asks for) |
| `profiles.username`, `profiles.is_public` | `20260711_curation_foundation.sql` |
| `analytics_aggregate`, `dashboard_orders_aggregate`, `product_sales_aggregate`, `products_ranked_by_metric` | `20260802_analytics_sql_aggregates.sql` |
| `profile_is_public` | `20260711_curation_foundation.sql` |

The cost is already being paid. `lib/analytics/queries.ts` has to cast the
client away to call its own aggregate:

```ts
// Untyped rpc: the generated Database types predate these functions.
const { data, error } = await (supabase as SupabaseClient).rpc("analytics_aggregate", …)
```

That cast is the type safety of the single richest agent datapoint being turned
off at the exact point it matters.

Worth fixing before anything is generated from it, not after. A stale contract
does not fail loudly — it silently omits whole feature areas, and an agent built
from it would report "you have no collections" to someone who has twenty.
Regenerate with `supabase gen types`, and treat regeneration as part of writing
a migration rather than a periodic chore.

(The GDPR export route selects `profiles.username`, which the generated types
do not know about. That works only because the column really is in the
database — the types are what is wrong, not the query.)

### B8 — Bounding and errors

Both are already in good shape and should be reused rather than reinvented:

- **Pagination** — products, orders, storefronts and the team roster all take
  offset/limit and return a `Paginated` envelope.
- **Rate limiting** — `rl_take_key(p_key, ...)` takes an explicit key, so an
  agent token can be budgeted independently of a browser session. Add agent
  entries to `RATE_LIMITS`; an assistant in a loop is a cost event.
- **Errors** — `ActionError` ([errors.ts](../src/lib/errors.ts)) is already the
  right shape: a stable machine code (`permission_denied`, `not_found`,
  `invalid_input`, `rate_limited`, …) plus a human `message` and a required
  `fix`. It is pure data, importable from anywhere, and carries no secrets.
  **Use it verbatim as the MCP error envelope.** The `fix` field is unusually
  valuable to an agent: it is a machine-readable next step.
- **Input validation** — the Zod schemas in `lib/validation/` are the single
  source of truth for what a valid write looks like. Agent tool input schemas
  must be derived from them, not hand-written alongside them, or the two will
  drift.
- **Aggregation already happens in SQL.** `analytics_aggregate`,
  `dashboard_orders_aggregate`, `product_sales_aggregate` and
  `products_ranked_by_metric` compute totals in the database rather than
  pulling rows into the app. That is the difference between an agent asking
  "how did last quarter go" costing one indexed query and costing a full table
  read, so agent analytics tools should call these rather than re-deriving
  anything client-side.

---

## The catalogue

Verdicts:
**Ready** — shape is fine, needs only B1/B2.
**Adapt** — needs a shape change at the boundary.
**Withhold** — must not be exposed yet.

### Setting up the business

| Datapoint | Source | Read / Write | Verdict |
|---|---|---|---|
| Profile: display name, avatar, `is_seller` | `profiles` | R + W (`updateDisplayName`) | Ready |
| Display-name availability | `is_display_name_available` RPC | R | Ready — already a route, already rate limited |
| Tax details: business name, VAT id, country | `profiles` | R + W (`saveTaxInfo`) | Ready |
| Legal acceptance + version | `profiles` | R + W (`acceptLegal`) | Ready — an agent should be able to *report* what is outstanding; accepting terms on a user's behalf is a decision for the product, not the transport |
| Notification preferences | `profiles` | R + W (`saveNotifications`) | Ready |
| Products: create / update / delete | `products` | R + W | **Adapt** — cents not float (B3); no `image_key` / `digital_file_key` (B6). The input shape is settled: `ProductFormSnapshot` ([product-form-datapoints.md](./product-form-datapoints.md)) is what the form itself publishes, already in cents and already key-free, and `requiredMissing` names what blocks a save |
| Product options (the axes a product varies along) | `products.option_groups` | R + W | Ready. `[{id, name, display, options:[{id, name, swatch?, available}]}]`, validated by `optionGroupSchema`. Seller-defined: the group's NAME is the axis ("Colour", "Power output"), so nothing hard-codes colour. Ids are unique across the WHOLE tree, groups included, because a photo tie and the page's `?o=` name an option id with no group beside it. Presentation only — there is deliberately no per-option price or stock, so an agent must never report one |
| Product status draft → active | `products.status` | R + W | Ready — the single highest-value "go live" lever |
| Stock: `track_stock`, quantity, low-stock threshold | `products` | R + W (`updateStockSettings`) | Ready for the **owner**. Public/buyer-facing consumers must go through `PUBLIC_STOCK_SELECT` + `toPublicStockBadge` ([stock/public.ts](../src/lib/stock/public.ts)) — raw counts never leave the server for non-owners |
| Image / digital file upload | `/api/uploads/presign` | W | **Adapt** — a Route Handler, but still cookie-authenticated via `getActiveAccount()`, so B1/B2 apply to it too. It returns an object key; an agent flow needs presign → upload → attach without the key crossing the boundary (B6) |
| Storefronts: create, rename, delete | `storefronts` | R + W | Ready |
| Storefront design config (theme, header, blocks, layout) | `storefronts.config` (JSON) | R + W (`saveStorefront`) | Ready — validated by `lib/validation/storefront.ts`, which is mirrored in the published schemas package. **That package is the canonical contract**; agent edits must validate against it |
| Block rotation | each block's `rotation` on `storefronts.config.blocks[]` | R + W (`saveStorefront`) | Ready. Whole degrees, `ROTATION_MIN`–`ROTATION_MAX` (-180..180), optional: absent = level, and a block turned back to level DROPS the key (write it through `withRotation`, never assign a `0`). `x/y/w/h` stay the UNROTATED rect; the cells a turned block covers are its **footprint** (`blockFootprint`), derived and never stored: the same rect TRANSPOSED about the same centre when the angle is nearer a quarter turn than to level, so a quarter-turned 1x3 bar covers 3x1. A turn never changes how many cells a block takes and never moves it, at any angle, so turning it back restores the original block exactly. Ask `blockFootprint` for "where is it" and `x/y/w/h` for "how big is it". The schema checks the stored rect against the canvas; a turned block's footprint may hang past the edge and that is left alone. Ignored by carousel display mode, like coordinates are |
| Blocks sharing cells | `storefronts.config.blocks[]` | R + W (`saveStorefront`) | Ready, and a CHANGE: blocks may now overlap. Stacking is a design move (a word over a shape, a chip over a photo) and `z` settles which paints on top, so the old "blocks cannot overlap" refinement is gone from the schema. An agent may place blocks on the same cells deliberately; `blocksOverlap` answers whether two do (footprints, so a tilted block counts where it paints), and `isFreelyArranged` answers whether a board has any tilt or stack on it, which is what tells a renderer not to repack it for a narrow screen |
| Block layering | each block's `z` on `storefronts.config.blocks[]` | R + W (`saveStorefront`) | Ready. Paint order, 0 (furthest back) to `MAX_BLOCKS - 1`, optional: absent = the block has never been layered and paints in reading order. VISUAL ONLY, and specifically NOT reading order: DOM order, the embed array's order and the carousel all stay `readingOrder`, so stacking never changes what a screen reader hears first. Write it through `lib/storefront/layers.ts` (`normalizeLayers` is the one writer): every operation rewrites `z` on the WHOLE board so it stays dense, since a half-layered board has no total order. Duplicate or gapped values still parse and still have a defined order (`layerOrder` breaks ties on reading index), so an agent never has to repair one |
| Price tag appearance | `storefronts.config.theme.priceTag*` + each product block's `style` | R + W (`saveStorefront`) | Ready. Seven addressable fields rather than presets: `priceTagFont` (`PRICE_TAG_FONTS`), `priceTagSize` / `priceTagBorderWidth` / `priceTagRadius` (bounded ints, see `PRICE_TAG_SIZE_MIN`–`MAX`, `PRICE_TAG_BORDER_WIDTH_MAX`, `PRICE_TAG_RADIUS_MAX`), and `priceTagColor` / `priceTagTextColor` / `priceTagBorderColor` (strict `#rrggbb`). All optional at both levels: absent = the coded default (`PRICE_TAG_*_DEFAULT`, `defaultPriceTagFill`) on the theme and "follow the theme" on a tile. The retired `priceTagStyle` (plain/pill) and enum `priceTagSize` (sm/md/lg) are migrated on parse, so an agent never has to write them |
| Embed enabled + domain allowlist | `storefronts` | R + W (`updateEmbedSettings`) | Ready |
| Embed snippet / `embed_key` | `storefronts.embed_key` | R + W (`rotateEmbedKey`) | **Withhold the key** (B6). Expose "embedding is on/off", the allowlist, and the ability to *rotate*; never the value |
| Team roster, roles, pending invites | `team_roster`, `team_my_pending_invites` RPCs | R | Ready |
| Invite / change role / revoke | `team_members` | W | Ready — already rate limited (`teamInvite`, `teamMembership`) and role-gated |
| Accessible accounts (which stores I can act on) | `team_my_accounts` RPC | R | **Required** — this is how an agent discovers valid `account_id` values for B2 |

### Running the business

| Datapoint | Source | Read / Write | Verdict |
|---|---|---|---|
| Orders list: filter by status / channel / date, search buyer, sort, paginate | `listOrders` | R | Ready — cents throughout, typed enums, offset pagination |
| Order detail: amount, platform fee, currency, channel, status, buyer email, timestamp | `orders` | R | Ready. Buyer email is personal data — a read-only assistant should have it only if the seller granted that scope |
| Dashboard metrics: revenue / sales / AOV windows, trends, refunded + disputed counts | `getDashboardOrders` | R | Ready |
| Analytics totals: revenue, sales, AOV, fees, net, unique + repeat buyers, refunds, range days | `getAnalytics` | R | Ready — the richest single datapoint for "how is my business doing" |
| The WHOLE analytics page in one object (sales + signals + resolved range + currency) | `getAnalyticsSnapshot` | R | **Ready, and the one to build the agent tool on.** Already the exact payload the page renders and publishes as JSON (see [analytics-datapoints.md](./analytics-datapoints.md)), so an agent and a person cannot be told different numbers |
| Storefront views / product clicks / email signups / bookings, per kind: totals, distinct visitors, trend, channel mix, weekday mix, per-storefront ranking | `getSignals` | R | Ready. Note the `available` flag and the per-source `awaiting` state: a kind with no producer yet must be reported as NOT MEASURED, never as zero. Conflating those tells a seller their signup form is broken when it was never built |
| Non-order event stream (raw rows) | `storefront_signals` |, | **Withhold.** Aggregates only, like `interaction_events`. The table holds a salted visitor digest whose whole justification is that it never leaves as a row; there is no agent question that the aggregate above cannot answer |
| Revenue trend over time | `getAnalytics` | R | Ready |
| Channel mix (embed vs marketplace) | `getAnalytics` | R | Ready |
| Top products by revenue | `getAnalytics` | R | Ready — uses the order's `product_title` snapshot, so it survives renames and deletes |
| Sales by weekday | `getAnalytics` | R | Ready |
| Order status mix | `getAnalytics` | R | Ready |
| Products summary: total, **products missing an image** | `getProductsSummary` | R | Ready — a concrete "fix this" the assistant can act on |
| Per-product sales rollup + best seller | `getProductSales` | R | Ready |
| Low-stock products | derived from `products` | R | Ready — should be a first-class agent query, not something the agent recomputes |
| Notifications: unread count, page, mark read | `notifications` | R + W | Ready. `getRealtimeToken` is browser-only; an agent polls |
| Realtime subscription | Supabase Realtime | — | **Withhold** — needs `setAuth(token)` under HttpOnly cookies and is a browser concern |
| Full account export | `/settings/export` | R | Ready as a *model*, not a tool — it is deliberately the most expensive read in the app and rate limited for that reason. An agent should use the targeted reads above |
| Balance, upcoming payout, payouts, transactions | `lib/payments/mock.ts` | R | **Withhold** (B5) — fabricated |

### Adjacent: the curation layer (SQ-app, same database)

Three tables live in this database but belong to the curation/discovery app,
not the Store dashboard. They are the same person's account, so an assistant
helping "run the business" will be asked about them — worth deciding
deliberately rather than discovering them later.

| Datapoint | Source | Read / Write | Verdict |
|---|---|---|---|
| Profile `username`, `is_public` | `profiles` | R + W | Ready — the public identity behind a creator's discovery presence |
| Collections: name, public flag, sort order | `collections` | R + W | Ready — owner-scoped RLS, clean shape. Not in the generated types (B7) |
| Artifacts: title, description, grid placement, focal point, optional `product_id` link | `artifacts` | R + W | **Adapt** — `image_key` must not cross the boundary (B6). Note `product_id`: the dormant bridge between a curated artifact and a real product, which is exactly the join an assistant would want for "turn this into something I sell" |
| Behavioural event log: impressions, clicks, dwell, likes, follows, saves, purchases, reports | `interaction_events` | — | **Withhold, permanently.** RLS is enabled with *zero policies* and all privileges are revoked from `anon` and `authenticated` — it is deliberately unreadable by any client-facing role, service-role writes only. Reports in particular must never be client-readable. An agent token is a client. Do not add a policy to make this reachable |

Aggregated engagement (view counts, likes per artifact) would be a genuinely
useful "run the business" datapoint, but it has to arrive as a purpose-built
aggregate with its own privacy review — not by opening up the raw event log.

---

## What an assistant can actually do with this

Worth stating, because it is the test of whether the catalogue is the right one.

**Setting up.** Read the profile and products to find what is missing, then
close the gaps: products with no image (`getProductsSummary` names them), drafts
never activated, no storefront created, embedding never switched on, tax details
blank, legal terms unaccepted. Most of a creator's stall between "signed up" and
"selling" is a checklist, and every item on it is a datapoint above.

**Running it.** Analytics answers "how am I doing" without the seller opening a
dashboard: revenue and its trend, AOV, fees against net, repeat-buyer share,
which products earn, which channel pays. Orders answers "what happened". Stock
and low-stock answer "what breaks next". Notifications answer "what needs me".

**The gap.** With payments withheld, the assistant cannot answer "when do I get
paid" — the single most common question a creator has. That is B5, and it is a
product gap rather than a transport one.

---

## Order of work

0. **B7** — regenerate the database types. Cheap, and everything downstream is
   generated from them; doing it after the fact means auditing what was missed.
1. **B1 + B2** — token auth and explicit `account_id`. Nothing else matters
   until an MCP can make one authenticated, correctly-scoped call.
2. **B6** — the exclusion list, enforced by building payloads explicitly, before
   any payload ships.
3. **Reads first.** Analytics, orders, products, stock and the setup checklist
   deliver most of the value and cannot damage a shop.
4. **B3 + B4** at the boundary as the product reads go out.
5. **Writes**, narrowest first: product status and stock, then product edits,
   then storefront config. Every one already has a Zod schema and an RLS
   boundary; reuse both rather than writing a second validation path.
6. **B5** when payments are real.
