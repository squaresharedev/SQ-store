-- Plan grants: staff put an account on a paid plan, for as long as they choose,
-- without Stripe.
--
-- WHY. Until now the only way onto Starter or Pro was paying for it
-- (seller_billing, written from Stripe's webhook). During the beta, and
-- after it, staff need to give a plan away: to beta testers, founding
-- sellers, partners, a seller support wants to make good to, or a test
-- account. A grant is that, and nothing a seller can do or see changes it.
--
-- WHAT THIS ADDS
--   1. plan_grants: one row per account, the grant it has (or last had). The
--      plan, when it started, when it ends (null = until staff end it), why,
--      and which staff member set it. History (every grant, extension and end)
--      is the admin panel's audit log; this row is only the current state.
--   2. account_plan() now answers the HIGHER of the paid plan and an active
--      grant. It is what the plan-limit triggers ask. Its TypeScript twin is
--      readAccountBilling (src/lib/billing/account-plan.ts), which applies
--      the same rule through grantedPlan() (src/lib/billing/grants.ts).
--   3. plan_grant_set() and plan_grant_end(): the admin panel's two writes,
--      for one account or many at once.
--
-- WHY NOT A ROW IN seller_billing. That table is a mirror of Stripe: the
-- webhook overwrites it from a fresh fetch, its customer id must be a real
-- cus_..., and the admin panel counts it as revenue. A granted plan is none
-- of those things, so it lives apart and is combined only when read.
--
-- WRITES. Service role only, like seller_billing: RLS on, no policy, every
-- client grant revoked. A seller who could write here could give themselves
-- Pro. The admin panel writes through the two functions below.
--
-- MIRRORS, each to be edited in the same change as its twin
-- (tests/integration/39-plan-grants.test.ts compares them):
--   plan_grants_reason_check <-> GRANT_REASONS in src/lib/billing/grants.ts
--                                and the admin panel's lib/plans/grants.ts
--
-- DEPLOY ORDER: either way round. The app reads this table and treats a
-- missing one as "no grants"; the old app never reads it. Apply this, then
-- the admin panel's 0009_plan_directory.sql, which reads it.
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. plan_grants -----------------------------------------------------------------

create table if not exists public.plan_grants (
  owner_id   uuid primary key references public.profiles (id) on delete cascade,
  plan       text not null,
  reason     text not null,
  -- For staff only: the seller never sees it.
  note       text,
  starts_at  timestamptz not null default now(),
  -- Null: no end date, the grant holds until staff end it.
  ends_at    timestamptz,
  -- The staff member's auth user id. No foreign key: staff come and go, and
  -- the audit log is the record of who did what.
  granted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Free is the absence of a grant, never a stored value.
  constraint plan_grants_plan_check check (plan in ('starter', 'pro')),
  -- MIRROR of GRANT_REASONS in src/lib/billing/grants.ts.
  constraint plan_grants_reason_check
    check (reason in ('beta_tester', 'founding_seller', 'support', 'partner', 'promotion', 'internal', 'other')),
  constraint plan_grants_note_length check (note is null or char_length(note) <= 500),
  constraint plan_grants_period check (ends_at is null or ends_at >= starts_at)
);

comment on table public.plan_grants is
  'A paid plan given by staff, without Stripe: one row per account, the grant it has or last had. Active while starts_at <= now() and (ends_at is null or ends_at > now()). Combined with seller_billing by account_plan() and readAccountBilling: the higher plan wins. Written only through plan_grant_set / plan_grant_end. Service role only.';
comment on column public.plan_grants.ends_at is
  'When the grant stops applying. Null = no end date (until staff end it). Ending a grant early sets this to the moment it was ended.';
comment on column public.plan_grants.note is
  'Staff-only context for the grant. Never shown to the seller.';

alter table public.plan_grants enable row level security;
revoke all on table public.plan_grants from public, anon, authenticated;
grant all on table public.plan_grants to service_role;

-- ---- 2. The plan in force -------------------------------------------------------------

-- The SQL twin of readAccountBilling's plan: the higher of the paid plan
-- (until paid_until) and an active grant, Free with neither. Same signature
-- and grants as 20260930_seller_plans; only the body changes.
create or replace function public.account_plan(p_owner uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case greatest(
      (select case b.plan when 'pro' then 2 when 'starter' then 1 else 0 end
         from public.seller_billing b
        where b.owner_id = p_owner
          and b.plan is not null
          and b.paid_until > now()),
      (select case g.plan when 'pro' then 2 when 'starter' then 1 else 0 end
         from public.plan_grants g
        where g.owner_id = p_owner
          and g.starts_at <= now()
          and (g.ends_at is null or g.ends_at > now())),
      0)
    when 2 then 'pro'
    when 1 then 'starter'
    else 'free'
  end
$$;

revoke execute on function public.account_plan(uuid) from public, anon, authenticated;
grant execute on function public.account_plan(uuid) to service_role;

comment on function public.account_plan(uuid) is
  'free | starter | pro: the plan an account is on now, the higher of its paid plan (until paid_until) and an active plan grant. Service role only.';

-- ---- 3. The admin panel's writes ---------------------------------------------------------

-- Give `p_plan` to every account in `p_owners`, until `p_ends_at` (null = no
-- end date). An account with an ACTIVE grant keeps its start date (this is an
-- extension or a change of plan); any other account starts now. Ids with no
-- profile are skipped, so the caller compares what comes back with what it
-- sent. Returns, per account written, the grant as it was before, for the
-- audit log.
--
-- Plain SECURITY INVOKER: only the service role may execute it, and the
-- service role already bypasses RLS. The row lock serialises two staff
-- members writing the same account.
create or replace function public.plan_grant_set(
  p_owners uuid[],
  p_plan text,
  p_ends_at timestamptz,
  p_reason text,
  p_note text,
  p_actor uuid
)
returns table (owner_id uuid, previous_plan text, previous_ends_at timestamptz, was_active boolean)
language plpgsql
set search_path = ''
as $$
declare
  target uuid;
  before_row public.plan_grants%rowtype;
  active boolean;
begin
  if p_ends_at is not null and p_ends_at <= now() then
    raise exception 'plan_grant_ends_in_past' using errcode = '22023';
  end if;
  if coalesce(array_length(p_owners, 1), 0) > 500 then
    raise exception 'plan_grant_too_many' using errcode = '22023';
  end if;

  for target in select distinct o from unnest(p_owners) as o where o is not null loop
    if not exists (select 1 from public.profiles p where p.id = target) then
      continue;
    end if;

    select * into before_row from public.plan_grants g where g.owner_id = target for update;
    active := found
      and before_row.starts_at <= now()
      and (before_row.ends_at is null or before_row.ends_at > now());

    insert into public.plan_grants as g (owner_id, plan, reason, note, starts_at, ends_at, granted_by, updated_at)
    values (target, p_plan, p_reason, nullif(btrim(p_note), ''), now(), p_ends_at, p_actor, now())
    on conflict on constraint plan_grants_pkey do update set
      plan       = excluded.plan,
      reason     = excluded.reason,
      note       = excluded.note,
      starts_at  = case when active then g.starts_at else now() end,
      ends_at    = excluded.ends_at,
      granted_by = excluded.granted_by,
      updated_at = now();

    owner_id := target;
    previous_plan := case when active then before_row.plan end;
    previous_ends_at := case when active then before_row.ends_at end;
    was_active := active;
    return next;
  end loop;
end
$$;

revoke execute on function public.plan_grant_set(uuid[], text, timestamptz, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.plan_grant_set(uuid[], text, timestamptz, text, text, uuid) to service_role;

comment on function public.plan_grant_set(uuid[], text, timestamptz, text, text, uuid) is
  'Admin panel write: give a plan to one or more accounts until a date (null = no end date). Keeps the start of an active grant. Returns the grant each account had before. Service role only.';

-- End the active grant of every account in `p_owners` now. Accounts with no
-- active grant are left alone and not returned. The row stays, ended, so the
-- seller's page can say when it stopped.
create or replace function public.plan_grant_end(p_owners uuid[], p_actor uuid)
returns table (owner_id uuid, previous_plan text, previous_ends_at timestamptz)
language sql
set search_path = ''
as $$
  with ended as (
    select g.owner_id, g.plan, g.ends_at
      from public.plan_grants g
     where g.owner_id = any (p_owners)
       and g.starts_at <= now()
       and (g.ends_at is null or g.ends_at > now())
       for update
  )
  update public.plan_grants g
     set ends_at = now(), granted_by = p_actor, updated_at = now()
    from ended e
   where g.owner_id = e.owner_id
  returning e.owner_id, e.plan, e.ends_at
$$;

revoke execute on function public.plan_grant_end(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.plan_grant_end(uuid[], uuid) to service_role;

comment on function public.plan_grant_end(uuid[], uuid) is
  'Admin panel write: end the active plan grant of one or more accounts now. Returns the grants it ended. Service role only.';

notify pgrst, 'reload schema';
