# i18n Inventory: Core Components & Routes

**Total findings: 174 strings**

| Category | Count |
|----------|-------|
| A: JSX text | 91 |
| B: string props / aria / defaults | 64 |
| C: route metadata (title/description) | 10 |
| D: lib-copy constants (status/channel label maps) | 9 |

_Categories E (validation), F (imperative UI), G (locale-sensitive formatting): see notes below._

| Rendering | File count |
|-----------|------------|
| Client ("use client") | 29 |
| Server (no directive) | 16 |

**Files requiring `t.rich` (JSX-interrupted strings):** `ResetPasswordForm.tsx`, `PanelMenu.tsx`, `WelcomeFlow.tsx` (confirmation email line), `ViewingBanner.tsx`

**Files requiring `await getTranslations`** (server components):
`DashboardHome.tsx`, `NeedsAttention.tsx`, `RecentOrders.tsx`, `MetricTile.tsx`,
`AnalyticsSection.tsx`, `AnalyticsTiles.tsx`, `ChartCard.tsx`,
`SignalSection.tsx`, `SignalsUnavailableNotice.tsx`, `AnalyticsSkeleton.tsx`,
`OrderStatusBadge.tsx`, `OrdersSkeleton.tsx`, `StockBadge.tsx`,
`LastUsedBadge.tsx`, `BrandFooter.tsx`, `PageHeader.tsx`

**Auth constraint:** `LoginForm.tsx`, `ResetPasswordForm.tsx`, `GoogleButton.tsx`,
`PasswordResetModal.tsx`, `LastUsedBadge.tsx` all render while signed out.
Locale can only come from the `ss_locale` cookie, never from the user profile.
Phase 1 cookie work is a prerequisite for these files.

**Lib coupling:** `NeedsAttention.tsx` renders `item.label`, `item.description`,
`item.actionLabel` from `src/lib/dashboard/attention.ts`. That lib is Phase 5
territory. The render site must be updated in the same pass, but the string
keys themselves are the lib agent's responsibility.

**Category G (locale-sensitive formatting):** `chart-format.ts` (`moneyExact`,
`moneyCompact`) and `src/lib/dashboard/format.ts` (`formatCents`,
`formatOrderDate`) use fixed currency-symbol logic and hard-coded comma
separators. They must be threaded with a locale value (from `next-intl`'s
`useFormatter` / `getFormatter`) rather than wrapped with `t()`. These are
tracked in `docs/plans/04-ui-localisation.md` Phase 3. Affected chart files:
`RevenueTrendChart.tsx`, `AovTrendChart.tsx`, `ChannelSplitChart.tsx`,
`TopProductsChart.tsx`, `WeekdayChart.tsx`, `StatusBreakdown.tsx`.

---

## Proposed `Common.*` shared keys

These strings appear as shared primitives (buttons, modal, toast) or repeat
verbatim across multiple directories. Wrapping once in `Common.*` avoids
duplicating the same Czech translation N times.

| Key | String |
|-----|--------|
| `Common.actions.save` | "Save" |
| `Common.actions.saving` | "Saving…" |
| `Common.actions.saved` | "Saved" |
| `Common.actions.cancel` | "Cancel" |
| `Common.actions.done` | "Done" |
| `Common.actions.close` | "Close" |
| `Common.actions.copy` | "Copy" |
| `Common.actions.copied` | "Copied" |
| `Common.actions.copyFailed` | "Copy failed" |
| `Common.actions.back` | "Back" |
| `Common.badge.comingSoon` | "Coming soon" |
| `Common.calendar.previousMonth` | "Previous month" |
| `Common.calendar.nextMonth` | "Next month" |
| `Common.calendar.today` | "Today" |
| `Common.datePicker.chooseDate` | "Choose date" |
| `Common.datePicker.chooseDateRange` | "Choose date range" |
| `Common.datePicker.selectDate` | "Select date" |
| `Common.stock.inStock` | "In stock" |
| `Common.stock.lowStock` | "Only {remaining} left" (ICU plural) |
| `Common.stock.soldOut` | "Sold out" |
| `Common.toast.regionLabel` | "Notifications" |
| `Common.toast.dismiss` | "Dismiss" |

---

## src/components/ui/

> **Highest-leverage directory.** Every string here propagates to all
> surfaces. All map to `Common.*` namespace.

| File:line | Cat | C/S | Current string | Proposed key |
|-----------|-----|-----|----------------|--------------|
| modal.tsx:132 | B | C | `aria-label="Close"` | `Common.actions.close` |
| Toast.tsx:268 | B | C | `aria-label="Notifications"` (toast region) | `Common.toast.regionLabel` |
| Toast.tsx:479 | B | C | `aria-label="Dismiss"` (close button) | `Common.toast.dismiss` |
| SaveButton.tsx:35 | B | C | `pendingLabel = "Saving…"` | `Common.actions.saving` |
| SaveButton.tsx:36 | B | C | `savedLabel = "Saved"` | `Common.actions.saved` |
| SaveButton.tsx:38 | A | C | `children = "Save"` default | `Common.actions.save` |
| CopyButton.tsx:85 | B | C | `` `${label} cannot be copied yet` `` | `Common.actions.copyCannotYet` (param: label) |
| CopyButton.tsx:87 | B | C | `` `Couldn't copy ${label}…` `` | `Common.actions.copyFailed` (param: label) |
| CopyButton.tsx:89 | B | C | `` `Copied ${label}` `` | `Common.actions.copiedLabel` (param: label) |
| CopyButton.tsx:91 | B | C | `` `Copy ${label}` `` | `Common.actions.copyLabel` (param: label) |
| CopyButton.tsx:108 | A | C | `"Copy failed"` (toast) | `Common.actions.copyFailed` |
| CopyButton.tsx:108 | A | C | `"Copied"` (toast) | `Common.actions.copied` |
| CopyButton.tsx:108 | A | C | `"Copy"` (button label) | `Common.actions.copy` |
| DatePicker.tsx:111 | B | C | `label="Choose date"` | `Common.datePicker.chooseDate` |
| DatePicker.tsx:111 | B | C | `label="Choose date range"` | `Common.datePicker.chooseDateRange` |
| DatePicker.tsx:127 | B | C | `placeholder \|\| "Select date"` default | `Common.datePicker.selectDate` |
| DatePicker.tsx:149 | A | C | `"Done"` button | `Common.actions.done` |
| StockBadge.tsx:19 | A | S | `"In stock"` | `Common.stock.inStock` |
| StockBadge.tsx:21 | A | S | `` `Only ${badge.remaining} left` `` | `Common.stock.lowStock` (ICU plural) |
| StockBadge.tsx:22 | A | S | `"Sold out"` | `Common.stock.soldOut` |
| PanelMenu.tsx:115 | B | C | `` `Back to all settings, leaving ${title}` `` | `Common.panelMenu.backLeaving` (t.rich, param: title) |
| Calendar.tsx:135 | B | C | `aria-label="Previous month"` | `Common.calendar.previousMonth` |
| Calendar.tsx:144 | B | C | `aria-label="Next month"` | `Common.calendar.nextMonth` |
| Calendar.tsx:235 | A | C | `"Today"` button | `Common.calendar.today` |

---

## src/components/auth/

> AUTH NOTE: all files below render while signed out. Locale comes from the
> `ss_locale` cookie only. Phase 1 cookie work must land before these are wrapped.

| File:line | Cat | C/S | Current string | Proposed key |
|-----------|-----|-----|----------------|--------------|
| LoginForm.tsx (various) | A | C | `"or"` (divider between auth methods) | `Auth.login.or` |
| LoginForm.tsx | A | C | `"Sign in"` tab label | `Auth.login.tabSignIn` |
| LoginForm.tsx | A | C | `"Sign up"` tab label | `Auth.login.tabSignUp` |
| LoginForm.tsx | B | C | `placeholder="Email"` | `Auth.login.emailPlaceholder` |
| LoginForm.tsx | B | C | `placeholder="Password"` | `Auth.login.passwordPlaceholder` |
| LoginForm.tsx | A | C | `"Forgot?"` password hint link | `Auth.login.forgot` |
| LoginForm.tsx | A | C | `"Sign in"` CTA button | `Auth.login.signInCta` |
| LoginForm.tsx | A | C | `"Signing in…"` pending | `Auth.login.signingIn` |
| LoginForm.tsx | A | C | `"Create account"` CTA button | `Auth.login.createAccount` |
| LoginForm.tsx | A | C | `"Creating account…"` pending | `Auth.login.creatingAccount` |
| LoginForm.tsx | A | C | `"Send magic link"` CTA button | `Auth.login.sendMagicLink` |
| LoginForm.tsx | A | C | `"Sending link…"` pending | `Auth.login.sendingLink` |
| LoginForm.tsx | A | C | `"Use a password instead"` toggle | `Auth.login.usePassword` |
| LoginForm.tsx | A | C | `"Email me a magic link instead"` toggle | `Auth.login.useMagicLink` |
| ResetPasswordForm.tsx (various) | B | C | `"Setting a new password for {email}"` (needs t.rich) | `Auth.resetPassword.settingFor` |
| ResetPasswordForm.tsx | B | C | `label="New password"` | `Auth.resetPassword.newPasswordLabel` |
| ResetPasswordForm.tsx | B | C | `label="Confirm new password"` | `Auth.resetPassword.confirmPasswordLabel` |
| ResetPasswordForm.tsx | A | C | `"At least 8 characters."` hint | `Auth.resetPassword.passwordHint` |
| ResetPasswordForm.tsx | A | C | `"Updating…"` pending | `Auth.resetPassword.updating` |
| ResetPasswordForm.tsx | A | C | `"Update password"` CTA button | `Auth.resetPassword.updateCta` |
| GoogleButton.tsx | A | C | `"Continue with Google"` | `Auth.google.continueWith` |
| PasswordResetModal.tsx | B | C | `title="Reset your password"` (Modal prop) | `Auth.passwordReset.title` |
| PasswordResetModal.tsx | B | C | `description="Enter your email and we'll send a link…"` | `Auth.passwordReset.description` |
| PasswordResetModal.tsx | B | C | `label="Email"` field | `Auth.passwordReset.emailLabel` |
| PasswordResetModal.tsx | A | C | `"Back to sign in"` link | `Auth.passwordReset.backToSignIn` |
| PasswordResetModal.tsx | A | C | `"Sending…"` pending | `Auth.passwordReset.sending` |
| PasswordResetModal.tsx | A | C | `"Send reset link"` CTA button | `Auth.passwordReset.sendResetLink` |
| LastUsedBadge.tsx:13 | A | S | `"Last used"` | `Auth.lastUsed` |

---

## src/components/orders/

| File:line | Cat | C/S | Current string | Proposed key |
|-----------|-----|-----|----------------|--------------|
| OrdersEmptyState.tsx:33 | A | C | `"No orders match these filters"` | `Orders.empty.filteredTitle` |
| OrdersEmptyState.tsx:35 | A | C | `"Try widening the date range or clearing filters."` | `Orders.empty.filteredHint` |
| OrdersEmptyState.tsx:42 | A | C | `"Clear filters"` | `Orders.empty.clearFilters` |
| OrdersEmptyState.tsx:50 | A | C | `"No orders yet"` | `Orders.empty.title` |
| OrdersEmptyState.tsx:51 | A | C | `"Square Share checkout isn't open yet…"` | `Orders.empty.hint` |
| OrdersEmptyState.tsx:55 | A | C | `"Go to products"` | `Orders.empty.goToProducts` |
| OrdersPage.tsx:210 | A | C | `"Updating…"` overlay | `Orders.list.updating` |
| OrdersPage.tsx:229 | A | C | `` `{total} order{s} · page {n} of {totalPages}` `` | `Orders.list.pagination` (ICU plural) |
| OrdersPage.tsx:238 | A | C | `"Previous"` pagination | `Common.pagination.previous` |
| OrdersPage.tsx:247 | A | C | `"Next"` pagination | `Common.pagination.next` |
| OrdersPage.tsx:256 | B | C | `aria-label="Order details"` dialog | `Orders.detail.ariaLabel` |
| OrdersPage.tsx:261 | B | C | `aria-label="Close order details"` scrim | `Orders.detail.closeAriaLabel` |
| OrdersToolbar.tsx | D | C | `STATUS_OPTIONS`: "All statuses", "Paid", "Pending", "Disputed", "Refunded" | `Orders.status.*` |
| OrdersToolbar.tsx | D | C | `SORT_OPTIONS`: "Newest first", "Oldest first", "Amount: high to low", "Amount: low to high" | `Orders.sort.*` |
| OrdersToolbar.tsx | D | C | `CHANNEL_META`: "Embed", "Marketplace" | `Orders.channel.*` |
| OrdersToolbar.tsx | B | C | `aria-label="order filters"` | `Orders.toolbar.filtersAriaLabel` |
| OrdersToolbar.tsx | B | C | `aria-label="Filter by status"` | `Orders.toolbar.filterStatusAriaLabel` |
| OrdersToolbar.tsx | B | C | `aria-label="Sort orders"` | `Orders.toolbar.sortAriaLabel` |
| OrdersToolbar.tsx | B | C | `placeholder="search buyer email"` | `Orders.toolbar.searchPlaceholder` |
| OrdersToolbar.tsx | B | C | `placeholder="any dates"` date range | `Orders.toolbar.datePlaceholder` |
| OrdersToolbar.tsx | B | C | field labels: "channel", "buyer email", "status", "date range", "sort" | `Orders.toolbar.label.*` |
| OrdersToolbar.tsx | A | C | `"clear filters"` button | `Orders.toolbar.clearFilters` |
| OrderDetail.tsx | A | C | Row labels: "Version", "Amount", "Platform fee", "You receive", "Buyer email", "Channel", "Date", "Order ID" | `Orders.detail.field.*` |
| OrderDetail.tsx | D | C | `CHANNEL_LABELS`: "Embed", "Marketplace" | `Orders.channel.*` |
| OrderDetail.tsx | B | C | `aria-label="Close order details"` button | `Orders.detail.closeAriaLabel` |
| OrderDetail.tsx | A | C | `"no email"` fallback | `Orders.detail.noEmail` |
| OrdersTable.tsx | A | C | Column headers: "Product", "Amount", "Channel", "Status", "Buyer", "Date" | `Orders.table.col.*` |
| OrderStatusBadge.tsx | D | S | `STATUS_LABELS`: "Paid", "Refunded", "Disputed", "Pending" | `Orders.status.*` |
| OrderActions.tsx | A | C | `"Refunds require Stripe to be connected."` | `Orders.actions.refundStripeRequired` |
| OrderActions.tsx | A | C | `"Connect Stripe to enable refunds"` | `Orders.actions.connectStripe` |
| OrderActions.tsx | A | C | `"Refund this order? This cannot be undone once Stripe is connected."` | `Orders.actions.refundConfirm` |
| OrderActions.tsx | A | C | `"Confirm refund"` | `Orders.actions.confirmRefund` |
| OrderActions.tsx | A | C | `"Cancel"` | `Common.actions.cancel` |
| OrderActions.tsx | A | C | `"Refund order"` | `Orders.actions.refundOrder` |
| OrderActions.tsx | A | C | `"Disputes are handled in your Stripe dashboard…"` | `Orders.actions.disputeStripeInfo` |
| OrderActions.tsx | A | C | `"Open dispute handling for this order?"` | `Orders.actions.disputeConfirm` |
| OrderActions.tsx | A | C | `"Confirm"` | `Orders.actions.confirm` |
| OrderActions.tsx | A | C | `"Cancel"` | `Common.actions.cancel` |
| OrderActions.tsx | A | C | `"Handle dispute"` | `Orders.actions.handleDispute` |
| OrderActions.tsx | A | C | `"No actions are available for this order."` | `Orders.actions.noActions` |
| OrderRow.tsx | A | C | `"Marketplace"` / `"Embed"` inline channel labels | `Orders.channel.*` |
| OrdersSkeleton.tsx | A | S | `"loading orders"` sr-only | `Orders.skeleton.loading` |

---

## src/components/analytics/

> Status label maps appear in multiple files and should share `Orders.status.*`.
> Category G (formatted numbers/dates) is tracked separately in the i18n plan.

| File:line | Cat | C/S | Current string | Proposed key |
|-----------|-----|-----|----------------|--------------|
| AnalyticsPage.tsx:89 | A | S | `"Nothing to measure yet"` | `Analytics.empty.title` |
| AnalyticsPage.tsx:92 | A | S | `"Visits to your product pages show up here once one is live."` | `Analytics.empty.hint` |
| AnalyticsPage.tsx:94 | A | S | `"Back to setup"` | `Analytics.empty.backToSetup` |
| AnalyticsPage.tsx:122 | A | S | `title="Revenue"` (ChartCard) | `Analytics.sales.revenue.title` |
| AnalyticsPage.tsx:123 | A | S | `description="Paid revenue over time."` | `Analytics.sales.revenue.description` |
| AnalyticsPage.tsx:133 | A | S | `title="Average order value"` | `Analytics.sales.aov.title` |
| AnalyticsPage.tsx:134 | A | S | `description="How much a typical order is worth over time."` | `Analytics.sales.aov.description` |
| AnalyticsPage.tsx:143 | A | S | `title="Channels"` | `Analytics.sales.channels.title` |
| AnalyticsPage.tsx:144 | A | S | `description="Where your sales come from."` | `Analytics.sales.channels.description` |
| AnalyticsPage.tsx:155 | A | S | `title="Sales by weekday"` | `Analytics.sales.weekday.title` |
| AnalyticsPage.tsx:156 | A | S | `description="Your store's weekly rhythm."` | `Analytics.sales.weekday.description` |
| AnalyticsPage.tsx:165 | A | S | `title="Top products"` | `Analytics.sales.topProducts.title` |
| AnalyticsPage.tsx:166 | A | S | `description="Your best sellers by paid revenue."` | `Analytics.sales.topProducts.description` |
| AnalyticsPage.tsx:182 | A | S | `title="Order status"` | `Analytics.sales.orderStatus.title` |
| AnalyticsPage.tsx:183 | A | S | `description="The full order mix, refunds and disputes included."` | `Analytics.sales.orderStatus.description` |
| AnalyticsPage.tsx:187 | B | S | `emptyText="No orders in this range"` | `Analytics.sales.orderStatus.emptyText` |
| AnalyticsPage.tsx:237 | A | S | `` `${upcomingLabels} appear here once a product is on…` `` | `Analytics.upcoming.hintProduct` (param) |
| AnalyticsPage.tsx:238 | A | S | `` `${upcomingLabels} appear here once their block is…` `` | `Analytics.upcoming.hintBlock` (param) |
| RangeSelector.tsx | D | C | `PRESET_OPTIONS`: "Last 30 days", "All time", "Custom" | `Analytics.range.*` |
| RangeSelector.tsx | B | C | `ariaLabel="Date range"` | `Analytics.range.ariaLabel` |
| RangeSelector.tsx | B | C | `placeholder="Pick a range"` | `Analytics.range.placeholder` |
| AnalyticsSection.tsx:59 | B | S | `` `What ${title} measures` `` aria-label | `Analytics.section.measuresAriaLabel` (param: title) |
| AnalyticsTiles.tsx | A | S | MetricTile labels: "Revenue", "Sales", "Avg. order", "Unique buyers", "Refund rate" | `Analytics.tile.*` |
| AnalyticsTiles.tsx | A | S | `zeroText`: "No sales yet", "No buyers yet", "No orders yet" | `Analytics.tile.*.zero` |
| AnalyticsTiles.tsx | B | S | Hint templates with `{n}` and `{currency}` interpolation | `Analytics.tile.*.hint` (params) |
| ChartCard.tsx | B | S | `emptyText = "No sales in this range"` default | `Analytics.chart.emptyDefault` |
| ChartCard.tsx | A | S | `"Coming soon"` badge | `Common.badge.comingSoon` |
| ChartCard.tsx | B | S | `` `How to read ${title}` `` aria-label | `Analytics.chart.howToReadAriaLabel` (param: title) |
| SignalsUnavailableNotice.tsx | A | S | `"Views and signups are unavailable right now"` | `Analytics.signals.unavailableTitle` |
| SignalsUnavailableNotice.tsx | A | S | `"Your sales figures above are unaffected. Reload the page to try again."` | `Analytics.signals.unavailableHint` |
| SignalSection.tsx | D | S | `PANEL_TITLES`: "Over time", "Channels", "By weekday", "By storefront" | `Analytics.signal.panel.*` |
| SignalSection.tsx | A | S | `` `Total ${source.noun.many}` `` dynamic label | `Analytics.signal.totalLabel` (param) |
| SignalSection.tsx | A | S | `"Visitors"` label | `Analytics.signal.visitors` |
| SignalSection.tsx | A | S | `"Not counted yet"` zero state | `Analytics.signal.notCounted` |
| SignalSection.tsx | A | S | `"No value yet"` zero state | `Analytics.signal.noValue` |
| SignalSection.tsx | B | S | `` `${source.label} across the selected range.` `` | `Analytics.signal.descRange` (param) |
| SignalSection.tsx | A | S | `"Where they came from."` | `Analytics.signal.descChannels` |
| SignalSection.tsx | A | S | `"The weekly rhythm."` | `Analytics.signal.descWeekday` |
| SignalSection.tsx | A | S | `"Which storefront they came from."` | `Analytics.signal.descStorefront` |
| SignalSection.tsx | A | S | `` `Ready to chart as soon as ${source.noun.many} start arriving.` `` | `Analytics.signal.readyToChart` (param) |
| SignalSection.tsx | A | S | `` `${source.label} over time` `` | `Analytics.signal.overTimeLabel` (param) |
| StatusBreakdown.tsx | D | C | `STATUS_LABELS`: "Paid", "Refunded", "Disputed", "Pending" | `Orders.status.*` |
| StatusBreakdown.tsx | B | C | `ariaLabel="Order status mix"` | `Analytics.sales.orderStatus.mixAriaLabel` |
| AnalyticsSkeleton.tsx | A | S | `"loading analytics"` sr-only | `Analytics.skeleton.loading` |

---

## src/components/onboarding/

| File:line | Cat | C/S | Current string | Proposed key |
|-----------|-----|-----|----------------|--------------|
| WelcomeFlow.tsx | A | C | `"Welcome to Square Share"` (step 1 title) | `Onboarding.welcome.title` |
| WelcomeFlow.tsx | A | C | `"Four steps to a product page you can share."` | `Onboarding.welcome.subtitle` |
| WelcomeFlow.tsx | A | C | `"Add your seller details"` (step 2 title) | `Onboarding.welcome.sellerStep.title` |
| WelcomeFlow.tsx | A | C | `"Buyers see these on your product pages…"` | `Onboarding.welcome.sellerStep.body` |
| WelcomeFlow.tsx | A | C | `"Where everything lives"` (step title) | `Onboarding.welcome.navStep.title` |
| WelcomeFlow.tsx | A | C | `"Everything is in the sidebar. Here is what each part is for."` | `Onboarding.welcome.navStep.body` |
| WelcomeFlow.tsx | A | C | PATH icon/title/body for 4 nav items | `Onboarding.welcome.path.*` |
| WelcomeFlow.tsx | B | C | Form field help text blocks | `Onboarding.welcome.fieldHelp.*` |
| WelcomeFlow.tsx | A | C | `"Check {email} for a confirmation link."` (t.rich needed) | `Onboarding.welcome.checkEmail` (param: email) |
| WelcomeFlow.tsx | A | C | `"Your product pages go live once you open it."` | `Onboarding.welcome.pagesGoLive` |
| WelcomeFlow.tsx | A | C | `"Send a new link"` | `Onboarding.welcome.sendNewLink` |
| WelcomeFlow.tsx | A | C | `"Sending…"` | `Onboarding.welcome.sending` |
| WelcomeFlow.tsx | A | C | `"Sent"` | `Onboarding.welcome.sent` |
| WelcomeFlow.tsx | A | C | `"On your phone, open the menu at the top left."` | `Onboarding.welcome.tour.mobileMenu` |
| WelcomeFlow.tsx | A | C | `"Looking for something? Press {shortcut} to search everything."` | `Onboarding.welcome.tour.searchDesktop` (param: shortcut) |
| WelcomeFlow.tsx | A | C | `"Looking for something? Tap Search at the top."` | `Onboarding.welcome.tour.searchMobile` |
| WelcomeFlow.tsx | A | C | `"Skip intro"` | `Onboarding.welcome.nav.skipIntro` |
| WelcomeFlow.tsx | A | C | `"Get started"` | `Onboarding.welcome.nav.getStarted` |
| WelcomeFlow.tsx | A | C | `"Back"` | `Common.actions.back` |
| WelcomeFlow.tsx | A | C | `"Skip for now"` | `Onboarding.welcome.nav.skipForNow` |
| WelcomeFlow.tsx | A | C | `"Save and continue"` | `Onboarding.welcome.nav.saveAndContinue` |
| WelcomeFlow.tsx | A | C | `"Change details"` | `Onboarding.welcome.nav.changeDetails` |
| WelcomeFlow.tsx | A | C | `"Continue"` | `Onboarding.welcome.nav.continue` |
| WelcomeFlow.tsx | A | C | `"Explore on my own"` | `Onboarding.welcome.nav.exploreOwn` |
| WelcomeFlow.tsx | A | C | `"Not now"` | `Onboarding.welcome.nav.notNow` |
| WelcomeFlow.tsx | A | C | `"Done"` | `Common.actions.done` |
| WelcomeFlow.tsx | B | C | `"Step {n} of {total}"` progress label (ICU plural candidate for Czech) | `Onboarding.welcome.stepOf` (params: n, total) |
| SetupChecklist.tsx | A | C | `"You're set up"` module title (conditional) | `Onboarding.checklist.doneTitle` |
| SetupChecklist.tsx | A | C | `"Get set up"` module title (conditional) | `Onboarding.checklist.pendingTitle` |
| SetupChecklist.tsx | A | C | `"Your first product page is live. Share the link anywhere."` | `Onboarding.checklist.liveHint` |
| SetupChecklist.tsx | A | C | `"Open page"` | `Onboarding.checklist.openPage` |
| SetupChecklist.tsx | B | C | sr-only `" (opens in a new tab)"` | `Common.srOnly.opensInNewTab` |
| SetupChecklist.tsx | A | C | `"Hide"` | `Common.actions.hide` |
| SetupChecklist.tsx | A | C | `"Show me around"` | `Onboarding.checklist.showAround` |
| SetupChecklist.tsx | A | C | `"Show steps"` / `"Hide steps"` toggle | `Onboarding.checklist.showSteps` / `Onboarding.checklist.hideSteps` |
| SetupChecklist.tsx | B | C | sr-only `" (done)"` / `" (to do)"` | `Common.srOnly.done` / `Common.srOnly.toDo` |
| SetupChecklist.tsx | A | C | `"{n} of {total} done"` progress (ICU plural) | `Onboarding.checklist.progress` (params: n, total) |
| SetupChecklist.tsx | B | C | `"Setup progress"` ProgressBar label | `Onboarding.checklist.progressLabel` |

---

## src/components/dashboard/

> Most files are **server** components (no "use client"). Use `await getTranslations`.

| File:line | Cat | C/S | Current string | Proposed key |
|-----------|-----|-----|----------------|--------------|
| DashboardHome.tsx | A | S | `"Overview"` h1 | `Dashboard.overview.title` |
| DashboardHome.tsx | A | S | `"Add product"` button | `Dashboard.overview.addProduct` |
| DashboardHome.tsx | A | S | `"Revenue · 30 days"` MetricTile label | `Dashboard.overview.revenue30d` |
| DashboardHome.tsx | A | S | `"Sales · 30 days"` MetricTile label | `Dashboard.overview.sales30d` |
| DashboardHome.tsx | A | S | `"Avg order · 30 days"` MetricTile label | `Dashboard.overview.avgOrder30d` |
| NeedsAttention.tsx | B | S | `"Needs attention"` module title (prop) | `Dashboard.attention.title` |
| NeedsAttention.tsx | A | S | `"All clear. Nothing needs your attention right now."` | `Dashboard.attention.allClear` |
| RecentOrders.tsx:51 | B | S | `title="Recent orders"` (ModuleCard prop) | `Dashboard.recentOrders.title` |
| RecentOrders.tsx:54 | A | S | `"No orders yet. Sales through your own buy link or by email won't show here."` | `Dashboard.recentOrders.empty` |
| RecentOrders.tsx | D | S | `STATUS_LABELS`: "Paid", "Refunded", "Disputed", "Pending" | `Orders.status.*` |
| RecentOrders.tsx | D | S | `CHANNEL_LABELS`: "Embed", "Marketplace" | `Orders.channel.*` |
| MetricTile.tsx | B | S | `zeroText = "No sales yet"` default | `Dashboard.metric.zeroDefault` |
| MetricTile.tsx | B | S | `pendingText = "Available once analytics is connected."` default | `Dashboard.metric.pendingDefault` |
| MetricTile.tsx | A | S | `"Coming soon"` badge | `Common.badge.comingSoon` |
| Sidebar.tsx | B | C | `aria-label={isOpen ? "Close menu" : "Open menu"}` | `Dashboard.sidebar.closeMenu` / `Dashboard.sidebar.openMenu` |
| Sidebar.tsx | B | C | `aria-label="Dashboard"` on nav | `Dashboard.sidebar.navLabel` |
| Sidebar.tsx | A | C | `"Dashboard"` text in brand row | `Dashboard.sidebar.title` |

**Coupling note:** `NeedsAttention.tsx` renders `item.label`, `item.description`,
`item.actionLabel` from `src/lib/dashboard/attention.ts`. Those strings are
Phase 5 / lib agent territory. The render site will need updating in the same pass.

---

## src/components/notifications/

| File:line | Cat | C/S | Current string | Proposed key |
|-----------|-----|-----|----------------|--------------|
| NotificationBell.tsx | B | C | `` `Notifications, ${unreadCount} unread` `` aria-label | `Notifications.bell.unreadAriaLabel` (ICU plural) |
| NotificationBell.tsx | B | C | `"Notifications"` aria-label (zero state) | `Notifications.bell.ariaLabel` |
| NotificationBell.tsx | B | C | `label="Notifications"` on Popover | `Notifications.bell.popoverLabel` |
| NotificationItem.tsx:68 | B | C | `aria-label="Unread"` dot | `Notifications.item.unreadAriaLabel` |
| NotificationsPageClient.tsx | A | C | `"Notifications"` h1 | `Notifications.page.title` |
| NotificationsPageClient.tsx | A | C | `"Mark all read"` | `Notifications.page.markAllRead` |
| NotificationsPageClient.tsx | A | C | `"No notifications yet"` | `Notifications.page.empty` |
| NotificationsPageClient.tsx | A | C | `"Team, order, and payment activity will show up here."` | `Notifications.page.emptyHint` |
| NotificationsPageClient.tsx | A | C | `"Couldn't load more notifications. Check your connection and try again."` | `Notifications.page.loadError` |
| NotificationsPageClient.tsx | A | C | `"Loading"` sr-only | `Notifications.page.loading` |
| NotificationsPageClient.tsx | A | C | `"Try again"` | `Notifications.page.tryAgain` |
| NotificationsPageClient.tsx | A | C | `"Load more"` | `Notifications.page.loadMore` |
| NotificationList.tsx | A | C | `"Notifications"` heading | `Notifications.list.title` |
| NotificationList.tsx | A | C | `"{unreadCount} unread"` (ICU plural) | `Notifications.list.unreadCount` |
| NotificationList.tsx | A | C | `"Mark all read"` | `Notifications.list.markAllRead` |
| NotificationList.tsx | A | C | `"Live updates paused. Refresh to see the latest."` | `Notifications.list.updatesPaused` |
| NotificationList.tsx | A | C | `"You're all caught up. Nothing here yet."` | `Notifications.list.empty` |
| NotificationList.tsx | A | C | `"View all"` | `Notifications.list.viewAll` |

---

## src/components/layout/

| File:line | Cat | C/S | Current string | Proposed key |
|-----------|-----|-----|----------------|--------------|
| ProfileMenu.tsx | B | C | `aria-label="Account menu"` trigger | `Layout.profileMenu.ariaLabel` |
| ProfileMenu.tsx | B | C | `label="Account menu"` Popover | `Layout.profileMenu.popoverLabel` |
| ProfileMenu.tsx | A | C | `"Account"` link | `Layout.profileMenu.account` |
| ProfileMenu.tsx | A | C | `"Switch accounts"` | `Layout.profileMenu.switchAccounts` |
| ProfileMenu.tsx | A | C | `a.isSelf ? "Your store" : a.storeName` | `Layout.profileMenu.yourStore` |
| ProfileMenu.tsx | A | C | `a.isSelf ? "Owner" : ROLE_LABELS[a.role]` | `Layout.profileMenu.owner` / roles from `lib/team/permissions` |
| ProfileMenu.tsx | A | C | `"Log out"` | `Layout.profileMenu.logOut` |
| ViewingBanner.tsx | A | C | `"Viewing {storeName} as {role}"` | `Layout.viewingBanner.viewing` (params: storeName, role) |
| ViewingBanner.tsx | A | C | `"· read-only"` | `Layout.viewingBanner.readOnly` |
| ViewingBanner.tsx | A | C | `"Back to your store"` | `Layout.viewingBanner.backToYours` |

---

## src/components/search/

| File:line | Cat | C/S | Current string | Proposed key |
|-----------|-----|-----|----------------|--------------|
| SearchTrigger.tsx:61 | A | C | `"Search"` visible label | `Search.trigger.label` |
| SearchMobileTrigger.tsx:26 | B | C | `aria-label="Search"` | `Search.trigger.ariaLabel` |
| SearchOverlay.tsx | A | C | `"Searching…"` status | `Search.overlay.searching` |
| SearchOverlay.tsx | B | C | `aria-label="Search"` on input | `Search.overlay.inputAriaLabel` |
| SearchOverlay.tsx | B | C | `placeholder="Search products, orders, settings…"` | `Search.overlay.placeholder` |
| SearchOverlay.tsx | B | C | `"Clear search"` / `"Close search"` clear button | `Search.overlay.clearSearch` / `Search.overlay.closeSearch` |
| SearchOverlay.tsx | B | C | `aria-label="Search results"` listbox | `Search.overlay.resultsAriaLabel` |
| SearchOverlay.tsx | A | C | `` `No results for ${trimmed}` `` | `Search.overlay.noResults` (param: query) |
| SearchOverlay.tsx | A | C | `` `${count} result${s} for ${trimmed}` `` (ICU plural) | `Search.overlay.resultCount` (params: count, query) |
| SearchOverlay.tsx | A | C | `` `Nothing matches "${trimmed}".` `` | `Search.overlay.noMatches` (param: query) |
| SearchOverlay.tsx | A | C | `"Start typing to search."` | `Search.overlay.startTyping` |
| SearchOverlay.tsx | A | C | REMOTE_NOTICE: "Can't reach the server — showing pages, settings and actions only." | `Search.overlay.remoteDown` |
| SearchOverlay.tsx | A | C | REMOTE_NOTICE: "Your session expired, so only pages and settings are shown." | `Search.overlay.sessionExpired` |
| SearchOverlay.tsx | A | C | REMOTE_NOTICE: "Searching too fast — showing pages, settings and actions only." | `Search.overlay.rateLimited` |
| SearchOverlay.tsx | A | C | Snapshot fallback: "Live search unreachable — showing cached matches, pages and settings." | `Search.overlay.snapshotFallback` |

---

## src/components/error/

> `ErrorScreen` is a pure shell that accepts all strings as props. No hardcoded
> copy lives inside it. Strings reside in the two callers below.

| File:line | Cat | C/S | Current string | Proposed key |
|-----------|-----|-----|----------------|--------------|
| not-found.tsx:19 | A | S | `readout="err_not_found"` | `Error.notFound.readout` |
| not-found.tsx:20 | A | S | `title="Page not found"` | `Error.notFound.title` |
| not-found.tsx:21 | A | S | `description="This page doesn't exist…"` | `Error.notFound.description` |
| not-found.tsx:31 | A | S | `"Back to dashboard"` CTA | `Error.notFound.cta` |
| error.tsx:38 | A | C | `readout="err_internal"` | `Error.boundary.readout` |
| error.tsx:39 | A | C | `title="Something went wrong"` | `Error.boundary.title` |
| error.tsx:40 | A | C | `description="We couldn't load this page…"` | `Error.boundary.description` |
| error.tsx:46 | A | C | `"Try again"` button | `Error.boundary.cta` |
| error.tsx:51 | A | C | `"Reference: {digest}"` note | `Error.boundary.reference` (param: digest) |

> `BrandFooter.tsx` links use labels (`"Instagram"`, `"GitHub"`, `"Contact"`)
> plus legal link labels that come from `lib/legal/links.ts` (another agent's
> area). No inventory here; the social `aria-label` values are brand names and
> are excluded per the DO-NOT-WRAP list (brand marks).

---

## src/components/charts/

> No user-facing copy strings. All chart primitives are locale-agnostic: labels
> come from the parent's `series[].label` prop or from the data itself.
> `ChartTooltip.tsx` shows `"—"` (an em dash) as a no-value sentinel: a
> symbol, not translatable copy.
>
> **Category G** applies to every chart that receives a `valueFormatter` or
> `axisValueFormatter` using `moneyExact`/`moneyCompact` from
> `analytics/chart-format.ts` or `formatNumber` from `charts/format.ts`.
> These functions use hard-coded comma separators and currency symbols.
> They must be threaded with a locale/formatter from `next-intl` in Phase 3.
> No `t()` keys needed; this is a formatter wiring task, not a string extraction.

---

## Route metadata (Cat C)

| File | Cat | C/S | Current value | Proposed key |
|------|-----|-----|---------------|--------------|
| app/(dashboard)/dashboard/page.tsx | C | S | `title: "Overview"` | `Meta.dashboard.title` |
| app/(dashboard)/orders/page.tsx | C | S | `title: "Orders"` | `Meta.orders.title` |
| app/(dashboard)/orders/page.tsx (PageHeader) | A | S | `title="Orders"`, `subtitle="Every order placed through Square Share."` | `Meta.orders.pageTitle` / `Meta.orders.pageSubtitle` |
| app/(dashboard)/analytics/page.tsx | C | S | `title: "Analytics"` | `Meta.analytics.title` |
| app/(dashboard)/analytics/page.tsx (PageHeader) | A | S | `title="Analytics"`, `subtitle="Sales, storefront views and everything else your store is doing."` | `Meta.analytics.pageTitle` / `Meta.analytics.pageSubtitle` |
| app/(dashboard)/products/page.tsx | C | S | `title: "Products"` | `Meta.products.title` |
| app/(dashboard)/notifications/page.tsx | C | S | `title: "Notifications"` | `Meta.notifications.title` |
| app/(dashboard)/payments/page.tsx | C | S | `title: "Payments"` | `Meta.payments.title` |
| app/(auth)/login/page.tsx | C | S | `title: "Sign in"`, `description: "Sign in to your Square Share creator dashboard."` | `Meta.login.title` / `Meta.login.description` |
| app/(auth)/reset-password/page.tsx | C | S | `title: "Set a new password"` | `Meta.resetPassword.title` |
