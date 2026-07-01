# store.squareshare.to — Creator Dashboard

The Square Share seller/creator dashboard: manage products, design the bento-grid
storefront, connect Stripe, and view analytics.

## Stack

- **Next.js 16** (App Router, TypeScript) + **Tailwind CSS v4**
- **Cloudflare Workers** via **@opennextjs/cloudflare** (Node runtime — **not** Vercel, **not** edge)
- **Supabase** (DB + auth) via **@supabase/ssr** (cookie-based sessions)
- **pnpm**

Design system: see [`docs/styles.md`](docs/styles.md). Product context: [`docs/context.md`](docs/context.md).

## Setup

1. `pnpm install`
2. Copy env: `cp .env.example .env.local` (already present locally). Fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` — `https://fdpviaqzbxowvonuoktc.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the publishable key (`sb_publishable_…`)
   - `SUPABASE_SERVICE_ROLE_KEY` — server-only secret, add when privileged
     server calls are needed (keep out of any `NEXT_PUBLIC_` var).
3. `pnpm dev` → http://localhost:3000 (auth screen at `/login`).

`.env.local` is gitignored. **Never** commit real keys.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Next dev server (Cloudflare bindings via OpenNext) |
| `pnpm build` | `next build` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm preview` | OpenNext build + local Workers preview |
| `pnpm deploy` | OpenNext build + deploy to Cloudflare |
| `pnpm cf-typegen` | Regenerate `cloudflare-env.d.ts` from `wrangler.jsonc` |

> **Windows note:** `opennextjs-cloudflare build` (used by `preview`/`deploy`)
> creates symlinks and needs **Developer Mode enabled** or an **elevated shell**.
> CI (Linux) and normal deploys are unaffected. `pnpm build`/`dev` work anywhere.

## Auth model

The Supabase session cookie is scoped to `.squareshare.to` (shared with the
marketplace subdomain later) and is **HttpOnly** — so auth is **server-driven**:
read the session from Server Components / Route Handlers / Server Actions using
the **server** client. See `src/lib/supabase/*` and `src/lib/supabase/cookie-options.ts`.

Do **not** put Supabase session logic in `middleware.ts` — `cookies()` from
`next/headers` is Node-only and breaks in middleware on Workers.

## Structure

```
src/
  app/            routes (/, /login), layout, globals.css, fonts/
  components/
    ui/           Button, Input, Label (brand primitives)
    auth/         LoginForm (UI only — auth logic is TODO)
  lib/
    supabase/     client.ts (browser), server.ts, cookie-options.ts
    utils/        cn()
    site.ts       shared constants
  types/          generated Supabase Database types + re-exports
```
