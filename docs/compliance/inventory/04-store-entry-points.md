# 04. Store entry points: complete write-path checklist

Part 4 of 9 of the Czech-only beta compliance inventory. Investigation only: nothing in the repo was changed. Read on 2026-11-22 against Store `main` at `e43eedd` (tree clean at start).

Purpose: a breadth-first, exhaustive list of every way something can be written in the Store repo, so that when the R1 to R8 validators are added, no entry point is left uncovered. Depth on sellers, catalog and selling is in the sibling reports; here each entry gets one line.

Conventions

- Every path is repo-prefixed (`Store/...`). `(inferred)` marks anything not opened.
- **Touches** uses only: seller, connected-account, product, price/currency, discount, shipping-policy, storefront, checkout, order, refund, none.
- Auth vocabulary: **anon** (no session, buyer or stranger), **seller** (signed-in Supabase session, store-scoped through `getActiveAccount` or person-scoped through `getUser`), **agent** (MCP bearer token), **cron** (`Authorization: Bearer CRON_SECRET`, `Store/src/lib/ops/cron.ts:50`), **ops** (`Bearer ERROR_REPORT_TOKEN`, `Store/src/lib/ops/cron.ts:56-63`), **webhook** (Stripe signature), **service** (pg_cron, scripts, internal).
- Global side effect not repeated per row: almost every route and action spends a rate-limit token (`rateLimit` / `rateLimitKey`, `Store/src/lib/rate-limit.ts`), which is itself a database write (Postgres `rl_take`, per memory note avatars-and-rate-limiting; inferred). Touches: none.

Counts

| Category | Count |
| --- | --- |
| MCP tools | 66 (36 write, 30 read) in 10 files |
| Route handler files | 63 (58 production, 5 dev-only `route.dev.ts`) |
| `"use server"` files / exported actions | 29 files / 100 actions |
| GitHub Actions schedules that write | 6 jobs in 2 workflows |
| pg_cron jobs | 4 |
| Cloudflare cron triggers | 0 in Store's Worker; 1 in the separate `ops/uptime` Worker (writes KV only) |
| Page renders and `after()` callbacks that write | 10 sites |
| Scripts that write (DB, R2, Supabase config) | 9 (all gated to dev or a token) |
| `/dev` harness routes | 5 route handlers (2 write) + 42 lab pages |

---

## 1. MCP tools (remote MCP server at `/mcp`)

### 1.0 How a tool call reaches the database

| Step | Where | What it decides |
| --- | --- | --- |
| Route | `Store/src/app/mcp/route.ts:10` (POST; GET `:14` and DELETE `:18` answer 405) | entry |
| Switch | `Store/src/lib/agent/mcp-transport.ts:141` via `agentAccessEnabled` `Store/src/lib/agent/access.ts:10` (`AGENT_ACCESS_ENABLED="true"` in `Store/wrangler.jsonc:61`) | 404 when off |
| Token | `authenticateAgentRequest` `Store/src/lib/agent/authenticate.ts:26`, called `mcp-transport.ts:144` | opaque bearer, grant, scopes |
| Identity | `runAsAgent` `Store/src/lib/agent/context.ts:39`, `mcp-transport.ts:152`; `getActiveAccount` then resolves the grant's store (`mcp-transport.ts:153`) | the same server actions run unchanged under the agent context (`Store/docs/mcp.md:34-37`) |
| Listing | `buildServer` `mcp-transport.ts:89-90` lists only tools passing `toolAvailable` | |
| Gate | `toolAvailable` `Store/src/lib/agent/dispatch.ts:53-63`: `enabled()`, grant scope, role `can()`, `ownerOnly` | |
| Budget, input | `dispatch.ts:100-108` (`agent_write` / `agent_read` budgets, zod parse) | |
| Trail | `recordToolCall` for every non-read tool `dispatch.ts:90-92` writes `agent_audit_log` (`Store/src/lib/agent/oauth/grants.ts:391`) | |

Consequences for the validator build:

1. A check placed inside a server action (or in a schema the action uses) is inherited by the matching tool, because tools call the actions directly.
2. Several tools also pre-validate with the same shared schemas before calling the action: `productWriteSchema` (`Store/src/lib/agent/tools/products.ts:85-88`), `storefrontConfigSchema` (`Store/src/lib/agent/tools/storefronts.ts:276`, `:363`), `shippingPolicySchema` (`storefronts.ts:436`), `discountInputSchema` (`Store/src/lib/agent/tools/discounts.ts:27-30`).
3. `update_product_page`, `update_checkout_page`, `update_cart_page` invoke the route handlers' exported `PATCH` in-process with a synthetic `Request` to `https://agent.invalid` (`storefronts.ts:5-13`, `:88-94`, `:380-406`). A check added to `pageConfigRoute`'s PATCH (`Store/src/lib/storefront/page-config-route.ts:147`) covers them; a same-origin check added there would break the three tools.
4. Currency is an enum in the tool inputs: `CURRENCIES = ["EUR", "USD"]` (`Store/src/types/product.ts:12`), used by `create_product` (`products.ts:177`), `update_product` (`:205`), `import_products` (`:348`). CZK is not accepted anywhere through MCP today; R2 changes this enum (or replaces it with config) for UI and MCP at once.

### 1.1 Write tools (36)

| Tool | Scope | Role permission | file:line | Calls | Writes | Touches |
| --- | --- | --- | --- | --- | --- | --- |
| update_username | profile:write (ownerOnly) | store.read | `Store/src/lib/agent/tools/store.ts:159` | `updateUsername` `Store/src/lib/settings/actions.ts:144` | `profiles.username` | seller |
| update_bio | profile:write (ownerOnly) | store.read | `store.ts:171` | `updateBio` `settings/actions.ts:198` | `profiles.seller_bio` | seller |
| save_notification_settings | profile:write (ownerOnly) | store.read | `store.ts:183` | `saveNotifications` `settings/actions.ts:584` | `profiles.notify_*` | none |
| set_avatar | profile:write (ownerOnly) | store.read | `store.ts:211` | `uploadAvatar` `Store/src/lib/settings/avatar.ts:59` (fetches URL) | avatar bucket, `profiles.avatar_url` | seller |
| remove_avatar | profile:write (ownerOnly) | store.read | `store.ts:227` | `removeAvatar` `avatar.ts:138` | avatar bucket, `profiles` | seller |
| create_product | products:write | products.write | `Store/src/lib/agent/tools/products.ts:167` | `createProduct` `Store/src/lib/products/actions.ts:341` | `products` insert (price, currency, status, shipping profile) | product, price/currency, shipping-policy |
| update_product | products:write | products.write | `products.ts:194` | `updateProduct` `products/actions.ts:431` | `products` update (incl. status active = publish gate) | product, price/currency, shipping-policy |
| publish_products | products:write | products.write | `products.ts:231` | `updateProduct` per id with `status: "active"` (`products.ts:276-284`) | `products.status` | product, price/currency |
| import_products | products:write | products.write | `products.ts:338` | `importProducts` `Store/src/lib/products/import-actions.ts:111` | `products` bulk insert with one `currency` | product, price/currency |
| update_stock | products:write | products.write | `products.ts:358` | `updateStockSettings` `Store/src/lib/stock/actions.ts:53` | `products` stock columns | product |
| move_product_badge | products:write | products.write | `products.ts:388` | `moveProductBadge` `Store/src/lib/products/badge-actions.ts:73` | `products.details` badges | product |
| upload_image | products:write | products.write | `products.ts:406` | `storeImage` (`Store/src/lib/uploads/store-image.ts`), `rememberUpload` `Store/src/lib/agent/object-refs.ts:118` | R2 object, `agent_uploads` | product (asset only) |
| delete_product | destructive (opt-in) | products.write | `products.ts:439` | `deleteProduct` `products/actions.ts:597` | `products` delete | product |
| create_storefront | storefronts:write | storefront.write | `Store/src/lib/agent/tools/storefronts.ts:226` | `createStorefront` `Store/src/lib/storefront/actions.ts:110` | `storefronts` insert | storefront |
| edit_storefront | storefronts:write | storefront.write | `storefronts.ts:240` | `applyDesignOps` then `saveStorefront` `storefront/actions.ts:218` | `storefronts.config` (blocks, theme) | storefront, product (placement) |
| upload_element | storefronts:write | storefront.write | `storefronts.ts:306` | `storeElement`, `rememberUpload` | R2 object, `agent_uploads` | storefront (asset only) |
| save_storefront | storefronts:write | storefront.write | `storefronts.ts:342` | `saveStorefront` `storefront/actions.ts:218` (whole config members) | `storefronts.name`, `storefronts.config` incl. checkout/cart/product page members | storefront, checkout |
| update_product_page | storefronts:write | storefront.write | `storefronts.ts:373` | PATCH `Store/src/app/api/storefronts/[id]/product-page/route.ts:102` | `storefronts.config.productPage` (`page-config-route.ts:202`) | storefront |
| update_checkout_page | storefronts:write | storefront.write | `storefronts.ts:385` | PATCH `Store/src/app/api/storefronts/[id]/checkout-page/route.ts:92` | `storefronts.config.checkoutPage` | storefront, checkout |
| update_cart_page | storefronts:write | storefront.write | `storefronts.ts:397` | PATCH `Store/src/app/api/storefronts/[id]/cart-page/route.ts:68` | `storefronts.config.cartPage` | storefront, checkout |
| update_embed_settings | storefronts:write | storefront.write | `storefronts.ts:409` | `updateEmbedSettings` `storefront/actions.ts:478` | `storefronts.config.embed` (enable = sells on any allowed site) | storefront, checkout |
| save_shipping_policy | storefronts:write (ownerOnly) | storefront.write | `storefronts.ts:427` | `saveShippingPolicy` `Store/src/lib/settings/shipping-actions.ts:71` | `profiles.shipping_policy` (destinations, profiles) | shipping-policy |
| delete_storefront | destructive (opt-in) | storefront.write | `storefronts.ts:443` | `deleteStorefront` `storefront/actions.ts:554` | `storefronts` delete | storefront |
| rotate_embed_key | destructive (opt-in) | storefront.write | `storefronts.ts:457` | `rotateEmbedKey` `storefront/actions.ts:614` | `storefronts.embed_key` | storefront |
| mark_order_shipped | orders:fulfil | orders.fulfil | `Store/src/lib/agent/tools/orders.ts:85` | `markOrderShipped` `Store/src/lib/orders/actions.ts:72` | RPC `order_mark_shipped` (`orders/actions.ts:103`), buyer email | order |
| refund_order | orders:refund (opt-in) | orders.refund (owner only) | `orders.ts:104` | `refundOrder` `orders/actions.ts:231` | Stripe `POST /refunds` (`orders/actions.ts:478`) then RPC `order_apply_refund` / `order_refund` (`:431-432`), buyer email | refund, order, connected-account |
| create_discount | discounts:write | products.write | `Store/src/lib/agent/tools/discounts.ts:71` | `createDiscount` `Store/src/lib/discounts/actions.ts:122` | `discounts` insert (amount discounts carry a currency) | discount, price/currency |
| update_discount | discounts:write | products.write | `discounts.ts:85` | `updateDiscount` `discounts/actions.ts:159` | `discounts` update | discount, price/currency |
| set_code_enabled | discounts:write | products.write | `discounts.ts:99` | `setCodeEnabled` `discounts/actions.ts:223` | `discounts.enabled` | discount |
| end_sale | discounts:write | products.write | `discounts.ts:110` | `endSale` `discounts/actions.ts:244` | `discounts.ends_at` | discount |
| delete_discount | destructive (opt-in) | products.write | `discounts.ts:121` | `deleteDiscount` `discounts/actions.ts:269` | `discounts.archived_at` | discount |
| set_review_visibility | reviews:write | products.write | `Store/src/lib/agent/tools/reviews.ts:64` | `setReviewVisibility` `Store/src/lib/reviews/actions.ts:38` | RPC `review_set_visibility` (`reviews/actions.ts:71`) | none |
| mark_notification_read | notifications:write | store.read | `Store/src/lib/agent/tools/notifications.ts:45` | `markNotificationRead` `Store/src/lib/notifications/actions.ts:152` | `notifications.read` | none |
| mark_all_notifications_read | notifications:write | store.read | `notifications.ts:56` | `markAllNotificationsRead` `notifications/actions.ts:175` | `notifications.read` | none |
| request_moderation_review | moderation:write | store.read | `Store/src/lib/agent/tools/moderation.ts:8` | `requestModerationReview` `Store/src/lib/moderation/review-request.ts:74` | flag on `products` or `storefronts` row (`review-request.ts:98`, `:131`) | product, storefront |
| file_moderation_appeal | moderation:write | store.read | `moderation.ts:22` | `fileModerationAppeal` `Store/src/lib/moderation/appeals.ts:68` | `moderation_appeals` insert (`appeals.ts:136`) | none |

### 1.2 Read tools (30)

All `READ` annotated, scope `store:read` unless noted; none writes beyond the rate limit, except the previews which mint a stateless token and drive a browser.

`get_store` (`store.ts:28`), `get_profile` (`:87`), `list_team` (`:111`), `list_plan_prices` (`:137`); `list_products` (`products.ts:92`), `get_product` (`:117`), `get_products_summary` (`:138`), `get_product_sales` (`:156`), `check_badge_label` (`:377`, scope products:write, readOnlyHint); `list_storefronts` (`storefronts.ts:115`), `get_storefront` (`:139`), `get_schema` (`:164`), `get_product_page` (`:176`), `get_checkout_page` (`:188`), `get_cart_page` (`:200`), `get_shipping_policy` (`:212`); `preview_storefront` (`Store/src/lib/agent/tools/previews.ts:207`, behind `AGENT_PREVIEW_ENABLED`), `preview_product_page` (`previews.ts:278`); `list_orders` (`orders.ts:18`, scope orders:read), `get_order` (`:54`, orders:read), `get_order_counts` (`:71`, orders:read); `list_discounts` (`discounts.ts:34`), `get_discount` (`:45`), `get_discount_performance` (`:60`); `list_reviews` (`reviews.ts:13`), `get_review_overview` (`:53`); `get_analytics` (`Store/src/lib/agent/tools/analytics.ts:15`), `get_dashboard_summary` (`:36`); `list_notifications` (`notifications.ts:7`), `get_unread_count` (`:34`).

### 1.3 Reconciliation against the known list

- All 27 known names exist, at the lines above.
- Extra write tools not in the known list: `remove_avatar`, `move_product_badge`, `delete_product`, `delete_storefront`, `rotate_embed_key`, `refund_order`, `delete_discount`, `mark_notification_read`, `mark_all_notifications_read`.
- The four `destructive` tools and `refund_order` are behind opt-in scopes that start unticked (`Store/src/lib/agent/scopes.ts:82-93`, `initialScopes` `:119-125`), so a normal grant does not list them. The SquareShare connector visible in this session's environment lists exactly the non-opt-in set, which is consistent.
- Scope registry: 12 scopes (`scopes.ts:30-94`).

### 1.4 Refund tool and scope

Yes. `refund_order` (`orders.ts:104`) with scope `orders:refund`, opt-in (`scopes.ts:82-87`), role permission `orders.refund`, which only the owner holds (`Store/tests/unit/agent/registry.test.ts:313-317`). `refundOrderLine` (`orders/actions.ts:302`) is classified `deferred` (`registry.test.ts:136-139`), so it has no tool yet.

### 1.5 Actions deliberately not exposed as tools

From the COVERAGE map in `Store/tests/unit/agent/registry.test.ts:41-170` (the test fails if any `"use server"` export is unclassified, `:197-203`) and `Store/docs/mcp.md:100-103`.

| Class | Actions | Reason (as written) |
| --- | --- | --- |
| person: agent surface | `approveAgentConnection`, `revokeConnectedApp` | an assistant must not approve itself; revoking is the person's call (`registry.test.ts:43-44`) |
| person: sign-in, 2FA, passkeys, sign-in approval | all of `auth/actions.ts` except `signOut`, all 16 of `mfa-actions.ts`, all 6 of `sign-in-approval-actions.ts` | SIGN_IN, SECOND_FACTOR (`:35-36`, `:47-73`) |
| person: step-up gated | `requestEmailChange`, `saveTaxInfo`, `requestAccountDeletion`, `inviteMember`, `changeMemberRole`, `revokeMemberAccess` | STEP_UP (`:37`, `:82-86`, `:96-98`); a test refuses any tool over an action calling `requireStepUp` (`:219-231`) |
| person: other account | `sendPasswordReset`, `acceptLegal`, `cancelAccountDeletion`, `saveSuggestAsYouType`, `acceptInvite`, `runNotificationAction` | `:79-87`, `:99`, `:155` |
| person: money | `startCheckout`, `openBillingPortal`, `cancelPlan`, `resumePlan`, `startStripeOnboarding`, `openStripeDashboard` | MONEY; Stripe identity checks in the person's browser; bearer link (`:159-164`); a test refuses any tool over `billing/` or `payments/` (`:212-217`) |
| person: proof | `sendContactCode`, `confirmContactCode` | the code proves the person reads the inbox (`:39`, `:91-92`) |
| person: AI help | `suggestProductDescription`, `suggestDescriptionCompletion` | spends the store's AI budget for a person at the form (`:115-120`) |
| browser | `signOut`, `setLocale`, `setActiveAccount`, `getAddOnPicker`, `getRealtimeToken`, `completeOnboarding`, `markSetupCelebrated`, `markEditorTourSeen` | about one browser (`:50`, `:93`, `:100`, `:111`, `:156`, `:167-169`) |
| deferred | `refundOrderLine` | needs order lines in `get_order` first (`:136-139`) |
| not exposed (routes, docs) | digital file, font and document uploads; review CSV import and export; payments overview | `Store/docs/mcp.md:100-103` |

Compliance note: **the step-up gate is what keeps `saveTaxInfo` (trader country and address) and `startStripeOnboarding` (connected account) out of MCP**, so R1 inputs can only change through a seller session. Product currency, shipping policy, embeds and storefront checkout settings are reachable by an agent token.

---

## 2. Route handlers under `Store/src/app`

### 2.1 Buyer-facing (anonymous)

| Path | Methods | file:line | Auth | Writes | Touches |
| --- | --- | --- | --- | --- | --- |
| `/api/checkout/[storefrontId]/[productId]` | POST | `Store/src/app/api/checkout/[storefrontId]/[productId]/route.ts:22` | anon; same-origin, `checkout_place` budget, Turnstile (`Store/src/lib/checkout/place-order.ts:102-126`) | quote with `country: shipTo.country` (`place-order.ts:128-139`), pending order via RPC `order_place` (`Store/src/lib/orders/record.ts:472`), Stripe Checkout Session on the connected account (`Store/src/lib/checkout/stripe-provider.ts:71`, `:124`) | checkout, order, price/currency, discount, shipping-policy, connected-account |
| `/api/checkout/[storefrontId]` (cart) | POST | `Store/src/app/api/checkout/[storefrontId]/route.ts:19` | anon; same as above | same as above, multi-line, closes the cart | checkout, order, price/currency, discount, shipping-policy, connected-account |
| `/api/checkout/[storefrontId]/[productId]/discount` | POST | `.../[productId]/discount/route.ts:13` | anon; `discount_check` budget (`Store/src/lib/checkout/discount-check.ts:63`) | nothing (read) | discount, checkout |
| `/api/checkout/[storefrontId]/discount` | POST | `Store/src/app/api/checkout/[storefrontId]/discount/route.ts:11` | anon | nothing (read) | discount, checkout |
| `/api/checkout/cancel` | GET | `Store/src/app/api/checkout/cancel/route.ts:42` | anon; checkout id is the capability (`:30-33`) | Stripe `POST /checkout/sessions/{id}/expire` on the connected account (`:69`), RPC `order_release_pending` deletes the pending order (`:70`, `record.ts:331`) | order, connected-account |
| `/api/cart/[storefrontId]` | POST | `Store/src/app/api/cart/[storefrontId]/route.ts:49` | anon; same-origin, `cart_write` budget; dark unless `CART_ENABLED` (`Store/src/lib/cart/route.ts:32`) | `carts` (`Store/src/lib/cart/store.ts:79`, `:106`), `storefront_signals` + funnel after response (`route.ts:133-146`); currency mix checked by `assessLines` | checkout, price/currency |
| `/api/cart/[storefrontId]/view` | POST | `Store/src/app/api/cart/[storefrontId]/view/route.ts:26` | anon | nothing (read; delivery line uses `cf-ipcountry`, `Store/src/lib/cart/route.ts:46-48`) | checkout |
| `/api/orders/withdraw` | POST | `Store/src/app/api/orders/withdraw/route.ts:44` | anon; order link + buyer email | `orders.withdrawal_requested_at` (`:76-82`), notification + 2 emails after response (`:99-130`) | order |
| `/api/orders/lookup` | POST | `Store/src/app/api/orders/lookup/route.ts:35` | anon | email only, after response (`:46-74`) | none |
| `/api/orders/review-reminder` | POST | `Store/src/app/api/orders/review-reminder/route.ts:36` | anon; order link | `orders.review_reminder_*` (`:82-89`) | order |
| `/api/orders/review-reminder/unsubscribe` | POST, GET | `.../unsubscribe/route.ts:33`, `:44` | anon; signed order ref; POST from mail clients, no same-origin by design (`:14-20`) | POST: stop reminder (`:40`); GET: redirect only | order |
| `/api/orders/[orderRef]/download` | GET | `Store/src/app/api/orders/[orderRef]/download/route.ts:45` | anon; order link | nothing (presigned R2 link) | order |
| `/api/products/[id]/reviews` | GET, POST | `Store/src/app/api/products/[id]/reviews/route.ts:55`, `:79` | anon; POST needs order link | POST: `reviews` insert (`:109-122`), moderation after response (`:133`) | none |
| `/api/report` | POST | `Store/src/app/api/report/route.ts:131` | anon; "the only unauthenticated write" per its own comment (`:19`) | `reports` insert (`:181`), staff ping after response (`:209`) | none |
| `/api/embed/[key]` | GET, OPTIONS | `Store/src/app/api/embed/[key]/route.ts:81`, `:233` | anon; embed key + origin allowlist + trader gate (`:56-79`) | `storefront_signals` view (`:195`) | storefront |
| `/api/og/p/[productId]` | GET | `Store/src/app/api/og/p/[productId]/route.ts:52` | anon | nothing (image) | none |
| `/api/billing/plan-prices` | GET | `Store/src/app/api/billing/plan-prices/route.ts:36` | anon, CORS `*` | nothing | none |
| `/api/csp-report` | POST | `Store/src/app/api/csp-report/route.ts:36` | anon | log line only (`:52-58`) | none |
| `/offline` | GET | `Store/src/app/offline/route.ts:34` | anon | nothing | none |

### 2.2 Seller session (dashboard)

| Path | Methods | file:line | Auth | Writes | Touches |
| --- | --- | --- | --- | --- | --- |
| `/api/storefronts/[id]/checkout-page` | GET, PATCH | `Store/src/app/api/storefronts/[id]/checkout-page/route.ts:91-92` | seller (`getActiveAccount`, `storefront.write` for PATCH, `Store/src/lib/storefront/page-config-route.ts:147-151`) or agent (in-process) | PATCH: `storefronts.config` (`page-config-route.ts:202-203`) | storefront, checkout |
| `/api/storefronts/[id]/cart-page` | GET, PATCH | `Store/src/app/api/storefronts/[id]/cart-page/route.ts:67-68` | same | same | storefront, checkout |
| `/api/storefronts/[id]/product-page` | GET, PATCH | `Store/src/app/api/storefronts/[id]/product-page/route.ts:101-102` | same | same | storefront |
| `/api/uploads/image` | POST | `Store/src/app/api/uploads/image/route.ts:51` | seller, same-origin, `products.write` (`:55-60`) | R2 object only (no row; `Store/src/lib/uploads` has no `.from()`) | product (asset) |
| `/api/uploads/element` | POST | `Store/src/app/api/uploads/element/route.ts:48` | seller, `storefront.write` (`:52-55`) | R2 | storefront (asset) |
| `/api/uploads/font` | POST | `Store/src/app/api/uploads/font/route.ts:32` | seller, `storefront.write` (`:36-39`) | R2 | storefront (asset) |
| `/api/uploads/file` | POST | `Store/src/app/api/uploads/file/route.ts:53` | seller, `products.write` (`:58-61`) | presign for a digital file in R2 | product (asset) |
| `/api/uploads/document` | POST | `Store/src/app/api/uploads/document/route.ts:56` | seller, `products.write` (`:61-64`) | R2 | product (asset) |
| `/api/sellers/import-reviews` | POST | `Store/src/app/api/sellers/import-reviews/route.ts:75` | seller, `products.write` (`:76-79`) | `reviews` + `review_imports` bulk insert (inferred from purpose; after-response work `:216`) | none |
| `/api/sellers/import-reviews/check` | POST | `.../check/route.ts:33` | seller | nothing (`:22-23`) | none |
| `/api/sellers/export-reviews` | GET | `Store/src/app/api/sellers/export-reviews/route.ts:41` | seller | nothing (CSV) | none |
| `/api/orders/export` | GET | `Store/src/app/api/orders/export/route.ts:44` | seller, `store.read`, paid plan | nothing (CSV) | order |
| `/api/products/[id]/photo` | GET | `Store/src/app/api/products/[id]/photo/route.ts:37` | seller | nothing | none |
| `/api/moderation/decisions/[id]/statement` | GET | `Store/src/app/api/moderation/decisions/[id]/statement/route.ts:35` | seller | nothing (PDF) | none |
| `/api/notifications/bootstrap` | GET | `Store/src/app/api/notifications/bootstrap/route.ts:33` | seller (`getUser` `:40`) | nothing | none |
| `/api/search` | GET | `Store/src/app/api/search/route.ts:85` | seller | nothing | none |
| `/api/search/snapshot` | GET | `Store/src/app/api/search/snapshot/route.ts:39` | seller | nothing | none |
| `/api/settings/username-available` | GET | `Store/src/app/api/settings/username-available/route.ts:24` | seller (`getUser` `:25`) | nothing | none |
| `/settings/export` | GET | `Store/src/app/settings/export/route.ts:87` | seller (session gate `:88`) | nothing (GDPR export, service-role read `:122`) | none |
| `/api/payments/connect/return` | GET | `Store/src/app/api/payments/connect/return/route.ts:27` | seller, owner only (`:34`) | `seller_payment_accounts` charges/payouts/details flags via Stripe GET (`Store/src/lib/payments/connect/account.ts:129-135`) | connected-account |

### 2.3 Agent and OAuth

| Path | Methods | file:line | Auth | Writes | Touches |
| --- | --- | --- | --- | --- | --- |
| `/mcp` | POST (GET, DELETE 405) | `Store/src/app/mcp/route.ts:10` | agent | everything in section 1.1 | all |
| `/oauth/register` | POST, OPTIONS | `Store/src/app/oauth/register/route.ts:22` | anon (RFC 7591) | `agent_clients` (`registerClient`, inferred table) | none |
| `/oauth/token` | POST, OPTIONS | `Store/src/app/oauth/token/route.ts:37` | anon + PKCE code or refresh token | `agent_auth_codes`, `agent_tokens`, `agent_grants` (`grants.ts:142-290`) | none |
| `/oauth/revoke` | POST, OPTIONS | `Store/src/app/oauth/revoke/route.ts:24` | anon (RFC 7009) | `agent_tokens` delete (`grants.ts:301-315`) | none |
| `/oauth/authorize` | page, not a route | `Store/src/app/oauth/authorize/page.tsx` | seller; consent posts `approveAgentConnection` (section 3) | grant + code | none |
| `/.well-known/oauth-authorization-server` | GET, OPTIONS | `Store/src/app/.well-known/oauth-authorization-server/route.ts:6` | anon | nothing | none |
| `/.well-known/oauth-protected-resource` | GET, OPTIONS | `Store/src/app/.well-known/oauth-protected-resource/route.ts:6` | anon | nothing | none |
| `/.well-known/oauth-protected-resource/mcp` | GET, OPTIONS | `.../oauth-protected-resource/mcp/route.ts:6` | anon | nothing | none |
| `/auth/callback` | GET | `Store/src/app/(auth)/auth/callback/route.ts:25` | anon + Supabase code (Google, magic link, signup confirmation) | Supabase session cookie, locale cookie | seller (account activation) |
| `/auth/confirm` | GET | `Store/src/app/(auth)/auth/confirm/route.ts:17` | anon + token hash | Supabase session | seller (account activation) |

### 2.4 Webhooks

| Path | Methods | file:line | Auth | Writes | Touches |
| --- | --- | --- | --- | --- | --- |
| `/api/payments/webhook` (Stripe Connect) | POST | `Store/src/app/api/payments/webhook/route.ts:32` | webhook signature (`:38-46`); 404 unless Connect live (`:33`) | `stripe_events`; `account.updated` -> account flags (`Store/src/lib/payments/connect/webhook.ts:165-175`); `checkout.session.completed` -> RPC `order_confirm_paid` + fees (`:177-214`); `checkout.session.expired` -> release (`:217-226`); `charge.refunded` -> RPC `order_apply_refund` (`:229-249`); `charge.dispute.created` -> `orders.status = disputed` (`:252-276`) | order, refund, connected-account |
| `/api/billing/webhook` (Stripe Billing, platform) | POST | `Store/src/app/api/billing/webhook/route.ts:27` | webhook signature (`:33-41`) | `stripe_events`, plan sync `syncCustomer` (`Store/src/lib/billing/webhook.ts:117`), notification (`:161`) | seller |

No webhook from any other provider (mail, SMS) exists: searched `src/app/**/route*.ts` for `hook|inbound|bounce|svix|standardwebhooks|smtp|brevo|twilio|sms`, only the two Stripe routes, `checkout/cancel` and dev routes matched.

### 2.5 Cron and ops (server to server)

| Path | Methods | file:line | Auth | Writes | Touches |
| --- | --- | --- | --- | --- | --- |
| `/api/cron/account-deletions` | POST | `Store/src/app/api/cron/account-deletions/route.ts:22` | cron | deletes due accounts (`admin.auth.admin.deleteUser` `Store/src/lib/account-deletion/run.ts:318`, cascades, inferred) | seller, product, storefront, connected-account (row only; Stripe account kept, `run.ts:38-39`) |
| `/api/cron/moderation` | POST | `Store/src/app/api/cron/moderation/route.ts:29` | cron | moderation settle via RPCs `moderation_due`/`moderation_settle` (`Store/src/lib/moderation/auto/check.ts:439`, `:296`), review sweep | product, storefront |
| `/api/cron/review-reminders` | POST | `Store/src/app/api/cron/review-reminders/route.ts:18` | cron | reminder emails, `orders.review_reminder_*` (inferred) | order |
| `/api/cron/terms-notices` | POST | `Store/src/app/api/cron/terms-notices/route.ts:17` | cron | Terms notice emails and ledger (inferred) | none |
| `/api/cron/agent-cleanup` | POST | `Store/src/app/api/cron/agent-cleanup/route.ts:13` | cron | deletes expired agent tokens, trail, clients (`Store/src/lib/agent/cleanup.ts:20`) | none |
| `/api/cron/funnel-rollup` | POST | `Store/src/app/api/cron/funnel-rollup/route.ts:20` | cron | `storefront_funnel_daily` (inferred) | none |
| `/api/moderation/check` | POST | `Store/src/app/api/moderation/check/route.ts:65` | cron secret (used by the marketplace Worker, `:13-14`) | `{target}` settles a stored row (`check.ts:286`) | product, storefront |
| `/api/ops/mail-test` | POST | `Store/src/app/api/ops/mail-test/route.ts:26` | ops | one email to `OPS_ALERT_EMAIL` | none |

---

## 3. Server actions (`"use server"`)

29 files, 100 exported async functions (every one is classified in `Store/tests/unit/agent/registry.test.ts`). "Auth" is the first helper called. `getActiveAccount` = store-scoped with role check; `getUser` = the person's own rows; `getSessionState` = auth flow state. Inside an MCP call these resolve to the grant (`Store/docs/mcp.md:34-37`). "MCP" column: tool name, or P (person), B (browser), D (deferred).

### 3.1 Commerce actions (the ones that matter for R1 to R6)

| File | Action | Line | Auth | Writes | Touches | MCP |
| --- | --- | --- | --- | --- | --- | --- |
| `Store/src/lib/products/actions.ts` | createProduct | 341 | getActiveAccount `:344` | `products` insert `:414-415` | product, price/currency, shipping-policy | create_product |
| same | updateProduct | 431 | getActiveAccount `:435` | `products` update `:554-555` | product, price/currency, shipping-policy | update_product, publish_products |
| same | deleteProduct | 597 | getActiveAccount `:603` | `products` delete `:641-642` | product | delete_product |
| `Store/src/lib/products/card-actions.ts` | setProductStatus | 44 | getActiveAccount `:48` | `products.status` `:76-77` (publish from a card) | product | update_product |
| same | duplicateProduct | 101 | getActiveAccount `:104` | `products` insert `:148-149` (copies price, currency) | product, price/currency | create_product |
| `Store/src/lib/products/import-actions.ts` | importProducts | 111 | getActiveAccount `:112` | `products` bulk insert `:257-258` | product, price/currency | import_products |
| same | undoProductImport | 304 | getActiveAccount `:305` | `products` delete `:322-323` | product | delete_product |
| `Store/src/lib/products/add-on-actions.ts` | setProductAddOns | 100 | getActiveAccount `:104` | `products.add_on_ids` `:126-127` | product, checkout | update_product |
| same | getAddOnPicker | 52 | getActiveAccount `:55` | nothing | none | B |
| `Store/src/lib/products/badge-actions.ts` | moveProductBadge | 73 | getActiveAccount `:78` | `products` `:127-128` | product | move_product_badge |
| same | checkBadgeLabel | 44 | getActiveAccount `:45` | nothing | none | check_badge_label |
| `Store/src/lib/stock/actions.ts` | updateStockSettings | 53 | getActiveAccount `:57` | `products` stock `:88-89` | product | update_stock |
| `Store/src/lib/products/picker-actions.ts` | searchCatalogProducts | 26 | (inferred getActiveAccount) | nothing | none | list_products |
| `Store/src/lib/products/preview-actions.ts` | getProductPagePreviewData | 53 | getActiveAccount `:61` | nothing | none | preview_product_page |
| `Store/src/lib/products/describe-actions.ts` | suggestProductDescription | 110 | getActiveAccount `:111` | AI credit hold/settle `:92`, `:129` | none | P |
| same | suggestDescriptionCompletion | 143 | getActiveAccount `:146` | AI credit settle `:163` | none | P |
| `Store/src/lib/storefront/actions.ts` | createStorefront | 110 | getActiveAccount `:111` | `storefronts` insert `:194-195` | storefront | create_storefront |
| same | saveStorefront | 218 | getActiveAccount `:223` | `storefronts` name/config `:384-385` (product blocks, checkout/cart/product page members) | storefront, checkout, product | save_storefront, edit_storefront |
| same | updateEmbedSettings | 478 | getActiveAccount `:482` | `storefronts.config` embed `:536-537` | storefront, checkout | update_embed_settings |
| same | deleteStorefront | 554 | getActiveAccount `:557` | `storefronts` delete `:573-574` | storefront | delete_storefront |
| same | rotateEmbedKey | 614 | getActiveAccount `:615` | `storefronts.embed_key` `:630-631` | storefront | rotate_embed_key |
| same | fetchStorefrontsPage | 654 | (inferred getActiveAccount) | nothing | none | list_storefronts |
| `Store/src/lib/settings/shipping-actions.ts` | saveShippingPolicy | 71 | getUser `:75` | `profiles.shipping_policy` `:113` | shipping-policy | save_shipping_policy |
| `Store/src/lib/discounts/actions.ts` | createDiscount | 122 | authorizeDiscountWrite `:123` (getActiveAccount `:45`) | `discounts` insert `:144-145` | discount, price/currency | create_discount |
| same | updateDiscount | 159 | same `:160` | `discounts` update `:191-192` | discount, price/currency | update_discount |
| same | setCodeEnabled | 223 | same `:224` | `discounts.enabled` `:229-230` | discount | set_code_enabled |
| same | endSale | 244 | same `:245` | `discounts.ends_at` `:250-251` | discount | end_sale |
| same | deleteDiscount | 269 | same `:270` | `discounts.archived_at` `:275-276` | discount | delete_discount |
| `Store/src/lib/orders/actions.ts` | markOrderShipped | 72 | getActiveAccount `:77` | RPC `order_mark_shipped` `:103` | order | mark_order_shipped |
| same | refundOrder | 231 | getActiveAccount `:236` (`orders.refund` `:238`) | Stripe `/refunds` `:478`, RPC `order_apply_refund`/`order_refund` `:431-432` | refund, order, connected-account | refund_order |
| same | refundOrderLine | 302 | getActiveAccount `:308` | RPC `order_line_refund_amount` `:341`, `order_apply_line_refund` `:359` (plus provider refund) | refund, order, connected-account | D |
| `Store/src/lib/settings/actions.ts` | saveTaxInfo | 446 | getUser `:450`, step-up `:475` | `profiles.tax_country`, `seller_address`, `seller_email`, `seller_phone`, `tax_business_name`, `tax_vat_id` `:548`; contact codes `:561` | seller | P |
| `Store/src/lib/payments/connect/actions.ts` | startStripeOnboarding | 51 | getActiveAccount `:29` (owner + `billing.manage` `:31`) | Stripe `POST /accounts` with `country: identity.country` when set (`:60-66`, `Store/src/lib/payments/connect/account.ts:153-164`), `seller_payment_accounts` upsert (`account.ts:166-178`), `POST /account_links` (`account.ts:194`) | connected-account, seller | P |
| same | openStripeDashboard | 81 | same | Stripe login link (`account.ts:211`) | connected-account | P |

Observation for R1 (from the code above): the Stripe account's country is sent only when the account is first created and only if the seller already filled in a country (`account.ts:150-158`). `seller_payment_accounts` stores no country, and neither `account.updated` (`connect/webhook.ts:168-173`) nor the return refresh (`account.ts:108-116`) records Stripe's country. A later change of `profiles.tax_country` via `saveTaxInfo` does not reach Stripe (searched for other `/accounts` writes: only `account.ts:155`).

### 3.2 Account, profile, team, notifications, moderation

| File | Action | Line | Auth | Writes | Touches | MCP |
| --- | --- | --- | --- | --- | --- | --- |
| `Store/src/lib/settings/actions.ts` | updateUsername | 144 | getUser `:148` | `profiles.username` `:169-175` | seller | update_username |
| same | updateBio | 198 | getUser `:202` | `profiles.seller_bio` `:220` | seller | update_bio |
| same | requestEmailChange | 235 | getUser `:239`, step-up `:273` | Supabase auth email change `:306` | seller | P |
| same | sendPasswordReset | 340 | getUser `:344` | reset email `:367` | none | P |
| same | acceptLegal | 399 | getUser `:403` | `profiles.legal_accepted_*` `:413` | seller | P |
| same | saveNotifications | 584 | getUser `:588` | `profiles.notify_*` `:610` | none | save_notification_settings |
| same | saveSuggestAsYouType | 623 | getUser `:624` | `profiles.ai_suggest_as_you_type` `:628` | none | P |
| same | requestAccountDeletion | 643 | getUser `:647`, step-up `:657` | `account_deletion_requests`, `profiles.deletion_requested_at`, revokes grants, ends plan `:665-700` | seller | P |
| same | cancelAccountDeletion | 705 | getUser `:709` | same tables `:716-721` | seller | P |
| `Store/src/lib/settings/avatar.ts` | uploadAvatar | 59 | getUser (inferred) | avatar bucket `:105`, `profiles` `:125` | seller | set_avatar |
| same | removeAvatar | 138 | getUser (inferred) | bucket, `profiles` `:163` | seller | remove_avatar |
| `Store/src/lib/contact-verification/actions.ts` | sendContactCode | 27 | getUser `:31` | contact code `:40` | seller | P |
| same | confirmContactCode | 51 | getUser `:55` | contact proof `:67` | seller | P |
| `Store/src/lib/team/actions.ts` | inviteMember | 120 | getUser `:124` | `team_members` insert `:182` | none | P |
| same | acceptInvite | 300 | getUser `:304` | `team_members` via `Store/src/lib/team/accept.ts:64` | none | P |
| same | changeMemberRole | 335 | getUser `:339` | `team_members.role` `:375-376` | none | P |
| same | revokeMemberAccess | 404 | getUser `:408` | `team_members.status` `:454-455` | none | P |
| same | setActiveAccount | 490 | getUser `:493` | active-account cookie (inferred) | none | B |
| same | fetchTeamRosterPage | 528 | getUser `:532` | nothing | none | list_team |
| `Store/src/lib/notifications/actions.ts` | fetchNotificationSnapshot | 35 | (inferred getUser) | nothing | none | list_notifications |
| same | fetchUnreadCount | 40 | (inferred) | nothing | none | get_unread_count |
| same | fetchNotificationPage | 45 | (inferred) | nothing | none | list_notifications |
| same | runNotificationAction | 92 | getUser `:95` | `notifications` `:103`, `:148`; accepts a team invite (registry `:155`) | none | P |
| same | markNotificationRead | 152 | getUser `:155` | `notifications.read` `:163-164` | none | mark_notification_read |
| same | markAllNotificationsRead | 175 | getUser `:179` | `notifications.read` `:184-185` | none | mark_all_notifications_read |
| same | getRealtimeToken | 204 | getUser `:205` | nothing | none | B |
| `Store/src/lib/reviews/actions.ts` | setReviewVisibility | 38 | getActiveAccount `:43` | RPC `review_set_visibility` `:71` | none | set_review_visibility |
| `Store/src/lib/moderation/appeals.ts` | fileModerationAppeal | 68 | (inferred getActiveAccount) | `moderation_appeals` `:136`, staff ping `:171` | none | file_moderation_appeal |
| `Store/src/lib/moderation/review-request.ts` | requestModerationReview | 74 | (inferred getActiveAccount) | product or storefront row `:98`, `:131`, staff ping `:147` | product, storefront | request_moderation_review |
| `Store/src/lib/onboarding/actions.ts` | completeOnboarding | 24 | getUser `:25` | `profiles.onboarding_completed_at` `:30-31` | none | B |
| same | markSetupCelebrated | 62 | getUser `:63` | `profiles.setup_celebrated_at` `:68-69` | none | B |
| same | markEditorTourSeen | 87 | getUser `:88` | `profiles.editor_tour_seen_at` `:93-94` | none | B |
| `Store/src/lib/billing/actions.ts` | startCheckout | 118 | getActiveAccount `:82`, getUser `:141` | Stripe platform Checkout for a plan `:148` | seller | P |
| same | openBillingPortal | 190 | (inferred getActiveAccount) | Stripe portal session `:229` | seller | P |
| same | cancelPlan | 281 | (inferred) | Stripe subscription `:305`, `plan_cancellations` `:392` | seller | P |
| same | resumePlan | 331 | (inferred) | Stripe subscription `:361`, `plan_cancellations` `:363-364` | seller | P |
| `Store/src/lib/agent/consent-actions.ts` | approveAgentConnection | 48 | getUser `:53`, step-up `:87` | `agent_grants` + code (`createGrantWithCode` `:95`) | none | P |
| same | revokeConnectedApp | 125 | getUser `:126` | grant revoked `:133` | none | P |
| `Store/src/i18n/actions.ts` | setLocale | 23 | (none required) | locale cookie, `profiles` locale `:34` | none | B |

### 3.3 Authentication actions (Touches none, except sign-up)

| File | Actions (line) | Auth | Writes | Touches | MCP |
| --- | --- | --- | --- | --- | --- |
| `Store/src/lib/auth/actions.ts` | authenticate (234), resetPassword (529), signInWithGoogle (644), signOut (682), signOutEverywhere (695) | anon / getSessionState (inferred) | Supabase auth: `signInWithOtp` `:283`, **`signUp` `:416`** (creates the seller account; profile row by trigger, inferred), `signInWithPassword` `:484`, `signInWithOAuth` `:656`; grant revocation on reset/sign-out-everywhere (inferred from registry `:51`) | seller (sign-up) | P / B |
| `Store/src/lib/auth/mfa-actions.ts` | verifyTwoFactorSignIn (140), signInWithRecoveryCode (191), beginTwoFactorSetup (298), confirmTwoFactorSetup (368), signOutToReauthenticate (446), cancelTwoFactorSetup (456), beginPasskeySetup (491), confirmPasskeySetup (566), beginPasskeyHere (598), confirmPasskeyHere (636), passkeySignInOptions (729), passkeyStepUpOptions (741), verifyPasskeySignIn (758), removeAuthenticator (822), regenerateRecoveryCodes (896), confirmIdentity (931) | getSessionState | Supabase MFA factors, passkeys, recovery codes (inferred) | none | P |
| `Store/src/lib/auth/sign-in-approval-actions.ts` | startSignInApproval (81), checkSignInApproval (128), cancelSignInApproval (164), decideSignInApproval (225), reconfirmToApprove (312), setSignInApproval (330) | getSessionState | sign-in approval rows (inferred); records `cf-ipcountry` as a device label only (`:108`) | none | P |

R8 note: `authenticate` (`:416` `signUp`) is the only seller-account creation path in Store, and it reads no country. The `waitlist_signups` table (`Store/src/types/supabase.ts:2934-2959`) has `email`, `list_id`, `owner_id`, `source`, no country, and has no writer in Store (searched `src/` for `waitlist`); its writer is Home's `/api/waitlist` route (outside Store, not opened).

---

## 4. Scheduled and background work

### 4.1 GitHub Actions schedules (all call cron routes with `CRON_SECRET`)

| Workflow | Schedule | Job | Calls | Touches |
| --- | --- | --- | --- | --- |
| `Store/.github/workflows/scheduled.yml:34` | `23 3 * * *` daily | account-deletions `:44-75` | `/api/cron/account-deletions` | seller, product, storefront, connected-account |
| same | same | terms-notices `:81-112` | `/api/cron/terms-notices` | none |
| same | same | review-reminders `:119-144` | `/api/cron/review-reminders` | order |
| same | same | agent-cleanup `:146-163` | `/api/cron/agent-cleanup` | none |
| same | same | funnel-rollup `:165-186` | `/api/cron/funnel-rollup` | none |
| `Store/.github/workflows/moderation-sweep.yml:30` | `*/5 * * * *` | sweep `:40-69` | `/api/cron/moderation` | product, storefront |

`deploy.yml`, `backup.yml`, `e2e.yml` write nothing to the database (searched for `curl|POST|supabase db|migration`; `deploy.yml:211` runs `wrangler triggers deploy`, and Store's `wrangler.jsonc` defines no triggers).

### 4.2 pg_cron jobs (in the shared database; run as the database, no app code)

| Job | Schedule | Defined at | Does | Touches |
| --- | --- | --- | --- | --- |
| demo-sales-sim | `*/20 * * * *` | `Store/supabase/migrations/20260801_demo_sales_sim.sql:485` | `demo.sales_sim_tick()`: **inserts `public.orders` directly** with "plausible EU addresses" (`20260927_demo_sales_sim_fulfilment.sql:10-12`, insert `:163`), marks them shipped `:210`, prunes `:263`, `:268`; only while `demo.sales_sim.enabled` is true (`:20`) | order, price/currency |
| rate-limit-gc | `17 * * * *` | `Store/supabase/migrations/20260807_db_hygiene.sql:68` | `rl_gc_keys()` | none |
| orders-release-expired | `*/5 * * * *` | `Store/supabase/migrations/20261008_order_lifecycle.sql:352-356` | deletes unpaid orders past expiry, returns stock (`:340-344`) | order, product |
| carts-sweep | `23 3 * * *` | `Store/supabase/migrations/20261120_shopping_cart.sql:157-161` | deletes idle and paid carts (`:137-143`) | checkout |

The demo simulator is the one writer that creates orders without any checkout, quote or buyer: it bypasses R3, R5 and R6 by construction, and any "every order ships to CZ" assertion or report will see its non-CZ addresses unless it is disabled or taught the rules.

### 4.3 Cloudflare Workers

- Store's Worker (`Store/wrangler.jsonc`, `"main": ".open-next/worker.js"` `:4`): no `triggers`/`crons` key and no `scheduled` handler in `src/` (searched `waitUntil|scheduled\(`).
- `Store/ops/uptime` Worker: cron `* * * * *` (`Store/ops/uptime/wrangler.jsonc:19`). It GETs health URLs (`Store/ops/uptime/src/checks.ts:82`), stores state in KV (`Store/ops/uptime/src/index.ts:80`, `:111`) and emails alerts over Brevo. `POST /report` receives the app's error reports (`index.ts:130`). Writes no database row and nothing in Stripe. Touches none.

### 4.4 `after()` callbacks that write

| Site | Writes | Touches |
| --- | --- | --- |
| `Store/src/app/api/cart/[storefrontId]/route.ts:133-146` | `storefront_signals` cart_add, funnel point | none |
| `Store/src/app/api/orders/withdraw/route.ts:99-130` | notification, 2 emails | order |
| `Store/src/app/api/orders/lookup/route.ts:46-74` | email | none |
| `Store/src/app/api/products/[id]/reviews/route.ts:133` | review moderation | none |
| `Store/src/app/api/report/route.ts:209` | staff ping (external) | none |
| `Store/src/lib/orders/record.ts:749-755` (`afterResponse`) | seller notification and "ship this" email after an order is recorded | order |
| `Store/src/lib/moderation/appeals.ts:171`, `Store/src/lib/moderation/review-request.ts:147`, `Store/src/lib/moderation/auto/check.ts:256` | staff ping | none |
| Public page renders: `Store/src/app/(public)/s/[storefrontId]/page.tsx:69-71`, `.../p/[productId]/page.tsx:145-173`, `.../checkout/page.tsx:64-66`, `.../p/[productId]/checkout/page.tsx:104-106`, `Store/src/app/(public)/e/[key]/[...sites]/page.tsx:90-92` | `storefront_signals` (views, clicks, checkout views) | none |
| Dashboard renders: `Store/src/app/(dashboard)/dashboard/page.tsx:91`, `Store/src/app/(dashboard)/products/page.tsx:115` (`settleWaitingProducts`, `Store/src/lib/products/settle-waiting.ts:21`), `Store/src/app/(dashboard)/products/[id]/edit/page.tsx:55` (`checkMany`) | moderation settle of the seller's products | product |

### 4.5 Page renders that write (not via `after()`)

| Site | Writes | Touches |
| --- | --- | --- |
| `Store/src/app/settings/billing/page.tsx:45` (`confirmCheckoutReturn`, `Store/src/lib/billing/checkout-return.ts:34`, `:48`) | plan sync from Stripe on return from plan checkout | seller |

### 4.6 Scripts that write when run

All DB scripts go through `Store/scripts/lib/env.ts`, which refuses unless `SEED_ENV=dev` (comment `:5-8`) and needs `SUPABASE_SERVICE_ROLE_KEY` + `TEST_SELLER_ID` (`:58`, `:83`).

| Script | Writes | Touches |
| --- | --- | --- |
| `Store/scripts/seed.ts` | `storefronts.config` `:252`, `products` insert `:287`, **`orders` insert `:331`**, `storefront_signals` `:350` | product, price/currency, storefront, order, shipping-policy |
| `Store/scripts/seed-reviews.ts` (via `Store/scripts/lib/fake-reviews.ts:397-401`) | `review_imports`, `reviews` | none |
| `Store/scripts/reset-seed.ts:45` | deletes seeded rows | order, product (inferred) |
| `Store/scripts/reset-seeded-products.ts:70`, `:76`, `:134` | deletes products, edits storefront blocks | product, storefront |
| `Store/scripts/update-product-images.ts:59` | `products.image_key` | product |
| `Store/scripts/stock-smoke.ts:34-186` | RPC `decrement_stock`, test product and order rows, cleanup | product, order |
| `Store/scripts/sweep-unused-uploads.ts:58`, `:98` | R2 deletes (reads via Management API) | none |
| `Store/scripts/mirror-catalog-images.ts` | R2 uploads (inferred from name) | none |
| `Store/scripts/auth-emails.ts:269-302` | Supabase Auth config via Management API (`PATCH .../config/auth`) | none |

Read-only: `check-prod-migrations.ts`, `check-prod-schema.ts` (Management API query), `check-catalog-images.ts`, `dev.ts`, `trim-next-cache.ts`, `generate-app-icons.ts`, `auth-email-icons.ts`, `smoke-check.sh`, `build-pdf-font.py`, `ci-install-icu60.sh`. No script calls Stripe (searched `stripe`).

---

## 5. `/dev` harness

Exclusion: harness files are named `page.dev.tsx`, `route.dev.ts`, `layout.dev.tsx`; `pageExtensions` includes `dev.tsx`/`dev.ts` only when `NODE_ENV === "development"` (`Store/next.config.ts:5`, `:18-28`, `:175`), so a production build has no `/dev` route. Per that comment, `tests/unit/dev-routes-dev-only.test.ts` and the deploy refuse a harness route with a plain name (not opened). Each route handler also checks `NODE_ENV` itself.

| Route | Methods | file:line | Auth | Writes | Touches |
| --- | --- | --- | --- | --- | --- |
| `/dev/simulate-sale` | GET, POST | `Store/src/app/dev/simulate-sale/route.dev.ts:55`, `:95` | dev only (`:56`, `:96`) + seller with `products.write` (`:44-47`) | paid order through the real order writer (`simulateSale`, `Store/src/lib/dev/simulated-sale.ts`); deletes pretend reviews (`simulated-sale.ts:206`) | order |
| `/dev/outbox` | GET | `Store/src/app/dev/outbox/route.dev.ts:18` | dev only, no session (`:19`) | nothing | none |
| `/dev/embed-host` | GET | `Store/src/app/dev/embed-host/route.dev.ts:59` | dev only (`:60`) | nothing | none |
| `/dev/ai-writing/describe` | POST | `Store/src/app/dev/ai-writing/describe/route.dev.ts:17` | no session (dev build only) | model call, lab budget counter (in memory, `../lab-budget`) | none |
| `/dev/ai-writing/complete` | POST | `Store/src/app/dev/ai-writing/complete/route.dev.ts:15` | same | same | none |

The 42 `page.dev.tsx` labs import no write code of their own (searched `src/app/dev` for `createAdminClient|.insert(|.update(|.rpc(|actions"`: no write hits). Related dev-only payment path: the `test` checkout provider, active only when `NODE_ENV === "development"` and `CHECKOUT_TEST_PAYMENTS=1` (`Store/src/lib/checkout/availability.ts:41-42`, `:75`), records orders with no Stripe.

---

## 6. `Store/src/middleware.ts`

- Edge middleware (`:31-39`). It copies the requested path into a header for the sign-in redirect and answers 400 to malformed multipart POSTs (`:32-34`). Per its own comment it "DECIDES NOTHING about access" (`:9-13`).
- Matcher: dashboard prefixes, `/oauth/authorize`, and multipart requests to non-API pages (`:41-60`). Not on `/api/*`, `/mcp`, `/s/*`, `/e/*`.
- **Nothing geographic, nothing that blocks by country.** Geography in the whole app is only Cloudflare's `cf-ipcountry` header, read as a default and never enforced: cart delivery line (`Store/src/lib/cart/route.ts:43-49`, filtered to `SHIPPING_COUNTRY_CODES`), checkout delivery picker default (`Store/src/app/(public)/s/[storefrontId]/checkout/page.tsx:60-62`, `.../p/[productId]/checkout/page.tsx:102`), and a sign-in device label (`Store/src/lib/auth/sign-in-approval-actions.ts:108`).
- Config chokepoints the validators will meet: `SHIPPING_COUNTRY_CODES` (27 EU + US + CA, `Store/src/lib/settings/constants.ts:129-136`) and `CURRENCIES = ["EUR", "USD"]` (`Store/src/types/product.ts:12`).

---

## 7. Other writers

| Writer | file:line | Writes | Touches |
| --- | --- | --- | --- |
| `instrumentation.ts` `onRequestError` | `Store/src/instrumentation.ts:13-19` -> `Store/src/lib/ops/report-error.ts:48-52` | POST to `ERROR_REPORT_URL` (the uptime Worker's KV) | none |
| Stripe Billing return page | `Store/src/app/settings/billing/page.tsx:45` | plan sync | seller |
| OAuth endpoints | section 2.3 | agent clients, codes, tokens, grants | none |
| Supabase Auth (Google OAuth, email links) | `/auth/callback`, `/auth/confirm` (section 2.3) | session | seller |
| Mail / SMS providers | outbound only (`Store/src/lib/email/smtp.ts`, inferred), no inbound webhook | none | none |
| Static `Store/public/sw.js`, `Store/public/widget.js` | client side only | none | none |
| Sitemap, robots, manifest (`Store/src/app/sitemap.ts`, `robots.ts`, `manifest.ts`) | reads only (inferred) | none | none |
| Agent preview pages `Store/src/app/(public)/agent-preview/{storefront,product}/...` | token-gated reads, no `recordSignal` or admin writes found | none | none |

---

## (a) Master checklist by entity

Each line is an entry point a validator must cover (or consciously exempt).

**seller (identity, establishment country, account)**
- `saveTaxInfo` `Store/src/lib/settings/actions.ts:446` (tax_country, seller_address): the only writer of the R1 address fields in Store. Seller session + step-up; not on MCP.
- `authenticate` sign-up `Store/src/lib/auth/actions.ts:416`; `/auth/callback` `:25`, `/auth/confirm` `:17` (activation). R8 hook point.
- `updateUsername` `:144`, `updateBio` `:198`, `acceptLegal` `:399`, `requestEmailChange` `:235`, `uploadAvatar`/`removeAvatar` (MCP: update_username, update_bio, set_avatar, remove_avatar).
- Contact proof `sendContactCode`/`confirmContactCode` `Store/src/lib/contact-verification/actions.ts:27`, `:51`.
- Plan and billing: `startCheckout`, `cancelPlan`, `resumePlan`, `/api/billing/webhook`, `settings/billing/page.tsx:45`.
- Deletion: `requestAccountDeletion` `:643`, `cancelAccountDeletion` `:705`, `/api/cron/account-deletions`.

**connected-account**
- `startStripeOnboarding` `Store/src/lib/payments/connect/actions.ts:51` -> `ensurePaymentAccount` `account.ts:144` (the only Stripe `/accounts` create; sets country once).
- `openStripeDashboard` `:81`.
- `/api/payments/connect/return` `Store/src/app/api/payments/connect/return/route.ts:27` (refresh flags).
- `/api/payments/webhook` `account.updated` `connect/webhook.ts:165`.
- Read at checkout: `checkoutProviderFor` `Store/src/lib/checkout/availability.ts:73` (R1 enforcement point at checkout time, R5 per seller).

**product (incl. publish/sellability)**
- `createProduct`, `updateProduct`, `deleteProduct`, `setProductStatus`, `duplicateProduct`, `importProducts`, `undoProductImport`, `setProductAddOns`, `moveProductBadge`, `updateStockSettings`.
- MCP: create_product, update_product, publish_products, import_products, update_stock, move_product_badge, upload_image, delete_product.
- Moderation visibility: `/api/cron/moderation`, `/api/moderation/check`, `requestModerationReview`, dashboard `after()` settles.
- Service writers: `orders-release-expired` (stock), scripts `seed.ts`, `stock-smoke.ts`, `update-product-images.ts`, `reset-seeded-products.ts`.

**price/currency**
- Product writers above (currency enum `Store/src/types/product.ts:12`; MCP inputs `products.ts:177`, `:205`, `:348`).
- `createDiscount`/`updateDiscount` (amount discounts carry a currency).
- Checkout quote at order time: `place-order.ts:128` -> `quoteOrder`; cart currency mix `assessLines` (`Store/src/app/api/cart/[storefrontId]/route.ts:101-112`).
- `demo-sales-sim` pg_cron, `seed.ts` (orders with their own currency).

**discount**
- 5 discount actions `Store/src/lib/discounts/actions.ts:122-269` and their 5 tools.
- Code check routes (read) `.../discount/route.ts`.

**shipping-policy**
- `saveShippingPolicy` `Store/src/lib/settings/shipping-actions.ts:71` (MCP save_shipping_policy).
- Per-product `shippingProfileId` through `createProduct`/`updateProduct` (MCP `products.ts:70`).
- Platform list `SHIPPING_COUNTRY_CODES` `Store/src/lib/settings/constants.ts:129`.
- Consumed at checkout via the quote `country` (`place-order.ts:132`).

**storefront**
- `createStorefront`, `saveStorefront`, `updateEmbedSettings`, `deleteStorefront`, `rotateEmbedKey`.
- **Second config writer**: `pageConfigRoute` PATCH `Store/src/lib/storefront/page-config-route.ts:202` behind three routes (product-page, checkout-page, cart-page) and three tools. Any rule on `storefronts.config` must sit in both `saveStorefront` (`storefront/actions.ts:384`) and here, and also `updateEmbedSettings` (`:536`).
- MCP: create_storefront, edit_storefront, save_storefront, update_*_page x3, update_embed_settings, delete_storefront, rotate_embed_key, upload_element.
- Embed serving `/api/embed/[key]` and frame page `/e/[key]/[...sites]` (public read gates).

**checkout (cart, pending payment, settings)**
- `POST /api/checkout/[storefrontId]/[productId]` and `POST /api/checkout/[storefrontId]` -> `placeOrderResponse` `Store/src/lib/checkout/place-order.ts:89` (the one shared place for R3/R4/R5/R6 at order time).
- `POST /api/cart/[storefrontId]` (adds; R3 preview only), `/view`.
- `/api/checkout/cancel`.
- Storefront checkout and cart settings writers (above).
- `carts-sweep` pg_cron.

**order**
- Created: checkout routes -> RPC `order_place` (`record.ts:472`); confirmed: Connect webhook `checkout.session.completed` -> `order_confirm_paid` (`record.ts:311`); dev `simulate-sale`; **`demo-sales-sim` pg_cron (direct insert)**; `seed.ts`, `stock-smoke.ts`.
- Changed: `markOrderShipped`, withdraw route, review-reminder routes and cron, dispute webhook, `orders-release-expired`, checkout cancel.

**refund**
- `refundOrder` `Store/src/lib/orders/actions.ts:231` (MCP refund_order, opt-in), `refundOrderLine` `:302` (no tool).
- Connect webhook `charge.refunded` `connect/webhook.ts:229` (refunds made in the seller's own Stripe dashboard).

## (b) Reachable without a signed-in seller session

These are the paths a UI-only or session-only check never sees.

| Kind | Entry points | Touches that matter |
| --- | --- | --- |
| anon (buyer, any website via embed) | checkout POST x2, discount check x2, cart POST + view, checkout cancel, withdraw, lookup, review-reminder + unsubscribe, download, product reviews POST, report, embed GET, OG image, plan prices, csp-report, offline, `.well-known` x3, `/oauth/register`, `/oauth/token`, `/oauth/revoke`, `/auth/callback`, `/auth/confirm`; public page renders that write signals | checkout, order, price/currency, discount, shipping-policy, connected-account |
| agent token | `/mcp`: 36 write tools (section 1.1), including product currency and status, shipping policy, storefront checkout/cart/embed settings, discounts, shipping, refunds (opt-in) | product, price/currency, discount, shipping-policy, storefront, checkout, order, refund |
| webhook signature | `/api/payments/webhook`, `/api/billing/webhook` | order, refund, connected-account, seller |
| cron secret | 6 `/api/cron/*` routes, `/api/moderation/check` | seller, product, storefront, order, connected-account |
| ops token | `/api/ops/mail-test` | none |
| database scheduler (no app code at all) | `demo-sales-sim`, `orders-release-expired`, `carts-sweep`, `rate-limit-gc` | order, price/currency, product, checkout |
| GitHub schedules | `scheduled.yml` (5 jobs), `moderation-sweep.yml` | via the cron routes |
| scripts (dev-gated, service role) | `seed.ts`, `reset-*`, `stock-smoke.ts`, `update-product-images.ts`, `seed-reviews.ts`, `sweep-unused-uploads.ts`, `auth-emails.ts` | product, order, storefront, price/currency |
| dev build only | `/dev/simulate-sale` (needs a seller), `/dev/outbox`, `/dev/embed-host`, `/dev/ai-writing/*`; `test` checkout provider | order |
| other repos on the same database | App (marketplace Worker) and Admin write the same tables and call `/api/moderation/check` (`moderation/check/route.ts:13-14`); not enumerated here | outside Store |

## (c) Could not classify, or classified only by inference

- `authenticate` sign-up creates the profile row by a database trigger: inferred, trigger not opened.
- Internal tables of the MFA, passkey and sign-in-approval actions: inferred; all Touches none.
- `runNotificationAction`: classified from the registry's reason ("accepts a team invite", `registry.test.ts:155`), body not read in full.
- `fileModerationAppeal`, `requestModerationReview`, `uploadAvatar`, `removeAvatar`, `openBillingPortal`, `cancelPlan`, `resumePlan`, `searchCatalogProducts`, `fetchStorefrontsPage`, notification fetchers: the auth helper was not seen on the matched lines (inferred from the file's pattern and the registry).
- `/api/sellers/import-reviews` writes (`reviews`, `review_imports`) inferred from its purpose and the after-response block (`:216`); the insert lines were not read.
- `/api/cron/review-reminders`, `/api/cron/terms-notices`, `/api/cron/funnel-rollup`: exact tables inferred from their libraries' names and comments.
- Whether each pg_cron job is actually scheduled in production, and whether `demo.sales_sim.enabled` is true there, cannot be read from code. A memory note says migration `20261120_shopping_cart` (which adds `carts-sweep`) is not in production yet; not verified.
- What Stripe does when an Express account is created with no `country` (the `account.ts:158` branch): Stripe behaviour, not in this code.
- Whether the Connect Checkout Session collects a billing or shipping address (R4 evidence): `Store/src/lib/checkout/stripe-provider.ts` has no `billing_address_collection`, `shipping_address_collection` or `country` (searched); left to the checkout report.
- `Store/scripts/mirror-catalog-images.ts`: R2 writes inferred from its name; not opened.
- `tests/unit/dev-routes-dev-only.test.ts`: named in `next.config.ts:25`, not opened.
