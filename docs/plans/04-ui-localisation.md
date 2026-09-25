# UI localisation plan (next-intl)

Status: in progress. Foundation built (phases 1 to 3); extraction running
in waves. Appendix B is the working contract for anyone converting a file.
Target: translate the dashboard UI so a Czech seller can run the whole app in Czech.

## 1. Goal and scope

**In scope.** Every string the app itself authors: dashboard, settings, auth,
onboarding, orders, products, payments, analytics, storefront editor chrome,
notifications, empty states, toasts, validation messages, page titles.

**Out of scope (deliberately).**

- Seller-authored content: product titles, descriptions, storefront copy,
  specs, policies. Translating those is a separate content feature (per-locale
  seller input), not a UI concern.
- `/dev/*` harness routes (roughly 66 strings). Internal only, never shipped to
  a seller.
- Transactional email bodies (`src/lib/email/send.ts`). Worth doing later,
  tracked separately, because it needs the recipient's stored locale rather
  than a request cookie.
- Buyer-facing product page copy under `src/components/product-page/` is a
  judgement call: the chrome ("Add to cart", "In stock") should follow the
  BUYER's language, not the seller's, so it needs a different locale source
  than the dashboard. Phase 6 covers it; phases 1 to 5 leave it alone.

## 2. Hard constraint discovered (this shapes everything)

**next-intl's documented middleware setup cannot ship on this stack.**

Next 16 renamed `middleware.ts` to `proxy.ts` and pinned Proxy to the Node
runtime. `@opennextjs/cloudflare` fails the build outright on Node middleware
("Node.js middleware is not currently supported"). This is already documented
in `next.config.ts` as the reason the CSP carries no nonce. The repo has no
`proxy.ts` at all today.

Consequences:

- No `/cs/...` URL prefixes, no `[locale]` route segment, no locale
  negotiation in middleware.
- We use next-intl's **"without i18n routing"** mode, which is a first-class
  supported setup. Locale comes from a cookie, resolved in
  `src/i18n/request.ts`.

This is a good fit anyway: the dashboard is a private, cookie-authenticated app
where locale is a user preference, not a URL fact. There is no SEO argument for
localised dashboard URLs (the root layout already sets
`robots: { index: false }`).

## 3. Architecture

```
messages/
  en.json          <- source of truth, always complete
  cs.json
  de.json  ... etc
src/i18n/
  request.ts       <- getRequestConfig: reads cookie, loads messages
  locales.ts       <- locale list, labels, default, narrowing helper
  cookie.ts        <- read/write the locale cookie (server)
  actions.ts       <- "use server" setLocale(locale)
```

**Locale resolution order** (in `request.ts`):

1. `ss_locale` cookie, if it parses to a supported locale.
2. The signed-in user's `profiles.locale`, when set (survives a new browser).
3. `en`.

The cookie is the fast path so a signed-out page (login, reset password) can
still be localised. `profiles.locale` is the durable record, written by the
same server action that sets the cookie.

**Cookie definition.** Mirror `src/lib/auth/last-method.ts` exactly, which is
the established shape for a non-Supabase cookie this app writes:

```ts
export const LOCALE_COOKIE = {
  name: "ss_locale",
  options: {
    domain: AUTH_COOKIE_DOMAIN,   // from lib/supabase/cookie-options
    path: "/",
    sameSite: "lax",
    secure: AUTH_COOKIE_SECURE,
    httpOnly: true,               // only the server ever reads it
    maxAge: 60 * 60 * 24 * 365,
  },
} as const;
```

`httpOnly: true` is correct here and worth stating, because it looks wrong at
first glance: the locale is not a secret. But `src/i18n/request.ts` reads it
server-side, no client code needs it, and this app's rule is that
`document.cookie` is handed nothing it does not need. Reusing
`AUTH_COOKIE_DOMAIN` matters too: the cookie is scoped to `.squareshare.eu` in
production so the language choice survives the move to the marketplace
subdomains.

**Message loading.** An explicit static map, NOT a template-literal dynamic
import:

```ts
const loaders = {
  en: () => import("../../messages/en.json"),
  cs: () => import("../../messages/cs.json"),
  // ...
} as const;
```

A template literal (`import(\`../../messages/${locale}.json\`)`) is what the
next-intl docs show, but it is opaque to the Workers bundler and is the shape
that has historically produced bundle-size and build failures under OpenNext.
An explicit map stays analysable and keeps each locale in its own lazy chunk.

**Provider.** `NextIntlClientProvider` goes in `src/app/layout.tsx`, wrapping
`ToastProvider` (toasts themselves need translated copy). `<html lang>` stops
being hardcoded `"en"` and becomes the active locale.

That last part is not cosmetic. `tests/e2e/a11y/a11y.spec.ts` runs an unfiltered
`AxeBuilder.analyze()` over 20-odd surfaces and fails on any serious or critical
violation. It never mentions `lang` itself, but axe's default ruleset includes
`html-has-lang` and `valid-lang`, both serious. So an empty or malformed locale
on `<html>` fails the a11y suite without a single line of it referring to
localisation. Locale codes must stay valid BCP 47 for that reason alone.

**next.config.ts.** Wrap the existing export with `createNextIntlPlugin()`.
The `initOpenNextCloudflareForDev()` call at the bottom of the file stays
exactly where it is, still gated on `isDev`.

**Persistence.** New migration, following the existing pattern:

```sql
alter table public.profiles
  add column if not exists locale text;
```

No CHECK constraint listing locales. A constraint here would be a second list
to keep in sync with the TS one, which is the exact trap already documented for
notification types. The server action narrows before writing; an unknown value
read back falls through to `en`.

## 4. Locales

English is the default and the source language. Czech ships in the first
release because we are based in Czechia.

| Code | Language | Notes |
|------|----------|-------|
| `en` | English | default, source of truth |
| `cs` | Czech | required, home market |
| `de` | German | |
| `fr` | French | |
| `es` | Spanish | |
| `it` | Italian | |
| `nl` | Dutch | |
| `pl` | Polish | |
| `pt-PT` | Portuguese (Portugal) | a full tag: plain `pt` is Brazilian to every Intl API (plurals, money) |
| `sk` | Slovak | cheap adjacent market to `cs` |

Ten locales. Adding one later is a JSON file plus one line in `locales.ts`.

Czech and Polish both have complex plural rules (one / few / many / other).
Message keys that count things must use ICU plural syntax from day one, even in
`en.json` where it looks like overkill, because retrofitting plurals across a
thousand keys later is far worse than writing them correctly once.

## 5. Key naming convention

Namespace per surface, mirroring the component tree, so a translator sees
related copy together and so the provider can be narrowed per route later if
the client payload grows:

```
Orders.empty.title
Orders.empty.filteredTitle
Orders.filters.clear
Settings.tax.heading
Common.actions.save
Common.actions.cancel
```

`Common.*` is for genuinely shared copy (Save, Cancel, Delete, Back). Resist
putting anything surface-specific there.

## 6. Phases

**Phase 1: plumbing (no visible change).**

A note on the install, because this repo has a documented way to break the
deploy here. `.npmrc` sets `auto-install-peers=false`, and `pnpm-lock.yaml`
records `autoInstallPeers: false` to match. Those two must agree or the CI
build fails. `next-intl@4.14` declares peers on `next` and `react` only, both
already explicit dependencies, so `pnpm add next-intl` is safe as-is. Do not
"fix" any peer warning by flipping that flag.

Then: add `src/i18n/*`, `messages/en.json` (empty
namespaces), wrap `next.config.ts`, add the provider and dynamic `lang` to the
root layout, add the `profiles.locale` migration. App still renders English
from hardcoded strings. Verify: app boots, build passes, Workers preview
passes.

**Phase 2: switcher and end-to-end proof.**
Add `src/i18n/actions.ts` (`setLocale`), a language control in `ProfileMenu`
(it already owns account switching, so it is the established home for
"who/what am I acting as") plus a mirror in `/settings/account`.

**The signed-out gap, which the switcher placement above does not cover.**
`ProfileMenu` only exists behind a session. A Czech seller who has not signed in
yet meets `/login` in English with no way to change it, which is the first
screen a new seller ever sees. There is no `(auth)/layout.tsx` today; the login
page is a self-contained server component that renders its own brand header and
a footer note ("No account yet? Request access"). So phase 2 adds a small
locale control beside that footer note. It writes the cookie only (there is no
profile to write to yet), and the value carries into the session on sign-in.
This is also why the cookie, not the profile column, is the first source in the
resolution order.

Translate ONE
vertical slice end to end, proposed: the orders empty state plus the sidebar
nav labels from `src/lib/search/nav-constants.ts`. `nav-constants.ts` is the
highest-leverage single file in the codebase: one list feeds the dashboard
rail, the settings rail, universal search and the welcome flow.
Verify: switch to `cs`, confirm those surfaces flip and survive a reload.

**Phase 3: test harness.**
`tests/setup/render.tsx` gains `NextIntlClientProvider` inside `AppProviders`.
Only 14 of 72 component specs import that helper today; the other 59 import
`@testing-library/react` directly and will throw the moment their component
calls `useTranslations`. Migrate all 59 to the shared helper in one mechanical
pass BEFORE the bulk extraction, so extraction never lands on a red suite.

**Phase 4: bulk extraction (the real work).**
Area by area, in dependency order, driven by the inventories in `docs/i18n/`.
Each area is a self-contained commit: extract strings to `en.json`, swap call
sites, run that area's specs. Audited counts, in the recommended order:

| # | Area | Findings | Inventory | Why this position |
|---|------|----------|-----------|-------------------|
| 1 | Core: `ui`, auth, orders, analytics, onboarding, dashboard, notifications, layout, search, error, their routes | 174 | [inventory-core.md](../i18n/inventory-core.md) | Establishes the 22 `Common.*` keys every later area reuses; smallest files; covers the signed-out auth pages |
| 2 | Settings + payments | 197 | [inventory-settings-payments.md](../i18n/inventory-settings-payments.md) | Blocked on the delete-phrase decision (section 9) |
| 3 | Products (seller side) | 236 | [inventory-products.md](../i18n/inventory-products.md) | Heavy on plurals (import, gallery, documents) |
| 4 | Storefront editor | 312 | [inventory-storefront.md](../i18n/inventory-storefront.md) | Largest; `StorefrontDesigner.tsx` gets its own commit |
|   | **Phase 4 total** | **919** | | |
|   | `src/lib/**` (phase 5) | ~450 | [inventory-lib.md](../i18n/inventory-lib.md) | Changes server action contracts |
|   | Buyer product page (phase 6) | 43 | [inventory-products.md](../i18n/inventory-products.md), second section | Needs buyer locale; 3 EU statutory notices need legal review per language |
|   | **Grand total** | **~1,412** | | |

Page `metadata` titles are included in the area counts above (22 across the
inventories). Static `export const metadata` cannot call `getTranslations`, so
each one becomes `generateMetadata`.

**Rule for `Common.*`.** Area 1 mints the shared keys (Save, Cancel, Close,
Copy, pagination, stock badges, and so on). Areas 2 to 4 must reuse them and
never add an area-local `Products.save`. Inventories were written in parallel,
so later areas will propose their own versions of these; collapse them during
extraction rather than trusting the proposed key names verbatim.

**Phase 5: non-component copy.**
`src/lib` holds roughly 450 user-facing strings that no hook can reach
(a first crude pass guessed 685; the audit removed internal errors and logs):
`dashboard/attention.ts` (the "Needs attention" rows), `onboarding/steps.ts`,
`notifications/presentation.ts`, `search/nav-constants.ts`, and about 104
validation messages across `src/lib/validation/*`.

These are pure modules shared by client and server, so they cannot call
`useTranslations`. The fix is to make them return **keys plus params** instead
of sentences, and resolve at the render boundary:

```ts
// before
{ label: "Add your trader details", description: "Required before you publish." }
// after
{ labelKey: "Attention.traderDetails.label", descriptionKey: "Attention.traderDetails.description" }
```

Validation is the subtlest case, because `src/lib/validation/settings.ts`
schemas are shared by client hints and server actions, and server actions today
return `error.issues[0]?.message` straight to the UI. Server actions must
return a key (or a stable error code), never a rendered sentence. This phase
changes the shape of several server action return types and is the one most
likely to need its own session.

**Verified scope of that boundary.** Five modules return English prose to the
UI today and must change shape:

- `src/lib/settings/actions.ts` (10 actions, `SettingsActionState`)
- `src/lib/team/actions.ts` (4 actions, `TeamActionState`)
- `src/lib/auth/actions.ts` (2 actions, `AuthState`)
- `src/lib/settings/shipping-actions.ts` (1 action, reuses `SettingsActionState`)
- `src/lib/errors.ts` (every `ActionError` factory)

`firstIssue()` is the amplifier: two definitions (`settings/actions.ts:105`,
`team/actions.ts:72`) feeding 11 call sites, each handing a raw Zod message
straight out of the action. So translating validation is not 110 separate
decisions, it is one decision about what `firstIssue` returns, applied 11
times.

**`errors.ts` is better news than it looks.** It is a single chokepoint by
existing design: the module's own contract says errors are built by the
factories in that file and never as object literals at call sites, and it is
deliberately pure (no `"use server"`, importable from both sides). So making
errors carry keys instead of sentences is a contained edit to one module plus
its render site (`src/components/ui/ActionErrorNotice.tsx`), not a hunt across
the codebase.

**But it does not cover everything, despite its own doc comment.** `errors.ts`
describes `ActionError` as "the ONE user-facing failure shape for server
actions". In practice only `ProductForm` renders `ActionErrorNotice`. The
settings, team and auth actions predate or bypass it and return their own
`SettingsActionState` / `TeamActionState` / `AuthState` shapes with a bare
message string. So phase 5 converts TWO error shapes, not one. An implementer
who trusts the comment will translate `errors.ts`, see product errors work in
Czech, and ship with every settings and team error still in English.

This is also a reasonable moment to consider migrating those three state types
onto `ActionError` rather than teaching three shapes about message keys
separately. That is a real scope increase, though, so treat it as optional and
decide it at the start of phase 5 rather than folding it in silently. The existing `code` field
(`session_expired`, `permission_denied`, and so on) is already the stable
machine-readable half, which is exactly what a message key wants to be keyed
on.

Two wrinkles to plan for. `ActionError` carries a third user-facing string
beyond `message` and `fix`: the optional `action.label`, the text on the button
that resolves the error. And `errors.ts` imports copy from
`team/permissions` (`ROLE_LABELS`) and `settings/trader-identity`
(`TRADER_IDENTITY_HEADLINE`, `traderIdentityFix`), so those two modules have to
be converted in the same pass or the error text ends up half translated.

**ICU plurals needed from day one (9 strings).** `attention.ts` (5),
`notifications/presentation.ts` (3: minutes/hours/days ago), and
`onboarding/steps.ts` (1). Czech needs one/few/many/other for all of these, so
they must be authored as ICU plurals in `en.json` even though English only
distinguishes two forms.

**Phase 6: buyer-facing product page (separate decision).**
Needs buyer locale from `Accept-Language`, which we cannot read in middleware.
Options: resolve server-side per request in the page itself, or offer a
seller-chosen storefront language. Deferred until phases 1 to 5 land.

## 7. Risks

- **Client payload.** Ten locales times roughly 1500 keys. Only the active
  locale ships, but the whole active locale ships to the client by default.
  If it bites, narrow `NextIntlClientProvider` per route group to the
  namespaces that route uses.
- **Workers SSR.** Known open OpenNext issues pair next-intl with hydration
  mismatches and per-isolate state growth on Workers. Must be smoke-tested on
  a real Workers preview at the end of phase 1, not just in `next dev`.
- **e2e suite.** 69 specs contain roughly 559 English copy assertions. They
  stay green because `en` remains the default with no cookie set. Add exactly
  one new spec that flips to `cs` and asserts a known surface, rather than
  parameterising the existing suite.
- **Translation quality.** Machine-translating 1500 strings into 9 languages
  produces confident nonsense in a financial UI ("balance", "payout",
  "shipping profile" are all trap words). Ship `en` plus `cs` with reviewed
  copy first; the other 8 can fall back to English per-key until reviewed
  (next-intl falls back rather than throwing when a key is missing, provided
  the fallback is configured).

## 8. Effort

Phases 1 to 3 are roughly one focused session. Phase 4 is the bulk and is
genuinely multi-session, best done area by area. Phase 5 is its own session
because it changes server action contracts. Phase 6 is a separate piece of
product thinking.

## 9. Open decisions surfaced by the audit

**Checked and safe: the CSV import field labels.** The products audit flagged
`FIELD_LABELS` in `ProductImport.tsx` as possibly doubling as CSV header
matchers. It does not. `guessColumns` in `src/lib/products/csv.ts` matches
against a separate `HEADER_ALIASES` list, and `FIELD_LABELS` is only ever
rendered (`ProductImport.tsx:321`). Translate the labels freely; leave
`HEADER_ALIASES` alone, since Shopify exports use English headers whatever the
seller's language.

**The delete-account confirmation phrase. Decide before phase 4 touches
settings.**

`DELETE_CONFIRM_PHRASE = "delete my account"` (`src/lib/settings/constants.ts`)
is not display copy. It is a value the app compares typed input against, in TWO
places:

- `src/components/settings/DeleteAccountForm.tsx:113`, the client-side gate
- `src/lib/validation/settings.ts:150`, a Zod `.refine()`, which is the REAL
  gate, and whose message at :151 interpolates the phrase into the sentence

Leaving it English means a Czech seller must type an English sentence to delete
their account. Translating it naively breaks the server check, because the
server would have to know which locale the user was reading when they typed.
That is not reliably knowable: the cookie can differ from the profile, and the
locale can change between render and submit.

Recommended: translate the phrase, and have the refine accept the phrase from
ANY supported locale rather than only the active one. The phrase is a
deliberate-friction speed bump, not a secret, so accepting a superset costs
nothing and makes locale drift unable to lock anyone out of deleting their own
account. The sentence around it takes the phrase as an ICU parameter rather
than baking it in.

Alternative, if that feels too clever: keep the phrase permanently English and
translate only the instruction around it, the way GitHub has you type a repo
name. Simpler, slightly worse for a non-English seller.

**Two hardcoded `en-GB` date formatters.** `DeleteAccountForm.tsx:21` and
`LegalSection.tsx:37` call `toLocaleDateString("en-GB", ...)` with the locale
hardcoded, so those dates would stay British in a Czech UI no matter what the
rest of the app does. Only two sites, but they are invisible until someone
notices a date reading the wrong way round. Category G, fix during phase 4.

**Chart formatting.** `chart-format.ts` uses hardcoded currency symbols and
comma thousands separators rather than `Intl`. Czech uses a space as the
thousands separator and puts the currency symbol after the number, so charts
need real formatter wiring, not a string swap.

**Storefront: the `t.rich` count is overstated, and one plural was missed.**
The storefront audit flags 28 strings as needing `t.rich`, including the
`SelectionToolbar` aria-labels. That is a category error for any string that
lands in an ATTRIBUTE. `t.rich` returns React nodes, and an `aria-label` only
accepts a string, so rich text cannot go there at all. Those strings need
ordinary `t()` with an ICU parameter, which is the easy case, not the hard one.
Verified example, `SelectionToolbar.tsx:622`:

```tsx
aria-label={`Tools for ${name}`}          // today
aria-label={t("toolsFor", { name })}      // correct: plain t(), not t.rich
```

The audit's underlying worry is correct and important, though: `name` comes
from `blockLabel()`, which can return a SELLER'S product title. It must go in
as a parameter and must never itself be translated. Treat the real `t.rich`
count as the strings where JSX genuinely interrupts a sentence (a `<Link>` or
`<strong>` mid-copy), which is smaller than 28.

Same file, line 542, not flagged as a plural:

```tsx
const name = only ? blockLabel(only, productsById) : `${blocks.length} elements`;
```

`only` handles the single-block case, so English never shows "1 elements". But
Czech needs a different word for 2 to 4 than for 5 and up ("prvky" versus
"prvků"), so this is an ICU plural like the other nine.

**Genuine hotspot: `StorefrontDesigner.tsx` is 4,239 lines**, with
`DesignerCanvas.tsx` (1,059) and `SelectionToolbar.tsx` (784) behind it.
Threading translations through a file that size in one pass is exactly where a
mechanical extraction goes wrong unnoticed. Convert it in its own commit, and
run the storefront e2e specs against that commit alone before moving on.

---

## Appendix A: inventory contract (for the audit agents)

Agents auditing an area produce `docs/i18n/inventory-<area>.md` and must
classify every finding.

**WRAP these.**

- **A. JSX text nodes.** Any literal sentence or label rendered between tags.
- **B. String props that reach the eye or a screen reader.** `label`,
  `placeholder`, `title`, `aria-label`, `alt`, `description`, `heading`,
  `confirmLabel`, `cancelLabel`, `emptyTitle`, `actionLabel`, and similar.
- **C. Route metadata.** `export const metadata` `title` / `description`.
- **D. Copy constants in `src/lib`.** Arrays and objects of user-facing text.
- **E. Validation messages.** Zod `message:` values and any sentence returned
  from a server action to be displayed.
- **F. Imperative UI strings.** Anything passed to `useToast`, thrown as a
  user-visible error, or used in `confirm`-style dialog copy.
- **G. Locale-sensitive formatting.** Existing `Intl.*`, `toLocaleDateString`,
  `toLocaleString` and currency formatting call sites. These are not string
  extraction, but they need the active locale threaded through, so record them
  in a separate section.

**DO NOT WRAP these. Flagging them is a false positive and costs review time.**

- Seller-authored or buyer-authored data (product titles, storefront copy,
  order notes, uploaded file names).
- Anything under `src/app/dev/`.
- `console.*` messages, thrown internal errors, log prefixes like
  `[seller-identity]`.
- Test files.
- DB values, enum members, API field names, route segments, cookie names.
- `data-*` attribute VALUES (especially `data-analytics-*`), CSS class strings,
  Tailwind tokens, `cn()` arguments.
- ARIA values that are API constants (`role="dialog"`, `aria-haspopup="dialog"`).
  Note: `aria-label` IS user-facing and DOES get wrapped; `role` does not.
- Icon names, font family names, colour tokens.

**Output format.** One row per finding:

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|

Plus, at the top of each inventory: total findings, count per category, the
count of files that are `"use client"` (they need `useTranslations`) versus
server (they need `await getTranslations`), and a list of any file that looks
like it needs restructuring rather than simple extraction (for example, copy
built by string concatenation, or a sentence interrupted by a `<Link>`, which
needs `t.rich` instead of `t`).

---

## Appendix B: implementation conventions

The contract every converted file follows. The foundation it relies on is
already in place; read these files before converting anything:

| File | What it gives you |
|------|-------------------|
| `src/i18n/locales.ts` | `LOCALES`, `Locale`, `parseLocale`, `negotiateLocale` |
| `src/i18n/request.ts` | per-request locale: cookie, then Accept-Language, then `en` |
| `src/i18n/messages.ts` | catalogue loader; missing keys fall back to English |
| `src/i18n/types.ts` | `MessageKey`, `MessageRef`, `msg()` for pure modules |
| `src/i18n/next-intl.d.ts` | types every `t()` call against `messages/en` |
| `messages/en/*.json` | the SOURCE catalogue, one file per namespace |
| `tests/setup/render.tsx` | `render` (translations + toasts), `renderWithoutToasts` |
| `tests/setup/translate.ts` | `english(refOrKey, values)` for asserting on resolved copy |

### B.1 Catalogue

- One JSON file per namespace in `messages/en/`. Write ONLY the namespace files
  your area owns. Never edit another locale's files (the translation pass does)
  and never edit `messages/*/index.ts` (the namespace list is fixed).
- Keys are nested camelCase grouped by surface, then element:
  `Orders.empty.filteredTitle`, `Settings.tax.fields.country.label`. Page
  metadata lives under `<Namespace>.metadata.<page>.title|description`.
- **English moves verbatim.** Character for character, including existing
  punctuation. Specs and 69 e2e files assert on this text. Do not reword, do not
  "fix" copy while extracting it. The only allowed change to English output is
  none.
- Any string that depends on a count is an ICU plural, in English too:
  `{count, plural, one {# product} other {# products}}`. Czech and Polish need
  more categories than English, and they can only add them if the English
  message is a plural to begin with.
- An enumeration the code switches on is an ICU `select`, with `other`:
  `{status, select, paid {Paid} refunded {Refunded} other {Unknown}}`.
- Never build a sentence by joining translated fragments, and never splice a
  translated word into another message as a value. Word order and grammatical
  case differ by language (Czech declines nouns: "product" in "Delete
  {product}?" is not the same form as in "{product} deleted"). Give each
  sentence its own key instead.

### B.2 Call sites

| Where the string renders | Use |
|--------------------------|-----|
| Client component, or any component using hooks | `const t = useTranslations("Ns")` |
| Server component that is NOT `async` | `useTranslations` also works there |
| `async` server component, page, layout, route handler | `const t = await getTranslations("Ns")` (`next-intl/server`) |
| `export const metadata` | becomes `export async function generateMetadata()` using `getTranslations`; keep every non-copy field |
| Pure module in `src/lib` shared by client and server | return a `MessageRef` (`msg("Ns.key", values)`), resolve at the render site |

- Attributes (`aria-label`, `placeholder`, `title`, `alt`) take plain `t()`.
  `t.rich` returns React nodes and cannot go in an attribute.
- Rich text uses `t.rich("key", { link: (chunks) => <Link href="/x">{chunks}</Link> })`.
  **Never** `t.markup`, never `dangerouslySetInnerHTML`, never `t.raw` into
  HTML. `tests/unit/search-input-hardening.test.ts` fails the build on any of
  them: the CSP here is report-only, so having no HTML sink is the defence.
- Data goes in as ICU values, never into the message: a seller's product title,
  a storefront name, an email address, a count.

### B.3 Never translate

Seller- or buyer-authored content; DB values and enum members; API field names;
route segments; cookie names; `data-*` attribute values (especially
`data-analytics-*`); CSS classes; `console.*` text and log prefixes; thrown
errors that never reach a user; anything under `src/app/dev/`; brand names.

`src/app/global-error.tsx` replaces the root layout, so it renders outside the
translation provider and cannot read the request locale. It carries its own
in-file dictionary (`GLOBAL_ERROR_COPY`, one entry per locale, held to
`LOCALES` by `tests/unit/global-error-copy.test.ts`) and picks from it by
`navigator.language` after hydration, English on the server.

### B.4 Formatting

Do not change number, currency, date or relative-time formatting while
extracting strings. A dedicated pass threads the locale through
`src/lib/format*`, the chart formatters and every `Intl`/`toLocale*` call site
at once, so the whole app formats consistently.

### B.5 Tests and verification

- Component specs import from `tests/setup/render`, never RTL directly. If a
  spec asserts on English copy it keeps passing unchanged, because the English
  output does not change.
- When a function's contract changes (it returns a `MessageRef` instead of a
  sentence), update its spec to assert `english(result)` equals the old text.
- Verify with the tools directly, not `pnpm exec` (pnpm's pre-run dependency
  check fails in the worktree on an unrelated ignored-build warning):
  - `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
  - `node node_modules/vitest/vitest.mjs run --project unit <spec files>`
- Do not start dev servers, do not run e2e, do not run `next build`, do not run
  git commands that change state (no commit, stash, checkout, reset).

### B.6 House style

No em dashes in anything you write (comments, copy you author, test names):
use commas, colons or parentheses. Comments only where the reason is not
obvious from the code. Follow the patterns already in the file you are editing.
