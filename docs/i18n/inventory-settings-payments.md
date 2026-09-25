# i18n Inventory: Settings + Payments

Area: `src/components/settings/`, `src/components/payments/`,
`src/app/settings/` (page/layout metadata).

---

## Summary

| Metric | Count |
|--------|-------|
| Total findings | 197 |
| Cat A (JSX text nodes) | 94 |
| Cat B (string props) | 64 |
| Cat C (route metadata) | 8 |
| Cat D (copy constants in component files) | 17 |
| Cat F (toasts / imperative errors) | 12 |
| Cat G (locale-sensitive formatting) | 2 (component-level; see also §G) |

**Settings "use client" files (need `useTranslations`):** AvatarUpload, UsernameForm,
EmailChangeForm, PasswordCard, PasswordModal, SignOutSection, ProfilePicCropModal,
NotificationsSection, DeleteAccountForm, LegalSection, TaxSection, ShippingSection,
team/TeamSection, team/MemberRow, team/InviteModal, team/InviteAcceptRow,
team/InvitePromptModal, team/PendingInvites: **18 files**

**Settings server components (need `await getTranslations`):** DangerZone, AccountSection
(no own strings: passes all copy to children), SettingsCard (no own strings: renders
title/description props), SellerDetailsNotice, team/MemberList: **5 files** (2 have no own
strings worth noting)

**Payments "use client" files:** PaymentsPage, ConnectStripeModal, ConnectionStatusCard,
PayoutHistory, PayoutMethodCard, PayoutMethodModal, RecentActivity, TransactionDetailModal,
PayoutDetailModal: **9 files**

**Payments server components:** BalanceSummary, PayoutStatusBadge, DetailRow (no own
strings), CardSwipe (aria-hidden, no copy): **4 files**

**App/settings route files:** all 8 metadata pages are server. All `export const metadata`
titles must become `export async function generateMetadata()` to call `await getTranslations`.

---

## ⚠ CRITICAL: Behaviour-changing string

`DELETE_CONFIRM_PHRASE = "delete my account"` (src/lib/settings/constants.ts:17) is a
**typed-confirmation phrase**: the user must type it exactly to enable the delete button.
`DeleteAccountForm.tsx:113` compares `phrase.trim().toLowerCase() !== DELETE_CONFIRM_PHRASE`.

**Translating this string changes program behaviour, not just display.** If the phrase is
localised the comparison must compare against the localised value, meaning `DELETE_CONFIRM_PHRASE`
itself must be translated and the validation must use the translated value. This is the
only string in this area where translation directly gates an action. Flag for a dedicated
design decision before extraction: options include keeping the phrase in English regardless
of UI locale, or translating it with a paired locale-aware comparison.

---

## Note: copy handed in from `src/lib`

Several settings components render copy they did not author; those strings belong to the
lib agent's inventory, but the render sites below are where the translation call must
eventually land:

- **SellerDetailsNotice.tsx** renders `TRADER_IDENTITY_HEADLINE`, `traderIdentityFix(missing)`,
  and `field.label` / `field.why` from `lib/settings/trader-identity.ts`. The two
  inventories must be applied together: the lib agent changes the function to return a key,
  and this file resolves it.
- **MemberRow.tsx** renders `ROLE_LABELS[role]` and `ROLE_DESCRIPTIONS[role]` from
  `lib/team/permissions.ts`. Same coordination required.
- **InviteAcceptRow.tsx:49** renders `ROLE_LABELS[invite.role]` from the same file.
- **TaxSection.tsx** and **ShippingSection.tsx** render `EU_COUNTRIES[*].name` from
  `lib/settings/constants.ts`. Country names in a Select are user-visible labels;
  the lib agent owns those strings, but both components render them.
- **SettingsShell.tsx:65** derives `sectionLabel` from `SETTINGS_NAV` (lib/search/nav-constants).
  The nav labels are owned by the lib agent.
- **ShippingSection.tsx:189** calls `buildShippingProse(draft)` from `lib/shipping/policy-prose`
  and renders its output directly on lines 438–449. The prose generator must return keys,
  not sentences, before this component can be translated.

---

## Files needing `t.rich` (embedded elements inside translatable text)

| File | Lines | Reason |
|------|-------|--------|
| `DeleteAccountForm.tsx` | 88–92 | Label contains `<span className="font-mono">` wrapping the confirm phrase |
| `LegalSection.tsx` | 90–95, 101–107, 113–115 | Accepted-version lines embed `<span className="font-mono text-xs">{acceptedVersion}</span>` |
| `TaxSection.tsx` | 235–249 | Info paragraph contains a `<a>` link (privacy policy) mid-sentence |
| `PasswordModal.tsx` | 70–72 | Description string interpolates `${email}`: use ICU placeholder, not template literal |

---

## Cat G: Locale-sensitive formatting (component-level)

These call sites hardcode a locale or pass none; they need the active locale threaded in.

| File:line | Call | Issue |
|-----------|------|-------|
| `DeleteAccountForm.tsx:22` | `new Date(iso).toLocaleDateString("en-GB", {…})` | Hardcoded `"en-GB"` |
| `LegalSection.tsx:37–41` | `new Date(iso).toLocaleDateString("en-GB", {…})` | Hardcoded `"en-GB"` |
| `InviteAcceptRow.tsx:53` | `new Date(invite.invited_at).toLocaleDateString()` | No locale argument |

`formatCents`, `formatOrderDate`, `formatOrderDateTime` (called from `BalanceSummary`,
`PayoutHistory`, `RecentActivity`, `TransactionDetailModal`, `PayoutDetailModal`) are defined
in `src/lib/format/`: their locale threading is the lib agent's concern, but every
component that calls them will need to pass the locale once the lib functions accept it.

---

## Findings table

### src/app/settings: metadata (Cat C, Server)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `settings/layout.tsx:11` | C | Server | `"%s \| Square Share"` (template) | `Settings.meta.titleTemplate` |
| `settings/layout.tsx:12` | C | Server | `"Settings \| Square Share"` (default) | `Settings.meta.default` |
| `settings/account/page.tsx:7` | C | Server | `"Account settings"` | `Settings.account.meta.title` |
| `settings/notifications/page.tsx:6` | C | Server | `"Notification settings"` | `Settings.notifications.meta.title` |
| `settings/danger/page.tsx:6` | C | Server | `"Danger zone"` | `Settings.danger.meta.title` |
| `settings/legal/page.tsx:6` | C | Server | `"Legal settings"` | `Settings.legal.meta.title` |
| `settings/team/page.tsx:12` | C | Server | `"Team & access"` | `Settings.team.meta.title` |
| `settings/tax/page.tsx:8` | C | Server | `"Business & seller details"` | `Settings.tax.meta.title` |
| `settings/shipping/page.tsx:8` | C | Server | `"Shipping & returns settings"` | `Settings.shipping.meta.title` |

---

### src/app/settings/loading.tsx (Server)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `settings/loading.tsx:9` | A | Server | `"Loading settings…"` | `Settings.loading` |

---

### src/components/settings/SettingsShell.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `SettingsShell.tsx:129` | A | Client | `"Settings"` (sidebar label) | `Settings.nav.heading` |
| `SettingsShell.tsx:142` | B | Client | `aria-label="Settings sections"` | `Settings.nav.ariaLabel` |
| `SettingsShell.tsx:178` | A | Client | `"Settings"` (eyebrow in content column) | `Settings.nav.heading` (same key) |

---

### src/components/settings/AvatarUpload.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `AvatarUpload.tsx:78` | F | Client | `"That image is too large. Keep it under 2 MB."` | `Settings.account.avatar.errorTooLarge` |
| `AvatarUpload.tsx:82` | F | Client | `"Use a JPEG, PNG, or WebP image."` | `Settings.account.avatar.errorBadType` |
| `AvatarUpload.tsx:92` | F | Client | `"Could not read that file."` | `Settings.account.avatar.errorReadFailed` |
| `AvatarUpload.tsx:121` | B | Client | `title="Profile photo"` (SettingsCard) | `Settings.account.avatar.cardTitle` |
| `AvatarUpload.tsx:122` | B | Client | `description="A JPEG, PNG, or WebP up to 2 MB. Shown across your dashboard."` | `Settings.account.avatar.cardDescription` |
| `AvatarUpload.tsx:139` | B | Client | `aria-label="Edit your profile photo"` (conditional) | `Settings.account.avatar.editAriaLabel` |
| `AvatarUpload.tsx:139` | B | Client | `aria-label="Upload a profile photo"` (conditional) | `Settings.account.avatar.uploadAriaLabel` |
| `AvatarUpload.tsx:169` | A | Client | `"Uploading your profile photo"` (sr-only status) | `Settings.account.avatar.statusUploading` |
| `AvatarUpload.tsx:171` | A | Client | `"Removing your profile photo"` (sr-only status) | `Settings.account.avatar.statusRemoving` |
| `AvatarUpload.tsx:180` | B | Client | `aria-label="Choose profile photo"` | `Settings.account.avatar.chooseAriaLabel` |
| `AvatarUpload.tsx:201` | A | Client | `"Change photo"` (conditional) | `Settings.account.avatar.changePhoto` |
| `AvatarUpload.tsx:201` | A | Client | `"Upload photo"` (conditional) | `Settings.account.avatar.uploadPhoto` |
| `AvatarUpload.tsx:212` | A | Client | `"Remove"` | `Common.actions.remove` |

---

### src/components/settings/ProfilePicCropModal.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `ProfilePicCropModal.tsx:117` | F | Client | `"That image could not be loaded. Try choosing it again."` | `Settings.account.cropModal.errorLoad` |
| `ProfilePicCropModal.tsx:213` | F | Client | `"Your browser could not process that image."` | `Settings.account.cropModal.errorProcess` |
| `ProfilePicCropModal.tsx:249` | F | Client | `"Could not prepare that image. Try a different one."` | `Settings.account.cropModal.errorPrepare` |
| `ProfilePicCropModal.tsx:265` | F | Client | `"That image could not be exported. Upload it again instead."` | `Settings.account.cropModal.errorExport` |
| `ProfilePicCropModal.tsx:274` | B | Client | `title="Crop your photo"` | `Settings.account.cropModal.title` |
| `ProfilePicCropModal.tsx:275` | B | Client | `description="Drag to reposition. Scroll or use the slider to zoom."` | `Settings.account.cropModal.description` |
| `ProfilePicCropModal.tsx:281` | B | Client | `aria-label="Crop area. Drag or use the arrow keys to reposition."` | `Settings.account.cropModal.cropAreaAriaLabel` |
| `ProfilePicCropModal.tsx:347` | B | Client | `aria-label="Zoom"` | `Settings.account.cropModal.zoomAriaLabel` |
| `ProfilePicCropModal.tsx:366` | A | Client | `"Choose another"` | `Settings.account.cropModal.chooseAnother` |
| `ProfilePicCropModal.tsx:378` | A | Client | `"Saving…"` (pending) | `Common.actions.saving` |
| `ProfilePicCropModal.tsx:378` | A | Client | `"Save photo"` | `Settings.account.cropModal.savePhoto` |

---

### src/components/settings/UsernameForm.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `UsernameForm.tsx:119` | B | Client | `title="Username"` | `Settings.account.username.cardTitle` |
| `UsernameForm.tsx:120` | B | Client | `description="Sign in with this instead of your email…"` | `Settings.account.username.cardDescription` |
| `UsernameForm.tsx:125` | A | Client | `"Username"` (Label) | `Settings.account.username.label` |
| `UsernameForm.tsx:134` | B | Client | `placeholder="yourhandle"` | `Settings.account.username.placeholder` |
| `UsernameForm.tsx:193` | A | Client | `"Available."` | `Settings.account.username.available` |
| `UsernameForm.tsx:195` | A | Client | `"Someone already has this username, try another."` | `Settings.account.username.taken` |
| `UsernameForm.tsx:197` | A | Client | `"Checking…"` | `Settings.account.username.checking` |

*Note: `validationHint` (line 64) is sourced from `usernameSchema.safeParse` error messages in
`lib/validation/auth.ts`. The lib agent owns those Zod messages (Cat E).*

---

### src/components/settings/EmailChangeForm.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `EmailChangeForm.tsx:51` | B | Client | `title="Email"` | `Settings.account.email.cardTitle` |
| `EmailChangeForm.tsx:52` | B | Client | `description="Changing it sends a confirmation link first…"` | `Settings.account.email.cardDescription` |
| `EmailChangeForm.tsx:56` | A | Client | `"Currently signed in as"` (help text) | `Settings.account.email.currentlySignedInAs` |
| `EmailChangeForm.tsx:60` | A | Client | `"New email"` (Label) | `Settings.account.email.newEmailLabel` |
| `EmailChangeForm.tsx:67` | B | Client | `placeholder="you@studio.com"` | `Settings.account.email.newEmailPlaceholder` |
| `EmailChangeForm.tsx:76` | A | Client | `"Current password"` (Label) | `Settings.account.email.currentPasswordLabel` |
| `EmailChangeForm.tsx:77` | B | Client | `label="Why your password is needed here"` (InfoTip) | `Settings.account.email.passwordInfoTipLabel` |
| `EmailChangeForm.tsx:78` | A | Client | `"Whoever controls your email address can reset your password…"` (InfoTip body) | `Settings.account.email.passwordInfoTipBody` |
| `EmailChangeForm.tsx:97` | B | Client | `pendingLabel="Sending…"` | `Common.actions.sending` |
| `EmailChangeForm.tsx:98` | B | Client | `savedLabel="Sent"` | `Common.actions.sent` |
| `EmailChangeForm.tsx:99` | B | Client | `failedLabel="Send confirmation link"` | `Settings.account.email.sendConfirmationLink` |
| `EmailChangeForm.tsx:103` | A | Client | `"Send confirmation link"` (button text) | `Settings.account.email.sendConfirmationLink` |

---

### src/components/settings/PasswordCard.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `PasswordCard.tsx:30` | B | Client | `title="Password"` | `Settings.account.password.cardTitle` |
| `PasswordCard.tsx:33` | B | Client | `"For your security, your password is never shown here. To change it, we email you a link to set a new one."` | `Settings.account.password.descriptionReset` |
| `PasswordCard.tsx:34` | B | Client | `"You sign in with Google. Add a password to sign in with your email or username too."` | `Settings.account.password.descriptionSet` |
| `PasswordCard.tsx:38` | A | Client | `"Reset password"` (conditional) | `Settings.account.password.resetButton` |
| `PasswordCard.tsx:38` | A | Client | `"Set a password"` (conditional) | `Settings.account.password.setButton` |

---

### src/components/settings/PasswordModal.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `PasswordModal.tsx:55` | B | Client | `"Reset your password"` (title, conditional) | `Settings.account.password.modalTitleReset` |
| `PasswordModal.tsx:55` | B | Client | `"Set a password"` (title, conditional) | `Settings.account.password.modalTitleSet` |
| `PasswordModal.tsx:56` | B | Client | `"We'll email a link to {email}. It expires shortly after it arrives."` | `Settings.account.password.descriptionLink` |
| `PasswordModal.tsx:132` | A | Client | `"Sending…"` (pending) | `Common.actions.sending` |
| `PasswordModal.tsx:134` | A | Client | `"Resend in {cooldown}s"` | `Settings.account.password.resendIn` |
| `PasswordModal.tsx:136` | A | Client | `"Resend email"` | `Settings.account.password.resendEmail` |
| `PasswordModal.tsx:137` | A | Client | `"Email me a link"` | `Settings.account.password.emailMeALink` |
| `PasswordModal.tsx:143` | A | Client | `"Your current password is never shown. Open the link to choose a new one; setting it signs out your other devices."` | `Settings.account.password.neverShownNote` |
| `PasswordModal.tsx:148` | A | Client | `"This account signs in with Google. Setting a password lets you sign in with your email or username as well, and does not remove Google."` | `Settings.account.password.googleAccountNote` |
| `PasswordModal.tsx:155` | A | Client | `"Cancel"` | `Common.actions.cancel` |

---

### src/components/settings/SignOutSection.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `SignOutSection.tsx:59` | B | Client | `title="Sign out"` | `Settings.account.signOut.cardTitle` |
| `SignOutSection.tsx:60` | B | Client | `description="End this session on this device, or sign out everywhere…"` | `Settings.account.signOut.cardDescription` |
| `SignOutSection.tsx:67` | B | Client | `pendingLabel="Signing out…"` | `Settings.account.signOut.signingOut` |
| `SignOutSection.tsx:71` | A | Client | `"Sign out"` | `Settings.account.signOut.button` |
| `SignOutSection.tsx:75` | B | Client | `pendingLabel="Signing out…"` (second form) | `Settings.account.signOut.signingOut` |
| `SignOutSection.tsx:76` | A | Client | `"Sign out everywhere"` | `Settings.account.signOut.buttonEverywhere` |
| `SignOutSection.tsx:81` | A | Client | `"Signing out everywhere ends your session on every device and browser you're signed in on. You'll need to sign in again each place."` | `Settings.account.signOut.everywhereNote` |

---

### src/components/settings/DangerZone.tsx (Server)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `DangerZone.tsx:22` | B | Server | `title="Export my data"` | `Settings.danger.export.cardTitle` |
| `DangerZone.tsx:23` | B | Server | `description="Everything we hold about you: profile, products, storefront config, all bundled into one JSON file. It's your data, yours to keep."` | `Settings.danger.export.cardDescription` |
| `DangerZone.tsx:29` | A | Server | `"Download my data"` | `Settings.danger.export.downloadButton` |

---

### src/components/settings/DeleteAccountForm.tsx (Client)

⚠ See CRITICAL note above regarding `DELETE_CONFIRM_PHRASE`.

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `DeleteAccountForm.tsx:53` | B | Client | `title="Deletion requested"` | `Settings.danger.deleteAccount.titleRequested` |
| `DeleteAccountForm.tsx:54` | B | Client | `"You asked us to delete this account on {date}. It's flagged for permanent deletion…"` | `Settings.danger.deleteAccount.descriptionRequested` |
| `DeleteAccountForm.tsx:65` | B | Client | `pendingLabel="Cancelling…"` | `Common.actions.cancelling` |
| `DeleteAccountForm.tsx:67` | A | Client | `"Keep my account"` | `Settings.danger.deleteAccount.keepButton` |
| `DeleteAccountForm.tsx:76` | B | Client | `title="Delete account"` | `Settings.danger.deleteAccount.title` |
| `DeleteAccountForm.tsx:77` | B | Client | `description="This flags your account, products and storefront for permanent deletion. No soft-pedaling: once it runs, it's gone."` | `Settings.danger.deleteAccount.description` |
| `DeleteAccountForm.tsx:81` | A | Client | `"Delete my account"` | `Settings.danger.deleteAccount.deleteButton` |
| `DeleteAccountForm.tsx:88` | A | Client | `"Type {phrase} to confirm"` (Label: contains `<span>`) | `Settings.danger.deleteAccount.confirmLabel` *(t.rich)* |
| `DeleteAccountForm.tsx:109` | B | Client | `pendingLabel="Flagging…"` | `Settings.danger.deleteAccount.flagging` |
| `DeleteAccountForm.tsx:115` | A | Client | `"Permanently delete"` | `Settings.danger.deleteAccount.permanentlyDelete` |
| `DeleteAccountForm.tsx:122` | A | Client | `"Never mind"` | `Common.actions.neverMind` |

---

### src/components/settings/NotificationsSection.tsx (Client)

The `PREFS` array (lines 16–32) is a component-local copy constant; it falls under Cat D.

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `NotificationsSection.tsx:18` | D | Client | `label: "Sales"` | `Settings.notifications.prefs.sales.label` |
| `NotificationsSection.tsx:19` | D | Client | `blurb: "Email me every time something sells. The good kind of inbox noise."` | `Settings.notifications.prefs.sales.blurb` |
| `NotificationsSection.tsx:22` | D | Client | `label: "Product updates"` | `Settings.notifications.prefs.productUpdates.label` |
| `NotificationsSection.tsx:23` | D | Client | `blurb: "New dashboard features and improvements, as soon as they're ready to ship."` | `Settings.notifications.prefs.productUpdates.blurb` |
| `NotificationsSection.tsx:26` | D | Client | `label: "Tips & marketplace news"` | `Settings.notifications.prefs.marketing.label` |
| `NotificationsSection.tsx:27` | D | Client | `blurb: "Occasional ideas to help you sell more. We keep it light, no spam."` | `Settings.notifications.prefs.marketing.blurb` |
| `NotificationsSection.tsx:49` | B | Client | `title="Email notifications"` | `Settings.notifications.cardTitle` |
| `NotificationsSection.tsx:50` | B | Client | `description="Pick what lands in your inbox. Security and payment emails sneak through regardless, we can't let those go quiet."` | `Settings.notifications.cardDescription` |

*Note: once PREFS becomes a function returning keyed data, the array must be rebuilt at render
time via `useTranslations` rather than as a module-level constant.*

---

### src/components/settings/LegalSection.tsx (Client)

The `DOCS` array (lines 16–33) is a component-local copy constant (Cat D). The doc bodies are
placeholder draft legal copy pending legal review; translation will be deferred until real copy
lands, but the keys should be reserved now.

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `LegalSection.tsx:17` | D | Client | `title: "Seller Agreement"` | `Settings.legal.docs.sellerAgreement.title` |
| `LegalSection.tsx:18` | D | Client | `body: "You own your work, always…"` | `Settings.legal.docs.sellerAgreement.body` |
| `LegalSection.tsx:21` | D | Client | `title: "Terms of Service"` | `Settings.legal.docs.terms.title` |
| `LegalSection.tsx:22` | D | Client | `body: "Don't abuse the platform…"` | `Settings.legal.docs.terms.body` |
| `LegalSection.tsx:25` | D | Client | `title: "Privacy Policy"` | `Settings.legal.docs.privacy.title` |
| `LegalSection.tsx:26` | D | Client | `body: "We store what you give us…"` | `Settings.legal.docs.privacy.body` |
| `LegalSection.tsx:29` | D | Client | `title: "Your seller details, and where they go"` | `Settings.legal.docs.sellerDetails.title` |
| `LegalSection.tsx:30` | D | Client | `body: "Your trader name, address and contact email are shown to buyers…"` | `Settings.legal.docs.sellerDetails.body` |
| `LegalSection.tsx:58` | B | Client | `title="Seller Agreement, Terms & Privacy"` | `Settings.legal.cardTitle` |
| `LegalSection.tsx:59` | B | Client | `description="The current drafts, in plain language…"` | `Settings.legal.cardDescription` |
| `LegalSection.tsx:90` | A | Client | `"You accepted version {version} on {date}. Nothing more to do here."` *(t.rich)* | `Settings.legal.accepted` |
| `LegalSection.tsx:101` | A | Client | `"You accepted version {version} on {date}, but the docs have changed since. Give them another read and accept the current version."` *(t.rich)* | `Settings.legal.outdated` |
| `LegalSection.tsx:110` | B | Client | `pendingLabel="Recording…"` | `Settings.legal.recording` |
| `LegalSection.tsx:111` | A | Client | `"I accept"` | `Settings.legal.acceptButton` |
| `LegalSection.tsx:113` | A | Client | `"Accepting records the date and version {version} to your account."` *(t.rich)* | `Settings.legal.acceptNote` |

---

### src/components/settings/TaxSection.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `TaxSection.tsx:38` | F | Client | `"Contact email confirmed. You can publish now."` | `Settings.tax.verify.confirmed` |
| `TaxSection.tsx:41` | F | Client | `"That confirmation link has expired. Send yourself a new one below."` | `Settings.tax.verify.expired` |
| `TaxSection.tsx:44` | F | Client | `"That link was for a different address than the one saved here. Send a new one below."` | `Settings.tax.verify.stale` |
| `TaxSection.tsx:47` | F | Client | `"That confirmation link is not valid, or has already been used."` | `Settings.tax.verify.invalid` |
| `TaxSection.tsx:50` | F | Client | `"Too many confirmation attempts. Wait a while, then open the link again."` | `Settings.tax.verify.throttled` |
| `TaxSection.tsx:73` | A | Client | `"Not in the EU / prefer not to say"` (Select option label) | `Settings.tax.countryNotEu` |
| `TaxSection.tsx:115` | A | Client | `"This VAT ID looks like it was issued by {countryName}. You may want to set your country."` | `Settings.tax.vatAdvisory.noCountry` |
| `TaxSection.tsx:122` | A | Client | `"This VAT ID looks like it was issued by {countryName}, but your country is set to {selectedName}. Check both are correct."` | `Settings.tax.vatAdvisory.mismatch` |
| `TaxSection.tsx:215` | B | Client | `title="Business & seller details"` | `Settings.tax.cardTitle` |
| `TaxSection.tsx:216` | B | Client | `description="Set once for your whole account. Shown to buyers on every product page…"` | `Settings.tax.cardDescription` |
| `TaxSection.tsx:228` | A | Client | `"Your trader name, address and contact email are required before you can publish or sell anything."` | `Settings.tax.gate.required` |
| `TaxSection.tsx:231` | A | Client | `"Buyers have to be able to see who they are buying from and how to reach you before they order."` | `Settings.tax.gate.buyerReason` |
| `TaxSection.tsx:235` | A | Client | `"These details appear publicly on your product pages for that reason alone. We never use them for marketing, and never sell or share them. The one email we send to your contact address is the link that confirms it. See the {privacyLink}."` *(t.rich: contains `<a>`)* | `Settings.tax.gate.privacyNote` |
| `TaxSection.tsx:261` | A | Client | `"Trader name"` (Label) | `Settings.tax.fields.tradeName.label` |
| `TaxSection.tsx:265` | B | Client | `label="What to put here"` (InfoTip) | `Settings.tax.fields.tradeName.infoTipLabel` |
| `TaxSection.tsx:266` | A | Client | `"The name buyers are contracting with. Your registered business name if you sell through one; your own full name if you sell as an individual. Your storefront's name is a shop name, which is not the same thing and cannot stand in for this."` | `Settings.tax.fields.tradeName.infoTipBody` |
| `TaxSection.tsx:278` | B | Client | `placeholder="e.g. Studio Builderboy e.U."` | `Settings.tax.fields.tradeName.placeholder` |
| `TaxSection.tsx:289` | A | Client | `"Address"` (Label) | `Settings.tax.fields.address.label` |
| `TaxSection.tsx:290` | B | Client | `label="Why buyers see this"` (InfoTip) | `Settings.tax.fields.address.infoTipLabel` |
| `TaxSection.tsx:291` | A | Client | `"Distance-selling law asks for a postal address next to every offer. Shown in the Seller section of your product pages."` | `Settings.tax.fields.address.infoTipBody` |
| `TaxSection.tsx:298` | B | Client | `placeholder="e.g. 12 Market Street\nDublin…"` | `Settings.tax.fields.address.placeholder` |
| `TaxSection.tsx:311` | A | Client | `"Contact email"` (Label) | `Settings.tax.fields.contactEmail.label` |
| `TaxSection.tsx:312` | B | Client | `label="How this differs from your sign-in email"` (InfoTip) | `Settings.tax.fields.contactEmail.infoTipLabel` |
| `TaxSection.tsx:313` | A | Client | `"Shown to buyers as a mailto link, and used as the buy button's fallback when a product has no purchase link. Kept separate from your sign-in email on purpose: use whichever address you want buyers writing to. It has to be an address you actually read — placeholders, temp-mail providers and no-reply addresses are refused, and so is a domain that takes no mail."` | `Settings.tax.fields.contactEmail.infoTipBody` |
| `TaxSection.tsx:346` | A | Client | `"Save to send a confirmation link to the new address. Buyers see it only once it is confirmed."` | `Settings.tax.fields.contactEmail.statusDirty` |
| `TaxSection.tsx:352` | A | Client | `"Confirmed — buyers can reach you here."` | `Settings.tax.fields.contactEmail.statusConfirmed` |
| `TaxSection.tsx:356` | A | Client | `"Not confirmed yet. Open the link we emailed to this address."` | `Settings.tax.fields.contactEmail.statusUnconfirmed` |
| `TaxSection.tsx:363` | A | Client | `"VAT ID"` (Label) | `Settings.tax.fields.vatId.label` |
| `TaxSection.tsx:369` | B | Client | `placeholder="e.g. ATU12345678"` | `Settings.tax.fields.vatId.placeholder` |
| `TaxSection.tsx:385` | A | Client | `"Country"` (Label) | `Settings.tax.fields.country.label` |
| `TaxSection.tsx:394` | A | Client | `"Phone"` (Label) | `Settings.tax.fields.phone.label` |
| `TaxSection.tsx:415` | A | Client | `"Continue to your storefront"` | `Settings.tax.continueToStorefront` |
| `TaxSection.tsx:440` | B | Client | `pendingLabel="Sending…"` (resend) | `Common.actions.sending` |
| `TaxSection.tsx:441` | B | Client | `savedLabel="Sent"` (resend) | `Common.actions.sent` |
| `TaxSection.tsx:444` | A | Client | `"Resend confirmation email"` | `Settings.tax.resendConfirmation` |

*Note: `EU_COUNTRIES[*].name` values rendered in the Select come from `lib/settings/constants.ts`.
The lib agent owns those country-name strings. Coordination needed.*

---

### src/components/settings/ShippingSection.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `ShippingSection.tsx:50` | A | Client | `"Not set"` (Select option) | `Settings.shipping.shipsFrom.notSet` |
| `ShippingSection.tsx:65` | A | Client | `"None beyond the statutory right"` | `Settings.shipping.returnsWindow.none` |
| `ShippingSection.tsx:66` | A | Client | `"14 days"` | `Settings.shipping.returnsWindow.14days` |
| `ShippingSection.tsx:66` | A | Client | `description: "The EU statutory minimum"` | `Settings.shipping.returnsWindow.14daysNote` |
| `ShippingSection.tsx:67` | A | Client | `"30 days"` | `Settings.shipping.returnsWindow.30days` |
| `ShippingSection.tsx:68` | A | Client | `"Something else"` | `Settings.shipping.returnsWindow.custom` |
| `ShippingSection.tsx:71` | A | Client | `"The buyer pays return postage"` | `Settings.shipping.returnsPaidBy.buyer` |
| `ShippingSection.tsx:72` | A | Client | `"We pay return postage"` | `Settings.shipping.returnsPaidBy.seller` |
| `ShippingSection.tsx:211` | B | Client | `title="Shipping"` (SettingsCard) | `Settings.shipping.shippingCard.title` |
| `ShippingSection.tsx:212` | B | Client | `description="Set once for your whole account. Shown on every product page…"` | `Settings.shipping.shippingCard.description` |
| `ShippingSection.tsx:219` | A | Client | `"Ships from"` (Label) | `Settings.shipping.shipsFrom.label` |
| `ShippingSection.tsx:230` | A | Client | `"Dispatch time"` (Label) | `Settings.shipping.dispatch.label` |
| `ShippingSection.tsx:231` | B | Client | `label="Why this is its own field"` (InfoTip) | `Settings.shipping.dispatch.infoTipLabel` |
| `ShippingSection.tsx:232` | A | Client | `"One line, printed beside the buy button. 'When does it leave?' is the first thing buyers ask…"` | `Settings.shipping.dispatch.infoTipBody` |
| `ShippingSection.tsx:243` | B | Client | `placeholder="e.g. Ships within 1-3 business days"` | `Settings.shipping.dispatch.placeholder` |
| `ShippingSection.tsx:252` | A | Client | `"Where you ship, and how long it takes"` (Label) | `Settings.shipping.destinations.label` |
| `ShippingSection.tsx:254` | B | Client | `label="How much detail to give"` (InfoTip) | `Settings.shipping.destinations.infoTipLabel` |
| `ShippingSection.tsx:255` | A | Client | `"Group destinations however you actually ship: one row for home, one for the rest of the EU…"` | `Settings.shipping.destinations.infoTipBody` |
| `ShippingSection.tsx:262` | A | Client | `"Nothing listed yet. Buyers see no delivery times until you add a row."` | `Settings.shipping.destinations.empty` |
| `ShippingSection.tsx:271` | B | Client | `aria-label="Destination {n}"` (parameterised) | `Settings.shipping.destinations.rowAriaLabel` |
| `ShippingSection.tsx:276` | B | Client | `placeholder="e.g. Rest of EU"` | `Settings.shipping.destinations.areaPlaceholder` |
| `ShippingSection.tsx:278` | B | Client | `aria-label="Delivery time {n}"` (parameterised) | `Settings.shipping.destinations.timeAriaLabel` |
| `ShippingSection.tsx:282` | B | Client | `placeholder="e.g. 5-7 business days"` | `Settings.shipping.destinations.timePlaceholder` |
| `ShippingSection.tsx:285` | B | Client | `aria-label="Shipping cost {n}"` (parameterised) | `Settings.shipping.destinations.costAriaLabel` |
| `ShippingSection.tsx:288` | B | Client | `placeholder="e.g. €9.00"` | `Settings.shipping.destinations.costPlaceholder` |
| `ShippingSection.tsx:298` | B | Client | `aria-label="Remove the {area} destination"` (conditional) | `Settings.shipping.destinations.removeAriaLabel` |
| `ShippingSection.tsx:302` | B | Client | `aria-label="Remove destination {n}"` (conditional) | `Settings.shipping.destinations.removeAriaLabelFallback` |
| `ShippingSection.tsx:317` | A | Client | `"Add a destination"` | `Settings.shipping.destinations.addButton` |
| `ShippingSection.tsx:323` | A | Client | `"That is all {n} destinations. Remove one to add another."` | `Settings.shipping.destinations.maxReached` |
| `ShippingSection.tsx:330` | A | Client | `"Anything else about shipping"` (Label) | `Settings.shipping.notes.label` |
| `ShippingSection.tsx:336` | B | Client | `placeholder="e.g. Tracked as standard. We do not ship to PO boxes."` | `Settings.shipping.notes.placeholder` |
| `ShippingSection.tsx:344` | B | Client | `title="Returns"` | `Settings.shipping.returnsCard.title` |
| `ShippingSection.tsx:345` | B | Client | `description="What you offer on top of the statutory rights…"` | `Settings.shipping.returnsCard.description` |
| `ShippingSection.tsx:352` | A | Client | `"Returns window"` (Label) | `Settings.shipping.returnsWindow.label` |
| `ShippingSection.tsx:353` | B | Client | `label="What the statutory right already covers"` (InfoTip) | `Settings.shipping.returnsWindow.infoTipLabel` |
| `ShippingSection.tsx:354` | A | Client | `"Selling to EU buyers at a distance gives them 14 days to change their mind…"` | `Settings.shipping.returnsWindow.infoTipBody` |
| `ShippingSection.tsx:368` | B | Client | `aria-label="Returns window in days"` | `Settings.shipping.returnsWindow.customAriaLabel` |
| `ShippingSection.tsx:381` | A | Client | `"days"` (unit label beside custom input) | `Settings.shipping.returnsWindow.daysUnit` |
| `ShippingSection.tsx:393` | A | Client | `"Return postage"` (Label) | `Settings.shipping.returnsPaidBy.label` |
| `ShippingSection.tsx:403` | B | Client | `label="What belongs here"` (InfoTip: exceptions) | `Settings.shipping.exceptions.infoTipLabel` |
| `ShippingSection.tsx:404` | A | Client | `"Anything the window above does not cover: made-to-order pieces, hygiene items, opened software…"` | `Settings.shipping.exceptions.infoTipBody` |
| `ShippingSection.tsx:434` | A | Client | `"Exceptions"` (Label) | `Settings.shipping.exceptions.label` |
| `ShippingSection.tsx:414` | B | Client | `placeholder="e.g. Made-to-order pieces cannot be returned unless faulty."` | `Settings.shipping.exceptions.placeholder` |
| `ShippingSection.tsx:427` | B | Client | `title="What buyers will read"` | `Settings.shipping.previewCard.title` |
| `ShippingSection.tsx:428` | B | Client | `description="Built from your answers above, and shown on every product page."` | `Settings.shipping.previewCard.description` |
| `ShippingSection.tsx:433` | A | Client | `"Shipping"` (h3 in preview) | `Settings.shipping.previewCard.shippingHeading` |
| `ShippingSection.tsx:443` | A | Client | `"Returns"` (h3 in preview) | `Settings.shipping.previewCard.returnsHeading` |
| `ShippingSection.tsx:455` | A | Client | `"Nothing yet. Until you answer something above, your product pages carry no shipping or returns section at all."` | `Settings.shipping.previewCard.empty` |
| `ShippingSection.tsx:468` | B | Client | `title="Write it yourself instead"` | `Settings.shipping.overrideCard.title` |
| `ShippingSection.tsx:469` | B | Client | `description="Optional. Anything you put here replaces what was generated above, word for word."` | `Settings.shipping.overrideCard.description` |
| `ShippingSection.tsx:474` | A | Client | `"Your shipping policy"` (Label) | `Settings.shipping.overrideCard.shippingTextLabel` |
| `ShippingSection.tsx:480` | B | Client | `placeholder="Leave blank to use the answers above."` | `Settings.shipping.overrideCard.shippingTextPlaceholder` |
| `ShippingSection.tsx:485` | A | Client | `"Your returns policy"` (Label) | `Settings.shipping.overrideCard.returnsTextLabel` |
| `ShippingSection.tsx:490` | B | Client | `placeholder="Leave blank to use the answers above."` | `Settings.shipping.overrideCard.returnsTextPlaceholder` |
| `ShippingSection.tsx:507` | B | Client | `title="Shipping profiles"` | `Settings.shipping.profilesCard.title` |
| `ShippingSection.tsx:508` | B | Client | `description="For the few products that ship differently. Pick one on the product itself, under Shipping."` | `Settings.shipping.profilesCard.description` |
| `ShippingSection.tsx:513` | A | Client | `"None yet. Add one only if some products ship differently from the terms above."` | `Settings.shipping.profilesCard.empty` |
| `ShippingSection.tsx:527` | A | Client | `"Name"` (Label, profile) | `Settings.shipping.profilesCard.nameLabel` |
| `ShippingSection.tsx:531` | B | Client | `placeholder="e.g. Bulky items"` | `Settings.shipping.profilesCard.namePlaceholder` |
| `ShippingSection.tsx:537` | B | Client | `aria-label="Remove the {name} shipping profile"` (conditional) | `Settings.shipping.profilesCard.removeAriaLabel` |
| `ShippingSection.tsx:541` | B | Client | `aria-label="Remove this shipping profile"` (conditional) | `Settings.shipping.profilesCard.removeAriaLabelFallback` |
| `ShippingSection.tsx:552` | A | Client | `"Dispatch time"` (Label, profile) | `Settings.shipping.profilesCard.dispatchLabel` |
| `ShippingSection.tsx:557` | B | Client | `placeholder="e.g. Made to order, allow 3 weeks"` | `Settings.shipping.profilesCard.dispatchPlaceholder` |
| `ShippingSection.tsx:562` | A | Client | `"Shipping"` (Label, profile body) | `Settings.shipping.profilesCard.bodyLabel` |
| `ShippingSection.tsx:567` | B | Client | `placeholder="How these products ship, and what it costs"` | `Settings.shipping.profilesCard.bodyPlaceholder` |
| `ShippingSection.tsx:576` | A | Client | `"Add terms, or this profile is dropped when you save."` | `Settings.shipping.profilesCard.noTermsWarning` |
| `ShippingSection.tsx:593` | A | Client | `"Add a profile"` | `Settings.shipping.profilesCard.addButton` |
| `ShippingSection.tsx:599` | A | Client | `"That is all {n} profiles. Remove one to add another."` | `Settings.shipping.profilesCard.maxReached` |
| `ShippingSection.tsx:614` | A | Client | `"Continue to your storefront"` | `Settings.shipping.continueToStorefront` |

*Note: `buildShippingProse` output (lines 438–449) is rendered directly; the lib agent must
refactor that function to return keys before this component can be fully translated.*

---

### src/components/settings/SellerDetailsNotice.tsx (Server)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `SellerDetailsNotice.tsx:63` | A | Server | `"This store can't publish or sell yet."` (member audience) | `Settings.sellerDetailsNotice.memberHeadline` |
| `SellerDetailsNotice.tsx:65` | A | Server | `"Its owner has to add their seller details in their own settings."` | `Settings.sellerDetailsNotice.memberBody` |
| `SellerDetailsNotice.tsx:73` | A | Server | `"Add seller details"` (banner link) | `Settings.sellerDetailsNotice.addDetailsLink` |
| `SellerDetailsNotice.tsx:125` | A | Server | `"You can't {blocks} until your seller details are complete."` | `Settings.sellerDetailsNotice.headline` |
| `SellerDetailsNotice.tsx:131` | A | Server | `"Buyers have to be able to see who they are buying from and how to reach you before they order. These are shown on your product pages for that reason only, never used for marketing."` | `Settings.sellerDetailsNotice.body` |
| `SellerDetailsNotice.tsx:159` | A | Server | `"Add seller details"` (notice link) | `Settings.sellerDetailsNotice.addDetailsLink` |
| `SellerDetailsNotice.tsx:160` | A | Server | `"(opens in a new tab)"` (sr-only) | `Common.accessibility.opensInNewTab` |

*Note: `TRADER_IDENTITY_HEADLINE`, `traderIdentityFix()` and `field.label`/`field.why` (lines
63–68, 143–145) all come from `lib/settings/trader-identity.ts`. The lib agent owns those strings.*

---

### src/components/settings/team/TeamSection.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `TeamSection.tsx:85` | B | Client | `title="Team"` | `Settings.team.cardTitle` |
| `TeamSection.tsx:86` | B | Client | `description="People who can sign in to this store. Their role controls what they can see and change."` | `Settings.team.cardDescription` |
| `TeamSection.tsx:98` | A | Client | `"Couldn't load more members. Try again."` | `Settings.team.loadError` |
| `TeamSection.tsx:104` | A | Client | `"Loading…"` (conditional) | `Common.actions.loading` |
| `TeamSection.tsx:104` | A | Client | `"Try again"` (conditional) | `Common.actions.tryAgain` |
| `TeamSection.tsx:104` | A | Client | `"Load more members"` (conditional) | `Settings.team.loadMore` |
| `TeamSection.tsx:116` | A | Client | `"Invite member"` | `Settings.team.inviteButton` |

---

### src/components/settings/team/MemberList.tsx (Server)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `MemberList.tsx:63` | A | Server | `"It's just you so far. Invite someone to give them access."` | `Settings.team.memberList.onlyOwner` |
| `MemberList.tsx:72` | A | Server | `"Invited"` (section heading) | `Settings.team.memberList.invitedHeading` |
| `MemberList.tsx:74` | B | Server | `label="What an invited member can do"` (InfoTip) | `Settings.team.memberList.invitedInfoTipLabel` |
| `MemberList.tsx:75` | A | Server | `"Nothing yet. An invite takes effect the first time that person signs in with the email address it was sent to, and only then do they appear as a member with the role you chose."` | `Settings.team.memberList.invitedInfoTipBody` |
| `MemberList.tsx:96` | A | Server | `"Showing the first 50 members."` | `Settings.team.memberList.showingFirst50` |

---

### src/components/settings/team/MemberRow.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `MemberRow.tsx:128` | A | Client | `"(you)"` | `Settings.team.memberRow.you` |
| `MemberRow.tsx:182` | B | Client | `aria-label="Cancel the invite to {email}"` | `Settings.team.memberRow.cancelInviteAriaLabel` |
| `MemberRow.tsx:183` | B | Client | `aria-label="Remove {name} from the team"` | `Settings.team.memberRow.removeMemberAriaLabel` |
| `MemberRow.tsx:184` | B | Client | `title="Cancel invite"` (conditional) | `Settings.team.memberRow.cancelInviteTitle` |
| `MemberRow.tsx:184` | B | Client | `title="Remove from team"` (conditional) | `Settings.team.memberRow.removeFromTeamTitle` |
| `MemberRow.tsx:205` | A | Client | `"Make {name} {role}?"` (interpolated) | `Settings.team.memberRow.confirmRoleChange` |
| `MemberRow.tsx:219` | A | Client | `"Confirm"` | `Common.actions.confirm` |
| `MemberRow.tsx:222` | A | Client | `"Cancel"` | `Common.actions.cancel` |
| `MemberRow.tsx:240` | A | Client | `"Cancel the invite to {email}?"` | `Settings.team.memberRow.confirmCancelInvite` |
| `MemberRow.tsx:243` | A | Client | `"Remove {name}? They lose access immediately."` | `Settings.team.memberRow.confirmRemove` |
| `MemberRow.tsx:252` | B | Client | `pendingLabel="Cancelling…"` (conditional) | `Common.actions.cancelling` |
| `MemberRow.tsx:252` | B | Client | `pendingLabel="Removing…"` (conditional) | `Settings.team.memberRow.removing` |
| `MemberRow.tsx:253` | B | Client | `savedLabel="Cancelled"` (conditional) | `Settings.team.memberRow.cancelled` |
| `MemberRow.tsx:253` | B | Client | `savedLabel="Removed"` (conditional) | `Settings.team.memberRow.removed` |
| `MemberRow.tsx:255` | A | Client | `"Cancel invite"` (button, conditional) | `Settings.team.memberRow.cancelInviteButton` |
| `MemberRow.tsx:255` | A | Client | `"Remove"` (button, conditional) | `Common.actions.remove` |
| `MemberRow.tsx:260` | A | Client | `"Keep"` | `Settings.team.memberRow.keepButton` |

*Note: `ROLE_LABELS[role]` and `ROLE_DESCRIPTIONS[role]` (lines 172, 207) come from
`lib/team/permissions.ts`. The lib agent owns those strings.*

---

### src/components/settings/team/InviteModal.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `InviteModal.tsx:81` | B | Client | `title="Invite a member"` | `Settings.team.inviteModal.title` |
| `InviteModal.tsx:82` | B | Client | `description="They'll get access when they sign in with this email address."` | `Settings.team.inviteModal.description` |
| `InviteModal.tsx:88` | A | Client | `"Email address"` (Label) | `Settings.team.inviteModal.emailLabel` |
| `InviteModal.tsx:97` | B | Client | `placeholder="colleague@example.com"` | `Settings.team.inviteModal.emailPlaceholder` |
| `InviteModal.tsx:107` | A | Client | `"Role"` (Label) | `Settings.team.inviteModal.roleLabel` |
| `InviteModal.tsx:119` | A | Client | `"Email notifications aren't wired up yet — the invite takes effect when they sign in. You may want to let them know directly."` | `Settings.team.inviteModal.notificationNote` |
| `InviteModal.tsx:128` | B | Client | `pendingLabel="Sending…"` | `Common.actions.sending` |
| `InviteModal.tsx:129` | B | Client | `savedLabel="Sent"` | `Common.actions.sent` |
| `InviteModal.tsx:131` | A | Client | `"Send invite"` | `Settings.team.inviteModal.sendButton` |

---

### src/components/settings/team/InviteAcceptRow.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `InviteAcceptRow.tsx:49` | A | Client | `"{storeName} invited you as {role}"` (partial: storeName is seller-authored; role label is from lib) | `Settings.team.inviteAcceptRow.invitedAs` |
| `InviteAcceptRow.tsx:62` | B | Client | `pendingLabel="Accepting…"` | `Settings.team.inviteAcceptRow.accepting` |
| `InviteAcceptRow.tsx:63` | B | Client | `savedLabel="Accepted"` | `Settings.team.inviteAcceptRow.accepted` |
| `InviteAcceptRow.tsx:65` | A | Client | `"Accept"` | `Settings.team.inviteAcceptRow.acceptButton` |

*Note: `storeName` in the invite description is seller-authored data (DO NOT WRAP the value,
but DO wrap the sentence template). `ROLE_LABELS[invite.role]` is from lib.*

---

### src/components/settings/team/InvitePromptModal.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `InvitePromptModal.tsx:44` | B | Client | `"You have team invites"` (plural) | `Settings.team.invitePromptModal.titlePlural` |
| `InvitePromptModal.tsx:44` | B | Client | `"You have a team invite"` (singular) | `Settings.team.invitePromptModal.titleSingular` |
| `InvitePromptModal.tsx:47` | B | Client | `"You've been invited to join these teams. Accept to get access."` (plural) | `Settings.team.invitePromptModal.descriptionPlural` |
| `InvitePromptModal.tsx:50` | B | Client | `"You've been invited to join a team. Accept to get access."` (singular) | `Settings.team.invitePromptModal.descriptionSingular` |
| `InvitePromptModal.tsx:61` | A | Client | `"Maybe later"` | `Settings.team.invitePromptModal.maybeLater` |

*Note: plural forms should be unified with ICU plural syntax since Czech has one/few/many/other
plural categories.*

---

### src/components/settings/team/PendingInvites.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `PendingInvites.tsx:15` | B | Client | `title="Invites for you"` | `Settings.team.pendingInvites.cardTitle` |
| `PendingInvites.tsx:16` | B | Client | `description="Accept an invite to join that store's team."` | `Settings.team.pendingInvites.cardDescription` |

---

## Payments components

### src/components/payments/PaymentsPage.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `PaymentsPage.tsx:44` | A | Client | `"Payments"` (h1) | `Payments.pageTitle` |

---

### src/components/payments/BalanceSummary.tsx (Server)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `BalanceSummary.tsx:74` | B | Server | `label="Available"` | `Payments.balance.available.label` |
| `BalanceSummary.tsx:75` | B | Server | `zeroText="Nothing to pay out yet"` | `Payments.balance.available.zeroText` |
| `BalanceSummary.tsx:76` | B | Server | `hint="Ready for your next payout"` | `Payments.balance.available.hint` |
| `BalanceSummary.tsx:79` | B | Server | `label="Pending"` | `Payments.balance.pending.label` |
| `BalanceSummary.tsx:80` | B | Server | `zeroText="No pending sales"` | `Payments.balance.pending.zeroText` |
| `BalanceSummary.tsx:81` | B | Server | `hint="Clearing from recent sales"` | `Payments.balance.pending.hint` |
| `BalanceSummary.tsx:84` | B | Server | `label="Next payout"` | `Payments.balance.nextPayout.label` |
| `BalanceSummary.tsx:87` | B | Server | `zeroText="No payout scheduled"` | `Payments.balance.nextPayout.zeroText` |
| `BalanceSummary.tsx:91` | B | Server | `hint="Expected {date}"` (interpolated) | `Payments.balance.nextPayout.hint` |

---

### src/components/payments/ConnectionStatusCard.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `ConnectionStatusCard.tsx:46` | B | Client | `aria-label="Stripe connection"` (section) | `Payments.connection.ariaLabel` |
| `ConnectionStatusCard.tsx:53` | A | Client | `"Getting paid through Stripe is coming soon"` | `Payments.connection.comingSoonTitle` |
| `ConnectionStatusCard.tsx:55` | A | Client | `"Until then, buyers pay you through your product's buy link, or by emailing you."` | `Payments.connection.comingSoonBody` |
| `ConnectionStatusCard.tsx:73` | A | Client | `"Connect Stripe to get paid"` | `Payments.connection.connectTitle` |
| `ConnectionStatusCard.tsx:75` | A | Client | `"Payouts go straight to your bank. Setup happens securely on Stripe, we never see or store your bank details."` | `Payments.connection.connectBody` |
| `ConnectionStatusCard.tsx:82` | A | Client | `"Connect with Stripe"` | `Payments.connection.connectButton` |
| `ConnectionStatusCard.tsx:99` | A | Client | `"Stripe account connected"` | `Payments.connection.connectedLabel` |
| `ConnectionStatusCard.tsx:110` | B | Client | `label="Charges"` (StatusDot) | `Payments.connection.chargesLabel` |
| `ConnectionStatusCard.tsx:111` | B | Client | `label="Payouts"` (StatusDot) | `Payments.connection.payoutsLabel` |
| `ConnectionStatusCard.tsx:112` | B | Client | `label="Verified"` (StatusDot) | `Payments.connection.verifiedLabel` |
| `ConnectionStatusCard.tsx:116` | A | Client | `"Stripe needs more information before payouts can continue."` | `Payments.connection.requirementsAlert` |

---

### src/components/payments/ConnectStripeModal.tsx (Client)

`POINTS` array (lines 12–28) is a component-local copy constant (Cat D).

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `ConnectStripeModal.tsx:14` | D | Client | `title: "Stripe handles the sensitive part"` | `Payments.connectModal.point1.title` |
| `ConnectStripeModal.tsx:15` | D | Client | `body: "Bank details, identity checks and verification all happen on Stripe's secure pages. Square Share never sees or stores them."` | `Payments.connectModal.point1.body` |
| `ConnectStripeModal.tsx:19` | D | Client | `title: "Payouts go straight to your bank"` | `Payments.connectModal.point2.title` |
| `ConnectStripeModal.tsx:20` | D | Client | `body: "Once connected, your balance is paid out automatically on a rolling schedule."` | `Payments.connectModal.point2.body` |
| `ConnectStripeModal.tsx:23` | D | Client | `title: "Takes about 5 minutes"` | `Payments.connectModal.point3.title` |
| `ConnectStripeModal.tsx:24` | D | Client | `body: "You'll be redirected to Stripe to finish setup, then land right back here."` | `Payments.connectModal.point3.body` |
| `ConnectStripeModal.tsx:54` | B | Client | `title="Connect with Stripe"` | `Payments.connectModal.title` |
| `ConnectStripeModal.tsx:55` | B | Client | `description="Get paid for what you sell. Setup happens on Stripe, not here."` | `Payments.connectModal.description` |
| `ConnectStripeModal.tsx:77` | A | Client | `"Not now"` | `Common.actions.notNow` |
| `ConnectStripeModal.tsx:82` | B | Client | `title="Stripe payouts are coming soon."` (tooltip, conditional) | `Payments.connectModal.comingSoonTooltip` |
| `ConnectStripeModal.tsx:83` | A | Client | `"Continue to Stripe"` | `Payments.connectModal.continueButton` |
| `ConnectStripeModal.tsx:85` | A | Client | `"Soon"` (badge) | `Common.badges.soon` |

---

### src/components/payments/PayoutHistory.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `PayoutHistory.tsx:31` | A | Client | `"Payouts"` (h2) | `Payments.payoutHistory.title` |
| `PayoutHistory.tsx:37` | A | Client | `"No payouts yet. Once you make sales, Stripe sends your balance to your bank automatically."` | `Payments.payoutHistory.emptyWithStripe` |
| `PayoutHistory.tsx:39` | A | Client | `"No payouts yet."` | `Payments.payoutHistory.empty` |
| `PayoutHistory.tsx:46` | A | Client | `"Amount"` (th) | `Payments.payoutHistory.colAmount` |
| `PayoutHistory.tsx:47` | A | Client | `"Status"` (th) | `Payments.payoutHistory.colStatus` |
| `PayoutHistory.tsx:48` | A | Client | `"Bank"` (th) | `Payments.payoutHistory.colBank` |
| `PayoutHistory.tsx:49` | A | Client | `"Arrives"` (th) | `Payments.payoutHistory.colArrives` |
| `PayoutHistory.tsx:64` | B | Client | `aria-label="Payout {amount}, view details"` | `Payments.payoutHistory.rowAriaLabel` |

---

### src/components/payments/PayoutMethodCard.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `PayoutMethodCard.tsx:25` | B | Client | `aria-label="Payout method"` (section) | `Payments.payoutMethod.ariaLabel` |
| `PayoutMethodCard.tsx:29` | A | Client | `"Payout method"` (h2) | `Payments.payoutMethod.title` |
| `PayoutMethodCard.tsx:32` | A | Client | `"Manage"` (button) | `Common.actions.manage` |
| `PayoutMethodCard.tsx:47` | A | Client | `"Default"` (conditional suffix) | `Payments.payoutMethod.default` |
| `PayoutMethodCard.tsx:54` | A | Client | `"No payout method yet. Connect Stripe and add your bank there, it shows up here automatically."` | `Payments.payoutMethod.emptyWithStripe` |
| `PayoutMethodCard.tsx:56` | A | Client | `"No payout method yet."` | `Payments.payoutMethod.empty` |

---

### src/components/payments/PayoutMethodModal.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `PayoutMethodModal.tsx:33` | B | Client | `title="Payout method"` | `Payments.payoutMethodModal.title` |
| `PayoutMethodModal.tsx:34` | B | Client | `description="Where your payouts are sent."` | `Payments.payoutMethodModal.description` |
| `PayoutMethodModal.tsx:45` | A | Client | `"Bank account · {currency} · {country}"` | `Payments.payoutMethodModal.bankAccountDetail` |
| `PayoutMethodModal.tsx:52` | B | Client | `label="Default for payouts"` (DetailRow) | `Payments.payoutMethodModal.defaultLabel` |
| `PayoutMethodModal.tsx:54` | A | Client | `"Yes"` (conditional) | `Common.values.yes` |
| `PayoutMethodModal.tsx:54` | A | Client | `"No"` (conditional) | `Common.values.no` |
| `PayoutMethodModal.tsx:57` | B | Client | `label="Reference"` (DetailRow) | `Payments.payoutMethodModal.referenceLabel` |
| `PayoutMethodModal.tsx:64` | A | Client | `"For your security, bank details are changed on Stripe, never here."` | `Payments.payoutMethodModal.securityNote` |
| `PayoutMethodModal.tsx:69` | A | Client | `"Close"` | `Common.actions.close` |
| `PayoutMethodModal.tsx:71` | A | Client | `"Manage in Stripe"` | `Payments.payoutMethodModal.manageInStripe` |

---

### src/components/payments/PayoutStatusBadge.tsx (Server)

`STATUS_LABELS` (lines 5–11) is a component-local copy constant (Cat D).

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `PayoutStatusBadge.tsx:6` | D | Server | `"Paid"` | `Payments.payoutStatus.paid` |
| `PayoutStatusBadge.tsx:7` | D | Server | `"Pending"` | `Payments.payoutStatus.pending` |
| `PayoutStatusBadge.tsx:8` | D | Server | `"In transit"` | `Payments.payoutStatus.inTransit` |
| `PayoutStatusBadge.tsx:9` | D | Server | `"Canceled"` | `Payments.payoutStatus.canceled` |
| `PayoutStatusBadge.tsx:10` | D | Server | `"Failed"` | `Payments.payoutStatus.failed` |

---

### src/components/payments/RecentActivity.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `RecentActivity.tsx:30` | B | Client | `aria-label="Recent activity"` (section) | `Payments.recentActivity.ariaLabel` |
| `RecentActivity.tsx:34` | A | Client | `"Activity"` (h2) | `Payments.recentActivity.title` |
| `RecentActivity.tsx:40` | A | Client | `"Sales, refunds and payouts will show up here."` | `Payments.recentActivity.empty` |
| `RecentActivity.tsx:63` | A | Client | `" · Pending"` (conditional suffix appended to date string) | `Payments.recentActivity.pending` |

*Note: `RecentActivity.tsx:63` builds a string by appending `" · Pending"` to a formatted date.
This will need `t.rich` or a conditional to avoid string concatenation across locale boundaries.*

---

### src/components/payments/TransactionDetailModal.tsx (Client)

`TYPE_LABELS` (lines 10–16) is a component-local copy constant (Cat D).

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `TransactionDetailModal.tsx:11` | D | Client | `"Sale"` | `Payments.transactionType.charge` |
| `TransactionDetailModal.tsx:12` | D | Client | `"Refund"` | `Payments.transactionType.refund` |
| `TransactionDetailModal.tsx:13` | D | Client | `"Payout"` | `Payments.transactionType.payout` |
| `TransactionDetailModal.tsx:14` | D | Client | `"Stripe fee"` | `Payments.transactionType.stripeFee` |
| `TransactionDetailModal.tsx:15` | D | Client | `"Adjustment"` | `Payments.transactionType.adjustment` |
| `TransactionDetailModal.tsx:34` | B | Client | `"Transaction"` (fallback title) | `Payments.transactionDetailModal.fallbackTitle` |
| `TransactionDetailModal.tsx:50` | B | Client | `label="Processing fee"` | `Payments.transactionDetailModal.processingFeeLabel` |
| `TransactionDetailModal.tsx:54` | B | Client | `label="Net to your balance"` | `Payments.transactionDetailModal.netLabel` |
| `TransactionDetailModal.tsx:62` | B | Client | `label="Status"` | `Payments.transactionDetailModal.statusLabel` |
| `TransactionDetailModal.tsx:65` | A | Client | `"Pending, clearing to your balance"` | `Payments.transactionDetailModal.statusPending` |
| `TransactionDetailModal.tsx:66` | A | Client | `"Available"` | `Payments.transactionDetailModal.statusAvailable` |
| `TransactionDetailModal.tsx:69` | B | Client | `label="Date"` | `Payments.transactionDetailModal.dateLabel` |
| `TransactionDetailModal.tsx:73` | B | Client | `label="Transaction ID"` | `Payments.transactionDetailModal.idLabel` |

---

### src/components/payments/PayoutDetailModal.tsx (Client)

| File:line | Cat | Client/Server | Current string | Proposed key |
|-----------|-----|---------------|----------------|--------------|
| `PayoutDetailModal.tsx:21` | B | Client | `title="Payout"` | `Payments.payoutDetailModal.title` |
| `PayoutDetailModal.tsx:30` | B | Client | `label="Sent to"` | `Payments.payoutDetailModal.sentToLabel` |
| `PayoutDetailModal.tsx:32` | A | Client | `"Bank account ···· {last4}"` | `Payments.payoutDetailModal.bankAccount` |
| `PayoutDetailModal.tsx:35` | B | Client | `label="Arrives"` | `Payments.payoutDetailModal.arrivesLabel` |
| `PayoutDetailModal.tsx:40` | B | Client | `label="Initiated"` | `Payments.payoutDetailModal.initiatedLabel` |
| `PayoutDetailModal.tsx:43` | B | Client | `label="Type"` | `Payments.payoutDetailModal.typeLabel` |
| `PayoutDetailModal.tsx:45` | A | Client | `"Instant"` (conditional) | `Payments.payoutDetailModal.typeInstant` |
| `PayoutDetailModal.tsx:45` | A | Client | `"Standard"` (conditional) | `Payments.payoutDetailModal.typeStandard` |
| `PayoutDetailModal.tsx:46` | A | Client | `" · Automatic"` (conditional) | `Payments.payoutDetailModal.automatic` |
| `PayoutDetailModal.tsx:46` | A | Client | `" · Manual"` (conditional) | `Payments.payoutDetailModal.manual` |
| `PayoutDetailModal.tsx:49` | B | Client | `label="On your bank statement"` | `Payments.payoutDetailModal.statementLabel` |
| `PayoutDetailModal.tsx:57` | B | Client | `label="Payout ID"` | `Payments.payoutDetailModal.idLabel` |
| `PayoutDetailModal.tsx:67` | A | Client | `"This payout could not be delivered. Stripe retries automatically, and the amount stays in your available balance until it succeeds."` | `Payments.payoutDetailModal.failedNote` |

*Note: lines 45–46 build the type description by string concatenation
(`"Instant"/"Standard"` + `" · Automatic"/"· Manual"`). These will need restructuring
to avoid concatenating translated fragments: ICU plural or separate key per combination.*
