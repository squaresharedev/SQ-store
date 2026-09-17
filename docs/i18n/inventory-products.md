# i18n Inventory: Products (phase 4) and Product page (phase 6)

> **Scope**: `src/components/products/` (24 files), route files under
> `src/app/(dashboard)/products/` (7 files + 3 loading skeletons), and
> `src/components/product-page/` (17 files).
> Categories A–G as defined in docs/plans/04-ui-localisation.md Appendix A.
>
> **SELLER-DATA RULE**: Product titles, descriptions, option names, spec labels,
> document names, storefront names are seller-authored data and are NOT listed.
> Strings that interpolate seller data are marked **(seller param)** and require
> ICU `{param}` or `t.rich`; the surrounding app text is what is translated.
>
> **LIB DISPLAY SITES** (lib strings shown in these components; lib agent owns the
> source, not inventoried here):
> - `priceErrorMessage()` from `src/lib/products/price.ts` is rendered at
>   `ProductForm.tsx` ~L200. Once lib returns already-translated text, no change
>   needed at the display site.

---

## ⚠ CORRECTNESS FLAG: `ProductImport.tsx` FIELD\_LABELS

`FIELD_LABELS = { title: "Title", description: "Description", price: "Price",
sku: "SKU", stock: "Stock" }` (L50–55) is used **only for display** (L320–323).
CSV column matching lives in `src/lib/products/csv.ts` (`buildImportPlan`),
which was out of scope here. **Before translating FIELD\_LABELS, confirm that
`buildImportPlan` matches on field KEYS (`"title"`, `"price"`, …) or column
index: not on the English label strings.** If it matches on labels, translating
them silently breaks CSV import for non-English sellers.

The preview-table headers `"Title"` / `"Price"` / `"Stock"` at L355–357 are
separate JSX strings independent of FIELD\_LABELS and are safe to translate.

---

## Phase 4: Products: seller dashboard

**Namespace root**: `Products`

### Summary

| | |
|---|---|
| **Total findings** | 236 |
| **A: JSX text nodes** | 96 |
| **B: string props (label, placeholder, aria-label, title, alt, InfoTip)** | 114 |
| **C: route metadata titles** | 4 |
| **E: validation messages** | 11 |
| **F: imperative UI (toasts, inline errors set programmatically)** | 7 |
| **G: locale-sensitive formatting call sites** | 4 |
| **"use client" files** | 17 |
| **Server component files** | 7 (EmptyState, FormView, StatusBadge, FormSection, FormSkeleton, + 4 route pages) |

**Files needing restructuring** (cannot be a plain string extract):

| File | Issue |
|---|---|
| `ProductList.tsx` | Delete-modal description interpolates seller title + ICU-plural storefront note: `t.rich` + ICU |
| `ProductList.tsx` | Storefront-chooser description interpolates seller title + count: ICU `{title, count}` |
| `ProductsBrowser.tsx` | `${total} product(s) · page N of M`: ICU plural on total |
| `ProductCard.tsx` | `${stockQuantity} in stock`: ICU plural (Czech differs at 1/2-4/5+) |
| `ProductCard.tsx` | aria-labels interpolating seller `title`: ICU `{title}` param |
| `ProductForm.tsx` | `"Uploading/Processing ${noun}…"`: ICU `select` on noun (image/photo/document/file) |
| `ProductForm.tsx` | Error-count summary `${n} things to fix`: ICU plural |
| `ProductForm.tsx` | Save/add toast interpolates seller title: ICU `{title}` |
| `ProductImport.tsx` | Product count, variant-row count, skipped-row count: ICU plural throughout |
| `OptionsField.tsx` | Swatch conflict warning interpolates multiple seller option names: `t.rich` or ICU |
| `GalleryField.tsx` | `Move to: ${label}` where label may be seller option name: ICU `{label}` |
| `GalleryField.tsx` | `${N} photo(s)`: ICU plural |
| `DocumentsField.tsx` | `Only ${room} more document(s) fit`: ICU plural |
| `FormSection.tsx` | `What ${title} is for`: `{title}` is itself the result of a translated section-name key; translator note on word order required |

---

### Findings table: Phase 4

| File:line | Cat | C/S | Current string | Proposed key |
|---|---|---|---|---|
| **ProductEmptyState.tsx** | | S | | |
| L24 | A | S | `No products yet` | `Products.emptyState.title` |
| L28 | A | S | `Add your first product. It can stay a draft until you're ready to give it a page.` | `Products.emptyState.descriptionWriter` |
| L29 | A | S | `This store has no products yet.` | `Products.emptyState.descriptionReadOnly` |
| L38 | A | S | `Add product` | `Products.emptyState.addButton` |
| **ProductList.tsx** | | C | | |
| L92 | F | C | `"${target.title}" was deleted.` | `Products.list.toast.deleted`: ICU `{title}` **(seller param)** |
| L115 | F | C | `Link copied.` | `Products.list.toast.linkCopied` |
| L116 | F | C | `Could not copy.` | `Products.list.toast.copyFailed` |
| L117 | F | C | `The URL is: ${url}` | `Products.list.toast.copyFailedUrl`: ICU `{url}` |
| L129 | F | C | `This product is not on any storefront yet.` | `Products.list.toast.noStorefront` |
| L153 | A | C | `No products match these filters` | `Products.list.noMatch.title` |
| L156 | A | C | `Pick a different status, or clear the filters to see everything again.` | `Products.list.noMatch.body` |
| L163 | A | C | `Clear filters` | `Products.list.noMatch.clearButton` |
| L182–184 | A | C | ` It is on {n} storefront(s). The block(s) stay until you remove it/them.` | `Products.list.deleteModal.storefrontNote`: ICU plural on `{n}`; merge both branches |
| L217 | B | C | `Delete this product?` | `Products.list.deleteModal.title` |
| L220 | B | C | `"${title}" and its uploaded image and file will be permanently removed…{storefrontNote}` | `Products.list.deleteModal.description`: `t.rich`; `{title}` **(seller param)**; `{storefrontNote}` composed from ICU plural key |
| L228 | A | C | `Cancel` | `Products.common.cancelButton` |
| L239 | A | C | `Deleting…` | `Products.list.deleteModal.deletingButton` |
| L239 | A | C | `Delete product` | `Products.list.deleteModal.deleteButton` |
| L250 | B | C | `Open on which storefront?` | `Products.list.storefrontModal.titleOpen` |
| L250 | B | C | `Copy link for which storefront?` | `Products.list.storefrontModal.titleCopy` |
| L253 | B | C | `"${title}" is on ${n} storefronts. Pick one.` | `Products.list.storefrontModal.description`: `{title}` **(seller param)**; ICU `{n}` |
| L273 | A | C | `Or cancel and use the storefront designer to choose a default.` | `Products.list.storefrontModal.hint` |
| L279 | A | C | `Cancel` | `Products.common.cancelButton`: shared |
| **ProductCard.tsx** | | C | | |
| ~L64 | A | C | `Sold out` | `Products.card.soldOut` |
| ~L69 | A | C | `${stockQuantity} in stock` | `Products.card.inStock`: ICU plural `{count, plural, one {# in stock} other {# in stock}}` |
| ~L117 | A | C | `Bestseller` | `Products.card.bestseller` |
| ~L129 | G | C | `formatPrice(price, currency)` |: thread `locale` through `formatPrice`; cat G |
| ~L145 | B | C | `Edit ${title}` | `Products.card.editAriaLabel`: ICU `{title}` **(seller param)** |
| ~L156 | B | C | `${title} actions` | `Products.card.actionsAriaLabel`: ICU `{title}` **(seller param)** |
| ~L164 | B | C | `More actions for ${title}` | `Products.card.moreActionsAriaLabel`: ICU `{title}` **(seller param)** |
| ~L81 | B | C | `Not on a storefront yet` | `Products.card.notOnStorefront` |
| ~L84 | B | C | `On ${n} storefronts, click to choose` | `Products.card.onStorefronts`: ICU plural `{n}` |
| ~L84 | B | C | `Copy product page link` | `Products.card.copyLinkTitle` |
| ~L183 | A | C | `Copy product link` | `Products.card.menu.copyLink` |
| ~L192 | B | C | `Open product page` | `Products.card.openPageTitle` |
| ~L195 | A | C | `Open product page` | `Products.card.menu.openPage` |
| ~L203 | A | C | `Delete` | `Products.card.menu.delete` |
| ~L222 | A | C | `${sales.unitsSold} sold` | `Products.card.unitsSold`: ICU `{count}` |
| ~L222 | A | C | `No sales yet` | `Products.card.noSales` |
| ~L226 | G | C | `formatCents(sales.revenueCents, sales.currency)` |: thread `locale`; cat G |
| **ProductsBrowser.tsx** | | C | | |
| ~L58 | B | C | `Newest first` | `Products.browser.sort.newestFirst` |
| ~L59 | B | C | `Units sold` | `Products.browser.sort.unitsSold` |
| ~L60 | B | C | `Total value sold` | `Products.browser.sort.totalValueSold` |
| ~L61 | B | C | `Price: high to low` | `Products.browser.sort.priceHighToLow` |
| ~L62 | B | C | `Price: low to high` | `Products.browser.sort.priceLowToHigh` |
| ~L63 | B | C | `Name: A–Z` | `Products.browser.sort.nameAZ` |
| ~L67 | B | C | `All statuses` | `Products.browser.status.all` |
| ~L68 | B | C | `Active` | `Products.browser.status.active` |
| ~L69 | B | C | `Draft` | `Products.browser.status.draft` |
| ~L181 | B | C | `Sort and filter products` | `Products.browser.filterAriaLabel` |
| ~L182 | B | C | `Sort` | `Products.browser.sortRestingLabel` |
| ~L186 | B | C | `Status` | `Products.browser.statusSection` |
| ~L191 | B | C | `Sort by` | `Products.browser.sortSection` |
| ~L221 | A | C | `Clear` | `Products.browser.clearButton` |
| ~L234 | A | C | `Import` | `Products.browser.importButton` |
| ~L240 | A | C | `Add product` | `Products.browser.addButton` |
| ~L261 | A | C | `Updating…` | `Products.browser.updatingSpinner` |
| ~L278 | A | C | `${data.total} product(s) · page ${data.page} of ${totalPages}` | `Products.browser.pagination`: ICU plural: `{count, plural, one {# product} other {# products}} · page {page} of {totalPages}` |
| ~L285 | A | C | `Previous` | `Products.browser.previousButton` |
| ~L292 | A | C | `Next` | `Products.browser.nextButton` |
| **ProductImport.tsx** | | C | | |
| ~L50 | B | C | `Title` (FIELD\_LABELS display) | `Products.import.fieldLabels.title`: **see FIELD\_LABELS flag above** |
| ~L51 | B | C | `Description` (FIELD\_LABELS display) | `Products.import.fieldLabels.description` |
| ~L52 | B | C | `Price` (FIELD\_LABELS display) | `Products.import.fieldLabels.price` |
| ~L53 | B | C | `SKU` (FIELD\_LABELS display) | `Products.import.fieldLabels.sku` |
| ~L54 | B | C | `Stock` (FIELD\_LABELS display) | `Products.import.fieldLabels.stock` |
| ~L113 | F | C | `That file is ${size}. Import files up to ${max}.` | `Products.import.error.fileTooBig`: ICU `{size}` `{max}` = formatBytes output |
| ~L119 | F | C | `That file is empty.` | `Products.import.error.fileEmpty` |
| ~L164–165 | F | C | `${n} product(s) were imported.` | `Products.import.toast.imported`: ICU plural |
| ~L169 | F | C | `${n} row(s) were skipped.` | `Products.import.toast.skipped`: ICU plural |
| ~L208 | A | C | `Drop a CSV or click to choose one` | `Products.import.dropzone.cta` |
| ~L211–213 | A | C | CSV format / size hint text | `Products.import.dropzone.hint` |
| ~L232 | A | C | `${n} product(s) ready` (import summary) | `Products.import.summary.productsReady`: ICU plural |
| ~L241 | A | C | `${n} variant row(s) folded in` | `Products.import.summary.variantsFolded`: ICU plural |
| ~L245 | A | C | `${n} row(s) dropped` | `Products.import.summary.rowsDropped`: ICU plural |
| ~L257–259 | A | C | `Photos are not imported. Prices, stock and descriptions come across; add the pictures once the products are here.` | `Products.import.photosNotice` |
| ~L263 | B | C | `Currency` | `Products.import.currencyLabel` |
| ~L272 | B | C | `Every imported product is priced in this.` | `Products.import.currencyHelpText` |
| ~L278 | B | C | `Import as` | `Products.import.statusLabel` |
| ~L282 | B | C | `Drafts` | `Products.import.statusOption.draft` |
| ~L283 | B | C | `Live products` | `Products.import.statusOption.live` |
| ~L289 | A | C | `Nothing goes live until you publish it.` | `Products.import.statusHint.draft` |
| ~L291 | A | C | `These appear in your store straight away.` | `Products.import.statusHint.live` |
| ~L312 | B | C | `Columns` | `Products.import.columnsLabel` |
| ~L323 | B | C | `(needed)` | `Products.import.neededSuffix` |
| ~L328 | B | C | `Not set` | `Products.import.columnNotSet` |
| ~L328 | B | C | `Skip` | `Products.import.columnSkip` |
| ~L330 | A | C | `Column ${index + 1}` | `Products.import.columnFallback`: ICU `{n}`; fallback for unnamed CSV columns |
| ~L349 | B | C | `What will be imported` | `Products.import.previewHeading` |
| ~L355 | A | C | `Title` (preview table header) | `Products.import.previewTable.titleHeader` |
| ~L356 | A | C | `Price` (preview table header) | `Products.import.previewTable.priceHeader` |
| ~L357 | A | C | `Stock` (preview table header) | `Products.import.previewTable.stockHeader` |
| ~L364 | G | C | `formatCents(row.priceCents, currency)` |: thread `locale`; cat G |
| ~L367 | A | C | `Not tracked` | `Products.import.previewTable.notTracked` |
| ~L374 | A | C | `and ${n} more.` | `Products.import.andNMore`: ICU `{n}` |
| ~L385 | B | C | `Rows that will be skipped` | `Products.import.skippedHeading` |
| ~L390 | A | C | `Line {n}` (prefix on skipped-row entry) | `Products.import.skippedRow.linePrefix`: ICU `{n}`; the `row.problem` text originates in lib/products/csv.ts (lib agent owns it) |
| ~L396 | A | C | `and ${n} more.` | `Products.import.andNMore`: shared key |
| ~L408 | B | C | `Importing…` | `Products.import.importingLabel` |
| ~L409 | B | C | `Imported` | `Products.import.importedLabel` |
| ~L412 | A | C | `Import ${n} product(s)` | `Products.import.importButton`: ICU plural |
| ~L419 | A | C | `Clear` | `Products.import.clearButton` |
| **ProductForm.tsx** | | C | | |
| ~L194 | E | C | `Give your product a title: buyers see it first.` | `Products.form.errors.titleRequired` |
| ~L206 | E | C | `Enter how many units are in stock, or turn Track stock off for unlimited.` | `Products.form.errors.stockRequired` |
| ~L207 | E | C | `Stock must be a whole number: 0 or more, with no decimals.` | `Products.form.errors.stockInvalid` |
| ~L219 | E | C | `The low-stock alert must be a whole number of 0 or more.` | `Products.form.errors.lowStockAlertInvalid` |
| ~L233 | E | C | `Enter how many one buyer can order: 1 to ${PURCHASE_QUANTITY_MAX}.` | `Products.form.errors.maxOrderRequired`: ICU `{max}` |
| ~L239 | E | C | `The maximum per order must be a whole number from 1 to ${PURCHASE_QUANTITY_MAX}.` | `Products.form.errors.maxOrderInvalid`: ICU `{max}` |
| ~L250 | E | C | `The purchase link must be a full https:// address.` | `Products.form.errors.purchaseLinkInvalid` |
| ~L257 | E | C | `Say what each option group varies, or remove it.` | `Products.form.errors.optionGroupNameRequired` |
| ~L260 | E | C | `Add at least one ${name} option, or remove the group.` | `Products.form.errors.optionGroupEmpty`: ICU `{name}` **(seller param)** |
| ~L263 | E | C | `Give every option a name, or remove the empty row.` | `Products.form.errors.optionNameRequired` |
| ~L265 | E | C | `An option group can have up to ${OPTIONS_PER_GROUP_MAX} options.` | `Products.form.errors.optionGroupFull`: ICU `{max}` |
| ~L807 | F | C | `"${title}" was saved.` | `Products.form.toast.saved`: ICU `{title}` **(seller param)** |
| ~L810 | F | C | `"${title}" was added to your products.` | `Products.form.toast.added`: ICU `{title}` **(seller param)** |
| ~L907 | B | C | `Basics` | `Products.form.sections.basics` |
| ~L938 | B | C | `Title` (field label) | `Products.form.titleField.label` |
| ~L939 | A | C | `(optional)` | `Products.form.optionalSuffix` |
| ~L948 | B | C | `What is it, and what does the buyer get?` | `Products.form.description.placeholder` |
| ~L975 | B | C | `Stock` | `Products.form.sections.stock` |
| ~L1028 | B | C | `Display image` | `Products.form.displayImage.label` |
| ~L1031 | B | C | `Where the display image is used` | `Products.form.displayImage.infoTipLabel` |
| ~L1032 | B | C | `Shown on your storefront and embeds.` | `Products.form.displayImage.infoTipContent` |
| ~L1043 | B | C | `Digital file` | `Products.form.digitalFile.label` |
| ~L1046 | B | C | `What the digital file is` | `Products.form.digitalFile.infoTipLabel` |
| ~L1048 | B | C | `The file your buyer downloads after purchase. Adding one makes this a download, so shipping and product-safety stop applying.` | `Products.form.digitalFile.infoTipContent` |
| ~L1067 | B | C | `Purchase link` | `Products.form.purchaseLink.label` |
| ~L1070 | B | C | `Where the buy button sends buyers` | `Products.form.purchaseLink.infoTipLabel` |
| ~L1072 | B | C | `The product page's buy button follows this link. Without one, it emails your store's contact address instead.` | `Products.form.purchaseLink.infoTipContent` |
| ~L1083 | B | C | `e.g. https://your-shop.example/checkout/this-product` | `Products.form.purchaseLink.placeholder` |
| ~L1101 | B | C | `Media and delivery` | `Products.form.sections.mediaAndDelivery` |
| ~L1104 | B | C | `Shipping` | `Products.form.sections.shipping` |
| ~L1120 | B | C | `Options` | `Products.form.sections.options` |
| ~L1130 | B | C | `Photos` | `Products.form.sections.photos` |
| ~L1145 | B | C | `Specifications` | `Products.form.sections.specifications` |
| ~L1169 | B | C | `Documents` | `Products.form.sections.documents` |
| ~L1181 | B | C | `Safety and compliance` | `Products.form.sections.safetyAndCompliance` |
| ~L1195 | B | C | `Visibility` | `Products.form.sections.visibility` |
| ~L1231 | B | C | `Product status` | `Products.form.productStatus.ariaLabel` |
| ~L1261 | A | C | `${n} thing(s) to fix before saving` | `Products.form.errorCount`: ICU plural: `{count, plural, one {1 thing to fix before saving} other {# things to fix before saving}}` |
| ~L1270 | A | C | `Jump to first` | `Products.form.jumpToFirst` |
| ~L1289 | A | C | `Uploading ${noun}…` | `Products.form.upload.uploading`: ICU select: `{noun, select, image {image} photo {photo} document {document} other {file}}`; both Uploading/Processing need the same select |
| ~L1289 | A | C | `Processing ${noun}…` | `Products.form.upload.processing`: ICU select on same noun values |
| ~L1326 | A | C | `Cancel` | `Products.common.cancelButton`: shared |
| ~L1332 | B | C | `Saving…` | `Products.form.savingLabel` |
| ~L1333 | A | C | `Save changes` | `Products.form.saveChangesButton` |
| ~L1333 | A | C | `Save product` | `Products.form.saveProductButton` |
| ~L1341 | B | C | `Discard your changes?` | `Products.form.discardModal.title` |
| ~L1343 | B | C | `The edits you've made to this product haven't been saved yet.` | `Products.form.discardModal.descriptionEdit` |
| ~L1346 | B | C | `This product hasn't been saved yet, so nothing will be kept.` | `Products.form.discardModal.descriptionNew` |
| ~L1352 | A | C | `Cancel` | `Products.common.cancelButton`: shared |
| ~L1360 | A | C | `Discard` | `Products.form.discardModal.discardButton` |
| ~L1370 | A | C | `Saving…` | `Products.form.discardModal.savingLabel` |
| ~L1376 | A | C | `Save` | `Products.form.discardModal.saveButton` |
| **ProductFormView.tsx** | | S | | |
| ~L53 | A | S | `Storefront` (back link, conditional) | `Products.formView.backStorefront` |
| ~L53 | A | S | `Products` (back link, conditional) | `Products.formView.backProducts` |
| **StatusBadge.tsx** | | S | | |
| ~L29 | A | S | `Draft` | `Products.statusBadge.draft` |
| **StockFields.tsx** | | C | | |
| ~L71 | B | C | `Track stock` | `Products.stockFields.trackStock` |
| ~L89 | B | C | `In stock` | `Products.stockFields.inStock` |
| ~L101 | B | C | `Decrease stock` | `Products.stockFields.decreaseAriaLabel` |
| ~L132 | B | C | `Increase stock` | `Products.stockFields.increaseAriaLabel` |
| ~L148 | B | C | `Low-stock alert at` | `Products.stockFields.lowStockAlert` |
| ~L181 | B | C | `Maximum per order` | `Products.stockFields.maxPerOrder` |
| ~L204 | A | C | `How many one buyer can take at once. Buyers pick from a list that stops here, and the limit is checked again when they order. Up to {max}; 1 sells them one at a time.` | `Products.stockFields.maxPerOrderHint`: ICU `{max}` |
| **PriceField.tsx** | | C | | |
| ~L64 | B | C | `Price` | `Products.priceField.label` |
| ~L83 | B | C | `e.g. 9.00` | `Products.priceField.placeholder` |
| ~L101 | B | C | `Currency` (group aria-label) | `Products.priceField.currencyGroupAriaLabel` |
| **ShippingField.tsx** | | C | | |
| ~L68 | B | C | `Your usual shipping terms` | `Products.shippingField.defaultOption.label` |
| ~L69 | B | C | `Set once for your account. What almost every product wants.` | `Products.shippingField.defaultOption.description` |
| ~L74 | B | C | `Removed profile` | `Products.shippingField.removedOption.label` |
| ~L77 | B | C | `This profile no longer exists, so buyers see your default terms.` | `Products.shippingField.removedOption.description` |
| ~L82 | A | C | `Untitled profile` | `Products.shippingField.untitledProfile` |
| ~L92 | A | C | `No terms written for this profile yet.` | `Products.shippingField.noTermsForProfile` |
| ~L93 | A | C | `No shipping terms written yet.` | `Products.shippingField.noTerms` |
| ~L105 | B | C | `Shipping profile` | `Products.shippingField.profileLabel` |
| ~L126 | A | C | `Edit` | `Products.shippingField.editButton` |
| **ShippingTermsModal.tsx** | | C | | |
| ~L36 | B | C | `Shipping & returns` | `Products.shippingModal.title` |
| **OptionsField.tsx** | | C | | |
| ~L46 | B | C | `Swatches` | `Products.optionsField.display.swatches` |
| ~L47 | B | C | `Chips` | `Products.optionsField.display.chips` |
| ~L48 | B | C | `Dropdown` | `Products.optionsField.display.dropdown` |
| ~L52 | B | C | `Colour circles. Give each option a swatch, or buyers see its first letter.` | `Products.optionsField.display.swatchesHint` |
| ~L53 | B | C | `Text buttons, for values buyers read: sizes, wattages, lengths.` | `Products.optionsField.display.chipsHint` |
| ~L54 | B | C | `A dropdown. Best when there are more values than fit as buttons.` | `Products.optionsField.display.dropdownHint` |
| ~L144 | A | C | `All versions share one price and one stock level.` | `Products.optionsField.oneVariantNote` |
| ~L152 | A | C | `Sold in more than one version?` | `Products.optionsField.addGroupPromptEmpty` |
| ~L152 | A | C | `Add another way it varies` | `Products.optionsField.addGroupPromptMore` |
| ~L173 | A | C | `Something else` | `Products.optionsField.somethingElseButton` |
| ~L180 | A | C | `That is all ${OPTION_GROUPS_MAX} option groups.` | `Products.optionsField.allGroupsReached`: ICU `{max}` |
| ~L184 | A | C | `That is all ${OPTIONS_TOTAL_MAX} options.` | `Products.optionsField.allOptionsReached`: ICU `{max}` |
| ~L376 | B | C | `What varies` | `Products.optionsField.whatVariesLabel` |
| ~L384 | B | C | `What varies? e.g. Power output` | `Products.optionsField.whatVariesPlaceholder` |
| ~L401 | A | C | `${group.options.length} option(s)` | `Products.optionsField.optionCount`: ICU plural |
| ~L405 | B | C | `Move ${heading} earlier` | `Products.optionsField.moveGroupEarlier`: ICU `{heading}` **(seller param)** |
| ~L413 | B | C | `Move ${heading} later` | `Products.optionsField.moveGroupLater`: ICU `{heading}` **(seller param)** |
| ~L420 | B | C | `Remove ${heading}` | `Products.optionsField.removeGroup`: ICU `{heading}` **(seller param)** |
| ~L435 | B | C | `How buyers pick ${heading}` | `Products.optionsField.howBuyersPick`: ICU `{heading}` **(seller param)** |
| ~L445 | B | C | `How buyers pick it` (InfoTip label) | `Products.optionsField.howBuyersPickInfoTip` |
| ~L463 | A | C | `Colour` (swatch table header, aria-hidden) | `Products.optionsField.swatchColourHeader` |
| ~L466 | A | C | `Name` (swatch table header, aria-hidden) | `Products.optionsField.swatchNameHeader` |
| ~L479 | B | C | `${heading} options` (ul aria-label) | `Products.optionsField.optionsGroupAriaLabel`: ICU `{heading}` **(seller param)** |
| ~L514 | B | C | `Colour for ${optionName}` (ColorPicker label) | `Products.optionsField.colourPickerLabel`: ICU `{optionName}` **(seller param)** |
| ~L518 | B | C | `No swatch` (inherit label) | `Products.optionsField.noSwatch` |
| ~L537 | B | C | `${heading} option ${index + 1}` (sr-only) | `Products.optionsField.optionSrLabel`: ICU `{heading}` **(seller)**, `{n}` |
| ~L544 | B | C | `Option ${index + 1}` (placeholder fallback) | `Products.optionsField.optionPlaceholder`: ICU `{n}` |
| ~L563 | B | C | `${optionName} is available` (Switch aria-label) | `Products.optionsField.optionAvailable`: ICU `{optionName}` **(seller)** |
| ~L568 | B | C | `Move ${optionName} earlier` | `Products.optionsField.moveOptionEarlier`: ICU `{optionName}` **(seller)** |
| ~L574 | B | C | `Move ${optionName} later` | `Products.optionsField.moveOptionLater`: ICU `{optionName}` **(seller)** |
| ~L582 | B | C | `Remove ${optionName}` | `Products.optionsField.removeOption`: ICU `{optionName}` **(seller)** |
| ~L612 | A | C | `${names} share a first letter and neither has a colour. Buyers will see identical squares. Give each one a colour.` | `Products.optionsField.swatchConflict`: `t.rich`; `{names}` = seller option names |
| ~L629 | B | C | `Add options` (paste InfoTip label) | `Products.optionsField.pasteInfoTip.label` |
| ~L630 | B | C | InfoTip content: how to paste a list of options | `Products.optionsField.pasteInfoTip.content` |
| ~L641 | B | C | `No room for more options` (disabled placeholder) | `Products.optionsField.noRoom` |
| ~L644 | B | C | `First option` (placeholder when empty) | `Products.optionsField.firstOptionPlaceholder` |
| ~L659 | A | C | `Add` | `Products.optionsField.addButton` |
| **DetailsFields.tsx** | | C | | |
| ~L30 | B | C | `Dimensions` (fieldset legend) | `Products.detailsFields.dimensionsLegend` |
| ~L35 | B | C | `Length` | `Products.detailsFields.length` |
| ~L37 | B | C | `Width` | `Products.detailsFields.width` |
| ~L39 | B | C | `Height` | `Products.detailsFields.height` |
| ~L50 | B | C | `Weight` (legend) | `Products.detailsFields.weightLegend` |
| ~L64 | B | C | `Unit` (×2: dimensions + weight) | `Products.detailsFields.unit` |
| ~L64 | B | C | `Weight` (measure label within weight fieldset) | `Products.detailsFields.weightLabel` |
| ~L97 | B | C | `Materials` | `Products.detailsFields.materials` |
| ~L97 | B | C | `e.g. Solid oak, brass fittings` | `Products.detailsFields.materialsPlaceholder` |
| ~L112 | B | C | `Made in` | `Products.detailsFields.madeIn` |
| ~L112 | B | C | `Country of origin` | `Products.detailsFields.madeInPlaceholder` |
| ~L129 | B | C | `Care instructions` | `Products.detailsFields.careInstructions` |
| ~L143 | B | C | `What's included` | `Products.detailsFields.whatsIncluded` |
| ~L143 | B | C | `One item per line\ne.g. 1 × lamp\n1 × 2 m cable` | `Products.detailsFields.whatsIncludedPlaceholder` |
| ~L159 | B | C | `Specifications` (label/span) | `Products.detailsFields.specificationsLabel` |
| ~L165 | B | C | `Name, e.g. Wattage` | `Products.detailsFields.specNamePlaceholder` |
| ~L165 | B | C | `Value, e.g. 40 W` | `Products.detailsFields.specValuePlaceholder` |
| ~L169 | B | C | `Specification ${n} name` | `Products.detailsFields.specNameAriaLabel`: ICU `{n}` |
| ~L169 | B | C | `Specification ${n} value` | `Products.detailsFields.specValueAriaLabel`: ICU `{n}` |
| ~L175 | B | C | `Remove specification ${n}` | `Products.detailsFields.specRemoveAriaLabel`: ICU `{n}` |
| ~L180 | A | C | `Add specification` | `Products.detailsFields.addSpecButton` |
| **GalleryField.tsx** | | C | | |
| ~L85 | F | C | `A product can have up to ${GALLERY_MAX} extra photos.` | `Products.galleryField.error.tooMany`: ICU `{max}` |
| ~L91 | F | C | `Use PNG, JPG, WEBP, GIF, or AVIF images.` | `Products.galleryField.error.invalidType` |
| ~L93 | F | C | `Each photo must be under ${MAX_MB} MB.` | `Products.galleryField.error.tooLarge`: ICU `{max}` |
| ~L112 | F | C | `Only ${room} more photo(s) fit.` | `Products.galleryField.error.roomLeft`: ICU plural |
| ~L151 | A | C | `Every version` (bucket label when options exist) | `Products.galleryField.everyVersionBucket` |
| ~L151 | A | C | `Photos` (bucket label when no options) | `Products.galleryField.photosBucket` |
| ~L168 | B | C | `Move to: ${label}` (select option, where label may be seller option name) | `Products.galleryField.moveToOption`: ICU `{label}` **(partly seller param)** |
| ~L229 | A | C | `${photos.length} photo(s)` | `Products.galleryField.photoCount`: ICU plural |
| ~L247 | B | C | `Remove photo` | `Products.galleryField.removePhotoAriaLabel` |
| ~L257 | B | C | `Move photo earlier` | `Products.galleryField.movePhotoEarlier` |
| ~L265 | B | C | `Move photo later` | `Products.galleryField.movePhotoLater` |
| ~L278 | B | C | `Alt text` (placeholder) | `Products.galleryField.altTextPlaceholder` |
| ~L279 | B | C | `Describe this photo, for people who cannot see it` | `Products.galleryField.altTextAriaLabel` |
| ~L284 | B | C | `Which version this photo is shown for` (sr-only) | `Products.galleryField.versionSelectLabel` |
| ~L314 | A | C | `${images.length} of ${GALLERY_MAX} photos` | `Products.galleryField.photoTally`: ICU `{count}` `{max}` |
| ~L317 | B | C | `How these photos are ordered` (InfoTip label) | `Products.galleryField.orderInfoTip.label` |
| ~L318 | B | C | `The display image from Media and delivery is always first. After it, photos show in the order they sit in here.` | `Products.galleryField.orderInfoTip.content` |
| ~L426 | A | C | `Limit reached` | `Products.galleryField.limitReached` |
| ~L426 | A | C | `Drop or click` | `Products.galleryField.dropOrClick` |
| **OptionSpecsField.tsx** | | C | | |
| ~L101 | B | C | `Different for each version` | `Products.optionSpecsField.heading` |
| ~L102 | B | C | `How per-version specifications work` (InfoTip label) | `Products.optionSpecsField.infoTip.label` |
| ~L103 | B | C | InfoTip content explaining per-version specs | `Products.optionSpecsField.infoTip.content` |
| ~L148 | A | C | `Same as above` | `Products.optionSpecsField.sameAsAbove` |
| ~L160 | B | C | `Length` | `Products.optionSpecsField.length` |
| ~L162 | B | C | `Width` | `Products.optionSpecsField.width` |
| ~L164 | B | C | `Height` | `Products.optionSpecsField.height` |
| ~L166 | B | C | `Weight` | `Products.optionSpecsField.weight` |
| ~L170 | B | C | `${optionName} specifications` (ul aria-label) | `Products.optionSpecsField.specsAriaLabel`: ICU `{optionName}` **(seller)** |
| ~L175 | B | C | `${optionName} specification ${n} name` | `Products.optionSpecsField.specNameAriaLabel`: ICU `{optionName}` **(seller)**, `{n}` |
| ~L176 | B | C | `${optionName} specification ${n} value` | `Products.optionSpecsField.specValueAriaLabel`: ICU `{optionName}` **(seller)**, `{n}` |
| ~L177 | B | C | `Remove ${optionName} specification ${n}` | `Products.optionSpecsField.specRemoveAriaLabel`: ICU `{optionName}` **(seller)**, `{n}` |
| ~L180 | B | C | `Name, e.g. Seats` | `Products.optionSpecsField.specNamePlaceholder` |
| ~L181 | B | C | `Value, e.g. 6` | `Products.optionSpecsField.specValuePlaceholder` |
| ~L242 | A | C | `Specification for this version` | `Products.optionSpecsField.addSpecButton` |
| ~L272 | A | C | `A specification with the same name as one above replaces it for that version.` | `Products.optionSpecsField.replacesNote` |
| **SafetyFields.tsx** | | C | | |
| ~L40 | B | C | `Manufacturer` | `Products.safetyFields.manufacturer` |
| ~L50 | B | C | `Manufacturer email` | `Products.safetyFields.manufacturerEmail` |
| ~L60 | B | C | `Manufacturer address` | `Products.safetyFields.manufacturerAddress` |
| ~L75 | B | C | `EU responsible person` | `Products.safetyFields.responsiblePerson` |
| ~L108 | B | C | `Only when the manufacturer is outside the EU.` (InfoTip content) | `Products.safetyFields.responsiblePersonInfoTip` |
| ~L85 | B | C | `Responsible person email` | `Products.safetyFields.responsiblePersonEmail` |
| ~L95 | B | C | `Responsible person address` | `Products.safetyFields.responsiblePersonAddress` |
| ~L115 | B | C | `Type, batch or serial number` | `Products.safetyFields.productIdentifier` |
| ~L125 | B | C | `Warnings and safety information` | `Products.safetyFields.warnings` |
| **DocumentsField.tsx** | | C | | |
| ~L62 | F | C | `A product can have up to ${DOCUMENTS_MAX} documents.` | `Products.documentsField.error.tooMany`: ICU `{max}` |
| ~L69 | F | C | `Use a PDF for certificates, manuals, and other documents.` | `Products.documentsField.error.invalidType` |
| ~L72 | F | C | `"${file.name}" is too big. Documents have to be under ${MAX_MB} MB.` | `Products.documentsField.error.tooLarge`: ICU `{name}` (system filename), `{max}` |
| ~L88 | F | C | `Only ${room} more document(s) fit.` | `Products.documentsField.error.roomLeft`: ICU plural |
| ~L117 | B | C | `Documents` (list aria-label) | `Products.documentsField.listAriaLabel` |
| ~L132 | B | C | `Document name, shown to buyers` | `Products.documentsField.nameInputAriaLabel` |
| ~L133 | B | C | `e.g. Safety Data Sheet` | `Products.documentsField.namePlaceholder` |
| ~L147 | B | C | `Remove ${document.label \|\| "document"}` | `Products.documentsField.removeAriaLabel`: ICU `{label}` **(seller param)** with `select`-style fallback, or two keys |
| ~L192 | A | C | `Limit reached` | `Products.documentsField.limitReached` |
| ~L192 | A | C | `Drop PDFs or click to upload` | `Products.documentsField.dropZoneLabel` |
| ~L194 | A | C | `${documents.length} of ${DOCUMENTS_MAX} documents · PDF, up to ${MAX_MB} MB each` | `Products.documentsField.hint`: ICU `{count}` `{max}` `{maxMb}` |
| **ImageDropzone.tsx** | | C | | |
| ~L53 | F | C | `Use a PNG, JPG, WEBP, GIF, or AVIF image.` | `Products.imageDropzone.error.invalidType` |
| ~L57 | F | C | `Image must be under ${MAX_MB} MB.` | `Products.imageDropzone.error.tooLarge`: ICU `{max}` |
| ~L115 | B | C | `Display image preview` (img alt) | `Products.imageDropzone.previewAlt` |
| ~L120 | A | C | `Drop an image or click to upload` | `Products.imageDropzone.dropZoneLabel` |
| ~L123 | A | C | `PNG, JPG, WEBP, GIF, or AVIF, up to ${MAX_MB} MB` | `Products.imageDropzone.hint`: ICU `{max}` |
| ~L133 | B | C | `Remove display image` | `Products.imageDropzone.removeAriaLabel` |
| **FileDropzone.tsx** | | C | | |
| ~L97 | A | C | `Current file` | `Products.fileDropzone.currentFile` |
| ~L103 | A | C | `Drop a file or click to upload` | `Products.fileDropzone.dropZoneLabel` |
| ~L105 | A | C | `ZIP, PDF, and similar, up to ${MAX_MB} MB` | `Products.fileDropzone.hint`: ICU `{max}` |
| ~L120 | B | C | `Remove digital file` | `Products.fileDropzone.removeAriaLabel` |
| **FormSection.tsx** | | S | | |
| ~L85 | B | S | `What ${title} is for` (InfoTip aria-label) | `Products.formSection.infoTipAriaLabel`: ICU `{title}` is the already-translated section name; **translator note: word order changes in Czech (`K čemu slouží {title}`)** |
| **FormSectionNav.tsx** | | C | | |
| ~L61 | B | C | `Form sections` (nav aria-label) | `Products.formSectionNav.navAriaLabel` |
| ~L62 | A | C | `On this page` | `Products.formSectionNav.heading` |
| **ProductFormSkeleton.tsx** | | S | | |
| ~L33 | A | S | `Products` (back link) | `Products.formSkeleton.backButton` |
| ~L43 | B | S | `Loading the product form` (aria-label) | `Products.formSkeleton.loadingAriaLabel` |
| **src/app/(dashboard)/products/page.tsx** | | S | | |
| metadata | C | S | `Products` (title) | `Products.routes.list.metaTitle`: convert to `generateMetadata` |
| ~L88 | A | S | `Products` (h1) | `Products.routes.list.heading`: can share key with metaTitle |
| **src/app/(dashboard)/products/[id]/edit/page.tsx** | | S | | |
| metadata | C | S | `Edit product` (title) | `Products.routes.edit.metaTitle` |
| ~L53 | B | S | `Edit product` (title prop) | `Products.routes.edit.title` |
| ~L54 | B | S | `Update the details, image, or file for this product.` (subtitle prop, vestigial: rendered only as h1 `title` attr) | `Products.routes.edit.subtitle`: **flag as vestigial; defer** |
| **src/app/(dashboard)/products/new/page.tsx** | | S | | |
| metadata | C | S | `New product` (title) | `Products.routes.new.metaTitle` |
| ~L51 | B | S | `New product` (title prop) | `Products.routes.new.title` |
| ~L52 | B | S | `Add a product, then place it on a storefront to give it a page.` (subtitle prop, vestigial) | `Products.routes.new.subtitle`: **flag as vestigial; defer** |
| **src/app/(dashboard)/products/import/page.tsx** | | S | | |
| L11 | C | S | `Import products` (metadata title) | `Products.routes.import.metaTitle` |
| L35 | A | S | `Products` (back link) | `Products.formSkeleton.backButton`: shared key |
| L38 | A | S | `Import products` (h1) | `Products.routes.import.heading` |
| L40–41 | A | S | `Bring a catalogue over from Shopify, or any tool that exports a CSV. You will see exactly what lands before anything is saved.` | `Products.routes.import.description` |
| **src/app/(dashboard)/products/loading.tsx** | | S | | |
| ~L12 | A | S | `Products` (h1 skeleton) | `Products.routes.list.heading`: shared key |
| ~L15 | B | S | `products` (CardGridSkeleton label: lowercase, likely internal) | `Products.routes.list.skeletonLabel`: verify if screen-reader visible |
| **src/app/(dashboard)/products/[id]/edit/loading.tsx** | | S | | |
| ~L? | B | S | `Edit product` (title prop to ProductFormSkeleton) | `Products.routes.edit.title`: shared key |
| **src/app/(dashboard)/products/new/loading.tsx** | | S | | |
| ~L? | B | S | `New product` (title prop to ProductFormSkeleton) | `Products.routes.new.title`: shared key |

---

## Phase 6: Product page: buyer-facing (ships with i18n phase 6)

> **IMPORTANT**: This section is buyer-facing: the buyer's locale, not the
> seller's. Keys live in a separate `ProductPage` namespace and must NOT be
> mixed into `Products`. The implementation session for phase 6 will need the
> buyer locale resolved separately from the seller locale (e.g. cookie vs.
> `Accept-Language`).

**Namespace root**: `ProductPage`

### Summary

| | |
|---|---|
| **Total findings** | 43 |
| **A: JSX text nodes** | 24 |
| **B: string props** | 11 |
| **D: copy constants (in component-dir .ts file)** | 4 |
| **G: locale-sensitive formatting call sites** | 4 |
| **"use client" files** | 5 (ProductCta, QuantityPicker, OptionPicker, ProductGallery, ProductDescription) |
| **Server component files** | 9 (StockLine, PoweredByFooter, StatutoryNotes, SellerBlock, SpecsTable, DocumentsList, ProductPageView, ProductPrice + product-page-maps.ts) |
| **No-string files** | PageSelect.tsx, QuantityContext.tsx, OptionContext.tsx (pure logic: no user-visible strings) |

**Files needing restructuring**:

| File | Issue |
|---|---|
| `PoweredByFooter.tsx` | Legal disclosure sentence embeds `{sellerName}` in bold: `t.rich` with `<strong>` component |
| `ProductPageView.tsx` | `Sold by ${soldBy}`: ICU `{soldBy}` **(seller param)** |
| `ProductPageView.tsx` | `Product identifier: ${identifier}`: ICU `{identifier}` **(seller data)** |
| `StatutoryNotes.tsx` | Statutory text: translation requires **legal review**; flag for each locale |
| `OptionPicker.tsx` | `${option.name}: unavailable` / `${option.name}, unavailable`: ICU `{name}` **(seller param)** |

**Lib reference**: `PRODUCT_PAGE_SECTION_LABELS` defined in
`src/lib/storefront/product-page.ts` is used in `ProductPageView.tsx` for
accordion section headings. That constant is lib-agent territory (phase 5 lib
work); it is not listed below but the display site is `ProductPageView.tsx`
around the section-accordion loop.

---

### Findings table: Phase 6

| File:line | Cat | C/S | Current string | Proposed key |
|---|---|---|---|---|
| **ProductCta.tsx** | | C | | |
| ~L87 | A | C | `This button has nowhere to go yet. Add a purchase link on the product, or a contact email under Seller details.` (editor-only preview) | `ProductPage.cta.editorPreviewNotice` |
| ~L107 | A | C | `Sold out` | `ProductPage.cta.soldOut` |
| ~L108 | A | C | `Unavailable in this ${unavailableIn.name.toLowerCase()}` | `ProductPage.cta.unavailableIn`: ICU `{groupName}` **(seller param, lower-cased)** |
| ~L115 | A | C | `Ask about this product` | `ProductPage.cta.askAbout` |
| ~L178 | A | C | `Checkout on` (prefix before seller domain) | `ProductPage.cta.checkoutOn`: ICU `{host}` **(seller domain)** |
| **ProductDescription.tsx** | | C | | |
| L65 | A | C | `Read more` | `ProductPage.description.readMore` |
| L65 | A | C | `Read less` | `ProductPage.description.readLess` |
| **StockLine.tsx** | | S | | |
| L22 | A | S | `Sold out` | `ProductPage.stock.soldOut` |
| L24 | A | S | `Only ${stock.remaining} left` | `ProductPage.stock.lowStock`: ICU `{count}` |
| L26 | A | S | `In stock` | `ProductPage.stock.inStock` |
| L28 | A | S | `Digital download (${digitalFormat})` | `ProductPage.stock.digitalDownloadFormat`: ICU `{format}` |
| L29 | A | S | `Digital download` | `ProductPage.stock.digitalDownload` |
| **QuantityPicker.tsx** | | C | | |
| ~L56 | B | C | `Quantity` (label) | `ProductPage.quantity.label` |
| ~L79 | G | C | `${quantity} × ${formatCents(priceCents, currency)} = ${formatCents(total, currency)}` |: two `formatCents` calls; thread buyer `locale`; cat G |
| **OptionPicker.tsx** | | C | | |
| ~L74 | A | C | `(unavailable)` (inline span after option name) | `ProductPage.options.unavailableInline` |
| ~L95 | A | C | `${option.name}: unavailable` (select option label) | `ProductPage.options.unavailableOption`: ICU `{name}` **(seller param)** |
| ~L156 | B | C | `${option.name}, unavailable` (aria-label) | `ProductPage.options.unavailableAriaLabel`: ICU `{name}` **(seller param)** |
| **PoweredByFooter.tsx** | | S | | |
| ~L91 | A | S | `{sellerName} is the seller for this order and is responsible for the product, its delivery, and any returns or refunds. Squareshare provides the technology behind this page and is not a party to the sale.` | `ProductPage.footer.legalDisclosure`: `t.rich`; `{sellerName}` in `<strong>`; **(seller param)** |
| ~L126 | A | S | `Powered by Squareshare` (footer link text with bold) | `ProductPage.footer.poweredBy`: `t.rich` for `<strong>Squareshare</strong>` |
| ~L137 | B | S | `Squareshare policies` (nav aria-label) | `ProductPage.footer.policiesNavAriaLabel` |
| **StatutoryNotes.tsx** | | S | | |
| ~L10 | A | S | `You can cancel this purchase within 14 days of receiving it without giving a reason, unless one of the legal exceptions applies (for example made-to-order or sealed goods).` | `ProductPage.statutory.cancellationRight`: **LEGAL TEXT: requires solicitor review per locale** |
| ~L13 | A | S | `For a download, the right to cancel ends once you agree to start the download before the 14 days are over.` | `ProductPage.statutory.digitalCancellationRight`: **LEGAL TEXT** |
| ~L18 | A | S | `EU law gives you at least a 2-year guarantee that goods conform to what was sold.` | `ProductPage.statutory.twoYearGuarantee`: **LEGAL TEXT** |
| **SellerBlock.tsx** | | S | | |
| ~L41 | A | S | `Address: ` (label prefix before seller address) | `ProductPage.seller.addressLabel` |
| ~L51 | A | S | `Country: ` | `ProductPage.seller.countryLabel` |
| ~L57 | A | S | `Email: ` | `ProductPage.seller.emailLabel` |
| ~L63 | A | S | `Phone: ` | `ProductPage.seller.phoneLabel` |
| ~L78 | A | S | `VAT ID: ` | `ProductPage.seller.vatIdLabel` |
| **SpecsTable.tsx** | | S | | |
| ~L27 | A | S | `Dimensions` (spec row label) | `ProductPage.specs.dimensions` |
| ~L30 | A | S | `Weight` (spec row label) | `ProductPage.specs.weight` |
| ~L32 | A | S | `Materials` (spec row label) | `ProductPage.specs.materials` |
| ~L33 | A | S | `Made in` (spec row label) | `ProductPage.specs.madeIn` |
| ~L91 | A | S | `What's included` (section heading) | `ProductPage.specs.whatsIncluded` |
| ~L103 | A | S | `Care` (section heading) | `ProductPage.specs.care` |
| **ProductPageView.tsx** | | S | | |
| ~L152 | A | S | `Delivered as a download after purchase.` | `ProductPage.trust.digitalDelivery` |
| ~L155 | A | S | `14 days to change your mind, and a 2-year guarantee.` | `ProductPage.trust.euRights` |
| ~L254 | A | S | `Manufacturer` (safety section heading) | `ProductPage.safety.manufacturerHeading` |
| ~L260 | A | S | `Responsible person in the EU` | `ProductPage.safety.responsiblePersonHeading` |
| ~L276 | A | S | `Product identifier: ` (label prefix) | `ProductPage.safety.productIdentifierLabel`: ICU `{identifier}` **(seller data)** appended |
| ~L282 | A | S | `Warnings` (section heading) | `ProductPage.safety.warningsHeading` |
| ~L365 | A | S | `Sold by ${soldBy}` | `ProductPage.soldBy`: ICU `{soldBy}` **(seller param)** |
| ~L458 | A | S | `More details` (h2) | `ProductPage.moreDetails` |
| **ProductPrice.tsx** | | S | | |
| ~L? | G | S | `formatCents(priceCents, currency)` |: thread buyer `locale`; cat G |
| **product-page-maps.ts** | | S | | |
| ~L? | D | S | `"incl. VAT"` (PRICE\_NOTE\_LABELS) | `ProductPage.priceNotes.inclVat` |
| ~L? | D | S | `"excl. tax"` (PRICE\_NOTE\_LABELS) | `ProductPage.priceNotes.exclTax` |
| ~L? | D | S | `"plus shipping"` (SHIPPING\_NOTE\_LABELS) | `ProductPage.shippingNotes.plusShipping` |
| ~L? | D | S | `"free shipping"` (SHIPPING\_NOTE\_LABELS) | `ProductPage.shippingNotes.freeShipping` |
| **ProductGallery.tsx** | | C | | |
| ~L73 | A | C | `No photo yet` | `ProductPage.gallery.noPhoto` |
| ~L99 | B | C | `Photos of ${title}` (aria-label) | `ProductPage.gallery.photosAriaLabel`: ICU `{title}` **(seller param)** |
| ~L109 | B | C | `Photo ${i + 1} of ${visible.length}` (aria-label) | `ProductPage.gallery.photoAriaLabel`: ICU `{current}` `{total}` |
