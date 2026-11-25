# Review 04: commit b73dae3, catalogue currency (R2)

Reviewer: independent (did not write the commit). Read-only review of `C:\dev\sq-market-review`, detached at `b73dae3`, read as `git diff 20cd9c1 b73dae3` plus the files around it. Nothing was run: no install, type check, test, build, server or browser. Line references are at `b73dae3`. Date: 2026-11-22.

## 1. Verdict

| Question | Answer |
|---|---|
| R2 for buyers | **Clean for prices, quotes and charges.** Every buyer surface that shows a price, every quote and every payment goes through the shared gate (`visiblePlacedRows`) or the quote's own line check (`assessLines`), and both ask `offeredInMarket`. A product priced outside the market is not shown, not quoted and not charged. It is not yet absent in the strict "like a takedown" sense: two price-free reads still answer for it, and a hidden product still opens a page for its add-ons (K1, P3). |
| R2 for seller writes | **Clean on every app entry point** I found (form, designer tile, card menu, duplicate, CSV import, the assistant's tools, discounts). Two P3 caveats: a seller racing their own tabs can leave a row active in a legacy currency (K2; buyers still never see it), and a legacy draft can be re-priced in its own legacy currency, which the letter of rule (b) forbids (K3; needs a decision). |
| (c) the exception | Holds. A legacy product saves as a draft in its own currency; a stored amount discount saves unchanged. No path lets such a draft reach a buyer. |
| (d) nothing deleted or rewritten | Holds. No SQL, no automatic write; forms and the designer send the stored currency back unchanged. |
| Mergeable | **Mergeable after listed fixes: K4** (the setup checklist and `get_store` tell a seller their page is live and hand out a link that 404s). K5 is worth doing in the same pass. Everything else can follow. No blocker, no major. |

## 2. Findings

| ID | Severity | Finding |
|---|---|---|
| K1 | P3 | Not quite "absent like a takedown": the embed JSON still lists the tile and its link, the public reviews API still serves its reviews, and a hidden host still gives its add-ons a page. No price, quote or charge on any of them. The agent-surface doc claims more than this |
| K2 | P3 | `setProductStatus` checks the stored currency, then writes `status` unconditionally. Interleaved with two form saves, a product ends up active in a legacy currency. The read side still hides it |
| K3 | P3 | A legacy draft may be re-priced in its own legacy currency (EUR 29.90 to EUR 35.00), which writes a new EUR price-history row. Rule (b) says no re-price in such a currency; the code reads (c) as allowing it. Decide |
| K4 | minor | The setup checklist (Overview and `get_store`) ignores the currency rule: "Your product page is live", with a copyable link that 404s, for a product hidden for its currency |
| K5 | minor | A seller the market refuses (R1) is told to reprice first: every publish path asks the currency before the seller gate, and the Needs attention row says repricing shows the products again, which is false while R1 holds |
| K6 | minor | The seller cannot see which products are hidden: the row opens the whole list (the paused row opens the one product), and neither the product card nor the designer tile marks a live product hidden for its currency |
| K7 | minor | Editing a live legacy product's title or price on the designer tile is refused with "change its price ... or it can only be a draft", neither of which the designer can do, and with no link to the form |
| K8 | nit | `get_schema` (product, discount) still advertises EUR, USD and CZK, while every tool description says CZK only |
| K9 | nit | The Needs attention description is plural for one product ("These stay saved: change their prices"), in every locale |

## 3. Details

### K1. Three reads do not treat a currency-hidden product like a takedown (P3)

What I verified first: none of these shows a price, quotes or takes money. They break only the "absent like a takedown" half of rule (a), which the commit's own doc repeats (`docs/agent-surface.md:313-317`: "hidden from every buyer surface ... exactly like a takedown").

1. **Embed widget JSON.** `src/app/api/embed/[key]/route.ts:268-297` drops only tiles whose product has `moderation_status <> 'ok'` (`:281-284`). A tile for an active EUR product stays in the payload with its `productId` and a `productUrl` (`:347-365`) that 404s. The response is CDN-cached for 5 minutes (`:204`). The widget no longer uses this route (`public/widget.js` only builds the `/e/` frame), but the route is still public to allowlisted origins.
   - Scenario: seller embeds a board with an EUR product, enables the embed, an allowlisted site fetches `/api/embed/<key>`: the tile is there, link dead.
   - Note: drafts are in this payload too (no status filter), so this is not a new kind of leak, only a gap against the stated rule.
   - Fix: ask the currency in the same read: `.or(\`moderation_status.neq.ok,currency.not.in.(${MARKET.currencies.join(",")})\`)` and keep the fail-closed path.
   - Test: an embed route test with one product priced outside the market: its tile is absent from `blocks`.
2. **Public reviews API.** `GET /api/products/[id]/reviews` (`src/app/api/products/[id]/reviews/route.ts:55-77`) asks `isReviewableProduct` (`src/lib/reviews/queries.ts:73-84`): active and not taken down, no currency. Anyone with the product id gets its rating summary and reviews.
   - Fix: check `offeredInMarket` in the GET only. Do not add it to `isReviewableProduct` itself: the POST uses it too, and a buyer's review of goods already bought is post-sale.
   - Test: GET answers 404 for a product priced outside the market; POST from a valid order link still answers 201.
3. **Add-on host.** `offeredByTiles` (`src/lib/products/purchasable.ts:439-469`) decides that a non-tile product is "offered here" when a live tile's product lists it. It skips a taken-down host (`:465`) but not a host priced outside the market. So an EUR host (hidden) still gives a CZK add-on its own product page and checkout on that storefront. No R2 money breach (the add-on is in CZK), but a hidden product is still acting on the storefront, which a taken-down one is not.
   - Fix: add `currency` to the select at `:454` and `if (!isContentVisible(...) || !offeredInMarket(host)) continue;`.
   - Test: in `product-add-ons.test.ts`, host priced outside the market, add-on not a tile: `gatePurchasable(addOn)` is null.

### K2. The card toggle can be raced into "active in EUR" (P3)

- Where: `src/lib/products/card-actions.ts:72-100`. The stored currency is read at `:73-78`; then `publishBlockedError` and `precheck` run (`:87`, `:92`, the second a moderation check that can take a while); then `.update({ status })` at `:94-100` with no condition on the currency.
- Scenario (all the seller's own requests, three tabs): product stored EUR, draft.
  1. Tab A saves the form as EUR draft (allowed: stored EUR). Its read happens; its write is slow (HEAD checks, badge check, precheck).
  2. Tab C saves CZK draft. Written.
  3. Tab B presses Make active. Its read sees CZK: allowed.
  4. Tab A's write lands: currency EUR, status draft.
  5. Tab B's write lands: status active.
  Result: EUR, active. The gate hides it and the Needs attention row counts it. Buyers see nothing; it is a write-side hole in (b) only, until the planned guard (DB-02) exists.
- Fix: when `status === "active"`, add `.in("currency", [...MARKET.currencies])` to the update; on zero rows, re-read to tell "not found" from the currency refusal.
- Test: a fake client whose stored currency changes between the read and the update: no update with `status: "active"` reaches a row in a non-market currency.

### K3. Re-pricing a legacy draft in its own currency is allowed (P3, decision)

- Where: `src/lib/market/problems.ts:113-122`. The exception is "same currency and draft"; the price may change. `updateProduct` writes `price_cents` (`src/lib/products/actions.ts:533-539`), and the trigger `products_record_price_update` (`supabase/migrations/20261004_discounts.sql:291-296`) then inserts a new `product_price_history` row in EUR.
- Scenario: a CZ seller opens a legacy EUR draft, changes 29.90 to 35.00, keeps EUR, saves: accepted.
- Why it matters: rule (b) lists "re-price" as forbidden in a non-market currency, while (c) only says "saved as a draft in that same currency". The discount exception is explicit ("unchanged"); the product one is not. The commit reads (b)'s "re-price" as "move to another such currency". Nothing reaches a buyer either way.
- Fix, if (b) means what it says: also require `next.priceCents === stored.priceCents` in `productCurrencyProblem` (the stored read in `updateProduct` gains `price_cents`; the designer tile then cannot re-price a legacy draft). Otherwise, reword (b).
- Test: `catalogue-currency-write-paths.test.ts`: legacy draft saved with a new price refused with context `price`; with the same price, saved.

### K4. The checklist says "live" for a hidden product, with a dead link (minor)

- Where: `src/lib/onboarding/steps.ts:198-202`. `live` is the first placed, active product that is not checking or paused. `outsideMarketProductIds` is computed by this commit (`src/lib/dashboard/queries.ts:313-315`) but never reaches the checklist: both callers pass only `activeProductIds`, `checkingProductIds` and `pausedProductIds` (`src/app/(dashboard)/dashboard/page.tsx:174-181`, `src/lib/agent/tools/store.ts:57-75`). The step then says `Onboarding.steps.publish.detailDone` ("Your product page is live.") and `livePage` (`steps.ts:235-241`) becomes a copyable URL (`src/components/onboarding/SetupChecklist.tsx:175`) and `get_store`'s `livePageUrl`.
- Scenario: a Czech seller with trader details done and one product, priced in EUR from before CZK was storable, placed and active. Overview: the checklist ticks "Publish its page", says it is live and offers the link; the link 404s. Two rows lower, Needs attention says "1 product not priced in CZK". The assistant's `get_store` hands the same dead link. The file's own comment (`steps.ts:194-196`) says claiming live early "would hand the seller a link that answers 404".
- Fix: add `outsideMarketProductIds` to `SetupFacts`, pass it from both callers, and treat it as a hold: not done, no `livePage`, detail from the existing `Errors.marketRestricted.currency.fix.publish` (no new copy), action "Edit product" to that product.
- Test: `buildSetupSteps` with one placed active product in `outsideMarketProductIds`: publish step not done, `livePage` null; add a second placed CZK product: `livePage` is the CZK one.

### K5. A seller the market refuses is told to reprice (minor, order of checks)

- Where: the currency rule runs before the seller gate on every publish: `src/lib/products/card-actions.ts:84-88`, `src/lib/products/actions.ts:502-514`, `src/lib/agent/tools/products.ts:308-316`. The Needs attention row is built whatever the seller gate says (`src/lib/dashboard/attention.ts:251-267`) and promises "change their prices to show them again".
- Scenario: a seller established in Germany from the old EU beta, with live EUR products. Make active: "To sell it, change its price from EUR to CZK." They reprice into koruna; the next save says "Selling is paused: for now, Square Share is open only to sellers established in the Czech Republic." On Overview, the "Selling is paused" row and "3 products not priced in CZK ... change their prices to show them again" sit side by side. The second is false while R1 holds. `leadingSellBlock` (`src/lib/market/problems.ts`) already follows the opposite principle: a market block leads, because nothing else helps while it holds.
- Fix: for `status === "active"`, ask the publish gate before the currency rule in the three places. In `buildAttentionItems`, skip the `price-currency` row when `sellerGate` carries a market block.
- Test: R1-blocked seller, EUR draft, Make active: the seller-country refusal, not the currency one. `build({ sellerGate: [market block], products: { outsideMarketProductIds: ["p1"] } })` has no `price-currency` row.

### K6. The seller cannot see which products are hidden (minor)

- Where: the row's link is the whole list (`src/lib/dashboard/attention.ts:263`), while the paused row beside it opens the one product's editor when there is one (`:238-249`). On the list, `StatusBadge` (`src/components/products/StatusBadge.tsx:17-29`) flags only drafts, on the stated principle that a status whose page 404s "is the one status that actually needs to be seen"; a live product hidden for its currency gets no chrome. The designer tile badges drafts only (`src/components/storefront/BlockTile.tsx:794-801`), so the designer shows the hidden product as an ordinary live tile.
- Scenario: 40 products, 3 in EUR. "Change prices" opens 40 cards, all "Active", and the seller has to find the three by the currency sign.
- Fix: one product: link to `productEditPath(id)`, as the paused row does. A card chip and a designer badge when `!offeredInMarket(product)` (the client already has `product.currency`; the predicate is client-safe). Branch 09's list covers the pickers and the sample storefront, not these markers, so they would otherwise be nobody's.
- Test: attention row with one id links to that product's editor; a ProductCard component test shows the chip for an active product priced outside the market.

### K7. The designer tile gives a fix it cannot carry out (minor)

- Where: `src/components/storefront/ProductBlockEditor.tsx:214-226` sends the stored currency and status back. For a live EUR product, `updateProduct` refuses with context `publish` (`src/lib/products/actions.ts:502-506`), and passes no product id, so `currencyRestricted` (`src/lib/errors.ts:350`) adds no link.
- Scenario: in the designer, the seller fixes a typo in a live EUR product's title. Toast: "To sell it, change its price from EUR to CZK. Until then it can only be a draft." The panel has neither a currency nor a status control, and the toast has no way to the form.
- Fix: in the editor, when the refusal is `market_restricted` and has no `action`, add `{ href: productEditPath(product.id), label: msg("Errors.marketRestricted.currency.action") }` before showing it. (Passing the id from `updateProduct` would also link the form to itself.)
- Test: a ProductBlockEditor component test with that refusal mocked: the toast links to the product's editor.

### K8. `get_schema` still lists every storable currency (nit)

- Where: `src/lib/agent/tools/storefronts.ts:184-192` serialises `productWriteSchema` (`currency: z.enum(CURRENCIES)`, `src/lib/validation/product.ts:480`) and `discountInputSchema` (`src/lib/validation/discounts.ts:41`). The tool descriptions and enums now say CZK only.
- Effect: an assistant that writes a discount from `get_schema` meets `market_restricted` for EUR. It recovers from the refusal's fix, so this is only noise.
- Fix: narrow `currency` to `MARKET.currencies` in what `get_schema` returns for these two, or say in its description that a write takes only the market's.
- Test: `get_schema` for `product` and `discount` lists exactly `MARKET.currencies`.

### K9. Plural copy for one product (nit)

- Where: `Dashboard.attention.priceCurrency.description` in all ten locales (English `messages/en/dashboard.json:162`, Czech "Tyto produkty zůstávají uložené: když jim změníte cenu"). The label is pluralised; the description is not passed `count`.
- Fix: pass `count` and use `{count, plural, one {...} other {...}}` as the paused row does.
- Test: the existing row test with one id asserts the singular sentence.

## 4. With no database guards yet: what a buyer could still see or be charged

Deferred work, not a finding. Case: a seller PATCHes their own `products` row through PostgREST (`currency` to EUR or USD, `status` to active, any price).

- **Shown:** nothing priced. No tile on the hosted board or the embed frame, product page and checkout page 404, no share image, not in the sitemap, the cart shows the line as no longer sold, the discount check ignores it. Still answering: the embed JSON tile id and dead link, and the reviews API (K1).
- **Quoted:** never. `quoteOrder` and the cart routes refuse the line as `not_found`.
- **Charged:** only an order whose payment page was opened before the PATCH. The Stripe session already holds the quote's amount in CZK (`src/lib/checkout/stripe-provider.ts:115`), and neither the webhook nor the order writer (`src/lib/orders/record.ts:371-374`) re-reads the product's currency. So the buyer pays the old CZK price for a product now priced in EUR. The charge itself is always in a market currency, because a quote can only be built from lines the gate admitted.
- Through PostgREST on `discounts`: an EUR amount discount reduces only EUR products, which never sell, so it is inert.
- The column default of `products.currency` is never relied on: create, duplicate (spreads the source row) and import all send a currency.

## 5. Verified and found correct (in code)

- The shared gate `visiblePlacedRows` (`purchasable.ts:360-364`) asks `offeredInMarket`; it feeds the product page, its metadata and JSON-LD, the product checkout page, the cart page, both cart routes, the discount check, the quote, and `loadStoreItems` (cart suggestions). `assessLines` asks it again (`quote.ts:249`), so a hand-built gate (quick add, tests) is held too. `canPriceDelivery` asks it first.
- `buildStorefrontPage` (hosted board and embed frame) builds tiles, prices, extras and quick adds only from rows that pass (`storefront-page.ts:281`). Sitemap (`sitemap.ts:189`) and share image (`og/p/[productId]/route.ts:86`) likewise.
- Add-ons: offered only in the host's currency, and the host passed the gate, so always a market currency. A non-tile add-on's page and checkout go through the same gate.
- The Stripe session's currency and amounts come from the quote only. A product moved after it entered a cart is re-gated at view and at placement.
- Drafts never reach a buyer read: every buyer read filters `status = active`. The only draft renderers are the seller's own previews (form preview, assistant preview behind a short-lived token), which already showed drafts before this commit.
- No buyer data is cached across requests (no `use cache`, `unstable_cache` or `revalidate` in `src`), except the embed JSON's 5-minute CDN cache.
- Writes: `createProduct`, `updateProduct` (form, designer tile, `update_product`), `setProductStatus`, `duplicateProduct`, `importProducts` (UI and `import_products`), `publish_products` (draft and already active, never reported live), `createDiscount`, `updateDiscount` (started legacy sale's end can still move) all refuse correctly; read failures fail closed. `update_product` without a currency sends the stored one, so a legacy product edits only as a draft.
- The `market` parameters: no production call passes one; none of the files that take one is a `"use server"` module, so no client can supply one; `MARKET` and its lists are frozen; the no-override scan still holds.
- R1: no regression. The seller gate still runs on every publish path; only its position moved (see K5).
- Copy: all ten locales carry the same keys and placeholders (`{currencies}`, `{currency}`, `{count}`); plural categories are valid per locale; the Czech is grammatical and says what the English says; no currency is spelled in copy or code paths that render copy; no em or en dash added.
- Coverage test: every newly enforced R2 cell (P-01 to P-08, I-01, I-02, D-01, D-02, C-01 to C-04, C-07, AD-02, AD-03) cites a test that calls the entry point with a currency outside the market and checks the refusal or absence. Exempt cells (P-09 to P-14, I-03, D-03 to D-05) are true.
- No new read on a buyer hot path; `updateProduct` reads only when the currency is outside the market; Make active gains one indexed read.
- Team members: every check is keyed on the active account, not the role.
- A stored currency that is not even storable: absent on every buyer read, refused on every write.

## 6. Could not check

- Nothing was run. In particular the new tests, the type check and the end-to-end specs (which still seed EUR) were not executed.
- Production data: how many live products and discounts are in EUR or USD now, and whether internal catalogues were converted before this deploys (P1a 7.3 step 2). That decides how many sellers meet K4 to K7.
- The Stripe-hosted payment page after a product is edited (section 4) is inferred from code, not observed.
- Whether a moderation settle can ever change `status` (taken from the inventory, J-06: moderation columns only).
