# P2: Public messaging (R7), expansion waitlist (R8) and Czech legal texts: design

Design only, 2026-11-22. Nothing was built, run or published. Read with Read, Grep, Glob and read-only git; no server, test, build, Stripe, Supabase or MCP call. Every legal wording below is a **DRAFT for lawyer review** where marked; no published Terms version is edited or proposed for editing.

Path prefixes: `Store/` = C:\Squareshare\Store, `Home/` = C:\Squareshare\Home (branch `homepage-rework`, 2 uncommitted non-copy files), `Docs/` = C:\Squareshare\Docs (main, clean), `Admin/` = C:\Squareshare\Admin (main), `App/` = C:\Squareshare\App. Message line numbers are `messages/en/*.json` unless marked `cs`.

Inputs: `Store/docs/compliance/inventory/08-public-messaging.md` (main), `audit/C-seller-terms-p2b.md`, `inventory/01-store-sellers-accounts.md`, `inventory/07-app.md`, `Store/docs/changing-the-terms.md`, `Store/docs/styles.md` (8.12 to 8.14), `~/.claude/lab.md`, memory notes `i18n-client-message-scopes`, `bulk-translation-recipe`, `operating-regions-and-terms`, then the code cited below.

---

## 0. Decisions in one page

1. **Two kinds of copy.** Lines a buyer or seller reads as a fact about the market ("Delivery within Czechia only", the country lists) are **derived** from the market config and need no copy change when a country opens. Sentences with grammar around a country name (sign-up, Terms summary, Home, Docs, Terms) are **hand-written** for the single-country beta, because Czech, Slovak and Polish decline country names and `Intl.DisplayNames` only gives the nominative ("Česko", never "v České republice"). Opening a country is therefore "config plus copy", and section 0.3 lists exactly which keys change.
2. **Sign-up asks one question before an account exists:** "Where are you or your business based?". It is enforced in the sign-up server action, so a country that is not open never creates an email account. Google sign-in has no form step, so on the sign-up tab the Google button appears only after an open country is chosen, and the welcome flow plus the publish gate are the backstop for an account created from the sign-in tab.
3. **The friendly block** ("Not in your country yet") replaces the sign-up form for a closed country: one visual, a five-word title, one sentence, email and country, one button, a DRAFT consent line. It writes to the shared `waitlist_signups` table through a Store server action (Turnstile, the Postgres limiter, disposable-email refusal, duplicate answered as success). Its visual goes through a `/dev` lab first.
4. **Buyer-facing delivery line:** ONE key, `ProductPage.trust.deliveryArea`, rendered in four places from the config: the product page trust list, under the checkout's country field, in the cart summary, in the embed frame footer. It sits apart from "Sold by" and the seller block, where the 1B "Seller info" block will go.
5. **Existing sellers are told, never blocked, until the owner decides.** One "complete your seller profile" row in Overview's "Needs attention" card, built from a new pure completeness module that workstream 1B extends. Nothing is hidden, paused or deleted by this design.
6. **Czech legal texts:** Store already has Czech for every statutory UI string (agent-translated, unreviewed); Home's Terms, Privacy, Cookie, Accessibility and imprint have none and Home has no locale mechanism. Recommendation: a small `(cs)` route group on Home with its own root layout and `*.cs.ts` content files frozen beside the English ones, no i18n framework.
7. **New Terms version:** tos-2026-11-06 cannot be replaced by the documented recipe because two accounts agreed to it, so a new version would queue behind it (two email rounds, with EU/US/Canada terms taking effect in between). Recommended, subject to the lawyer: a new "superseded" marker so the CZ-beta version is noticed in one round. The DRAFT lives at `Store/docs/compliance/legal-drafts/terms-cz-beta/`, never in Home's versions folder.

### 0.1 What this design needs from the market config (sibling design)

Assumed shape, to be renamed to whatever the sibling lands; every use below goes through it, never a literal:

| Name | Beta value | Used here for |
| --- | --- | --- |
| `MARKET.sellerCountries` | `["CZ"]` | the country step's "open" check, the Settings country select, the welcome flow |
| `MARKET.shippingCountries` | `["CZ"]` | the delivery line, the shipping picker, checkout |
| `MARKET.currencies` | `["CZK"]` | money examples in Settings copy (`{example}` arguments) |
| `MARKET.waitlistCountries` (**requested addition**) | EU 27 + IS, LI, NO, CH, GB, US, CA | the options of the country select for a closed country; plus one "Somewhere else" option stored as `ZZ` (ISO user-assigned, conventionally "unknown") |
| `isSellerCountry(code)` | | the market check (pure) |
| `formatCountryList(codes, locale)` (**requested**, `lib/format/country.ts`) | "Czechia" / "Česko" | `regionName` (`Store/src/lib/format/country.ts:46`) per code, joined with `Intl.ListFormat(locale, { type: "conjunction" })` |

Two requests to the sibling that this design depends on:

- **Grandfather a stored value on write.** `saveTaxInfo` should refuse a CHANGE of `tax_country` to a country that is not open, but accept the stored value re-sent unchanged, because the Settings form always posts the field (`Store/src/components/settings/TaxSection.tsx:363`). Otherwise a seller stored as `DE` could not fix a typo in their address.
- **Pickers name every code with `regionName`, not `countryName`.** `countryName` names EU codes only (`country.ts:33-37`), so US and CA show as raw codes today.

### 0.2 The country's name

The owner's sentence says "the Czech Republic". The code deliberately names CZ "Czechia" in English (`Store/src/lib/settings/constants.ts:78`, kept verbatim by `country.ts:12-13`), and `Intl.DisplayNames("cs")` gives "Česko". Recommendation: hand-written copy uses the owner's "the Czech Republic" / "Česká republika"; derived lines show the display name ("Czechia" / "Česko"). Both are official short and long forms. Open question O1 for the owner if one name everywhere is wanted (it is a one-line change in `EU_COUNTRIES`, but it also changes "Ships from Czechia." in existing shipping prose).

### 0.3 Expansion is "config plus copy": the hand-written keys

When a country is added to `MARKET.sellerCountries` or `MARKET.shippingCountries`, these keys (all 10 locales) are rewritten in the same branch. A unit test pins both lists and fails with this list in its message, the way `Store/tests/unit/operating-countries.test.ts:16-40` pins the operating list today:

| Key / file | Why it cannot be derived |
| --- | --- |
| `Auth.market.availability`, `Auth.waitlist.description` | prose with an inflected country name |
| `Auth.login.signupLegal` | legal sentence (DRAFT) |
| `Settings.tax.fields.country.hint` | prose |
| `Settings.legal.termsSummary.sections.parties.points.regions` | summary of a Terms version (changes only with a new version) |
| `Dashboard.attention.profile.countryMissing.description` | prose |
| Home `src/content/faq.ts` (new item), `WaitlistForm.tsx` description, `PricingSection.tsx` footnote, `app/terms/page.tsx` meta, `content/legal/accessibility.ts:74` | English literals, Home has no catalogue |
| Docs pages in section 1e (en + cs) | MDX prose |
| The Terms territory clause | a new Terms version, unless the lawyer allows a territory defined by a published list (question L4) |

Derived (no change on expansion): `ProductPage.trust.deliveryArea`, `Settings.shipping.destinations.tipBody`, `.areaPlaceholder`, the country selects, the waitlist options, the market check itself.

---

## 1. R7 surface plan

R7 sentence: "Currently available to sellers established in the Czech Republic, with delivery within the Czech Republic. We plan to expand to other EU countries." Buyer variant: "Delivery within the Czech Republic only".

What a visitor can reach today: Home's launch switch is off on disk (`Home/.env.production:17` is a comment), so every Home "Get started" opens the waitlist modal (`Home/src/components/BuyIntentCta.tsx:22-51`), there is no Sign in link (`Header.tsx:14`, `:19`; `Footer.tsx:23`) and pricing is hidden (`Home/src/app/page.tsx:53`). **Store sign-up is open regardless** (`Store/src/app/(auth)/login/page.tsx:62`, comment `:120-122`) and Docs sends people straight to it (`Docs/content/docs/en/selling/sell-without-online-shop.mdx:56`). So the Store country step is the real gate. Whether a Cloudflare build variable sets the switch was not verifiable.

Column "Config" says how the text derives from the market config: **D** derived, **H** hand-written (listed in 0.3), **n/a** no country in it. "Locales" says which catalogues need it: all 10 Store locales always (the parity test, `Store/tests/unit/i18n-messages.test.ts`); Home is English only; Docs en + cs.

### 1a. Store, seller-facing (priority 1 to 3)

| # | Surface | file:line | Current text | Proposed | Config | Locales |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Sign-up eligibility note | `Store/src/components/auth/LoginForm.tsx:183-186`; `auth.json:38` (cs:38) | "Open to sellers aged 18+ in the EU, USA and Canada." | Removed: the country step (section 3) shows `Auth.market.availability` instead; the age stays in the legal line. Delete the key in all locales. | H | 10 |
| 2 | Sign-up legal line | `LoginForm.tsx:303-321`; `auth.json:41` (cs:41) | "...based in the EU, the USA or Canada, where we operate today. We don't operate anywhere else yet..." | `Auth.login.signupLegal` rewritten (section 2, DRAFT) | H | 10 |
| 3 | Sign-up country step (new) | `LoginForm.tsx` (new step before the fields); `login/page.tsx` | none | `Auth.market.*`, section 3 | D (options) + H (availability line) | 10 |
| 4 | Friendly block (new) | `LoginForm.tsx`; new `components/market/NotOpenYet.tsx` | none | `Auth.waitlist.*`, section 3 | H | 10 |
| 5 | Welcome flow seller step: country (new field, first screen) | `Store/src/components/onboarding/WelcomeFlow.tsx:427-493` (no country today, posts 3 fields `:436`, `:454`, `:477`) | none | the same country step component, prefilled from the sign-up answer | D + H | 10 |
| 6 | Welcome flow address example | `onboarding.json:130` | "e.g. 12 Market Street\nDublin, D02 X285\nIreland" | "e.g. Masarykova 12\n602 00 Brno\nCzech Republic" (cs already "Tržní 12, 110 00 Praha 1, Česká republika") | n/a | en |
| 7 | Welcome flow Terms step | `WelcomeFlow.tsx:413-425` renders `TermsSummary`; regions point `settings.json:259` (cs:259) | "Square Share operates in the EU, the USA and Canada..." | Changes **only with the new Terms version** (section 6), because the summary follows the newest version (`Store/src/lib/legal/terms-summary.ts:5-10`) | H | 10 |
| 8 | Settings > Business: country hint | `settings.json:378` (cs:378), shown `TaxSection.tsx:371` | "...Square Share operates in the EU, the USA and Canada." | `Settings.tax.fields.country.hint` rewritten (section 2) | H | 10 |
| 9 | Settings > Business: country options | `TaxSection.tsx:168-178`, `:361-371`; list `Store/src/lib/format/country.ts:69-78` over `OPERATING_COUNTRIES` (`constants.ts:110-114`) | "Not set" + EU 27 + US + CA | Options = `MARKET.sellerCountries`. "Not set" first only while unset. A stored country that is not open is shown selected and disabled as `Settings.tax.countryNotOpen` ("Germany (not open yet)"), never dropped. Code comment `:169-171` ("the US and Canada are on the list") updated. | D | 10 |
| 10 | Settings > Business: address, phone, VAT examples | `settings.json:362`, `:386`, `:374`, `:375`; cs:386 still "+353 87 123 4567" | Irish and Austrian examples | Czech examples (section 2) | n/a | en, cs |
| 11 | Settings > Shipping: destinations tip | `settings.json:453` (cs equivalent) | "...one row for home, one for the rest of the EU, one for everywhere else is plenty..." | `Settings.shipping.destinations.tipBody` with `{count}` and `{countries}` (section 2) | D | 10 |
| 12 | Settings > Shipping: area placeholder | `settings.json:457` (cs:457 "např. Zbytek EU") | "e.g. Rest of EU" | "e.g. {country}" from `MARKET.shippingCountries[0]` | D | 10 |
| 13 | Settings > Shipping: money examples | `settings.json:454` ("such as “€9.00”"), `:461`, `:463`, `:478` | EUR literals | `{example}` formatted from `MARKET.currencies[0]` with the existing `formatCents` | D | 10 |
| 14 | Settings > Shipping: "Everywhere else" and non-open countries | `Store/src/components/settings/CountryPicker.tsx:33-41`; key `settings.json:466` | "*" then all 29 `SHIPPING_COUNTRY_CODES` | Section 1c | D | 10 |
| 15 | Settings > Legal / notice bullets for 11-06 | `Store/src/lib/legal/terms-changes.ts:11-20`; `settings.json:320`, `:321`, `:325` | "We now operate only in the EU, the USA and Canada..." | **Not edited.** They describe what tos-2026-11-06 changed. If the owner and lawyer take option B (section 6), 11-06 leaves `TERMS_CHANGES` and these keys are deleted with it. | n/a | 10 |
| 16 | Terms summary: taxes, law, disputes | `settings.json:275`, `:304`, `:306` | VAT/GST/HST/sales tax; Canada law; US arbitration | Rewritten with the new Terms version from the lawyer's text (section 6); not before | H | 10 |
| 17 | Stale code comments | `constants.ts:104-109`; `Store/src/lib/settings/trader-identity.ts:27-29`; `terms-summary.ts:7` | point at EU/US/CA and a retired Home file | Updated with the sibling's market branch | n/a | n/a |
| 18 | Dashboard: existing sellers (new) | `Store/src/lib/dashboard/attention.ts:15-30` (AttentionKey), `:112` | none | one `profile` row, section 4 | H | 10 |

### 1b. Store, buyer-facing (priority 4)

The delivery line is the same key everywhere: `ProductPage.trust.deliveryArea` = "Delivery within {countries} only" (en), "Doručení: pouze {countries}" (cs), `{countries}` = `formatCountryList(MARKET.shippingCountries, locale)`.

| # | Surface | file:line | Current | Proposed and position | Config |
| --- | --- | --- | --- | --- | --- |
| 19 | Product page buy box (trust list under the buy button) | builder `Store/src/components/product-page/TrustList.tsx:16-42`; called `ProductPageView.tsx:231-240`, drawn `:722` | dispatch, shipping sentence, returns, EU rights; no delivery area | New fixed line in `buildTrustLines` (a `deliveryArea` entry in its `copy` argument), placed right after the shipping line, icon `MapPin` (or `Truck`, lab tile, section 3.10). Not shown for a digital product. **Position:** inside the trust list under the button; the "Sold by" line beside the title (`ProductPageView.tsx:602-606`) and the seller block in the fold (`:251-259`) are untouched, which is where 1B's Seller info goes. | D |
| 20 | Checkout delivery fieldset | `Store/src/components/checkout/CheckoutForm.tsx:650-666` (one country = plain text `:661-665`) | "Country" + "Česko" as plain text | Under the country (select or plain text), a `helpTextClass`-level line with the same key. Not repeated in the badges under the pay button: `CheckoutView.tsx:124-130` keeps passing nothing for it, as it already does for the EU line (`:122-123`). **Position:** in the Delivery fieldset, far from the legal block's "Sold by {seller}, {country}" row (`CheckoutView.tsx:181-197`) where 1B's Seller info goes. | D |
| 21 | Cart summary | `Store/src/components/cart/CartPanel.tsx:170-177` (delivery row), `:189-192` (free-gap line with a Truck) | "Delivery to {area}" / "At checkout" | One muted line with the same key between the delivery row and the free-gap line, only when a line in the cart ships. No seller disclosure lives here. | D |
| 22 | Embed frame footer | `Store/src/components/storefront-page/EmbedFrameView.tsx:91-124` | "Sold by ..." · Powered by · Privacy · Report | A new item right after "Sold by" with its own hook `data-embed-frame-delivery`, shown only when the storefront sells through Square Share checkout or cart and something on it ships. **Position:** its own footer item, so 1B can replace or expand the "Sold by" span (`:95`) without moving it. | D |
| 23 | Checkout country list | `CheckoutView.tsx:135-149`, `Store/src/lib/validation/checkout.ts:41` | seller countries + all 29 for "*" | Sibling's market branch: "*" expands to `MARKET.shippingCountries`. No copy. | D |
| 24 | Checkout refusal | `productPage.json:291` | "{seller} doesn't deliver to that country." | unchanged (still true; rarely reachable once only open countries are offered) | n/a |
| 25 | Phone examples at checkout | `productPage.json:284` ("+353 85 123 4567"); `validation.json:388` | Irish | "+420 601 123 456" (en); cs check | n/a |
| 26 | EU rights row "EU buyers: ..." | `productPage.json:40`; `CheckoutView.tsx:198-206` | shown for a non-EU seller | unchanged; with every seller in CZ, `isEuSeller` is true and the plain variant shows | n/a |
| 27 | Hosted page footer | `Store/src/components/product-page/PoweredByFooter.tsx:137-147` | seller disclosure | unchanged (1B territory) | n/a |

**Products with the seller's own buy link.** The product page's button can lead to the seller's own checkout (`ProductPageView.tsx:208-214`, `resolveCtaTarget`), which Square Share does not control. The line is therefore shown only where the order goes through Square Share checkout or cart (`target.kind === "checkout"` or the cart is on). Whether the CZ-only delivery rule also binds sales through a seller's own link is owner question O4.

Likely legal relevance (lawyer to confirm, L7): the Consumer Rights Directive asks trading websites to state delivery restrictions at the latest at the beginning of the ordering process (Art. 8(3)), which is why the line sits on the product page and not only at checkout.

### 1c. Country and delivery pickers

| Picker | file:line | Proposed |
| --- | --- | --- |
| Settings > Business country | `TaxSection.tsx:168-178` | Options = `MARKET.sellerCountries`; a stored non-open value stays visible as a disabled, selected option ("Germany (not open yet)"); saving other fields keeps it (sibling's grandfather rule, 0.1). |
| Shipping destinations | `CountryPicker.tsx:33-41` | Items = `MARKET.shippingCountries`. **"Everywhere else" is hidden** while it would add nothing (one shipping country) unless a stored policy already has it, in which case it shows checked. Codes in a stored policy that are not open show **checked and disabled** with the hint `Settings.shipping.destinations.notDelivered` ("Not delivered for now"): kept for stored data only, never offered, never used by checkout. Depends on the sibling not dropping whole policies: `parseShippingPolicy` uses safeParse and loses a policy naming a removed code (memory `operating-regions-and-terms`). |
| Ships from | `Store/src/components/settings/ShippingSection.tsx:118`, `:160`; validation `Store/src/lib/validation/shipping-policy.ts:71-76` | Sibling's list. If the Terms rule is "ships from within the EU", the list is the EU 27, not `sellerCountries`. No copy change. |
| Checkout country | `CheckoutForm.tsx:650-666` | Renders what the policy allows; with one country it is plain text plus the delivery line (#20). |
| Waitlist country (new) | `NotOpenYet` | `MARKET.waitlistCountries` minus open countries, sorted in the reader's language, then "Somewhere else" (`ZZ`). |

### 1d. Home (priority 5, English only)

| # | Surface | file:line | Current | Proposed | Notes |
| --- | --- | --- | --- | --- | --- |
| H-1 | Homepage FAQ (also the FAQPage JSON-LD, `Home/src/app/page.tsx:19-27`) | `Home/src/content/faq.ts:14-53` | no territory item | New item before "What does it cost?": Q "Who can sell on SquareShare?" A = the R7 sentence | H |
| H-2 | Waitlist modal description | `Home/src/components/WaitlistForm.tsx:131-133` | "Leave your email and you'll be first in when we open." | "We're starting with sellers in the Czech Republic. Leave your email and you'll hear first when we open." | H; plus the country select and consent line (section 3.9) |
| H-3 | Pricing footnote (hidden while the switch is off) | `Home/src/components/PricingSection.tsx:91-94` | fee and Stripe sentence | Append "Available to sellers established in the Czech Republic." | H; EUR and "excl. VAT" (`:56`) are for the owner and accountant |
| H-4 | Terms page meta description (not frozen) | `Home/src/app/terms/page.tsx:12-13` | "...in the European Union, the United States and Canada..." | "The terms governing use of SquareShare, currently available in the Czech Republic: accounts, the embeddable Widget, payments via Stripe, acceptable use, and your rights." | H |
| H-5 | Accessibility statement | `Home/src/content/legal/accessibility.ts:74` | "...intends to serve customers across the EU, the UK, and the US..." | "...is available in the Czech Republic first and plans to expand to other EU countries..." and trim the UK and US laws in the list after it | H; a notice, edited in place |
| H-6 | Privacy Policy intro and US/Canada sections | `Home/src/content/legal/privacy.ts:11`, `:613-690`, `:692-708` | "We operate in the European Union, the United States and Canada." | DRAFT for the lawyer (section 5): intro to the R7 sentence; whether sections 14 and 15 stay is the lawyer's call | legal; edited in place (a notice, `changing-the-terms.md:60`) |
| H-7 | Cookie Policy US section | `Home/src/content/legal/cookiePolicy.ts:354` | "11. Residents of the United States" | lawyer | legal |
| H-8 | How it works mockup price | `Home/src/components/howItWorks/data.ts:63` (shown `CheckoutFlow.tsx:293`, `:354`, `:395`) | "$129.00" | a CZK amount formatted with `Intl.NumberFormat("en", { style: "currency", currency: "CZK" })`; check the animation's width by eye | visual |
| H-9 | Unused mockup | `Home/src/components/StorefrontMockup.tsx:79`, `:87`, `:93` | USD | delete (not imported anywhere) | cleanup |
| H-10 | Hero lead and site description | `Home/src/components/hero/parts.tsx:31-32`; `Home/src/lib/site.ts:25-26` | "anywhere people find you" | Unchanged: figurative (any website). Optional small line under the hero CTA, "Now open to sellers in the Czech Republic.", as an owner pick by eye in Home's local lab | owner |
| H-11 | Terms tos-2026-11-06 subtitle, intro, s.2, regional parts | `tos-2026-11-06.ts:19`, `:27-29`, `:76-139`, `:780-1089` | EU/US/CA | **Frozen. Never edited.** Replaced by a new version (section 6). | |
| H-12 | Footer imprint | `Home/src/components/Footer.tsx:230-233` | English line, Efficontrol | unchanged in English; Czech line with the Czech pages (section 5) | |

### 1e. Docs (priority 6, en + cs)

| # | Page | en file:line | cs file:line | Proposed |
| --- | --- | --- | --- | --- |
| D-1 | What is SquareShare | `Docs/content/docs/en/(getting-started)/what-is-square-share.mdx:43` | `cs/(zaciname)/co-je-square-share.mdx:42` | section 2.6 |
| D-2 | Set up SquareShare | `en/(getting-started)/set-up-square-share.mdx:28` | `cs/(zaciname)/nastaveni-square-share.mdx:29` | section 2.6 (also says what a closed country sees) |
| D-3 | Payments: "Which currencies and countries work?" (the natural R7 home) | `en/payments-and-payouts/index.mdx:36-44` | `cs/platby-a-vyplaty/index.mdx:37-45` (rows `:41`, `:43`, line `:45`) | table rows + the R7 sentence replace the Québec line (section 2.6) |
| D-4 | FAQ: who can sell | `en/reference/faq.mdx:34` | `cs/reference/caste-dotazy.mdx:35` | section 2.6 |
| D-5 | Sell without an online shop | `en/selling/sell-without-online-shop.mdx:56` | `cs/prodej/prodej-bez-e-shopu.mdx:57` | section 2.6 |
| D-6 | Shipping and returns | `en/products-and-storefronts/shipping-and-returns.mdx:52` | `cs/produkty-a-vylohy/doprava-a-vraceni.mdx:53` | section 2.6 |
| D-7 | Add a product (currency) | `en/products-and-storefronts/add-a-product.mdx:21` | `cs/produkty-a-vylohy/pridani-produktu.mdx:22` | "a price in Czech koruna (CZK)" / "cenu v korunách (CZK)", once the sibling's CZK lands |
| D-8 | Sell digital products in the EU | `en/selling/sell-digital-products-in-the-eu.mdx:2-4`, `:12`, `:45-47` | `cs/prodej/prodej-digitalnich-produktu-v-eu.mdx:13`, `:46`, `:48` | Add the availability note under the intro (2.6). The VAT paragraphs describe law and stay. Keep or unpublish during the beta: owner O9. |
| D-9 | Gumroad alternative for EU sellers | `en/selling/gumroad-alternative-for-eu-sellers.mdx:2`, `:39-42` | `cs/prodej/alternativa-ke-gumroadu-pro-prodejce-v-eu.mdx:2`, `:40-43` | same as D-8 |
| D-10 | Pricing pages (EUR, VAT, "A refund returns it") | `en/pricing/index.mdx:12`, `:80`, `:104` | `cs/ceny/index.mdx:13`, `:81`, `:105` | Not R7: fee-on-refund changes with the new Terms (Audit C R-2); VAT with the accountant |
| D-11 | Operator "Root Labs" | `en/(getting-started)/what-is-square-share.mdx:73`; `Docs/lib/llms.ts:82` | `cs/(zaciname)/co-je-square-share.mdx:74` | Dependency for the owner (operator naming), not solved here |
| D-12 | "Get started" buttons point at Home's waitlist | `Docs/lib/site.ts:26-32` | same | When Home's switch flips, point at Store sign-up. Not R7. |
| D-13 | Legal links (Czech labels, English targets) | `Docs/lib/legal.tsx:10-17` | same | Czech hrefs once Home serves Czech pages (section 5) |

### 1f. App

Nothing to place. App has no landing page, footer, prices, currency, sign-up or onboarding; it redirects to Store's login and renders no commerce (`Store/docs/compliance/inventory/07-app.md:16-23`, `:40-44`), and is very likely not live (`:36-39`). Its own privacy page (`App/src/components/PrivacyPolicyPage.tsx:25`, `:72-73`, `:85`) makes no territory claim. Revisit before the marketplace opens.

---

## 2. Exact copy

House style: short, plain, no em or en dashes (note: `cs/settings.json:448` already contains a U+2013 between "1" and "3"; fix it while that file is open). **DRAFT** = legal or legal-adjacent, for lawyer review before it ships; the Czech wording of DRAFT strings goes through a human translator, then the lawyer.

### 2.1 Auth (`messages/*/auth.json`)

| Key | EN | CS | Status |
| --- | --- | --- | --- |
| `Auth.login.signupRegionNote` | (deleted) | (deleted) | |
| `Auth.login.signupLegal` | By creating an account you confirm you are 18 or over and that you or your business are based in the Czech Republic. See our <terms>Terms</terms> and <privacy>Privacy Policy</privacy>. | Vytvořením účtu potvrzujete, že je vám alespoň 18 let a že máte bydliště nebo sídlo firmy v České republice. Přečtěte si naše <terms>podmínky</terms> a <privacy>zásady ochrany osobních údajů</privacy>. | DRAFT (criterion wording, L1) |
| `Auth.market.question` | Where are you or your business based? | Ve které zemi máte bydliště nebo sídlo firmy? | DRAFT (criterion, L1) |
| `Auth.market.availability` | Square Share is open in the Czech Republic for now. We plan to expand to other EU countries. | Square Share zatím funguje jen v České republice. Do dalších zemí EU se chystáme rozšířit. | H |
| `Auth.market.placeholder` | Choose a country | Vyberte zemi | |
| `Auth.market.elsewhere` | Somewhere else | Jinde | |
| `Auth.market.chosen` | Based in {country} | Země: {country} | D (nominative after a colon) |
| `Auth.market.change` | Change | Změnit | |
| `Auth.waitlist.title` | Not in your country yet | Ve vaší zemi zatím ne | |
| `Auth.waitlist.description` | We're only open in the Czech Republic for now, but we'll email you when we open where you are. | Zatím působíme jen v České republice, ale až se otevřeme i u vás, napíšeme vám. | H |
| `Auth.waitlist.countryLabel` | Country | Země | |
| `Auth.waitlist.submit` | Let me know | Dejte mi vědět | |
| `Auth.waitlist.pending` | Saving… | Ukládáme… | |
| `Auth.waitlist.consent` | We'll only use your email to tell you when we open in your country. <privacy>Privacy Policy</privacy> | Váš e-mail použijeme jen k tomu, abychom vám dali vědět, až se ve vaší zemi otevřeme. <privacy>Zásady ochrany osobních údajů</privacy> | DRAFT (L6) |
| `Auth.waitlist.changeCountry` | Change country | Změnit zemi | |
| `Auth.waitlist.checkCountry` | Check my country | Zkontrolovat zemi | |
| `Auth.waitlist.successTitle` | You're on the list | Jste na seznamu | |
| `Auth.waitlist.successBody` | We'll write to {email} when we open where you are. | Až se otevřeme i u vás, napíšeme vám na {email}. | |
| `Auth.waitlist.openHere` | That country is open already: you can create an account now. | Tato země je už otevřená, účet si můžete založit hned. | |

Reused, not duplicated: `Auth.login.emailLabel` ("Email") for the block's email field; `Errors.auth.permanentEmailRequired`, `Errors.auth.verificationFailed`, `Errors.auth.rateLimited` (`errors.json:307`, `:308`, `:315`); `Validation.email.generic.format` (`validation.json:353`); the Settings > Danger title (`settings.json:14`, "Delete account") for the welcome-flow variant's quiet link.

### 2.2 Common (`messages/*/common.json`)

| Key | EN | CS |
| --- | --- | --- |
| `Common.actions.continue` (new, shared; `Onboarding.welcome.nav.continue` can move onto it later) | Continue | Pokračovat |

### 2.3 ProductPage (`messages/*/productPage.json`)

| Key | EN | CS | Status |
| --- | --- | --- | --- |
| `ProductPage.trust.deliveryArea` | Delivery within {countries} only | Doručení: pouze {countries} | D; informational, lawyer confirms placement (L7) |
| `ProductPage.checkout.errors.phone` (edit) | Enter a phone number using digits, like +420 601 123 456. | (check cs) | |

### 2.4 Settings (`messages/*/settings.json`)

| Key | EN | CS | Status |
| --- | --- | --- | --- |
| `Settings.tax.fields.country.hint` | Where you or your business are based, shown to buyers with your name. Square Share is open in the Czech Republic for now. | Kde máte bydliště nebo sídlo firmy; kupující to uvidí u vašeho jména. Square Share zatím funguje jen v České republice. | H |
| `Settings.tax.countryNotOpen` | {country} (not open yet) | {country} (zatím nedostupné) | D |
| `Settings.tax.fields.address.placeholder` | e.g. Masarykova 12\n602 00 Brno\nCzech Republic | (unchanged) | |
| `Settings.tax.fields.phone.placeholder` | e.g. +420 601 123 456 | např. +420 601 123 456 | |
| `Settings.tax.fields.vatId.tipBody` (edit one clause) | "...such as CZ12345678 for the Czech Republic..." instead of "ATU12345678 for Austria" | (already CZ) | |
| `Settings.tax.fields.vatId.placeholder` | e.g. CZ12345678 | (already) | |
| `Settings.shipping.destinations.tipBody` | Group destinations however you actually ship. {count, plural, one {Checkout delivers within {countries} only for now, so one row is usually enough.} other {Checkout delivers within these countries only for now: {countries}.}} Leave the cost blank if it varies. | Seskupte je tak, jak opravdu posíláte. {count, plural, one {Pokladna zatím doručuje jen do jedné země ({countries}), takže obvykle stačí jeden řádek.} few {Pokladna zatím doručuje jen do těchto zemí: {countries}.} many {Pokladna zatím doručuje jen do těchto zemí: {countries}.} other {Pokladna zatím doručuje jen do těchto zemí: {countries}.}} Pokud se cena liší, nechte ji prázdnou. | D |
| `Settings.shipping.destinations.areaPlaceholder` | e.g. {country} | např. {country} | D |
| `Settings.shipping.destinations.costAndRate`, `.costPlaceholder`, `.ratePlaceholder`, `Settings.shipping.rates.freeOverPlaceholder` | same sentences, with `{example}` in place of "€9.00", "4.50", "50.00" | same | D (`MARKET.currencies[0]`) |
| `Settings.shipping.destinations.notDelivered` | Not delivered for now | Zatím se sem nedoručuje | |
| `Settings.legal.termsSummary.sections.parties.points.regions` (**only with the new Terms version**) | For now, Square Share is open to sellers established in the Czech Republic, and checkout delivers within the Czech Republic only. We plan to expand to other EU countries. | Square Share je zatím otevřený prodejcům usazeným v České republice a pokladna doručuje jen v rámci České republiky. Rozšíření do dalších zemí EU plánujeme. | DRAFT |
| `Settings.legal.notice.changes.czechBeta` (**new version only**) | For now we are open only to sellers established in the Czech Republic, with delivery within the Czech Republic. The sections for the USA and Canada are removed. | Zatím jsme otevření jen prodejcům usazeným v České republice, s doručením v rámci České republiky. Části pro USA a Kanadu odpadají. | DRAFT |
| `Settings.sellerDetails.fields.country.label` / `.why` (**enforce stage only**, section 4) | Country / Buyers see where you trade from, and Square Share is open only in the Czech Republic for now. | Země / Kupující vidí, odkud prodáváte, a Square Share zatím funguje jen v České republice. | owner decision |

The other summary points (`taxesAndRecords` `:275`, `feesAndDisputes` `:282`, `changesAndLaw` `:304`, `disputes` `:306`) and the other change bullets (fee on refund, the Stripe section, the banned items list) are written **from the lawyer's Terms text**, not drafted here.

### 2.5 Dashboard (`messages/*/dashboard.json`)

| Key | EN | CS | Status |
| --- | --- | --- | --- |
| `Dashboard.attention.profile.countryMissing.label` | Add the country you're based in | Doplňte zemi bydliště nebo sídla firmy | |
| `Dashboard.attention.profile.countryMissing.description` | Square Share is open in the Czech Republic for now, so we need to know where you're based. | Square Share zatím funguje jen v České republice, a proto potřebujeme vědět, kde máte bydliště nebo sídlo. | H |
| `Dashboard.attention.profile.countryMissing.action` | Add country | Doplnit zemi | |
| `Dashboard.attention.profile.notOpen.label` | We're not open in your country yet | Ve vaší zemi zatím nepůsobíme | |
| `Dashboard.attention.profile.notOpen.description` | Nothing on your pages changes today. Check your country, or ask us to tell you when we open there. | Na vašich stránkách se dnes nic nemění. Zkontrolujte zemi, nebo si nechte poslat zprávu, až se tam otevřeme. | **owner approval** ("nothing changes" is a promise about the notice stage) |
| `Dashboard.attention.profile.notOpen.action` | See options | Zobrazit možnosti | |
| `Settings.sellerDetails.headline.notOpen` (**enforce stage only**) | We're not open in your country yet, so your pages can't take orders. | Ve vaší zemi zatím nepůsobíme, proto vaše stránky nemohou přijímat objednávky. | owner decision |

### 2.6 Docs replacements (MDX)

| Page | EN | CS |
| --- | --- | --- |
| D-1 | To sign up you must be 18 or over. SquareShare is currently available to sellers established in the Czech Republic, with delivery within the Czech Republic. We plan to expand to other EU countries. | K registraci vám musí být alespoň 18 let. SquareShare je zatím dostupný prodejcům usazeným v České republice a doručuje se jen v rámci České republiky. Rozšíření do dalších zemí EU plánujeme. |
| D-2 | By creating an account you confirm that you are 18 or over and that you or your business are based in the Czech Republic. SquareShare is open only in the Czech Republic for now. If you are based elsewhere, the sign-up form offers to tell you when we open in your country. | Vytvořením účtu potvrzujete, že je vám alespoň 18 let a že máte bydliště nebo sídlo firmy v České republice. SquareShare zatím funguje jen v České republice. Pokud sídlíte jinde, formulář vám nabídne zprávu, až se otevřeme i u vás. |
| D-3 rows | Product prices: Czech koruna (CZK) · Sellers: 18 or over and based in the Czech Republic · new row Delivery: Within the Czech Republic only. Replace the Québec line with the R7 sentence. (Plan billing row: owner and accountant.) | Ceny produktů: Česká koruna (CZK) · Prodejci: Od 18 let, s bydlištěm nebo sídlem v České republice · nový řádek Doručení: Jen v rámci České republiky. Místo věty o Québecu: SquareShare je zatím dostupný prodejcům usazeným v České republice a doručuje se jen v rámci České republiky. Rozšíření do dalších zemí EU plánujeme. |
| D-4 | Sellers who are 18 or over and based in the Czech Republic. We plan to expand to other EU countries. | Prodejci od 18 let s bydlištěm nebo sídlem v České republice. Rozšíření do dalších zemí EU plánujeme. |
| D-5 | ...You must be 18 or over and based in the Czech Republic. | ...Musí vám být alespoň 18 let a musíte mít bydliště nebo sídlo v České republice. |
| D-6 | Group them the way you really ship. Checkout delivers within the Czech Republic only for now, so one row is usually enough. You can add up to six. | Seskupte je tak, jak opravdu posíláte. Pokladna zatím doručuje jen v rámci České republiky, takže obvykle stačí jeden řádek. Přidat jich můžete až šest. |
| D-8, D-9 note | SquareShare is currently available to sellers established in the Czech Republic. We plan to expand to other EU countries. | SquareShare je zatím dostupný prodejcům usazeným v České republice. Rozšíření do dalších zemí EU plánujeme. |

### 2.7 Home (English literals)

H-1 answer, H-3 footnote, H-4 meta: the R7 sentence or the text in 1d. H-2 and the Home form in section 3.9. Home consent line (DRAFT, mirrors what `privacy.ts:75-79`, `:227-229`, `:449` already say): "We'll use your email for news about Square Share's launch. You can unsubscribe at any time. <a>Privacy Policy</a>"

### 2.8 Other locales and which ones matter

- **cs and en** are written by us (DRAFT keys: a human translator for the Czech, then the lawyer). They matter most: cs is the beta's language for sellers, buyers and the legal texts; en is the UI default and the language of foreign residents of Czechia.
- **sk** is the next one worth a human look later (Slovak speakers trade in Czechia); for the beta it follows the recipe like the rest.
- **de, fr, es, it, nl, pl, pt-PT** exist because the parity test requires every key in all 10 locales. They are filled by the bulk translation recipe (memory `bulk-translation-recipe`): diff `messages/en` against HEAD into one JSON of added and changed keys (and the deleted `signupRegionNote`), write the shared validator first (`@formatjs/icu-messageformat-parser` from `node_modules/.pnpm`, same arguments, tags and select keys, no U+2013 or U+2014; cs, pl and sk use one/few/many/other), then three agents of three locales each, each writing `tr-<locale>.json` and looping on the validator, then a CRLF-preserving apply (the catalogues are CRLF; anchor inserts on the previous line's text, then check no bare LF).
- **Prompt rule for `{countries}` and `{country}`:** the value is a nominative country name from `Intl.DisplayNames`; a language that declines names or needs an article or preposition (cs, sk, pl, fr) uses a colon or parenthesis construction instead of putting the name inside a phrase.
- **DRAFT keys in the non-cs, non-en locales** are flagged REVIEW in the patch and stay unreviewed for the beta. A buyer whose browser is German gets the German checkout today (`Store/src/i18n/request.ts:41-45`); whether statutory strings in those locales must be reviewed, or should fall back to cs or en during the beta, is lawyer question L5.

### 2.9 Client message scopes

`tests/unit/i18n-client-scopes.test.ts` will name any scope that misses a key; expected entries (`Store/src/i18n/scopes.ts`):

- `auth` already ships all of `Auth` (`:287-300`) and `Common` comes with the shell (`:30-35`).
- `dashboard` (`:334`, via `WELCOME` `:237-258`): add `"Auth.market"`, `"Auth.waitlist"` and `"Settings.tax.fields.country"` for the welcome flow's country step and the Overview dialog.
- `settings` (`:361-388`) already ships `Auth` and `Settings`.
- `public` and `designer` ship all of `ProductPage`; `storefrontList` (`:402-416`) ships only `ProductPage.cart`, so add `"ProductPage.trust.deliveryArea"` for `CartPanel` previews there.
- The Overview attention row is resolved on the server from `MessageRef`s, like the existing rows; the dashboard section already ships `Dashboard` (`:141`).

---

## 3. R8: the country step and the friendly block

### 3.1 Before or after the account: the argument

| | Ask BEFORE the account exists | Ask AFTER (welcome flow only) |
| --- | --- | --- |
| A closed country creates an account | No, for email sign-up: the server action refuses before `signUp` | Yes, every time; the account then has to be explained, kept or deleted |
| Data minimisation | Nothing about the person is stored unless they choose the waitlist | An auth user, a profile row and a confirmation email for someone who cannot use the service |
| Existing guards | Fits the signup branch of `authenticate` (`Store/src/lib/auth/actions.ts:355-462`): one local check, placed first, so it costs no Turnstile token, budget or HIBP call | Guards run for nothing |
| Google | Has no form step (`signInWithGoogle`, `actions.ts:644-671`; the Before User Created hook passes OAuth through, `Store/supabase/migrations/20261021_signup_intents.sql:77-80`). On the sign-up tab the Google button is shown only after an open country is chosen; from the sign-in tab Google can still create an account | Same backstop needed anyway |
| Server truth | The country is only a declaration either way; the publish gate and Stripe's account country (sibling R1) are the walls | same |

**Recommendation: before, for the email path (hard, server-side); before as a soft gate for Google on the sign-up tab; and a hard backstop after** (the welcome flow's country step, then the publish gate at the enforce stage) for any account created without the question: Google from the sign-in tab, and every existing account. A hook-level block for OAuth was considered and rejected: the hook receives the Google profile, not our state, so it cannot know what was declared.

**Asked before an account exists: only the country** (the one fact needed to decide whether to create it), beside what sign-up already asks (email, username, password, Turnstile, and the 18+ confirmation in the legal line). Everything else (seller type, trader status, names, date of birth, structured address, tax data, declarations) waits for the 1B form after sign-up.

### 3.2 Flow

```
/login?mode=signup
  Step A: [Sign in | Sign up] tabs
          "Where are you or your business based?"  [Select: open countries first, then the rest, then "Somewhere else"]
          one line: Auth.market.availability
          [Continue]
     open country ──> Step B: chip "Based in Czechia · Change"
                              [Continue with Google]   (carries signup_country)
                              ── or ──
                              email, username, password, confirm, Turnstile, legal line
                              [Create account]  (form carries signup_country; the server re-checks it)
     closed country ─> Block: visual, "Not in your country yet", one sentence,
                              Email + Country (prefilled), Turnstile, consent line
                              [Let me know]          ghost: Change country
                              ──> success: SuccessMark, "You're on the list", one sentence
/login (sign-in tab): unchanged. A new Google user from here lands in the welcome flow,
                      whose seller step opens on the same country step.
```

Layout change: the Sign in / Sign up tabs move above the Google button for both modes (today Google renders first, `LoginForm.tsx:137`, tabs `:160-181`), so Step A reads in order and Google is not offered before the question.

Preselect, never block, from the visitor's network: the login page (already `force-dynamic`, `login/page.tsx:21`) reads `cf-ipcountry` as the checkout pages do (`Store/src/app/(public)/s/[storefrontId]/checkout/page.tsx:62`) and passes it as `suggestedCountry` only when it is an open country. A Czech business owner abroad still picks Czechia.

### 3.3 Server side

- **Email sign-up:** the form carries `signup_country`. In the signup branch, before the password checks, refuse unless `isSellerCountry(code)`, returning an error code the form renders as the block (no message shown). Pass it to GoTrue as metadata, `data: { username, signup_country }` (`actions.ts:427-428`). `handle_new_user` reads only the handle, names and picture (`20261021_reserved_usernames.sql:86-110`), so **no migration**.
- **Google:** `GoogleButton` (`Store/src/components/auth/GoogleButton.tsx:55-79`) gets an optional `signupCountry` hidden field. `signInWithGoogle` validates it and appends `&signup_country=XX` to the callback URL, beside the `next` and `method` already carried (`actions.ts:662`). The callback (`Store/src/app/(auth)/auth/callback/route.ts:36-76`) re-validates and, only when the user's metadata has none, calls `updateUser({ data: { signup_country } })`, best effort, never failing the sign-in.
- **What `signup_country` is:** a prefill, not the truth. The authoritative value stays `profiles.tax_country`, written only by `saveTaxInfo` (`Store/src/lib/settings/actions.ts:446-580`) from the welcome flow or Settings (later 1B's address country).
- Magic link never creates an account (`shouldCreateUser: false`, `actions.ts:295`).

### 3.4 Components (existing primitives only)

| New | Built from | Notes |
| --- | --- | --- |
| `components/market/CountryStep.tsx` | `ui/label`, `ui/select` (`Store/src/components/ui/select.tsx:63`, a button and listbox, so the value rides in a hidden input as `TaxSection.tsx:363` does), `ui/button`, `infoTextClass` (`components/ui/control-styles.ts`) | Props: `value`, `suggested`, `onConfirm({ country, open })`. Knows nothing about where it is mounted. |
| `components/market/NotOpenYet.tsx` | `ui/HeroMark` (`Store/src/components/ui/HeroMark.tsx:46`), `auth/SuccessMark`, `ui/input`, `ui/label`, `ui/select`, `ui/button`, `auth/Turnstile`, `inlineLinkClass`, `helpTextClass` | Props: `email`, `country`, `source` (bound server-side), `variant: "inline" | "dialog"`, `onChangeCountry`. Inline in the sign-up card and the welcome flow; inside `ui/modal.tsx` (`Modal` with `visual`, `ModalActions`) on Overview. |
| `lib/market/waitlist.ts` | | `WAITLIST_SOURCES` (named constants, each 64 chars or fewer, the DB bound `20260807_db_hygiene.sql:53`): `store-signup-expansion`, `store-welcome-expansion`, `store-dashboard-expansion`, later `store-profile-expansion` for 1B; the Zod schema |
| `lib/market/waitlist-actions.ts` | | the server action (3.6) |

Not used, and why: `ui/AddShowcase` is an empty-list "add" card with examples on each side (`Store/src/components/ui/AddShowcase.tsx:143-159`), the wrong shape for a refusal; `ui/ChoiceCards` would fit a two-way choice but not a country list that grows with the config.

### 3.5 The block's content (styles.md 8.14)

1. One visual, 56px or more: `HeroMark` with a map or globe glyph (lab picks the glyph, 3.10).
2. Title, five words or fewer: "Not in your country yet".
3. One sentence: `Auth.waitlist.description`.
4. One field pair: Email (prefilled with what was typed on Step B if any, or the sign-in email in the dashboard) and Country (prefilled with the answer).
5. One primary button, last: "Let me know". Ghost: "Change country" (sign-up and welcome) or "Check my country" (dashboard). In the welcome-flow variant a quiet link to Settings > Delete account, because that account already exists.
6. The consent line (DRAFT) under the button, at `helpTextClass` size, with the privacy link. Short, never hidden (security and legal copy is shortened, never folded: 8.14 rule 6).
7. Success: `SuccessMark`, "You're on the list", one sentence naming the address.

### 3.6 The waitlist write

**Where: a Store server action, not Home's route.**

| | Store server action (chosen) | Home `/api/waitlist` (`Home/src/app/api/waitlist/route.ts:62-101`) |
| --- | --- | --- |
| Bot guard | Turnstile, already on this form (`Store/src/lib/turnstile.ts:32`) | honeypot only (`:77-79`) |
| Rate limit | `rateLimitKey(clientKey(headers), "waitlist_client", RATE_LIMITS.waitlistPerClient)` on the Postgres sliding window (`Store/src/lib/rate-limit.ts:27`, `:616`, `:656`); new named budget `waitlistPerClient: { max: 5, windowSeconds: 3600 }` with a one-line doc comment | Workers limiter, 5 a minute (`Home/src/lib/rate-limit.ts:16-21`) |
| Email quality | `isDisposableEmailDomain`, `isPlaceholderEmail` (`Store/src/lib/validation/disposable-email.ts:65`, `email-quality.ts:127`) | a regex (`route.ts:11`) |
| Country list | the market module itself | would need a copy in another repo |
| Cross-origin | none | a CORS call from the dashboard to squareshare.eu |
| Branch state | Store worktree | Home is on someone else's branch |
| Side effects | none | forwards to an n8n webhook outside any repo (`route.ts:38-60`), behaviour unknown |

**Steps of `joinExpansionWaitlist(source, prev, formData)`** (source bound by the call site, never read from the form):

1. Parse: email (trimmed, 254 max, existing email schema messages), country in `MARKET.waitlistCountries` or `ZZ`.
2. If the country is open, return `Auth.waitlist.openHere` and flip back to Step B.
3. Refuse disposable or placeholder addresses (`Errors.auth.permanentEmailRequired`).
4. Turnstile (`Errors.auth.verificationFailed`), then the per-client budget (`Errors.auth.rateLimited`); same order as sign-up, so a script is refused before it spends real people's budget.
5. Insert `{ email, country, source }` with the **request-scoped** server client (anon on /login, authenticated on Overview). The existing insert policy allows both roles and pins `owner_id`/`list_id` to null (`20260807_db_hygiene.sql:45-54`); no service role is needed. The platform-wide cap of 60 anonymous inserts a minute still applies (`Store/supabase/migrations/20261105_write_bounds.sql:116-150`).
6. **Duplicate** (`23505` on the unique `lower(email)` index, `Store/tests/db/prod-migrations.sql:1192-1193`): answer exactly as a new signup, write nothing, so the form is never an oracle for who is on the list. Filling `country` on an older row whose country is empty is owner question O6; default no.
7. No email is sent (production mail is off, and no confirmation email is designed; double opt-in is lawyer question L6). No n8n forward.

**Stored:** `email`, `country`, `source`, `created_at` (column default). Nothing else: no IP, no user id (the policy pins `owner_id` null), no locale. **Depends on** the sibling's additive `waitlist_signups.country` column with `CHECK (country IS NULL OR country ~ '^[A-Z]{2}$')`, which needs the owner's approval. Without it, the block can still ship in a no-field form (the sentence plus a link to Home) behind a market-module flag `waitlistOpen`, so the gate is not held up by the migration or the privacy paragraph.

### 3.7 Consent and privacy

DRAFT consent line in 2.1. Before the first row is collected, the Privacy Policy needs a paragraph (DRAFT list for the lawyer): purpose (telling the person when Square Share opens in their country, and counting demand per country); data (email, country, the page it came from, time); legal basis (consent, or steps at the person's request: lawyer); retention (lawyer, for example until we open in that country and have written once, or a fixed period); how to leave (reply or the privacy contact); recipients (Supabase as processor; Brevo when the email goes out). Note the in-force Terms say the waitlist collects only an email address (`Home/src/content/legal/terms/tos-2026-10-11.ts:157-161`); adding country to Home's form or Store's block contradicts that sentence until a newer version is in force (lawyer L6).

### 3.8 How the owner reads the demand data

Admin already has an "Email signups" page over this table: totals, a 30-day chart, search, CSV export and a **campaign send to every row** (`Admin/src/app/(app)/signups/page.tsx:21-81`, `Admin/src/lib/data/signups.ts:36-164`, `Admin/src/app/(app)/signups/actions.ts:21-66`). Small Admin branch:

- read `country` in `fetchSignupsPage`, `fetchSignupsForExport`; a Country column in `SignupsTable`; a "By country" figure row (counts per country for expansion sources) beside the totals;
- a source filter (pre-launch vs expansion);
- **the campaign excludes expansion rows by default** (`fetchAllSignupEmails`, `signups.ts:134-145`): those people asked for one message about their country, not launch news. The source suffix constant (`-expansion`) is duplicated in Admin with a comment pointing at `Store/src/lib/market/waitlist.ts`, or moved to an SQ-system package later.

### 3.9 Home's existing waitlist form

While Home's switch is off, its modal is still the main entry for visitors (`WaitlistForm.tsx:28-298`). Proposed (branch H5):

- Replace the optional "What do you sell?" field (`:181-200`), which is sent and thrown away (`:31`, route ignores it), with an optional native `<select>` styled with the form's `INPUT_CLASS` (Home has no select primitive): label "Where are you or your business based?", "Optional". Keeping "What do you sell?" means storing it, which needs a column and a privacy line: owner question O5.
- The options come from a new public Store endpoint `GET /api/market` (open seller countries, waitlist countries), fetched with a timeout and a fallback list exactly as Home already does for plan prices (`Home/src/lib/plan-prices.ts:21-40`); Home never holds its own country list.
- `route.ts` accepts `country` (two capital letters or empty) and inserts it; the DB CHECK is the wall.
- The consent line (2.7) under the button, which the form lacks today while the Privacy Policy claims consent (`privacy.ts:227-229`).
- H-2's new description. The title "We're not live yet." stays while the switch is off; once it flips, "Get started" links to Store sign-up and this modal is gone.

### 3.10 What goes through a /dev lab first

| Part | Lab | Why |
| --- | --- | --- |
| The friendly block's visual and its success moment | **`/dev/market-lab`** (`page.dev.tsx`, lab-kit controls, `LabLazy` tiles), placements: sign-up card, welcome flow slide, Overview dialog, Settings inline; 15 to 20 hand-curated presets (globe glyph, map pin, a small map of Europe with CZ lit and the chosen country outlined, no visual; tone; success mark), shortlist first | the owner picks it by eye (lab.md) |
| The delivery line's icon and order in the trust list, the embed footer item | no new lab: shown in the existing `/dev/checkout`, `/dev/embed-frame`, `/dev/cart-lab` harnesses for review | one text line in existing components |
| Home hero sub-line (optional) | Home's local, gitignored labs (`Home/src/app/(local)/`) | owner pick |
| Not lab: the country step form, the copy, the validation, the flow | | lab.md: "not for logic, forms or copy" |

New dialog: an entry in `/dev/modals` for the Overview waitlist dialog (styles.md 8.14), and welcome-flow cases (country open, closed, prefilled) in `Store/src/app/dev/onboarding/OnboardingGallery.tsx`.

---

## 4. Existing sellers

Production facts (from the brief, not re-read): 15 accounts (Terms: none x11, tos-2026-10-11 x2, tos-2026-11-06 x2); a 2026-10-30 note says 3 of 11 sellers had set a country (unverified). Country is not part of the publish gate today (`trader-identity.ts:115-144`), and the read-side gate fails closed (`Store/src/lib/settings/seller-identity.ts:128-132`), so **adding country to the gate would hide live pages at once**. That is disabling, and needs the owner's decision.

### 4.1 Two stages

| Stage | Who decides | What a seller sees | What is blocked |
| --- | --- | --- | --- |
| **Notice** (ships with this design) | already decided by the brief | one "complete your seller profile" row on Overview (4.2) | nothing |
| **Enforce** (later) | the owner, after reading the report (4.4), per group (unset vs a country not open) | the row turns urgent; `country` joins `TraderIdentityField` (`trader-identity.ts:37-41`) so the chrome banner (`Store/src/components/settings/SellerDetailsNotice.tsx:50-100`), the setup checklist's seller step and every gate say it through existing machinery; the "not open" case gets its own headline (2.5) | publishing and selling, as the owner decides |

### 4.2 What a signed-in seller sees (notice stage)

- **Country unset:** row "Add the country you're based in", action "Add country" to `/settings/business#country` (the anchor exists, `TaxSection.tsx:361`). Not urgent.
- **Country set but not open** (for example DE, US, CA): row "We're not open in your country yet", action "See options", which opens the Overview dialog: `NotOpenYet` in `Modal` (email prefilled with the sign-in email, country prefilled, source `store-dashboard-expansion`), ghost "Check my country" to Settings. In Settings the stored country stays visible and selected as "Germany (not open yet)", and the rest of the form still saves (0.1).
- **Team members** see neither row: profile rows are owner-only by design (`attention.ts:274-278`); the member variant of the chrome banner applies at the enforce stage only.
- Nothing is deleted, hidden, paused or emailed.

### 4.3 The "complete your profile" home: Needs attention, fed by one module

Checked both candidates:

| | Setup checklist ("Get set up") | Needs attention card |
| --- | --- | --- |
| Model | derived, pure (`Store/src/lib/onboarding/steps.ts:1-28`, `buildSetupSteps` `:146`) | derived, pure (`Store/src/lib/dashboard/attention.ts:101-112`) |
| Shown to an established seller | **No**: gone once complete and celebrated (`Store/src/components/onboarding/SetupChecklist.tsx:125`; `DashboardHome.tsx:79`) | Yes, whenever a row fires |
| Purpose | the path to a first live page, in order | standing conditions, each linked to the surface that fixes it; already carries the analogous Terms row (`attention.ts:287-300`) |
| Deadlines, urgency | none | `urgent` flag (`attention.ts:52`); a deadline fits the description |
| Duplication rule | | rows the checklist states stand down while it shows (`attention.ts:244`, `:262`) |

**Recommendation:** a new pure module `lib/seller-profile/completeness.ts` returning items `{ id, state: "missing" | "notOpen" | "due" | "blocked", dueAt?, href | action, label, description }`. This design adds one item, `country`. Rendered as:

1. **ONE Needs attention row, key `profile`** (added to `AttentionKey` and `components/dashboard/attention-icons.ts`), labelled by its most pressing item, later "and N more", with the soonest deadline in the description and `urgent` once a deadline is near or something is blocked. It stands down while the setup checklist shows, like 2FA and Stripe.
2. **The setup checklist's seller step** reads the same module's blocking subset once a requirement is enforced, so a new seller meets it as a setup step, never twice.
3. **The chrome banner** only for blocked items (existing `SellerDetailsBanner`).

Destination: one named path constant (today `TRADER_IDENTITY_HREF`, `trader-identity.ts:57`, `/settings/business`), which 1B re-points at its form.

### 4.4 The report for the owner

A read-only query the owner runs in the Supabase SQL editor (not run here):

```sql
select coalesce(p.tax_country, '(unset)') as country,
       count(*) as accounts,
       count(*) filter (where exists (
         select 1 from products pr where pr.owner_id = p.id and pr.status = 'active')) as with_active_products
from profiles p
group by 1 order by 2 desc;
```

(Column names per `Store/src/types/supabase.ts`; check `products.owner_id` before running.) Optionally a Country column and filter on Admin's users list, in the Admin branch.

---

## 5. Czech-language legal texts

### 5.1 Every legal or statutory text a seller or buyer meets

"Who" = who must write or review: **L** lawyer, **T** professional translator, **A** accountant, **U** us (code or plain copy).

| # | Text | English today | Czech today | Who | Order |
| --- | --- | --- | --- | --- | --- |
| 1 | Terms of Service (all parts) | `Home/src/content/legal/terms/tos-2026-11-06.ts` (newest), `tos-2026-10-11.ts` (in force) | **none**; English prevails `tos-2026-11-06.ts:1103` | L writes EN; T, then L checks CS | 1 |
| 2 | Acceptable Use Policy | inside the Terms, s.11 `tos-2026-11-06.ts:459-502` | none | L (one list: Stripe superset, EU/CZ law, classifier rules `Store/src/lib/moderation/auto/policy.ts:92-105`) | 1 |
| 3 | Terms summary (welcome flow, Settings > Legal) | `settings.json:248-309` | `cs/settings.json:248-306`, agent-made, unreviewed (`terms-summary.ts:14-15`) | L after #1; T | 3 |
| 4 | Privacy Policy | `Home/src/content/legal/privacy.ts` | none | L (territory, waitlist country paragraph 3.7, Stripe Connect flows `:127`, DAC7); T | 1 |
| 5 | Cookie Policy and banner | `Home/src/content/legal/cookiePolicy.ts`; source `System/SQ-system/docs/legal/cookie-policy.md`; banner defaults `System/SQ-system/packages/consent/src/react.tsx:93-108` (Home overrides only the description, `Home/src/components/ConsentRoot.tsx:50-52`) | none | L light; T; U passes Czech banner labels as props | 4 |
| 6 | Imprint | one line `Home/src/components/Footer.tsx:230-233` | none | U (Czech line); operator naming is an owner dependency | 4 |
| 7 | Accessibility Statement | `Home/src/content/legal/accessibility.ts` | none | U, T | 5 |
| 8 | Checkout pre-contract information (seller block, statutory notes, platform-not-party, terms assent, pay button) | `productPage.json:91-104`, `:274-278`, `:321` | present (`cs/productPage.json:99-104`, `:390-394`, `:437`), unreviewed | L reviews CS statutory terms | 2 |
| 9 | Withdrawal information | `productPage.json:99-101` | present | L | 2 |
| 10 | Model withdrawal form (CRD Annex I(B)) | **none** in any language; a withdrawal button exists (`productPage.order.withdraw.*`, `productPage.json:355`) | none | L: is it needed from the platform on the seller's behalf | 2 |
| 11 | Order confirmation email | `orders.json:275-298`; built `Store/src/lib/orders/emails.ts:94-105`, translated per order locale `:28`, `:45` | present | L reviews statutory parts | 2 |
| 12 | Withdrawal acknowledgement email | `orders.json:299` onward | present | L | 2 |
| 13 | Statement of reasons (PDF) | `Store/src/lib/moderation/statement.ts:31`, `:90-100` (seller's locale) | present | L reviews CS | 3 |
| 14 | Moderation notices from Admin (in-app and email) | `Admin/src/lib/moderation/content.ts:453-551` | **none** | U (i18n in Admin, seller's locale); T; L light | 3 |
| 15 | Account suspension or termination notice | **none** (Audit C P2B-4b) | none | L writes; U builds | 3 |
| 16 | Terms change notice (email and banner) | `settings.json:311-336`; built `Store/src/lib/legal/terms-notices.ts:155-178` | present | L | before any notice |
| 17 | Fee disclosure | Terms s.9 `tos-2026-11-06.ts:336-434`; `/plans` `billing.json:31-32`, `:41`; Home `PricingSection.tsx:56`, `:91-94` (hidden); Docs `pricing/index.mdx` | Terms none; `/plans` present; Docs cs present | A (VAT wording), L (fee on refund), T | 1 (with the Terms) |
| 18 | Sign-up legal line and the country question | `auth.json:41`; new `Auth.market.question` | present (old text) | L (criterion wording) | with S3 |
| 19 | Waitlist consent line | new `Auth.waitlist.consent`; Home form (none today) | new | L | with S2 |
| 20 | DSA contact point statement ("in English and Czech") | `tos-2026-11-06.ts:843` | none | L | 1 |
| 21 | Supabase Auth emails (confirm sign-up, magic link, reset) | not in any repo (Supabase project or Brevo) | unknown | U to check | 4 |
| **1B rows** | | | | | |
| 22 | Private-seller notice (consumer-protection rights do not apply) | none | none | **L writes** EN and CS | with 1B |
| 23 | DSA self-certification ("I only offer products or services that comply with applicable EU law") | none | none | L confirms wording EN and CS | with 1B |
| 24 | Privacy acknowledgement that seller data is reported to tax authorities (DAC7) | none (Terms mention DAC7 `tos-2026-11-06.ts:288`; privacy silent) | none | A on scope, then L; T | with 1B |
| 25 | Seller info block labels (legal or trading name, public address, email, phone, register and number, self-certification, trader status) | partly: seller block labels `productPage.json:91-97` | partly present | U for existing labels; L for "trader status" and register wording | with 1B |
| 26 | Product-safety labels (page and embed) | `productPage.json:42-47`; form prompts in `products.json` (`safetyPrompt`, `safetyFields`) | present (agent-made) | L light review of CS (GPSR terms) | with 1B |
| 27 | "Complete your profile" reminders (row, banner, deadlines) | new (2.5 for the country item) | new | U; L when a deadline has legal consequences | with 1B |
| 28 | DAC7 data request and two reminders (in-app and email) | none | none | A on content and timing, L on wording; T | with 1B |

### 5.2 Order of work

1. **Lawyer, English first:** the CZ-beta Terms (#1, #2, #17, #20) and the Privacy Policy changes (#4), from the DRAFT folder (6.3) and Audit C's checklist.
2. **Translator:** Czech of #1 and #4 (and #3, #16 once #1 is final), then the lawyer checks the Czech.
3. **In parallel, lawyer review of Czech that already ships:** #8 to #13 (checkout, emails, statement), and #18, #19.
4. **Us, in parallel:** Home's Czech pages mechanism (5.3), Admin notice i18n (#14), banner labels and imprint (#5, #6), Supabase email templates check (#21).
5. **Owner publishes** (section 6). 1B rows follow 1B's own design.

### 5.3 Serving Czech legal pages on Home

Facts: Home has no i18n, `lang="en"` is fixed in the root layout (`Home/src/app/layout.tsx:174`); legal routes are `terms/`, `terms/v/[version]/`, `legal/privacy-policy/`, `legal/cookie-policy/`, `accessibility/` (`Home/src/app/**/page.tsx`); the freeze check only matches `^tos-\d{4}-\d{2}-\d{2}\.ts$` (`Home/scripts/check-terms-frozen.mjs:18`), so a Czech sibling file would be ignored by it; Store links every legal page through one module (`Store/src/lib/legal/links.ts:41-64`) and Docs through a locale-keyed list (`Docs/lib/legal.tsx:10-17`).

| Option | What it takes | Trade-offs |
| --- | --- | --- |
| **A. A `(cs)` route group on Home** with its own root layout (`<html lang="cs">`), routes `/cs/terms/`, `/cs/terms/v/[version]/`, `/cs/legal/privacy-policy/`, `/cs/legal/cookie-policy/`, `/cs/accessibility/`, content files `tos-<date>.cs.ts`, `privacy.cs.ts`... beside the English, reusing `LegalLayout` and `LegalDocument` | move the current root layout into an `(en)` group; extend the freeze check to freeze a version's language files together and refuse a Czech file without its English one; `terms:new` copies both; hreflang alternates; sitemap | small, static, keeps legal texts where the freeze guard lives; switching language is a full page load (fine); touches Home's layout on a shared branch (only `globals.css` and `.gitignore` are dirty there) |
| B. next-intl on Home | a framework over a hard-coded marketing site | large change for five pages |
| C. Serve Czech legal pages from Store (has next-intl and cs) | Store routes rendering Home's content | legal home split across two origins; the freeze guard is on Home; breaks "policies live on the marketing origin" (`links.ts:11-14`) |
| D. Docs (has `/cs/`) | MDX pages | Docs are help, not the contract; no versioning or freeze |
| E. PDFs | files | poor accessibility, no freeze, no anchors |

**Recommendation: A.** Then Store gets a locale-aware href helper (taking the locale as a plain argument, so `links.ts` stays import-free) and `termsVersionUrl` gains the same (`Store/src/lib/legal/terms-versions.ts:50-52`); Docs adds cs hrefs. The Terms' language clause (`tos-2026-11-06.ts:1103`) is the lawyer's (L5). Whether an acceptance should record the language it was read in (Audit C 2.4 lists it as not recorded) is L11; it would need a column (owner approval).

---

## 6. The new Terms version for the Czech-only beta

### 6.1 Sections that must change relative to tos-2026-11-06

Not the text: the list the lawyer drafts against. Line numbers are in `Home/src/content/legal/terms/tos-2026-11-06.ts`.

| Section | Lines | What changes |
| --- | --- | --- |
| Subtitle, intro notes | `:19`, `:27-29`, `:31-33` | territory sentence (R7); "what's live today" status |
| Constants | `:9-15` | US copyright agent and the US phone rationale go if the US part is parked (owner, L) |
| 1. Who we are | `:50-75` | waitlist mention (`:24`); operator stays (naming dependency) |
| 2. Where we operate | `:76-139` | replace the three-region table with: open to sellers established in the Czech Republic (criterion for a private person vs a trader: L1, ties to 1B's trader status), delivery to Czech addresses only, dispatch from within the EU (owner's rule), plan to expand; sanctions clause rewritten; "a Seller's duties follow the Buyer" (`:129`) simplified |
| 3. Definitions | `:140-198` | region terms |
| 4. Eligibility | `:199-225` | `:213` location requirement to establishment in CZ; age and capacity; trader vs private (1B) |
| 5. Current status | `:226-247` | Czech-only beta |
| 7. Seller obligations | `:271-306` | tax duties `:287-288` drop US sales tax, Canadian GST/HST and INFORM; keep EU VAT and DAC7 per the accountant; product-safety role (1B) |
| 9. Payments, plans, fees | `:336-434` | product prices in CZK; plan currency (`:366-386`, EUR or CZK: owner and accountant); VAT sentence (`:386`, accountant); **fee on refund** (`:426` placeholder) to the owner's rule: kept by default, refunded only for (1) an illegal or fraudulent sale removed, (2) Square Share's fault, (3) a dispute lost because of Square Share; **the Stripe section** (`:348`, `:352`) to describe what Square Share does on the seller's Stripe account: creates the Express account, sends onboarding and dashboard links, creates Checkout Sessions as direct charges on it, takes the application fee, issues refunds at the seller's request, reads balance and payouts, receives webhook data, what it keeps (Audit C S-2) |
| 10. Buyer terms | `:435-458` | delivery within CZ only; CZK |
| 11. Acceptable Use Policy | `:459-502` | **the banned-items list**: one list, superset of Stripe's restricted businesses, EU and Czech law, the classifier's rules, adults-only goods (Audit C B-1, P2B-2) |
| 12. Content checks | `:503-556` | DSA self-certification reference (1B) |
| 18. Suspension and termination | `:705-736` | `:721` "no longer based in a region where we operate" to the CZ criterion; P2B Art. 4(4) exceptions; statement of reasons for account actions |
| 19. Changes | `:737-757` | keep 30 days; how opening a new country is handled (L4) |
| 20. Governing law | `:758-779` | Czech law; drop the Canada exception |
| 21, 22 Regional parts | `:780-1089` | drop Part B (US, incl. arbitration) and Part C (Canada); fold Part A (EU) into the main text or a Czech part; keep data access (`:832`), complaints (`:833`), ranking (`:830`), differentiated treatment (`:831`, plan grants and waivers, Audit C P2B-11), DSA contact (`:843`); drop the deemed-supplier paragraph (`:820`) if the accountant agrees |
| 23. Miscellaneous | `:1090-1109` | language clause `:1103` (L5) |
| 24. Contact | `:1110` onward | operator and mailbox (office@ vs support@: dependency) |

Store side in the same release: `TERMS_VERSIONS` (`terms-versions.ts:32-35`), a non-empty `TERMS_CHANGES` entry (the unit test refuses an empty one, `terms-changes.ts:3-4`) with `Settings.legal.notice.changes.czechBeta` plus the lawyer's other bullets, and the summary keys (2.4).

### 6.2 Mechanics and consequences of publishing it

- **Recipe** (`Store/docs/changing-the-terms.md:5-14`): Home `npm run terms:new` (copies the newest to `tos-<today>.ts`), edit, `npm run terms:freeze`; register in Store; deploy Home, then Store. With option A of 5.3, the Czech file is frozen in the same step.
- **At once, on Store's deploy:** `LEGAL_VERSION` becomes the new version (`Store/src/lib/settings/constants.ts:14`, `terms-versions.ts:38`), so every new seller agrees to the CZ-beta text in the welcome flow. This is the effect the beta needs most.
- **Existing sellers: the queue.** The daily job emails versions one at a time, oldest listed without `effective_at` first (`Store/src/lib/legal/terms-notices.ts:96`). tos-2026-11-06 has no notice yet (mail off; the job throws `mail_off`, `:101`). So when mail is switched on, 11-06 is noticed first, takes effect 30 days after its last email (the EU/US/Canada text, for everyone), and only then does the CZ-beta version start its own round: two email rounds, 60 days or more, with a wider territory in force in between.
- **The documented replacement does not apply:** `replacedBy` is allowed only if nobody agreed to the version (`changing-the-terms.md:50-56`), and two accounts agreed to 11-06.
- **Options for the owner and the lawyer:**
  - **A. Run both** as the job does today. No code; two rounds; contradictory interim.
  - **B. Supersede 11-06 before its notice (recommended, subject to L3).** Leave 11-06 out of Store's `TERMS_VERSIONS` and `TERMS_CHANGES` (deleting the bullets in 1a #15); on Home add a new marker, for example `supersededBy`, whose page says what is true ("applied to accounts opened while it was the newest version; never noticed to anyone else; superseded by ..."), because `replacedBy`'s wording "Before anyone was told about them or agreed to them" (`Home/src/app/terms/v/[version]/page.tsx:38-46`) would be false; update the recipe. One round: everyone not on the new version is emailed, the two accounts on 11-06 included. `resolveTermsStatus` (`terms-versions.ts:80-95`) then treats 10-11 as in force until the new version takes effect, and `agreementOutdated` does not nag the two 11-06 accounts in the meantime (`:56-59`).
  - C. `urgentReason`: does not apply; a business decision is not "law" or "danger" (`changing-the-terms.md:44-46`).
- **Recipients and gaps:** everyone with a confirmed email who has not agreed to this or a later version (`terms-notices.ts:214-237`); unconfirmed addresses are skipped and bounced ones abandoned after three tries while the clock still starts (Audit C 2.2). With 15 accounts, the owner can check by hand who was reached.
- **Nothing moves while mail is off.** The new version's text is binding for new sign-ups from Store's deploy; for existing sellers it applies only 30 days after the last email of its round. The 11 accounts that never agreed to anything are lawyer question L12.
- **R7 copy and the notice stage can ship before the new Terms**, since the Terms' region list is a superset of Czechia; the copy must not claim "the Terms say so" until they do (L2). The enforce stage for existing sellers is better timed after the new version is in force.

### 6.3 Where the DRAFT lives

`C:\Squareshare\Store\docs\compliance\legal-drafts\terms-cz-beta\`

- `README.md`: "DRAFT, NOT PUBLISHED. Publishing is the owner's decision alone and starts emails to every seller and a 30-day notice. Recipe: Store/docs/changing-the-terms.md."
- `DRAFT-terms-cz-beta.en.md`, `DRAFT-terms-cz-beta.cs.md`: every page headed "DRAFT for lawyer review, not in force".
- `CHANGES.md`: the 6.1 table, kept against the text.
- Sibling folder `legal-drafts/privacy-cz-beta/` for the Privacy Policy DRAFT.

Why there: outside Home's `src/`, so it is never imported, built or served, and can never trip the freeze check (which would fail Home's build on an unfrozen `tos-*.ts` in the versions folder, `check-terms-frozen.mjs:43-47`); Markdown is what a lawyer can redline; the names never match `tos-*`; `docs/compliance/` is this workstream's folder. When final, the text is transcribed into the file `npm run terms:new` creates.

---

## 7. Branches, in dependency order

Every Store branch is built in its own git worktree (the main tree is shared with live sessions); run only the touched spec and test files, never a full suite beside another session's run.

**Hot files:** `messages/*/auth.json` (B3, B4), `messages/*/settings.json` (B5, B9), `messages/*/productPage.json` (B2), `messages/*/dashboard.json` (B7), `messages/*/common.json` (B3), each in all 10 locales; `src/i18n/scopes.ts` (B2, B3, B6, B7); `LoginForm.tsx` (B4); `WelcomeFlow.tsx` (B6, then 1B); `DashboardShell.tsx`, `attention.ts` (B7). Land message-file branches one at a time, rebase the next onto it, and apply translations with the CRLF-preserving helper.

| # | Branch | Repo | Touches | Tests | Depends on | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| B0 | (sibling) market config | Store | `src/lib/market/*`, pickers, validation | sibling's | none | sibling's own approvals |
| B1 | (sibling) `waitlist_signups.country` migration | Store (DB) | `supabase/migrations/*`, `src/types/supabase.ts` | db tests | none | **owner approval** (applied by the owner; the connector declines writes here) |
| B2 | `market/delivery-line` | Store | `TrustList.tsx`, `ProductPageView.tsx`, `CheckoutForm.tsx`, `CheckoutView.tsx`, `CartPanel.tsx`, `EmbedFrameView.tsx`, `lib/format/country.ts` (`formatCountryList`), `productPage.json` x10, `scopes.ts` | unit `buildTrustLines`, `formatCountryList`; `i18n-messages`, `i18n-client-scopes`; the checkout and embed-frame e2e specs | B0 | review in `/dev/checkout`, `/dev/embed-frame`, `/dev/cart-lab`; owner O4 (external buy links) |
| B3 | `market/waitlist` (action and block) | Store | `components/market/NotOpenYet.tsx`, `CountryStep.tsx`, `lib/market/waitlist.ts`, `waitlist-actions.ts`, `RATE_LIMITS`, `auth.json` x10, `common.json` x10 | unit for the action (open country, duplicate, disposable, Turnstile, budget order); component test for the block | B0, B1, L1 lab pick, H3 live (privacy paragraph) | **lab pick**, **lawyer** (consent line) |
| L1 | `lab/market-block` | Store | `src/app/dev/market-lab/*` (dev-only) | Playwright drive of the lab (lab.md) | B0 | owner's pick |
| B4 | `market/signup-country-step` | Store | `LoginForm.tsx`, `GoogleButton.tsx`, `lib/auth/actions.ts`, `auth/callback/route.ts`, `login/page.tsx`, `auth.json` x10 (`signupLegal`, delete `signupRegionNote`) | `tests/unit/actions/auth-actions.test.ts` (refused before `signUp`), `tests/component/login-form.test.tsx`; e2e `01-auth`, `69-two-factor-recovery`, `73-password-never-shown`, `85-dead-ends` and `tests/e2e/helpers.ts` (every form sign-up now picks a country) | B3 | **lawyer** (legal line, criterion) |
| B5 | `market/settings-copy` | Store | `TaxSection.tsx`, `CountryPicker.tsx`, `ShippingSection.tsx`, `settings.json` x10, `onboarding.json` (address example) | component tests for the pickers (stored non-open values kept) | B0 (and its grandfather rule) | none |
| B6 | `market/welcome-country-step` | Store | `WelcomeFlow.tsx` (country step as the seller step's first screen), `OnboardingPanel.tsx`, `dashboard/page.tsx` (prefill from `signup_country`), `scopes.ts`, `/dev/onboarding` cases | WelcomeFlow component tests; the onboarding e2e | B3, B4 | none |
| B7 | `market/profile-attention` | Store | `lib/seller-profile/completeness.ts`, `attention.ts`, `attention-icons.ts`, Overview dialog, `/dev/modals` entry, `dashboard.json` x10 | unit for completeness and the row; `/dev/attention-lab` tile if useful | B3 | **owner approval** (what existing sellers are told) |
| B8 | `market/public-api` | Store | `src/app/api/market/route.ts` (public, cached JSON) | route unit test | B0 | none |
| A1 | `signups/country-and-sources` | Admin | `lib/data/signups.ts`, `signups/page.tsx`, `SignupsTable`, `signups/actions.ts` (campaign excludes expansion) | Admin unit tests | B1 | owner O8 |
| H1 | `copy/cz-beta` | Home | `content/faq.ts`, `WaitlistForm.tsx` (description), `PricingSection.tsx`, `app/terms/page.tsx` meta, `accessibility.ts`, `howItWorks/data.ts`, delete `StorefrontMockup.tsx` | Home build (prebuild runs the freeze check) | none | owner glance; hero line by eye (optional) |
| H2 | `legal/cs-routes` | Home | `(en)`/`(cs)` route groups, layouts, `scripts/check-terms-frozen.mjs`, `terms-version.mjs`, sitemap | build; freeze-check self-test with a pair of files | none | none (no Czech text yet) |
| H3 | `legal/privacy-cz-beta` | Home | `content/legal/privacy.ts` (+ `privacy.cs.ts` after H2) | build | lawyer text | **lawyer** |
| H4 | `legal/terms-cz-beta` | Home | new `tos-<date>.ts` (+ `.cs.ts`), `index.ts`, `frozen.json`, `supersededBy` if option B | build, freeze check | lawyer text, H2 for Czech | **lawyer**, **owner publishes** |
| B9 | `legal/terms-cz-beta-register` | Store | `terms-versions.ts`, `terms-changes.ts`, `terms-summary.ts`, `settings.json` x10, `docs/changing-the-terms.md` (supersede path) | `terms-versions` unit test | H4 deployed first | **lawyer**, **owner** |
| B10 | `legal/links-locale` | Store | `lib/legal/links.ts`, `terms-versions.ts` (`termsVersionUrl`), consumers | unit | H2 live | none |
| H5 | `waitlist/country-consent` | Home | `WaitlistForm.tsx`, `api/waitlist/route.ts`, a market fetch helper like `lib/plan-prices.ts` | build | B1, B8, H3 | **lawyer** (consent line), owner O5 |
| D1 | `copy/cz-beta` | Docs | the pages in 1e (en + cs) | Docs build | B4 merged (D-2 describes the step) | none |
| D2 | `legal/cs-links` | Docs | `lib/legal.tsx` | Docs build | H2 live | none |

Not in this list but adjacent: Admin moderation notices in Czech (Audit C P2B-4a), the fee-on-refund code (Audit C R-1), the enforce-stage gate (sibling, owner decision).

---

## 8. Seams for the seller onboarding workstream (1B)

Not designed here; left so 1B can adopt without rework.

1. **The country step is step one of the universal form.** `CountryStep` (question, market check, Continue) and `NotOpenYet` (block, waitlist) are standalone, with a value contract `{ country, open }`; they do not know whether they sit in sign-up, the welcome flow or the 1B form. 1B mounts them unchanged as its first screen, with source `store-profile-expansion`.
2. **Before an account exists, only the country is asked.** Seller type, trader status, legal names, date of birth, structured address, tax residence, tax IDs, VAT, registration, contact block, returns address and declarations all wait for the 1B form.
3. **The answer carries forward.** `signup_country` (user metadata) is the prefill for 1B's structured address country; 1B's address country must pass `isSellerCountry`, and changing it to a closed country shows `NotOpenYet` again. Once the form holds the structured country, `signup_country` is redundant.
4. **"Complete your profile" is a module, not a banner.** `lib/seller-profile/completeness.ts` returns items with state and deadline; this design adds `country`; 1B adds its fields, its verification states and deadlines. One Needs attention row renders them; the setup checklist's seller step reads the blocking subset; the chrome banner only shows blocked items. The destination is one path constant that 1B re-points at its form.
5. **Gate stages.** The notice/enforce split (4.1) is the same switch 1B needs for "publishing and checkout blocked until complete and verified"; the enforce stage goes through `TraderIdentityField` and the existing gates (CP1 in `inventory/01-store-sellers-accounts.md:275`).
6. **Buyer page positions.** The delivery line lives in the trust list (product page), the checkout's Delivery fieldset, the cart summary and its own embed footer item. 1B's Seller info block takes the seller positions, which this design does not touch: `ProductPageView.tsx:251-259` and `:602-606`, `CheckoutView.tsx:181-197`, `EmbedFrameView.tsx:95`, `PoweredByFooter.tsx:137-147`, `Store/src/lib/orders/emails.ts:94-105`.
7. **Welcome flow.** The country step is the first screen of the seller step; 1B replaces the remaining fields. Terms acceptance stays in the welcome flow's terms step until 1B's declarations step adopts the same action (`acceptLegal`, `Store/src/lib/settings/actions.ts:399-422`).
8. **Legal texts.** 1B's rows are in 5.1 (#22 to #28).

---

## 9. Open questions

### Owner

- **O1** One name for the country in English: "the Czech Republic" (R7) or "Czechia" (the code's display name)?
- **O2** Terms queue: option A or B (6.2), with the lawyer.
- **O3** Existing sellers: confirm the notice stage now; when and for which group the enforce stage starts; what happens to live listings of a seller whose country is not open.
- **O4** Does the CZ-only delivery rule bind sales through a seller's own buy link, and should the delivery line show on those products?
- **O5** Home's form: replace "What do you sell?" (collected and discarded) with the country select, or store both?
- **O6** Waitlist duplicates: fill `country` on an existing row whose country is empty, or never write (default)?
- **O7** Which countries the waitlist offers (proposed: EU 27, EEA, CH, GB, US, CA, "Somewhere else").
- **O8** Admin campaign excludes expansion signups by default?
- **O9** Docs pages pitched at EU sellers (D-8, D-9): keep with a note, or unpublish during the beta?
- **O10** Plan billing currency (EUR or CZK), with the accountant; Home's price fetch refuses anything but EUR (`Home/src/lib/plan-prices.ts:39-40`).
- **O11** Optional hero line on Home, picked by eye.
- **O12** Approve the `waitlist_signups.country` migration (sibling).
- **O13** The eventual "we're open" email has no stored locale by design: send it in English plus the country's language?
- **O14** Operator naming (Efficontrol vs "Root Labs" in Docs) and the contact mailbox: a dependency for the legal pages.

### Lawyer

- **L1** The eligibility criterion and its Czech term: establishment for a trader, residence for a private person? (usazení, sídlo, místo podnikání, bydliště). The DRAFT question uses "bydliště nebo sídlo firmy".
- **L2** May the R7 messaging and the notice-stage market check ship while new sellers still agree to tos-2026-11-06 (EU/US/Canada)?
- **L3** Option B: can 11-06 be superseded before its notice although two accounts agreed to it, and what must its page say?
- **L4** May the Terms define the territory by reference to a published list we update, so that opening a country is not a new version?
- **L5** Must the Terms and Privacy Policy be offered in Czech, which language prevails (`tos-2026-11-06.ts:1103`), and must buyer statutory strings in other locales be reviewed or fall back to cs or en during the beta?
- **L6** Waitlist: legal basis, double opt-in (non-CZ recipients), retention, the consent line, and the in-force Terms' "only your email" sentence (`tos-2026-10-11.ts:157-161`).
- **L7** Is the delivery line on the product page enough for the delivery-restriction statement (CRD Art. 8(3)), given the seller is the trader?
- **L8** Model withdrawal form: needed from the platform?
- **L9** Review of the Czech statutory strings already shipping (5.1 #8 to #13).
- **L10** The private-seller notice (1B).
- **L11** Should an acceptance record the language and surface it was given in?
- **L12** What binds the 11 accounts that never agreed to any version?

### Accountant

- **A1** VAT wording for a non-VAT-registered operator ("excl. VAT", reverse charge, Stripe Tax on plan checkout).
- **A2** Plan currency and the DAC7 scope and privacy paragraph (also 1B #24, #28).

### Could not determine

- Whether Home's launch switch is set as a Cloudflare build variable (disk says off).
- Production `tax_country` distribution and which accounts have active products (query in 4.4).
- What the n8n automation does with Home's waitlist rows.
- The language of the Supabase Auth email templates (not in any repo).
- Whether Stripe Connect's platform settings restrict onboarding countries.
- Whether deployed Home, Docs, Admin and Store match the trees read here.
