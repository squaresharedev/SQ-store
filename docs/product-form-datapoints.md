# Product form datapoints: the machine-readable contract

The product create/edit form publishes its state twice. Once as controls, for a
person, and once as data, for anything that is not one: the MCP surface
described in [agent-surface.md](./agent-surface.md), a browser automation, a
test.

Both come from **one object**, built once per render by
`buildProductFormSnapshot()`
([`src/lib/products/form-datapoints.ts`](../src/lib/products/form-datapoints.ts))
and used for the section summaries, the index rail and the JSON island alike.
That is the point of the design and the only reason to trust the second one:
there is no second computation to drift. It is the same discipline
[analytics-datapoints.md](./analytics-datapoints.md) established.

It is also why the scannability work and the agent work were one change. "Which
sections have anything in them, and what is still missing" is the question a
seller answers by looking and an assistant answers by reading — so it is
computed once and rendered twice.

---

## 1. The snapshot

The whole payload, as JSON, in an inert data island:

```js
JSON.parse(document.getElementById("product-form-snapshot").textContent)
```

```jsonc
{
  "version": 1,                    // bump on any breaking shape change
  "mode": "edit",                  // "create" | "edit"
  "productId": "uuid|null",        // null until the product has been saved once
  "title": "Oak lamp",
  "priceCents": 12900,             // INTEGER CENTS, or null when blank/invalid
  "currency": "EUR",
  "status": "active",              // "active" | "draft"
  "hasDescription": true,
  "descriptionLength": 11,
  "trackStock": true,
  "stockQuantity": 4,              // null when not tracking
  "lowStockThreshold": 5,
  "isDigital": false,
  "hasCoverImage": true,
  "hasDigitalFile": false,
  "purchaseUrl": "https://…|null",
  "shippingProfileId": null,       // null = the store's default terms
  "shippingProfileName": null,     // the profile's name when one is chosen
  "optionGroups": [
    { "id": "…", "name": "Colour", "display": "swatch",
      "optionCount": 3, "unavailableCount": 1 }
  ],
  "optionCount": 3,
  "galleryCount": 4,
  "galleryTiedCount": 2,           // photos tied to one option
  "documentLabels": ["CE Certificate"],
  "documentCount": 1,
  "specs":  { "hasDimensions": true, "hasWeight": false, "hasMaterials": true,
              "hasCare": false, "includedCount": 3, "specCount": 2,
              "hasOrigin": true },
  "safety": { "started": true, "complete": false,
              "hasResponsiblePerson": false, "hasWarnings": true },
  "sections": [
    { "id": "basics", "label": "Basics", "state": "filled",
      "summary": "Oak lamp", "required": true }
  ],
  "requiredMissing": ["price"],    // empty means the form would submit
  "dirty": true,                   // unsaved changes pending
  "generatedAt": "2026-09-03T21:02:53.881Z"
}
```

Three things worth knowing before consuming it:

- **Money is integer cents, always.** `priceCents` is what the database stores.
  The input holds `"129.00"` because that is what a person types; there is no
  float and no currency symbol in this payload, and the currency is its own
  field. Same rule and same reason as
  [agent-surface.md B3](./agent-surface.md).
- **No R2 object key is in it, ever.** Not the cover image, not a gallery
  photo, not a document, and above all not the paid download — `digital_file_key`
  *is* the paywall ([B6](./agent-surface.md)). The snapshot reports counts,
  labels and booleans about those instead (`hasCoverImage`, `galleryCount`,
  `documentLabels`). It is BUILT field by field for exactly this reason, so a
  field added to the form later cannot leak by default.
- **`requiredMissing` is the useful one.** It answers "why can't this save"
  without submitting anything, in the same terms the form uses.

The TypeScript shape is the specification: `ProductFormSnapshot` in
[`form-datapoints.ts`](../src/lib/products/form-datapoints.ts).

---

## 2. Data attributes

For readers that want one control rather than the whole payload.

### Form root

| Attribute | Value |
|---|---|
| `data-product-form` | `create` \| `edit` |
| `data-product-id` | The product's uuid; absent while creating |
| `data-product-form-dirty` | `1` \| `0` |

### Sections

`data-product-section="<id>"` on each card, with
`data-product-section-state` alongside.

The registry entry carries the section's `description`, and that string is what
the "?" beside the heading reveals — the form does not print it. One copy, so
the explanation a person is shown and the one a reader gets from
`PRODUCT_FORM_SECTIONS` cannot drift.

| State | Means |
|---|---|
| `empty` | Nothing filled in. Normal for most sections. |
| `filled` | Has content. `[data-product-section-summary]` says what. |
| `invalid` | Has a problem to fix. Only set after a save was attempted. |

Section ids, in render order:

```
basics  stock  media  options  photos  specs  documents  safety  visibility
```

**`safety` is absent for a download**, in the DOM and in the snapshot alike.
Shipping and product-safety law do not apply to a file, so the form hides the
section rather than storing values nobody will read — do not read its absence
as "empty".

Each section also anchors at `id="product-section-<id>"`, which is what the
index rail links to, so `#product-section-photos` is a valid deep link.

### Fields

`data-product-field="<id>"` on the control itself. Where the rendered value is
not the fact — the price, above all — `data-product-value` carries the fact,
with `data-product-unit` (`currency_cents`, `count`, `measure`) and
`data-product-currency` where it applies. **Read `data-product-value`, never
the rendered text.**

```
title              description        price (+value in cents)   currency
trackStock         stockQuantity      lowStockThreshold
coverImage         digitalFile        purchaseUrl
shippingProfile (+value: a profile id, or "default" for the store's terms)
optionGroups       gallery            documents
length  width  height  dimensionUnit  weight  weightUnit
materials  origin  care  included     spec.<n>.label  spec.<n>.value
safety.manufacturerName     safety.manufacturerAddress
safety.manufacturerEmail    safety.responsibleName
safety.responsibleAddress   safety.responsibleEmail
safety.identifier           safety.warnings
status (+value)
```

A few of these sit on the control's WRAPPER rather than the control:
`currency`, `status`, `dimensionUnit`, `weightUnit`, `shippingProfile`,
`optionGroups` and `gallery`. Several of those (`SegmentedControl`, `Select`)
take a closed set of
props and spread nothing onto the DOM, so an attribute handed to them would be
dropped silently — and a datapoint that is quietly absent is worse than one
that was never claimed. The other two are composite fields with no single
input to hang it on.

### Repeated rows

The option and gallery editors were already addressable and stay so:

| Attribute | On |
|---|---|
| `data-option-group="<groupId>"` | One option group's editor |
| `data-option-row="<optionId>"` | One option within a group |
| `data-gallery-bucket="<optionId>\|general"` | One photo bucket |
| `data-gallery-photo="<localId>"` | One picked or stored photo |
| `data-product-spec-row="<index>"` | One specification row |

### The index rail

`[data-product-form-nav]`, with one `[data-product-form-nav-item="<id>"]` per
section carrying the same `data-product-section-state`. Wide screens only; the
section headers carry the same summaries, so nothing is reachable only here.

---

## 3. What this is not

It is **not a transport**. Everything above is in the DOM of a page a
signed-in seller already has open — it changes the FORMAT of what is on their
screen, never the audience. An MCP still cannot reach any of it without B1
(token auth) and B2 (explicit `account_id`) from
[agent-surface.md](./agent-surface.md).

What it does do is settle the *shape* before the transport exists, and prove it
against a real screen: the agent surface's product read should hand back this
object rather than invent a second one, exactly as `getAnalyticsSnapshot` is
the shape the analytics tool will return.

## 4. Adding a field

1. Add it to `ProductFormStateInput` and `ProductFormSnapshot`, and build it in
   `buildProductFormSnapshot` — **field by field, never a spread**, and never
   an object key (B6).
2. Put `data-product-field="<id>"` on the control. If the control is a shared
   component with a closed prop type, check that it actually spreads onto the
   DOM; if it does not, put the attribute on the wrapper and say why.
3. If it changes what a section holds, extend that section's entry in
   `summarize()` so the header, the rail and the snapshot all move together.
4. Add the id to the list in
   [`tests/component/product-form-datapoints.test.tsx`](../tests/component/product-form-datapoints.test.tsx),
   which asserts the whole contract rather than sampling it — a field losing
   its datapoint is otherwise a silent regression.
