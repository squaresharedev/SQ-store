# i18n inventory: `src/lib/**`

Status: first-pass audit, September 2026.
Scope: all user-facing copy in `src/lib/**`, excluding `src/lib/email/` (out of scope per plan) and dev-only paths.

---

## Summary

| Stat | Count |
|------|-------|
| Total findings | ~450 |
| Cat D (copy constants / data objects) | ~220 |
| Cat E (validation messages, incl. password + email quality) | ~110 |
| Cat F (server action returns: success/error strings) | ~95 |
| Cat G (locale-sensitive formatters) | 2 |
| Files with `"use server"` whose return shape must change | **6** |
| Strings with runtime interpolation (ICU params needed) | ~80 |
| Count-dependent strings requiring ICU plural forms | **8** |

---

## CRITICAL: Server action return contracts that must change shape

The plan says: server actions must return a key (or stable code), never a rendered sentence.
There are **two distinct patterns** in this codebase, both broken:

### Pattern A: flat string state (`SettingsActionState` / `AuthState` / `TeamActionState`)

These actions return `{ error?: string; success?: string }`. The string IS the API contract today.
The fix is to change the return type to carry a key, e.g. `{ errorKey?: string; successKey?: string }`, and resolve to a string at the render boundary.

| Action file | Return type | Functions whose contract must change |
|-------------|-------------|--------------------------------------|
| `src/lib/settings/actions.ts` | `SettingsActionState` | `updateUsername`, `requestEmailChange`, `sendPasswordReset`, `acceptLegal`, `saveTaxInfo`, `resendSellerEmailVerification`, `saveNotifications`, `requestAccountDeletion`, `cancelAccountDeletion` |
| `src/lib/auth/actions.ts` | `AuthState` | `authenticate`, `resetPassword` |
| `src/lib/team/actions.ts` | `TeamActionState` | `inviteMember`, `acceptInvite`, `changeMemberRole`, `revokeMemberAccess` |
| `src/lib/settings/shipping-actions.ts` | `SettingsActionState` (imported) | `saveShippingPolicy` |

**The Zod bridge (`firstIssue`).** Both `settings/actions.ts` and `team/actions.ts` contain:
```ts
function firstIssue(error: z.ZodError): SettingsActionState {
  return { error: error.issues[0]?.message ?? "Check the form and try again." };
}
```
And `shipping-actions.ts` has the same pattern inline:
```ts
return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
```
This means every Zod validation message in `validation/settings.ts`, `validation/team.ts`, `validation/shipping-policy.ts`, `validation/inputs.ts`, `validation/auth.ts`, `auth/password.ts`, and `validation/email-quality.ts` that flows into those schemas ALSO crosses the server boundary as a raw English sentence. They must all become keys (likely a `{ code, params }` pair the render boundary resolves).

### Pattern B: `ActionError` objects (`errors.ts`)

Product, storefront, import, and onboarding actions return `{ ok: false, error: ActionError }` where `ActionError.message` and `ActionError.fix` are rendered by `ActionErrorNotice`. These are NOT flat strings; they are structured objects that already carry a stable `code`. The fix is lower-friction: add `messageKey`/`fixKey` fields alongside the existing strings, then drop the English strings once all consumers use keys. The `code` enum is already stable and re-usable as the key root.

Consumers of `ActionError`: `components/ui/ActionErrorNotice` (one central renderer -- one change required there), any component that reads `.error.message` or `.error.fix` directly.

---

## Module-by-module findings

### `src/lib/search/nav-constants.ts` (HIGHEST LEVERAGE)

This single file feeds **four** surfaces: the dashboard sidebar rail (`Sidebar`), the settings rail (`SettingsShell`), the universal search registry (`src/lib/search/registry.ts`), and the welcome flow's map (`components/onboarding/WelcomeFlow.tsx`). One extraction here pays off in all four places simultaneously.

The file is **client-only** (animated motion icon imports). The `label` and `description` fields on `NavEntry` and `SettingsNavEntry` are consumed by:
- `Sidebar` and `SettingsShell` for rendered labels
- `WelcomeFlow` for `description` text (per-page descriptions shown in the welcome map)
- `registry.ts` which reads `link.label` to build the search result `title`

The fix is the keys-plus-params pattern: add `labelKey` and `descriptionKey` alongside `label` (or migrate in one step, since the registry and sidebar both read `label`). The registry can resolve at read-time since it is already inside a client component.

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| nav-constants.ts:64 | D | Client | `"Overview"` | `Nav.main.overview.label` |
| nav-constants.ts:67 | D | Client | `"Your setup steps, and anything that needs you."` | `Nav.main.overview.description` |
| nav-constants.ts:70 | D | Client | `"Products"` | `Nav.main.products.label` |
| nav-constants.ts:73 | D | Client | `"What you sell: photos, prices, stock and details."` | `Nav.main.products.description` |
| nav-constants.ts:76 | D | Client | `"Storefront"` | `Nav.main.storefront.label` |
| nav-constants.ts:79 | D | Client | `"Design the grid your products sit on."` | `Nav.main.storefront.description` |
| nav-constants.ts:82 | D | Client | `"Orders"` | `Nav.main.orders.label` |
| nav-constants.ts:85 | D | Client | `"Orders will land here once checkout opens."` | `Nav.main.orders.description` |
| nav-constants.ts:88 | D | Client | `"Analytics"` | `Nav.main.analytics.label` |
| nav-constants.ts:91 | D | Client | `"Views of your product pages, and sales later on."` | `Nav.main.analytics.description` |
| nav-constants.ts:94 | D | Client | `"Payments"` | `Nav.main.payments.label` |
| nav-constants.ts:97 | D | Client | `"Getting paid through Stripe. Coming soon."` | `Nav.main.payments.description` |
| nav-constants.ts:101 | D | Client | `"Settings"` | `Nav.main.settings.label` |
| nav-constants.ts:105 | D | Client | `"Your seller details, shipping terms and account."` | `Nav.main.settings.description` |
| nav-constants.ts:109 | D | Client | `"Account"` | `Nav.settings.account` |
| nav-constants.ts:110 | D | Client | `"Legal"` | `Nav.settings.legal` |
| nav-constants.ts:111 | D | Client | `"Business & seller details"` | `Nav.settings.tax` |
| nav-constants.ts:113 | D | Client | `"Shipping & returns"` | `Nav.settings.shipping` |
| nav-constants.ts:115 | D | Client | `"Notifications"` | `Nav.settings.notifications` |
| nav-constants.ts:116 | D | Client | `"Team & access"` | `Nav.settings.team` |
| nav-constants.ts:120 | D | Client | `"Danger zone"` | `Nav.settings.danger` |

**Restructuring note:** `registry.ts` builds search result `title` and `subtitle` directly from `link.label` (no key). Once `nav-constants.ts` moves to keys, `registry.ts` needs a resolved-string version at build time, OR the registry builds result titles from the same resolved `t()` call inside the client component that renders the palette. The second is cleaner; the registry module itself need not change shape.

---

### `src/lib/search/registry.ts`

Client-only module (imported from the search palette client component). Contains ~70 user-facing strings: `title` and `subtitle` fields on palette entries, and section group labels. Synonyms are internal matching vocabulary, not user-facing -- do NOT extract them.

**Section labels** (consumed as group headings in the palette):

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| registry.ts:282 | D | Client | `"Pages"` | `Search.sections.pages` |
| registry.ts:283 | D | Client | `"Actions"` | `Search.sections.actions` |
| registry.ts:284 | D | Client | `"Settings"` | `Search.sections.settings` |

**Settings field entries** (`title` and `subtitle` on each `LocalEntry`). These render directly in the palette dropdown. Representative sample (full list omitted for space -- every `entry(...)` call in SETTINGS_FIELDS has extractable title and subtitle strings):

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| registry.ts:105 | D | Client | `"Username"` | `Search.settings.username` |
| registry.ts:105 | D | Client | `"Settings › Account"` | `Search.settings.subtitleAccount` |
| registry.ts:124 | D | Client | `"Profile photo"` | `Search.settings.profilePhoto` |
| registry.ts:133 | D | Client | `"Email address"` | `Search.settings.email` |
| registry.ts:142 | D | Client | `"Password"` | `Search.settings.password` |
| registry.ts:152 | D | Client | `"Sign out"` | `Search.settings.signOut` |
| registry.ts:159 | D | Client | `"VAT ID"` | `Search.settings.vatId` |
| registry.ts:159 | D | Client | `"Settings › Business & seller details"` | `Search.settings.subtitleTax` |
| registry.ts:166 | D | Client | `"Trader name"` | `Search.settings.traderName` |
| registry.ts:173 | D | Client | `"Country"` | `Search.settings.country` |
| registry.ts:180 | D | Client | `"Business address"` | `Search.settings.businessAddress` |
| registry.ts:187 | D | Client | `"Contact email"` | `Search.settings.contactEmail` |
| registry.ts:194 | D | Client | `"Phone"` | `Search.settings.phone` |
| registry.ts:201 | D | Client | `"Sales emails"` | `Search.settings.salesEmails` |
| registry.ts:201 | D | Client | `"Settings › Notifications"` | `Search.settings.subtitleNotifications` |
| registry.ts:207 | D | Client | `"Marketing emails"` | `Search.settings.marketingEmails` |
| registry.ts:213 | D | Client | `"Product update emails"` | `Search.settings.productEmails` |
| registry.ts:220 | D | Client | `"Seller agreement"` | `Search.settings.sellerAgreement` |
| registry.ts:220 | D | Client | `"Settings › Legal"` | `Search.settings.subtitleLegal` |
| registry.ts:227 | D | Client | `"Export my data"` | `Search.settings.exportData` |
| registry.ts:227 | D | Client | `"Settings › Danger zone"` | `Search.settings.subtitleDanger` |
| registry.ts:234 | D | Client | `"Delete account"` | `Search.settings.deleteAccount` |

**Action entries:**

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| registry.ts:218 | D | Client | `"New product"` | `Search.actions.newProduct` |
| registry.ts:224 | D | Client | `"New storefront"` | `Search.actions.newStorefront` |
| registry.ts:230 | D | Client | `"Invite a team member"` | `Search.actions.inviteMember` |
| registry.ts:236 | D | Client | `"Notification history"` | `Search.actions.notificationHistory` |
| registry.ts:242 | D | Client | `"Show me around"` | `Search.actions.showMeAround` |

**Restructuring note:** `registry.ts` is a static module -- all entries are plain objects built at module load time. Moving to keys means the `title`/`subtitle` fields carry keys instead of strings, and resolution happens in the palette's render. The `searchCatalog` ranker matches on `title` and `keywords`; after extraction it will need to match on the resolved string (not the key). Best approach: keep a resolved string alongside the key, or resolve at build time with a language-neutral string set used only for matching.

---

### `src/lib/search/snapshot-groups.ts`

Client-safe module. Group labels and result subtitles/badges used in the search palette.

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| snapshot-groups.ts:44 | D | Client | `"Open in the designer"` | `Search.snapshot.openDesigner` |
| snapshot-groups.ts:58 | D | Client | `"Invited"` (team subtitle) | `Search.snapshot.invited` |
| snapshot-groups.ts:80 | D | Client | `"Unread"` (badge) | `Search.snapshot.unread` |
| snapshot-groups.ts:79 | D | Client | `"Draft"` (badge on products) | `Common.status.draft` |
| snapshot-groups.ts:86 | D | Client | `"Products"` | `Search.groups.products` |
| snapshot-groups.ts:87 | D | Client | `"Orders"` | `Search.groups.orders` |
| snapshot-groups.ts:88 | D | Client | `"Storefronts"` | `Search.groups.storefronts` |
| snapshot-groups.ts:89 | D | Client | `"Team"` | `Search.groups.team` |
| snapshot-groups.ts:90 | D | Client | `"Notifications"` | `Search.groups.notifications` |
| snapshot-groups.ts:148 | D | Client | `"Recent"` | `Search.groups.recent` |

---

### `src/lib/dashboard/attention.ts`

Pure module, no React. Consumed exclusively by `components/dashboard/DashboardHome.tsx` (and its spec). The `buildAttentionItems()` output is rendered as a list of cards; each card renders `label`, `description`, and `actionLabel`. The component is the resolution boundary.

Fix: change return type to carry keys (and count params for plurals). Keep the `key` discriminant -- it is already a stable machine-readable id that can serve as the key root.

**Count-dependent strings (ICU plurals required):**

| File:line | Cat | Client/Server | Current string | ICU key | Params |
|-----------|-----|---------------|----------------|---------|--------|
| attention.ts:155 | D | Server (pure) | `` `${count} product${count===1?"":"s"} with no way to buy` `` | `Attention.noBuyPath.label` | `{count}` |
| attention.ts:209 | D | Server (pure) | `` `${n} product${only?"":"s"} missing an image` `` | `Attention.images.label` | `{count}` |
| attention.ts:237 | D | Server (pure) | `` `${flagged} order${flagged===1?"":"s"} to review` `` | `Attention.flaggedOrders.label` | `{count}` |
| attention.ts:262 | D | Server (pure) | `` `${count} storefronts have indexing turned off...` `` | `Attention.noindexPages.description` | `{count}` |
| attention.ts:270 | D | Server (pure) | `` `${count} storefront block${count===1?"":"s"} referencing deleted products` `` | `Attention.deadBlocks.label` | `{count}` |

**Other attention strings (static or single-branch interpolation):**

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| attention.ts:111 | D | Server (pure) | `"Connect Stripe to get paid"` | `Attention.stripe.label` |
| attention.ts:112 | D | Server (pure) | `"Payouts stay blocked until your account is connected."` | `Attention.stripe.description` |
| attention.ts:113 | D | Server (pure) | `"Open payments"` | `Attention.stripe.action` |
| attention.ts:134 | D | Server (pure) | `"Accept the updated seller terms"` | `Attention.legal.labelUpdated` |
| attention.ts:135 | D | Server (pure) | `"Accept the seller terms"` | `Attention.legal.label` |
| attention.ts:136-137 | D | Server (pure) | `"The terms changed since you accepted..."` | `Attention.legal.descriptionUpdated` |
| attention.ts:138-139 | D | Server (pure) | `"Read the Seller Agreement..."` | `Attention.legal.description` |
| attention.ts:140 | D | Server (pure) | `"Review terms"` | `Attention.legal.action` |
| attention.ts:157 | D | Server (pure) | `"Add a buy link, or set a contact email..."` | `Attention.noBuyPath.description` |
| attention.ts:158 | D | Server (pure) | `"Review products"` | `Attention.noBuyPath.action` |
| attention.ts:168 | D | Server (pure) | `"Add your shipping terms"` | `Attention.noShipping.label` |
| attention.ts:170-171 | D | Server (pure) | `"Physical products need shipping and returns terms..."` | `Attention.noShipping.description` |
| attention.ts:173 | D | Server (pure) | `"Add terms"` | `Attention.noShipping.action` |
| attention.ts:194 | D | Server (pure) | `"Your storefront is empty"` | `Attention.storefront.labelEmpty` |
| attention.ts:195 | D | Server (pure) | `"Create your storefront"` | `Attention.storefront.labelNone` |
| attention.ts:197 | D | Server (pure) | `"Add a product to its grid to give it a page you can share."` | `Attention.storefront.descriptionEmpty` |
| attention.ts:199 | D | Server (pure) | `"Pick a look, then add your products to its grid."` | `Attention.storefront.descriptionNone` |
| attention.ts:200 | D | Server (pure) | `"Open designer"` | `Attention.storefront.actionOpen` |
| attention.ts:200 | D | Server (pure) | `"Create storefront"` | `Attention.storefront.actionCreate` |
| attention.ts:211 | D | Server (pure) | `` `"${first.title}" has no display image yet.` `` | `Attention.images.descriptionSingle` (interpolates seller content -- pass title as param, but title is seller-authored and must NOT itself be in the message file; the surrounding sentence is) |
| attention.ts:213 | D | Server (pure) | `"Products without images look empty on your storefront."` | `Attention.images.descriptionMultiple` |
| attention.ts:215 | D | Server (pure) | `"Add an image"` | `Attention.images.actionSingle` |
| attention.ts:215 | D | Server (pure) | `"Fix products"` | `Attention.images.actionMultiple` |
| attention.ts:222 | D | Server (pure) | (dynamic: "$N disputed") | `Attention.flaggedOrders.disputed` with param -- internal assembly |
| attention.ts:240 | D | Server (pure) | `"Review orders"` | `Attention.flaggedOrders.action` |
| attention.ts:259 | D | Server (pure) | `"Product pages blocked from search"` | `Attention.noindexPages.label` |
| attention.ts:260 | D | Server (pure) | `"One storefront has indexing turned off..."` | `Attention.noindexPages.descriptionSingle` |
| attention.ts:264 | D | Server (pure) | `"Open designer"` | `Attention.noindexPages.action` |
| attention.ts:273 | D | Server (pure) | `"These blocks appear empty to visitors. Remove or replace them."` | `Attention.deadBlocks.description` |
| attention.ts:275 | D | Server (pure) | `"Open storefront"` | `Attention.deadBlocks.action` |

**Restructuring note:** `buildAttentionItems` returns `AttentionItem[]` with plain strings today. Change it to return `AttentionItemSpec[]` carrying keys and params; the render boundary (DashboardHome or a dedicated resolver) calls `t(item.labelKey, item.labelParams)`. The `key` discriminant on each item is already stable and suits the key suffix. The flagged-orders description is assembled from parts (disputed count, refunded count) -- this needs ICU or a multi-part key approach; ICU `{count, plural, ...}` with two separate counts is probably cleaner as two resolved strings joined with a comma at the render boundary.

---

### `src/lib/onboarding/steps.ts`

Pure module. Consumed by `components/dashboard/OnboardingSlot.tsx` (the "Get set up" card) and `components/onboarding/WelcomeFlow.tsx` (the closing button reads `next.cta`). Both are the resolution boundary.

**Count-dependent:**

| File:line | Cat | Client/Server | Current string | ICU key | Params |
|-----------|-----|---------------|----------------|---------|--------|
| steps.ts:197 | D | Server (pure) | `` `You have ${productCount} product${productCount===1?"":"s"}.` `` | `Setup.product.detailDone` | `{count}` |

**Other strings:**

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| steps.ts:161 | D | Server (pure) | `"Add your seller details"` | `Setup.seller.label` |
| steps.ts:165 | D | Server (pure) | `"Buyers can see who they are buying from."` | `Setup.seller.detailDone` |
| steps.ts:166 | D | Server (pure) | `"Add your seller details"` (cta, done) | `Setup.seller.ctaDone` |
| steps.ts:175 | D | Server (pure) | `"Open the link we emailed to confirm your contact email."` | `Setup.seller.detailUnconfirmed` |
| steps.ts:176 | D | Server (pure) | `"Confirm email"` | `Setup.seller.actionUnconfirmed` |
| steps.ts:177 | D | Server (pure) | `"Confirm your email"` | `Setup.seller.ctaUnconfirmed` |
| steps.ts:183 | D | Server (pure) | `"Your trader name, address and contact email go on every product page."` | `Setup.seller.detail` |
| steps.ts:184 | D | Server (pure) | `"Add details"` | `Setup.seller.action` |
| steps.ts:185 | D | Server (pure) | `"Add your seller details"` (cta, missing) | `Setup.seller.cta` |
| steps.ts:192 | D | Server (pure) | `"Add a product"` | `Setup.product.label` |
| steps.ts:192 | D | Server (pure) | `"Add your first product"` | `Setup.product.cta` |
| steps.ts:201 | D | Server (pure) | `"A title and a price are enough. It can stay a draft for now."` | `Setup.product.detail` |
| steps.ts:202 | D | Server (pure) | `"Add product"` | `Setup.product.action` |
| steps.ts:208 | D | Server (pure) | `"Put a product on a storefront"` | `Setup.storefront.label` |
| steps.ts:213 | D | Server (pure) | `"A product is on your storefront."` | `Setup.storefront.detailDone` |
| steps.ts:214 | D | Server (pure) | `"Open your storefront"` | `Setup.storefront.ctaDone` |
| steps.ts:220 | D | Server (pure) | `"Create a storefront, then add a product to its grid."` | `Setup.storefront.detailNoStorefront` |
| steps.ts:221 | D | Server (pure) | `"Create storefront"` | `Setup.storefront.actionCreate` |
| steps.ts:222 | D | Server (pure) | `"Create a storefront"` | `Setup.storefront.ctaCreate` |
| steps.ts:229 | D | Server (pure) | `"Open your storefront and choose Add product in the toolbar."` | `Setup.storefront.detailEmpty` |
| steps.ts:230 | D | Server (pure) | `"Open designer"` | `Setup.storefront.action` |
| steps.ts:231 | D | Server (pure) | `"Open your storefront"` | `Setup.storefront.cta` |
| steps.ts:247 | D | Server (pure) | `"Publish its page"` | `Setup.publish.label` |
| steps.ts:249 | D | Server (pure) | `"Your product page is live."` | `Setup.publish.detailDone` |
| steps.ts:249 | D | Server (pure) | `"Publish your product"` | `Setup.publish.cta` |
| steps.ts:257 | D | Server (pure) | `"Finish your seller details, then your page can go live."` | `Setup.publish.detailNeedsSeller` |
| steps.ts:264 | D | Server (pure) | `"Once a product is on a storefront, its page can go live."` | `Setup.publish.detailNeedsStorefront` |
| steps.ts:272 | D | Server (pure) | `"Set that product to Active so its page goes live."` | `Setup.publish.detailNeedsActive` |
| steps.ts:273 | D | Server (pure) | `"Edit product"` | `Setup.publish.actionEdit` |
| steps.ts:280 | D | Server (pure) | `"Product pages are off on that storefront. Turn them on in the designer."` | `Setup.publish.detailPagesOff` |
| steps.ts:281 | D | Server (pure) | `"Open designer"` | `Setup.publish.action` |
| steps.ts:282 | D | Server (pure) | `"Turn on product pages"` | `Setup.publish.ctaPagesOff` |

**Restructuring note:** Same pattern as `attention.ts`. Return `SetupStepSpec[]` carrying keys/params; both consuming components (OnboardingSlot, WelcomeFlow) resolve at render.

---

### `src/lib/notifications/presentation.ts`

Client-safe. Consumed by the notifications list component.

**Cat D strings:**

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| presentation.ts:23 | D | Client | `"Team"` | `Notifications.types.team` |
| presentation.ts:24 | D | Client | `"Order"` | `Notifications.types.order` |
| presentation.ts:25 | D | Client | `"Payment"` | `Notifications.types.payment` |
| presentation.ts:26 | D | Client | `"Stock"` | `Notifications.types.stock` |
| presentation.ts:27 | D | Client | `"System"` | `Notifications.types.system` |
| presentation.ts:28 | D | Client | `"Security"` | `Notifications.types.security` |

**Cat D - relative time strings (interpolated):**

| File:line | Cat | Client/Server | Current string | Proposed key / notes |
|-----------|-----|---------------|----------------|----------------------|
| presentation.ts:50 | D | Client | `"just now"` | `Notifications.time.justNow` |
| presentation.ts:51 | D | Client | `` `${n}m ago` `` | `Notifications.time.minutesAgo` with `{count}` |
| presentation.ts:52 | D | Client | `` `${n}h ago` `` | `Notifications.time.hoursAgo` with `{count}` |
| presentation.ts:53 | D | Client | `` `${n}d ago` `` | `Notifications.time.daysAgo` with `{count}` |

**Cat G - locale-sensitive formatter:**

| File:line | Cat | Client/Server | Current code | Note |
|-----------|-----|---------------|--------------|------|
| presentation.ts:31-35 | G | Client | `new Intl.DateTimeFormat("en-IE", {...})` | Hardcoded `"en-IE"` locale. Must accept the active locale instead. The format options (day/month/year) are correct; only the locale arg must become dynamic. |

**Restructuring note:** `formatRelativeTime` is a pure function called at render time. After extraction it simply calls `t("Notifications.time.minutesAgo", { count: n })` etc. The `Intl.DateTimeFormat` locale must come from the `useLocale()` hook or be passed as a parameter -- do not thread the active locale through the module itself; keep it as a parameter so the module stays pure. Czech and Polish have different grammatical rules for "5 minut" vs "1 minuta" -- these NEED full ICU plural treatment (one/few/many/other) even though English only needs one/other.

---

### `src/lib/errors.ts`

Pure module, client+server. Consumed by `components/ui/ActionErrorNotice` (single renderer for all structured action errors). Every factory's `message` and `fix` strings reach the UI as-is.

**Cat F strings (all cross the server boundary via ActionError):**

| File:line | Cat | Client/Server | Current string | Proposed key | Interpolated? |
|-----------|-----|---------------|----------------|--------------|---------------|
| errors.ts:65 | F | Both | `"Your session has expired."` | `Errors.sessionExpired.message` | No |
| errors.ts:66 | F | Both | `"Sign in again, then retry..."` | `Errors.sessionExpired.fix` | No |
| errors.ts:79-80 | F | Both | `` `Your ${ROLE_LABELS[role]} role can't ${what}...` `` | `Errors.permissionDenied.messageWithRole` | Yes (`{role}`, `{what}`) |
| errors.ts:81 | F | Both | `` `You don't have permission to ${what}...` `` | `Errors.permissionDenied.messageNoRole` | Yes (`{what}`) |
| errors.ts:82 | F | Both | `"Only the store owner can change roles..."` | `Errors.permissionDenied.fix` | No |
| errors.ts:91-92 | F | Both | `` `That ${what} could not be found.` `` | `Errors.notFound.message` | Yes (`{what}`) |
| errors.ts:93 | F | Both | `"It may have been deleted, or you may have switched stores..."` | `Errors.notFound.fix` | No |
| errors.ts:118-119 | F | Both | `` `Too many attempts to ${what} in a short time.` `` | `Errors.rateLimited.message` | Yes (`{what}`) |
| errors.ts:120 | F | Both | `"Wait a few minutes and try again..."` | `Errors.rateLimited.fix` | No |
| errors.ts:136 | F | Both | `"You can't publish or sell until your seller details are complete."` | `Errors.traderRequired.message` | No -- also in trader-identity.ts:164 |
| errors.ts:139 | F | Both | `"Add seller details"` | `Errors.traderRequired.actionLabel` | No |
| errors.ts:144-145 | F | Both | `` `Could not ${what} because of a problem on our side.` `` | `Errors.serverError.message` | Yes (`{what}`) |
| errors.ts:146 | F | Both | `"This is usually temporary. Wait a moment and try again..."` | `Errors.serverError.fix` | No |
| errors.ts:153-154 | F | Both | `"Something went wrong."` (or detail) | `Errors.unexpected.message` | Yes (optional `{detail}`) |
| errors.ts:155 | F | Both | `"Check your connection and try again..."` | `Errors.unexpected.fix` | No |

**Note on `uploadFailed` and `invalidInput`:** These take message and fix as call-site arguments (no fixed strings in this file), so the user-facing strings live in the callers (products/actions.ts, storefront/actions.ts, import-actions.ts). See those files' findings below.

---

### `src/lib/settings/trader-identity.ts`

Pure module, client+server. Rendered by multiple surfaces (product form banner, storefront embed modal, dashboard banner, server actions via `traderIdentityRequired()`).

| File:line | Cat | Client/Server | Current string | Proposed key | Interpolated? |
|-----------|-----|---------------|----------------|--------------|---------------|
| trader-identity.ts:69 | D | Both | `"Trader name"` | `TraderIdentity.fields.businessName.label` | No |
| trader-identity.ts:71 | D | Both | `"Buyers have to know who they are buying from..."` | `TraderIdentity.fields.businessName.why` | No |
| trader-identity.ts:75 | D | Both | `"Business address"` | `TraderIdentity.fields.address.label` | No |
| trader-identity.ts:77 | D | Both | `"A postal address has to appear with every offer..."` | `TraderIdentity.fields.address.why` | No |
| trader-identity.ts:81 | D | Both | `"Contact email"` | `TraderIdentity.fields.email.label` | No |
| trader-identity.ts:83-84 | D | Both | `"The address buyers write to about an order..."` | `TraderIdentity.fields.email.why` | No |
| trader-identity.ts:87 | D | Both | `"Confirmed contact email"` | `TraderIdentity.fields.emailVerified.label` | No |
| trader-identity.ts:89-90 | D | Both | `"We send a link to that address and you click it..."` | `TraderIdentity.fields.emailVerified.why` | No |
| trader-identity.ts:164 | D | Both | `"You can't publish or sell until your seller details are complete."` | `TraderIdentity.headline` | No |
| trader-identity.ts:175-187 | D | Both | (result of `traderIdentityFix()`) | See note | Yes (field list) |

**Note on `traderIdentityFix()`:** The function assembles a sentence from the list of missing fields. It calls `listMissingTraderFields()` which joins field labels with commas and "and". This is locale-sensitive list formatting. The cleanest approach: instead of assembling a string here, return a key that takes the missing field keys as params, and do the list joining at the render boundary using `Intl.ListFormat` with the active locale. Czech has grammatical cases (locative: "v nastavení > Podnikatel a prodejce") that may require separate key variants rather than list injection.

**Note on `listMissingTraderFields()`:** This function returns a grammatically joined list (e.g., "trader name and contact email"). This is exactly where `Intl.ListFormat` should replace the hand-written join. The render boundary should receive the KEYS of the missing fields and format the list with the locale's conjunction.

---

### `src/lib/team/permissions.ts`

Pure module, client+server. `ROLE_LABELS` and `ROLE_DESCRIPTIONS` are rendered in the team settings UI and in notification bodies (which are authored by server actions).

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| permissions.ts:91 | D | Both | `"Owner"` | `Team.roles.owner` |
| permissions.ts:92 | D | Both | `"Editor"` | `Team.roles.editor` |
| permissions.ts:93 | D | Both | `"Viewer"` | `Team.roles.viewer` |
| permissions.ts:96 | D | Both | `"Full control. Exactly one per store, cannot be changed or removed."` | `Team.roleDescriptions.owner` |
| permissions.ts:97-99 | D | Both | `"Can view the store and edit products and the storefront..."` | `Team.roleDescriptions.editor` |
| permissions.ts:100 | D | Both | `"Can view the store and team. Read-only."` | `Team.roleDescriptions.viewer` |

**Note:** `ROLE_LABELS` is also interpolated into ActionError bodies in `errors.ts` (`permissionDenied`) and into in-app notification bodies built in `team/actions.ts` (e.g., `"invited you to join as ${ROLE_LABELS[role]}"`). The notification body is created server-side with no locale context -- this is the hardest class of string: it is authored once and read later by a recipient whose locale may differ from the sender's. Out of scope for Phase 5; flag as deferred.

---

### `src/lib/validation/inputs.ts`

Pure module, client+server. All messages generated here cross the server boundary when used in settings, team, shipping, or auth actions.

| File:line | Cat | Client/Server | Current template | Proposed key | Interpolated? |
|-----------|-----|---------------|------------------|--------------|---------------|
| inputs.ts:48 | E | Both | `` `${label} is required.` `` | `Validation.required` | Yes (`{label}`) |
| inputs.ts:48 | E | Both | `` `${label} needs at least ${min} characters.` `` | `Validation.minLength` | Yes (`{label}`, `{min}`) |
| inputs.ts:49 | E | Both | `` `${label} must be ${max} characters or fewer.` `` | `Validation.maxLength` | Yes (`{label}`, `{max}`) |
| inputs.ts:51 | E | Both | `` `${label} contains unsupported characters.` `` | `Validation.controlChars` | Yes (`{label}`) |
| inputs.ts:65 | E | Both | `` `${label} is required.` `` | `Validation.required` | Yes (`{label}`) |
| inputs.ts:66 | E | Both | `` `${label} must be ${max} characters or fewer.` `` | `Validation.maxLength` | Yes (`{label}`, `{max}`) |
| inputs.ts:67 | E | Both | `` `${label} contains unsupported characters.` `` | `Validation.controlChars` | Yes (`{label}`) |
| inputs.ts:81 | E | Both | `` `${label} is not valid.` `` | `Validation.uuid` | Yes (`{label}`) |
| inputs.ts:90 | E | Both | `` `${label} doesn't look like an email address.` `` | `Validation.emailFormat` | Yes (`{label}`) |
| inputs.ts:91 | E | Both | `` `${label} is too long.` `` | `Validation.emailTooLong` | Yes (`{label}`) |
| inputs.ts:92 | E | Both | `` `${label} contains unsupported characters.` `` | `Validation.controlChars` | Yes (`{label}`) |
| inputs.ts:120 | E | Both | `` `${label} must be 3 to 30 characters, using only letters, numbers and underscores.` `` | `Validation.handleFormat` | Yes (`{label}`) |
| inputs.ts:143 | E | Both | `` `${label} must be bare lowercase domains like yoursite.com...` `` | `Validation.hostnameFormat` | Yes (`{label}`) |
| inputs.ts:183 | E | Both | `` `${label} must be ${min} to ${max} letters, digits, spaces, dots or hyphens.` `` | `Validation.referenceCode` | Yes (`{label}`, `{min}`, `{max}`) |
| inputs.ts:196 | E | Both | `` `${label} must be 6-digit hex, like #a855f7.` `` | `Validation.hexColor` | Yes (`{label}`) |
| inputs.ts:212 | E | Both | `` `${label} must be a whole number.` `` | `Validation.mustBeInt` | Yes (`{label}`) |
| inputs.ts:213 | E | Both | `` `${label} must be ${min} or more.` `` | `Validation.minValue` | Yes (`{label}`, `{min}`) |
| inputs.ts:214 | E | Both | `` `${label} must be ${max} or fewer.` `` | `Validation.maxValue` | Yes (`{label}`, `{max}`) |
| inputs.ts:225 | E | Both | `` `List up to ${max} ${options.label}.` `` | `Validation.listMax` | Yes (`{max}`, `{label}`) |
| inputs.ts:227 | E | Both | `` `Each entry in ${options.label} can only be listed once.` `` | `Validation.listUnique` | Yes (`{label}`) |

**Restructuring note:** Every primitive returns an inline Zod message built from `label` and `max`. After extraction, `label` should become a translation key too (e.g., `"A product title"` -> `Common.fields.productTitle`), not a raw English string passed as a parameter. The cleanest shape: the caller passes a field key rather than an English label, and the validation layer resolves to a display string at the render boundary. This is a significant change but it eliminates a whole category of English-that-crosses-server-boundary.

---

### `src/lib/validation/settings.ts`

Pure module. All messages cross the server boundary via `firstIssue()` in `settings/actions.ts`.

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| settings.ts:49 | E | Both | `"Enter your current password."` | `Validation.Settings.currentPasswordRequired` |
| settings.ts:51 | E | Both | `"New password needs at least 8 characters."` | `Validation.Settings.newPasswordMin` |
| settings.ts:52 | E | Both | `"Keep it under 72 characters."` | `Validation.Settings.newPasswordMax` |
| settings.ts:55 | E | Both | `"New passwords do not match."` | `Validation.Settings.passwordsMismatch` |
| settings.ts:80 | E | Both | `` `${label} doesn't look like an email address.` `` | `Validation.emailFormat` (shared) |
| settings.ts:128 | E | Both | `"Pick a country from the list."` | `Validation.Settings.pickCountry` |
| settings.ts:142 | E | Both | `"The legal docs changed while you were reading. Reload and try again."` | `Validation.Settings.legalVersionMismatch` |
| settings.ts:150-151 | E | Both | `` `Type "${DELETE_CONFIRM_PHRASE}" exactly to confirm.` `` | `Validation.Settings.deleteConfirm` (interpolates the confirm phrase -- phrase itself should also be a key) |

---

### `src/lib/validation/product.ts`

Pure module. The Zod messages here do NOT cross the server boundary via `firstIssue()` -- instead `products/actions.ts` returns a fixed `invalidInput(...)` message rather than propagating Zod issues. The messages here show as inline client hints only.

Exception: they ARE the server boundary for the presign endpoint (if it uses safeParse and surfaces issues). Treat as client-only for now; mark uncertain for the upload paths.

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| product.ts:286 | E | Client (UX) | `` `A version can have up to ${OPTION_SPECS_MAX} of its own specifications.` `` | `Validation.Product.optionSpecsMax` |
| product.ts:309 | E | Client (UX) | `"Give every option group at least one option, or remove the group."` | `Validation.Product.optionGroupMin` |
| product.ts:310 | E | Client (UX) | `` `An option group can have up to ${OPTIONS_PER_GROUP_MAX} options.` `` | `Validation.Product.optionGroupMax` |
| product.ts:359 | E | Client (UX) | `` `List up to ${INCLUDED_MAX} included items.` `` | `Validation.Product.includedMax` |
| product.ts:362 | E | Client (UX) | `` `List up to ${SPECS_MAX} specifications.` `` | `Validation.Product.specsMax` |
| product.ts:403-404 | E | Client (UX) | `"The purchase link must be a full https:// address."` | `Validation.Product.purchaseLinkFormat` |
| product.ts:404 | E | Client (UX) | `` `The purchase link must be ${PURCHASE_URL_MAX} characters or fewer.` `` | `Validation.Product.purchaseLinkMax` |
| product.ts:410-411 | E | Client (UX) | `"The purchase link cannot contain a username or password."` | `Validation.Product.purchaseLinkCredentials` |
| product.ts:456 | E | Client (UX) | `` `A product can have up to ${GALLERY_MAX} extra photos.` `` | `Validation.Product.galleryMax` |
| product.ts:459 | E | Client (UX) | `` `A product can have up to ${OPTION_GROUPS_MAX} option groups.` `` | `Validation.Product.optionGroupsMax` |
| product.ts:463 | E | Client (UX) | `` `A product can have up to ${DOCUMENTS_MAX} documents.` `` | `Validation.Product.documentsMax` |
| product.ts:481 | E | Client (UX) | `"Set how many are in stock."` | `Validation.Product.stockRequired` |
| product.ts:487 | E | Client (UX) | `"Each option can only be listed once."` | `Validation.Product.optionDuplicate` |
| product.ts:494 | E | Client (UX) | `` `A product can have up to ${OPTIONS_TOTAL_MAX} options in total.` `` | `Validation.Product.optionsTotalMax` |
| product.ts:508 | E | Client (UX) | `"A photo points at an option that no longer exists."` | `Validation.Product.galleryStaleOption` |

---

### `src/lib/validation/team.ts`

Pure module. Messages cross the server boundary via `firstIssue()` in `team/actions.ts`.

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| team.ts:17 | E | Both | `"Invalid store reference."` | `Validation.Team.invalidStore` |
| team.ts:19 | E | Both | `"That doesn't look like an email address."` | `Validation.Team.invalidEmail` |
| team.ts:20 | E | Both | `"That email is too long."` | `Validation.Team.emailTooLong` |
| team.ts:24 | E | Both | `"Pick a valid role."` | `Validation.Team.invalidRole` |
| team.ts:29 | E | Both | `"Invalid invite reference."` | `Validation.Team.invalidInvite` |
| team.ts:34 | E | Both | `"Invalid store reference."` | `Validation.Team.invalidStore` |
| team.ts:35 | E | Both | `"Invalid member reference."` | `Validation.Team.invalidMember` |

---

### `src/lib/validation/shipping-policy.ts`

Pure module. Messages cross the server boundary via the inline `parsed.error.issues[0]?.message` in `shipping-actions.ts`.

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| shipping-policy.ts:48 | E | Both | `"That is not a country we can ship from yet."` | `Validation.Shipping.invalidCountry` |
| shipping-policy.ts:58-60 | E | Both | `` `You can list up to ${SHIPPING_DESTINATIONS_MAX} destinations.` `` | `Validation.Shipping.destinationsMax` |
| shipping-policy.ts:78 | E | Both | `"A returns window is a whole number of days."` | `Validation.Shipping.returnsWindowInt` |
| shipping-policy.ts:79 | E | Both | `"A returns window cannot be negative."` | `Validation.Shipping.returnsWindowMin` |
| shipping-policy.ts:81 | E | Both | `` `A returns window tops out at ${RETURNS_WINDOW_MAX_DAYS} days.` `` | `Validation.Shipping.returnsWindowMax` |

---

### `src/lib/validation/auth.ts`

Pure module. The one message here crosses the boundary via `parsedUsername.error.issues[0]?.message` in `auth/actions.ts`.

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| auth.ts:66 | E | Both | `"That username is reserved. Pick another."` | `Validation.Auth.usernameReserved` |

---

### `src/lib/auth/password.ts`

Pure module, client+server. `passwordProblem()` return values cross the server boundary in `auth/actions.ts` and `settings/actions.ts`.

| File:line | Cat | Client/Server | Current string | Proposed key | Interpolated? |
|-----------|-----|---------------|----------------|--------------|---------------|
| password.ts:91 | E | Both | `` `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` `` | `Validation.Password.tooShort` | Yes (`{min}`) |
| password.ts:95 | E | Both | `` `Keep it under ${PASSWORD_MAX_LENGTH} characters.` `` | `Validation.Password.tooLong` | Yes (`{max}`) |
| password.ts:104 | E | Both | `"That password is too common. Pick something less guessable."` | `Validation.Password.tooCommon` | No |
| password.ts:108 | E | Both | `"That password is too easy to guess. Try a longer mix of words."` | `Validation.Password.repeated` | No |
| password.ts:116 | E | Both | `"That password contains a common keyboard sequence. Try something else."` | `Validation.Password.sequence` | No |
| password.ts:127 | E | Both | `"Password must not contain your email address or username."` | `Validation.Password.containsIdentity` | No |
| password.ts:131 | E | Both | `` `Mix in upper and lower case, a number or a symbol -- or use ${PASSPHRASE_LENGTH}+ characters.` `` | `Validation.Password.weakMix` | Yes (`{passphrase}`) |

---

### `src/lib/validation/email-quality.ts`

Pure module. `emailQualityProblem()` crosses the server boundary in `settings/actions.ts` (saveTaxInfo).

| File:line | Cat | Client/Server | Current string | Proposed key | Interpolated? |
|-----------|-----|---------------|----------------|--------------|---------------|
| email-quality.ts:144 | E | Both | `` `${label} looks like a placeholder. Use an address you actually read.` `` | `Validation.Email.placeholder` | Yes (`{label}`) |
| email-quality.ts:147 | E | Both | `` `${label} is at a temporary-mail provider. Use a permanent address.` `` | `Validation.Email.disposable` | Yes (`{label}`) |

---

### `src/lib/settings/actions.ts` (Cat F -- action return strings)

All these strings are the `SettingsActionState.error` / `.success` values returned to the client. They must become keys.

| File:line | Cat | Current string | Proposed key |
|-----------|-----|----------------|--------------|
| actions.ts:35 | F | `"Your session expired. Sign in again."` | `Common.errors.sessionExpired` |
| actions.ts:38 | F | `"Could not save. Give it another try."` | `Common.errors.saveFailed` |
| actions.ts:44 | F | `"That's a lot of changes in a short time. Try again a bit later."` | `Common.errors.tooManyChanges` |
| actions.ts:99 | F | `` `Unexpected field "${key}" was rejected.` `` | `Common.errors.unexpectedField` |
| actions.ts:106 | F | `"Check the form and try again."` | `Common.errors.checkForm` |
| actions.ts:184 | F | `"That username is taken. Try another."` | `Settings.Account.usernameTaken` |
| actions.ts:186 | F | `"Username saved."` | `Settings.Account.usernameSaved` |
| actions.ts:212 | F | `"That's already your email."` | `Settings.Account.emailUnchanged` |
| actions.ts:221-222 | F | `"Too many email-change requests. Wait a while before trying again."` | `Settings.Account.emailRateLimit` |
| actions.ts:236-237 | F | `"Enter your current password to change your email."` | `Settings.Account.emailNeedsPassword` |
| actions.ts:242 | F | `"Current password is incorrect."` | `Settings.Account.wrongPassword` |
| actions.ts:249 | F | `"Could not start the email change. Try again."` | `Settings.Account.emailChangeFailed` |
| actions.ts:257 | F | `"Check your inbox. The change applies once you confirm the link."` | `Settings.Account.emailChangeCheck` |
| actions.ts:311 | F | `"Current password is incorrect."` | `Settings.Account.wrongPassword` |
| actions.ts:318 | F | `"That's already your password."` | `Settings.Account.passwordUnchanged` |
| actions.ts:319 | F | `"Could not update the password. Try again."` | `Settings.Account.passwordUpdateFailed` |
| actions.ts:333 | F | `"Password updated. Other devices have been signed out."` | `Settings.Account.passwordUpdated` |
| actions.ts:359 | F | `"Too many reset emails. Wait a while before trying again."` (x2) | `Settings.Account.resetRateLimit` |
| actions.ts:376 | F | `"Too many requests. Wait a minute and try again."` | `Settings.Account.supabaseRateLimit` |
| actions.ts:377 | F | `"Could not send the reset email. Try again."` | `Settings.Account.resetFailed` |
| actions.ts:388 | F | `"Reset link sent. Check your inbox."` | `Settings.Account.resetSent` |
| actions.ts:413 | F | `"Accepted. Thanks for reading the fine print."` | `Settings.Legal.accepted` |
| actions.ts:452 | F | `"Check the form and try again."` | `Common.errors.checkForm` |
| actions.ts:479-481 | F | `"That contact email's domain doesn't accept mail..."` | `Settings.Tax.badEmailDomain` |
| actions.ts:524-526 | F | `` `Saved, but the confirmation email didn't go out. ${started.reason} Try "Resend" below.` `` | `Settings.Tax.savedEmailFailed` (interpolates reason -- uncertain; reason comes from `seller-email-verification.ts`) |
| actions.ts:528-530 | F | `` `Saved. Check ${email} for a link to confirm the address.` `` | `Settings.Tax.savedCheckEmail` (interpolates email address -- this is user data, pass as param) |
| actions.ts:533 | F | `"Business & seller details saved."` | `Settings.Tax.saved` |
| actions.ts:556-557 | F | `"Email confirmation is not available right now."` | `Settings.Tax.verificationUnavailable` |
| actions.ts:562-563 | F | `"That's a lot of confirmation emails. Wait a while before asking for another."` | `Settings.Tax.verifyRateLimit` |
| actions.ts:574 | F | `"Add a contact email first, then we can confirm it."` | `Settings.Tax.noEmailToVerify` |
| actions.ts:577 | F | `"That address is already confirmed."` | `Settings.Tax.alreadyConfirmed` |
| actions.ts:585 | F | `"Could not send the reset email. Try again."` (resend) | `Settings.Tax.resendFailed` |
| actions.ts:586 | F | `` `Sent. Check ${email} for the link.` `` | `Settings.Tax.resendSent` (interpolates email) |
| actions.ts:617 | F | `"Preferences saved."` | `Settings.Notifications.saved` |
| actions.ts:657 | F | `"Deletion requested."` | `Settings.Danger.deletionRequested` |
| actions.ts:674 | F | `"Deletion request cancelled. Good to have you back."` | `Settings.Danger.deletionCancelled` |

---

### `src/lib/auth/actions.ts` (Cat F -- action return strings)

`AuthState = { error?: string; message?: string }`.

| File:line | Cat | Current string | Proposed key |
|-----------|-----|----------------|--------------|
| actions.ts:49-51 | F | `"Check your email for a link to confirm your account..."` | `Auth.signup.checkEmail` |
| actions.ts:78 | F | `"Too many attempts. Wait a while and try again."` | `Common.errors.tooManyAttempts` |
| actions.ts:86 | F | `"Incorrect email or password."` | `Auth.signin.badCredentials` |
| actions.ts:186 | F | `"Confirm your email first -- check your inbox for the link."` | `Auth.signin.emailNotConfirmed` |
| actions.ts:197 | F | `"That password is too weak. Use at least 8 characters."` | `Auth.signin.weakPassword` |
| actions.ts:198 | F | `"Too many attempts. Wait a minute and try again."` | `Common.errors.tooManyAttempts` |
| actions.ts:200 | F | `"Enter a valid email address."` | `Auth.signin.invalidEmail` |
| actions.ts:204 | F | `"Could not create that account. Try a different username."` | `Auth.signup.usernameTaken` |
| actions.ts:209-210 | F | `error.message \|\| "Something went wrong. Please try again."` | `Common.errors.unexpected` |
| actions.ts:261 | F | `"Enter a valid email address."` | `Auth.signin.invalidEmail` |
| actions.ts:265 | F | `"Enter your email."` | `Auth.magic.emailRequired` |
| actions.ts:286 | F | `"Check your email for a link to sign in."` | `Auth.magic.checkEmail` |
| actions.ts:291 | F | `"Enter your email to reset your password."` | `Auth.reset.emailRequired` |
| actions.ts:299 | F | `"If that email has an account, a reset link is on its way."` | `Auth.reset.message` |
| actions.ts:328 | F | `"Email and password are required."` | `Auth.signin.required` |
| actions.ts:334 | F | `"Passwords do not match."` | `Auth.signup.passwordsMismatch` |
| actions.ts:342 | F | `` parsedUsername.error.issues[0]?.message ?? "Pick a valid username." `` | `Validation.Auth.usernameReserved` (or appropriate) |
| actions.ts:355-356 | F | `"Please sign up with a permanent email address."` | `Auth.signup.disposableEmail` |
| actions.ts:364-365 | F | `"Verification failed. Please try again."` | `Auth.signup.turnstileFailed` |
| actions.ts:519-520 | F | `"Your reset link has expired. Request a new one from the sign-in page."` | `Auth.reset.expired` |
| actions.ts:543 | F | `"Could not update your password. Check your connection and try again."` | `Auth.reset.updateFailed` |
| actions.ts:547 | F | `"That's already your password. Pick a new one."` | `Auth.reset.samePassword` |

---

### `src/lib/team/actions.ts` (Cat F -- action return strings)

`TeamActionState = { error?: string; success?: string }`.

| File:line | Cat | Current string | Proposed key |
|-----------|-----|----------------|--------------|
| actions.ts:52 | F | `"Your session expired. Sign in again."` | `Common.errors.sessionExpired` |
| actions.ts:73 | F | `` `Unexpected field "${key}" was rejected.` `` | `Common.errors.unexpectedField` |
| actions.ts:74 | F | `"Check the form and try again."` | `Common.errors.checkForm` |
| actions.ts:114 | F | `"You don't have permission to invite members."` | `Team.errors.noInvitePermission` |
| actions.ts:118 | F | `"You can't invite someone at a role higher than your own."` | `Team.errors.inviteRoleTooHigh` |
| actions.ts:122 | F | `"You're already here."` | `Team.errors.inviteSelf` |
| actions.ts:133-134 | F | `"You've sent a lot of invites recently. Try again a bit later."` | `Team.errors.inviteRateLimit` |
| actions.ts:150 | F | `"Already invited or already on the team."` | `Team.errors.alreadyInvited` |
| actions.ts:152 | F | `"Could not send the invite. Give it another try."` | `Team.errors.inviteFailed` |
| actions.ts:169 | F | (notification body -- deferred, see note above) | -- |
| actions.ts:197-199 | F | `"Invite created. They'll see it when they sign in..."` | `Team.invite.created` |
| actions.ts:215-216 | F | `"Your account has no verified email address."` | `Team.errors.noEmail` |
| actions.ts:239 | F | `"Invite not found or already used."` | `Team.errors.inviteNotFound` |
| actions.ts:243 | F | `"This invite has already been accepted or revoked."` | `Team.errors.inviteUsed` |
| actions.ts:247 | F | `"This invite isn't for your email address."` | `Team.errors.inviteWrongEmail` |
| actions.ts:259 | F | `"Could not accept the invite. It may have been revoked."` | `Team.errors.acceptFailed` |
| actions.ts:282 | F | `"Welcome to the team."` | `Team.invite.accepted` |
| actions.ts:316 | F | `"You don't have permission to change roles."` | `Team.errors.noRolePermission` |
| actions.ts:320 | F | `"Too many membership changes. Try again shortly."` | `Team.errors.membershipRateLimit` |
| actions.ts:323 | F | `"You can't assign a role higher than your own."` | `Team.errors.roleTooHigh` |
| actions.ts:337 | F | `"Could not change the role. Give it another try."` | `Team.errors.roleFailed` |
| actions.ts:340 | F | `"That member can't be changed."` | `Team.errors.memberNotFound` |
| actions.ts:347 | F | `"Role updated."` | `Team.roleUpdated` |
| actions.ts:373 | F | `"You don't have permission to remove members."` | `Team.errors.noRevokePermission` |
| actions.ts:378 | F | `"Too many membership changes. Try again shortly."` | `Team.errors.membershipRateLimit` |
| actions.ts:393 | F | `"Member not found."` | `Team.errors.memberNotFoundRevoke` |
| actions.ts:396 | F | `"You can't remove yourself."` | `Team.errors.revokeSelf` |
| actions.ts:409 | F | `"Could not remove the member. Give it another try."` | `Team.errors.revokeFailed` |
| actions.ts:411 | F | `"That member can't be removed."` | `Team.errors.memberNotChangeable` |
| actions.ts:420 | F | `"Member removed."` | `Team.memberRemoved` |

---

### `src/lib/settings/shipping-actions.ts` (Cat F)

| File:line | Cat | Current string | Proposed key |
|-----------|-----|----------------|--------------|
| shipping-actions.ts:38 | F | `"Your session expired. Sign in again."` | `Common.errors.sessionExpired` |
| shipping-actions.ts:41 | F | `"Could not save. Give it another try."` | `Common.errors.saveFailed` |
| shipping-actions.ts:43 | F | `"That's a lot of changes in a short time. Try again a bit later."` | `Common.errors.tooManyChanges` |
| shipping-actions.ts:46 | F | `"Could not read the form. Reload the page and try again."` | `Common.errors.malformedForm` |
| shipping-actions.ts:70 | F | `` `Unexpected field "${key}" was rejected.` `` | `Common.errors.unexpectedField` |
| shipping-actions.ts:88 | F | `"Check the form and try again."` | `Common.errors.checkForm` |
| shipping-actions.ts:113 | F | `"Shipping & returns saved."` | `Settings.Shipping.saved` |

---

### `src/lib/products/actions.ts` -- `ActionError` call sites (Cat F)

These reach the UI via `ActionErrorNotice`. They use the `invalidInput()` and `uploadFailed()` factories which take raw English strings at the call site -- those strings must become keys.

| File:line | Cat | Current string | Proposed key |
|-----------|-----|----------------|--------------|
| products/actions.ts:79 | F | `"The product details didn't pass validation."` | `Products.errors.validationFailed.message` |
| products/actions.ts:80 | F | `"Check the name, price, and other fields, then try saving again."` | `Products.errors.validationFailed.fix` |
| products/actions.ts:87-89 | F | `"That image upload can't be used with this product."` / `"Re-upload the image, then save again."` | `Products.errors.badImageOwnership` |
| products/actions.ts:93-96 | F | `"That file upload can't be used with this product."` / `"Re-upload the file, then save again."` | `Products.errors.badFileOwnership` |
| products/actions.ts:159-161 | F | `` `Your ${noun} upload didn't finish.` `` / `` `Select the ${noun} again and re-upload...` `` | `Products.errors.uploadIncomplete` (interpolates kind) |
| products/actions.ts:172-174 | F | `` `That ${noun} is too large.` `` / `` `Use a ${noun} under ${maxLabel}...` `` | `Products.errors.uploadTooLarge` (interpolates kind, size) |
| products/actions.ts:185-191 | F | `"That file type is not supported."` + kind-specific fix | `Products.errors.uploadWrongType` (3 fix variants) |
| products/actions.ts:238-240 | F | `"Too many new photos in one save."` / `` `Add up to ${N} photos, save, then add the rest.` `` | `Products.errors.tooManyPhotos` |
| products/actions.ts:246-249 | F | `"One of the photos can't be used with this product."` | `Products.errors.badPhotoOwnership` |
| products/actions.ts:266-269 | F | `"Too many new documents in one save."` | `Products.errors.tooManyDocuments` |
| products/actions.ts:274-277 | F | `"One of the documents can't be used with this product."` | `Products.errors.badDocumentOwnership` |
| products/actions.ts:308-310 | F | `"A photo points at an option that no longer exists."` / `"Reassign or untag that photo, then save again."` | `Products.errors.staleOption` |

---

### `src/lib/products/csv.ts` -- import problem strings (Cat F)

These end up in `ImportResult.skipped[].reason` which is rendered in the import UI.

| File:line | Cat | Current string | Proposed key |
|-----------|-----|----------------|--------------|
| csv.ts:350 | F | `"No title."` | `Products.import.problems.noTitle` |
| csv.ts:351 | F | `"Title is longer than 200 characters."` | `Products.import.problems.titleTooLong` |
| csv.ts:352 | F | `"No price we could read."` | `Products.import.problems.noPrice` |
| csv.ts:353 | F | `"Price is zero."` | `Products.import.problems.priceZero` |
| csv.ts:354 | F | `"Another row has this title."` | `Products.import.problems.duplicateTitle` |

---

### `src/lib/products/import-actions.ts` -- ActionError strings (Cat F)

| File:line | Cat | Current string | Proposed key |
|-----------|-----|----------------|--------------|
| import-actions.ts:108 | F | `"That import could not be read."` / `"Upload the file again."` | `Products.import.errors.unreadable` |
| import-actions.ts:113 | F | `"That file was empty."` / `"Export your products again and retry."` | `Products.import.errors.empty` |
| import-actions.ts:119-121 | F | `"That file is too large to import."` / `` `Split it into files under ${maxMb} MB...` `` | `Products.import.errors.tooLarge` |
| import-actions.ts:127-130 | F | `"Pick a currency for these products."` / `"Choose one, then import again."` | `Products.import.errors.noCurrency` |
| import-actions.ts:132-136 | F | `"Pick whether these arrive as drafts or live products."` / `"Choose one, then import again."` | `Products.import.errors.noStatus` |

---

### `src/lib/storefront/actions.ts` -- ActionError strings (Cat F, partial)

| File:line | Cat | Current string | Proposed key |
|-----------|-----|----------------|--------------|
| storefront/actions.ts:108 | F | `"Untitled storefront"` | `Storefront.defaultName` (uncertain -- may be seller-editable content; flag for review) |
| storefront/actions.ts:209-210 | F | `"The storefront needs a name."` / `"Type a name (1 to 80 characters)..."` | `Storefront.errors.noName` |
| storefront/actions.ts:217-219 | F | `"The storefront layout data is invalid."` / `"Refresh the editor and try saving again."` | `Storefront.errors.invalidLayout` |

---

### Other `src/lib` files with no user-facing copy

The following files were audited and contain no strings in scope (internal, config, or DB values only):
`analytics/*`, `format/*`, `geometry/*`, `hooks/*`, `images/*`, `legal/links.ts`, `moderation/*`, `orders/*`, `payments/*`, `products/detail.ts`, `products/form-datapoints.ts`, `products/option-details.ts`, `products/option-presets.ts`, `products/picker-actions.ts`, `products/picker-constants.ts`, `products/price.ts`, `products/preview-actions.ts`, `products/public.ts`, `products/quantity.ts`, `products/queries.ts`, `products/return-path.ts`, `products/sort.ts`, `products/upload.ts`, `r2.ts`, `rate-limit.ts`, `search/catalog.ts`, `search/fuzzy.ts`, `search/hrefs.ts`, `search/rank.ts`, `search/types.ts`, `search/vocabulary.ts`, `security/events.ts`, `settings/avatar.ts`, `settings/constants.ts`, `settings/seller-email-verification.ts`, `settings/shipping-policy.ts`, `site.ts`, `stock/actions.ts`, `stock/badge.ts`, `stock/decrement.ts`, `stock/public.ts`, `storefront/embed.ts`, `storefront/header-text.ts`, `storefront/layers.ts`, `storefront/layout-presets.ts`, `storefront/presets.ts`, `storefront/product-page.ts`, `storefront/product-page-url.ts`, `storefront/queries.ts`, `storefront/setting-ref.ts`, `storefront/shipping.ts`, `storefront/templates.ts`, `storefront/text-selection.ts`, `storefront/text-spans.ts`, `storefront/tile-spots.ts`, `supabase/*`, `team/account-context.ts`, `team/queries.ts`, `theme/*`, `turnstile.ts`, `typing-debounce.ts`, `uploads/*`, `utils/*`, `validation/disposable-email.ts`, `validation/email-domain.ts`, `validation/notifications.ts`, `validation/search.ts`, `validation/storefront-brief.ts`, `validation/storefront.ts` (schema only -- no user messages).

**Uncertain:** `settings/seller-identity.ts` -- `publishBlockedError()` calls `traderIdentityRequired()` which produces an `ActionError`. Those strings are in `errors.ts` and `trader-identity.ts` and are covered above.

---

## ICU plural requirements summary

Czech and Polish need four plural forms (one/few/many/other). These eight strings must be authored as ICU plurals from day one:

| Key | Surfaces | Variable |
|-----|----------|----------|
| `Attention.noBuyPath.label` | Overview attention card | `{count}` products |
| `Attention.images.label` | Overview attention card | `{count}` products |
| `Attention.flaggedOrders.label` | Overview attention card | `{count}` orders |
| `Attention.noindexPages.description` | Overview attention card | `{count}` storefronts |
| `Attention.deadBlocks.label` | Overview attention card | `{count}` blocks |
| `Setup.product.detailDone` | Setup checklist | `{count}` products |
| `Notifications.time.minutesAgo` | Notification timestamp | `{count}` minutes |
| `Notifications.time.hoursAgo` | Notification timestamp | `{count}` hours |
| `Notifications.time.daysAgo` | Notification timestamp | `{count}` days |

---

## Locale-sensitive formatters (Cat G)

| File:line | Current code | Required change |
|-----------|--------------|-----------------|
| `notifications/presentation.ts:31-35` | `new Intl.DateTimeFormat("en-IE", ...)` | Pass active locale as parameter; do not hardcode `"en-IE"`. Consumer passes locale from `useLocale()`. |

---

## Files requiring restructuring (not simple string extraction)

| File | Reason |
|------|--------|
| `dashboard/attention.ts` | Returns structured objects; must change return type to key+params shape. |
| `onboarding/steps.ts` | Same -- returns structured step objects; must add key fields. |
| `settings/trader-identity.ts` | `traderIdentityFix()` and `listMissingTraderFields()` compose sentences from field labels; needs `Intl.ListFormat` at the render boundary. |
| `errors.ts` | `permissionDenied`, `notFound`, `serverError`, `rateLimited`, `unexpectedError` interpolate runtime values into English sentences; move to key+params. |
| `notifications/presentation.ts` | `formatRelativeTime` composes relative-time strings; needs plurals and locale param. |
| `validation/inputs.ts` | Every primitive interpolates a caller-supplied English `label`; label strings themselves need extraction -- callers must pass keys, not English. |
| `team/actions.ts` | Notification bodies created server-side (e.g., `"${storeLabel} invited you..."`) include dynamic content that cannot be keyed simply; flag as deferred to Phase 6. |
