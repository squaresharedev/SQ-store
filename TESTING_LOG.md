# TESTING_LOG

Running log for the comprehensive test-suite effort on `test/full-suite`.
Updated continuously; newest entries at the bottom of each section.

## Test database (Step 0)

**Planned:** Supabase branch of SQ-store via MCP `create_branch`.
**Actual:** Branching requires the Pro plan (`PaymentRequiredException`) and the
free org is at its 2-active-project cap (SQ-store + Homepage, both live), so
neither a branch nor a throwaway project was possible without paying or pausing
live infrastructure.

**Workaround in place:** a hermetic **embedded PostgreSQL 17.10** instance
(`embedded-postgres` npm package, binaries vendored, no Docker/admin needed)
that boots per test run:

- `tests/db/shim.sql` — recreates the Supabase environment: `anon` /
  `authenticated` / `service_role` (with BYPASSRLS) roles, the `auth` schema
  (`auth.users`, `auth.uid()/role()/email()/jwt()` reading
  `request.jwt.claims`), `storage` schema, `supabase_realtime` publication,
  Supabase default privileges, and the `ensure_rls` event trigger (verbatim
  from prod).
- `tests/db/prod-migrations.sql` — the **exact 25-migration history** pulled
  read-only from prod (`supabase_migrations.schema_migrations`) on 2026-07-10.
- `tests/db/client.ts` — impersonation helpers that execute queries exactly
  like PostgREST does (transaction + `request.jwt.claims` GUC + `SET ROLE`),
  so RLS/grant behavior is production-faithful. True multi-connection
  concurrency is available for race tests.

Prod was only ever read (schema/migration introspection). All test data lives
in the embedded instance, which is wiped after each run.

## Inventory (Step 1) — WIRED vs STUB

### WIRED (tested or being tested)
- **Auth**: login/signup/magic/reset, OAuth callback + OTP confirm routes, session helpers
- **Products**: CRUD server actions, Zod validation, R2 presign/upload/verify, queries
- **Storefronts**: designer, config Zod schema (theme/blocks/header/embed), save/load, ownership + block re-verification, embed settings
- **Grid**: size enums, snapping, layout hooks, resize (pointer + keyboard)
- **Orders**: queries (filter/sort/paginate), RLS, dashboard aggregates
- **Analytics**: queries + aggregation over orders
- **Stock**: badge derivation, `decrement_stock` SQL function (atomic, service-role-only), update settings action
- **Team & Access**: permission map (`can`/`canGrant`), invite/accept RPC/role-change/revoke actions, RLS + guard trigger, store switching
- **Notifications**: service-role-only creation, RLS reads/mark-read, realtime plumbing, presentation helpers
- **Settings**: display name (+uniqueness RPC), email/password change, tax, legal, notification prefs, soft account deletion, GDPR export route, avatar upload (magic-byte sniff + `rl_take` rate limiter)
- **API routes**: `POST /api/uploads/presign`, `GET /api/settings/display-name-available`, `GET /settings/export`
- **UI primitives**: DatePicker, Calendar, ColorPicker, ColorArea, Modal, Popover, Slider, SegmentedControl, color-input, etc.

### STUB (skipped placeholder tests only)
- **Payments**: `lib/payments/mock.ts` is 100% mock (`TODO(stripe)` on every fn). No live Stripe calls exist anywhere. Negative tests assert this stays true.
- **Order refund/dispute actions**: confirm UI exists, mutations are `TODO(stripe)` no-ops.
- **Checkout / order creation**: does not exist; `decrementStock` is wired code with no caller yet (function itself IS tested).
- **Public embed/config endpoint + image proxy**: DO NOT EXIST in this repo (widget lives at embed.squareshare.to, separate service). `lib/stock/public.ts` whitelist helpers exist and are tested; endpoint tests are placeholders.
- **Team invite emails**: insert works, email delivery is a console stub.
- **Hard account deletion**: soft flag only.
- **Analytics Views/Clicks tiles, DemographicsCard, OnboardingSlot, Sidebar "Discover"**: pending/coming-soon UI.
- **Tax fields**: saved but unused downstream.

### Also present in prod schema (out of dashboard scope, RLS still tested)
- `admin_users`, `admin_audit_log`, `admin_user_directory` view, `waitlist_signups` — admin panel/homepage tables; RLS/grants get coverage because they share the DB.

## Tooling (Step 2)
- Vitest 4 with two projects: `unit` (jsdom + RTL) and `db` (node + embedded PG, sequential files).
- Playwright (`@playwright/test` 1.61.1) for E2E; `@axe-core/playwright` for a11y.
- Scripts: `pnpm test`, `test:unit`, `test:db`, `test:e2e`, `test:a11y`, `test:watch`.

## Bugs found & fixed

(chronological; ⚠ = security-relevant)

_(none yet)_

## Open questions / flagged, not fixed

_(none yet)_

## Coverage by system

| System | Status |
| --- | --- |
| Harness (roles/RLS/triggers smoke) | ✅ 7 tests green |
| Validation schemas (unit) | pending |
| Permission map / stock / formatters / grid (unit) | pending |
| RLS: products/storefronts/orders/notifications/profiles/team | pending |
| Stock decrement + race | pending |
| Team escalation guards | pending |
| Rate limiter | pending |
| Component tests | pending |
| E2E | pending |
| a11y | pending |
