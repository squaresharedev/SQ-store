# The MCP server

Square Share runs a remote MCP server at `https://dashboard.squareshare.eu/mcp`.
A seller adds that one URL to Claude or any other MCP client, approves it once in
the browser, and the assistant can then work on their store.

See [agent-surface.md](./agent-surface.md) for what each datapoint means and what
an assistant must and must not do with it.

## Connecting

1. Add `https://dashboard.squareshare.eu/mcp` as a connector in the client.
2. The client sends the seller to a Square Share page that names the app and where
   its access goes.
3. The seller chooses a store and what the app may do, then presses Connect. That
   is all for an account without 2FA, or one that passed it in the last 10 minutes.
   Otherwise the usual step-up applies: a passkey makes Connect "Confirm with
   passkey" (one press), and only an account with an authenticator app types a code.

Settings > Connected apps lists every connected app, with a Disconnect button.

## How it works

```
client --opaque bearer token--> /mcp
  lib/agent/authenticate.ts     hash lookup: grant, store, scopes, expiry
  lib/agent/context.ts          runAsAgent: identity for everything underneath
  lib/agent/mcp-transport.ts    the only file that knows MCP
  lib/agent/dispatch.ts         scope and role check, budget, secret check, trail
  lib/agent/tools/*             a thin layer over the existing actions and queries
  lib/supabase/server.ts        a 5-minute user JWT, so RLS is still the boundary
```

**Why the actions run unchanged.** `createClient`, `getSessionState` and
`getActiveAccount` look for an agent context first. Inside one, the same action a
browser calls runs with the same validation, publish gate, plan limits and
moderation. There is no second write path to keep in step.

**Why the client holds an opaque token.** A real Supabase JWT would work directly
against the database and ignore every scope. So the client's token is only a
lookup key, stored as its SHA-256, and each request mints its own JWT that goes
from this server to Supabase and nowhere else.

**The signing key** is a dedicated ES256 key imported into Supabase as a STANDBY
signing key. Auth never signs with it, and revoking it stops agent access and
nothing else. It is the Worker secret `AGENT_JWT_SIGNING_KEY`, as a private JWK.
Never press Rotate onto it. A new standby key takes about 10 minutes to be trusted.

## Adding a tool

Add one `defineTool` entry in `src/lib/agent/tools/<domain>.ts`, and list a new
file in `tools/index.ts`:

```ts
defineTool({
  name: "end_sale",
  title: "End a sale",
  description: "End a running sale now.", // written for the model
  scope: "discounts:write",               // a grant must hold this...
  permission: "products.write",           // ...and the person's role must allow this
  annotations: WRITE,                     // READ, WRITE or DESTRUCTIVE
  input: z.strictObject({ id: z.string() }),
  handler: async ({ id }) => unwrap(await endSale(id)),
});
```

The dispatcher does the rest. A new server action fails
`tests/unit/agent/registry.test.ts` until it is classified there as `tool`,
`person`, `browser` or `deferred`, so the surface cannot quietly fall behind.

A new scope is one entry in `src/lib/agent/scopes.ts` plus its copy. The consent
page, the settings page and the OAuth metadata all read that list.

## Rules a tool must follow

- **Build payloads field by field** (`lib/agent/present.ts`). Money is integer
  cents, with the unit in the name.
- **Never return an object key.** `withholdObjectKeys` turns keys into `ref:`
  handles and `restoreObjectKeys` turns them back on a save. A secret check on every
  result refuses anything that slips through.
- **Nothing behind a step-up.** `checkStepUp` always refuses an agent, and a test
  fails if a tool wraps an action that calls it.
- **Buyer-written text is data.** Say so in the description of any tool returning it.
- **Anything that cannot be undone** takes an opt-in scope and `DESTRUCTIVE`.

## Designing a storefront

`edit_storefront` takes a list of small operations (add, move, resize, rotate,
layer, style, remove, theme, header), saved together or not at all, so an assistant
never resends blocks it was not asked about. The rules are pure data in
`lib/storefront/design-ops.ts`; the result goes through `storefrontConfigSchema` and
`saveStorefront` like a save from the designer. `upload_element` stores artwork for
`add_image` through `lib/uploads/store-element.ts`, shared with the upload route.
`save_storefront` remains for renaming and for replacing a whole config member.

## Not exposed yet

Digital file, font and document uploads; review CSV import and export;
payments (`getPaymentsOverview`), until Stripe Connect is live.

## Operations

- **Off switch:** `AGENT_ACCESS_ENABLED` in `wrangler.jsonc`. Set to anything but
  `"true"`, `/mcp`, `/oauth/*` and the discovery documents answer 404. Grants are kept.
- **Emergency stop:** revoke the signing key in Supabase: every request fails, and
  nothing else is affected.
- **One seller:** Connected apps, or a password change, sign-out everywhere, or a
  deletion request, each of which revokes all that person's grants.
- **Clean-up:** `.github/workflows/scheduled.yml` calls `/api/cron/agent-cleanup`
  daily for expired tokens, the 90-day trail and apps that were never connected.
- **Protocol:** both 2026-07-28 and the 2025 revisions, through
  `@modelcontextprotocol/server`. Stateless JSON, so GET and DELETE answer 405.
