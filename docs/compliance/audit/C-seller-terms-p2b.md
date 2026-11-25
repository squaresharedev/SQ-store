# Audit C: seller terms and P2B surfaces

Audit date: 2026-11-22. Investigation only: nothing was changed, no server, test or build was run, no external service was called. Every finding cites the code on disk. This is not legal advice; where wording is missing the report says what a DRAFT for lawyer review would need to cover.

Repos read: `Home` (branch `homepage-rework`, working tree; its 2 uncommitted files are `.gitignore` and `src/app/globals.css`, neither is legal text), `Store` (main, clean), `Admin`, `Docs`, `App`, `System/SQ-system`. Path prefixes below are `Home:`, `Store:`, `Admin:`, `Docs:`, `App:`.

Related inventory already in this folder tree: `Store:docs/compliance/inventory/06-admin.md` (its findings 5, 6 and the table at lines 214 to 255 agree with section 3 below).

---

## 0. Which Terms are which (read this first)

| Version | Home file | Frozen (hash in `frozen.json`) | Store `TERMS_VERSIONS` | Status |
| --- | --- | --- | --- | --- |
| `tos-2026-10-11` | `Home:src/content/legal/terms/tos-2026-10-11.ts` | yes (`frozen.json:2`) | yes (`Store:src/lib/legal/terms-versions.ts:33`) | **In force** for existing accounts. Seeded as the `baseline` row (`Store:supabase/migrations/20261031_terms_notices.sql:87-89`). Still a template: `"disclaimer": "...a starting template generated for Square Share and should be reviewed by a qualified lawyer before launch"` (`tos-2026-10-11.ts:8`), rendered on the page (`Home:src/components/legal/LegalDocument.tsx:179-180`). Fee is a placeholder `"**[fee %]**"` (`:290`); operator is a placeholder `"[Square Share, registered legal entity name ... to be finalised upon incorporation]"` (`:38`, `:653`). |
| `tos-2026-10-31` | `Home:src/content/legal/terms/tos-2026-10-31.ts` | yes (`frozen.json:3`) | **absent on purpose** (`terms-versions.ts:28-31`) | Published, then replaced before any notice: `replacedBy: "tos-2026-11-06"` (`Home:src/content/legal/terms/index.ts:27`). Never takes effect. |
| `tos-2026-11-06` | `Home:src/content/legal/terms/tos-2026-11-06.ts` | yes (`frozen.json:4`) | yes (`terms-versions.ts:34`), so it is `LATEST_TERMS_VERSION` (`:38`) | **Published and frozen, not in force, not lawyer-reviewed.** Every new seller agrees to it at once (`Store:src/lib/settings/constants.ts:14`). Its notice has not started: production mail is off (`Store:wrangler.jsonc` `vars` at line 39 carries no `TRANSACTIONAL_EMAIL_ENABLED`; the job throws `mail_off`, `Store:src/lib/legal/terms-notices.ts:101`). |
| (Czech-only beta text) | none | n/a | n/a | **No draft exists.** No unfrozen version file is in `Home:src/content/legal/terms/`. |

Home and Store **match** according to the replacement recipe (`Store:docs/changing-the-terms.md:48-56`): Home lists 3 files, Store lists the 2 that can take effect. Nothing automated compares the two lists; the only link is the notice job's HEAD check that the version page is live (`terms-notices.ts:183-191`).

Production state (not verifiable from disk): an earlier-session note (`memory/terms-notice-system.md`, 2026-11-20) says `terms_versions` holds only the `tos-2026-10-11` baseline row, so existing sellers see the "changing soon" banner with no date.

Consequence worth knowing: the sign-up line links `/terms/` (`Store:src/lib/legal/links.ts:57`), which shows the in-force **template** `tos-2026-10-11`, while the welcome flow records agreement to `tos-2026-11-06` and links that version (`Store:src/components/legal/TermsSummary.tsx:33`, `:70`).

---

## 1. The checklist, item by item

Status key: **Exists**, **Partial**, **Missing**, **CONTRADICTS**. "Type" says whether the fix is a code change, a copy change, or a new Terms version (NTV). Every proposed legal wording is a DRAFT for lawyer review.

### 1.1 P2B Regulation (EU) 2019/1150

| # | Requirement | Status | Evidence (file:line, quote) | What is missing | Proposed fix | Type |
| --- | --- | --- | --- | --- | --- | --- |
| P2B-1 | Plain, intelligible seller terms (Art. 3(1)(a)) | Partial | In force `Home:...tos-2026-10-11.ts:8` "a starting template"; `:290` "[fee %]". Newest `tos-2026-11-06.ts` is plain but one 1,124-line document for visitors, sellers and buyers, with long US/Canada parts (`:875-1087`). Plain summary exists: `Store:src/lib/legal/terms-summary.ts:30-83`, words in `Store:messages/en/settings.json:248-309`. | A seller-specific, Czech-beta-sized text; the in-force text has placeholders. | NTV (DRAFT): separate "Seller terms" part or document scoped to the CZ beta, US/Canada parts parked; keep the summary in step. | NTV + copy |
| P2B-2 | Grounds for suspension, restriction, termination (Art. 3(1)(c)) | Partial | `tos-2026-11-06.ts:713-723` "you breach these Terms or the Acceptable Use Policy; ... we reasonably suspect unlawful, fraudulent, or harmful activity; ... required ... by law or by ... Stripe; you are no longer based in a region where we operate; or we discontinue". AUP `:463-492`. But the classifier enforces rules the AUP does not publish: `Store:src/lib/moderation/auto/policy.ts:3-5` claims "The words below are section 10 of the published terms", yet `:98` adds "prescription-only medicines ... anabolic steroids ... forged documents and fake diplomas, hacked accounts ... endangered species ... hired violence" and `:105` "kratom ... nitrous oxide canisters", none of which appear in `tos-2026-11-06.ts:472-477`. | Published grounds narrower than enforced grounds. | NTV (DRAFT): one prohibited-items list that is the superset of the classifier, Stripe's list and CZ/EU law (see B-1); then make `policy.ts` restate it. | NTV + code |
| P2B-3a | 15 days' notice of changes on a durable medium (Art. 3(2)): the Terms-version mechanism | Exists (with gaps) | `Store:src/lib/legal/terms-versions.ts:21` `TERMS_NOTICE_DAYS = 30`; DB wall `Store:supabase/migrations/20261031_terms_notices.sql:22-27` "effective_at >= notice_completed_at + interval '30 days'"; email names changes, both versions, date, free exit (`terms-notices.ts:168-177`, `Store:messages/en/settings.json:329-334` "you can close your account at no charge before {date}"). | Coverage gaps, see section 2.4: unconfirmed emails skipped (`terms-notices.ts:226`), bounced addresses given up after 3 tries while the clock still starts (`:115-117`, `:142-144`); email links the text rather than carrying it. | Code: record and report who was not reached; decide with lawyer whether to attach the new text. | Code |
| P2B-3b | Change clause in the in-force Terms | CONTRADICTS | `tos-2026-10-11.ts:587` "Material changes ... take effect only after a reasonable notice period (at least 14 to 30 days)"; `:588` "Non-material or legally-required changes may take effect when posted". P2B sets 15 days for any change. | In-force text allows 14 days and same-day changes. | Superseded once `tos-2026-11-06` (`:746-751`) or a successor takes effect; never apply a change under the 10-11 wording. | NTV (already drafted in 11-06) |
| P2B-3c | Notice before fee and price changes | CONTRADICTS | `Store:supabase/migrations/20261011_pricing_config.sql:220` `p_effective_from timestamptz default now()`; `:241-246` only checks the new row starts after the open one. No minimum notice. Terms promise one: `tos-2026-11-06.ts:388` "a change that is worse for you is subject to the notice in the Changes section"; `:403` "We email you at least 30 days before a higher price applies to a renewal". | A per-sale fee rise can take effect the moment staff call `plan_price_change`. No notice email exists for fee changes. | Code: refuse an increase of `direct_fee_bps`/`price_cents` with `effective_from < now() + 30 days`; a fee-change notice job like the Terms one. | Code |
| P2B-4a | Statement of reasons when restricting content (Art. 4(1), with DSA Art. 17) | Exists | Admin writes an immutable decision and tells the seller: `Admin:src/app/(app)/moderation/[targetType]/[targetId]/actions.ts:204`, `:282` (`moderation_decisions`), `:353` (`notifySeller`); in-app + email + PDF link `Admin:src/lib/moderation/notify-seller.ts:156-161`. PDF follows Art. 17(3): `Store:src/lib/moderation/statement.ts:19-37`, redress `:170-176`. Automated pauses: `Store:src/lib/moderation/auto/check.ts:221-249`. | Admin notices are English only (`Admin:src/lib/moderation/content.ts:453-551`); automated pause tells the seller in-app only (`check.ts:229`), no email. | Code: localise Admin notices (Czech first); email for automated pauses once mail is on. | Code |
| P2B-4b | Statement of reasons when suspending a seller's account | Missing | `Admin:src/app/(app)/users/[id]/actions.ts:56-142` `banUser`: bans (`:86-88`), records the reason internally (`:95-106`), revokes sessions (`:111`), tells staff (`:125`). Nothing is sent to the seller. Newest Terms promise it: `tos-2026-11-06.ts:727` "We tell you why, in a statement of reasons, when we restrict your account or your content." | Any notice or reasons to the seller. | Code: ban sends a statement (ground, facts, duration, redress, appeal address) by email and in a page reachable while signed out. | Code |
| P2B-5 | 30 days' notice before full termination, exceptions for illegal content, fraud, repeated breaches (Art. 4(2), 4(4)) | CONTRADICTS | Practice: permanent ban is immediate, `Admin:src/lib/moderation/ban-durations.ts:28-33` "Permanent", `876000h`; staff delete is immediate, `Admin:src/app/(app)/users/[id]/actions.ts:284-326`. In-force text: `tos-2026-10-11.ts:564` "Where practicable and lawful, we will give reasonable notice and, for serious or urgent issues, may act immediately." Newest text gives 30 days but widens the exceptions: `tos-2026-11-06.ts:727` "other than one the law says must take effect at once, or repeated or serious breaches ... For serious or urgent issues, we may act immediately." | A 30-day termination path in Admin; exceptions limited to what P2B Art. 4(4) allows. | Code: a "terminate with notice" action (scheduled end, notice email, export stays available); immediate only with a recorded exception. NTV (DRAFT): exception list matching Art. 4(4) (legal obligation, imperative reason under national law, repeated infringement), lawyer to confirm whether fraud and illegal content fit. | Code + NTV |
| P2B-6 | Effect of the terms on the seller's IP (Art. 3(1)(e)) | Exists | `tos-2026-11-06.ts:573` "As a Seller, you **retain ownership** of your Content ... licence ... **solely** to operate, provide, and promote the Service"; same in force `tos-2026-10-11.ts:420`. | Nothing for the checklist. Note "promote" and Marketplace featuring are also Art. 3(1)(d) distribution channels and should be named as such. | NTV (DRAFT): name the additional channels (Marketplace, promotion) explicitly. | NTV |
| P2B-7 | Description of data access (Art. 9) | Partial | Only `tos-2026-11-06.ts:832` "**Your data.** You can see and download the data your use of the Service generates, as described in **Settings** and our Privacy Policy." Nothing in force (`tos-2026-10-11.ts` has no such clause). Export exists: `Store:src/app/settings/export/route.ts:9-15`, columns `:38-60`. | What data Square Share itself accesses (orders, buyer details, analytics), what sellers can and cannot access, what is shared with third parties (Stripe, Anthropic moderation), what stays after termination. | NTV (DRAFT): an Art. 9 data paragraph; can share text with the Stripe §3.5 section (S-2). | NTV |
| P2B-8 | How to leave; access after termination (Art. 3(1), 8(b), 8(c)) | Exists | `tos-2026-11-06.ts:709` "close your account in **Settings** ... after a 14-day grace period"; `:731` "You can download your data in **Settings** before deletion"; grace `Store:src/lib/account-deletion/policy.ts:18` `ACCOUNT_DELETION_GRACE_DAYS = 14`. In force: `tos-2026-10-11.ts:547`. | A banned seller cannot sign in, so cannot use the export the Terms point to. | Code: export reachable for a banned seller (see P2B-5). | Code |
| P2B-9 | Small-enterprise exemption only from internal complaint system and mediators | Exists | `tos-2026-11-06.ts:833` "You can raise a complaint free of charge at ... As a small enterprise we are not required to name mediators". Micro status confirmed by owner (`memory/operating-regions-and-terms.md`). | In force text has nothing. | Carried by the next version. | NTV |
| P2B-10 | Ranking parameters once the feed ranks sellers (Art. 5) | Exists (not triggered) | `tos-2026-11-06.ts:830` "we do not rank them against other Sellers. If the Marketplace launches, we will set out the main parameters"; `App:worker/lib/ranking.ts:4-7` "Nothing calls it yet: there is no ranker". | When a ranker ships, its parameters (including the report-pressure demotion in `ranking.ts:13-19`) must be in the Terms first. | NTV before any ranker. | NTV |
| P2B-11 (extra) | Differentiated treatment (Art. 7) | CONTRADICTS | `tos-2026-11-06.ts:831` "do not give any Seller better treatment than another except through the plan features published in the Dashboard". Code gives staff-chosen plans and fee waivers: `Store:src/lib/billing/grants.ts:19-27` reasons `"beta_tester", "founding_seller", "support", "partner", "promotion"`; `Store:src/lib/billing/sale-fee.ts:6` "seller's fee is waived (seller_fee_waivers)"; Docs promise "early access sellers get Pro free for six months" (`Docs:content/docs/en/pricing/index.mdx:12`). | A description of these programmes. | NTV (DRAFT): describe grants, waivers and the early-access offer and who qualifies. | NTV |

### 1.2 Stripe Connect platform terms

| # | Requirement | Status | Evidence | What is missing | Proposed fix | Type |
| --- | --- | --- | --- | --- | --- | --- |
| S-1 | §3.1 clearly and prominently disclose all platform fees | Partial | Newest Terms table `tos-2026-11-06.ts:359-382` (Free EUR 0 5%, Starter EUR 12 2%, Pro EUR 39 0.5%); `/plans` (`Store:messages/en/billing.json:32`, `:59`); Docs (`Docs:content/docs/en/pricing/index.mdx:34-42`). But the in-force Terms say `"**[fee %]**"` (`tos-2026-10-11.ts:290`); Home's pricing section is hidden while `NEXT_PUBLIC_SELLER_SIGNUP_OPEN` is commented out (`Home:.env.production:17`, gate `Home:src/app/page.tsx:53`). Code has fees no text discloses: marketplace fees `Store:src/lib/billing/pricing-seed.ts:39` "The marketplace fees (8%, 7%, 6%) are defaults", ad fee `Store:src/lib/pricing/fees.ts:13-16`. | In-force disclosure; marketplace and ad fees before the Marketplace; fee-on-refund rule (R-1). | NTV; publish Home pricing with the switch; disclose marketplace/ad fees before use. | NTV + copy |
| S-2 | §3.5 seller agreement explains what data Square Share accesses and what it does on the seller's behalf | Missing | Terms only say `tos-2026-11-06.ts:348` "your use of Stripe is governed by your agreement with Stripe, not by us" and `:352` "Square Share does not receive, hold, or transmit Buyer or Seller funds". Privacy is undecided: `Home:src/content/legal/privacy.ts:127` "the exact data flows will be confirmed against the final integration before launch". What the code does on the connected account: creates the Express account `Store:src/lib/payments/connect/account.ts:153-164`; account and login links `:194`, `:209`; creates Checkout Sessions as direct charges `Store:src/lib/checkout/stripe-provider.ts:122-168` (`account: account.stripeAccountId`, `:167`); reads payment intents and application fees `Store:src/lib/payments/connect/fees.ts:40`, `:67`; issues refunds with the fee `Store:src/lib/orders/actions.ts:476-489`; reads balance and payouts `Store:src/lib/payments/connect/overview.ts:185-186`. | A "Platform Provider Agreement" section listing these actions and data. | NTV (DRAFT): section covering account creation, onboarding links, charges created on the seller's account, the application fee, refunds Square Share issues at the seller's request, balance/payout reads, webhook data, retention. | NTV |
| B-1 | Banned-items list mirroring Stripe's restricted businesses plus EU/CZ illegal goods, accepted at sign-up | Partial | AUP `tos-2026-11-06.ts:466-477` (illegal, counterfeit, malware, hateful, adult content, adults-only goods); in force `tos-2026-10-11.ts:373-378`; summary point shown in the welcome flow `Store:messages/en/settings.json:288`. Accepted in the welcome flow, not at sign-up (section 5). Classifier list broader (P2B-2). | No cross-check against Stripe's list (categories to verify against Stripe's current list include financial services, crypto, money transmission, stored value and gift cards, MLM and get-rich-quick, pharmaceuticals and nutraceuticals, social-media engagement, virtual currency, telemarketing, travel); no Czech-specific prohibitions; no single source shared by Terms and classifier. | NTV (DRAFT): one list (Stripe superset + EU/CZ law + current classifier rules + adults-only goods), with examples; classifier restates it. | NTV + code |

### 1.3 Platform fee on refunds

| # | Requirement | Status | Evidence | What is missing | Proposed fix | Type |
| --- | --- | --- | --- | --- | --- | --- |
| R-1 | Keep the fee by default; refund it only for (1) illegal/fraudulent sale removed, (2) Square Share's fault, (3) dispute lost because of Square Share. In the seller terms. | CONTRADICTS | Code always returns the fee: `Store:src/lib/orders/actions.ts:455-456` "The whole payment, and our fee with it (`refund_application_fee`): a seller is not charged a fee on a sale that did not stand", `:482` `refund_application_fee: true`; non-Stripe orders `:438-441` and `Store:src/lib/billing/fee-ledger.ts:104` `reverseOrderFees`; `Store:src/lib/payments/connect/fees.ts:12-13` "A REFUND returns our fee in the same proportion". Terms defer to a policy that does not exist: `tos-2026-11-06.ts:426` and `tos-2026-10-11.ts:311` "the platform fee is handled in accordance with the then-current fee policy shown in your Dashboard". | The policy text, and the code. | Code: `refund_application_fee: false` by default; staff-only override recording which of the three grounds applies; ledger keeps the fee. NTV (DRAFT): the three-ground rule. Lawyer: moving from "returned" (what Docs say today) to "kept" is a change that is worse for sellers. | Code + NTV |
| R-2 | Same rule on the pricing page | CONTRADICTS | `Docs:content/docs/en/pricing/index.mdx:80` "**A refund returns it.** Refund a checkout sale and SquareShare's share goes back too"; Czech `Docs:content/docs/cs/ceny/index.mdx:81` "Při vrácení peněz se vrací". Home pricing (`Home:src/components/PricingSection.tsx:91-93`) and `/plans` (`Store:messages/en/billing.json:32`, `:122-146`) say nothing. | The rule on Home pricing, `/plans` fine print/FAQ, Docs en+cs. | Copy, in step with R-1 and only once the new Terms are in force. | Copy |
| R-3 | Kept fee shown on the refund line in the dashboard | CONTRADICTS | `Store:src/components/orders/OrderDetail.tsx:195-196` "A refund sends the whole payment back, our fee included"; `:468-471` shows only "Refunded" with the full amount; refund dialog `Store:messages/en/orders.json:177` "Refunds the whole order ... to the buyer's card through Stripe". | A "Platform fee kept" line and dialog wording. | Code + copy after R-1. | Code + copy |

### 1.4 Pricing tiers and processing fees

| # | Requirement | Status | Evidence | What is missing | Proposed fix | Type |
| --- | --- | --- | --- | --- | --- | --- |
| F-1 | Free 5%; Starter EUR 12/month + 2%; Pro EUR 39/month + 0.5% | Exists | Source of truth `Store:src/lib/billing/pricing-seed.ts:41-57` (500/200/50 bps, 0/1200/3900 cents), mirrored in SQL; Home fallback `Home:src/content/pricing.ts:35-69`; Terms `tos-2026-11-06.ts:359-382`; Docs `Docs:content/docs/en/pricing/index.mdx:34-37`, `Docs:content/docs/cs/ceny/index.mdx:37-38`. All agree. | Not in the in-force Terms (S-1). Fee base differs: in force "gross sale price of each Artifact" (`tos-2026-10-11.ts:290`) vs everywhere else "everything the buyer pays, delivery included" (`tos-2026-11-06.ts:387`, `Store:src/lib/pricing/fees.ts:18`). | NTV carries it. | NTV |
| F-2 | "Stripe handles pricing": seller pays Stripe's processing fees | Exists | `tos-2026-11-06.ts:387` "Stripe's own processing fees are separate and charged by Stripe"; `Store:messages/en/billing.json:32` "Stripe's own card processing fees come on top", `:83`, `:140`; `Home:src/components/PricingSection.tsx:92-93`; `Docs:content/docs/en/pricing/index.mdx:85`; order line hint `Store:messages/en/orders.json:90` "Before Stripe's card fee". | Nothing. | none | none |
| F-3 (extra) | VAT wording consistent with a non-VAT-registered operator | CONTRADICTS (for accountant) | `Store:messages/en/billing.json:32` "Prices exclude VAT"; `:136` "VAT, which is added at checkout where it applies"; `Home:src/components/PricingSection.tsx:56` "a month, excl. VAT"; `Docs:content/docs/en/pricing/index.mdx:104` "Add an EU VAT ID at checkout and your invoices show the reverse charge"; plan checkout `Store:src/lib/billing/stripe-provider.ts:189-190` `automatic_tax: { enabled: true }`. Terms more neutral: `tos-2026-11-06.ts:386` "Prices exclude taxes, which are added where the law requires". | An accountant's answer on what to say and whether Stripe Tax should run. | Copy and config after accountant. | Copy + config |

### 1.5 Czech-only beta

| # | Requirement | Status | Evidence | What is missing | Proposed fix | Type |
| --- | --- | --- | --- | --- | --- | --- |
| CZ-1 | Seller terms say: "Currently available to sellers established in the Czech Republic, with delivery within the Czech Republic. We plan to expand to other EU countries." | CONTRADICTS | `tos-2026-11-06.ts:19` "in the European Union, the United States and Canada"; `:28`; `:114` "Sellers must be resident or established in one of these regions". Sign-up `Store:messages/en/auth.json:41` "based in the EU, the USA or Canada, where we operate today"; summary `Store:messages/en/settings.json:259`; notice bullet `:320`; seller country list and checkout `Store:src/lib/settings/constants.ts:104-114` (`OPERATING_COUNTRIES` = EU + US + CA), `:129-136`; Docs `Docs:content/docs/en/(getting-started)/set-up-square-share.mdx:28`, `what-is-square-share.mdx:43`, `payments-and-payouts/index.mdx:42`, `reference/faq.mdx:34`. | The clause, and code that enforces it. | NTV (DRAFT) carrying the owner's sentence in EN and CS; code: `OPERATING_COUNTRIES` and shipping codes to `CZ` for the beta (count stored shipping policies first, per the safeParse trap in `memory/operating-regions-and-terms.md`); copy in auth/settings messages and Docs. | NTV + code + copy |
| CZ-2 | Seller-facing legal texts in Czech (drafts for lawyer review) | Partial | Czech exists for the summary `Store:messages/cs/settings.json:258-259`, the notice email, the sign-up line `Store:messages/cs/auth.json:41`, `/plans` `Store:messages/cs/billing.json:32`, statement PDF (localised, `statement.ts:31-33`). Summary file itself warns "a translation of one needs qualified review before it ships" (`terms-summary.ts:14-15`). Full Terms English only, and English prevails: `tos-2026-11-06.ts:1103` "The English text of these Terms applies ... Summaries in other languages in the Dashboard are for convenience." Privacy English only (`Home:src/content/legal/privacy.ts`). Admin moderation notices English only (`Admin:src/lib/moderation/content.ts:453-551`). | Czech full Terms (seller part), Czech privacy notice, Czech Admin notices. | NTV in Czech (DRAFT), Home needs a per-language version route; Admin notice i18n. | NTV + code |
| CZ-3 | Buyer-facing legal texts in Czech | Partial | Czech exists for checkout and page disclosures: `Store:messages/cs/productPage.json:104` (sale disclosure), `:391` ("Prodává {seller}, {country}"), `:437` (terms assent). The Terms and Privacy Policy those lines link are English only. | Czech Terms (buyer part) and privacy notice. | As CZ-2. | NTV + copy |

### 1.6 DSA, consumer law, branding, DAC7, VAT eligibility

| # | Requirement | Status | Evidence | What is missing | Proposed fix | Type |
| --- | --- | --- | --- | --- | --- | --- |
| D-1 | Content moderation rules in the terms (DSA Art. 14) | Partial | `tos-2026-11-06.ts:511` "an **automated check** reads it against the Acceptable Use Policy ... Where the check is unsure, a person decides"; `:519` statement and free appeals. In force: nothing (no moderation section in `tos-2026-10-11.ts`). Statement PDF cites the in-force Terms as the contractual basis: `Store:messages/en/products.json:810`. | In force text; published rules narrower than classifier (P2B-2). | NTV takes effect; align list. | NTV |
| D-2 | Public points of contact for authorities and users (DSA Art. 11, 12) | Partial | `tos-2026-11-06.ts:843` "office@... is our single point of contact for authorities in the EU and for users of the Service, in English and Czech" (not in force). Footer shows the address `Home:src/components/Footer.tsx:171-177`. Appeals use a different address: `Admin:src/lib/moderation/content.ts:322` `APPEAL_EMAIL = "support@squareshare.eu"`; `Store:src/lib/moderation/removal.ts:248`. | An always-available contact statement (not only inside a not-yet-in-force Terms); one address or a stated split. | Copy: a short contact/DSA block on Home's legal pages; NTV keeps it. | Copy + NTV |
| C-1 | Show buyers whether the seller is a trader | Missing | All sellers must give a trader identity (`Store:src/lib/settings/seller-identity.ts:122-132`); there is no trader/non-trader declaration anywhere (grep for `is_trader`, `not a trader`, `private seller` in `Store:src` finds none). | A declaration field and buyer-facing line, if Square Share is an online marketplace in law. | Lawyer first; then code + copy. | Code + copy |
| C-2 | Ranking criteria for buyers | Exists (not triggered) | No cross-seller search or feed; storefront order is the seller's (`tos-2026-11-06.ts:830`); App ranker not built (`App:worker/lib/ranking.ts:4-7`). | Before Marketplace. | NTV + buyer copy before a feed. | NTV |
| C-3 | Who is responsible for what | Exists | `Store:messages/en/productPage.json:104` "<seller>{name}</seller> is the seller for this order and is responsible for the product, its delivery, and any returns or refunds. Square Share ... is not a party to the sale"; un-switchable (`Store:src/components/product-page/PoweredByFooter.tsx:16-21`, `:137-147`); checkout assent `productPage.json:321` "Your purchase itself is with {seller}"; email footer `Store:messages/en/orders.json:296`. | Nothing. | none | none |
| BR-1 | Seller visibly named in the embed and at checkout | Exists | Embed frame footer `Store:src/components/storefront-page/EmbedFrameView.tsx:95` `t("soldBy", ...)`; checkout `Store:src/components/checkout/CheckoutView.tsx:181-197` "Sold by {seller}, {country}" with seller details; hosted page footer `PoweredByFooter.tsx:137-147`; seller block not switchable `Store:src/components/product-page/ProductPageView.tsx:251-259`. | Nothing. | none | none |
| BR-2 | Seller name on receipts and the statement descriptor | Partial | Confirmation email "Sold by" + name, address, country, email, VAT (`Store:src/lib/orders/emails.ts:94-105`, `:442-445`); direct charge on the seller's account (`Store:src/lib/checkout/stripe-provider.ts:4-7` "their name on the buyer's statement", `:167`). Nothing sets or checks a descriptor (`statement_descriptor` appears only as a payout read, `Store:src/lib/payments/connect/overview.ts:102`); no `receipt_email`. Email sender is the store name, not the trader name: `Store:messages/en/orders.json:237` "{store} via Square Share". | A check that the connected account's descriptor names the trader; trader name in the From line. | Code: read and show the descriptor in Payments; optional `statement_descriptor_suffix`; From = trader name. | Code |
| DAC7-1 | Sellers told their data is collected and reported (privacy notice), if in scope | Partial | `tos-2026-11-06.ts:288` "Laws such as the EU's DAC7 rules ... may require us to collect, verify, publish or report details about you and your sales, including tax identifiers and bank details". Privacy policy silent (no "DAC7" in `Home:src/content/legal/privacy.ts`; tax only at `:182`, `:287`, `:413-414`). In force Terms silent. | Privacy notice paragraph (purpose, legal basis, recipients: Czech tax authority, retention). | Accountant on scope; then privacy copy (DRAFT). | Copy |
| VAT-1 | Eligibility: sellers established in the EU (beta: CZ) and shipping from inside the EU | CONTRADICTS | `tos-2026-11-06.ts:114` allows US/Canada sellers; `:820` "Where EU rules treat a platform as the supplier of goods sold by a non-EU Seller, we may collect and remit the VAT"; no ship-from rule anywhere; `Store:src/lib/settings/constants.ts:110-114` includes US and CA. | The eligibility rule. | NTV (DRAFT): establishment in CZ (beta) and dispatch from CZ/EU; code limits seller country. | NTV + code |
| X-2 (extra) | Agreement to the Terms is on file before a seller publishes or sells | Missing | The publish gate checks trader identity only: `Store:src/lib/settings/seller-identity.ts:304-313` `publishBlockedError`. Terms step is enforced only inside the Overview welcome dialog (`Store:src/components/onboarding/WelcomeFlow.tsx:65-69`), which opens only for a recorded "not seen yet" (`Store:src/app/(dashboard)/dashboard/page.tsx:202-205`). | A server-side condition. | Code: add "current Terms agreed" to the publish gate (or to `sellerMaySell`). | Code |

**Counts (36 rows):** Exists 11, Partial 11, Missing 4, CONTRADICTS 10.

---

## 2. The Terms change machinery

### 2.1 How a version is created and announced

Recipe: `Store:docs/changing-the-terms.md:7-14` (`npm run terms:new`, edit, `npm run terms:freeze`, add to `TERMS_VERSIONS`, add `TERMS_CHANGES` bullets, update the summary, deploy Home then Store).

1. Daily job (`.github/workflows/scheduled.yml`, 03:23 UTC per `changing-the-terms.md:20`) runs `runTermsNotices` (`Store:src/lib/legal/terms-notices.ts:91-146`).
2. It picks the oldest listed version with no `effective_at` (`:96`); one version at a time.
3. It refuses while mail is off or the version page is not live (`:101-102`, `TermsNoticeBlocked`).
4. It writes `notice_started_at` and a planned date of start + 31 days (`:43`, `:107-111`).
5. Recipients: every auth user with a confirmed email who has not agreed to this or a later version (`:214-237`, especially `:226` and `:229`). Batches of 20, 3 tries per address (`:33`, `:37`).
6. When every reachable address is done, `effective_at = max(completed + 30 days, planned)` (`:138-141`), written once.
7. Dashboard banner during the notice (`Store:src/components/settings/TermsNoticeBanner.tsx:27-28`); Settings › Legal shows changes and allows early agreement (`Store:src/components/settings/LegalSection.tsx:63-70`).
8. `urgentReason: "law" | "danger"` skips the wait, emails still go (`terms-versions.ts:11-13`, `changing-the-terms.md:44-46`).

### 2.2 Notice period versus P2B 15 days

- **Duration: satisfies.** 30 days from the last email is twice the P2B 15-day minimum, enforced by the DB CHECK (`20261031_terms_notices.sql:22-27`) and frozen by a trigger (`:35-53`). Dates can only move later.
- **Exception path:** law or imminent danger only (`terms-versions.ts:11-13`), which follows P2B Art. 3(4)(a)/(b).
- **Exit right:** the email and banner say the seller can close the account at no charge before the date (`Store:messages/en/settings.json:317`, `:334`), matching Art. 3(2) second subparagraph.
- **Gaps (for the lawyer, section 7):**
  - Unconfirmed emails are skipped entirely (`terms-notices.ts:226`) and bounced addresses are abandoned after 3 tries (`:115-117`, `:142-144`), yet the clock starts. Those sellers get only the dashboard banner.
  - The email carries the change bullets and links to both versions (`:172-173`); the full new text is not in the email.
  - The notice goes to the sign-in address, not the trader contact address (by design, same as Admin, `Admin:src/lib/moderation/notify-seller.ts:36-39`).
  - Today nothing runs at all: mail is off, so `tos-2026-11-06` has no notice, no date, and existing sellers remain on the template `tos-2026-10-11`.
  - Price and fee changes do not go through this machinery at all (P2B-3c).

### 2.3 Sellers who join after the notice

- Anyone agreeing today agrees to the newest listed version (`terms-versions.ts:37-38`, `changing-the-terms.md:22`, `tos-2026-11-06.ts:748` "New accounts agree to the newest published Terms when they sign up, including during another version's notice period"). A seller who joins mid-notice therefore contracts on the new text directly; P2B notice is about changes for existing business users, so no notice is owed to them for that version.
- A seller who joins mid-notice and has not yet agreed (no welcome flow yet) and has a confirmed email is picked up by the next batch run (`recipients` is recomputed each run, `terms-notices.ts:113`), until the notice completes.
- Weak point: agreement is not at sign-up but at the first Overview visit (section 5). Between sign-up and that visit the only text shown is the sign-up line linking `/terms/` (the in-force template). Which terms bind in that window is a lawyer question.

### 2.4 Where acceptance is recorded

| What | Where |
| --- | --- |
| Table and columns | `public.profiles.legal_accepted_at timestamptz`, `public.profiles.legal_accepted_version text` with `CHECK (... char_length(legal_accepted_version) <= 32)` (`Store:tests/db/prod-migrations.sql:263-266`, comments `:280-283` "When the user accepted the seller agreement / terms / privacy") |
| Version id | `LEGAL_VERSION = LATEST_TERMS_VERSION` (`Store:src/lib/settings/constants.ts:14`), today `tos-2026-11-06` |
| Writer | `acceptLegal` (`Store:src/lib/settings/actions.ts:399-422`): writes `new Date().toISOString()` and `LEGAL_VERSION` on the caller's own row |
| Guard | the form posts the version it showed; anything else is refused: `z.literal(LEGAL_VERSION, ...)` (`Store:src/lib/validation/settings.ts:163`) |
| Evidence of the text | the version id maps to the permanent page `/terms/v/<version>/` (`terms-versions.ts:48-52`) |
| Not recorded | IP, user agent, which surface (welcome or Settings), the language the summary was read in, privacy-policy version |
| Notice history | `terms_notice_sends (version, user_id, sent_at, attempts)` (`20261031_terms_notices.sql:64-70`) |

### 2.5 Must existing sellers re-accept?

- Not during the notice: the banner informs, the Overview does not ask (`Store:src/lib/dashboard/attention.ts:280-287`).
- After the version is in force: the Overview attention row asks anyone whose agreement is older (`attention.ts:287-297`); Settings › Legal shows "agreed to an earlier version" (`LegalSection.tsx:83-98`).
- Continued use binds: `tos-2026-11-06.ts:747` "If you keep using the Service after that date, the new Terms apply to you. We will also ask you to agree to them in the Dashboard."
- No re-acceptance gate on selling (X-2).
- Team members are never asked (`Store:src/app/(dashboard)/dashboard/page.tsx:232` `termsAccepted: true` for non-owners).

### 2.6 What the frozen-version rules forbid

| Rule | Enforced by | Quote |
| --- | --- | --- |
| Editing a published version | Home prebuild `Home:scripts/check-terms-frozen.mjs:48-53` | "has been edited, but it is already published and people agreed to it" |
| A version file with no recorded hash | `check-terms-frozen.mjs:46-47` | "is not frozen. When its text is final, run: npm run terms:freeze" |
| A version missing from the index | `:55` | "is missing from src/content/legal/terms/index.ts" |
| Deleting a published version | `:57-61` | "was deleted, but people agreed to it. Restore the file." |
| Line-ending-only changes | ignored: `:20-24` normalises CRLF | "the words are what is frozen" |
| Taking effect under 30 days after the last email | DB CHECK `20261031_terms_notices.sql:22-27` | "effective_at >= notice_completed_at + interval '30 days'" |
| Moving a date once written | trigger `:41-50` | "effective_at is fixed once set"; same for `notice_completed_at`, `short_notice_reason` |
| A version with no change summary | Store unit test (`Store:src/lib/legal/terms-changes.ts:3-4`) | "fails on a version with none" |
| Emailing about a replaced version | recipe (`changing-the-terms.md:50-56`) | only if never emailed and never agreed |

Not forbidden: removing a line from `frozen.json` and re-freezing (the documented way to fix text "before it has ever shipped", `memory/terms-notice-system.md`), which the build cannot tell apart from editing a shipped version; `notice_started_at` and `planned_effective_at` are not frozen; a `terms_versions` row can be deleted by `service_role`.

---

## 3. Suspension and termination: what the Terms say vs what the apps do

| Action | Terms in force (10-11) | Newest Terms (11-06) | What Admin/Store actually do | Notice | Statement of reasons | 30-day termination |
| --- | --- | --- | --- | --- | --- | --- |
| Pause a product/storefront (staff) | `tos-2026-10-11.ts:398` "We may investigate ... removing Content and suspending" | `:511`, `:519` statement + appeal | `Admin:.../moderation/[targetType]/[targetId]/actions.ts:204` decision row `:282`, `notifySeller` `:353`; seller fixes and asks again (`Admin:src/lib/moderation/content.ts:205-210`) | In-app + email (English) (`Admin:src/lib/moderation/notify-seller.ts:82-89`) | Yes, PDF (`Store:src/lib/moderation/statement.ts`) | n/a (restriction) |
| Remove a product/storefront (staff) | same | same | same, final unless appeal (`content.ts:504-512`) | same | Yes | n/a |
| Automatic pause (classifier) | nothing | `:511` | `Store:src/lib/moderation/auto/check.ts:221-249` | In-app only | Yes (`statement.ts:51-54`, "automated") | n/a |
| Publish gate (missing trader details) | `tos-2026-10-11.ts:227` note | `tos-2026-11-06.ts:297` note | `Store:src/lib/settings/seller-identity.ts:304-313` | Dashboard copy | Self-explaining | n/a |
| Account suspension (ban 1 day to 90 days) | `:551-564` grounds, "reasonable notice ... where practicable" | `:713-727` "We tell you why, in a statement of reasons" | `Admin:src/app/(app)/users/[id]/actions.ts:56-142`, options `Admin:src/lib/moderation/ban-durations.ts:23-36` | **None**: staff push only (`actions.ts:122-125`) | **None** sent; reason kept internally (`:95-106`) | n/a |
| Permanent ban | same | 30 days unless "repeated or serious breaches"; "For serious or urgent issues, we may act immediately" | same action, `permanent` = `876000h` | **None** | **None** | **Not given**: immediate, sessions revoked (`:111`) |
| Staff deletes account | same | same | `Admin:src/app/(app)/users/[id]/actions.ts:284-326` soft/hard, owner role only | **None** | **None** | **Not given** |
| Seller closes own account | `:547` | `:709` 14-day grace | `Store:src/lib/account-deletion/policy.ts:18` | n/a | n/a | n/a |

Side effects found:
- A banned seller's listings stay live: the only reader of `banned_until` in `Store:src/lib` is the MCP agent auth (`Store:src/lib/agent/authenticate.ts:54-55`), so public pages and checkout do not read the ban (same finding as `inventory/06-admin.md:249`).
- A banned seller cannot reach the export the Terms point to (`tos-2026-11-06.ts:731`).
- Profiles cannot be taken down through moderation on purpose (`Admin:src/lib/moderation/content.ts:82-90`); account-level action is ban or delete only.

Gap summary: content-level moderation is close to P2B Art. 4(1) and DSA Art. 17; account-level suspension and termination have no notice, no statement and no 30-day path (P2B-4b, P2B-5).

---

## 4. Fee disclosure, everywhere it appears

| Place | Live? | Tiers | Fee base | VAT | Stripe fees | Fee on refund |
| --- | --- | --- | --- | --- | --- | --- |
| Terms in force `tos-2026-10-11.ts:290`, `:311` | Yes (`/terms/`) | "[fee %]" placeholder | "gross sale price of each Artifact" | "Taxes and VAT ... Seller's responsibility" (`:299`) | "separate and charged by Stripe" | "then-current fee policy shown in your Dashboard" (no such policy) |
| Terms newest `tos-2026-11-06.ts:359-389`, `:426` | Published, not in force | 0/5%, 12/2%, 39/0.5% | "everything the Buyer pays, delivery included" | "Prices exclude taxes, which are added where the law requires" | "Stripe's own processing fees are separate" | same placeholder sentence |
| Store Terms summary `Store:messages/en/settings.json:282` | Yes | "a platform fee on each sale, as shown in your dashboard" | none | none | none | none |
| Store `/plans` `Store:messages/en/billing.json:31-32`, `:41`, `:83`, `:134-140` | Yes, behind sign-in; "Paid plans open soon" | from `plan_prices` | "everything the buyer pays, delivery included" | "Prices exclude VAT"; "added at checkout where it applies" | "come on top" | silent |
| Store Settings plan card `billing.json:180`, `:185` | Yes | from `plan_prices` | "of what the buyer pays" | "excl. VAT" | none | silent |
| Store order panel `Store:messages/en/orders.json:88-90`, `:142`; `OrderDetail.tsx:468-471` | Yes (fees off) | rate per order | n/a | n/a | "Before Stripe's card fee" | shows full refund, fee implied returned |
| Home pricing section `Home:src/components/PricingSection.tsx:49-56`, `:91-93` | **Hidden** (`Home:.env.production:17` flag commented; `Home:src/app/page.tsx:53`) | live from `/api/billing/plan-prices`, fallback `Home:src/content/pricing.ts:35-69` | "taken from what the buyer pays, delivery included" | "a month, excl. VAT" | "Card processing by Stripe is charged separately" | silent |
| Home FAQ `Home:src/content/faq.ts:41-45` | Yes | "Pricing will be set at launch" while flag off | n/a | n/a | n/a | n/a |
| Docs en `Docs:content/docs/en/pricing/index.mdx:12`, `:34-42`, `:67-81`, `:85`, `:104` | Yes | 0/5%, 12/2%, 39/0.5%; "early access sellers get Pro free for six months" | "everything the buyer pays, delivery included" | "before VAT"; "reverse charge" | "Stripe charges its own card processing fee" | "**A refund returns it.**" |
| Docs cs `Docs:content/docs/cs/ceny/index.mdx:13`, `:37-38`, `:81`, `:105` | Yes | same | same | "bez DPH"; "přenesenou daňovou povinnost" | same | "Při vrácení peněz se vrací" |
| Code `Store:src/lib/billing/pricing-seed.ts:41-57`; `Store:src/lib/pricing/fees.ts:9-19` | fees off (`billing_switches`, per memory) | 500/200/50 bps; marketplace 800/700/600 bps; ad fee | whole amount incl. delivery | plan checkout `automatic_tax` on (`Store:src/lib/billing/stripe-provider.ts:189`) | n/a | fee always returned (`Store:src/lib/orders/actions.ts:482`) |

Agreement: the three tiers agree everywhere they appear. They disagree with the in-force Terms (placeholder, different base). VAT wording ("excl. VAT", reverse charge, Stripe Tax) does not fit a non-VAT-registered operator and needs the accountant. Every fee-on-refund statement that exists says the fee goes back, the opposite of the owner's KEEP policy. Marketplace and ad fees exist in code with no public text.

---

## 5. Sign-up acceptance

| Step | What the seller sees | Where |
| --- | --- | --- |
| Sign-up form | A notice, no checkbox: "By creating an account you confirm you are 18 or over and based in the EU, the USA or Canada, where we operate today. We don't operate anywhere else yet. See our <terms>Terms</terms> and <privacy>Privacy Policy</privacy>." | `Store:src/components/auth/LoginForm.tsx:303-321`; `Store:messages/en/auth.json:41`; links to `/terms/` (in force, `Store:src/lib/legal/links.ts:57`). The code comment says so: "Agreeing itself happens in the welcome flow" (`LoginForm.tsx:304-305`). |
| Welcome flow, terms step (first Overview visit) | "Our Terms of Service" / "Read the short version, or the full Terms, then agree to carry on." Summary in a scroll box, link to the full newest version, button "I have read and agree to the Terms", note "Agreeing records the date and this version of the Terms on your account." Not skippable. | `Store:src/components/onboarding/WelcomeFlow.tsx:45-49`, `:65-69`, `:413-425`; `Store:messages/en/onboarding.json:100-103`, `:162-165`; `Store:messages/en/settings.json:242`; full-text link `Store:src/components/legal/TermsSummary.tsx:33` |
| Settings › Legal | Same summary and button; shows date agreed | `Store:src/components/settings/LegalSection.tsx:71-113` |
| Banned items | Only as one summary bullet: "Illegal, counterfeit or infringing products, goods that are only for adults (alcohol, tobacco, vapes, CBD, gambling and sex products), malware, hateful content and adult content." No separate acceptance. | `Store:messages/en/settings.json:288` |
| Privacy | Not accepted as such; the summary footer says "What you agree to is the full Terms of Service and Privacy Policy" and the Terms call the policies part of the agreement | `Store:messages/en/settings.json:253`, `:305` "Our Privacy Policy and Cookie Policy form part of these Terms"; `tos-2026-11-06.ts:1095` |
| Stored | `legal_accepted_at`, `legal_accepted_version` only (section 2.4) | `Store:src/lib/settings/actions.ts:413-416` |

Dead copy: `Store:messages/en/settings.json:218-229` holds "Seller Agreement" / "Terms" / "Privacy" placeholder texts ("This is a draft placeholder; the real agreement is on its way."); a grep of `Store:src` finds no reference to these keys, so they are not shown, but they should be deleted before anyone wires them up.

---

## 6. Language: which texts exist in Czech

| Text | English | Czech | Evidence |
| --- | --- | --- | --- |
| Full Terms (all versions) | yes | **no** | `Home:src/content/legal/terms/*.ts`; English prevails `tos-2026-11-06.ts:1103` |
| Privacy Policy, Cookie Policy | yes | **no** | `Home:src/content/legal/privacy.ts`, `cookiePolicy.ts` (no locale routes in `Home:src/app`) |
| Terms summary (welcome, Settings) | yes | yes (unreviewed) | `Store:messages/cs/settings.json:258-282`; `terms-summary.ts:14-15` |
| Terms change notice email and banner | yes | yes | `Store:messages/cs/settings.json:320` and the `notice` block |
| Sign-up legal line | yes | yes (says EU/USA/Canada) | `Store:messages/cs/auth.json:41` |
| `/plans` fine print | yes | yes ("Ceny jsou bez DPH") | `Store:messages/cs/billing.json:32` |
| Buyer page and checkout disclosures, terms assent | yes | yes | `Store:messages/cs/productPage.json:104`, `:391`, `:437` |
| Order confirmation email | yes | yes (via `translatorFor`) | `Store:src/lib/orders/emails.ts:26-28` |
| Statement of reasons PDF | yes | yes | `Store:src/lib/moderation/statement.ts:31-33` |
| Admin moderation notices (in-app + email) | yes | **no** | `Admin:src/lib/moderation/content.ts:453-551` |
| Account ban notice | none | none | section 3 |
| Docs pricing | yes | yes | `Docs:content/docs/cs/ceny/index.mdx` |

---

## 7. Seller naming for buyers

| Surface | What is shown | Where |
| --- | --- | --- |
| Hosted product page, beside the title | "Sold by {seller}" (seller can hide this one line) | `Store:src/components/product-page/ProductPageView.tsx:602-606`, `Store:messages/en/productPage.json:35` |
| Hosted product page, seller block | name, address, country, email, VAT, verified phone; cannot be switched off | `ProductPageView.tsx:251-259`; builder `Store:src/lib/settings/seller-identity.ts:148-161`; labels `productPage.json:91-97` |
| Hosted product and storefront page footer | "{name} is the seller ... Square Share ... is not a party to the sale" | `Store:src/components/product-page/PoweredByFooter.tsx:137-147`; `productPage.json:104-105` |
| Embed frame | "Sold by {seller}" in the frame footer, plus Square Share privacy link and report link | `Store:src/components/storefront-page/EmbedFrameView.tsx:91-119` |
| Square Share checkout | "Sold by {seller}, {country}" with expandable seller details; terms assent "Your purchase itself is with {seller}" | `Store:src/components/checkout/CheckoutView.tsx:179-197`, `:228`; `productPage.json:275`, `:321` |
| Stripe hosted payment page | the connected account's own branding, because the session is created on the seller's account | `Store:src/lib/checkout/stripe-provider.ts:4-7`, `:122-168` (Stripe-side display not verifiable from code) |
| Card statement descriptor | the connected account's descriptor (direct charge); not set or checked in code | `stripe-provider.ts:6`; no `statement_descriptor` write in `Store:src/lib` |
| Order confirmation email | "Sold by" + trader name, address, country, email, VAT; footer "Sent by Square Share on behalf of {store}" | `Store:src/lib/orders/emails.ts:94-105`, `:441-446`, `:458`; `Store:messages/en/orders.json:290-296` |
| Email sender name | "{store} via Square Share" (storefront name, not trader name) | `Store:messages/en/orders.json:237`; `emails.ts:464` |
| Receipt | no separate Square Share receipt; the confirmation email is the durable record; Stripe receipts depend on the seller's Stripe settings (no `receipt_email` in code) | `emails.ts:377-384` |

---

## 8. Prioritised list

### P0 (before the Czech beta opens to new sellers, or before payments are switched on where noted)

1. **New Terms version for the Czech beta (DRAFT for lawyer review, EN + CS).** Must cover: the owner's eligibility sentence (CZ establishment, delivery within CZ, plan to expand); dispatch from CZ/EU; parking the US/Canada parts; P2B Art. 4(4)-shaped termination exceptions; the three-ground fee-on-refund rule; a Platform Provider Agreement section (Stripe §3.5: account creation, charges, application fee, refunds, balance/payout reads, webhook data); one prohibited-items list (Stripe superset + EU/CZ law + classifier rules); differentiated treatment (grants, waivers, early access); an Art. 9 data paragraph; DAC7 line. Then run it through the notice machinery (mail must be on). Files: `Home:src/content/legal/terms/tos-<date>.ts`, `Store:src/lib/legal/terms-versions.ts`, `terms-changes.ts`, `terms-summary.ts`, messages.
2. **Region code and copy contradict the beta.** `Store:src/lib/settings/constants.ts:104-136`, `Store:messages/*/auth.json` `signupLegal`, `settings.json` summary `regions`, Docs setup/faq/what-is/payments pages.
3. **Account suspension and termination.** Admin ban sends a statement of reasons by email; a 30-day "terminate with notice" action; immediate termination only with a recorded P2B exception; export reachable for a banned seller; decide what happens to a banned seller's live listings. Files: `Admin:src/app/(app)/users/[id]/actions.ts`, new notice text, Store public reads.
4. **Fee on refund (before payments switch on).** `Store:src/lib/orders/actions.ts:476-489` and `fee-ledger.ts:104` to keep the fee by default with a staff override; `OrderDetail.tsx:468-471` kept-fee line; `orders.json:177`; Docs en/cs pricing; Home pricing; `/plans` FAQ. Only once the Terms carrying the rule are in force.

### P1

5. **Fee and price changes need notice in code:** `20261011_pricing_config.sql:213-247` accepts `effective_from = now()`; add a minimum for increases and a notice email.
6. **Terms acceptance in the publish gate:** `Store:src/lib/settings/seller-identity.ts:304-313`.
7. **Turn mail on before any notice; close notice coverage gaps** (unconfirmed and bounced addresses; whether to include the full text): `Store:src/lib/legal/terms-notices.ts:115-117`, `:226`.
8. **VAT wording and Stripe Tax** after the accountant: `billing.json:32`, `:41`, `:136`, `:180`; `PricingSection.tsx:56`; Docs `:104`; `Store:src/lib/billing/stripe-provider.ts:189-190`.
9. **Czech for seller-facing notices:** Admin `sellerNotice` (`Admin:src/lib/moderation/content.ts:453-551`) and Czech privacy notice.
10. **One published contact block (DSA Art. 11/12)** independent of which Terms are in force; reconcile `office@` vs `support@` (`Admin:src/lib/moderation/content.ts:322`, `Store:src/lib/moderation/removal.ts:248`).
11. **Privacy notice:** DAC7 (if in scope), Stripe Connect data flows (`Home:src/content/legal/privacy.ts:127`).
12. **Classifier and published rules in one list** (`Store:src/lib/moderation/auto/policy.ts:92-105`).

### P2

13. Trader/non-trader declaration for buyers, if counsel says Square Share is an online marketplace.
14. Disclose marketplace and ad fees (`pricing-seed.ts:39`, `pricing/fees.ts:13-16`) and ranking parameters (`App:worker/lib/ranking.ts`) before either ships.
15. Statement descriptor check and trader name in the email From line (`orders.json:237`).
16. Delete dead "Seller Agreement" placeholder copy (`Store:messages/*/settings.json` `legal.docs`).
17. Fix stale pointers to the retired `Home:src/content/legal/terms.ts` (`Store:src/lib/legal/terms-summary.ts:7`, `Store:src/lib/settings/constants.ts:107`).
18. Summary says notice for "material changes" (`settings.json:304`) while the newest Terms give notice for all changes (`tos-2026-11-06.ts:746`): align.
19. Record more evidence with an acceptance (surface, locale, user agent) if counsel wants it.

---

## 9. Questions only a lawyer (or accountant) can settle

1. Is Square Share an "online intermediation service" under P2B for the embed and hosted-page model, and an "online marketplace" under consumer law (trader/non-trader display, CRD Art. 6a)?
2. Is an email that lists the changes and links the new text a sufficient "durable medium" notice under P2B Art. 3(2), or must the full text be sent?
3. Does starting the notice clock when some sellers' emails are unconfirmed or bounced satisfy P2B, given those sellers see only a dashboard banner?
4. Which immediate-termination grounds fit P2B Art. 4(4) under Czech law: does a single serious breach, fraud or illegal content count as an "imperative reason pursuant to national law"? How should the Terms word the exceptions?
5. What must the account-suspension statement of reasons contain, and how does the micro-enterprise exemption from the internal complaint system interact with Art. 4(3) (the chance to clarify facts)?
6. Is agreement in the post-sign-up welcome flow enough to form the contract, and which terms bind a seller between sign-up and that agreement (the sign-up line links the in-force template)?
7. Should the Privacy Policy and Cookie Policy be "part of" the Terms (`tos-2026-11-06.ts:1095`, summary `settings.json:305`)?
8. Must the Terms be offered in Czech to Czech sellers and consumers, and which language version prevails?
9. Moving the fee-on-refund rule from "returned" (code and Docs today) to "kept": is that a change worse for sellers that needs notice, and is keeping the fee on a consumer withdrawal refund compatible with Stripe's rules and with fairness requirements?
10. Can content be paused on grounds the classifier enforces but the published AUP does not list (P2B Art. 3(1)(c), DSA Art. 14)?
11. Do plan grants, fee waivers and the early-access offer need to be described as differentiated treatment (P2B Art. 7), and is the current "do not give any Seller better treatment" sentence a problem?
12. What exactly does Stripe's Connect platform agreement require of the seller terms beyond §3.1 and §3.5 (for example a reference to Stripe's connected account agreement)? The handoff's wording was not checked against Stripe's current text.
13. Accountant: VAT position of a non-registered Czech micro company selling subscriptions and taking application fees from Czech sellers; what to say instead of "excl. VAT"; whether Stripe Tax should run on plan checkout.
14. Accountant/lawyer: is Square Share a DAC7 "platform operator" with direct charges on sellers' Stripe accounts, and what must the privacy notice say?
15. With Czech-only sellers, can the deemed-supplier paragraph (`tos-2026-11-06.ts:820`) be dropped, and how should the dispatch-from rule be worded?
16. Is the small-enterprise wording on mediators and complaints (`tos-2026-11-06.ts:833`) correct for the operator's size?

---

## 10. What could not be determined from disk

- Production database state: rows in `terms_versions`, which sellers agreed to which version, whether `billing_switches` are all off, whether any `plan_prices` row changed (relied on earlier-session notes dated 2026-11-20 and 2026-10-20).
- Whether production mail is on: `wrangler.jsonc` vars carry no `TRANSACTIONAL_EMAIL_ENABLED`, but a dashboard-set variable would not show on disk.
- Stripe-side facts: the statement descriptor and branding of connected accounts, Stripe receipt settings, Stripe's current restricted-businesses list and Connect platform agreement text (no Stripe call was made, per instructions).
- Whether Home's live deployment matches this working tree (the 2 uncommitted files are not legal text).
