# Analytics datapoints: the machine-readable contract

The `/analytics` page publishes its figures twice. Once as pixels, for a
person, and once as data, for anything that is not one: the MCP surface
described in [agent-surface.md](./agent-surface.md), a browser automation, a
test.

Both come from **one object**, built once per request by
`getAnalyticsSnapshot()` and passed straight to the renderer. That is the point
of the design and the only reason to trust the second one: there is no second
computation to drift.

---

## 1. The snapshot

The whole payload, as JSON, in an inert data island:

```js
JSON.parse(document.getElementById("analytics-snapshot").textContent)
```

```jsonc
{
  "version": 1,                      // bump on any breaking shape change
  "range": { "from": "2026-08-01", "to": "2026-08-30", "preset": "30d" },
  "currency": "EUR",                 // every *Cents field below is in this
  "sales":   { /* AnalyticsData */ },
  "signals": { /* SignalsData   */ },
  "generatedAt": "2026-08-30T17:12:04.881Z"
}
```

Three things worth knowing before consuming it:

- **`range` is RESOLVED, never the raw URL params.** A preset's open upper
  bound is filled in with the day the page was rendered, because a figure
  without the window it covers cannot be read back later.
- **Money is integer cents, everywhere, always.** `revenueCents`, `aovCents`,
  `valueCents`. There is no float in this payload and no currency symbol; the
  unit is named in the field and the currency is `snapshot.currency`. This is
  the same rule the database keeps, and the reason the boundary keeps it is
  [agent-surface.md B3](./agent-surface.md).
- **Nothing private is in it.** Aggregates only: no buyer emails, no order
  rows, no embed keys, no visitor digests. Everything in it is already on the
  screen for the same signed-in reader. Anything added to `AnalyticsSnapshot`
  inherits that rule.

The TypeScript shapes are the specification:
[`src/lib/analytics/types.ts`](../src/lib/analytics/types.ts).

---

## 2. Data attributes

For readers that want one number rather than the whole payload, every figure on
the page is addressable without matching on a heading string.

### Page root

| Attribute | Value |
|---|---|
| `data-analytics-range-from` | ISO date, or empty for all-time |
| `data-analytics-range-to` | ISO date |
| `data-analytics-range-preset` | `30d` \| `all` \| `custom` |
| `data-analytics-currency` | ISO currency of every cents figure |

### Sections

One per source: `data-analytics-section="<id>"`, where the id is `sales` or a
signal kind (`storefront_view`, `product_click`, `email_signup`, `booking`,
`product_view`).

**A section is absent when the seller does not run that source.** Registered is
not the same as relevant: a source appears only if it has a live producer, or
this account has ever recorded it, or the block that feeds it is on one of
their storefronts (`isSourceRelevant`). So do not read a missing section as
"zero" — read it as "not this seller's". `signals.everRecorded` and
`signals.activeBlockTypes` in the snapshot are the inputs to that decision, and
are there so a consumer can reach the same verdict.

`data-analytics-state` is the one to branch on for a section that IS present:

| State | Means |
|---|---|
| `live` | Real figures. May legitimately be zero for the range. |
| `awaiting` | The block is placed, but nothing has produced data yet. **No value is published.** |
| `unavailable` | The read failed. Do not report zero. |

The distinction is the whole reason the attribute exists: "nobody signed up"
and "signups are not being counted" are different answers, and an assistant
that conflates them tells a seller their form is not working when it was never
wired up.

### Metric tiles

| Attribute | Value |
|---|---|
| `data-analytics-metric` | Stable id, e.g. `sales.revenue`, `storefront_view.count` |
| `data-analytics-value` | The RAW figure. **Absent when the metric is awaiting.** |
| `data-analytics-unit` | `currency_cents` \| `count` \| `percent` \| `days` |
| `data-analytics-currency` | Present for `currency_cents` |
| `data-analytics-source` | The section this belongs to |
| `data-analytics-state` | `live` \| `awaiting` |

Read `data-analytics-value`, never the rendered text. `€1,204.50` is a string
with a locale and a symbol baked into it; `120450` is a fact. (The rendered
text also animates on mount, so it is briefly wrong on purpose.)

Current metric ids:

```
sales.revenue          currency_cents
sales.count            count
sales.aov              currency_cents
sales.unique_buyers    count
sales.refund_rate      percent          full precision, not the rounded display
sales.fees             currency_cents

<kind>.count            count
<kind>.unique_visitors  count
<kind>.value            currency_cents   money-carrying kinds only
```

### Chart cards

`data-analytics-panel` (`trend`, `channels`, `weekdays`, `storefronts`, `aov`,
`top_products`, `statuses`) plus `data-analytics-source`, and the same
`data-analytics-state` with an extra `empty` for "measured, nothing in range".

Charts also render an `sr-only` table twin carrying every plotted value, so the
series are reachable without parsing SVG. Prefer the snapshot.

### Colour

Not decoration, and worth knowing if you are describing a chart to someone.
Three roles, pinned in [`palette.ts`](../src/components/analytics/palette.ts):
**green is money** (revenue, order value, the paid state), **red is money
lost** (refunds, and nothing else), **blue is traffic** (views, clicks, and the
other counts that are activity rather than income). Everything neither good nor
bad, a pending order, a channel split, stays neutral ink and grey.

---

## 3. Adding a source

The page renders from a registry, so a new measurable surface is not a screen.
In order:

1. Add the kind to `SIGNAL_KINDS`
   ([`signals.ts`](../src/lib/analytics/signals.ts)) **and** to the `kind` CHECK
   in the migration. Both, in one change: a kind in only one of them fails the
   insert at runtime, and the write path is best-effort, so it fails silently.
2. Add an entry to `SIGNAL_SOURCES`
   ([`sources.ts`](../src/lib/analytics/sources.ts)) with `awaiting` set to
   what will ship it, and `blockType` set to the `StorefrontBlock["type"]` that
   produces it. The block type is what makes the section appear for the sellers
   who have adopted the feature and stay hidden for everyone else, so a source
   without one is invisible until its first row lands.
3. Write the producer. Server-side, through `recordSignal()`
   ([`record.ts`](../src/lib/analytics/record.ts)) so it inherits the dedupe,
   the privacy rules and the never-break-the-caller behaviour. A conversion
   should be recorded next to the row it creates, not by the browser.
4. Drop `awaiting` once the producer is live.

Steps 2 and 4 are one line each, and nothing else changes: the aggregate groups
by kind, the query layer zero-fills by kind, and `SignalSection` renders any
source it is given. Step 4 is not even load-bearing for correctness, only for
copy: `resolveSourceState()` promotes any source with rows to `live` on its
own, so the section fills in the moment the first row lands.

What does NOT belong here: sales. Orders carry money, refunds, a buyer identity
and a status lifecycle, and they are the system of record for getting paid.
Duplicating them into the signal stream would create two answers to "how much
did I earn".

---

## 4. Where the numbers come from

| Source | Producer | Status |
|---|---|---|
| `sales` | The orders table, via `analytics_aggregate` | live |
| `storefront_view` | `GET /api/embed/[key]` serving a payload to an allowed origin | live |
| `product_click` | `POST /api/embed/[key]/signal` from the embed widget | route live, widget pending |
| `product_view` | the hosted product page (`/s/[storefrontId]/p/[productId]`) serving a buyer, recorded server-side after the response | live |
| `email_signup` | The email signup block's server handler | not built |
| `booking` | The calendar booking block's server handler | not built |

Two caveats a consumer should carry:

- **Views are deduped to one per visitor per storefront per hour**, so the
  figure is a visit rather than a raw payload fetch.
- **Views undercount.** The embed response is CDN-cacheable for five minutes,
  and a cached hit never reaches the server. The bias is downward, which is the
  safe direction for a number someone makes decisions on.
