# Translation glossary and style guide

The shared reference for everyone translating `messages/en/*.json` into cs, sk,
de, fr, es, it, nl, pl and pt. Keep it open while you work. When this document
and your instinct disagree, this document wins; when it is silent, follow the
closest analogue already in the table.

**Order of authority:** (1) the ICU rules in section 3, because breaking them
breaks the app; (2) the locked names in section 2.3 and the terms in section 4;
(3) register and typography in sections 1 and 2; (4) your judgement.

Contents:

1. [Register and voice](#1-register-and-voice)
2. [Typography and mechanics](#2-typography-and-mechanics)
3. [ICU rules](#3-icu-rules-every-translator-must-follow)
4. [Terminology](#4-terminology)
5. [Legal and statutory terms](#5-legal-and-statutory-terms)
6. [Do not translate](#6-do-not-translate)
7. [Known traps in the English source](#7-known-traps-in-the-english-source)

---

## 1. Register and voice

The English is plain, direct and friendly, addresses the seller as "you", and
never sounds like a bank or a government form. Keep that. Shorter is better;
German and French run about 30% longer than English, and many strings sit in
buttons, tooltips and toolbars.

The same register applies to the buyer-facing `ProductPage` namespace.

| Lang | Address | Pronoun spelling | Buttons, menu items | Instructions in sentences | Why |
|---|---|---|---|---|---|
| **cs** | Formal: vykání | lowercase `vy`, `váš` | Infinitive: `Uložit`, `Přidat produkt` | 2nd person plural imperative: `Přidejte produkt.` | Fixed decision. Modern Czech UI (Google, Shopify cs) writes vy/váš lowercase; stay plain and friendly, never úřednický. |
| **sk** | Formal: vykanie | lowercase `vy`, `váš` | Infinitive: `Uložiť`, `Pridať produkt` | `Pridajte produkt.` | Fixed decision, same approach as cs. |
| **de** | Informal: **du** | lowercase `du`, `dein` | Infinitive: `Speichern`, `Produkt hinzufügen` | du-imperative: `Füge ein Produkt hinzu.` | Shopify's and Etsy's German seller UIs use du, and the audience is creators and indie sellers. Stripe uses Sie, but Stripe's tone is not ours. |
| **fr** | Formal: **vous** | lowercase `vous`, `votre` | Infinitive: `Enregistrer`, `Ajouter un produit` | vous-imperative: `Ajoutez un produit.` | Shopify, Stripe and Etsy France all vouvoient; tutoiement reads as a consumer app, not software people run a business on. |
| **es** | Informal: **tú** (Spain, es-ES vocabulary) | `tú`, `tu` | Infinitive: `Guardar`, `Añadir producto` | tú-imperative: `Añade un producto.` | Shopify, Etsy and Stripe Spanish all tutean. Use Spain's vocabulary (`ordenador`, `móvil`, `ratón`); never vos or ustedes. |
| **it** | Informal: **tu** | `tu`, `tuo` | 2nd singular imperative: `Salva`, `Aggiungi prodotto` | `Aggiungi un prodotto.` | Shopify and Etsy Italia use tu, and Italian UI convention puts the imperative on buttons. |
| **nl** | Informal: **je** (unstressed) | `je`, `jouw` only for stress | Infinitive: `Opslaan`, `Product toevoegen` | Imperative: `Voeg een product toe.` | Shopify, Etsy and Stripe NL all use je; u reads as a bank or a government letter. |
| **pl** | Informal: **ty** | lowercase `ty`, `twój` (no letter-style capital) | 2nd singular imperative: `Zapisz`, `Dodaj produkt` | `Dodaj produkt.` | Shopify and Allegro seller tools address the user as ty with imperatives. Prefer verb forms that make the pronoun unnecessary. |
| **pt** | European Portuguese (pt-PT), formal third person, pronoun dropped | never write `você` or `tu`; use `o seu`, `a sua` | Infinitive: `Guardar`, `Adicionar produto` | Formal imperative: `Adicione um produto.` | Fixed as pt-PT. Explicit `você` is felt as blunt in Portugal; dropping the pronoun is what pt-PT software does. Post-1990 spelling (`ação`, `direto`, `ótimo`). |

### Gender-neutral wording (all languages)

The seller's gender is unknown. Rephrase instead of using slashes, brackets,
stars or colons.

| Lang | Trap | Do instead |
|---|---|---|
| cs, sk | l-participle with vy: `Přijal jste` | Passive or impersonal: `Verze {version} přijata {date}.` |
| pl | 2nd-person past: `zaakceptowałeś` | Impersonal `-no/-to`: `Zaakceptowano wersję {version}.` |
| de | `Käufer:innen`, `Käufer*innen` | Plain generic noun as in section 4, or a neutral word (`Kundschaft`) when it reads naturally. |
| fr | `connecté(e)`, point médian | Rephrase: `Vous êtes connecté` becomes `Session ouverte`. |
| es, it, pt | `conectado/a`, `invitato/a`, `ligado/a` | Rephrase around a noun or verb: `Has recibido una invitación`, `Hai ricevuto un invito`, `Recebeu um convite`. |

---

## 2. Typography and mechanics

### 2.1 Per-language mechanics

| | cs | sk | de | fr | es | it | nl | pl | pt |
|---|---|---|---|---|---|---|---|---|---|
| **Quotes** | „…“ | „…“ | „…“ | « … » | «…» | «…» | “…” | „…” | «…» |
| Nested quotes | ‚…‘ | ‚…‘ | ‚…‘ | “…” | “…” | “…” | ‘…’ | «…» | “…” |
| **Apostrophe** | ’ | ’ | ’ | ’ | ’ | ’ | ’ | ’ | ’ |
| Pending state (ellipsis attached, no space) | `Ukládání…` | `Ukladá sa…` | `Wird gespeichert…` | `Enregistrement…` | `Guardando…` | `Salvataggio…` | `Opslaan…` | `Zapisywanie…` | `A guardar…` |
| "e.g." | `např.` | `napr.` | `z. B.` | `p. ex.` | `p. ej.` | `es.` | `bijv.` | `np.` | `p. ex.` |
| Number and % | `50 %` | `50 %` | `50 %` | `50 %` (U+202F) | `50 %` | `50%` | `50%` | `50%` | `50%` |
| Decimal mark in examples | `9,00` | `9,00` | `9,00` | `9,00` | `9,00` | `9,00` | `9,00` | `9,00` | `9,00` |
| File size units | MB, KB | MB, KB | MB, KB | **Mo, Ko** | MB, KB | MB, KB | MB, KB | MB, KB | MB, KB |
| Capitalisation | Sentence case | Sentence case | Sentence case, all nouns capitalised | Sentence case | Sentence case | Sentence case | Sentence case | Sentence case | Sentence case |
| Inverted marks | | | | | `¿…?` `¡…!` | | | | |

Notes on the table:

- **Quote characters by code point**, because they are easy to get wrong:
  cs, sk, de open with U+201E „ and close with U+201C “. pl opens with U+201E „
  and closes with U+201D ”. nl uses U+201C “ and U+201D ”. es, it and pt use
  « » (U+00AB, U+00BB) with no inner spaces.
- **French spacing.** Put U+202F (narrow no-break space) inside « » and before
  `;` `!` `?` and `%`; put U+00A0 (no-break space) before `:`. Type the actual
  character, never a ` ` escape: agent write tools have been seen to mangle
  backslash-u sequences. These spaces are invisible, so check them.
- **Spaces between numbers and units** (`2 MB`, `10 px`, `500 ml`) are
  no-break spaces (U+00A0) in every language.
- **Pending states** ("Saving…", "Uploading…") always end in the single
  character `…` (U+2026). The English sometimes has three dots (`Saving...`,
  `Rotating...`); write `…` anyway.
- **Title Case never.** Headings, buttons, tabs and menu items are sentence
  case in every language. German capitalises nouns because German does, not
  because it is a heading. Days and months are lowercase except in German.
- **Role names** (Owner, Editor, Viewer) are capitalised in English mid-sentence.
  Capitalise them only where they stand alone as a label; mid-sentence they
  follow normal grammar (`jako editor`, `en tant qu’éditeur`).
- **Example values in placeholders** (`e.g. 9.00`, `e.g. €9.00`,
  `e.g. 5-7 business days`) should be localised: decimal comma, the currency
  symbol where your language puts it (`9,00 €`). The price and measurement
  parsers accept a decimal comma.

### 2.2 Dashes and separators

- **No em dashes (U+2014), ever.** House style, and
  `tests/unit/i18n-messages.test.ts` fails the build on one. The English source
  still contains some (and `--` in a few storefront strings): rewrite those with
  a comma, colon or parentheses. Do not substitute `--` or a spaced en dash.
- An en dash (U+2013) is fine **only** for ranges: `A–Z`, `1–3`.
- Keep these separators exactly as in English: ` · ` (middle dot with spaces),
  ` › ` (U+203A with spaces, navigation paths), ` / ` (panel subtitles such as
  `Storefront / Theme`), ` | ` (page title template).

### 2.3 Locked page names and navigation paths

These names come from `Nav.json` and `Settings.json`. Translate them once, here,
and every message that mentions a page must use exactly this wording in the
nominative. `&` becomes your language's word for "and".

| EN (key) | cs | sk | de | fr | es | it | nl | pl | pt |
|---|---|---|---|---|---|---|---|---|---|
| Overview (`Nav.main.overview.label`) | Přehled | Prehľad | Übersicht | Vue d’ensemble | Resumen | Panoramica | Overzicht | Przegląd | Visão geral |
| Products | Produkty | Produkty | Produkte | Produits | Productos | Prodotti | Producten | Produkty | Produtos |
| Storefront | Výloha | Výklad | Schaufenster | Vitrine | Escaparate | Vetrina | Etalage | Witryna | Montra |
| Orders | Objednávky | Objednávky | Bestellungen | Commandes | Pedidos | Ordini | Bestellingen | Zamówienia | Encomendas |
| Analytics | Analytika | Analytika | Analysen | Statistiques | Estadísticas | Statistiche | Statistieken | Analityka | Estatísticas |
| Payments | Platby | Platby | Zahlungen | Paiements | Pagos | Pagamenti | Betalingen | Płatności | Pagamentos |
| Settings | Nastavení | Nastavenia | Einstellungen | Paramètres | Configuración | Impostazioni | Instellingen | Ustawienia | Definições |
| Account (`Nav.settings.account`) | Účet | Účet | Konto | Compte | Cuenta | Account | Account | Konto | Conta |
| Legal | Právní informace | Právne informácie | Rechtliches | Informations juridiques | Información legal | Note legali | Juridisch | Informacje prawne | Informação legal |
| Business & seller details | Firma a údaje prodejce | Firma a údaje predajcu | Unternehmen und Verkäuferangaben | Entreprise et informations vendeur | Empresa y datos del vendedor | Attività e dati del venditore | Bedrijfs- en verkopersgegevens | Firma i dane sprzedawcy | Empresa e dados do vendedor |
| Shipping & returns | Doprava a vrácení zboží | Doprava a vrátenie tovaru | Versand und Rücksendungen | Livraison et retours | Envíos y devoluciones | Spedizioni e resi | Verzending en retouren | Wysyłka i zwroty | Envios e devoluções |
| Notifications | Oznámení | Upozornenia | Benachrichtigungen | Notifications | Notificaciones | Notifiche | Meldingen | Powiadomienia | Notificações |
| Team & access | Tým a přístup | Tím a prístup | Team und Zugriff | Équipe et accès | Equipo y acceso | Team e accessi | Team en toegang | Zespół i dostęp | Equipa e acesso |
| Danger zone | Nebezpečná zóna | Nebezpečná zóna | Gefahrenzone | Zone de danger | Zona de peligro | Zona pericolosa | Gevarenzone | Strefa niebezpieczna | Zona de perigo |
| Language (`LocaleSwitcher.label`) | Jazyk | Jazyk | Sprache | Langue | Idioma | Lingua | Taal | Język | Idioma |

**Navigation paths.** `Settings › Business & seller details` keeps the ` › `
separator and uses the two names above, unchanged and uninflected. Let the
surrounding sentence do the grammar:

| Lang | "Add your trader name in Settings › Business & seller details, then publish." |
|---|---|
| cs | `Doplňte obchodní jméno v sekci Nastavení › Firma a údaje prodejce a pak zveřejněte.` |
| de | `Trage deinen Händlernamen unter Einstellungen › Unternehmen und Verkäuferangaben ein und veröffentliche dann.` |
| fr | `Ajoutez votre raison sociale dans Paramètres › Entreprise et informations vendeur, puis publiez.` |
| pl | `Dodaj nazwę przedsiębiorcy w sekcji Ustawienia › Firma i dane sprzedawcy, a potem opublikuj.` |

The same applies to `Storefront / Theme`-style subtitles: `Výloha / Motiv`,
`Schaufenster / Theme`, `Vitrine / Thème`.

### 2.4 Cross-references to other labels

Some messages name a button, switch or section that has its own key. Look the
target up and use its translation verbatim, or the seller will look for a
label that does not exist.

| Mentioned in English as | Source of truth |
|---|---|
| Track stock | `Products.stockFields.trackStock` |
| Media and delivery | `Products.form.sections.media.label` |
| Shipping (product form section) | `Products.form.sections.shipping.label` |
| Active, Draft | `Products.status.active`, `Products.status.draft` |
| Seller section, Safety and compliance | `ProductPage.sections.seller`, `ProductPage.sections.safety` |
| Sold by (`“Sold by” byline`) | `ProductPage.soldBy`, without `{seller}` |
| Only N left | `Common.stock.lowStock` |
| Hide from buyers | `Storefront.soldOut.hide` |
| Add product (toolbar) | `Storefront.toolbar.addProduct` |
| Typography | `Storefront.settings.groups.typography` |
| Untitled storefront | `Storefront.designer.header.namePlaceholder` |
| Copy button (embed hint) | `Common.actions.copy` |
| Seller details, Settings, Team settings, Team & access | Section 2.3 |
| Editor (role, in `Errors.permissionDenied.fix`) | `Settings.team.roles.editor.label` |
| "Resend" (`Errors.settings.savedButConfirmationFailed`) | `Settings.tax.resend.button` (the English does not match it exactly; quote your translated button) |
| Search (onboarding tour) | `Search.trigger.label` |

---

## 3. ICU rules every translator must follow

`tests/unit/i18n-messages.test.ts` enforces most of this: every locale must
have exactly the English keys, every message must parse, and every message must
take the same arguments, rich-text tags and select branches as English. A
failure there blocks the release.

### 3.1 Never change

| Thing | Example | Rule |
|---|---|---|
| Placeholders | `{title}`, `{count}`, `{storeName}` | Never rename, translate or drop. You may move them. |
| Argument types | `{count, plural, …}`, `{role, select, …}` | Never add `, number` or `, date` or change plural to select. |
| Select branch keys | `owner`, `editor`, `viewer`, `yes`, `true`, `incl`, `top_left`, `businessName_address`, `startFailed` | Copy verbatim. They are data values the code passes in. Translate only the text inside the braces. |
| `other` branch | every `plural` and `select` | Always present, even when English leaves it empty (`other {}`): keep it empty. |
| Exact plural matches | `=0 {…}`, `=1 {…}` | Keep them. Do not add new ones. |
| Rich-text tags | `<link>`, `<strong>`, `<store>`, `<address>`, `<code>`, `<count>`, `<seller>`, `<brand>`, `<kbd>` | Same tag names, same number, balanced. You may move a tag within the sentence. Keep a placeholder inside its tag if English has it inside (`<store>{storeName}</store>`). |
| Pass-through messages | `"{detail}"`, `"{message}"`, `"{text}"`, `"%s \| Square Share"` | Copy as is. `%s` is a template slot. |
| Leading spaces | `" · read-only"`, `" (opens in a new tab)"`, `" (done)"`, `" (to do)"`, `" · updated {date}"`, `" · Product page"` | Keep the leading space; these are appended to other text. |
| Newlines | `\n` in address and "What's included" placeholders | Keep them. |
| Structure | keys, nesting, empty objects `{}`, key order | Identical to English. UTF-8, 2-space indent. |

### 3.2 Placeholders cannot inflect

A placeholder's value is inserted as is: a seller's product title, a store name,
an option group name, a country name, an email. It is always nominative (and in
some cases English). Build the sentence so a nominative noun fits, usually with
apposition or a colon. This matters most for cs, sk, pl and de.

| Weak | Strong |
|---|---|
| cs `Smazat {title}?` (expects accusative) | `Smazat produkt „{title}“?` |
| pl `Usuń {name} z zespołu` | `Usunąć osobę {name} z zespołu?` or `Usuń z zespołu: {name}` |
| cs `Nedostupné v této {group}` | `Nedostupné pro možnost: {group}` |

Select branches, by contrast, are yours to inflect: in
`Make {name} {role, select, owner {owner} editor {editor} …}?` Czech writes
`Udělat z {name} {role, select, owner {vlastníka} editor {editora} viewer {čtenáře} other {{role}}}?`
Inflect inside the branch, never the key.

### 3.3 Plurals: the exact categories per language

Write **every** category listed for your language, in every plural, even when
English has only `one` and `other`, and even when English's two branches are
identical (`{count} in stock`). English `other`-only plurals
(`{seconds, plural, other {Resend in #s}}`) also get the full set if your
wording changes with the number.

| Lang | Categories to write | What lands where (integers) | The trap |
|---|---|---|---|
| **cs** | `one` `few` `many` `other` | 1 → one; 2-4 → few; 0 and 5+ → other | `many` is **decimals only** (1,5): genitive singular `1,5 produktu`. The "5 products" form `produktů` goes in `other`. |
| **sk** | `one` `few` `many` `other` | same as cs | `many` = decimals (`1,5 produktu`); `other` = `5 produktov`. |
| **pl** | `one` `few` `many` `other` | 1 → one; 2-4, 22-24, 32-34 … → few; 0, 5-21, 25-31 … (incl. 12-14) → many | The opposite of Czech: **`many` holds `5 produktów`**, `other` is decimals (`1,5 produktu`). |
| **de** | `one` `other` | 1 → one | |
| **nl** | `one` `other` | 1 → one | |
| **fr** | `one` `many` `other` | **0 and 1 → one**; exact millions → many | `0 produit` is correct French, so `one` is fine for zero. `many` takes `de`: `{count} de produits`. |
| **es** | `one` `many` `other` | 1 → one; exact millions → many | `many`: `{count} de productos`. |
| **it** | `one` `many` `other` | 1 → one; exact millions → many | `many`: `{count} di prodotti`. |
| **pt** | `one` `many` `other` | 1 → one; **0 → other**; exact millions → many | The app's locale code is `pt-PT` (catalogue folder `messages/pt-PT/`), so European rules apply: `0 produtos` falls in `other` with no extra branch. `many`: `{count} de produtos`. |

Worked examples (English: `{count, plural, one {{count} product} other {{count} products}}`):

```
cs  {count, plural, one {{count} produkt} few {{count} produkty} many {{count} produktu} other {{count} produktů}}
sk  {count, plural, one {{count} produkt} few {{count} produkty} many {{count} produktu} other {{count} produktov}}
pl  {count, plural, one {{count} produkt} few {{count} produkty} many {{count} produktów} other {{count} produktu}}
de  {count, plural, one {{count} Produkt} other {{count} Produkte}}
fr  {count, plural, one {{count} produit} many {{count} de produits} other {{count} produits}}
es  {count, plural, one {{count} producto} many {{count} de productos} other {{count} productos}}
it  {count, plural, one {{count} prodotto} many {{count} di prodotti} other {{count} prodotti}}
nl  {count, plural, one {{count} product} other {{count} producten}}
pt  {count, plural, one {{count} produto} many {{count} de produtos} other {{count} produtos}}
```

**`{count}` versus `#`.** Mirror the English: where English writes `{count}`
(or `{total}`, `{remaining}`) inside the branch, keep that placeholder; where
English writes `#`, keep `#`. Do not convert either way. In nested plurals `#`
means the **innermost** plural's number: in
`Storefront.designer.toasts.draftsDetail`, `# more` is `{hidden}`, not `{count}`.

**Other messages that count.** A plural governs everything it wraps, so a verb
or adjective that agrees with the number goes inside the branch
(`{count, plural, one {Zbývá {count} kus} few {Zbývají {count} kusy} …}`).

### 3.4 Apostrophes and literal braces

ICU treats a straight apostrophe `'` as an escape character when it touches
`{`, `}` or (inside a plural) `#`. French and Italian elisions hit this
constantly. Tested against the `intl-messageformat` build this app ships:

| You write | It renders |
|---|---|
| `de l'{store}` | `de l{store}` (**broken**: placeholder is lost, apostrophe vanishes) |
| `{n, plural, other {l'# articles}}` | **parse error** |
| `de l’{store}` | `de l’Atelier` (correct) |
| `de l''{store}` | `de l'Atelier` (works, but straight) |
| `l'artiste {name}` | `l'artiste Eva` (works only because the `'` touches no brace) |

**Rule: use the typographic apostrophe ’ (U+2019) for every apostrophe, in
every language.** It is also the correct typographic character, needs no JSON
escaping, and can never be misread by ICU. Never leave a straight `'` next to
`{`, `}` or `#`.

- A doubled `''` in the English source (`Couldn''t`, `we''ll` in
  `storefront.json`) is ICU for one apostrophe. Do not copy the doubling; write
  your language's ’.
- Literal braces are written `'{'` and `'}'`. The only instance is
  `Errors.productPageApi.notObject` (`'{'"ctaColor": "#1d4ed8"'}'`): copy that
  code sample exactly.
- Straight double quotes inside JSON need `\"`. Your language's typographic
  quotes (section 2.1) need no escaping, so prefer them.

---

## 4. Terminology

One English concept, one word per language. If English uses two words for the
same thing (tile and card, buy link and purchase link, designer and editor, log
out and sign out, version and variant), use the single term given here for
both.

### 4.1 Surfaces and the storefront editor

| EN | cs | sk | de | fr | es | it | nl | pl | pt | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| store (the seller's shop) | obchod | obchod | Shop | boutique | tienda | negozio | winkel | sklep | loja | Never the same word as storefront. |
| storefront | výloha | výklad | Schaufenster | vitrine | escaparate | vetrina | etalage | witryna | montra | The designed grid. pl: in this UI "witryna" never means website; say "strona internetowa" for the seller's own site. |
| product page | produktová stránka | produktová stránka | Produktseite | page produit | página de producto | pagina prodotto | productpagina | strona produktu | página do produto | Hosted page per product. es: not "ficha de producto". |
| storefront editor, designer | editor výlohy | editor výkladu | Schaufenster-Editor | éditeur de vitrine | editor del escaparate | editor della vetrina | etalage-editor | edytor witryny | editor da montra | English uses both words for the same tool. |
| canvas | plátno | plátno | Arbeitsfläche | canevas | lienzo | area di lavoro | canvas | obszar roboczy | tela | |
| grid | mřížka | mriežka | Raster | grille | cuadrícula | griglia | raster | siatka | grelha | |
| block | blok | blok | Block | bloc | bloque | blocco | blok | blok | bloco | Any item on the grid. |
| tile, card (product) | dlaždice | dlaždica | Kachel | vignette | tarjeta | riquadro | tegel | kafelek | cartão | "Card style", "Product cards", "Tile layout" all mean this. |
| element (uploaded image block) | prvek | prvok | Element | élément | elemento | elemento | element | element | elemento | |
| shape | tvar | tvar | Form | forme | forma | forma | vorm | kształt | forma | |
| layer | vrstva | vrstva | Ebene | calque | capa | livello | laag | warstwa | camada | |
| bring to front / send to back | Přenést do popředí / Přesunout do pozadí | Presunúť do popredia / Presunúť do pozadia | In den Vordergrund / In den Hintergrund | Mettre au premier plan / Mettre à l’arrière-plan | Traer al frente / Enviar al fondo | Porta in primo piano / Porta in fondo | Naar voorgrond / Naar achtergrond | Przesuń na wierzch / Przesuń na spód | Trazer para a frente / Enviar para trás | Forward/backward: one step (`o vrstvu výš`, `eine Ebene nach vorne`). |
| theme | motiv | motív | Theme | thème | tema | tema | thema | motyw | tema | |
| look (preset) | vzhled | vzhľad | Look | apparence | aspecto | aspetto | uitstraling | wygląd | aspeto | Must differ from "style". |
| style | styl | štýl | Stil | style | estilo | stile | stijl | styl | estilo | Tile style, title style. |
| header (store name and bio) | záhlaví | hlavička | Kopfbereich | en-tête | encabezado | intestazione | koptekst | nagłówek | cabeçalho | |
| bio | medailonek | medailón | Kurzbio | bio | presentación | bio | bio | bio | biografia | |
| accent colour | barva zvýraznění | farba zvýraznenia | Akzentfarbe | couleur d’accent | color de acento | colore d’accento | accentkleur | kolor akcentu | cor de destaque | |
| price tag | cenovka | cenovka | Preisschild | étiquette de prix | etiqueta de precio | cartellino del prezzo | prijslabel | etykieta z ceną | etiqueta de preço | |
| buy button | tlačítko nákupu | tlačidlo nákupu | Kauf-Button | bouton d’achat | botón de compra | pulsante di acquisto | koopknop | przycisk zakupu | botão de compra | |
| buy link, purchase link | odkaz na nákup | odkaz na nákup | Kauflink | lien d’achat | enlace de compra | link di acquisto | aankooplink | link do zakupu | link de compra | Same field under two English names. |
| embed (verb) | vložit na web | vložiť na web | einbetten | intégrer | insertar | incorporare | insluiten | osadzić | incorporar | |
| embed (noun; also the analytics/orders channel) | vložení na web | vloženie na web | Einbettung | intégration | inserción | incorporamento | insluiting | osadzenie | incorporação | Channel label may drop "na web". |
| embed snippet, snippet | kód pro vložení | kód na vloženie | Einbettungscode | code d’intégration | código de inserción | codice di incorporamento | insluitcode | kod do osadzenia | código de incorporação | YouTube's wording in each language. |
| embed key / rotate the key | klíč / vyměnit klíč | kľúč / vymeniť kľúč | Schlüssel / Schlüssel erneuern | clé / renouveler la clé | clave / regenerar la clave | chiave / rigenera la chiave | sleutel / sleutel vernieuwen | klucz / wygeneruj nowy klucz | chave / renovar a chave | "Rotate" means issue a new key and kill the old one. |
| allowed domains | povolené domény | povolené domény | zugelassene Domains | domaines autorisés | dominios permitidos | domini consentiti | toegestane domeinen | dozwolone domeny | domínios permitidos | |
| widget | widget | widget | Widget | widget | widget | widget | widget | widget | widget | |
| draft | koncept | koncept | Entwurf | brouillon | borrador | bozza | concept | wersja robocza | rascunho | |
| active (product status) | aktivní | aktívny | aktiv | actif | activo | attivo | actief | aktywny | ativo | |
| live (visible to buyers) | zveřejněný | zverejnený | online | en ligne | publicado | pubblicato | online | opublikowany | publicado | |
| publish | zveřejnit | zverejniť | veröffentlichen | publier | publicar | pubblicare | publiceren | opublikować | publicar | |
| unpublish | zrušit zveřejnění | zrušiť zverejnenie | Veröffentlichung zurücknehmen | retirer la publication | dejar de publicar | annullare la pubblicazione | publicatie intrekken | cofnąć publikację | anular a publicação | |
| preview | náhled | náhľad | Vorschau | aperçu | vista previa | anteprima | voorbeeld | podgląd | pré-visualização | |
| undo / redo | Zpět / Znovu | Späť / Znova | Rückgängig / Wiederholen | Annuler / Rétablir | Deshacer / Rehacer | Annulla / Ripeti | Ongedaan maken / Opnieuw | Cofnij / Ponów | Anular / Refazer | |
| duplicate | duplikovat | duplikovať | duplizieren | dupliquer | duplicar | duplica | dupliceren | duplikuj | duplicar | |
| hover | najetí myší | prejdenie myšou | Mouseover | survol | pasar el ratón | passaggio del mouse | aanwijzen | najechanie kursorem | passar o rato | |
| font | písmo | písmo | Schriftart | police | fuente | font | lettertype | czcionka | tipo de letra | es: analytics "source" is therefore "origen". |
| upload | nahrát | nahrať | hochladen | importer | subir | caricare | uploaden | przesłać | carregar | fr: never "télécharger" (that is download). |
| download (digital product) | stažení | stiahnutie | Download | téléchargement | descarga | download | download | pobranie | transferência | pt-PT verb: transferir. |
| display image | hlavní obrázek | hlavný obrázok | Titelbild | image principale | imagen principal | immagine principale | hoofdafbeelding | zdjęcie główne | imagem principal | |
| photo | fotka | fotka | Foto | photo | foto | foto | foto | zdjęcie | fotografia | |
| alt text | alternativní text | alternatívny text | Alternativtext | texte alternatif | texto alternativo | testo alternativo | alt-tekst | tekst alternatywny | texto alternativo | |
| search engine listing, indexing | indexování ve vyhledávačích | indexovanie vo vyhľadávačoch | Indexierung durch Suchmaschinen | indexation par les moteurs de recherche | indexación en buscadores | indicizzazione nei motori di ricerca | indexering door zoekmachines | indeksowanie w wyszukiwarkach | indexação nos motores de pesquisa | |

### 4.2 Products and stock

| EN | cs | sk | de | fr | es | it | nl | pl | pt | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| product | produkt | produkt | Produkt | produit | producto | prodotto | product | produkt | produto | |
| title (of a product) | název | názov | Titel | titre | título | titolo | titel | nazwa | título | cs: not "titulek". |
| price | cena | cena | Preis | prix | precio | prezzo | prijs | cena | preço | |
| currency | měna | mena | Währung | devise | moneda | valuta | valuta | waluta | moeda | |
| option group | skupina možností | skupina možností | Optionsgruppe | groupe d’options | grupo de opciones | gruppo di opzioni | optiegroep | grupa opcji | grupo de opções | "What varies": colour, size. |
| option | možnost | možnosť | Option | option | opción | opzione | optie | opcja | opção | One value: "Red", "M". |
| version (a variant the buyer picks) | varianta | variant | Variante | variante | variante | variante | variant | wariant | variante | Never "verze/Version/versión": that word is for legal and order versions. |
| swatch | barevný vzorek | farebná vzorka | Farbfeld | pastille de couleur | muestra de color | campione di colore | kleurstaal | próbka koloru | amostra de cor | |
| specifications | specifikace | špecifikácie | technische Daten | caractéristiques techniques | especificaciones | specifiche | specificaties | specyfikacja | especificações | |
| manufacturer | výrobce | výrobca | Hersteller | fabricant | fabricante | fabbricante | fabrikant | producent | fabricante | GPSR (EU) 2023/988 term. |
| EU responsible person | odpovědná osoba v EU | zodpovedná osoba v EÚ | verantwortliche Person in der EU | personne responsable dans l’UE | persona responsable en la UE | persona responsabile nell’UE | verantwoordelijke persoon in de EU | osoba odpowiedzialna w UE | pessoa responsável na UE | GPSR term. |
| safety and compliance | bezpečnost a shoda | bezpečnosť a zhoda | Sicherheit und Konformität | sécurité et conformité | seguridad y cumplimiento | sicurezza e conformità | veiligheid en conformiteit | bezpieczeństwo i zgodność | segurança e conformidade | |
| bestseller | nejprodávanější | najpredávanejší | Bestseller | meilleure vente | más vendido | più venduto | bestseller | bestseller | mais vendido | |
| stock (quantity) | zásoby | zásoby | Lagerbestand | stock | existencias | scorte | voorraad | stan magazynowy | stock | pt-PT says "stock". |
| in stock | skladem | na sklade | auf Lager | en stock | en stock | disponibile | op voorraad | dostępny | em stock | |
| sold out | vyprodáno | vypredané | ausverkauft | épuisé | agotado | esaurito | uitverkocht | wyprzedany | esgotado | Agree with the noun where grammar needs it. |
| low stock | docházející zásoby | dochádzajúce zásoby | geringer Bestand | stock faible | pocas existencias | scorte in esaurimento | lage voorraad | niski stan | stock baixo | |
| "Only N left" badge | Zbývá jen {n} (plural!) | Zostáva len {n} | Nur noch {n} | Plus que {n} | Solo quedan {n} | Ne restano solo {n} | Nog maar {n} | Zostało tylko {n} | Só restam {n} | Verb agrees with the number in cs, sk, pl, es, it, pt: put it inside plural branches. |
| track stock | sledovat zásoby | sledovať zásoby | Bestand verfolgen | suivre le stock | controlar existencias | monitora le scorte | voorraad bijhouden | śledź stan magazynowy | controlar o stock | |
| maximum per order | maximum na objednávku | maximum na objednávku | Maximum pro Bestellung | maximum par commande | máximo por pedido | massimo per ordine | maximaal per bestelling | maksymalnie na zamówienie | máximo por encomenda | |
| SKU | SKU | SKU | SKU | SKU | SKU | SKU | SKU | SKU | SKU | Do not translate. |

### 4.3 People, identity and team

| EN | cs | sk | de | fr | es | it | nl | pl | pt | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| seller | prodejce | predajca | Verkäufer | vendeur | vendedor | venditore | verkoper | sprzedawca | vendedor | UI word. Statutory texts use section 5. |
| buyer | kupující | kupujúci | Käufer | acheteur | comprador | acquirente | koper | kupujący | comprador | |
| creator | tvůrce | tvorca | Creator | créateur | creador | creator | maker | twórca | criador | "Creator dashboard" tagline. |
| seller details | údaje prodejce | údaje predajcu | Verkäuferangaben | informations vendeur | datos del vendedor | dati del venditore | verkopersgegevens | dane sprzedawcy | dados do vendedor | The name + address + email block. |
| trader identity | identifikace obchodníka | identifikácia obchodníka | Anbieterkennzeichnung | identité du professionnel | identidad del comerciante | identità del professionista | identiteit van de handelaar | dane identyfikujące przedsiębiorcę | identificação do profissional | Rarely on screen; prefer "seller details". de: the Impressum concept. |
| trader name, business name | obchodní jméno | obchodné meno | Händlername | raison sociale ou nom | nombre o razón social | ragione sociale o nome | handelsnaam | nazwa przedsiębiorcy | nome ou denominação social | Registered business name, or own full name for individuals. Not the shop name. |
| business address | adresa sídla | adresa sídla | Geschäftsadresse | adresse professionnelle | dirección comercial | indirizzo della sede | vestigingsadres | adres firmy | morada comercial | pt-PT: "morada", not "endereço". |
| contact email | kontaktní e-mail | kontaktný e-mail | Kontakt-E-Mail | e-mail de contact | correo electrónico de contacto | email di contatto | contact-e-mailadres | e-mail kontaktowy | e-mail de contacto | Shown to buyers. |
| sign-in email | přihlašovací e-mail | prihlasovací e-mail | Anmelde-E-Mail | e-mail de connexion | correo de inicio de sesión | email di accesso | inlog-e-mailadres | e-mail do logowania | e-mail de início de sessão | Deliberately separate from contact email. |
| VAT ID | DIČ | IČ DPH | USt-IdNr. | n° de TVA intracommunautaire | NIF-IVA | partita IVA | btw-id | numer VAT UE | NIF | sk: IČ DPH, not DIČ. Localise the example: `CZ12345678`, `SK1234567890`, `DE123456789`, `FR12345678901`, `ESB12345678`, `IT12345678901`, `NL123456789B01`, `PL1234567890`, `PT123456789`. |
| VAT | DPH | DPH | MwSt. | TVA | IVA | IVA | btw | VAT | IVA | |
| incl. VAT / excl. tax | vč. DPH / bez daně | vr. DPH / bez dane | inkl. MwSt. / zzgl. Steuern | TTC / HT | IVA incluido / impuestos no incluidos | IVA inclusa / tasse escluse | incl. btw / excl. belasting | z VAT / bez podatku | IVA incluído / sem impostos | English says "tax", not "VAT", for excl.: keep that asymmetry. |
| username, handle | uživatelské jméno | používateľské meno | Benutzername | nom d’utilisateur | nombre de usuario | nome utente | gebruikersnaam | nazwa użytkownika | nome de utilizador | Placeholder `yourhandle` must stay `[a-z0-9_]` (no accents). |
| profile photo | profilová fotka | profilová fotka | Profilbild | photo de profil | foto de perfil | foto del profilo | profielfoto | zdjęcie profilowe | fotografia de perfil | |
| account | účet | účet | Konto | compte | cuenta | account | account | konto | conta | |
| dashboard | panel | panel | Dashboard | tableau de bord | panel | dashboard | dashboard | panel | painel | |
| team | tým | tím | Team | équipe | equipo | team | team | zespół | equipa | |
| member | člen | člen | Mitglied | membre | miembro | membro | lid | członek | membro | |
| role | role | rola | Rolle | rôle | rol | ruolo | rol | rola | função | |
| Owner (role) | Vlastník | Vlastník | Inhaber | Propriétaire | Propietario | Proprietario | Eigenaar | Właściciel | Proprietário | |
| Editor (role) | Editor | Editor | Bearbeiter | Éditeur | Editor | Editor | Bewerker | Edytor | Editor | |
| Viewer (role) | Čtenář | Čitateľ | Betrachter | Lecteur | Lector | Visualizzatore | Lezer | Przeglądający | Leitor | Google Workspace's role names in each language. |
| invite (noun / verb) | pozvánka / pozvat | pozvánka / pozvať | Einladung / einladen | invitation / inviter | invitación / invitar | invito / invitare | uitnodiging / uitnodigen | zaproszenie / zaprosić | convite / convidar | |
| access | přístup | prístup | Zugriff | accès | acceso | accesso | toegang | dostęp | acesso | |
| read-only | jen pro čtení | len na čítanie | nur Lesezugriff | lecture seule | solo lectura | sola lettura | alleen-lezen | tylko do odczytu | só de leitura | |

### 4.4 Money and payments

| EN | cs | sk | de | fr | es | it | nl | pl | pt | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| payment | platba | platba | Zahlung | paiement | pago | pagamento | betaling | płatność | pagamento | |
| payout | výplata | výplata | Auszahlung | virement | transferencia | bonifico | uitbetaling | wypłata | transferência | Money sent to the seller's bank. es, it, pt: never the Payments word. |
| payout method | způsob výplaty | spôsob výplaty | Auszahlungsmethode | mode de virement | método de transferencia | metodo di bonifico | uitbetalingsmethode | metoda wypłaty | método de transferência | |
| balance | zůstatek | zostatok | Saldo | solde | saldo | saldo | saldo | saldo | saldo | |
| available | k dispozici | k dispozícii | verfügbar | disponible | disponible | disponibile | beschikbaar | dostępne | disponível | |
| pending | čekající | čakajúce | ausstehend | en attente | pendiente | in sospeso | in behandeling | oczekujące | pendente | Same word for payout, balance and order status. |
| in transit | na cestě | na ceste | unterwegs | en transit | en tránsito | in transito | onderweg | w drodze | em trânsito | |
| accepting payments (Stripe "Charges") | přijímání plateb | prijímanie platieb | Zahlungsannahme | encaissements | cobros | incassi | betalingen ontvangen | przyjmowanie płatności | cobranças | |
| sale | prodej | predaj | Verkauf | vente | venta | vendita | verkoop | sprzedaż | venda | |
| revenue | tržby | tržby | Umsatz | chiffre d’affaires | ingresos | ricavi | omzet | przychód | receita | |
| average order value | průměrná hodnota objednávky | priemerná hodnota objednávky | durchschnittlicher Bestellwert | panier moyen | valor medio del pedido | valore medio dell’ordine | gemiddelde orderwaarde | średnia wartość zamówienia | valor médio da encomenda | |
| order | objednávka | objednávka | Bestellung | commande | pedido | ordine | bestelling | zamówienie | encomenda | pt-PT: not "pedido". |
| checkout | pokladna | pokladňa | Checkout | paiement | proceso de pago | checkout | afrekenen | realizacja zakupu | finalização da compra | |
| refund | vrácení peněz | vrátenie peňazí | Rückerstattung | remboursement | reembolso | rimborso | terugbetaling | zwrot środków | reembolso | cs, sk, pl: always name the money so it is never read as a goods return. |
| dispute | spor | spor | Zahlungsanfechtung | litige | disputa | contestazione | geschil | spór | disputa | Stripe's term in each language. |
| fee | poplatek | poplatok | Gebühr | frais | comisión | commissione | kosten | opłata | taxa | |
| platform fee | poplatek platformy | poplatok platformy | Plattformgebühr | frais de plateforme | comisión de la plataforma | commissione della piattaforma | platformkosten | opłata platformy | taxa da plataforma | |
| processing fee | poplatek za zpracování platby | poplatok za spracovanie platby | Transaktionsgebühr | frais de traitement | comisión de procesamiento | commissione di elaborazione | transactiekosten | opłata za obsługę płatności | taxa de processamento | |
| net (to your balance) | čistá částka | čistá suma | Nettobetrag | montant net | importe neto | importo netto | nettobedrag | kwota netto | valor líquido | |
| bank account | bankovní účet | bankový účet | Bankkonto | compte bancaire | cuenta bancaria | conto bancario | bankrekening | rachunek bankowy | conta bancária | |
| connect Stripe | propojit Stripe | prepojiť Stripe | Stripe verbinden | connecter Stripe | conectar Stripe | collega Stripe | Stripe koppelen | połącz Stripe | ligar o Stripe | Do not decline the brand: cs `přes Stripe`, `účet Stripe`, not `Stripem`. |

### 4.5 Shipping and returns

| EN | cs | sk | de | fr | es | it | nl | pl | pt | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| shipping | doprava | doprava | Versand | livraison | envío | spedizione | verzending | wysyłka | envio | |
| shipping profile | profil dopravy | profil dopravy | Versandprofil | profil de livraison | perfil de envío | profilo di spedizione | verzendprofiel | profil wysyłki | perfil de envio | Exception terms for a few products. |
| shipping terms | dopravní podmínky | podmienky dopravy | Versandbedingungen | conditions de livraison | condiciones de envío | condizioni di spedizione | verzendvoorwaarden | warunki wysyłki | condições de envio | |
| ships from | odesílá se z | odosiela sa z | Versand aus | expédié depuis | se envía desde | spedito da | verzonden vanuit | wysyłka z | enviado de | |
| dispatch time | doba odeslání | doba odoslania | Bearbeitungszeit | délai d’expédition | plazo de envío | tempi di spedizione | verzendtermijn | czas wysyłki | prazo de expedição | Time until it LEAVES. |
| delivery time | doba doručení | doba doručenia | Lieferzeit | délai de livraison | plazo de entrega | tempi di consegna | levertijd | czas dostawy | prazo de entrega | Time until it ARRIVES. |
| destination | oblast doručení | oblasť doručenia | Lieferziel | destination | destino | destinazione | bestemming | region dostawy | destino | |
| shipping cost | cena dopravy | cena dopravy | Versandkosten | frais de livraison | gastos de envío | spese di spedizione | verzendkosten | koszt wysyłki | portes de envio | |
| business days | pracovní dny | pracovné dni | Werktage | jours ouvrés | días laborables | giorni lavorativi | werkdagen | dni robocze | dias úteis | |
| returns | vrácení zboží | vrátenie tovaru | Rücksendungen | retours | devoluciones | resi | retouren | zwroty | devoluções | |
| returns window | lhůta pro vrácení | lehota na vrátenie | Rückgabefrist | délai de retour | plazo de devolución | periodo di reso | retourtermijn | termin na zwrot | prazo de devolução | The seller's voluntary offer. Never the statutory withdrawal term. |
| return postage | poštovné za vrácení | poštovné za vrátenie | Rücksendekosten | frais de retour | gastos de devolución | spese di reso | retourkosten | koszt odesłania zwrotu | portes de devolução | |
| buyer pays / we pay return postage | hradí kupující / hradíme my | hradí kupujúci / hradíme my | trägt der Käufer / tragen wir | à la charge de l’acheteur / à notre charge | los paga el comprador / los pagamos nosotros | a carico dell’acquirente / a carico nostro | betaalt de koper / betalen wij | pokrywa kupujący / pokrywamy my | pagos pelo comprador / pagos por nós | |
| exceptions | výjimky | výnimky | Ausnahmen | exceptions | excepciones | eccezioni | uitzonderingen | wyjątki | exceções | |
| made to order | na zakázku | na objednávku | Anfertigung auf Bestellung | fabriqué sur commande | hecho por encargo | su ordinazione | op bestelling gemaakt | na zamówienie | feito por encomenda | |
| statutory right | zákonné právo | zákonné právo | gesetzliches Recht | droit légal | derecho legal | diritto di legge | wettelijk recht | prawo ustawowe | direito legal | |
| distance-selling law | předpisy o prodeji na dálku | predpisy o predaji na diaľku | Fernabsatzrecht | droit de la vente à distance | normativa de venta a distancia | normativa sulla vendita a distanza | regels voor koop op afstand | przepisy o sprzedaży na odległość | legislação sobre vendas à distância | |

### 4.6 Analytics

| EN | cs | sk | de | fr | es | it | nl | pl | pt | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| signal | událost | udalosť | Ereignis | événement | evento | evento | gebeurtenis | zdarzenie | evento | Internal name for a non-sale metric (views, clicks, signups). Say "event" if it ever surfaces. |
| source | zdroj | zdroj | Quelle | source | origen | fonte | bron | źródło | fonte | es: "fuente" is taken by font. |
| channel | kanál | kanál | Kanal | canal | canal | canale | kanaal | kanał | canal | Values: embed (4.1), marketplace, direct. |
| marketplace | tržiště | trhovisko | Marktplatz | place de marché | marketplace | marketplace | marketplace | marketplace | marketplace | nl: never "Marktplaats" (a brand). |
| direct | přímý | priamy | direkt | direct | directo | diretto | direct | bezpośrednio | direto | |
| conversion | konverze | konverzia | Conversion | conversion | conversión | conversione | conversie | konwersja | conversão | |
| visits / visitors | návštěvy / návštěvníci | návštevy / návštevníci | Besuche / Besucher | visites / visiteurs | visitas / visitantes | visite / visitatori | bezoeken / bezoekers | wizyty / odwiedzający | visitas / visitantes | |
| views | zobrazení | zobrazenia | Aufrufe | vues | visualizaciones | visualizzazioni | weergaven | wyświetlenia | visualizações | |
| clicks | kliknutí | kliknutia | Klicks | clics | clics | clic | klikken | kliknięcia | cliques | |
| email signups | přihlášení k odběru | prihlásenia na odber | E-Mail-Anmeldungen | inscriptions à la liste | suscripciones por correo | iscrizioni alla lista | e-mailaanmeldingen | zapisy na listę mailingową | subscrições por e-mail | Joining a mailing list. Not account sign-up. |
| bookings | rezervace | rezervácie | Buchungen | réservations | reservas | prenotazioni | boekingen | rezerwacje | reservas | |
| date range | období | obdobie | Zeitraum | période | intervalo de fechas | intervallo di date | periode | zakres dat | intervalo de datas | |
| "5m ago", "2h ago", "3d ago" | před {count} min / h / d | pred {count} min / h / d | vor {count} Min. / Std. / T. | il y a {count} min / h / j | hace {count} min / h / d | {count} min / h / g fa | {count} min / u / d geleden | {count} min / godz. / dni temu | há {count} min / h / d | `Notifications.time.*` |

### 4.7 Account, auth and generic actions

| EN | cs | sk | de | fr | es | it | nl | pl | pt | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| sign in | přihlásit se | prihlásiť sa | anmelden | se connecter | iniciar sesión | accedi | inloggen | zaloguj się | iniciar sessão | |
| sign up, create account | zaregistrovat se | zaregistrovať sa | registrieren | créer un compte | registrarse | registrati | account aanmaken | zarejestruj się | registar-se | nl: not "aanmelden" (also means sign in). pt-PT: "registar". |
| sign out, log out | odhlásit se | odhlásiť sa | abmelden | se déconnecter | cerrar sesión | esci | uitloggen | wyloguj się | terminar sessão | English uses both; one term. |
| sign out everywhere | odhlásit se všude | odhlásiť sa všade | überall abmelden | se déconnecter partout | cerrar sesión en todas partes | esci ovunque | overal uitloggen | wyloguj się wszędzie | terminar sessão em todo o lado | |
| magic link | přihlašovací odkaz | prihlasovací odkaz | Anmeldelink | lien de connexion | enlace de acceso | link di accesso | inloglink | link do logowania | link de acesso | Never translate "magic" literally. |
| password | heslo | heslo | Passwort | mot de passe | contraseña | password | wachtwoord | hasło | palavra-passe | pt-PT: not "senha". |
| reset password / reset link | obnovit heslo / odkaz pro obnovení | obnoviť heslo / odkaz na obnovenie | Passwort zurücksetzen / Link zum Zurücksetzen | réinitialiser le mot de passe / lien de réinitialisation | restablecer la contraseña / enlace para restablecer | reimposta la password / link di reimpostazione | wachtwoord opnieuw instellen / herstellink | zresetuj hasło / link do resetowania | redefinir a palavra-passe / link de redefinição | |
| confirmation link | potvrzovací odkaz | potvrdzovací odkaz | Bestätigungslink | lien de confirmation | enlace de confirmación | link di conferma | bevestigingslink | link potwierdzający | link de confirmação | |
| confirmed / verified | potvrzeno / ověřeno | potvrdené / overené | bestätigt / verifiziert | confirmé / vérifié | confirmado / verificado | confermato / verificato | bevestigd / geverifieerd | potwierdzono / zweryfikowano | confirmado / verificado | |
| session | relace | relácia | Sitzung | session | sesión | sessione | sessie | sesja | sessão | |
| email (the word) | e-mail | e-mail | E-Mail | e-mail | correo electrónico (short: correo) | email | e-mail | e-mail | e-mail | |
| notification | oznámení | upozornenie | Benachrichtigung | notification | notificación | notifica | melding | powiadomienie | notificação | |
| **delete** (gone for good) | smazat | zmazať | löschen | supprimer | eliminar | eliminare | verwijderen | usunąć | eliminar | Must agree with `DELETE_CONFIRM_PHRASES` in `src/lib/settings/constants.ts`. |
| **remove** (take out of a grid, list or team; the thing still exists) | odebrat | odobrať | entfernen | retirer | quitar | rimuovere | weghalen | usunąć z … | remover | nl, pl lack a clean second verb: name the container (`uit het raster verwijderen`, `usuń z siatki`) or use the verb given. |
| discard (changes) | zahodit | zahodiť | verwerfen | abandonner | descartar | scarta | negeren | odrzuć | descartar | |
| cancel | zrušit | zrušiť | abbrechen | annuler | cancelar | annulla | annuleren | anuluj | cancelar | |
| save | uložit | uložiť | speichern | enregistrer | guardar | salva | opslaan | zapisz | guardar | |
| accept | přijmout | prijať | akzeptieren | accepter | aceptar | accetta | accepteren | zaakceptuj | aceitar | |
| search | vyhledávání | vyhľadávanie | Suche | recherche | búsqueda | cerca | zoeken | szukaj | pesquisa | |
| Seller Agreement | Smlouva s prodejcem | Zmluva s predajcom | Verkäufervereinbarung | Contrat vendeur | Acuerdo de vendedor | Accordo per i venditori | Verkopersovereenkomst | Umowa sprzedawcy | Acordo de vendedor | |
| Terms of Service | Podmínky služby | Podmienky služby | Nutzungsbedingungen | Conditions d’utilisation | Condiciones del servicio | Termini di servizio | Servicevoorwaarden | Warunki korzystania z usługi | Termos de serviço | |
| Privacy Policy | Zásady ochrany osobních údajů | Zásady ochrany osobných údajov | Datenschutzerklärung | Politique de confidentialité | Política de privacidad | Informativa sulla privacy | Privacybeleid | Polityka prywatności | Política de privacidade | |

### 4.8 Import

| EN | cs | sk | de | fr | es | it | nl | pl | pt | Note |
|---|---|---|---|---|---|---|---|---|---|---|
| import (products) | import / importovat | import / importovať | Import / importieren | importation / importer | importación / importar | importazione / importare | import / importeren | import / importuj | importação / importar | |
| CSV import | import CSV | import CSV | CSV-Import | import CSV | importación de CSV | importazione CSV | CSV-import | import CSV | importação de CSV | |
| column | sloupec | stĺpec | Spalte | colonne | columna | colonna | kolom | kolumna | coluna | |
| row, line (of the file) | řádek | riadok | Zeile | ligne | fila | riga | rij | wiersz | linha | "Line {line}" and "row" are the same thing. |
| skip / skipped | přeskočit / přeskočeno | preskočiť / preskočené | überspringen / übersprungen | ignorer / ignoré | omitir / omitido | salta / saltato | overslaan / overgeslagen | pomiń / pominięto | ignorar / ignorado | |
| Shopify export | export ze Shopify | export zo Shopify | Shopify-Export | export Shopify | exportación de Shopify | esportazione Shopify | Shopify-export | eksport z Shopify | exportação do Shopify | |
| variant rows (folded into a product) | řádky variant | riadky variantov | Variantenzeilen | lignes de variantes | filas de variantes | righe delle varianti | variantrijen | wiersze wariantów | linhas de variantes | |

---

## 5. Legal and statutory terms

> **Every message listed below must be reviewed by a qualified person (a lawyer
> or legal translator for that jurisdiction) before release.** Using the right
> term does not make a consumer-rights summary legally sufficient. Translate
> faithfully, do not add or soften anything, do not change any figure (14 days,
> 2 years), and flag the key in your hand-off so review can find it.

Keys that need legal review:

- `ProductPage.statutory.withdrawal`
- `ProductPage.statutory.digitalWithdrawal`
- `ProductPage.statutory.guarantee`
- `ProductPage.trust.euRights`
- `ProductPage.footer.disclosure`
- Also worth a legal eye: `ProductPage.safety.*`, `Settings.shipping.returnsWindow.tipBody`,
  `Settings.legal.docs.sellerDetails.body`, `Settings.sellerDetails.fields.*.why`,
  `Storefront.productPage.shippingReturns.infoContent`.

Use the wording of each language's official text. Check every term against
EUR-Lex before release (swap the language code):
`https://eur-lex.europa.eu/legal-content/CS/TXT/?uri=CELEX:32011L0083` (Consumer
Rights Directive 2011/83/EU),
`…CELEX:32019L0771` (Sale of Goods Directive (EU) 2019/771),
`…CELEX:32023R0988` (General Product Safety Regulation).

### 5.1 Directive 2011/83/EU (consumer rights, right of withdrawal)

| Concept | cs | sk | de | fr | es | it | nl | pl | pt |
|---|---|---|---|---|---|---|---|---|---|
| consumer | spotřebitel | spotrebiteľ | Verbraucher | consommateur | consumidor | consumatore | consument | konsument | consumidor |
| trader | obchodník | obchodník | Unternehmer | professionnel | comerciante | professionista | handelaar | przedsiębiorca | profissional |
| distance contract | smlouva uzavřená na dálku | zmluva uzavretá na diaľku | Fernabsatzvertrag | contrat à distance | contrato a distancia | contratto a distanza | overeenkomst op afstand | umowa zawierana na odległość | contrato à distância |
| right of withdrawal | právo odstoupit od smlouvy | právo na odstúpenie od zmluvy | Widerrufsrecht | droit de rétractation | derecho de desistimiento | diritto di recesso | herroepingsrecht | prawo odstąpienia od umowy | direito de retratação |
| withdrawal period | lhůta pro odstoupení od smlouvy | lehota na odstúpenie od zmluvy | Widerrufsfrist | délai de rétractation | plazo de desistimiento | periodo di recesso | herroepingstermijn | termin na odstąpienie od umowy | prazo de retratação |
| to withdraw (verb) | odstoupit od smlouvy | odstúpiť od zmluvy | den Vertrag widerrufen | se rétracter | desistir del contrato | recedere dal contratto | de overeenkomst herroepen | odstąpić od umowy | retratar-se do contrato |
| goods made to the consumer's specifications or clearly personalised | zboží vyrobené podle specifikací spotřebitele nebo zřetelně přizpůsobené | tovar zhotovený podľa špecifikácií spotrebiteľa alebo jasne prispôsobený | Waren, die nach Kundenspezifikation angefertigt oder eindeutig auf die persönlichen Bedürfnisse zugeschnitten sind | biens confectionnés selon les spécifications du consommateur ou nettement personnalisés | bienes confeccionados conforme a las especificaciones del consumidor o claramente personalizados | beni confezionati su misura o chiaramente personalizzati | volgens specificaties van de consument vervaardigde of duidelijk gepersonaliseerde goederen | rzecz wyprodukowana według specyfikacji konsumenta lub służąca zaspokojeniu jego zindywidualizowanych potrzeb | bens realizados segundo as especificações do consumidor ou claramente personalizados |
| sealed goods not suitable for return (health or hygiene) | zboží v zapečetěném obalu, které není vhodné vrátit z důvodu ochrany zdraví nebo z hygienických důvodů | tovar v zapečatenom obale, ktorý nie je vhodné vrátiť z dôvodu ochrany zdravia alebo z hygienických dôvodov | versiegelte Waren, die aus Gründen des Gesundheitsschutzes oder der Hygiene nicht zur Rückgabe geeignet sind | biens scellés ne pouvant être renvoyés pour des raisons de protection de la santé ou d’hygiène | bienes precintados que no sean aptos para ser devueltos por razones de protección de la salud o de higiene | beni sigillati che non si prestano a essere restituiti per motivi igienici o connessi alla protezione della salute | verzegelde goederen die om redenen van gezondheidsbescherming of hygiëne niet geschikt zijn om te worden teruggezonden | rzecz dostarczana w zapieczętowanym opakowaniu, której po otwarciu nie można zwrócić ze względu na ochronę zdrowia lub ze względów higienicznych | bens selados não suscetíveis de devolução por motivos de proteção da saúde ou de higiene |
| digital content not supplied on a tangible medium | digitální obsah, který není dodán na hmotném nosiči | digitálny obsah, ktorý sa nedodáva na hmotnom nosiči | digitale Inhalte, die nicht auf einem körperlichen Datenträger geliefert werden | contenu numérique non fourni sur un support matériel | contenido digital que no se preste en un soporte material | contenuto digitale mediante un supporto non materiale | digitale inhoud die niet op een materiële drager is geleverd | treści cyfrowe, które nie są zapisane na nośniku materialnym | conteúdos digitais que não sejam fornecidos num suporte material |
| prior express consent … acknowledges loss of the right of withdrawal | předchozí výslovný souhlas … bere na vědomí, že tím ztrácí právo odstoupit od smlouvy | predchádzajúci výslovný súhlas … berie na vedomie, že stráca právo na odstúpenie od zmluvy | ausdrückliche Zustimmung … Kenntnis davon, dass das Widerrufsrecht erlischt | accord préalable exprès … reconnaissance de la perte du droit de rétractation | previo consentimiento expreso … conocimiento de que pierde el derecho de desistimiento | previo accordo espresso … accettazione del fatto di perdere il diritto di recesso | uitdrukkelijke voorafgaande toestemming … erkenning dat het herroepingsrecht verloren gaat | wyraźna zgoda … przyjęcie do wiadomości utraty prawa odstąpienia od umowy | consentimento prévio e expresso … reconhecimento de que perde o direito de retratação |

Notes:
- **pt:** the directive's Portuguese text says "direito de retratação"; Portugal's
  national law (Decreto-Lei 24/2014) calls it "direito de livre resolução".
  Use the directive term and flag it for the reviewer.
- **de:** consumer-facing German practice is exactly the directive vocabulary
  (Widerrufsrecht, Widerrufsfrist): no plain-language substitute needed.
- **Plain-language summaries** such as `trust.euRights` ("14 days to change
  your mind") may stay plain, but the full `statutory.*` sentences must use the
  terms above.

### 5.2 Directive (EU) 2019/771 (sale of goods, legal guarantee of conformity)

The English "2-year guarantee" is plain language for the seller's statutory
**liability for lack of conformity**. It is **not** a commercial guarantee, and
several languages use a different word for each. Using the commercial-guarantee
word is the most likely legal error in this whole catalogue.

| Concept | cs | sk | de | fr | es | it | nl | pl | pt |
|---|---|---|---|---|---|---|---|---|---|
| seller | prodávající | predávajúci | Verkäufer | vendeur | vendedor | venditore | verkoper | sprzedawca | vendedor |
| conformity with the contract | soulad se smlouvou | súlad so zmluvou | Vertragsmäßigkeit | conformité | conformidad | conformità | conformiteit | zgodność z umową | conformidade |
| lack of conformity | rozpor se smlouvou | nesúlad so zmluvou | Vertragswidrigkeit | défaut de conformité | falta de conformidad | difetto di conformità | gebrek aan conformiteit | brak zgodności z umową | falta de conformidade |
| liability of the seller | odpovědnost prodávajícího | zodpovednosť predávajúceho | Haftung des Verkäufers | responsabilité du vendeur | responsabilidad del vendedor | responsabilità del venditore | aansprakelijkheid van de verkoper | odpowiedzialność sprzedawcy | responsabilidade do vendedor |
| **commercial guarantee (do NOT use for the statutory right)** | obchodní záruka | obchodná záruka | gewerbliche Garantie | garantie commerciale | garantía comercial | garanzia commerciale | commerciële garantie | gwarancja handlowa | garantia comercial |
| accepted consumer-facing name for the statutory right | zákonná práva z vadného plnění | zákonná zodpovednosť za vady | gesetzliche Gewährleistung | garantie légale de conformité | garantía legal | garanzia legale di conformità | wettelijke garantie | odpowiedzialność za brak zgodności towaru z umową | garantia legal |

Notes for the reviewer (translators: do not change the figures):
- **de:** never "Garantie" alone for the statutory right; that is the
  commercial guarantee. Use "Gewährleistung".
- **pl:** since 2023 Polish consumer law no longer uses "rękojmia" for consumer
  sales; the term is the seller's liability for lack of conformity.
- **pt:** Portuguese national law (Decreto-Lei 84/2021) gives consumers **3
  years**, not 2. **nl:** Dutch law sets no fixed period (expected lifespan).
  The English says "at least 2 years" in `statutory.guarantee` but plain "a
  2-year guarantee" in `trust.euRights`; the reviewer should decide whether that
  second line is accurate for every reader.

### 5.3 GPSR and seller disclosure

| Concept | cs | sk | de | fr | es | it | nl | pl | pt |
|---|---|---|---|---|---|---|---|---|---|
| manufacturer | výrobce | výrobca | Hersteller | fabricant | fabricante | fabbricante | fabrikant | producent | fabricante |
| responsible person (in the EU) | odpovědná osoba | zodpovedná osoba | verantwortliche Person | personne responsable | persona responsable | persona responsabile | verantwoordelijke persoon | osoba odpowiedzialna | pessoa responsável |
| warnings and safety information | upozornění a bezpečnostní informace | upozornenia a bezpečnostné informácie | Warnhinweise und Sicherheitsinformationen | avertissements et informations de sécurité | advertencias e información de seguridad | avvertenze e informazioni sulla sicurezza | waarschuwingen en veiligheidsinformatie | ostrzeżenia i informacje dotyczące bezpieczeństwa | advertências e informações de segurança |
| "is not a party to the sale" (`footer.disclosure`) | není smluvní stranou kupní smlouvy | nie je zmluvnou stranou kúpnej zmluvy | ist nicht Vertragspartei des Kaufvertrags | n’est pas partie au contrat de vente | no es parte del contrato de compraventa | non è parte del contratto di vendita | is geen partij bij de koopovereenkomst | nie jest stroną umowy sprzedaży | não é parte no contrato de compra e venda |

---

## 6. Do not translate

Copy these exactly, including capitalisation and spacing.

| Category | Literals |
|---|---|
| Brand and company names | `Square Share`, `Squareshare`, `SquareShare` (all three occur; keep whichever the English string uses, see section 7), `Stripe`, `Stripe Connect`, `Shopify`, `Google`, `Root Labs` |
| Font names | `Inter`, `Montserrat`, and the category labels `Sans`, `Serif`, `Mono`, `Display`. Translate `Handwritten` and `Uploaded font`. |
| File formats | `CSV`, `PNG`, `JPG`, `JPEG`, `WEBP`/`WebP`, `GIF`, `AVIF`, `SVG`, `PDF`, `ZIP`, `EPUB`, `MP3`, `WAV`, `MP4`, `TXT`, `WOFF2`, `WOFF`, `TTF`, `OTF`, `JSON`, `HTML` (keep the source's casing) |
| Keyboard keys and shortcuts | `Ctrl`, `Cmd`, `Shift`, `Alt`, `Enter`, `Esc`, `Escape`, `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl -`, `Ctrl +`, `Ctrl 0`, `Ctrl+V`, `Cmd+V`, `[` `]`, `{mod}`, `<kbd>{shortcut}</kbd>`. Translate the words around them ("arrow keys", "plus and minus", "Alt-click" becomes `Alt + kliknutí`, `Alt-Klick`, `Alt + clic`). German keyboards print `Strg`, but `{mod}` is rendered by code as `Ctrl`, so stay consistent with it. |
| Units and symbols | `px`, `%`, `°`, `×`, `W`, `ml`, `m`, `MB`, `KB` (fr: `Mo`, `Ko`), `#a855f7`, `€` (position may move) |
| Technical literals | `https://`, `mailto`, `SKU`, `ID` (`Order ID` becomes `ID objednávky`), `hex`, `GET`, `limits`, `"ctaColor": "#1d4ed8"`, `%s`, `<code>{version}</code>`, `<code>{phrase}</code>` |
| Legal-form example | `Studio Builderboy e.U.` |
| Code-owned values | Anything inside `{…}` or a select key; the delete phrase is supplied by code (`{phrase}`), never typed into the message. |

**Localise, but keep valid:** example emails (`you@studio.com`,
`colleague@example.com`, `hello@yourshop.example`), example domains
(`yoursite.com, blog.yoursite.com`, `example.com`) and the username placeholder
(`yourhandle`) may use your language, but must stay lowercase ASCII with no
accents, keep `.example` where the English uses it, and the username must match
`[a-z0-9_]`. Example addresses (`12 Market Street, Dublin`), size lists
(`S, M, L, XL`) and product examples (`Ambient Loops Vol. 1`, `Solid oak`) may
be localised to something natural and obviously fictitious.

---

## 7. Known traps in the English source

Things in `messages/en` that look like instructions but are not, or that are
genuinely ambiguous. Handle them as stated; do not edit the English.

| Trap | Where | What to do |
|---|---|---|
| Em dashes and `--` in English | products, settings, search, storefront, errors, validation, auth | Rewrite with comma, colon or parentheses. The test rejects U+2014. |
| `''` doubled apostrophes | `Storefront.list.loadMoreError`, `embed.*`, `picker.*` | ICU for one apostrophe. Write ’. |
| Three brand spellings | `Square Share` (most), `Squareshare` (`ProductPage.footer`, `ErrorPage.footer.credit`), `SquareShare` (`Notifications.messages.teamInvite.bodyUnnamedStore`) | Keep each as written. Normalising is a product decision, not a translation one. |
| Synonym pairs | tile/card, buy link/purchase link, designer/editor, log out/sign out, version/variant | One term each (section 4). |
| Identical plural branches | `{count} in stock`, `# pixels`, `{count} sold` | Your language may need different forms. Write them. |
| `many` / `other` swap | cs, sk versus pl | cs/sk `many` is decimals; pl `many` is 5+. See 3.3. |
| `pt` plural rules | every pt plural | The locale is `pt-PT`: 0 → `other`, so no `=0` is needed. See 3.3. |
| Nested `#` | `Storefront.designer.toasts.draftsDetail` | `# more` counts `{hidden}`. |
| Placeholders you cannot decline | `{title}`, `{name}`, `{group}`, `{store}`, `{area}`, `{issuer}`, `{selected}` (country names, may arrive in English) | Nominative-safe phrasing (3.2). |
| "Try \"Resend\" below" | `Errors.settings.savedButConfirmationFailed` | Quote your translation of `Settings.tax.resend.button`, not a literal "Resend". |
| "excl. tax" versus "incl. VAT" | `ProductPage.priceNotes`, `Storefront.productPage.cta.priceNote` | Keep the asymmetry (tax is generic on purpose). |
| Role names capitalised mid-sentence | `Notifications.messages.teamInvite.body`, `Settings.team.inviteRow.invitedAs` | Lowercase mid-sentence unless your grammar capitalises. |
| Placeholder legal copy | `Settings.legal.docs.*.body` | Translate as the informal drafts they are; they say so themselves. |
| "2-year guarantee" | `ProductPage.trust.euRights`, `Settings.shipping.returnsWindow.tipBody`, `Storefront.productPage.shippingReturns.infoContent` | Statutory liability, not a commercial guarantee (5.2). Legal review. |
