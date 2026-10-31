-- =============================================================================
-- Agent access: the OAuth tables behind /mcp (lib/agent)
-- =============================================================================
-- An assistant connected through MCP acts as the person who approved it, on the
-- one store they chose. These tables hold who approved what. They hold NO
-- credential in the clear: a token and an authorization code are stored only as
-- their SHA-256, so a read of these tables hands nobody a way in.
--
-- SERVICE ROLE ONLY. RLS on, no policies, and the default-privileges grant to
-- anon and authenticated taken back explicitly: an access token must not be able
-- to read its own grant and find out what else exists. The app's seller-facing
-- views of this data go through lib/agent/oauth/grants.ts, which filters on the
-- signed-in user.
--
-- A GRANT IS THE TOKEN FAMILY. One approval makes one grant, and every access
-- and refresh token descends from it, so "revoke the family" (a refresh token
-- used twice, the seller pressing Revoke, a password change) is one write on
-- the grant, and no token check can miss it because each one reads the grant.

create table if not exists public.agent_clients (
  -- A random id for an app that registered itself (RFC 7591), or the HTTPS URL
  -- of its metadata document (Client ID Metadata Documents).
  id                text primary key,
  kind              text not null check (kind in ('registered', 'metadata')),
  name              text not null check (char_length(name) between 1 and 200),
  redirect_uris     text[] not null check (cardinality(redirect_uris) between 1 and 20),
  application_type  text not null default 'web' check (application_type in ('web', 'native')),
  created_at        timestamptz not null default now(),
  -- When a metadata document was last read, so it can be read again later.
  fetched_at        timestamptz
);

create table if not exists public.agent_grants (
  id            uuid primary key default gen_random_uuid(),
  -- Who approved it, and whose store it may act on. The same person for your
  -- own store; a teammate's id and the owner's for a store you are a member of.
  user_id       uuid not null references auth.users (id) on delete cascade,
  account_id    uuid not null references auth.users (id) on delete cascade,
  client_id     text not null references public.agent_clients (id) on delete cascade,
  scopes        text[] not null,
  -- The canonical URL these tokens are for (RFC 8707), checked on every call.
  resource      text not null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

create index if not exists agent_grants_user_idx on public.agent_grants (user_id) where revoked_at is null;
-- One live connection per app, person and store: approving again replaces it.
create unique index if not exists agent_grants_one_live_idx
  on public.agent_grants (user_id, account_id, client_id) where revoked_at is null;

create table if not exists public.agent_auth_codes (
  code_hash       text primary key,
  grant_id        uuid not null references public.agent_grants (id) on delete cascade,
  code_challenge  text not null,
  redirect_uri    text not null,
  expires_at      timestamptz not null,
  -- Set by the one exchange that wins. A second try revokes the grant.
  used_at         timestamptz
);

create index if not exists agent_auth_codes_expiry_idx on public.agent_auth_codes (expires_at);

create table if not exists public.agent_tokens (
  token_hash  text primary key,
  grant_id    uuid not null references public.agent_grants (id) on delete cascade,
  kind        text not null check (kind in ('access', 'refresh')),
  expires_at  timestamptz not null,
  -- Refresh tokens only: when it was spent. Spending one twice is theft.
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists agent_tokens_grant_idx on public.agent_tokens (grant_id);
create index if not exists agent_tokens_expiry_idx on public.agent_tokens (expires_at);

-- An upload made through an assistant. The assistant holds `id`, never
-- `object_key`: object keys do not cross this boundary (docs/agent-surface.md, B6).
create table if not exists public.agent_uploads (
  id          uuid primary key default gen_random_uuid(),
  grant_id    uuid not null references public.agent_grants (id) on delete cascade,
  kind        text not null,
  object_key  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists agent_uploads_expiry_idx on public.agent_uploads (expires_at);

-- What was done through an assistant: which tool, and how it ended. Never the
-- arguments, which can hold a buyer's details. Survives a revoked grant so the
-- trail outlives the connection.
create table if not exists public.agent_audit_log (
  id          bigint generated always as identity primary key,
  grant_id    uuid references public.agent_grants (id) on delete set null,
  account_id  uuid not null,
  tool        text not null,
  outcome     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists agent_audit_log_account_idx on public.agent_audit_log (account_id, created_at desc);
create index if not exists agent_audit_log_created_idx on public.agent_audit_log (created_at);

alter table public.agent_clients    enable row level security;
alter table public.agent_grants     enable row level security;
alter table public.agent_auth_codes enable row level security;
alter table public.agent_tokens     enable row level security;
alter table public.agent_uploads    enable row level security;
alter table public.agent_audit_log  enable row level security;

revoke all on public.agent_clients    from public, anon, authenticated;
revoke all on public.agent_grants     from public, anon, authenticated;
revoke all on public.agent_auth_codes from public, anon, authenticated;
revoke all on public.agent_tokens     from public, anon, authenticated;
revoke all on public.agent_uploads    from public, anon, authenticated;
revoke all on public.agent_audit_log  from public, anon, authenticated;

grant all on public.agent_clients    to service_role;
grant all on public.agent_grants     to service_role;
grant all on public.agent_auth_codes to service_role;
grant all on public.agent_tokens     to service_role;
grant all on public.agent_uploads    to service_role;
grant all on public.agent_audit_log  to service_role;

notify pgrst, 'reload schema';
