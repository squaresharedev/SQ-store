# i18n Inventory: src/components/storefront/

**Total findings:** 312 string candidates across 45 files  
**By category:** A=147  B=108  C=0  D=41  E=5  F=15  G=0  (+ 4 skipped: G covered by existing `formatPrice` util)  
**File split:** 45 Client / 0 Server (entire storefront/ is "use client")  
**t.rich candidates:** 28 (see § Strings requiring t.rich at the end)

Strings tagged **[SKIP]** are DO-NOT-WRAP per plan §3: seller-authored data,
`console.*`, enum/DB values, `data-*` attribute values, Tailwind/cn() tokens,
aria role constants.

---

## Main inventory table

| File:line | Cat | C/S | Current string | Proposed key |
|-----------|-----|-----|----------------|--------------|
| **StorefrontsList.tsx** | | | | |
| StorefrontsList.tsx:128 | A | C | `Showing {n} of {total} storefronts` | `storefront.list.showingOf` |
| StorefrontsList.tsx:129 | A | C | `{n} storefront` / `{n} storefronts` (ICU plural) | `storefront.list.count` |
| StorefrontsList.tsx:138 | A | C | `Creating…` | `storefront.list.creating` |
| StorefrontsList.tsx:138 | A | C | `New storefront` | `storefront.list.new` |
| StorefrontsList.tsx:153 | A | C | `No storefronts yet` | `storefront.list.emptyHeading` |
| StorefrontsList.tsx:157 | A | C | `Create your first storefront, then add products to its grid. Each product on it gets a page you can share.` | `storefront.list.emptyHintOwner` |
| StorefrontsList.tsx:158 | A | C | `This store has no storefronts yet.` | `storefront.list.emptyHintGuest` |
| StorefrontsList.tsx:172 | A | C | `Creating…` | `storefront.list.creating` |
| StorefrontsList.tsx:172 | A | C | `Create storefront` | `storefront.list.create` |
| StorefrontsList.tsx:196 | F | C | `Couldn't load more storefronts. Try again.` | `storefront.list.loadMoreError` |
| StorefrontsList.tsx:206 | A | C | `Loading…` | `common.loading` |
| StorefrontsList.tsx:208 | A | C | `Try again` | `common.tryAgain` |
| StorefrontsList.tsx:209 | A | C | `Load more ({n} remaining)` (ICU) | `storefront.list.loadMore` |
| StorefrontsList.tsx:246 | A | C | `Delete storefront?` (modal title) | `storefront.list.deleteTitle` |
| StorefrontsList.tsx:249 | A | C | `"{name}" and its grid will be permanently removed. This cannot be undone.` (ICU + t.rich) | `storefront.list.deleteDesc` |
| StorefrontsList.tsx:258 | A | C | `Cancel` | `common.cancel` |
| StorefrontsList.tsx:266 | A | C | `Deleting…` | `common.deleting` |
| StorefrontsList.tsx:266 | A | C | `Delete` | `common.delete` |
| StorefrontsList.tsx:120 | F | C | `"{name}" was deleted.` (toast: t.rich) | `storefront.list.deleteToast` |
| **StorefrontCard.tsx** | | | | |
| StorefrontCard.tsx:~55 | B | C | `Edit {name}` (aria-label: t.rich) | `storefront.card.editAriaLabel` |
| StorefrontCard.tsx:~60 | B | C | `Embed {name}` (aria-label: t.rich) | `storefront.card.embedAriaLabel` |
| StorefrontCard.tsx:~65 | B | C | `Delete {name}` (aria-label: t.rich) | `storefront.card.deleteAriaLabel` |
| StorefrontCard.tsx:~70 | A | C | `{n} block` / `{n} blocks` (ICU plural) | `storefront.card.blockCount` |
| **EmbedModal.tsx** | | | | |
| EmbedModal.tsx:~45 | A | C | `Paste this snippet into any site to show "{name}" there.` (t.rich) | `storefront.embed.description` |
| EmbedModal.tsx:~20 | A | C | `Embed storefront` (modal title) | `storefront.embed.title` |
| EmbedModal.tsx:~55 | B | C | `Copy code` | `storefront.embed.copyCode` |
| EmbedModal.tsx:~60 | A | C | `Copied!` | `common.copied` |
| **CreateStorefrontWizard.tsx** | | | | |
| CreateStorefrontWizard.tsx:~25 | D | C | STEP_COPY[0].title: `"Name your storefront"` | `storefront.wizard.step1Title` |
| CreateStorefrontWizard.tsx:~26 | D | C | STEP_COPY[0].description: `"Give your storefront a name that shoppers will recognise."` | `storefront.wizard.step1Desc` |
| CreateStorefrontWizard.tsx:~28 | D | C | STEP_COPY[1].title: `"Pick a look"` | `storefront.wizard.step2Title` |
| CreateStorefrontWizard.tsx:~29 | D | C | STEP_COPY[1].description: `"Choose a style for how products are shown."` | `storefront.wizard.step2Desc` |
| CreateStorefrontWizard.tsx:~31 | D | C | STEP_COPY[2].title: `"Choose a layout"` | `storefront.wizard.step3Title` |
| CreateStorefrontWizard.tsx:~32 | D | C | STEP_COPY[2].description: `"How many columns do you want?"` | `storefront.wizard.step3Desc` |
| CreateStorefrontWizard.tsx:~40 | A | C | `Step {n} of {total}` (ICU interpolation) | `storefront.wizard.stepOf` |
| CreateStorefrontWizard.tsx:~80 | B | C | `Storefront name` (field label) | `storefront.wizard.nameLabel` |
| CreateStorefrontWizard.tsx:~85 | B | C | `Name your storefront…` (placeholder) | `storefront.wizard.namePlaceholder` |
| CreateStorefrontWizard.tsx:~90 | A | C | `Back` | `common.back` |
| CreateStorefrontWizard.tsx:~92 | A | C | `Next` | `common.next` |
| CreateStorefrontWizard.tsx:~94 | A | C | `Create` | `common.create` |
| CreateStorefrontWizard.tsx:~96 | A | C | `Skip` | `common.skip` |
| CreateStorefrontWizard.tsx:~98 | A | C | `Creating…` | `common.creating` |
| **EditorToolbar.tsx** | | | | |
| EditorToolbar.tsx:~30 | B | C | `Open the product panel` (aria-label) | `storefront.toolbar.openProducts` |
| EditorToolbar.tsx:~35 | B | C | `Open the layers panel` (aria-label) | `storefront.toolbar.openLayers` |
| EditorToolbar.tsx:~40 | B | C | `Open the uploads panel` (aria-label) | `storefront.toolbar.openUploads` |
| EditorToolbar.tsx:~45 | B | C | `Open the shapes panel` (aria-label) | `storefront.toolbar.openShapes` |
| EditorToolbar.tsx:~65 | B | C | `Show the product page` / `Close the product pages` (conditional aria-label) | `storefront.toolbar.pagesOpen` / `storefront.toolbar.pagesClose` |
| EditorToolbar.tsx:~75 | B | C | `Uploading… {n}%` (aria-label on upload button, ICU) | `storefront.toolbar.uploading` |
| EditorToolbar.tsx:~78 | B | C | `Processing…` (aria-label) | `storefront.toolbar.processing` |
| EditorToolbar.tsx:~80 | B | C | `Replace image` (aria-label) | `storefront.toolbar.replaceImage` |
| EditorToolbar.tsx:~82 | B | C | `Upload image` (aria-label) | `storefront.toolbar.uploadImage` |
| EditorToolbar.tsx:~90 | A | C | `Undo` (ToolbarTip label) | `common.undo` |
| EditorToolbar.tsx:~92 | A | C | `Redo` (ToolbarTip label) | `common.redo` |
| EditorToolbar.tsx:~95 | A | C | `Preview` (ToolbarTip label) | `storefront.toolbar.preview` |
| EditorToolbar.tsx:~100 | A | C | `Zoom in` (ToolbarTip label) | `storefront.toolbar.zoomIn` |
| EditorToolbar.tsx:~102 | A | C | `Zoom out` (ToolbarTip label) | `storefront.toolbar.zoomOut` |
| EditorToolbar.tsx:~104 | A | C | `Fit to screen` (ToolbarTip label) | `storefront.toolbar.fitToScreen` |
| **SelectionToolbar.tsx** | | | | |
| SelectionToolbar.tsx:~30 | B | C | `Edit the text of {name}` (aria-label, t.rich) | `storefront.selectionToolbar.editText` |
| SelectionToolbar.tsx:~35 | B | C | `Edit color of {name}` (aria-label, t.rich) | `storefront.selectionToolbar.editColor` |
| SelectionToolbar.tsx:~40 | B | C | `Edit border of {name}` (aria-label, t.rich) | `storefront.selectionToolbar.editBorder` |
| SelectionToolbar.tsx:~45 | B | C | `Edit corners of {name}` (aria-label, t.rich) | `storefront.selectionToolbar.editCorners` |
| SelectionToolbar.tsx:~50 | B | C | `Edit opacity of {name}` (aria-label, t.rich) | `storefront.selectionToolbar.editOpacity` |
| SelectionToolbar.tsx:~55 | B | C | `Duplicate {name}` (aria-label, t.rich) | `storefront.selectionToolbar.duplicate` |
| SelectionToolbar.tsx:~60 | B | C | `Remove {name} from grid` (aria-label, t.rich) | `storefront.selectionToolbar.remove` |
| SelectionToolbar.tsx:~65 | B | C | `Frame the image of {name}` (aria-label, t.rich) | `storefront.selectionToolbar.frameImage` |
| **DesignPanel.tsx** | | | | |
| DesignPanel.tsx:~20 | A | C | `Selection` (tab label) | `storefront.designPanel.tabSelection` |
| DesignPanel.tsx:~21 | A | C | `Design` (tab label) | `storefront.designPanel.tabDesign` |
| DesignPanel.tsx:~30 | B | C | `Show design panel` (aria-label) | `storefront.designPanel.show` |
| DesignPanel.tsx:~32 | B | C | `Hide design panel` (aria-label) | `storefront.designPanel.hide` |
| DesignPanel.tsx:~34 | B | C | `Resize design panel` (aria-label) | `storefront.designPanel.resize` |
| DesignPanel.tsx:~36 | B | C | `Close {title} panel` (aria-label, t.rich concat) | `storefront.designPanel.close` |
| **ControlsPanel.tsx** | | | | |
| ControlsPanel.tsx:~20 | A | C | `Layers` (section title) | `storefront.controlsPanel.layers` |
| ControlsPanel.tsx:~25 | A | C | `1 object selected` / `{n} objects selected` (ICU plural) | `storefront.controlsPanel.objectCount` |
| ControlsPanel.tsx:~28 | A | C | `Off` (hint when panel is hidden) | `storefront.controlsPanel.off` |
| ControlsPanel.tsx:~35 | A | C | `Card style` (section title) | `storefront.controlsPanel.cardStyle` |
| ControlsPanel.tsx:~37 | A | C | `Price tag` (section title) | `storefront.controlsPanel.priceTag` |
| ControlsPanel.tsx:~39 | A | C | `Theme` (section title) | `storefront.controlsPanel.theme` |
| ControlsPanel.tsx:~41 | A | C | `Canvas` (section title) | `storefront.controlsPanel.canvas` |
| **LibraryPanel.tsx** | | | | |
| LibraryPanel.tsx:~15 | A | C | `Library` | `storefront.library.title` |
| LibraryPanel.tsx:~30 | A | C | `Pick one to add it` | `storefront.library.hint` |
| LibraryPanel.tsx:~32 | A | C | `Canvas is full` | `storefront.library.canvasFull` |
| LibraryPanel.tsx:~40 | A | C | `Uploads` (tab label) | `storefront.library.tabUploads` |
| LibraryPanel.tsx:~42 | A | C | `Shapes` (tab label) | `storefront.library.tabShapes` |
| **UploadsPanel.tsx** | | | | |
| UploadsPanel.tsx:~20 | A | C | `Add an image` | `storefront.uploads.addImage` |
| UploadsPanel.tsx:~30 | A | C | `Processing…` | `common.processing` |
| UploadsPanel.tsx:~32 | A | C | `Uploading… {n}%` (ICU) | `common.uploadingPct` |
| UploadsPanel.tsx:~34 | A | C | `Drop to upload` | `storefront.uploads.dropToUpload` |
| UploadsPanel.tsx:~36 | A | C | `Upload image` | `storefront.uploads.uploadImage` |
| UploadsPanel.tsx:~45 | A | C | `In this storefront` (section heading) | `storefront.uploads.inStorefront` |
| UploadsPanel.tsx:~55 | A | C | `Place {alt} again` (ICU: t.rich; alt may be empty → fallback) | `storefront.uploads.placeAgain` |
| UploadsPanel.tsx:~57 | A | C | `Place this image again` (fallback when no alt) | `storefront.uploads.placeAgainFallback` |
| **ShapesPanel.tsx** | | | | |
| ShapesPanel.tsx:37 | B | C | `{groupTitle} shapes` (aria-label, t.rich concat) | `storefront.shapes.groupLabel` |
| ShapesPanel.tsx:46 | B | C | `Add {shapeLabel}` (aria-label, t.rich concat) | `storefront.shapes.addLabel` |
| **ColorPanel.tsx** | | | | |
| ColorPanel.tsx:~20 | A | C | `Type` (section label) | `storefront.color.type` |
| ColorPanel.tsx:~25 | A | C | `In this design` (section heading) | `storefront.color.inDesign` |
| ColorPanel.tsx:~27 | A | C | `Custom` (option label) | `storefront.color.custom` |
| ColorPanel.tsx:~29 | A | C | `Inherit` (option label) | `storefront.color.inherit` |
| ColorPanel.tsx:~31 | A | C | `Recently used` (section heading) | `storefront.color.recentlyUsed` |
| ColorPanel.tsx:~33 | A | C | `Standard` (section heading) | `storefront.color.standard` |
| ColorPanel.tsx:~35 | A | C | `Palettes` (section heading) | `storefront.color.palettes` |
| ColorPanel.tsx:~40 | B | C | `{hex} color swatch` (aria-label: ICU) | `storefront.color.swatchLabel` |
| ColorPanel.tsx:~45 | A | C | `Use {label}` (inherit option text: t.rich concat) | `storefront.color.useInherit` |
| **ThemePanel.tsx** | | | | |
| ThemePanel.tsx:~10 | A | C | `Accent` (section title) | `storefront.theme.accent` |
| **LooksSection.tsx** | | | | |
| LooksSection.tsx:88 | A | C | `Looks` (section heading) | `storefront.looks.title` |
| LooksSection.tsx:89 | B | C | `What picking a look changes` (InfoTip label) | `storefront.looks.infoLabel` |
| LooksSection.tsx:90 | A | C | `A look sets the whole storefront's colours and card arrangement at once. Change individual settings below to go further.` (InfoTip body) | `storefront.looks.infoBody` |
| LooksSection.tsx:96 | B | C | `Storefront look` (group aria-label) | `storefront.looks.groupLabel` |
| LooksSection.tsx:33 | D | C | VIBE_LABELS: `Minimal` / `Classic` / `Bold` | `storefront.looks.minimal` / `storefront.looks.classic` / `storefront.looks.bold` |
| LooksSection.tsx:40 | D | C | VIBE_HINTS: `Pictures only…` / `Name and price under…` / `Price always on the picture…` | `storefront.looks.hintMinimal` / etc. |
| **BackgroundEditor.tsx** | | | | |
| BackgroundEditor.tsx:26 | D | C | KINDS labels: `Color` / `Gradient` / `Image` | `storefront.background.typeColor` / `typeGradient` / `typeImage` |
| BackgroundEditor.tsx:184 | A | C | `Background` (section label) | `storefront.background.label` |
| BackgroundEditor.tsx:186 | B | C | `Background type` (SliderField aria-label) | `storefront.background.typeAriaLabel` |
| BackgroundEditor.tsx:223 | A | C | `Position` (label) | `storefront.background.position` |
| BackgroundEditor.tsx:225 | B | C | `Drag to position the background image` (aria-label) | `storefront.background.dragAriaLabel` |
| BackgroundEditor.tsx:231 | A | C | `Drag the preview to reposition. Zoom to resize.` (hint) | `storefront.background.dragHint` |
| BackgroundEditor.tsx:272 | A | C | `Processing…` | `common.processing` |
| BackgroundEditor.tsx:273 | A | C | `Uploading… {n}%` (ICU) | `common.uploadingPct` |
| BackgroundEditor.tsx:274 | A | C | `Replace image` | `storefront.background.replaceImage` |
| BackgroundEditor.tsx:274 | A | C | `Upload image` | `storefront.background.uploadImage` |
| BackgroundEditor.tsx:277 | A | C | `Up to 10 MB. JPEG, PNG, WebP, GIF, or AVIF.` (hint) | `storefront.background.uploadHint` |
| BackgroundEditor.tsx:285 | B | C | `Color` (ColorPicker label) | `storefront.background.colorLabel` |
| BackgroundEditor.tsx:294 | B | C | `From` (gradient start ColorPicker label) | `storefront.background.from` |
| BackgroundEditor.tsx:300 | B | C | `To` (gradient end ColorPicker label) | `storefront.background.to` |
| BackgroundEditor.tsx:307 | B | C | `Angle` (SliderField label) | `storefront.background.angle` |
| BackgroundEditor.tsx:307 | B | C | `{n} degrees` (valueText for screen reader) | `storefront.background.angleValue` |
| **CardStyleControls.tsx** | | | | |
| CardStyleControls.tsx:125 | A | C | `Layout` (section heading) | `storefront.cardStyle.layout` |
| CardStyleControls.tsx:138 | A | C | `Position` (section heading) | `storefront.cardStyle.position` |
| CardStyleControls.tsx:147 | A | C | `Rounded cards keep both labels on the center axis.` (hint) | `storefront.cardStyle.roundedHint` |
| CardStyleControls.tsx:148 | A | C | `Click a spot to place the label, or drag it here or on the tile.` (hint) | `storefront.cardStyle.spotHint` |
| CardStyleControls.tsx:153 | B | C | `Corner roundness` (SliderField label) | `storefront.cardStyle.cornerRoundness` |
| CardStyleControls.tsx:166 | A | C | `Sharp` (status text when radius = 0) | `storefront.cardStyle.sharp` |
| CardStyleControls.tsx:166 | A | C | `Circle` (status text when radius = max) | `storefront.cardStyle.circle` |
| CardStyleControls.tsx:181 | A | C | `Fine tuning` (CollapsibleSection title) | `storefront.cardStyle.fineTuning` |
| CardStyleControls.tsx:184 | B | C | `Show title` (label) | `storefront.cardStyle.showTitle` |
| CardStyleControls.tsx:198 | A | C | `Title style` (section heading) | `storefront.cardStyle.titleStyle` |
| CardStyleControls.tsx:209 | B | C | `Edge spacing` (SliderField label) | `storefront.cardStyle.edgeSpacing` |
| CardStyleControls.tsx:213 | A | C | `Auto` (status text) | `common.auto` |
| CardStyleControls.tsx:245 | B | C | `Show title on hover` (label) | `storefront.cardStyle.showTitleOnHover` |
| CardStyleControls.tsx:40 | D | C | REVEAL_HINTS: `"Always"` / `"Hover"` / `"None"` reveal option labels | `storefront.cardStyle.revealAlways` / etc. |
| CardStyleControls.tsx:258 | A | C | `The title stays hidden until a buyer hovers over the product.` (hint) | `storefront.cardStyle.hoverHint` |
| **ProductPageSection.tsx** | | | | |
| ProductPageSection.tsx:196 | B | C | `Show a product page` (toggle label) | `storefront.productPage.showToggle` |
| ProductPageSection.tsx:197 | B | C | `What this switch does` (InfoTip label) | `storefront.productPage.switchInfoLabel` |
| ProductPageSection.tsx:198 | A | C | `Tapping a product tile opens its page.` (InfoTip body) | `storefront.productPage.switchInfoOn` |
| ProductPageSection.tsx:199 | A | C | `Product tiles have no page to open.` (InfoTip body) | `storefront.productPage.switchInfoOff` |
| ProductPageSection.tsx:215 | B | C | `Page color` (ColorPicker label) | `storefront.productPage.pageColor` |
| ProductPageSection.tsx:224 | B | C | `Storefront background` (inherit label) | `storefront.productPage.inheritBg` |
| ProductPageSection.tsx:231 | B | C | `Photo fit` (SegmentedControl label) | `storefront.productPage.photoFit` |
| ProductPageSection.tsx:234 | A | C | `Fit` / `Fill` (photo-fit options) | `storefront.productPage.fitOption` / `fillOption` |
| ProductPageSection.tsx:247 | B | C | `Font` (label) | `storefront.productPage.font` |
| ProductPageSection.tsx:249 | B | C | `How this page's font relates to the storefront's` (InfoTip label) | `storefront.productPage.fontInfoLabel` |
| ProductPageSection.tsx:250 | A | C | `This page reads in its own face…` (InfoTip body when own font) | `storefront.productPage.fontInfoOwn` |
| ProductPageSection.tsx:251 | A | C | `Follows your storefront's font.` (InfoTip body when inherited) | `storefront.productPage.fontInfoInherit` |
| ProductPageSection.tsx:145 | A | C | `Same as storefront ({name})` (font option label, t.rich) | `storefront.productPage.fontSameAs` |
| ProductPageSection.tsx:271 | B | C | `Allow search engines` (toggle label) | `storefront.productPage.seoToggle` |
| ProductPageSection.tsx:274 | B | C | `Who search engines see this as` (InfoTip label) | `storefront.productPage.seoInfoLabel` |
| ProductPageSection.tsx:275 | A | C | InfoTip body about indexing | `storefront.productPage.seoInfoBody` |
| ProductPageSection.tsx:297 | A | C | `Buy button` (CollapsibleSection title) | `storefront.productPage.buyButton` |
| ProductPageSection.tsx:296 | B | C | `What decides whether a button shows` (InfoTip label) | `storefront.productPage.buttonInfoLabel` |
| ProductPageSection.tsx:299 | A | C | InfoTip body about buy button conditions | `storefront.productPage.buttonInfoBody` |
| ProductPageSection.tsx:301 | B | C | `Button text` (label) | `storefront.productPage.buttonText` |
| ProductPageSection.tsx:311 | A | C | `{n} characters left` (ICU) | `storefront.productPage.charsLeft` |
| ProductPageSection.tsx:332 | B | C | `Button color` (label) | `storefront.productPage.buttonColor` |
| ProductPageSection.tsx:340 | B | C | `Storefront accent` (inherit label) | `storefront.productPage.inheritAccent` |
| ProductPageSection.tsx:346 | B | C | `Corner roundness` (SliderField label) | `storefront.productPage.cornerRoundness` |
| ProductPageSection.tsx:358 | A | C | `Auto` (status text) | `common.auto` |
| ProductPageSection.tsx:374 | B | C | `Border thickness` (SliderField label) | `storefront.productPage.borderThickness` |
| ProductPageSection.tsx:391 | A | C | `None` (status text when 0) | `common.none` |
| ProductPageSection.tsx:396 | B | C | `Border color` (ColorPicker label) | `storefront.productPage.borderColor` |
| ProductPageSection.tsx:406 | B | C | `Button text color` (inherit label) | `storefront.productPage.buttonTextColor` |
| ProductPageSection.tsx:415 | B | C | `Price note` (label) | `storefront.productPage.priceNote` |
| ProductPageSection.tsx:420 | A | C | `Incl. VAT` / `Excl. tax` / `None` (SegmentedControl options) | `storefront.productPage.inclVat` / `exclTax` / `priceNoteNone` |
| ProductPageSection.tsx:428 | B | C | `Shipping note` (label) | `storefront.productPage.shippingNote` |
| ProductPageSection.tsx:434 | A | C | `Plus shipping` / `Free shipping` / `None` (SegmentedControl options) | `storefront.productPage.plusShipping` / `freeShipping` / `shippingNoteNone` |
| ProductPageSection.tsx:444 | A | C | `Sections` (CollapsibleSection title) | `storefront.productPage.sections` |
| ProductPageSection.tsx:450 | B | C | `When a section stays hidden` (InfoTip label) | `storefront.productPage.sectionsInfoLabel` |
| ProductPageSection.tsx:451 | A | C | InfoTip body about section visibility | `storefront.productPage.sectionsInfoBody` |
| ProductPageSection.tsx:484 | A | C | `under the title` (section placement hint) | `storefront.productPage.underTitle` |
| ProductPageSection.tsx:490 | A | C | `required by law` (section placement hint) | `storefront.productPage.requiredByLaw` |
| ProductPageSection.tsx:512 | B | C | `Availability` (section label) | `storefront.productPage.availability` |
| ProductPageSection.tsx:524 | B | C | `"Sold by" byline` (section label) | `storefront.productPage.soldByline` |
| ProductPageSection.tsx:548 | A | C | `Shipping and returns` (CollapsibleSection title) | `storefront.productPage.shippingReturns` |
| ProductPageSection.tsx:554 | B | C | `Why this lives in Settings, not here` (InfoTip label) | `storefront.productPage.shippingInfoLabel` |
| ProductPageSection.tsx:555 | A | C | InfoTip body about shipping in Settings | `storefront.productPage.shippingInfoBody` |
| ProductPageSection.tsx:589 | A | C | `{n} shipping profile` / `{n} shipping profiles` (ICU plural) | `storefront.productPage.profileCount` |
| ProductPageSection.tsx:591 | A | C | `{n} return profile` / `{n} return profiles` (ICU plural) | `storefront.productPage.returnCount` |
| ProductPageSection.tsx:596 | A | C | `Nothing set yet. Until you add your terms, product pages say the seller has not added shipping details.` | `storefront.productPage.noShipping` |
| ProductPageSection.tsx:610 | A | C | `Edit in Settings` (Link text) | `storefront.productPage.editInSettings` |
| ProductPageSection.tsx:610 | A | C | `Add your shipping terms` (Link text) | `storefront.productPage.addShippingTerms` |
| ProductPageSection.tsx:625 | A | C | `Seller details` (CollapsibleSection title) | `storefront.productPage.sellerDetails` |
| ProductPageSection.tsx:628 | B | C | `Why seller details live in Settings` (InfoTip label) | `storefront.productPage.sellerInfoLabel` |
| ProductPageSection.tsx:629 | A | C | InfoTip body about seller details in Settings | `storefront.productPage.sellerInfoBody` |
| ProductPageSection.tsx:669 | A | C | `Nothing set yet.` (empty state) | `storefront.productPage.noSellerDetails` |
| ProductPageSection.tsx:683 | A | C | `Edit in Settings` (Link text) | `storefront.productPage.editInSettings` |
| ProductPageSection.tsx:683 | A | C | `Add your business details` (Link text) | `storefront.productPage.addBusinessDetails` |
| **PriceTagControls.tsx** | | | | |
| PriceTagControls.tsx:130 | A | C | `Show the price` (strongLabel heading) | `storefront.priceTag.showPrice` |
| PriceTagControls.tsx:143 | A | C | `Rounded cards keep the tag on the center axis.` (hint) | `storefront.priceTag.roundedHint` |
| PriceTagControls.tsx:144 | A | C | `Drag it on the tile, or use the layout board, to choose a spot.` (hint) | `storefront.priceTag.dragHint` |
| PriceTagControls.tsx:146 | B | C | `Show on hover` (label) | `storefront.priceTag.showOnHover` |
| PriceTagControls.tsx:160 | A | C | `Font` (section label) | `storefront.priceTag.font` |
| PriceTagControls.tsx:178 | B | C | `Size` (SliderField label) | `storefront.priceTag.size` |
| PriceTagControls.tsx:188 | A | C | `Size on a single tile…` (tip text) | `storefront.priceTag.sizeTip` |
| PriceTagControls.tsx:196 | B | C | `Border thickness` (SliderField label) | `storefront.priceTag.borderThickness` |
| PriceTagControls.tsx:205 | A | C | `None` (status text when 0) | `common.none` |
| PriceTagControls.tsx:210 | B | C | `Corner roundness` (SliderField label) | `storefront.priceTag.cornerRoundness` |
| PriceTagControls.tsx:220 | A | C | `Sharp` (status text) | `storefront.priceTag.sharp` |
| PriceTagControls.tsx:220 | A | C | `Pill` (status text when max) | `storefront.priceTag.pill` |
| **TextFormatControls.tsx** | | | | |
| TextFormatControls.tsx:37 | D | C | FORMAT_LABELS: `Bold` / `Italic` / `Underline` | `storefront.textFormat.bold` / `italic` / `underline` |
| TextFormatControls.tsx:57 | A | C | `Format` (section label) | `storefront.textFormat.format` |
| TextFormatControls.tsx:100 | A | C | `Alignment` (section label) | `storefront.textFormat.alignment` |
| TextFormatControls.tsx:112 | B | C | `Align {direction}` (aria-label, ICU with direction value) | `storefront.textFormat.alignAriaLabel` |
| **LayoutSection.tsx** | | | | |
| LayoutSection.tsx:54 | B | C | `Canvas width` (SliderField label) | `storefront.layout.canvasWidth` |
| LayoutSection.tsx:59 | B | C | `{n} blocks wide` (valueText for screen reader) | `storefront.layout.blocksWide` |
| LayoutSection.tsx:65 | B | C | `Canvas height` (SliderField label) | `storefront.layout.canvasHeight` |
| LayoutSection.tsx:68 | A | C | `The board can't shrink below the blocks already on it…` (tip) | `storefront.layout.heightTip` |
| LayoutSection.tsx:73 | B | C | `{n} blocks tall` (valueText) | `storefront.layout.blocksTall` |
| LayoutSection.tsx:80 | B | C | `Grid density` (SliderField label) | `storefront.layout.gridDensity` |
| LayoutSection.tsx:87 | A | C | `No gap` (statusText when gap = 0) | `storefront.layout.noGap` |
| LayoutSection.tsx:96 | B | C | `Show grid` (toggle label) | `storefront.layout.showGrid` |
| LayoutSection.tsx:99 | B | C | `Who sees the grid` (InfoTip label) | `storefront.layout.gridInfoLabel` |
| LayoutSection.tsx:100 | A | C | InfoTip body about grid visibility | `storefront.layout.gridInfoBody` |
| **PlacementSection.tsx** | | | | |
| PlacementSection.tsx:101 | D | C | LAYER_CONTROLS: `Send to back` / `Send backward` / `Bring forward` / `Bring to front` | `storefront.placement.sendToBack` / etc. |
| PlacementSection.tsx:174 | B | C | `Rotation` (SliderField label) | `storefront.placement.rotation` |
| PlacementSection.tsx:177 | A | C | `Whole degrees, either way from level…` (tip) | `storefront.placement.rotationTip` |
| PlacementSection.tsx:188 | A | C | `Mixed angles` (statusText) | `storefront.placement.mixedAngles` |
| PlacementSection.tsx:188 | A | C | `{n} degrees` (statusText) | `storefront.placement.degrees` |
| PlacementSection.tsx:192 | A | C | `Mixed` (statusText) | `storefront.placement.mixed` |
| PlacementSection.tsx:205 | B | C | `Level the block` (aria-label) | `storefront.placement.levelBlock` |
| PlacementSection.tsx:205 | B | C | `Rotate to {n} degrees` (aria-label, ICU) | `storefront.placement.rotateTo` |
| PlacementSection.tsx:208 | A | C | `Level` (button label) | `storefront.placement.level` |
| PlacementSection.tsx:209 | A | C | `{n}°` (quick rotation button label) | `storefront.placement.angle` |
| PlacementSection.tsx:221 | B | C | `How layering works` (InfoTip label) | `storefront.placement.layerInfoLabel` |
| PlacementSection.tsx:222 | A | C | InfoTip body about layers | `storefront.placement.layerInfoBody` |
| PlacementSection.tsx:229 | A | C | `{n} blocks selected` (ICU plural) | `storefront.placement.blocksSelected` |
| PlacementSection.tsx:229 | A | C | `Layer {index} of {total}` (ICU) | `storefront.placement.layerOf` |
| PlacementSection.tsx:237 | B | C | `Block layer` (group aria-label) | `storefront.placement.blockLayerLabel` |
| PlacementSection.tsx:274 | A | C | `See all layers` (button) | `storefront.placement.seeAllLayers` |
| **HeaderSection.tsx** | | | | |
| HeaderSection.tsx:41 | B | C | `Show header` (toggle label) | `storefront.header.showHeader` |
| HeaderSection.tsx:52 | B | C | `Other ways to edit the header` (InfoTip label) | `storefront.header.infoLabel` |
| HeaderSection.tsx:53 | A | C | InfoTip body | `storefront.header.infoBody` |
| HeaderSection.tsx:54 | B | C | `Store name` (field label) | `storefront.header.storeName` |
| HeaderSection.tsx:66 | B | C | `Store name shown to buyers` (placeholder) | `storefront.header.storeNamePlaceholder` |
| HeaderSection.tsx:80 | B | C | `Bio` (field label) | `storefront.header.bio` |
| HeaderSection.tsx:87 | B | C | `A short line about your shop` (placeholder) | `storefront.header.bioPlaceholder` |
| HeaderSection.tsx:97 | A | C | `{n} characters left` (ICU counter) | `storefront.header.charsLeft` |
| **SoldOutSection.tsx** | | | | |
| SoldOutSection.tsx:37 | B | C | `Hide from buyers` (toggle label) | `storefront.soldOut.hide` |
| SoldOutSection.tsx:41 | B | C | `What hiding sold-out products does` (InfoTip label) | `storefront.soldOut.hideInfoLabel` |
| SoldOutSection.tsx:42 | A | C | InfoTip body about hiding | `storefront.soldOut.hideInfoBody` |
| SoldOutSection.tsx:57 | B | C | `Show badge` (toggle label) | `storefront.soldOut.badge` |
| SoldOutSection.tsx:61 | B | C | `When the sold-out badge appears` (InfoTip label) | `storefront.soldOut.badgeInfoLabel` |
| SoldOutSection.tsx:62 | A | C | InfoTip body (with-hide variant) | `storefront.soldOut.badgeInfoBodyHidden` |
| SoldOutSection.tsx:63 | A | C | InfoTip body (without-hide variant) | `storefront.soldOut.badgeInfoBodyVisible` |
| **TypographySection.tsx** | | | | |
| TypographySection.tsx:28 | D | C | FONT_DESCRIPTIONS: `The default` / `Clean and neutral` / `Geometric and wide` (partial record) | `storefront.typography.fontDescDefault` / etc. |
| TypographySection.tsx:84 | D | C | `Your uploaded font` (font option description) | `storefront.typography.uploadedFontDesc` |
| TypographySection.tsx:136 | B | C | `Font` (section label) | `storefront.typography.font` |
| TypographySection.tsx:148 | A | C | `Your own font` (subsection heading) | `storefront.typography.ownFont` |
| TypographySection.tsx:149 | B | C | `Which font files work` (InfoTip label) | `storefront.typography.fontInfoLabel` |
| TypographySection.tsx:150 | A | C | InfoTip body about supported font formats | `storefront.typography.fontInfoBody` |
| TypographySection.tsx:173 | A | C | `Processing…` | `common.processing` |
| TypographySection.tsx:173 | A | C | `Uploading… {n}%` (ICU) | `common.uploadingPct` |
| TypographySection.tsx:173 | A | C | `Replace font` | `storefront.typography.replaceFont` |
| TypographySection.tsx:173 | A | C | `Upload a font` | `storefront.typography.uploadFont` |
| TypographySection.tsx:181 | B | C | `Uploading font` (ProgressBar label) | `storefront.typography.uploadingLabel` |
| TypographySection.tsx:190 | A | C | `Remove` (button text) | `common.remove` |
| **ProductBlockEditor.tsx** | | | | |
| ProductBlockEditor.tsx:~20 | A | C | `Product` (inspector panel title) | `storefront.productBlock.title` |
| ProductBlockEditor.tsx:~30 | A | C | `Open product page` | `storefront.productBlock.openPage` |
| ProductBlockEditor.tsx:~35 | A | C | `Edit product` | `storefront.productBlock.editProduct` |
| ProductBlockEditor.tsx:~40 | A | C | `Remove from grid` | `storefront.productBlock.remove` |
| ProductBlockEditor.tsx:~45 | A | C | `Replace with another product` | `storefront.productBlock.replace` |
| ProductBlockEditor.tsx:~50 | B | C | `What the image frame is for` (InfoTip label) | `storefront.productBlock.frameInfoLabel` |
| ProductBlockEditor.tsx:~55 | A | C | InfoTip body about frame mode | `storefront.productBlock.frameInfoBody` |
| ProductBlockEditor.tsx:~60 | A | C | `Frame image` | `storefront.productBlock.frameImage` |
| ProductBlockEditor.tsx:~65 | A | C | `Done framing` | `storefront.productBlock.doneFaming` |
| ProductBlockEditor.tsx:~80 | E | C | Validation message: `This product has been deleted.` | `storefront.productBlock.deletedError` |
| ProductBlockEditor.tsx:~85 | E | C | Validation message: `This product is unavailable.` | `storefront.productBlock.unavailableError` |
| ProductBlockEditor.tsx:~90 | F | C | Toast: `Product updated.` | `storefront.productBlock.updatedToast` |
| ProductBlockEditor.tsx:~95 | A | C | `In stock` / `Out of stock` / `{n} left` stock status (ICU) | `storefront.productBlock.inStock` / `outOfStock` / `lowStock` |
| ProductBlockEditor.tsx:~100 | A | C | `Draft` (badge text) | `common.draft` |
| ProductBlockEditor.tsx:~110 | B | C | `Draft product: buyers cannot reach this link` (aria-label) | `storefront.productBlock.draftAriaLabel` |
| **TextBlockEditor.tsx** | | | | |
| TextBlockEditor.tsx:~20 | A | C | `Text block` (inspector title) | `storefront.textBlock.title` |
| TextBlockEditor.tsx:~25 | A | C | `Text` (tab label) | `storefront.textBlock.tabText` |
| TextBlockEditor.tsx:~27 | A | C | `Style` (tab label) | `storefront.textBlock.tabStyle` |
| TextBlockEditor.tsx:~30 | A | C | `Font` (label) | `storefront.textBlock.font` |
| TextBlockEditor.tsx:~35 | A | C | `Theme font` (option label) | `storefront.textBlock.themeFont` |
| TextBlockEditor.tsx:~40 | A | C | `Follow the storefront font` (hint) | `storefront.textBlock.followFont` |
| TextBlockEditor.tsx:~50 | A | C | `Colouring the {n} selected {n, plural, one {character} other {characters}}…` (ICU plural + concat) | `storefront.textBlock.colouringChars` |
| **ImageBlockEditor.tsx** | | | | |
| ImageBlockEditor.tsx:~20 | D | C | FIT_COPY: `Fill` + `Fills the block with no borders…` | `storefront.imageBlock.fitFill` / `fitFillDesc` |
| ImageBlockEditor.tsx:~22 | D | C | FIT_COPY: `Fit` + `Shows the whole image with letterboxing…` | `storefront.imageBlock.fitFit` / `fitFitDesc` |
| ImageBlockEditor.tsx:~30 | A | C | `Reposition image` (button label) | `storefront.imageBlock.reposition` |
| ImageBlockEditor.tsx:~35 | A | C | `Opacity` (label) | `storefront.imageBlock.opacity` |
| ImageBlockEditor.tsx:~40 | B | C | `Description` (label) | `storefront.imageBlock.description` |
| ImageBlockEditor.tsx:~45 | B | C | `Logo, icon, decoration…` (placeholder) | `storefront.imageBlock.descPlaceholder` |
| **ShapeBlockEditor.tsx** | | | | |
| ShapeBlockEditor.tsx:~20 | A | C | `Shape` (inspector title) | `storefront.shapeBlock.title` |
| ShapeBlockEditor.tsx:~25 | A | C | `Points` (label) | `storefront.shapeBlock.points` |
| ShapeBlockEditor.tsx:~30 | A | C | `Corner roundness` (label) | `storefront.shapeBlock.cornerRoundness` |
| ShapeBlockEditor.tsx:~35 | A | C | `Sharp` (status text) | `storefront.shapeBlock.sharp` |
| ShapeBlockEditor.tsx:~40 | A | C | `Fill` / `Color` (conditional label for ring) | `storefront.shapeBlock.fill` / `color` |
| ShapeBlockEditor.tsx:~45 | A | C | `Ring thickness` / `Border thickness` (conditional label) | `storefront.shapeBlock.ringThickness` / `borderThickness` |
| ShapeBlockEditor.tsx:~50 | A | C | `Border color` (label) | `storefront.shapeBlock.borderColor` |
| ShapeBlockEditor.tsx:~55 | A | C | `Opacity` (label) | `storefront.shapeBlock.opacity` |
| ShapeBlockEditor.tsx:~60 | A | C | `None` (status text when 0) | `common.none` |
| **MultiBlockEditor.tsx** | | | | |
| MultiBlockEditor.tsx:~20 | A | C | `{n} blocks` (inspector title, ICU) | `storefront.multiBlock.title` |
| MultiBlockEditor.tsx:~30 | A | C | `Remove {n} blocks` (button, ICU plural) | `storefront.multiBlock.remove` |
| MultiBlockEditor.tsx:~35 | A | C | `Products are not duplicated.` (hint) | `storefront.multiBlock.duplicateHint` |
| MultiBlockEditor.tsx:~40 | A | C | `Reset to theme` (button label) | `storefront.multiBlock.resetTheme` |
| MultiBlockEditor.tsx:~45 | A | C | `Opacity` (label) | `storefront.multiBlock.opacity` |
| MultiBlockEditor.tsx:~50 | A | C | `{n} different values` (status text for mixed, ICU) | `storefront.multiBlock.mixed` |
| **LayersPanel.tsx** | | | | |
| LayersPanel.tsx:~20 | A | C | `Layers` (panel title) | `storefront.layers.title` |
| LayersPanel.tsx:~30 | A | C | `Nothing on the canvas yet. Blocks appear here as you add them.` (empty state) | `storefront.layers.empty` |
| LayersPanel.tsx:~40 | A | C | `Layer {index} of {total}` (label, ICU) | `storefront.layers.layerOf` |
| LayersPanel.tsx:~45 | B | C | `Reorder {label}` (aria-label, t.rich: label may be product title) | `storefront.layers.reorderLabel` |
| LayersPanel.tsx:~50 | A | C | Keyboard shortcut hint text | `storefront.layers.shortcutHint` |
| **BlockTile.tsx** | | | | |
| BlockTile.tsx:181 | B | C | `Removed product` (product title fallback when product deleted) | `storefront.blockTile.removedProduct` |
| BlockTile.tsx:183 | B | C | `{kind} shape` (aria-label for shape block, ICU) | `storefront.blockTile.shapeLabel` |
| BlockTile.tsx:185 | B | C | `Image element` (aria-label fallback when no alt text) | `storefront.blockTile.imageElement` |
| BlockTile.tsx:188 | B | C | `Text block` (aria-label fallback when no text) | `storefront.blockTile.textBlock` |
| BlockTile.tsx:561 | B | C | `Selected: {label}. Press Enter to deselect.` (aria-label, t.rich) | `storefront.blockTile.selectedAriaLabel` |
| BlockTile.tsx:563 | B | C | `{label}. Press Enter to select and edit.` (aria-label, t.rich) | `storefront.blockTile.unselectedAriaLabel` |
| BlockTile.tsx:729 | B | C | `Draft product -- buyers cannot reach this link` (aria-label) | `storefront.blockTile.draftAriaLabel` |
| BlockTile.tsx:731 | A | C | `Draft` (badge text) | `common.draft` |
| **BlockActions.tsx** | | | | |
| BlockActions.tsx:~10 | A | C | `Duplicate` (default prop label) | `storefront.blockActions.duplicate` |
| BlockActions.tsx:~11 | A | C | `Remove from grid` (default prop label) | `storefront.blockActions.remove` |
| **StorefrontMasthead.tsx** | | | | |
| StorefrontMasthead.tsx:179 | B | C | `Edit the store {line}` (aria-label; line = "name"/"bio": constant) | `storefront.masthead.editAriaLabel` |
| StorefrontMasthead.tsx:256 | B | C | `Your store name` (editor-only placeholder) | `storefront.masthead.namePlaceholder` |
| StorefrontMasthead.tsx:285 | B | C | `A short line about your shop` (editor-only placeholder) | `storefront.masthead.bioPlaceholder` |
| **PanelSearchField.tsx** | | | | |
| PanelSearchField.tsx:125 | B | C | `Find a setting or object` (aria-label + placeholder) | `storefront.search.placeholder` |
| PanelSearchField.tsx:135 | B | C | `Clear search` (button aria-label) | `storefront.search.clear` |
| PanelSearchField.tsx:151 | A | C | `Nothing in the editor matches that.` (empty state) | `storefront.search.noResults` |
| PanelSearchField.tsx:154 | B | C | `Matches` (listbox aria-label) | `storefront.search.matchesLabel` |
| **FontSizeField.tsx** | | | | |
| FontSizeField.tsx:63 | B | C | `Size` (label) | `storefront.fontSizeField.label` |
| FontSizeField.tsx:66 | A | C | `Auto ({n} px)` (ICU interpolation) | `storefront.fontSizeField.autoPx` |
| FontSizeField.tsx:74 | A | C | `Auto` (reset button label) | `storefront.fontSizeField.auto` |
| **StorefrontDesigner.tsx** | | | | |
| StorefrontDesigner.tsx:~3471 | A | C | `Add product` (inspector title) | `storefront.designer.inspectorAddProduct` |
| StorefrontDesigner.tsx:~3472 | A | C | `{n} blocks` (inspector title, ICU plural) | `storefront.designer.inspectorBlocks` |
| StorefrontDesigner.tsx:~3473 | A | C | `Product` (inspector title) | `storefront.designer.inspectorProduct` |
| StorefrontDesigner.tsx:~3474 | A | C | `Shape` (inspector title) | `storefront.designer.inspectorShape` |
| StorefrontDesigner.tsx:~3475 | A | C | `Image` (inspector title) | `storefront.designer.inspectorImage` |
| StorefrontDesigner.tsx:~3476 | A | C | `Text block` (inspector title) | `storefront.designer.inspectorText` |
| StorefrontDesigner.tsx:~3555 | B | C | `Back to storefronts` (aria-label) | `storefront.designer.backAriaLabel` |
| StorefrontDesigner.tsx:~3576 | B | C | `Storefront name` (sr-only label) | `storefront.designer.nameLabel` |
| StorefrontDesigner.tsx:~3583 | B | C | `Untitled storefront` (placeholder) | `storefront.designer.namePlaceholder` |
| StorefrontDesigner.tsx:~3609 | A | C | `Unsaved changes` (status text) | `storefront.designer.unsavedChanges` |
| StorefrontDesigner.tsx:~3619 | A | C | `Saving…` (button text) | `common.saving` |
| StorefrontDesigner.tsx:~3619 | A | C | `Save` (button text) | `common.save` |
| StorefrontDesigner.tsx:~3640 | A | C | `For the best editing experience, open this designer on a desktop or tablet. Reordering blocks and editing the header work on any device.` (mobile notice) | `storefront.designer.mobileNotice` |
| StorefrontDesigner.tsx:~3651 | B | C | `Dismiss the small-screen editing notice` (aria-label) | `storefront.designer.dismissNoticeAriaLabel` |
| StorefrontDesigner.tsx:~3443 | F | C | `Saved, but some products are still drafts.` (toast title) | `storefront.designer.savedWithDrafts` |
| StorefrontDesigner.tsx:~3450 | F | C | `Storefront saved.` (toast) | `storefront.designer.saved` |
| StorefrontDesigner.tsx:~3451 | F | C | `1 block pointed at a deleted product and was removed.` / `{n} blocks pointed at deleted products and were removed.` (toast, ICU plural) | `storefront.designer.blocksRemoved` |
| StorefrontDesigner.tsx:~3455 | F | C | `Publish those products when ready.` (toast detail) | `storefront.designer.publishDrafts` |
| StorefrontDesigner.tsx:~4171 | A | C | `Save your changes?` (modal title) | `storefront.designer.leaveTitle` |
| StorefrontDesigner.tsx:~4172 | A | C | `You have unsaved changes to this storefront. Save them before leaving, or discard them.` (modal description) | `storefront.designer.leaveDesc` |
| StorefrontDesigner.tsx:~4182 | A | C | `Saving…` | `common.saving` |
| StorefrontDesigner.tsx:~4182 | A | C | `Save changes` | `storefront.designer.saveChanges` |
| StorefrontDesigner.tsx:~4184 | A | C | `Discard changes` | `storefront.designer.discardChanges` |
| StorefrontDesigner.tsx:~4186 | A | C | `Keep editing` | `storefront.designer.keepEditing` |
| StorefrontDesigner.tsx:~3622 | B | C | `Search` (panel search aria-label) | `storefront.designer.searchAriaLabel` |
| **DesignerCanvas.tsx** | | | | |
| DesignerCanvas.tsx:~56 | B | C | `Removed product` (accessible label fallback) | `storefront.blockTile.removedProduct` |
| DesignerCanvas.tsx:~58 | B | C | `{kind} shape` (accessible label, ICU) | `storefront.blockTile.shapeLabel` |
| DesignerCanvas.tsx:~60 | B | C | `Image element` (accessible label fallback) | `storefront.blockTile.imageElement` |
| DesignerCanvas.tsx:~62 | B | C | `Text block` (accessible label fallback) | `storefront.blockTile.textBlock` |
| **config-maps.ts** | | | | |
| config-maps.ts:49 | D | C | FONT_LABELS: `Sans` / `Serif` / `Mono` / `Display` / `Handwritten` / `Inter` / `Montserrat` / `Uploaded font` | `storefront.configMaps.fontSans` / etc. |
| config-maps.ts:319 | D | C | PRICE_TAG_FONT_LABELS: `Sans` / `Serif` / `Mono` | `storefront.configMaps.priceTagFontSans` / etc. |
| config-maps.ts:463 | D | C | TEXT_VARIANT_LABELS: `Heading` / `Subheading` / `Body text` | `storefront.configMaps.variantHeading` / etc. |
| **block-label.ts** | | | | |
| block-label.ts:28 | D | C | BLOCK_KIND_LABELS: `Product` / `Text` / `Shape` / `Image` | `storefront.blockLabel.product` / `text` / `shape` / `image` |
| block-label.ts:32 | D | C | `"Product"` fallback (unknown product) | `storefront.blockLabel.product` |
| block-label.ts:34 | D | C | `"Text"` fallback | `storefront.blockLabel.text` |
| block-label.ts:39 | D | C | `"Image"` fallback | `storefront.blockLabel.image` |
| **editor-search.ts** | | | | |
| editor-search.ts:81 | D | C | SECTIONS: `On the canvas` / `Settings` / `Panels` | `storefront.editorSearch.sectionCanvas` / `settings` / `panels` |
| editor-search.ts:139 | D | C | `Open the product page` (search entry title) | `storefront.editorSearch.openProductPage` |
| editor-search.ts:158 | D | C | PANEL_ENTRIES titles: `Layers` / `Add a product` / `Shapes` / `Uploads` | `storefront.editorSearch.panelLayers` / etc. |
| **create-options.tsx** | | | | |
| create-options.tsx:~10 | D | C | CATEGORY_META labels: `Physical` / `Digital` / `Service` / `Experience` (and matching namePlaceholders) | `storefront.createOptions.categoryPhysical` / etc. |
| create-options.tsx:~25 | D | C | FULFILMENT_META labels: `Shipping` / `Download` / `In-person` / `On request` (and hints) | `storefront.createOptions.fulfilmentShipping` / etc. |
| create-options.tsx:~40 | D | C | VIBE_LABELS: `Minimal` / `Classic` / `Bold` | `storefront.createOptions.vibeMinimal` / etc. |
| create-options.tsx:~45 | D | C | VIBE_HINTS (wizard): 3 description strings | `storefront.createOptions.vibeHintMinimal` / etc. |
| **ProductPicker.tsx** | | | | |
| ProductPicker.tsx:112 | A | C | `Add your first product` (button text) | `storefront.picker.addFirst` |
| ProductPicker.tsx:118 | A | C | `You have no products yet. Add one and you'll come straight back here to place it.` | `storefront.picker.noProducts` |
| ProductPicker.tsx:204 | B | C | `Search products` (input placeholder) | `storefront.picker.searchPlaceholder` |
| ProductPicker.tsx:205 | B | C | `Search your products` (aria-label) | `storefront.picker.searchAriaLabel` |
| ProductPicker.tsx:212 | A | C | `Searching...` (status) | `storefront.picker.searching` |
| ProductPicker.tsx:217 | A | C | `No products match "{term}".` (ICU with term) | `storefront.picker.noMatch` |
| ProductPicker.tsx:222 | F | C | `Search is unavailable right now; showing what's already loaded.` | `storefront.picker.searchFailed` |
| ProductPicker.tsx:229 | A | C | `In grid` (section heading) | `storefront.picker.inGrid` |
| ProductPicker.tsx:245 | A | C | `Available` (section heading) | `storefront.picker.available` |
| ProductPicker.tsx:264 | A | C | `Add {n} selected` (button, ICU) | `storefront.picker.addSelected` |
| ProductPicker.tsx:273 | A | C | `Add all ({n})` (button, ICU) | `storefront.picker.addAll` |
| ProductPicker.tsx:313 | B | C | `Deselect {title}` / `Select {title}` (aria-label, t.rich) | `storefront.picker.deselectAriaLabel` / `selectAriaLabel` |
| ProductPicker.tsx:368 | B | C | `{title} is in the grid` (aria-label, t.rich) | `storefront.picker.inGridAriaLabel` |
| ProductPicker.tsx:369 | B | C | `Add {title} to grid` (aria-label, t.rich) | `storefront.picker.addToGridAriaLabel` |
| ProductPicker.tsx:351 | B | C | `Draft product -- not visible to buyers` (aria-label) | `storefront.picker.draftAriaLabel` |
| ProductPicker.tsx:354 | A | C | `Draft` (badge text) | `common.draft` |

---

## Strings requiring t.rich

These 28 strings contain JSX interpolation, embed React nodes in translated text,
or concatenate seller-authored data (product title, store name) with translated
copy. They cannot be expressed as a plain ICU `t()` call and need `t.rich()` or
careful decomposition.

| File:line | Current string | Why t.rich | Proposed key |
|-----------|----------------|------------|--------------|
| StorefrontsList.tsx:120 | `"${target.name}" was deleted.` | seller name concatenated in toast | `storefront.list.deleteToast` |
| StorefrontsList.tsx:249 | `"${pendingDelete.name}" and its grid will be permanently removed.` | seller name interpolated | `storefront.list.deleteDesc` |
| StorefrontCard.tsx:~55 | `` `Edit ${name}` `` (aria-label) | store name concatenated | `storefront.card.editAriaLabel` |
| StorefrontCard.tsx:~60 | `` `Embed ${name}` `` (aria-label) | store name concatenated | `storefront.card.embedAriaLabel` |
| StorefrontCard.tsx:~65 | `` `Delete ${name}` `` (aria-label) | store name concatenated | `storefront.card.deleteAriaLabel` |
| EmbedModal.tsx:~45 | `` `Paste this snippet into any site to show "${storefront.name}" there.` `` | seller store name embedded | `storefront.embed.description` |
| SelectionToolbar.tsx:~30 | `` `Edit the text of ${name}` `` | blockLabel() result (may be product title) | `storefront.selectionToolbar.editText` |
| SelectionToolbar.tsx:~35 | `` `Edit color of ${name}` `` | blockLabel() result | `storefront.selectionToolbar.editColor` |
| SelectionToolbar.tsx:~40 | `` `Edit border of ${name}` `` | blockLabel() result | `storefront.selectionToolbar.editBorder` |
| SelectionToolbar.tsx:~45 | `` `Edit corners of ${name}` `` | blockLabel() result | `storefront.selectionToolbar.editCorners` |
| SelectionToolbar.tsx:~50 | `` `Edit opacity of ${name}` `` | blockLabel() result | `storefront.selectionToolbar.editOpacity` |
| SelectionToolbar.tsx:~55 | `` `Duplicate ${name}` `` | blockLabel() result | `storefront.selectionToolbar.duplicate` |
| SelectionToolbar.tsx:~60 | `` `Remove ${name} from grid` `` | blockLabel() result | `storefront.selectionToolbar.remove` |
| ProductPicker.tsx:313 | `` `${isChecked ? "Deselect" : "Select"} ${product.title}` `` | product title (seller-authored) concatenated | `storefront.picker.selectAriaLabel` |
| ProductPicker.tsx:368 | `` `${product.title} is in the grid` `` | product title concatenated | `storefront.picker.inGridAriaLabel` |
| ProductPicker.tsx:369 | `` `Add ${product.title} to grid` `` | product title concatenated | `storefront.picker.addToGridAriaLabel` |
| ColorPanel.tsx:~45 | `` `Use ${target.inherit.label}` `` | colour/theme label concatenated | `storefront.color.useInherit` |
| LayersPanel.tsx:~45 | `` `Reorder ${label}` `` | blockLabel() result (may be product title) | `storefront.layers.reorderLabel` |
| UploadsPanel.tsx:~55 | `` `Place ${upload.alt} again` `` | upload alt text (user-authored) | `storefront.uploads.placeAgain` |
| ShapesPanel.tsx:46 | `` `Add ${SHAPE_SPECS[kind].label.toLowerCase()}` `` | shape label concatenated | `storefront.shapes.addLabel` |
| DesignPanel.tsx:~36 | `` `Close ${inspectorTitle.toLowerCase()} panel` `` | inspector title concatenated | `storefront.designPanel.close` |
| TextBlockEditor.tsx:~50 | `` `Colouring the ${n} selected ${n === 1 ? "character" : "characters"}…` `` | ICU plural + concatenation | `storefront.textBlock.colouringChars` |
| BlockTile.tsx:561 | `` `Selected: ${label}. Press Enter to deselect.` `` | label from blockLabel() (may be product title) | `storefront.blockTile.selectedAriaLabel` |
| BlockTile.tsx:563 | `` `${label}. Press Enter to select and edit.` `` | label from blockLabel() | `storefront.blockTile.unselectedAriaLabel` |
| ProductPageSection.tsx:145 | `` `Same as storefront (${fontName})` `` | font name concatenated | `storefront.productPage.fontSameAs` |
| StorefrontDesigner.tsx:~3443 | `` `${names}${more} ${n === 1 ? "is a draft" : "are drafts"} and buyers cannot reach…` `` | product names from seller data, ICU plural | `storefront.designer.draftBlocksToast` |
| StorefrontDesigner.tsx:~3451 | `` `${n} blocks pointed at deleted products and were removed.` `` | ICU plural with seller-data context | `storefront.designer.blocksRemoved` |
| ShapesPanel.tsx:37 | `` `${group.title} shapes` `` | group title from SHAPE_GROUPS data | `storefront.shapes.groupLabel` |

---

## Notes for implementation

**Three hardest files to convert:**

1. **StorefrontDesigner.tsx (4240 lines)**: Single largest file; inspector titles are computed from a ternary chain over `selection`, so they need an intermediate map to translation keys rather than a direct swap. The draft-products toast at ~3443 concatenates seller product names (possibly plural) in the body text, requiring t.rich _and_ ICU plural at once. The file is also not yet split into smaller components, so the `t` hook must be threaded through 4000+ lines or a wrapper component created.

2. **SelectionToolbar.tsx**: All its aria-labels concatenate `blockLabel()` output, which may return a product title (seller-authored, out of scope for translation). For Czech, the challenge is that "Edit color of {name}" changes grammatically depending on whether "name" is a product title or an editor label. All 7 toolbar action labels need t.rich and the `name` variable must be passed as an ICU `{name}` placeholder at runtime.

3. **ProductPageSection.tsx (~700 lines)**: Highest single-file string count (~50 strings). Sections are conditionally shown/hidden; many InfoTip bodies are multiline; the font inheritance label concatenates a programmatic font name; the shipping/return profile count lines need ICU plural; and two separate "Edit in Settings" links need to map to different actions. The file also mixes read-only settings summaries (buyer-facing indirectly) with editor chrome, which requires careful scoping.

**Cross-cutting notes:**
- `common.auto`, `common.none`, `common.cancel`, `common.delete`, `common.save`, `common.draft`, `common.processing` appear in 4+ components and must be in a shared namespace to avoid duplication.
- `Processing…` / `Uploading… {n}%` appear verbatim in BackgroundEditor, UploadsPanel, EditorToolbar, and TypographySection: factor into `common.processing` / `common.uploadingPct`.
- VIBE_LABELS and VIBE_HINTS are duplicated between `create-options.tsx` and `LooksSection.tsx`; they should share the same i18n keys.
- `block-label.ts` and `DesignerCanvas.tsx` both define the same four accessible label fallbacks ("Removed product", "Image element", "Text block", shape label): single shared key set.
- All 45 files are `"use client"`: use `useTranslations`, not `await getTranslations`.
