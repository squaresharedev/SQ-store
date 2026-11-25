# Inventory 08: public messaging surfaces, waitlist and Czech language

Investigation only, 2026-11-22. Nothing was changed. Read from disk with Read, Grep, Glob, read-only git and two read-only `node -` one-liners (key counts piped through stdin, no file written).

Repo states read:

| Repo | Branch / HEAD | Working tree |
| --- | --- | --- |
| Home (SQ-home) | `homepage-rework` at 7f9bb0a, which equals `main` and `origin/main` | 2 uncommitted files: `.gitignore` (+5, ignores `src/app/(local)/`) and `src/app/globals.css` (+5, `@source "./(local)"`). Neither touches copy. Gitignored `src/app/(local)/` holds labs only (environment-lab, stall), no messaging. |
| Store (SQ-store) | `main` at e43eedd | clean |
| Docs (SQ-docs) | `main` | clean |
| App (SQ-app) | `main` | 25 modified files (worker routes, moderation, `index.html` meta); none carry region, currency or legal copy |
| SQ-system | n/a | read only `packages/consent`, `packages/pricing`, `docs/legal` |

Path prefixes: `Home/` = C:\Squareshare\Home, `Store/` = C:\Squareshare\Store, `Docs/` = C:\Squareshare\Docs, `App/` = C:\Squareshare\App, `System/` = C:\Squareshare\System\SQ-system.

Legend for the "Contradicts CZ-only beta?" column: **YES** = states or implies a wider territory, other currencies, or delivery outside CZ; **PARTLY** = compatible wording but implies something else (e.g. EU-wide rights, EUR only); **no** = neutral.

---

## Headline findings

1. **Every territorial statement in the product still says "EU, the USA and Canada".** That is the Terms version every new seller agrees to (`tos-2026-11-06`, Home), the seller sign-up form, the Terms summary in onboarding, the Settings country hint, the Privacy Policy intro, the `/terms/` page meta description, and six Docs pages in each of two languages. Nothing anywhere says "Czech Republic only".
2. **The code backs the old decision.** The seller country list is the 27 EU states plus US and CA (`Store/src/lib/settings/constants.ts:110-114`); checkout delivers to 29 countries plus a seller-selectable "Everywhere else" (`constants.ts:129-136`, `CountryPicker.tsx:33-41`); product currencies are EUR and USD only, **CZK does not exist** (`Store/src/types/product.ts:12`). Copy that says "Czech Republic only" would be false until the code moves too.
3. **No country gate and no expansion waitlist exist.** Seller sign-up asks for no country; the welcome flow asks for no country; the Settings country is optional ("Not set"); the publish gate ignores country. The only waitlist is Home's pre-launch email list, which stores `email` and `source` only (no country, no consent text on the form).
4. **Czech UI coverage in Store is complete; Czech legal coverage is nil.** Store `messages/cs` has exactly the same 20 namespaces, 370 top-level keys and 5,762 leaf keys as `en` (0 missing, 0 extra), including the checkout's statutory strings. Home (Terms, Privacy, Cookie Policy, Accessibility, imprint line) is English only, with no locale mechanism. Docs has 52 Czech pages mirroring 52 English ones.
5. **Legal texts are presented as final**, except the one in force: only `tos-2026-10-11` carries a "should be reviewed by a qualified lawyer" disclaimer (it also still has an operator placeholder and a `[fee %]` placeholder). `tos-2026-11-06`, Privacy and Cookie Policy carry no draft label.
6. **VAT and fee disclosures assume a VAT-registered operator** ("excl. VAT", "reverse charge", Stripe `automatic_tax` on), while the operator is not VAT-registered. The platform-fee-on-refund rule is stated in Docs only; the Terms defer to "the fee policy shown in your Dashboard", and the dashboard shows none.
7. **The operator is named inconsistently:** Efficontrol s.r.o. on Home; "Root Labs" in Docs; "SquareShare" in the cookie banner; nobody in Store. Contact points split between `office@squareshare.eu` (Home, Docs, Terms DSA point of contact) and `support@squareshare.eu` (Store).

---

## 1. Every surface that states or implies territory, delivery or currency

### 1a. Home (squareshare.eu)

Home has no i18n: every string is hard-coded English in TSX/TS. `lang="en"` (`Home/src/app/layout.tsx:174`), Open Graph `locale: "en_US"` (`layout.tsx:92`), JSON-LD `inLanguage: "en"` (`layout.tsx:151`).

| Surface | File:line | Current text (short) | Contradicts CZ-only beta? |
| --- | --- | --- | --- |
| Terms page meta description (served for whatever version is in force, not frozen) | Home/src/app/terms/page.tsx:12-13 | "The terms governing use of SquareShare in the European Union, the United States and Canada, ..." | **YES** |
| Terms tos-2026-11-06 subtitle | Home/src/content/legal/terms/tos-2026-11-06.ts:19 | "...your use of Square Share in the European Union, the United States and Canada." | **YES** |
| Terms tos-2026-11-06 intro note | tos-2026-11-06.ts:28 | "**Where we operate.** Square Share operates in the **European Union**, the **United States** and **Canada**. **We do not operate anywhere else yet.**" | **YES** |
| Terms tos-2026-11-06 section 2 "Where we operate" | tos-2026-11-06.ts:74-137 | Table of regions (EU 27 states incl. Czechia at :92; US :97; Canada "with Québec not yet open" :102); "We do not operate in other areas yet" (:109); "Sellers must be resident or established in one of these regions" (:114); "Checkout delivers only to addresses in these regions" (:115); sanctions EU/US/CA (:117); "A Seller's duties follow the Buyer" (:129) | **YES** (this is the territorial clause to replace) |
| Terms tos-2026-11-06 eligibility | tos-2026-11-06.ts:213 | "you meet the location requirement in the **Where we operate** section;" | PARTLY (cross-reference) |
| Terms tos-2026-11-06 tax and reporting duties | tos-2026-11-06.ts:287-288 | "VAT, US sales tax, or Canadian GST/HST"; "EU's DAC7 rules, Canada's reporting rules ... US INFORM Consumers Act" | **YES** |
| Terms tos-2026-11-06 termination ground | tos-2026-11-06.ts:721 | "you are no longer based in a region where we operate; or" | PARTLY |
| Terms tos-2026-11-06 regional parts | tos-2026-11-06.ts:780-788 (s.21), 789-874 (Part A EU), 875-1006 (Part B US, incl. arbitration), 1007-1088 (Part C Canada, incl. GST/HST at :1056) | Whole regional structure for three regions | **YES** (Parts B and C) |
| Terms tos-2026-11-06 price currency | tos-2026-11-06.ts:366-386 | Plans "EUR 0 / EUR 12 / EUR 39"; "charged in euros, so your bank may apply its own exchange rate" | PARTLY (plans in EUR; product prices not addressed) |
| Terms tos-2026-10-31 (published, `replacedBy` tos-2026-11-06, never in force) | Home/src/content/legal/terms/tos-2026-10-31.ts:15, 24, 109, 114-115 | Same EU/US/CA wording as 11-06 | **YES**, but frozen and marked replaced (`Home/src/content/legal/terms/index.ts:27`) |
| Terms tos-2026-10-11 (the version in force) | Home/src/content/legal/terms/tos-2026-10-11.ts:6, 16, 38, 131, 600 | No territorial clause at all. Describes a "pre-launch landing page" with only a waitlist (:16); operator "[... to be finalised upon incorporation], established in the Czech Republic" (:38); Czech law and courts (:600) | PARTLY (silent on territory; stale) |
| Privacy Policy intro | Home/src/content/legal/privacy.ts:11 | "...US state privacy laws, Canada's PIPEDA ... We operate in the European Union, the United States and Canada." | **YES** |
| Privacy Policy US section | privacy.ts:613-690 ("14. United States privacy rights") | CCPA/CPRA rights for all US residents | **YES** (implies US users) |
| Privacy Policy Canada section | privacy.ts:692-708 ("15. Canada") | PIPEDA, OPC, CAI Québec | **YES** |
| Privacy Policy, seller data | privacy.ts:243 | "Seller trader name, postal address, contact email; optionally phone, VAT number and country" | PARTLY (country optional) |
| Cookie Policy US section | Home/src/content/legal/cookiePolicy.ts:354 | "11. Residents of the United States (including California)" | PARTLY |
| Accessibility Statement | Home/src/content/legal/accessibility.ts:74 | "...being built in the **Czech Republic** and intends to serve customers across the EU, the UK, and the US" | **YES** (adds the UK) |
| Pricing section footnote and price line (hidden while the launch switch is off) | Home/src/components/PricingSection.tsx:56, 91-94 | "€{n} a month, excl. VAT"; "The fee is taken from what the buyer pays, delivery included. Card processing by Stripe is charged separately." | PARTLY (EUR) |
| Pricing data | Home/src/content/pricing.ts:17, 22-23 | "Money is euros"; "Per month, in euros, excluding VAT" | PARTLY |
| Live price fetch | Home/src/lib/plan-prices.ts:39-40 | Refuses any list whose `currency !== "EUR"` | PARTLY (a CZK price list would be ignored and the EUR fallback shown) |
| How it works mockup price | Home/src/components/howItWorks/data.ts:63 | `price: "$129.00"` (shown in the animated checkout, `CheckoutFlow.tsx:293, 354, 395`) | **YES** (USD on the homepage) |
| Unused mockup | Home/src/components/StorefrontMockup.tsx:79, 87, 93 | "$49.00", "$199.00", "Checkout $248.00" (component not imported anywhere) | YES but not rendered |
| Hero lead | Home/src/components/hero/parts.tsx:31-32 | "Start taking payments anywhere people find you." | PARTLY ("anywhere" means any website, reads as any place) |
| Footer tagline | Home/src/components/Footer.tsx:117-120 | "Embed a portable storefront anywhere and own your revenue stream." | no (figurative) |
| Founder section | Home/src/components/FounderSection.tsx:61 | "We're four sixteen-year-olds from Europe." | no |
| Footer imprint | Home/src/components/Footer.tsx:230-233 | "SquareShare is operated by Efficontrol s.r.o., ID No. 05159687, Lesnická 795/20, ... Czech Republic." | no (consistent with CZ) |
| Site description (meta, OG, JSON-LD) | Home/src/lib/site.ts:25-26 | "Take payments anywhere and run every sale from one dashboard." | PARTLY ("anywhere") |
| Waitlist modal | Home/src/components/WaitlistForm.tsx:127-133 | "We're not live yet." / "Leave your email and you'll be first in when we open." | no territory statement; conflicts with Store sign-up being open (see 3) |

### 1b. Store (dashboard.squareshare.eu, hosted pages /s/..., embed /e/..., checkout)

i18n: next-intl, catalogue `Store/messages/<locale>/<namespace>.json`, namespace names PascalCase in code (`useTranslations("Auth.login")` reads `messages/<locale>/auth.json` key `login`). Line numbers below are for `messages/en/*.json` unless marked `cs`. Every key exists in all 10 locales (parity test).

**Region statements in copy**

| Surface | File:line | Current text (short) | Contradicts? |
| --- | --- | --- | --- |
| Seller sign-up: eligibility note (signup tab only) | Store/src/components/auth/LoginForm.tsx:183-186, key `Auth.login.signupRegionNote` at messages/en/auth.json:38 (cs:38) | "Open to sellers aged 18+ in the EU, USA and Canada." / cs "Pro prodejce od 18 let v EU, USA a Kanadě." | **YES** |
| Seller sign-up: legal line under the button | LoginForm.tsx:303-320, `Auth.login.signupLegal` auth.json:41 (cs:41) | "By creating an account you confirm you are 18 or over and based in the EU, the USA or Canada, where we operate today. We don't operate anywhere else yet." | **YES** |
| Onboarding Terms step (short version of Terms) | Store/src/components/onboarding/WelcomeFlow.tsx:413-424 renders `TermsSummary`; key list Store/src/lib/legal/terms-summary.ts:35; text settings.json:259 (cs:259) | "Square Share operates in the EU, the USA and Canada. We don't operate anywhere else yet, so you need to be based in one of those places to sell here. Québec has to wait for the French version of these Terms." | **YES** |
| Terms summary: taxes | settings.json:275 | "Taxes on your sales (VAT, GST/HST or sales tax) are yours to handle" | **YES** |
| Terms summary: law and disputes | settings.json:304, 306 | "Czech law applies to business users, except in Canada..."; "Disputes in the USA go to individual arbitration..." | **YES** |
| Terms notice ("what is changing" in tos-2026-11-06) | Store/src/lib/legal/terms-changes.ts:11-20; settings.json:320, 321, 325 (cs:320) | "We now operate only in the EU, the USA and Canada, and each has its own section."; US arbitration; "The US and Canada sections..." | **YES** |
| Settings › Business: country hint | settings.json:378 (cs:378), rendered TaxSection.tsx:371 | "Where your business is based, shown to buyers with your name. Square Share operates in the EU, the USA and Canada." | **YES** |
| Settings › Business: country picker options | Store/src/components/settings/TaxSection.tsx:168-178 (options), 361-371 (field); list from Store/src/lib/format/country.ts:69-78 over `OPERATING_COUNTRIES` | "Not set" plus 27 EU states, US, CA. Code comment :169-171: "the US and Canada are on the list" | **YES** |
| Settings › Business: address placeholder | settings.json:362; onboarding.json:130 | "e.g. 12 Market Street / Dublin, D02 X285 / Ireland" (cs uses "Tržní 12, 110 00 Praha 1, Česká republika") | **YES** in en (Irish example) |
| Settings phone restriction | settings.json:385; validation.json:390 | "EU, EEA, Switzerland and UK mobile numbers only."; "We can only confirm phone numbers in the EU, the EEA, Switzerland and the UK." (from `SMS_REGIONS`, Store/src/lib/contact-verification/policy.ts:41-55) | **YES** (wider than CZ, and different from the operating list) |
| Phone examples | validation.json:388; errors `contactVerification.phoneNeedsResave`; productPage checkout `errors.phone` | "+353 87 123 4567" (Irish) in en; cs uses "+420" | PARTLY |
| Settings › Shipping: destinations tip | settings.json:453 | "one row for home, one for the rest of the EU, one for everywhere else is plenty." | **YES** |
| Settings › Shipping: area placeholder | settings.json:457 | "e.g. Rest of EU" | **YES** |
| Settings › Shipping: catch-all destination | settings.json:466; Store/src/components/settings/CountryPicker.tsx:33-41 | "Everywhere else" (`SHIP_ANYWHERE` "*") then all 29 `SHIPPING_COUNTRY_CODES` | **YES** |
| Settings › Shipping: cost example and rate currency | settings.json:454 ("such as “€9.00”"), 476 ("Rate currency"); ShippingSection.tsx:147 (options = `CURRENCIES` EUR, USD), :203 (default EUR) | EUR/USD choice | **YES** (no CZK) |
| Settings › Shipping: ships-from validation | validation.json:550; Store/src/lib/validation/shipping-policy.ts:71-76 | "That is not a country we can ship from yet." (accepts any `OPERATING_COUNTRY_CODES`) | **YES** (list is EU+US+CA) |
| Settings › Shipping: returns tip | settings.json:492, 495 | "Selling to EU buyers at a distance gives them 14 days..."; "The EU legal minimum" | PARTLY |
| Product form: currency | Store/src/components/products/PriceField.tsx:118 (options `CURRENCIES`); ProductForm.tsx:261 default "EUR"; ProductImport.tsx:85, 361 | EUR or USD | **YES** |
| Product default currency guess | Store/src/lib/predictions.ts:250-256 | `DOLLAR_COUNTRIES = ["US", "CA"]` -> USD, everything else -> EUR (a CZ seller is guessed EUR) | **YES** |
| Product form: safety prompts | products.json `form.safetyPrompt`, `safetyFields.responsibleNameHint` | "Shipping to EU buyers? Add the maker's details..."; "Only when the manufacturer is outside the EU." | PARTLY |
| Discounts | discounts.json `form.value.currencyHint` | "Applies only to products priced in this currency." | PARTLY (multi-currency) |
| Payments | payments.json `earnings.otherCurrencies` | "In {currency}. Sales in other currencies are not counted here." | PARTLY |
| /plans page fine print | Store/src/components/billing/PlansPage.tsx:198; billing.json:32, 37 | "Prices exclude VAT. ... Stripe's own card processing fees come on top." | PARTLY (EUR, VAT) see section 5 |
| /plans calculator | billing.json:77; CostExplorer.tsx:63-64 (`BILLING_CURRENCY`) | "Your sales per month, in euros" | PARTLY |
| Plan billing currency | Store/src/lib/billing/plans.ts:38-39 | `/** ... EU platform, EU sellers. */ BILLING_CURRENCY = "EUR"` | PARTLY |

**Buyer-facing (hosted product page, checkout, embed)**

| Surface | File:line | Current text (short) | Contradicts? |
| --- | --- | --- | --- |
| Checkout country list | Store/src/components/checkout/CheckoutView.tsx:135-149; validation Store/src/lib/validation/checkout.ts:41 (`z.enum(SHIPPING_COUNTRY_CODES)`); cart Store/src/lib/cart/route.ts:48 | Seller's named countries plus, if the seller picked "Everywhere else", all 29 platform countries | **YES** |
| Checkout country field | Store/src/components/checkout/CheckoutForm.tsx:650-666 | A select when more than one country, plain text when exactly one (:661-665) | no (renders what policy allows) |
| Checkout region field label | productPage.json `checkout.fields.region` | "County, state or region" (cs "Kraj nebo region") | PARTLY (US/IE wording) |
| Checkout summary | CheckoutForm.tsx:769; productPage.json:249 | "Delivery to {country}" | no |
| Checkout refusal | productPage.json:291 | "{seller} doesn't deliver to that country." | no |
| Checkout currency refusal | productPage.json `checkout.errors.currency`; `cart.problem.currency` | "Everything in one order has to be paid in one currency" | PARTLY (multi-currency) |
| Trust lines beside buy and pay buttons | Store/src/components/product-page/TrustList.tsx:16-42; used ProductPageView.tsx:231-238, 722 and CheckoutView.tsx:124-130, 276 | First sentence of the seller's own shipping prose, returns, EU rights | depends on seller prose |
| Shipping prose on product page | productPage.json:194-202 (`ProductPage.shippingProse`); assembled in `Store/src/lib/shipping/policy-prose.ts` via `resolveProductShipping` (ProductPageView.tsx:145) | "Ships from {country}."; "{area}: {time}" where `area` is seller free text (e.g. "Rest of EU", "Everywhere else") | **YES** when a seller's areas say so |
| EU rights row | productPage.json:39-40, 99-101; CheckoutView.tsx:198-206; StatutoryNotes | "EU buyers: 14 days to change your mind, and a 2-year guarantee." | PARTLY ("EU buyers" implies non-CZ buyers) |
| Seller line | CheckoutView.tsx:186-189; productPage.json:275 | "Sold by {seller}, {country}" | no |
| Embed frame footer | Store/src/components/storefront-page/EmbedFrameView.tsx:91-124 | "Sold by ..." · "Powered by Square Share" · Privacy · Report. No delivery statement. | no (nothing about delivery) |
| Hosted page footer | Store/src/components/product-page/PoweredByFooter.tsx:143, 177, 221-225 | Seller-is-party disclosure, Powered by, policies, withdrawal link | no |
| Structured data | Store/src/lib/seo/structured-data.ts:103 | `priceCurrency: product.currency` (no shippingDetails, by design :54-56) | no |

**Constants that drive all of the above**

| Constant | File:line | Value |
| --- | --- | --- |
| `EU_COUNTRIES` | Store/src/lib/settings/constants.ts:72-100 | 27 EU states (CZ at :78 "Czechia") |
| `OPERATING_COUNTRIES` | constants.ts:104-116 | Doc comment: "WHERE SQUARE SHARE OPERATES: the EU, the USA and Canada, and nowhere else yet. ... The Terms of Service say the same (Home: src/content/legal/terms.ts...)" (that Home path no longer exists; Terms are now per-version files) |
| `SHIPPING_COUNTRY_CODES` | constants.ts:129-136 | 27 EU codes + "US", "CA" |
| `SHIP_ANYWHERE` | `Store/src/types/shipping-policy.ts` | "*" ("Everywhere else") |
| `CURRENCIES` | Store/src/types/product.ts:11-12 | `["EUR", "USD"]` ("EUR is primary, USD secondary, per our market focus.") |
| `SMS_REGIONS` | Store/src/lib/contact-verification/policy.ts:48-55 | EU + IS, LI, NO, CH, GB |
| `countryName` | Store/src/lib/format/country.ts:33-37 | Names only EU codes; US and CA fall back to the raw code in pickers |

### 1c. Docs (docs.squareshare.eu)

Two locales, `en` and `cs` (`Docs/lib/i18n.ts:3`), MDX per locale under `Docs/content/docs/<locale>/`, paired by `translationKey` frontmatter; UI strings in `Docs/lib/copy.ts` and `Docs/lib/ui-translations.ts`.

| Surface | File:line | Current text (short) | Contradicts? |
| --- | --- | --- | --- |
| What is SquareShare | Docs/content/docs/en/(getting-started)/what-is-square-share.mdx:43; cs Docs/content/docs/cs/(zaciname)/co-je-square-share.mdx:42 | "To sign up you must be 18 or over and based in the EU, the USA, or Canada." / "...bydliště v Evropské unii, USA nebo Kanadě." | **YES** |
| Set up SquareShare | en (getting-started)/set-up-square-share.mdx:28; cs (zaciname)/nastaveni-square-share.mdx:29 | "...based in the EU, the USA or Canada. SquareShare does not operate anywhere else yet." | **YES** |
| Payments: "Which currencies and countries work?" | en payments-and-payouts/index.mdx:36-44; cs platby-a-vyplaty/index.mdx:37-45 | Product prices "Euro (EUR) or US dollar (USD)"; Plan billing "Euro"; Sellers "based in the EU, the USA or Canada"; "Québec has to wait..." | **YES** (the natural home for R7 in Docs) |
| FAQ: who can sell | en reference/faq.mdx:34; cs reference/caste-dotazy.mdx:35 | "Sellers who are 18 or over and based in the EU, the USA or Canada." | **YES** |
| Sell without an online shop | en selling/sell-without-online-shop.mdx:56; cs prodej/prodej-bez-e-shopu.mdx:57 | "You must be 18 or over and based in the EU, the USA or Canada." | **YES** |
| Shipping and returns | en products-and-storefronts/shipping-and-returns.mdx:52; cs produkty-a-vylohy/doprava-a-vraceni.mdx:53 | "One row for your own country, one for the rest of the EU and one for everywhere else" / "...jeden pro zbytek EU a jeden pro zbytek světa" | **YES** |
| Add a product | en products-and-storefronts/add-a-product.mdx:21, 84; cs produkty-a-vylohy/pridani-produktu.mdx:22 | "choose the currency (EUR or USD)" | **YES** |
| Pricing | en pricing/index.mdx:12, 36, 42, 69-75, 93-95, 104; cs ceny/index.mdx:13, 37, 43, 70-76, 94-96, 105 | All amounts in €; "Plans are billed monthly, in euros." | PARTLY (EUR, VAT, see 5) |
| Choose a plan | en pricing/choose-a-plan.mdx:4, 12, 25-52 | Break-even tables in € | PARTLY |
| VAT and taxes | en payments-and-payouts/vat-and-taxes.mdx:4, 12, 28-39; cs platby-a-vyplaty/dph-a-dane.mdx:40 | OSS €10,000 threshold for sales "to consumers in other EU countries"; cs mentions the Czech 2,000,000 Kč threshold | PARTLY (assumes cross-border EU sales) |
| Sell digital products in the EU / Gumroad alternative for EU sellers | en selling/sell-digital-products-in-the-eu.mdx:2-4, 45-47; en selling/gumroad-alternative-for-eu-sellers.mdx:2, 39-42 (cs equivalents prodej/prodej-digitalnich-produktu-v-eu.mdx, prodej/alternativa-ke-gumroadu-pro-prodejce-v-eu.mdx) | Pages pitched at sellers anywhere in the EU, and "Sellers based outside the EU use its non-Union scheme" | **YES** (positioning) |
| Product safety | en products-and-storefronts/product-safety-information.mdx:12, 38 | "an EU responsible person when the manufacturer is outside the EU" | no (law description) |
| llms.txt summary | Docs/lib/llms.ts:82 | "Operated by Root Labs in Brno, Czech Republic." | no territory claim; wrong operator (see 6) |
| "Get started" buttons | Docs/lib/site.ts:26-32 (`WAITLIST_URL` = Home homepage); used in Docs/components/SiteHeader.tsx:57, HeaderActions.tsx:161, 175, app/[lang]/layout.tsx:55 | Send readers to Home's waitlist modal, while the same Docs pages tell them to "Create an account at dashboard.squareshare.eu" | messaging conflict |

### 1d. App (marketplace SPA) and SQ-system

| Surface | File:line | Current text | Contradicts? |
| --- | --- | --- | --- |
| App: any region, price or currency copy | App/src (grep for country names, EU, currency symbols, "price", "ship", "deliver") | None found. App shows no prices. `index.html:2` `lang="en"`; description "Curate the things you love on a personal grid." (:7) | no |
| App privacy page | App/src/components/PrivacyPolicyPage.tsx:25, 72-73, 85 | Short own policy, no operator, no territory; "contact us through the Help tab" | no territory claim; no operator (see 6) |
| SQ-system cookie policy source | System/docs/legal/cookie-policy.md:118, 147 | US transfers; "11. Residents of the United States (including California)" | PARTLY (source doc, mirrored into Home) |
| SQ-system pricing contract | System/packages/pricing/src/plan-price.ts:33 | `currency: z.string().regex(/^[A-Z]{3}$/)` (any ISO code allowed) | no |
| SQ-system consent banner defaults | System/packages/consent/src/react.tsx:93-108 | English only ("Cookies on Square Share") | language gap (see 4) |

---

## 2. Where R7 text must be added, and how each surface is translated

R7 text: "Currently available to sellers established in the Czech Republic, with delivery within the Czech Republic. We plan to expand to other EU countries." Checkout variant: "Delivery within the Czech Republic only".

| Surface | Exact component / content file | i18n mechanism | Notes |
| --- | --- | --- | --- |
| Home homepage | Candidates: `Home/src/components/hero/parts.tsx:29-35` (`Lead`); `Home/src/content/faq.ts:14-53` (add an item; it also feeds the FAQPage JSON-LD in `Home/src/app/page.tsx:19-27`); waitlist modal copy `Home/src/components/WaitlistForm.tsx:127-133`; footer tagline `Home/src/components/Footer.tsx:117-120`; meta `SITE_DESCRIPTION` `Home/src/lib/site.ts:25-26` | **None.** Hard-coded English. No locale routing, no message catalogue, `lang="en"` fixed in `layout.tsx:174` | A Czech homepage would need a new mechanism (Home has no i18n at all). |
| Home pricing | `Home/src/components/PricingSection.tsx` (footnote at :91-94 is the natural place); data `Home/src/content/pricing.ts`; FAQ answer "What does it cost?" `faq.ts:40-45` | None (English literals) | **Not rendered today**: shown only when `SELLER_SIGNUP_OPEN` (`Home/src/app/page.tsx:53`, header link `Header.tsx:14`). The switch is commented out in `Home/.env.production` (line present only as a comment; not set). So "homepage/pricing" today means the FAQ and hero only. |
| Home legal: Terms (seller terms) | Territory today: `tos-2026-11-06.ts:19` (subtitle), `:26-29` (intro note), `:74-137` (section 2), `:213`, `:721`, `:780-1088` (regional parts). New text goes in a **new version file** | Not translated; English only | Recipe (Store/docs/changing-the-terms.md:5-14, Home/scripts/terms-version.mjs:16-36): `npm run terms:new` in Home (copies newest to `src/content/legal/terms/tos-<today>.ts` and appends it to `index.ts`), edit it and its `lastUpdated`, `npm run terms:freeze` (adds the hash to `frozen.json`; `check-terms-frozen.mjs` in prebuild refuses edits to published versions), then in Store add it to `TERMS_VERSIONS` (`Store/src/lib/legal/terms-versions.ts:32-35`), add its change bullets to `TERMS_CHANGES` (`Store/src/lib/legal/terms-changes.ts:11-20`) with wording under `Settings.legal.notice.changes.*` in all 10 `messages/*/settings.json`, update the short version (`Store/src/lib/legal/terms-summary.ts`, key `parties.points.regions` settings.json:259). Deploy Home first, then Store. A version never emailed and never agreed to may instead be replaced (`replacedBy`, changing-the-terms.md:48-56). |
| Home legal: which version is current | `Home/src/lib/terms.ts:22-53`: in force = the latest version whose `terms_versions.effective_at` has passed; fallback (table unreadable) = first version, `tos-2026-10-11`. `Home/src/app/terms/page.tsx:30-60` shows a "New Terms are on their way" banner for the next one. Store `LEGAL_VERSION` = newest listed = **tos-2026-11-06** (`terms-versions.ts:38`, `constants.ts:14`): every new sign-up agrees to the EU/US/CA text. | n/a | Per the memory note terms-notice-system (2026-11-20, unverified here): prod `terms_versions` holds only `tos-2026-10-11`, so `/terms/` shows tos-2026-10-11 with the banner for tos-2026-11-06 (no date, mail is off: `TRANSACTIONAL_EMAIL_ENABLED` is absent from `Store/wrangler.jsonc` vars :39-66). |
| Home legal: other pages naming territory | Privacy `privacy.ts:11` (plus US/Canada sections :613-708); Accessibility `accessibility.ts:74`; `/terms/` meta `terms/page.tsx:12-13` | English only | These are notices, not versioned contracts (changing-the-terms.md:60); edit in place. |
| Store seller sign-up | `Store/src/components/auth/LoginForm.tsx:183-186` (eligibility note, signup tab) and `:303-320` (legal line); page `Store/src/app/(auth)/login/page.tsx` (`?mode=signup`) | next-intl, `Auth.login.signupRegionNote` and `Auth.login.signupLegal` in `messages/<10 locales>/auth.json:38, 41`; route group client scope in `Store/src/i18n/scopes.ts` | The two existing keys are exactly where R7 belongs. No country field exists. |
| Store onboarding | `Store/src/components/onboarding/WelcomeFlow.tsx:413-424` (Terms step: `TermsSummary`), `:427-487` (seller step: name, address, email; no country) | next-intl, `Settings.legal.termsSummary.*` and `Onboarding.welcome.*` (`messages/*/onboarding.json`, address placeholder :130) | A country question (for the R8 block) would go in the seller step or before it. |
| Store settings country picker | `Store/src/components/settings/TaxSection.tsx:168-178, 361-371` on `/settings/business` (`Store/src/app/settings/business/page.tsx`); ships-from select `Store/src/components/settings/ShippingSection.tsx:118, 160`; destination picker `CountryPicker.tsx:33-41` | next-intl `Settings.tax.fields.country.hint` (settings.json:378), `Settings.shipping.*` (settings.json:437-476); country names via `Intl.DisplayNames` (`Store/src/lib/format/country.ts`) | Options come from `OPERATING_COUNTRIES` / `SHIPPING_COUNTRY_CODES` (constants.ts:110-136). |
| Store checkout ("Delivery within the Czech Republic only") | Delivery fieldset `Store/src/components/checkout/CheckoutForm.tsx:542-666`, beside the country field `:650-666` (with one country it already renders plain text at `:661-665`, the obvious slot for the line); trust badges under the pay button built by `buildTrustLines` (`Store/src/components/product-page/TrustList.tsx:16-42`, called at `CheckoutView.tsx:124-130`); legal block `CheckoutView.tsx:179-244` | next-intl `ProductPage.checkout.*` (`messages/*/productPage.json`, en block :203-322) | Delivery facts are rendered by `TrustList` (checkout and product buy box) and the shipping prose (`ProductPage.shippingProse`, productPage.json:194-202). |
| Store product page | Buy-box trust list `ProductPageView.tsx:231-238, 722`; shipping section via `resolveProductShipping` `ProductPageView.tsx:145` | next-intl `ProductPage.trust.*`, `ProductPage.shippingProse.*` | Same `buildTrustLines` as checkout, so one new line reaches both. |
| Store embed | `Store/src/components/storefront-page/EmbedFrameView.tsx:91-124` (one-line footer); frame route `Store/src/app/(public)/e/[key]/[...sites]/page.tsx` | next-intl `ProductPage.*` keys (the frame uses `useTranslations("ProductPage")`, :41) | The frame has no delivery statement today; the purchase button is a plain link to the product page (covered above). |
| Docs regions / shipping / payments | `Docs/content/docs/en/payments-and-payouts/index.mdx` and `Docs/content/docs/cs/platby-a-vyplaty/index.mdx` ("Which currencies and countries work?" en:36-44, cs:37-45); `.../what-is-square-share.mdx` en:43 / `co-je-square-share.mdx` cs:42; `set-up-square-share.mdx` en:28 / `nastaveni-square-share.mdx` cs:29; `reference/faq.mdx` en:34 / `caste-dotazy.mdx` cs:35; `selling/sell-without-online-shop.mdx` en:56 / `prodej-bez-e-shopu.mdx` cs:57; `products-and-storefronts/shipping-and-returns.mdx` en:52 / `doprava-a-vraceni.mdx` cs:53; `add-a-product.mdx` en:21 / `pridani-produktu.mdx` cs:22 | One MDX file per locale, paired by `translationKey` | No Docs page is dedicated to regions; the payments table is the closest. |

---

## 3. Waitlist

### What exists

| Item | Where | Detail |
| --- | --- | --- |
| UI | Home/src/components/WaitlistModal.tsx:66-143 (one modal for all "Get started" buttons, placements `nav`, `hero`, `footer`, `faq`, `reserve` at :21); form Home/src/components/WaitlistForm.tsx:28-298 | Title "We're not live yet." / "Leave your email and you'll be first in when we open." (:127-133). Fields: **Email** (required, :158-179), **What do you sell? (Optional)** (:181-200, max 200), hidden honeypot checkbox (:145-156). Button "Save my spot" (:209). Success "You're on the list." (:290). |
| Consent text on the form | WaitlistForm.tsx:112-223 | **None**: no consent sentence, no privacy link, no checkbox. |
| Endpoint | Home/src/app/api/waitlist/route.ts:62-101 | Rate limited (`RATE_LIMITERS.waitlist`, :63); validates email (:11, :24); honeypot = silent success (:77-79); inserts `{ email, source }` only (:84-86); duplicate -> 409 "This email is already on the waitlist!" (:91-92, WaitlistForm.tsx:93-94). The optional "What do you sell?" answer is sent (WaitlistForm.tsx:86) but **discarded** by the route (comment WaitlistForm.tsx:31). |
| Source value | WaitlistModal.tsx:125-128 | `homepage-<placement>-buy-intent` |
| Table | `public.waitlist_signups` (columns `id, email, source, owner_id, list_id, created_at`), Store/src/types/supabase.ts:2934-2959 | **No country column.** |
| Creation migration | No migration file in any repo. The prod history is reproduced in Store/tests/db/prod-migrations.sql:1154-1167 (`-- ===== 20260707102628 waitlist_signups`) and the unique `lower(email)` index at :1192-1193 (`20260707121316`) | RLS: insert for anon/authenticated; "no read policies: admin reads via service_role only." |
| Later hardening | Store/supabase/migrations/20260807_db_hygiene.sql:27-54 (insert policy pinned to `owner_id is null and list_id is null`, email <= 254, source <= 64); Store/supabase/migrations/20261105_write_bounds.sql:116-150 plus trigger at tests/db/prod-migrations.sql:13165-13168 (60 anonymous inserts per minute platform-wide) | |
| Click counter | Home/supabase/migrations/20260925_purchase_intent_clicks.sql:9-23; WaitlistModal.tsx:41-60 | One anonymous row per page load (`source` only). |
| Emails sent | Home/src/app/api/waitlist/route.ts:33-60 | The code sends **no email itself**. It forwards `{ name: "", email, source, honeypot: false }` to an n8n webhook (`N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`) after the insert. What n8n does (welcome mail, list sync) is not in any repo. |
| What the legal texts say about it | Privacy Home/src/content/legal/privacy.ts:75-79 ("(a) Waitlist email ... We use it to keep you informed about Square Share's launch and updates"), :227-229 (purpose "launch and product **marketing** communications", basis "**Consent** (Art. 6(1)(a)), given when you submit the waitlist form"), :401-402 (retention: until unsubscribe or 24 months after launch), :449 (withdraw consent); Terms tos-2026-10-11.ts:157-161 ("the only personal data we collect is your **email address**") | The privacy text relies on consent that the form never asks for in words. |
| Docs | Docs/lib/site.ts:26-32 | "Get started" in Docs points at the Home homepage, i.e. this waitlist. |
| Store | Store/src/app/(auth)/login/page.tsx:120-122 | Comment: sign-up is open; the link "used to say 'Request access' and leave for a waitlist on another domain." No waitlist in Store. |

### Does it capture country?

No. Neither the form, the endpoint, nor the table has a country field.

### Is there any "not available in your country" block in seller sign-up today?

No.

- Sign-up (`LoginForm.tsx`) asks for email (or username), password, Turnstile; no country. It shows the EU/US/CA note (:185) and the confirmation line (:308), nothing enforces it.
- The welcome flow seller step asks name, address, email (`WelcomeFlow.tsx:427-487`), no country.
- Settings country is optional, with "Not set" as the first option (`TaxSection.tsx:169-178`; settings.json:346 "Not set").
- The publish gate (`Store/src/lib/settings/seller-identity.ts:128-132`, fields `Store/src/lib/settings/trader-identity.ts:76-94`) checks business name, address, email and email proof only, not country.
- `cf-ipcountry` is read only to preselect the checkout delivery country (`Store/src/app/(public)/s/[storefrontId]/checkout/page.tsx:62`, `.../p/[productId]/checkout/page.tsx:102`) and to label sign-in approvals (`Store/src/lib/auth/device-label.ts:47-50`). No geo block anywhere.
- No message key resembling "not available in your country" exists in `messages/en`.

---

## 4. Czech language

### Locales per repo

| Repo | Locales | Mechanism | Source |
| --- | --- | --- | --- |
| Home | en only | none (hard-coded) | Home/src/app/layout.tsx:174 |
| Store | en, cs, de, fr, es, it, nl, pl, pt-PT, sk (default en) | next-intl, no locale routing; cookie `ss_locale`, then `Accept-Language`, then English | Store/src/i18n/locales.ts:19-34; Store/src/i18n/request.ts:41-45 |
| Docs | en, cs | Fumadocs, `/[lang]/` routes, MDX per locale | Docs/lib/i18n.ts:3 |
| App | en only | none | App/index.html:2 |
| SQ-system consent banner | English defaults, labels overridable | props | System/packages/consent/src/react.tsx:93-108 (Home overrides only `description`, Home/src/components/ConsentRoot.tsx:50-52) |

### Store: messages/cs.json vs messages/en.json

Counted with a read-only node one-liner over `messages/<locale>/*.json` (20 namespace files per locale; "top-level keys" = keys directly under each file, summed).

| | en | cs |
| --- | --- | --- |
| Namespace files | 20 | 20 |
| Top-level keys (sum over files) | 370 | 370 |
| Leaf keys | 5,762 | 5,762 |
| Missing in cs vs en | n/a | **0** |
| Extra in cs | n/a | 0 |
| Values identical to English (containing letters) | n/a | 63 (mostly ICU placeholders such as `{message}`, brand and plan names "Free/Starter/Pro", card brands; a few genuine English leftovers such as `products.buyButton.method.agent` "AI agent", `products.removal.reference` "Reference", `products.import.story.items.headphones` "Headset") |

Per namespace (top / leaves), identical in both: analytics 18/180, auth 13/150, billing 15/259, common 16/91, dashboard 9/90, discounts 10/123, errorPage 4/12, errors 36/518, localeSwitcher 5/5, nav 4/39, notifications 11/117, onboarding 8/167, orders 20/250, payments 15/96, productPage 32/419, products 30/1001, search 7/60, settings 16/652, storefront 73/1169, validation 28/364. All nine other locales also have 5,762 leaves.

The Czech catalogue was produced by agents (memory note bulk-translation-recipe), not reviewed by a lawyer or a professional translator as far as the repo shows.

Buyer pages follow the buyer's browser (`request.ts:41-45`), so a Czech browser gets the Czech product page and checkout; buyer emails use the locale stored on the order (`Store/src/lib/orders/confirmation.ts:74`).

### Legal texts in Czech (Home)

| Text | Czech version? | Where |
| --- | --- | --- |
| Terms of Service (all three versions) | **No**, English only | Home/src/content/legal/terms/*.ts |
| Privacy Policy | **No** | Home/src/content/legal/privacy.ts |
| Cookie Policy | **No** | Home/src/content/legal/cookiePolicy.ts |
| Accessibility Statement | **No** | Home/src/content/legal/accessibility.ts |
| Imprint | No page; one English line in the footer | Home/src/components/Footer.tsx:230-233 |
| Cookie banner | **No** (English defaults) | System/packages/consent/src/react.tsx:93-108 |
| Short version of the Terms (Store, seller-facing) | **Yes**, Czech | Store/messages/cs/settings.json:248-306 (`legal.termsSummary`), notice bullets :311-325; but it summarises the EU/US/CA text and links to the English full Terms |
| Docs legal links | Czech labels, English targets | Docs/lib/legal.tsx:10-17 ("Obchodní podmínky" -> https://squareshare.eu/terms/, "Ochrana osobních údajů" -> English privacy page) |
| Store legal links | All point to the English Home pages | Store/src/lib/legal/links.ts:39-64 |

tos-2026-11-06 promises a point of contact "in English and Czech" (tos-2026-11-06.ts:843) while offering no Czech text.

### Checkout statutory texts in Czech (Store)

All present in `Store/messages/cs/productPage.json` (en line in brackets):

| Text | cs line | Czech wording (short) |
| --- | --- | --- |
| Pay button | 394 (en 278) | "Objednávka zavazující k platbě ({amount})" |
| Withdrawal information (goods) | 99 (en 99) | "Od této kupní smlouvy můžete odstoupit bez udání důvodu do 14 dnů od převzetí zboží..." |
| Withdrawal, downloads | 100 (en 100) | "U obsahu ke stažení právo odstoupit od smlouvy zaniká..." |
| Legal guarantee | 101 (en 101) | "Podle práva EU odpovídá prodávající nejméně 2 roky..." |
| EU rights summary rows | 39-40 (en 39-40) | "14 dní na rozmyšlenou a 2 roky na uplatnění práv z vadného plnění." |
| Digital consent checkbox | 390 (en 274) | "Chci stáhnout okamžitě a chápu, že ztratím právo na odstoupení..." |
| Seller identity line | 391 (en 275) | "Prodává {seller}, {country}" |
| Platform-is-not-party disclosure | 104 (en 104) | "Prodávajícím u této objednávky je ... Square Share ... není smluvní stranou kupní smlouvy." |
| Platform Terms assent | 437 (en 321) | "Objednáním zároveň přijímáte Podmínky Square Share..." (links to the English Terms) |
| "incl. VAT" | 368 (en 252) | "vč. DPH" |
| Order page withdrawal function, confirmation email withdrawal text, withdrawal acknowledgement emails | `productPage.order.withdraw.*`, `orders.email.confirmation.withdrawal*`, `orders.email.withdrawal.*` | present in cs |

Pre-contract information is assembled from the seller block (identity, address, email, optional phone, VAT ID, country), shipping prose, totals and the statutory notes, all keyed and present in cs. No model withdrawal form text (CRD Annex I(B)) was found in the catalogue; a withdrawal button on the order page exists instead.

### Docs Czech content

52 Czech MDX pages, 52 English (`find content/docs/<locale> -name "*.mdx"`), one-to-one by `translationKey`. Czech pages repeat the EU/USA/Canada statements (section 1c).

---

## 5. Pricing and fee disclosure

Context: plans priced in EUR (Free 5%, Starter EUR 12 + 2%, Pro EUR 39 + 0.5%); the operator is not VAT-registered.

| Surface | File:line | Currency | VAT statement | Platform fee on refund | Stripe processing fees |
| --- | --- | --- | --- | --- | --- |
| Home pricing section (hidden; launch switch off) | Home/src/components/PricingSection.tsx:49-56, 91-94; Home/src/content/pricing.ts:22-23, 35-69; live numbers from Store `/api/billing/plan-prices` via Home/src/lib/plan-prices.ts:21, 39-40 | EUR ("€12 a month") | "excl. VAT" (:56) | not mentioned | "Card processing by Stripe is charged separately." (:92-93) |
| Home FAQ | Home/src/content/faq.ts:40-45 | none (pre-launch answer "Pricing will be set at launch.") | none | none | none |
| Store /plans | Store/src/components/billing/PlansPage.tsx:198; PlanCard.tsx:69, 126; PlanComparison.tsx:146-149; CostExplorer.tsx:63-64, 164; `BILLING_CURRENCY` Store/src/lib/billing/plans.ts:39; seed Store/src/lib/billing/pricing-seed.ts:23-57 | EUR | billing.json:32 "Prices exclude VAT."; :41 "excl. VAT"; :134-137 FAQ "prices are shown without VAT, which is added at checkout where it applies. Add your VAT ID at checkout and it appears on every invoice."; :180 settings price line "excl. VAT" | **not mentioned** | billing.json:32 "Stripe's own card processing fees come on top."; :83 calculator note; :140 FAQ |
| Store subscription checkout | Store/src/lib/billing/stripe-provider.ts:187-190 | EUR | `automatic_tax: { enabled: true }`, `tax_id_collection` ("Stripe Tax works out the rate (or the reverse charge...)") | n/a | n/a |
| Store public price list | Store/src/app/api/billing/plan-prices/route.ts:47 | `currency: BILLING_CURRENCY` (EUR) | n/a | n/a | n/a |
| Store /plans soon state | billing.json:31 | "Paid plans open soon. Everything on Free keeps working in the meantime." | | | |
| Store Terms summary | settings.json:282 | | | "We take a platform fee on each sale, as shown in your dashboard." | |
| Terms tos-2026-11-06 s.9 | tos-2026-11-06.ts:336-427 | EUR table :366-381; "charged in euros" :386 | "Prices exclude taxes, which are added where the law requires" :386; Canada GST/HST :1056 | :426 "the platform fee is handled in accordance with the then-current fee policy shown in your Dashboard" (no such policy is shown in the dashboard); :404 plan-period refunds: none except where the law says otherwise | :387 "Stripe's own processing fees are separate and charged by Stripe." |
| Terms tos-2026-11-06 status note | tos-2026-11-06.ts:32, 340 | | | | "Card payments through Stripe, paid plans and per-sale fees are not switched on yet" |
| Terms tos-2026-10-11 (in force) | tos-2026-10-11.ts:290 | none | none | none | "Stripe's own processing fees are separate"; fee shown as the placeholder "**[fee %]**" |
| Docs pricing | Docs/content/docs/en/pricing/index.mdx:12, 36, 42, 69-81, 85, 104; cs ceny/index.mdx:13, 37, 43, 70-81, 86, 105 | EUR ("Plans are billed monthly, in euros.") | "before VAT"; :104 "Prices exclude VAT. VAT is added at checkout where it applies. Add an EU VAT ID at checkout and your invoices show the reverse charge instead." | :80 "**A refund returns it.** ... all of it for a full refund, the same proportion for a partial one." (matches code: `refund_application_fee: true`, Store/src/lib/orders/actions.ts:482) | :85 "Stripe charges its own card processing fee on each payment. SquareShare adds nothing to Stripe's rate." |
| Docs choose a plan | Docs/content/docs/en/pricing/choose-a-plan.mdx:4, 12, 25-52 | EUR | "before VAT and Stripe's fee" | | |
| Docs payments | Docs/content/docs/en/payments-and-payouts/index.mdx:20, 26-28, 40-41 | EUR plans; products EUR or USD | "a month before VAT" | | "Stripe's rates depend on your country and the buyer's card" |
| Docs early-access offer | Docs/content/docs/en/pricing/index.mdx:24-30 | | | | "Pro free for six months" (TODO :16 says it is not in code) |

Contradictions with the operator not being VAT-registered: Home PricingSection.tsx:56, Store billing.json:32, 41, 43, 55-56, 134-137, 180, Stripe `automatic_tax` (stripe-provider.ts:189), Docs pricing/index.mdx:104 (reverse charge) and cs ceny/index.mdx:105. Under a CZ-only beta with CZK product prices, the EUR plan prices and EUR-only Home fetch (plan-prices.ts:40) are a separate decision to confirm.

---

## 6. Where the operator or a contact point is named

| Surface | File:line | What it says |
| --- | --- | --- |
| Home operator constant | Home/src/lib/site.ts:33-43 | `OPERATOR` = Efficontrol s.r.o., ID 05159687, Lesnická 795/20, Černá Pole, 613 00 Brno, Czech Republic, Commercial Register Regional Court in Brno C 93576 |
| Home contact mailbox | Home/src/lib/site.ts:28-31 | `SITE_EMAIL = "office@squareshare.eu"` |
| Home footer | Home/src/components/Footer.tsx:168-177 (Contact mailto), :207 ("© 2026 Efficontrol s.r.o. All rights reserved."), :230-233 (imprint line) | Efficontrol, office@ |
| Home JSON-LD | Home/src/app/layout.tsx:122-142 | Organization name "SquareShare", email office@; no legal name, no address |
| Home cookie banner | Home/src/components/ConsentRoot.tsx:35-37, 51 | `CONTROLLER_NAME = "SquareShare"` ("Swap for the legal entity once incorporated."): banner says "SquareShare uses cookies..." |
| Terms tos-2026-11-06 | tos-2026-11-06.ts:9-15 (operator, phone +420 773 003 665, copyright agent), :24, :54, :843 (DSA single point of contact office@, "in English and Czech"), :926 (report by email or phone), :1110-1118 (Contact section, operator) | Efficontrol, office@, phone |
| Terms tos-2026-10-11 (in force) | tos-2026-10-11.ts:38, 42, 645-653 | Placeholder "[Square Share, registered legal entity name and registered office in the Czech Republic, to be finalised upon incorporation]"; "Company status ... in the process of incorporation"; office@ |
| Privacy Policy | Home/src/content/legal/privacy.ts:11, 33 (controller identity), 37 (privacy contact office@), 41 (no DPO), 458 (ÚOOÚ as lead authority), 704 (Adrian Edwards, privacy lead; Efficontrol accountable) | Efficontrol |
| Cookie Policy | Home/src/content/legal/cookiePolicy.ts:45 | Efficontrol as controller, office@ |
| Accessibility Statement | Home/src/content/legal/accessibility.ts:86, 186, 205-207 | Efficontrol (micro-enterprise position), office@, Czech authorities |
| Store support mailbox | Store/src/lib/site.ts:10-17 | `SUPPORT_EMAIL = "support@squareshare.eu"`, used by Store/src/components/error/BrandFooter.tsx:60, Store/src/app/global-error.tsx:289, moderation statements (`Store/src/lib/moderation/removal.ts`), 2FA, account deletion emails |
| Store app mail sender / alerts | Store/wrangler.jsonc:42, 46 | `OPS_ALERT_EMAIL` office@, `TRANSACTIONAL_EMAIL_FROM` info@ |
| Store operator name | grep for "Efficontrol", "05159687" over Store/src and messages | **Not named anywhere** in the dashboard, hosted pages, checkout or emails (only "Square Share" as brand, e.g. productPage.json:104) |
| Docs | Docs/content/docs/en/(getting-started)/what-is-square-share.mdx:73 ("SquareShare is operated by Root Labs"); cs co-je-square-share.mdx:74 ("provozovaná společností Root Labs"); Docs/lib/llms.ts:82 ("Operated by Root Labs in Brno, Czech Republic."); Docs/lib/copy.ts:35, 72 (`footerOperator`, defined but not rendered); Docs/components/SiteFooter.tsx:49, 61 ("© 2026 SquareShare"), :253 (Root Labs credit); Docs/lib/site.ts:21 (`CONTACT_EMAIL` office@); troubleshooting pages (en troubleshooting/index.mdx:32-36, storefront-not-showing.mdx:68-72; cs equivalents) | **Root Labs**, contradicting Efficontrol |
| App | App/src/components/PrivacyPolicyPage.tsx:85 | "contact us through the Help tab"; no operator |

---

## 7. What I could not determine

1. **Production Terms state.** Which version `/terms/` serves and whether anyone has agreed to `tos-2026-11-06` depend on `terms_versions` and `profiles.legal_accepted_version` in the database (not queried, by rule). The memory note (2026-11-20) says only `tos-2026-10-11` has a row. Whether `tos-2026-11-06` can still be replaced via `replacedBy` (changing-the-terms.md:50) instead of noticed depends on nobody having agreed to it; Store has offered it as `LEGAL_VERSION` since 153e43f (2026-11-08) and deploys resumed with cc24a25 (2026-11-20), so agreements are likely.
2. **Whether Home's launch switch is set in production.** `NEXT_PUBLIC_SELLER_SIGNUP_OPEN` is only a comment in `Home/.env.production`; it could still be set as a Cloudflare Workers Builds variable (not visible on disk). The analysis assumes it is off (pricing section hidden, waitlist shown).
3. **What the n8n automation does with waitlist sign-ups** (any confirmation or marketing email, its language, any list it feeds). Not in any repo.
4. **Supabase Auth email templates** (sign-up confirmation, magic link) and their language: no `supabase/templates` folder in Store; they live in the Supabase project or Brevo.
5. **Whether consent records exist for waitlist rows**: the form shows no consent text; `consent_logs` covers cookies only.
6. **Quality of the Czech translations**: parity is structural; accuracy of legal wording (pay button, withdrawal text) was not reviewed.
7. **Whether deployed Home, Docs and App match the trees read here** (deploy state not checked).
8. **Stripe account configuration** (Stripe Tax registrations, Connect countries): not readable from disk.
9. **App live status and audience**: the SPA has no region copy; whether it is public was not checked.
