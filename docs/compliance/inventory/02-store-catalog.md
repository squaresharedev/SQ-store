# 02: Store catalog write-path inventory (products, prices, currencies, discounts, storefronts)

Part 2 of 9 of the Czech-only beta compliance inventory. Read-only investigation of `C:\Squareshare\Store` on 2026-11-22 (working tree at `e43eedd`, clean). Nothing was run, built or queried; every claim below comes from reading files on disk.

Notation: `Store/<path>:<line>` is a file in the Store repo. "(inferred)" marks anything I did not open or that rests on outside knowledge (Stripe, Supabase defaults). Ranges are written `a-b`.

---

## 0. Headline findings

1. **CZK is not an allowed currency anywhere today.** The one list is `CURRENCIES = ["EUR", "USD"]` (`Store/src/types/product.ts:12`). The database repeats it in three CHECKs: `products.currency in ('EUR','USD')` with default `'EUR'` (`Store/tests/db/prod-migrations.sql:157`, the replay of prod migration `20260706081631 create_products`), `product_price_history.currency in ('EUR','USD')` (`Store/supabase/migrations/20261004_discounts.sql:253`) and `discounts` amount currency `in ('EUR','USD')` (`Store/supabase/migrations/20261004_discounts.sql:91`). A grep for `CZK|Kč` across `Store/src` finds nothing (one false hit in a font blob, `Store/src/lib/pdf/font-data.ts:35`).
2. **Currency is per product.** It is chosen on every product (`products.currency`), copied onto each order from the order's first line (`Store/src/lib/checkout/quote.ts:273-279`), and set again on each amount-off discount (`discounts.currency`) and on the account's shipping policy (`ratesCurrency`, `Store/src/lib/validation/shipping-policy.ts:79`). No store-level currency setting exists. The default comes from a prediction: the store's most-used recent currency, otherwise the business country, where **only US and CA get USD and every other country, CZ included, gets EUR** (`Store/src/lib/predictions.ts:248-257`, `:266`).
3. **The read side maps any unknown currency to EUR, so CZK would become EUR without any error.** `toCurrency(value) => value === "USD" ? "USD" : "EUR"` (`Store/src/lib/format/money.ts:12-14`), plus an inline copy at `Store/src/lib/products/queries.ts:143`. That mapper sits on the checkout path (`Store/src/lib/checkout/quote.ts:178`, `:254`, `Store/src/lib/products/order-quantity.ts:177`), and the result is what Stripe is told (`Store/src/lib/checkout/stripe-provider.ts:106`, `:138`, `:148`). A CZK row put in the DB without fixing the mapper would be **charged as EUR**. A unit test locks this fallback in place (`Store/tests/unit/format.test.ts:37-38`: `formatCents(500, "XYZ", "en")` is `"€5.00"`).
4. **Some edit paths write a currency they read back through that lossy mapper.** These are the product form's edit mode (initial value from `getProduct`, `Store/src/components/products/ProductForm.tsx:261`), the designer's tile editor (`Store/src/components/storefront/ProductBlockEditor.tsx:219`), and the MCP `update_product` / `publish_products` tools (`Store/src/lib/agent/tools/products.ts:213-218`, `:276-282`). If the allowed write list shrinks to CZK, every edit or MCP publish of a legacy EUR/USD product fails validation until the seller changes its currency, and adding CZK without fixing the mapper would quietly rewrite CZK rows to EUR.
5. **Not every product write goes through the app schema.** Owners and editors may write `products` and `discounts` straight through PostgREST under RLS. Code comments say so directly (`Store/supabase/migrations/20261028_product_add_ons.sql:55-56`, `Store/supabase/migrations/20261105_write_bounds.sql:1-14`). `duplicateProduct` copies the raw row without re-validating it, and the status toggle writes `status` alone. So the DB CHECK is the only guard that covers every writer. A config-driven CZK rule therefore needs a DB-level twin, not just a Zod change.
6. **Fees do not convert currency. Plan pricing and some analytics assume EUR.** The per-sale fee is basis points of the order amount in the order's own currency (`Store/src/lib/pricing/fees.ts:81-112`). Plan prices are EUR-only (`Store/src/lib/billing/plans.ts:39`, seed rows `Store/supabase/migrations/20261011_pricing_config.sql:288-290`). The plan calculator's sales figure counts `currency = 'EUR'` orders only (`Store/supabase/migrations/20261011_pricing_config.sql:690`), so a CZK seller would see 0 sales there. Analytics SQL treats anything that is not `'USD'` as EUR (`Store/supabase/migrations/20260802_analytics_sql_aggregates.sql:23-27`), so CZK revenue would be added up and labelled `€`.
7. **Several limits only make sense in euros.** `MIN_PAYABLE_CENTS = 50` (`Store/src/lib/discounts/pricing.ts:33`), `PRICE_CENTS_MAX = 100_000_000` (`Store/src/lib/validation/product.ts:218-219`, comment "€/$1,000,000"), `SHIPPING_RATE_MAX_CENTS = 100_000` "(€1,000)" (`Store/src/types/shipping-policy.ts:113-115`) and `DISCOUNT_AMOUNT_MAX_CENTS` (`Store/src/types/discount.ts:21-22`) carry no currency. Product price minimum is 1 minor unit (`Store/src/lib/validation/product.ts:477`).

---

## 1. Data model and DB contract (catalog tables)

| Table / column | Definition | Guard today | Source |
|---|---|---|---|
| `products.currency` | `text not null default 'EUR' check (currency in ('EUR','USD'))` | CHECK + default | `Store/tests/db/prod-migrations.sql:157` |
| `products.price_cents` | `integer not null check (price_cents >= 0)` | No max, no min 1 at DB | `Store/tests/db/prod-migrations.sql:156` |
| `products` RLS | select for `store.read`; insert/update/delete for owner or `products.write` (owner, editor) | RLS + restrictive 2FA policy | `Store/tests/db/prod-migrations.sql:909-942`; `Store/supabase/migrations/20260923_two_factor_auth.sql:74-109` |
| `products` triggers | plan limit, account ceiling, object-key ownership, add-on guard, moderation guard, price history | None checks currency or price | `20261002_product_limits.sql:151-153`, `20261105_write_bounds.sql:106-108`, `20261105_object_keys_anywhere.sql:120-122`, `20261028_product_add_ons.sql:60-101`, `20260918_content_moderation.sql:151-153`, `20261004_discounts.sql:285-296` (all `Store/supabase/migrations/`) |
| `products` size checks | title <= 500, description <= 20000 | CHECK | `Store/supabase/migrations/20261105_write_bounds.sql:38-45` |
| `product_price_history.currency` | `check (currency in ('EUR','USD'))`, trigger-fed on insert and on change of `price_cents`/`currency` | CHECK, service role only | `Store/supabase/migrations/20261004_discounts.sql:249-296` |
| `discounts` amount | `value_type='amount'` needs `amount_off_cents between 1 and 100000000` and `currency in ('EUR','USD')`; percent needs `percent_off between 1 and 90` and `currency is null` | CHECK `discounts_value` | `Store/supabase/migrations/20261004_discounts.sql:84-92` |
| `discounts` grants/RLS | `select, insert` + column `update` (incl. `currency`) to authenticated; RLS writer = owner or `products.write`; no delete | grants + RLS + `guard_discount_rules` | `Store/supabase/migrations/20261004_discounts.sql:127-170`, `:178-245` |
| `storefronts` | `config jsonb`, `name`, `embed_key`, moderation columns. **No currency, country or status column** | `storefronts_config_size` CHECK, RLS writer `storefront.write` | `Store/src/types/supabase.ts:2655-2675`; `Store/tests/db/prod-migrations.sql:944-960` |
| `orders.currency` (downstream) | `text not null default 'EUR'`, **no CHECK**; `order_place` does `coalesce(incoming.currency, 'EUR')` | shape only in app (`/^[A-Za-z]{3}$/`) | `Store/tests/db/prod-migrations.sql:301`; `Store/supabase/migrations/20261120_shopping_cart.sql:220`; `Store/src/lib/orders/record.ts:220` |
| `plan_prices.currency` | `text not null default 'EUR'`, shape `^[A-Z]{3}$`; the publish function hard-codes `'EUR'` | CHECK shape | `Store/supabase/migrations/20261011_pricing_config.sql:129`, `:142`, `:264`, `:288-290` |
| `fee_ledger.currency` | copied from the order, shape CHECK | CHECK shape | `Store/supabase/migrations/20261011_pricing_config.sql:540-551`, `:586-617` |

The `products` base table is not in `Store/supabase/migrations/` (the earliest file there is `20260706_*`). Its definition lives only in the hand-curated prod replay `Store/tests/db/prod-migrations.sql` (header `:1-24`). I grepped every `.sql` in Store for `currency_check`, `alter column currency` and `drop constraint .*currency` and found nothing, so the CHECK at `:157` appears unchanged since creation.

---

## 2. Inventory: products

Authz shorthand: **PW** = `getActiveAccount()` + `can(role, "products.write")` (owner and editor, `Store/src/lib/team/permissions.ts:54-66`), backed by RLS `products_*_writer` (`Store/tests/db/prod-migrations.sql:921-942`). **MCP** = OAuth scope + `can(role, tool.permission)` (+ `ownerOnly`) in `Store/src/lib/agent/dispatch.ts:55-61`, then the same server action, which re-runs PW.

| # | Entity / operation | Entry point(s) | Server code | Validation applied today | DB write | Authz | Currency / country fields |
|---|---|---|---|---|---|---|---|
| P1 | Product create (form) | `Store/src/app/(dashboard)/products/new/page.tsx:103-121` renders `ProductForm`; submit `Store/src/components/products/ProductForm.tsx:1236-1265` | `createProduct` `Store/src/lib/products/actions.ts:341-429` | rate limit `:351`; plan limit `:358`; `productWriteSchema` via `parseWrite` `:98-120` (schema `Store/src/lib/validation/product.ts:473-559`); publish gate when `status=active` `:333-339`, `:367` (to `Store/src/lib/settings/seller-identity.ts:304-313`); upload ownership + HEAD `:231-304`; badge check `:375`; add-on ownership `:379` (`Store/src/lib/products/add-on-refusal.ts:11-30`); moderation precheck `:411` | `insert into products` `:413-417` (row built `:382-407`, `currency: data.currency` `:387`) | PW `:344-348` | `currency` (enum `CURRENCIES`), `price_cents` (1 to 100,000,000). No country check (publish gate checks trader identity fields only) |
| P2 | Product create (MCP) | tool `create_product` `Store/src/lib/agent/tools/products.ts:166-191` (`currency: z.enum(CURRENCIES)` `:177`, `priceCents` int min 1 `:176`) | `assertValidWrite` `:85-88` then `createProduct` `:188` | `productWriteSchema` twice (tool, then action) + everything in P1 | as P1 | MCP scope `products:write`, permission `products.write` | as P1 |
| P3 | Product edit (form) | edit page loads via `getProduct` `Store/src/app/(dashboard)/products/[id]/edit/page.tsx:43`; submit `Store/src/components/products/ProductForm.tsx:1263-1264` | `updateProduct` `Store/src/lib/products/actions.ts:431-595` | as P1 minus plan limit; stored-key diff `:461-503` | `update products` `:553-559`; **always writes `title, description, price_cents, currency, status`** `:509-515`, others only when present `:516-549` | PW `:437-439` | `currency`, `price_cents`. The form's starting currency comes from `rowToProduct` (`Store/src/lib/products/queries.ts:143`: non-USD becomes EUR) |
| P4 | Product title/price edit from the storefront designer tile | `Store/src/components/storefront/ProductBlockEditor.tsx:182-237` | `updateProduct` (P3) | Client: own parser `centsOf` (`Number()`, `:43-49`), not `parseFormPriceCents`; server: P3 | as P3 | PW | sends `currency: product.currency` `:219` from the lossy read |
| P5 | Product edit (MCP) | tool `update_product` `Store/src/lib/agent/tools/products.ts:193-228` | rebuilds `title, description, priceCents (Math.round(current.price*100)), currency, status` from `getProduct` `:210-218`, overlays agent fields, `assertValidWrite` `:224`, `updateProduct` `:225` | as P3 | as P3 | MCP `products:write` | `currency` optional input `:205`, else re-sends the lossy-read currency `:217` |
| P6 | Publish / unpublish (card toggle) | `Store/src/components/products/ProductList.tsx:212` | `setProductStatus` `Store/src/lib/products/card-actions.ts:44-92` | `z.enum(PRODUCT_STATUSES)` `:36`, `:60`; publish gate only for `active` `:65-68`; precheck `:73` | `update products set status` only `:75-81` | PW `:48-52` | **none**: re-publishing never re-checks currency or price |
| P7 | Publish (MCP, batch up to 20) | tool `publish_products` `Store/src/lib/agent/tools/products.ts:230-335` | per id: `{title, description, priceCents, currency, status:"active"}` `:276-282`, `assertValidWrite` `:283`, `updateProduct` `:284` | as P3 | as P3 | MCP `products:write` | re-sends lossy-read `currency` `:280` |
| P8 | Unpublish (MCP) | no dedicated tool; `update_product` with `status: "draft"` (P5) | | | | | |
| P9 | Duplicate | `Store/src/components/products/ProductList.tsx:227` | `duplicateProduct` `Store/src/lib/products/card-actions.ts:101-164` | uuid `:113`; plan limit `:117-118`; precheck `:145`. **No `productWriteSchema`** | reads raw `title, description, price_cents, currency, ...` `:121-128`; `insert products` with `...source, status:"draft"` `:138-151` | PW `:105-108` | copies `currency` and `price_cents` **as stored**, unvalidated |
| P10 | Delete | `Store/src/components/products/ProductList.tsx:124`; MCP `delete_product` `Store/src/lib/agent/tools/products.ts:438-454` (scope `destructive`) | `deleteProduct` `Store/src/lib/products/actions.ts:597-662` | uuid; orders-to-ship acknowledgement `:619-634` | `delete from products` `:640-646`; R2 eviction | PW / MCP | none |
| P11 | CSV import (UI) | page `Store/src/app/(dashboard)/products/import/page.tsx:83-93` (default currency `:87`); component `Store/src/components/products/ProductImport.tsx:120` (state), `:355-364` (currency select over `CURRENCIES`), `:197-200` (call) | `importProducts` `Store/src/lib/products/import-actions.ts:111-284` | rate limit `:119`; plan room `:135-138`; byte cap `:142-150`; **`currency` must be in `CURRENCIES`** `:151-155`; status `:156-160`; publish gate if active `:165-168`; re-parses the file server side `:170-180` (`buildImportPlan` `Store/src/lib/products/csv.ts:345-422`, tolerant price parse `Store/src/lib/products/price.ts:55-89`); then **`productWriteSchema` per row** `:209-226` | one batch `insert products` `:256-259`, rows **built by the action itself** `:228-238` (owner, title, description, price_cents, currency, status, stock fields only) | PW `:114-116` | ONE currency for every row, picked by the seller. The price cell's own symbol is stripped (`price.ts:65`) and never compared with that pick |
| P12 | CSV import (MCP) | tool `import_products` `Store/src/lib/agent/tools/products.ts:337-355` (`currency: z.enum(CURRENCIES)` `:348`) | `importProducts` (P11) | as P11 | as P11 | MCP `products:write` | as P11 |
| P13 | Undo import | `Store/src/components/products/ProductImport.tsx:229` | `undoProductImport` `Store/src/lib/products/import-actions.ts:304-341` | ids schema `:287`; only rows still untouched `:321-330` | `delete from products` | PW | none |
| P14 | Stock settings | `Store/src/components/products/ProductList.tsx:197`; MCP `update_stock` `Store/src/lib/agent/tools/products.ts:357-374` | `updateStockSettings` `Store/src/lib/stock/actions.ts:53-107` | own local schema `:33-42` (not `productWriteSchema`) | `update products set track_stock, stock_quantity, low_stock_threshold` `:87-97` | PW `:57-61` | none |
| P15 | Stock through the form | part of P1/P3 (`Store/src/lib/products/actions.ts:391-399`, `:530-549`) | | `productWriteSchema` stock fields `Store/src/lib/validation/product.ts:485-497`, refine `:526-529` | | | none |
| P16 | Stock taken at checkout (not a catalog write) | order writer `Store/src/lib/orders/record.ts` through `order_place`; `decrement_stock` RPC kept for scripts `Store/src/lib/stock/decrement.ts:6-80` | | service role only | `products.stock_quantity` | service role | none (orders part) |
| P17 | Badges (form) | `details.badges` in P1/P3 | | `badgesSchema` `Store/src/lib/validation/product.ts:373-382`; AI/moderation `badgeRefusal` `Store/src/lib/products/actions.ts:375`, `:504` | `details` jsonb | PW | none |
| P18 | Badge move | designer `Store/src/components/storefront/ProductPageArtboard.tsx:190`; MCP `move_product_badge` `Store/src/lib/agent/tools/products.ts:387-403`; label check `check_badge_label` `:376-385` | `moveProductBadge` `Store/src/lib/products/badge-actions.ts:73-141`; `checkBadgeLabel` `:44-61` (read-only) | `badgeLabelSchema`, `z.enum(BADGE_PLACEMENTS)` `:88-94`, `badgesSchema` on the result `:115` | partial `update products set details` `:122-132` | PW | none |
| P19 | Add-ons (form) | `addOnIds` in P1/P3 | | `addOnIdsSchema` `Store/src/lib/validation/product.ts:459-464`; `addOnRefusal` (same store only); DB `guard_add_on_ids` | `add_on_ids` | PW | **no currency compatibility check on write** |
| P20 | Add-ons (designer picker) | `Store/src/components/storefront/ProductAddOnsEditor.tsx:86` | `setProductAddOns` `Store/src/lib/products/add-on-actions.ts:100-156` | `addOnIdsSchema` `:114`; `addOnRefusal` `:122` | partial `update products set add_on_ids` `:125-131` | PW `:104-108` | none at write. An add-on in another currency is **hidden** at read (`Store/src/lib/products/add-on-visibility.ts:16-23`, reason `otherCurrency` `Store/src/types/product.ts:608`) and refused at checkout (`Store/src/lib/checkout/quote.ts:273-279`) |
| P21 | Photos, gallery, documents, digital file | upload routes `Store/src/app/api/uploads/{image,file,document}/route.ts` (not opened in detail); MCP `upload_image` `Store/src/lib/agent/tools/products.ts:405-436` | keys saved through P1/P3 | key shape + ownership + HEAD size/type (`Store/src/lib/products/actions.ts:98-120`, `:164-304`) | `image_key`, `digital_file_key`, `gallery`, `documents` | PW | none. `digital_file_key !== null` is what makes a product digital (`Store/src/lib/checkout/availability.ts:95`, `Store/src/lib/checkout/quote.ts:253`), the split R3 vs R4 depends on |
| P22 | Product page facts (details, options, specs, safety, purchase link, shipping profile) | P1/P3 | | `productDetailsSchema` `Store/src/lib/validation/product.ts:384-421`; `optionGroupSchema` `:304-312`; `purchaseUrlSchema` `:432-451` | jsonb + `purchase_url`, `shipping_profile_id` | PW | `details.origin` is free text `:398`. A product with `purchase_url` is refused by our checkout (`Store/src/lib/checkout/quote.ts:237-241`) and its page sends buyers to the seller's own site |
| P23 | Moderation status (service role) | `settleAfterWrite` / `checkMany`; `Store/src/lib/products/settle-waiting.ts:21-44` | | | moderation columns | service role | none |
| P24 | Direct PostgREST write (bypass) | any authenticated owner or editor with the publishable key + their JWT | none of the app's code | **only DB CHECKs and triggers** (section 1) | `products` insert/update/delete | RLS `Store/tests/db/prod-migrations.sql:921-942` | `currency` limited only by the CHECK (EUR/USD); `price_cents >= 0` |
| P25 | Scripts (service role, dev/ops) | `Store/scripts/seed.ts:285-290`; `Store/scripts/stock-smoke.ts:60-61`, `:82-83` (`currency: "EUR"`); `Store/scripts/reset-seeded-products.ts:39`, `:75`; DB simulator `Store/supabase/migrations/20260801_demo_sales_sim.sql:108-110` | | none beyond DB | products / orders | service role | `STORE_CURRENCY = "EUR"` `Store/scripts/lib/fake-data.ts:668-677` |

AI writing help (`Store/src/lib/products/describe-actions.ts:96-110`) only returns description text and saves nothing. The request carries no price (grep for `price|currency` in `Store/src/lib/suggestions` only finds model-cost constants). Predictions (`Store/src/lib/predictions.ts`) never suggest a price (grep found no `price` in predictions, option-guesses, title-guess or option-presets). The only one they influence is the **default currency** of a new product or import (`:203-214`, `:261-290`; used at `Store/src/app/(dashboard)/products/new/page.tsx:114-118` and `Store/src/app/(dashboard)/products/import/page.tsx:87`).

---

## 3. Price and currency: where they are chosen and validated

### 3.1 Where currency is chosen

| Surface | What decides it | Default | Source |
|---|---|---|---|
| Product form, new product | `values.currency`, EUR/USD toggle inside the price field | `product?.currency ?? seed?.currency ?? "EUR"` | `Store/src/components/products/ProductForm.tsx:261`; toggle `Store/src/components/products/PriceField.tsx:112-140` |
| Product form, edit | same toggle, starts from the stored value read through `queries.ts:143` (non-USD becomes EUR) | stored | `Store/src/lib/products/queries.ts:136-162` |
| Prediction (seed) | most-used currency of the newest products, else `homeCurrency(tax_country)`: `["US","CA"]` get USD, any other country gets EUR | EUR for CZ | `Store/src/lib/predictions.ts:241-257`, `:266`; recent facts `Store/src/lib/products/queries.ts:465-484` (`toCurrency` `:477`) |
| CSV import | one select for the whole file | prediction, else `"EUR"` | `Store/src/components/products/ProductImport.tsx:85`, `:120`, `:355-364` |
| MCP create/import | required enum input | none (agent must send one) | `Store/src/lib/agent/tools/products.ts:177`, `:348` |
| Discount amount | unit switch `% / € / $`, limited to the catalogue's currencies plus the edited discount's own | first product's currency, else `"EUR"` | `Store/src/components/discounts/DiscountForm.tsx:115`, `:132`, `:155-160`, `:499-513` |
| Shipping policy rates | `ratesCurrency` select over `CURRENCIES` | prediction (usual product currency), else `"EUR"` | `Store/src/components/settings/ShippingSection.tsx:147`, `:202-203`; `Store/src/lib/predictions.ts:392-405`; schema `Store/src/lib/validation/shipping-policy.ts:77-79` |
| Order | first sellable line's currency; other lines refused | n/a | `Store/src/lib/checkout/quote.ts:273-279`; fallback `"EUR"` `:330` |
| Plan subscription | `plan_prices.currency` | `'EUR'` hard-coded | `Store/src/lib/billing/plans.ts:38-39`; `Store/supabase/migrations/20261011_pricing_config.sql:264` |

### 3.2 Price validation

| Rule | Where | Notes |
|---|---|---|
| Integer minor units, 1 to 100,000,000 | `boundedInt({min:1,max:PRICE_CENTS_MAX})` `Store/src/lib/validation/product.ts:477`; `PRICE_CENTS_MAX` `:218-219` | The comment calls it "€/$1,000,000"; no per-currency cap |
| DB | `price_cents >= 0` only | `Store/tests/db/prod-migrations.sql:156`. A direct write can store 0 or any int4 |
| Form parser (strict) | `parseFormPriceCents` `Store/src/lib/products/price.ts:112-153` | rejects more than 2 fraction digits `:135-141`, `<= 0` `:149`, `> max` `:150`; rounds `value*100` `:148` |
| CSV parser (tolerant) | `parsePriceCents` `Store/src/lib/products/price.ts:55-89` | strips symbols `:65`; 3 digits after a lone separator count as thousands `:78-83`; **rejects any cell containing e/E/x/X `:62`, so "12 EUR" fails as `noPrice` while "12 Kč" and "CZK 12" parse** |
| CSV row problems | `noTitle, titleTooLong, noPrice, priceZero, duplicateTitle` | `Store/src/lib/products/csv.ts:282-287`, `:399-404` |
| Designer tile price | `centsOf` = `Math.round(Number(x)*100)` | `Store/src/components/storefront/ProductBlockEditor.tsx:43-49`; client only (the server re-validates). A third parser, despite `price.ts:1-8` calling itself "the single source" |
| Blur normalisation | `(priceCents / 100).toFixed(2)` | `Store/src/components/products/PriceField.tsx:58-66` |
| Error copy for the cap | major units via `numberFormat` | `Store/src/lib/products/price.ts:181-187` |
| Display model | `Product.price` is a **float in major units** (`Store/src/types/product.ts:19-21`); `row.price_cents / 100` (`Store/src/lib/products/queries.ts:142`); back to cents with `Math.round(price * 100)` (`Store/src/lib/agent/tools/products.ts:216`, `:279`, `:323`) | Exact for 2-decimal currencies only |

Every money path assumes **2 decimal places**: `/100` and `*100` throughout, `toFixed(2)`, the "more than 2 decimals" rejection, and formatting via `amountCents / 100` (`Store/src/lib/format/money.ts:33`, `:35`). CZK has 2 minor-unit digits in ISO 4217, so the integer-cents model still holds (inferred, outside knowledge). Whole-koruna display would need `wholeUnits` (`Store/src/lib/format/money.ts:27-34`), which today is used for headline prices.

### 3.3 Options, variants, compare-at, sale prices

- **Options carry no price.** Comment `Store/src/types/product.ts:194-197` ("Every option is the same product at the same price"); `productOptionSchema` has no price member (`Store/src/lib/validation/product.ts:291-297`); the MCP description says so (`Store/src/lib/agent/tools/products.ts:67`, `:121`).
- **No compare-at price column.** A grep for `compareAt|compare_at|priceDelta|price_delta|priceAdjust` in `Store/src` finds nothing.
- **Sale price** comes only from discounts (section 4). The struck "regular" price is `price_cents`. The EU 30-day prior price is read from `product_price_history`, and a currency change inside the window makes it unknown (`Store/src/lib/discounts/prior-price.ts:34`, `:91`).

---

## 4. Inventory: discounts

| # | Operation | Entry point(s) | Server code | Validation | DB write | Authz | Currency fields |
|---|---|---|---|---|---|---|---|
| D1 | Create sale or code | `Store/src/components/discounts/DiscountForm.tsx:310`; MCP `create_discount` `Store/src/lib/agent/tools/discounts.ts:71-81` (pre-parse `:28`) | `createDiscount` `Store/src/lib/discounts/actions.ts:122-152` | `discountInputSchema` `Store/src/lib/validation/discounts.ts:56-84` (amount: `amountOffCents` 1 to 100,000,000 and `currency: z.enum(CURRENCIES)` `:38-42`); `checkInput` (dates, product ownership) `actions.ts:72-99`; live cap `:135-141` | `insert discounts` `:143-147`, columns from `toColumns` `:53-69` (`currency` `:61`, null for percent) | `products.write` `:44-50`; RLS `discounts_insert_writer` `20261004_discounts.sql:145-151` | `discounts.currency` (amount only) |
| D2 | Edit | `DiscountForm.tsx:310`; MCP `update_discount` `Store/src/lib/agent/tools/discounts.ts:85-95` | `updateDiscount` `Store/src/lib/discounts/actions.ts:159-203` | as D1; a started sale may only change `ends_at` (`:185-188`, `changesTerms` compares currency `:206-220`); DB `guard_discount_rules` freezes `currency` once started (`20261004_discounts.sql:208-218`) | `update discounts` `:190-197` | as D1, RLS update `20261004_discounts.sql:153-163` | as D1 |
| D3 | Switch a code on/off | `Store/src/components/discounts/DiscountsPage.tsx:101`; MCP `set_code_enabled` `Store/src/lib/agent/tools/discounts.ts:99-106` | `setCodeEnabled` `actions.ts:223-241` | uuid, boolean | `update discounts set enabled` | as D1 | none |
| D4 | End a sale | `DiscountForm.tsx:325`, `DiscountsPage.tsx:118`; MCP `end_sale` `discounts.ts:110-117` | `endSale` `actions.ts:244-262` | uuid | `update discounts set ends_at` | as D1 | none |
| D5 | Delete (archive) | `DiscountsPage.tsx:132`; MCP `delete_discount` `discounts.ts:121-128` (scope `destructive`) | `deleteDiscount` `actions.ts:269-286` | uuid | `update discounts set archived_at` | as D1 | none |
| D6 | Price history | trigger only | `record_product_price` `20261004_discounts.sql:270-296` | CHECK currency EUR/USD `:253` | `product_price_history` | definer trigger | `currency` copied from the product |
| D7 | Direct PostgREST write (bypass) | authenticated writer | none | CHECK `discounts_value` + guard trigger | `discounts` | grants `20261004_discounts.sql:128-135` | `currency` limited by the CHECK |
| D8 | Order discount snapshot (downstream) | service-role order writer | `Store/src/lib/orders/record.ts` | | `orders.discount_*` | service role | none |

**Semantics.** A discount is either a whole percent (1 to 90, no currency) or an amount in minor units **with its own currency** that applies only to products priced in that currency (`Store/src/types/discount.ts:36-40`; `reductionCents` returns 0 on a mismatch, `Store/src/lib/discounts/pricing.ts:39-47`; `appliesInCurrency` `Store/src/lib/discounts/row.ts:54-57`). One discount per order (`pricing.ts:13-29`). Items never drop below `MIN_PAYABLE_CENTS = 50` (`:31-33`, `:45`), and that floor has no currency. **Channel credit** is attribution only: `share_channel` text on a code (`20261004_discounts.sql:60-62`) plus `orders.discount_code_id` (`:311-314`); no money and no currency.

**Reading legacy rows.** `discountValueOf` keeps an amount discount only when its currency is in `CURRENCIES` (`Store/src/lib/discounts/row.ts:42-46`). Narrowing `CURRENCIES` therefore makes existing EUR/USD amount discounts vanish from the seller's list and from checkout, with no error ("DEGRADES, never throws", `:9-11`).

---

## 5. Inventory: storefronts (only where selling rules, currency or countries are touched)

| # | Operation | Entry point(s) | Server code | Validation | DB write | Authz | Currency / country |
|---|---|---|---|---|---|---|---|
| S1 | Create | `Store/src/components/storefront/useCreateStorefront.ts:28`; MCP `create_storefront` `Store/src/lib/agent/tools/storefronts.ts:226-238` | `createStorefront` `Store/src/lib/storefront/actions.ts:110-210` | plan limit `:122-123`; carries over the last design `:170-187` | `insert storefronts` `:193-197` | `storefront.write` `:113` | none (reads business name only `:128-131`) |
| S2 | Save design (name, theme, blocks, header, embed, productPage, checkoutPage, cartPage) | `Store/src/components/storefront/StorefrontDesigner.tsx:3864`; MCP `edit_storefront` `storefronts.ts:240-300` (`:294`), `save_storefront` `:342-370` (`:366`) | `saveStorefront` `actions.ts:218-410` | `storefrontNameSchema`, `storefrontConfigSchema` `:236-247`; product blocks kept only if the product is the caller's own `:251-271`; version check `:330-336` | `update storefronts set name, config` `:383-392` | `storefront.write` `:225` | **none**. Blocks are not checked for currency agreement between products; config has no currency or country (grep in `Store/src/lib/validation/storefront.ts` finds only a comment at `:700`) |
| S3 | Product page / checkout page / cart page settings | routes `Store/src/app/api/storefronts/[id]/product-page/route.ts`, `.../checkout-page/route.ts`, `.../cart-page/route.ts`; MCP `update_product_page`, `update_checkout_page`, `update_cart_page` `storefronts.ts:372-406` | `pageConfigRoute` PATCH `Store/src/lib/storefront/page-config-route.ts:144-220` | member schema on the merged object `:171-182`; page photo ownership `:193-194` | `update storefronts set config` `:200-207` | `storefront.write` `:149` | none |
| S4 | Embed on/off and domain allowlist ("publish onto any website") | `Store/src/components/storefront/EmbedSettings.tsx:221`, `:249`; MCP `update_embed_settings` `storefronts.ts:408-424` | `updateEmbedSettings` `actions.ts:478-551` | `embedSettingsSchema` `:495`; **publish gate when enabling** `:510-513` | `update storefronts set config.embed` `:535-541` | `storefront.write` `:484` | none |
| S5 | Delete / rotate embed key | `Store/src/components/storefront/StorefrontsList.tsx:143`, `EmbedSettings.tsx:266`; MCP `delete_storefront`, `rotate_embed_key` `storefronts.ts:442-470` | `deleteStorefront` `actions.ts:554-596`; `rotateEmbedKey` `:614-650` | uuid | delete / `embed_key` | `storefront.write` | none |
| S6 | "Publish" of a storefront | no status column (`Store/src/types/supabase.ts:2655-2675`); public when product pages are on (`resolveProductPage(config).enabled`, used `Store/src/lib/agent/tools/products.ts:252`), the seller passes `sellerMaySell`, and it is not taken down | read gates `Store/src/lib/products/purchasable.ts:311-322`; `Store/src/lib/storefront/storefront-page.ts:266` | trader identity only | n/a | n/a | country only in display logic: `isEuSeller` / EU-rights text uses `EU_COUNTRY_CODES` (`Store/src/lib/storefront/product-page.ts:1`, `:169-195`) |

Related, but owned by the shipping/settings parts of this inventory: `save_shipping_policy` (`storefronts.ts:426-440`) writes `ratesCurrency`, `freeOverCents` and destination countries (`SHIPPING_COUNTRY_CODES`, `Store/src/lib/settings/constants.ts:129-136`). At checkout a parcel is sellable only if `ratesCurrency` equals the product's currency (`canQuoteShipping` `Store/src/lib/shipping/rates.ts:114-121`, applied in `Store/src/lib/checkout/quote.ts:255-259` and `Store/src/lib/checkout/availability.ts:92-97`).

---

## 6. (1) Choke points

| # | Choke point | What funnels through it | What does NOT | Source |
|---|---|---|---|---|
| C1 | **DB CHECKs** `products.currency in ('EUR','USD')`, `product_price_history.currency in (...)`, `discounts_value ... currency in (...)` | every writer in every repo: app actions, MCP, direct PostgREST, service role, scripts, Admin/App if they ever write | `orders.currency` (no CHECK), shipping policy (jsonb on profiles) | `Store/tests/db/prod-migrations.sql:157`; `Store/supabase/migrations/20261004_discounts.sql:91`, `:253` |
| C2 | **`CURRENCIES`** constant | `productWriteSchema` `Store/src/lib/validation/product.ts:478`; discount `amountValue` `Store/src/lib/validation/discounts.ts:41`; shipping `ratesCurrency` `Store/src/lib/validation/shipping-policy.ts:79`; import membership check `Store/src/lib/products/import-actions.ts:151`; MCP enums `Store/src/lib/agent/tools/products.ts:177`, `:205`, `:348`; UI toggles `Store/src/components/products/PriceField.tsx:118`, `Store/src/components/products/ProductImport.tsx:361`, `Store/src/components/settings/ShippingSection.tsx:147`, `Store/src/components/discounts/DiscountForm.tsx:159`; discount read parser `Store/src/lib/discounts/row.ts:42`; `isCurrency` `Store/src/lib/products/csv.ts:430-432`; MCP `get_schema` (JSON Schema from the Zod schemas, `Store/src/lib/agent/tools/storefronts.ts:41-44`, `:172`) | the read-side `toCurrency` mapper (it hard-codes USD/EUR instead of reading the list) | `Store/src/types/product.ts:12-13` |
| C3 | **`productWriteSchema`** | createProduct, updateProduct, importProducts (per row), MCP create/update/publish (through `assertValidWrite` and the actions) | duplicateProduct, setProductStatus, updateStockSettings, moveProductBadge, setProductAddOns, direct PostgREST, scripts | `Store/src/lib/validation/product.ts:473-559` |
| C4 | **`discountInputSchema`** | createDiscount, updateDiscount, MCP create/update | setCodeEnabled/endSale/deleteDiscount (they write no currency), direct PostgREST | `Store/src/lib/validation/discounts.ts:56-84` |
| C5 | **`toCurrency`** (read normaliser, NOT a validator) | 31 call sites (29 outside `money.ts` itself) incl. checkout (`quote.ts:178`, `:254`), quantity authority (`order-quantity.ts:177`), buyer page builder (`public.ts:121`, `:167`), board (`storefront-page.ts:288`, `:376`), add-ons, cart, previews, all money formatting (`format/money.ts:30`, `:35`). Inline twin at `queries.ts:143` | | `Store/src/lib/format/money.ts:12-14` |
| C6 | **Checkout `assessLines`** | every order line: buy now, cart, add-ons; currency per line `:254`, one currency per order `:273-279`, purchase-link refusal `:237-241`. The natural server-side point for R2/R6 on the catalogue side | | `Store/src/lib/checkout/quote.ts:231-279` |
| C7 | **Publish gate** (write) and **sellerMaySell** (read) | product going active (P1/P3/P6/P7/P11), embed enabling (S4); buyer pages and checkout (`purchasable.ts:322`, `storefront-page.ts:266`), sitemap (`Store/src/lib/seo/sitemap.ts:158`). Natural place for R1/R5 seller rules (other parts) | duplicate (always draft), badge/add-on/stock writes | `Store/src/lib/settings/seller-identity.ts:128-132`, `:304-313` |
| C8 | **Price parsers** | form (`parseFormPriceCents`) and CSV (`parsePriceCents`) | designer tile (`centsOf`) | `Store/src/lib/products/price.ts:55-153` |

A single config-driven currency rule would cover the most paths at **C2 + C1** (write side), with **C5** rewritten so reads never invent a currency. **C6** is the backstop that stops a legacy row being sold.

---

## 7. (2) Paths that bypass the choke points

| # | Path | What it skips | Source |
|---|---|---|---|
| B1 | Direct PostgREST insert/update on `products` by an owner or editor | all of C3, C7, rate limits, moderation precheck; only CHECKs and triggers apply (`price_cents >= 0`, no min 1, no max) | RLS `Store/tests/db/prod-migrations.sql:921-942`; acknowledged `Store/supabase/migrations/20261028_product_add_ons.sql:55-56`, `Store/supabase/migrations/20261105_write_bounds.sql:1-14`. I found no `revoke ... on public.products` in any Store `.sql`, so Supabase's default table grants to `authenticated` apply (inferred) |
| B2 | Direct PostgREST insert/update on `discounts` | C4 and `checkInput`; CHECK + guard trigger only | `Store/supabase/migrations/20261004_discounts.sql:128-135`, `:145-163` |
| B3 | `duplicateProduct` | copies raw `currency`/`price_cents` with no schema | `Store/src/lib/products/card-actions.ts:121-151` |
| B4 | `setProductStatus` | re-publishes without re-checking currency or price | `Store/src/lib/products/card-actions.ts:75-81` |
| B5 | `updateStockSettings` | own local schema | `Store/src/lib/stock/actions.ts:33-42`, `:87-97` |
| B6 | `moveProductBadge` | partial `details` write, `badgesSchema` only | `Store/src/lib/products/badge-actions.ts:114-132` |
| B7 | `setProductAddOns` | partial write; no currency compatibility at write | `Store/src/lib/products/add-on-actions.ts:114-131` |
| B8 | `importProducts` builds its own insert rows | each row passes C3 first, but the insert object is hand-built (`maxPerOrder`, details etc. omitted, so DB defaults apply) | `Store/src/lib/products/import-actions.ts:209-238` |
| B9 | Designer tile price parser | its own `Number()` parse (client only; the server still runs C3) | `Store/src/components/storefront/ProductBlockEditor.tsx:43-49` |
| B10 | Writes that re-send a currency from a lossy read | form edit (`ProductForm.tsx:261` via `queries.ts:143`), designer tile (`ProductBlockEditor.tsx:219`), MCP `update_product` (`tools/products.ts:217`), `publish_products` (`:280`) | as listed |
| B11 | Service-role scripts and the DB demo simulator | everything app-side | `Store/scripts/seed.ts:285-287`; `Store/scripts/stock-smoke.ts:60-61`; `Store/supabase/migrations/20260801_demo_sales_sim.sql:108-110` |
| B12 | Order writer (downstream) | accepts any 3-letter currency and stores it upper-cased; `order_place` defaults to EUR | `Store/src/lib/orders/record.ts:220`, `:488`; `Store/supabase/migrations/20261120_shopping_cart.sql:220` |

---

## 8. (3) Every currency list, default or literal in Store (runtime code; dev harness and tests summarised)

### 8.1 Lists and normalisers

| What | Value | Consumers | Source |
|---|---|---|---|
| `CURRENCIES` / `Currency` type | `["EUR","USD"]` | see C2 | `Store/src/types/product.ts:11-13` |
| `toCurrency` | `"USD"` stays USD, anything else becomes `"EUR"` | see C5 (31 call sites) | `Store/src/lib/format/money.ts:10-14` |
| inline mapper | `row.currency === "USD" ? "USD" : "EUR"` | `rowToProduct` (every owner-side product read, edit form, MCP get/update/publish) | `Store/src/lib/products/queries.ts:143` |
| `CURRENCY_SYMBOLS` | `Record<Currency,string> = { EUR: "€", USD: "$" }` | price field prefix | `Store/src/components/products/PriceField.tsx:14`, `:84` |
| chart symbol | `code === "USD" ? "$" : "€"` | analytics axes | `Store/src/components/analytics/chart-format.ts:22`, `:41` |
| `DOLLAR_COUNTRIES` / `homeCurrency` | `["US","CA"]` get USD, any other country gets EUR | new product + import default | `Store/src/lib/predictions.ts:248-257` |
| `ENGLISH_PRICE_LOCALE` | `"en-IE"` (English money formatting) | `formatPrice`, `formatPriceShort`, `formatCents`, `currencySymbol` | `Store/src/lib/format.ts:8-28`; `Store/src/lib/format/money.ts:28`, `:42`, `:62` |
| DB lists | `('EUR','USD')` in three CHECKs | section 1 | `Store/tests/db/prod-migrations.sql:157`; `Store/supabase/migrations/20261004_discounts.sql:91`, `:253` |

### 8.2 Defaults and literals (runtime)

| Literal | Purpose | Source |
|---|---|---|
| `"EUR"` | product form default | `Store/src/components/products/ProductForm.tsx:261` |
| `"EUR"` | import default prop | `Store/src/components/products/ProductImport.tsx:85` |
| `"EUR"` | discount form defaults | `Store/src/components/discounts/DiscountForm.tsx:115`, `:132` |
| `"EUR"` | shipping rates default (UI, prose, rates, threshold) | `Store/src/components/settings/ShippingSection.tsx:203`; `Store/src/lib/shipping/policy-prose.ts:122`; `Store/src/lib/shipping/rates.ts:118`, `:149`, `:276`; type doc `Store/src/types/shipping-policy.ts:56-59` |
| `"EUR"` | order currency fallback in the quote | `Store/src/lib/checkout/quote.ts:330` |
| `"EUR"` | cart panel / suggestions fallback | `Store/src/components/cart/CartPanel.tsx:92`, `:148`; `Store/src/components/cart/CartSuggestions.tsx:36` |
| `"EUR"` | sale-chip sample, product page section sample, empty-state sample | `Store/src/components/storefront/SaleBadgeControls.tsx:159`; `Store/src/components/storefront/ProductPageSection.tsx:101`; `Store/src/components/storefront/StorefrontEmptyState.tsx:62` |
| `"EUR"` | sample storefront products; sample seller country `"PT"` | `Store/src/lib/storefront/sample.ts:74`, `:198-203` |
| `"EUR"` hard-coded formatting | marketing graphics | `Store/src/components/products/ProductImportStory.tsx:129`; `Store/src/components/products/ReviewImportBeams.tsx:550` |
| `"EUR"` | analytics totals currency (always) | `Store/src/lib/analytics/queries.ts:212`, `:292`; type note `Store/src/lib/analytics/types.ts:89` |
| `"EUR"` sorts first | dashboard per-currency totals | `Store/src/lib/dashboard/format.ts:15-21` |
| `"EUR"` | search route money fallback | `Store/src/app/api/search/route.ts:82`, `:254` |
| `BILLING_CURRENCY = "EUR"` | plan billing and AI credit unit | `Store/src/lib/billing/plans.ts:38-39`, `:102-108` |
| `"EUR"` | plan price seed, billing test provider | `Store/src/lib/billing/pricing-seed.ts:30`; `Store/src/lib/billing/test-provider.ts:84` |
| `FALLBACK_CURRENCY = "EUR"` | Connect payouts overview | `Store/src/lib/payments/connect/overview.ts:57` |
| `EUR` / `USD` consts | payment demo scenarios | `Store/src/lib/payments/scenarios.ts:66-67` |
| `MIN_PAYABLE_CENTS = 50` | discount floor, any currency | `Store/src/lib/discounts/pricing.ts:31-33` |
| `PRICE_CENTS_MAX`, `DISCOUNT_AMOUNT_MAX_CENTS` (100,000,000), `SHIPPING_RATE_MAX_CENTS` (100,000) | caps with no currency, sized for euros | `Store/src/lib/validation/product.ts:218-219`; `Store/src/types/discount.ts:21-22`; `Store/src/types/shipping-policy.ts:113-115` |

### 8.3 SQL literals

| Literal | Purpose | Source |
|---|---|---|
| `currency <> 'USD'` | analytics, dashboard, top products, weekday, perf indexes, cart aggregates: "anything not USD is EUR" | `Store/supabase/migrations/20260802_analytics_sql_aggregates.sql:23-27`, `:71`, `:179`; `20260808_recent_orders_id.sql:26`; `20261007_analytics_weekday_products.sql:58`; `20261028_product_add_ons.sql:595`, `:606`, `:807`; `20261117_perf_indexes.sql:300`, `:327`, `:334`, `:370`, `:381`; `20261120_shopping_cart.sql:744`, `:808`, `:852`, `:863` |
| `currency = 'EUR'` | plan calculator sales (old and new), seller plans summary | `20260930_seller_plans.sql:476`; `20261004_discounts.sql:361`; `20261011_pricing_config.sql:690` |
| `coalesce(incoming.currency, 'EUR')` | `order_place` (each re-creation) | `20261008_order_lifecycle.sql:169`; `20261011_pricing_config.sql:465`; `20261022_order_place_code_limit.sql:48`; `20261028_product_add_ons.sql:231`; `20261120_shopping_cart.sql:220` |
| `default 'EUR'` | demo simulator config, plan_prices | `20260801_demo_sales_sim.sql:110`; `20261011_pricing_config.sql:129` |

### 8.4 Formatting helpers that assume two decimals

`formatCents` divides by 100 (`Store/src/lib/format/money.ts:21-36`); `formatPrice` / `formatPriceShort` take major units (`Store/src/lib/format.ts:13-28`); `PriceField` uses `toFixed(2)` (`Store/src/components/products/PriceField.tsx:64`); `rowToProduct` divides by 100 (`Store/src/lib/products/queries.ts:142`); MCP multiplies by 100 again (`Store/src/lib/agent/tools/products.ts:216`, `:279`, `:323`); the CSV and form parsers round `value*100` (`Store/src/lib/products/price.ts:88`, `:148`). The `Intl` formatter itself takes minor digits from the currency code, so CZK would print with 2 decimals in either locale (`1 299,00 Kč` in `cs`; in `en-IE` likely `CZK 1,299.00`) (inferred: formatter output not run).

### 8.5 Dev harness, tests, scripts (summary)

- `Store/src/app/dev/**` has dozens of `currency: "EUR"` fixtures plus a few USD ones (for example `Store/src/app/dev/discounts/fixtures.ts:18-31`, `Store/src/app/dev/predictions/PredictionsLab.tsx:481`, `Store/src/app/dev/payments-lab/design/PaymentsDesign.tsx:315-362`). These are dev-only (excluded from builds per memory note dev-harness-excluded-from-build, not re-verified).
- Grep counts: `'EUR'|"EUR"|currency: "EUR"` occurs **426 times across 128 files** under `tests`, `scripts` and `supabase`; `USD` occurs **114 times across 29 test files**.
- Seeds: `Store/scripts/lib/fake-data.ts:668-677` (`STORE_CURRENCY = "EUR"`, with a comment on the EUR-only analytics); `Store/scripts/stock-smoke.ts:60-61`, `:82-83`; `Store/tests/e2e/helpers.ts:448`, `:662`, `:706`.
- CSV template has no currency column: `Store/public/import-template.csv:1-2`.
- Copy that names euros: `Store/messages/en/billing.json:77` ("in euros"); `Store/messages/en/settings.json:454`, `:461` ("€9.00" examples); the discount hint `Store/messages/en/discounts.json:115`; the import help `Store/messages/en/products.json:267-268`; the import error `Store/messages/en/errors.json:559-561`.

---

## 9. (4) Plan prices and platform fees vs product currency

- **The sale fee is currency-blind.** `computeFees` takes `amountCents` and basis points only (`Store/src/lib/pricing/fees.ts:50-112`); `saleFee` / `sellerSaleFee` pass no currency (`Store/src/lib/billing/fees.ts:94-117`; `Store/src/lib/billing/sale-fee.ts:49-79`). The fee is charged as Stripe's `application_fee_amount` in the charge's own currency (`Store/src/lib/checkout/stripe-provider.ts:106`, `:159`). **Nothing converts currencies.** A CZK order pays its fee in CZK at the same rate.
- **The fee ledger is per currency**, copied from the order (`Store/supabase/migrations/20261011_pricing_config.sql:586-634`), and summed per currency (`:636-666`; `Store/src/lib/billing/fee-ledger.ts:163-197`).
- **Plan prices are EUR-only**: `BILLING_CURRENCY = "EUR"` (`Store/src/lib/billing/plans.ts:38-39`); seed rows (`Store/supabase/migrations/20261011_pricing_config.sql:288-290`); publish function hard-codes `'EUR'` (`:264`). The catalog loader does not filter by currency (`Store/src/lib/billing/catalog.ts:30-84`); there is one price set for everyone. Stripe subscription checkout refuses a Stripe Price whose currency differs from the row (`Store/src/lib/billing/stripe-provider.ts:80-86`).
- **The plan calculator assumes EUR in two places**: `monthlyCostOf = monthlyPriceOf(price) + feeCents(monthlyGmvCents, bps)` adds the EUR subscription to a fee on sales without checking currency (`Store/src/lib/pricing/plan-price.ts:97-99`); the sales input `readDirectSales30d` uses `billing_sales_30d`, which counts only `currency = 'EUR'` orders (`Store/src/lib/billing/account-plan.ts:191-200`; `Store/supabase/migrations/20261011_pricing_config.sql:676-699`). A CZK-only seller would see 0 in the calculator and upgrade hint.
- **AI credit** is EUR minor units, with model cost in USD counted 1:1 as EUR (`Store/src/lib/billing/ai-credit.ts:5-11`). This has nothing to do with product currency.
- Stripe Connect settlement: a direct charge in a currency other than the connected account's default currency is converted by Stripe at payout (inferred, outside knowledge; not in code). Charging CZK to a CZ account avoids that. Charging EUR (what `toCurrency` would do to a CZK row) would not.

---

## 10. (5) What would break if only CZK were allowed (high level)

**Type and compile level.** If `CURRENCIES` becomes `["CZK"]`: `CURRENCY_SYMBOLS: Record<Currency,string>` fails to compile until updated (`PriceField.tsx:14`), which is useful. Every `"EUR"` literal typed as `Currency` (`ProductForm.tsx:261`, `DiscountForm.tsx:115`, `:132`, `ShippingSection.tsx:203`, `rates.ts:118`, `:149`, `quote.ts:330`, `sample.ts:74`, the `toCurrency` return values, `queries.ts:143`) fails to compile. The dev fixtures typed as `Product` / `Currency` also fail.

**Wrong results with no error (most dangerous).**
- `toCurrency` / `queries.ts:143` map CZK to EUR, so buyer pages and checkout would show and **charge EUR** for CZK rows (`quote.ts:178`, `:254`; `stripe-provider.ts:106`).
- Analytics `<> 'USD'` would count CZK as EUR and print `€` (`chart-format.ts:41`, `analytics/queries.ts:292`).
- Plan calculator `= 'EUR'` would show 0 sales.
- Legacy EUR/USD amount discounts would vanish (`row.ts:42-46`).
- An EUR shipping policy with CZK products makes every parcel unsellable (`canQuoteShipping`, `rates.ts:114-121`), because `ratesCurrency` defaults to EUR.
- `homeCurrency("CZ")` gives EUR (`predictions.ts:256`).

**Legacy data.** Existing EUR/USD products, `product_price_history` rows, discounts and shipping policies would violate a narrowed DB CHECK (a migration must convert or grandfather them). Because of B10, any edit or MCP publish of such a product fails C3 until its currency is changed. A currency change also resets the 30-day prior-price proof (`prior-price.ts:91`). Undo-import, duplicate (B3) and status toggle (B4) behave differently from the form on legacy rows.

**Limits to recalibrate.** `MIN_PAYABLE_CENTS` 50 (0.50 Kč; Stripe's CZK minimum charge is higher, inferred ~15 Kč), `PRICE_CENTS_MAX` (1,000,000 Kč), `SHIPPING_RATE_MAX_CENTS` (1,000 Kč flat delivery cap), `DISCOUNT_AMOUNT_MAX_CENTS`.

**Tests and fixtures.** Unit tests that pin EUR/USD behaviour (`Store/tests/unit/format.test.ts:30-39`, `price-parser`, `predictions`, `discount-*`, `checkout-quote`, `shipping-rates`, `product-add-ons`, `cart-follow-ups`, and others: 29 files mention USD); integration tests on aggregate RPCs (`Store/tests/integration/16-aggregate-rpcs.test.ts`, `48-perf-indexes.test.ts`) that rely on `<> 'USD'`; e2e specs seeding EUR (`Store/tests/e2e/helpers.ts`, `93-storefront-sale-prices.spec.ts`, `103-predictions.spec.ts`, `101-mcp.spec.ts`); the DB replay `Store/tests/db/prod-migrations.sql` (20 USD mentions); the sample storefront and sample cart (`Store/src/lib/storefront/sample.ts:74`, `Store/src/lib/cart/sample.ts`, not opened line by line); the seed scripts (`Store/scripts/lib/fake-data.ts:677`, `Store/scripts/stock-smoke.ts`); the dev harness fixtures.

**Copy.** "in euros" (`billing.json:77`), "€9.00" examples (`settings.json:454`, `:461`), the "€ / $" unit switch wording in the discount form, and every locale's equivalents (10 locales under `Store/messages/`).

**Design point for the build phase (observation, not a recommendation).** Today `Currency` means both "what a seller may price in" (write gate) and "what the app can read and format" (read type). A CZK-only beta that still holds EUR/USD rows needs those two split: a configured *allowed for new writes* list (CZK) and a *known/readable* list (CZK, EUR, USD) that the reader never collapses. Otherwise either legacy rows are silently mislabelled, or CZK rows are.

---

## 11. (6) What I could not determine

- **Production data.** How many products, discounts, price-history rows and shipping policies exist per currency, and whether any USD rows exist. No DB access by rule.
- **Whether prod `products` has a CHECK different from the replay file.** The replay header says it was reconciled 2026-08-07 (`Store/tests/db/prod-migrations.sql:4-5`); no later Store migration touches `products.currency`. Repos other than Store were only grepped (`currency in (`, `'CZK'`), with no hit outside Store.
- **Default PostgREST grants on `products`.** No `grant`/`revoke` statement for `public.products` exists in Store SQL. That direct writes work rests on the migration comments cited in B1 and on Supabase defaults (inferred).
- **Admin and App writes to `products.currency` or `price_cents`.** A multiline grep for `from("products"|"discounts") ... .insert|update|upsert|delete` in `C:\Squareshare\Admin` and `C:\Squareshare\App` (`.ts`/`.tsx`) found nothing. Admin touches `products` for moderation (`C:\Squareshare\Admin\src\lib\moderation\content.ts`, `C:\Squareshare\Admin\src\lib\data\moderation.ts`, not opened). Covered by inventory parts 06 and 07.
- **Upload route internals** (`Store/src/app/api/uploads/*/route.ts`): not opened line by line. They store objects; the product row changes only through P1/P3 (verified).
- **Stripe specifics for CZK** (minimum charge, decimal handling, payout conversion): outside knowledge, not in code (inferred).
- **`Intl` output for CZK under `en-IE`**: not executed (inferred).
- **Cart sample and cart view details** (`Store/src/lib/cart/sample.ts`, `Store/src/lib/cart/view.ts`): only grepped for currency. They take the cart currency from line products via `toCurrency` (`Store/src/lib/cart/view.ts:107-128`).
- **Line numbers past what I read** in `Store/src/lib/agent/tools/storefronts.ts` (`edit_storefront` and `save_storefront` bodies) and `Store/src/lib/storefront/actions.ts:400-470` are given as ranges from the grep anchors, not read in full.
