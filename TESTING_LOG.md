# TESTING_LOG

Running log for the comprehensive test-suite effort on `test/full-suite`.

## How to run

```
pnpm test          # all vitest (unit + component + db integration) — 566 tests
pnpm test:unit     # unit + component only (jsdom)
pnpm test:db       # embedded-Postgres RLS/integration only
pnpm test:e2e      # Playwright: boots the full local stack itself — 27 tests
pnpm test:a11y     # Playwright axe suite only
pnpm typecheck && pnpm lint
```

E2E needs the PostgREST binary once per machine:
`node tests/e2e/stack/fetch-postgrest.mjs` (vendors it into `tools/`, gitignored).

Everything is green and CI-runnable on a clean checkout (no Docker, no admin,
no external service). Suite totals: **566 vitest** (unit + component + DB
integration) **+ 27 Playwright E2E/a11y = 593 tests**, plus 15 `todo`
placeholders for stub features.

## Test database (Step 0)

**Planned:** Supabase branch via MCP `create_branch`.
**Actual:** branching needs the Pro plan (`PaymentRequiredException`) and the
free org is at its 2-active-project cap, so no branch/throwaway project was
possible without paying or pausing live infra. Prod was only ever read
(schema + migration introspection); no test data ever touched it.

**Isolation mechanism (two hermetic layers, both from vendored binaries):**

1. **DB integration** — `embedded-postgres` boots a real PostgreSQL 17 per
   `pnpm test:db` run. `tests/db/shim.sql` recreates the Supabase environment
   (roles `anon`/`authenticated`/`service_role`(BYPASSRLS)/`authenticator`, the
   `auth` schema + `auth.uid()/role()/jwt()/email()` reading
   `request.jwt.claims`, `storage`, `supabase_realtime`, default privileges,
   the `ensure_rls` event trigger). `tests/db/prod-migrations.sql` replays the
   exact 25-migration prod history. `tests/db/client.ts` impersonates users
   exactly like PostgREST (transaction + claims GUC + `SET ROLE`).
2. **E2E** — `tests/e2e/stack/server.mjs` boots embedded PG + the real
   **PostgREST** engine + a minimal mock GoTrue gateway that mints real HS256
   JWTs PostgREST validates, then `next dev`. So RLS, `auth.uid()`, and team
   claims behave byte-for-byte like production, and the app is exercised
   through its actual server actions and route handlers.

## Coverage by system (WIRED unless noted)

| System | Unit | Integration (RLS/DB) | Component | E2E |
| --- | --- | --- | --- | --- |
| Auth + session | — | signup trigger chain | LoginForm | signup/signin/dupe/redirect (7) |
| Products CRUD + R2 keys | schemas, key ownership, sanitize | products RLS + team access | ProductForm | add/edit/delete/validate (3) |
| Storefront designer + Zod | full config schema suite | storefront RLS | — | create/blocks/save/persist/undo/embed (2) |
| Shared grid + resize | snap/clamp/placeholder math | — | SegmentedControl/slider | (via designer) |
| Embed settings | hostname/domain suite | (config jsonb) | — | snippet + domain normalize + reject (in 2) |
| Orders | (query shape) | orders RLS read-only | — | filter/detail/empty (in 4) |
| Stock | badge derivation, public whitelist | atomic decrement + **race** | StockBadge | — |
| Team & access | permission matrix, canGrant | **escalation guards** + invites | — | invite→accept→switch→bell, viewer RO (2) |
| Notifications | schemas | RLS, column-grant, service-only | NotificationItem (XSS-as-text) | bell shows acceptance (in team) |
| Payments (STUB) | no-Stripe scan, no-sensitive-fields | — | (read-only) | no external net + no PAN inputs (1) |
| Analytics | — | (reads orders) | — | seeded revenue + channel split (1) |
| Settings | settings schemas + whitelists | profiles RLS, uniqueness, rate limiter | — | (via a11y + team) |
| API routes | presign/display-name/export | — | — | — |
| UI primitives | color/calendar math | — | ColorPicker, DatePicker, Modal, Popover | — |
| Direct REST attack surface | — | — | — | cross-tenant, RPC lockdown, self-escalate (4) |
| Accessibility | — | — | — | axe on 13 pages + designer + dialog (4) |

### STUB features (placeholder `it.todo`, not asserted — they don't exist yet)
Payments/Stripe Connect (mock layer only), checkout/order creation +
`decrementStock` caller, public embed endpoint + image proxy (widget lives at
`embed.squareshare.to`, a separate service), team invite emails, account hard
delete, analytics Views/Clicks/Demographics, onboarding checklist, tax
downstream use. `tests/unit/stubs.placeholder.test.ts` enumerates them.

## Bugs found & fixed  (⚠ = security/accessibility-relevant)

All found by tests written here; app code fixed, tests never weakened.

1. ⚠ **AvatarUpload file input had no accessible label** (critical axe) —
   `src/components/settings/AvatarUpload.tsx`: added `aria-label`. A
   screen-reader user had no way to identify the profile-photo control.
2. ⚠ **`--color-success` #16a34a failed AA contrast** for small text/badges on
   white and `bg-secondary` — `src/app/globals.css`: darkened to #15803d
   (green-700). Affected paid-status badges + positive metrics across
   dashboard/orders/analytics/payments.
3. ⚠ **Destructive small text failed AA** (disputed/refunded/failed badges,
   payout-failure notes, taken-name error) — added a `--color-danger-strong`
   (#b91c1c red-700) token for small text on light surfaces and applied it in
   OrderStatusBadge, RecentOrders, PayoutStatusBadge, ConnectionStatusCard,
   PayoutDetailModal, DisplayNameForm; kept base `--destructive` for fills.
4. ⚠ **Danger settings-nav item red-600-on-red-50 + revoked-member chip
   red-500** below AA — `SettingsShell.tsx`, `team/MemberRow.tsx`: → red-700.
5. ⚠ **Low-contrast hint/label text** (`text-neutral-400`) across Login, Reset,
   settings (Legal/Password/SignOut/Tax/DisplayName/MemberList) and InviteModal
   → `neutral-500`/`600` per background. Failed AA for secondary text.
6. `docs/styles.md` token table updated to match #2/#3 so the design-system
   source of truth stays honest.

No correctness/security **logic** defects were found — the RLS model, escalation
guards, atomic stock decrement, field whitelists, key-ownership checks, and the
payments mock boundary all held under adversarial tests (including raw
PostgREST probes with a stolen JWT and a 20-way concurrent-checkout race). The
one whole class of real bugs found was accessibility contrast + a missing label.

## Open questions / flagged, not fixed

- **Analytics revenue vs refunds:** the E2E assertion accepts either "refunds
  excluded from headline revenue" or "included" because the product intent is
  undefined; not a bug, logged for a product decision.
- **`src/lib/supabase/server.ts` logs cookie operations** (`console.log` on every
  set) — noisy for prod, but behavior-correct; left as-is (out of test scope).
- **`avatar.ts` unused `_prev/_formData` params** — pre-existing lint warnings in
  app code, untouched (not introduced by this work).

## Test-infra notes (not app bugs)
- Branching unavailable → embedded-Postgres replica (documented above).
- Dev-mode hydration can wipe a controlled input filled too early → `fillStable`
  helper retries until the value sticks.
- `getByRole("alert")` also matches the Next dev-tools announcer → specs filter
  by text.
- Component tests needed explicit `afterEach(cleanup)` (vitest `globals` off),
  a `matchMedia` stub, and `useFakeTimers({ toFake: ["Date"] })`.
