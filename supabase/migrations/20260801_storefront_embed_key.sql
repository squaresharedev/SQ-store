-- Rotatable public key for storefront embeds.
--
-- WHY NOT REUSE THE STOREFRONT ID: the embed snippet is pasted into third-party
-- pages, so whatever identifies the storefront there is public forever. Using
-- the row's primary key means a leaked snippet can never be revoked without
-- destroying and recreating the storefront (losing its orders' product
-- references and every existing embed). A separate key can be rotated: the old
-- snippet stops resolving, the storefront is untouched.
--
-- It is a CAPABILITY, not a secret. It only ever grants read access to data the
-- seller has explicitly published, and the origin allowlist is the real gate.
-- Treated as unguessable rather than confidential, hence a random uuid.

alter table public.storefronts
  add column if not exists embed_key uuid not null default gen_random_uuid();

-- Backfill is implicit: the default applies to existing rows on ADD COLUMN.
-- Uniqueness is enforced so a lookup by key can never be ambiguous, and the
-- index is what makes the public endpoint's lookup a single index probe.
create unique index if not exists storefronts_embed_key_key
  on public.storefronts (embed_key);

comment on column public.storefronts.embed_key is
  'Public, rotatable identifier used by the embed snippet. Not a secret: the origin allowlist in config->embed is the access control. Rotate to revoke a leaked snippet.';

-- NO RLS POLICY IS ADDED HERE, deliberately.
--
-- The public embed endpoint reads through the service-role client and applies
-- its own checks (embed enabled, request Origin on the allowlist) before
-- returning anything. Exposing storefronts to `anon` by embed_key would make
-- the key alone sufficient to read the row, which is exactly the property the
-- allowlist exists to prevent — and it would bypass the rate limit too.
