-- Product limits: a plan now caps how many products a store holds.
--
-- WHY. Plans cap storefronts and team seats already (20260930_seller_plans).
-- Products join them: 20 on Free, 60 on Starter, 500 on Pro. The numbers are
-- the owner's and live in src/lib/billing/plans.ts (PLANS[..].limits);
-- plan_limit() below is their SQL mirror.
--
-- WHAT THIS CHANGES.
--   1. plan_limit() learns the 'products' key, and Pro stops being "no cap on
--      anything": it is unlimited on storefronts and seats, capped on products.
--   2. enforce_plan_limit() learns the products table, and a trigger puts it
--      on products for inserts and for a product moved into another account.
--   3. 'product_limit' joins the seller_funnel_events source CHECK (the entry
--      point a refused create sends a seller from).
--
-- WHAT IT DOES NOT CHANGE.
--   - Nothing is deleted, hidden or unpublished. Only CREATING a product is
--     limited: a store already over its cap keeps and sells every product it
--     has, and can still edit them. It cannot add another until it is back
--     under the cap or on a bigger plan.
--   - Nothing is refused until billing_switches.plan_limits_enforced is turned
--     on (it ships OFF). The trigger and the server actions read that one
--     switch, so this migration is inert on the day it is applied.
--   - The service role and direct SQL stay trusted (seed scripts, fixtures,
--     support), as for the other two limits.
--
-- MIRRORS. Edit these together, or the two sides disagree:
--   plan_limit()                       <-> PLANS[..].limits (plans.ts)
--   seller_funnel_events source CHECK  <-> PRICING_SOURCES (billing/paths.ts)
--
-- A multi-row insert (the CSV import) is checked row by row: a BEFORE ROW
-- trigger sees the rows the same statement has already inserted, so a batch
-- that would cross the cap fails at the first row past it and the whole
-- statement rolls back. The import action sizes its batch to the room left
-- (src/lib/products/import-actions.ts), so this is the backstop, not the path.
--
-- Recreating a function re-grants EXECUTE to the API roles (the PostgREST
-- auto-grant trap), so every grant is restated after its function.
--
-- Apply via the Management API query endpoint or the SQL editor.

-- ---- 1. The caps -----------------------------------------------------------------

create or replace function public.plan_limit(p_plan text, p_key text)
returns integer
language sql immutable
set search_path = ''
as $$
  select case p_plan
    when 'free'    then case p_key when 'storefronts' then 3  when 'teamSeats' then 2 when 'products' then 20  end
    when 'starter' then case p_key when 'storefronts' then 10 when 'teamSeats' then 5 when 'products' then 60  end
    when 'pro'     then case p_key                                                    when 'products' then 500 end
  end
$$;

revoke execute on function public.plan_limit(text, text) from public, anon;
grant execute on function public.plan_limit(text, text) to authenticated, service_role;

comment on function public.plan_limit(text, text) is
  'The cap a plan puts on storefronts, teamSeats or products; null = unlimited. Mirror of src/lib/billing/plans.ts.';

-- ---- 2. The trigger function, now for products too ------------------------------

-- Unchanged for storefronts and team seats (see 20260930_seller_plans for the
-- reasoning on each line); the products branch follows the storefronts one.
create or replace function public.enforce_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limit_key text := tg_argv[0];
  owner uuid;
  cap integer;
  used integer;
begin
  -- The owner's own seat is always there (it is seeded at signup); only a seat
  -- for someone else, and only one that is live (invited or active), takes
  -- one of the plan's. Decided first: it needs no claims at all. (Nested, not
  -- ANDed: plpgsql does not short-circuit, and other tables have no role.)
  if tg_table_name = 'team_members' then
    if new.role = 'owner' or new.status not in ('invited', 'active') then
      return new;
    end if;
  end if;

  if coalesce((select auth.role()), '') <> 'authenticated' then
    return new;
  end if;

  -- Off until paid plans can be bought (see billing_switches).
  if not coalesce((select s.plan_limits_enforced from public.billing_switches s where s.id), false) then
    return new;
  end if;

  if tg_table_name in ('storefronts', 'products') then
    -- An UPDATE only reaches here when owner_id changed (see the triggers):
    -- a row moved INTO an account counts against that account.
    if tg_op = 'UPDATE' then
      if new.owner_id is not distinct from old.owner_id then
        return new;
      end if;
    end if;
    owner := new.owner_id;
  elsif tg_table_name = 'team_members' then
    -- Re-activating a revoked row adds a seat, and so does moving a live row
    -- to another account; editing a live row in place does not.
    -- (Nested, not ANDed: OLD only exists for an UPDATE.)
    if tg_op = 'UPDATE' then
      if old.status in ('invited', 'active')
         and new.account_owner_id is not distinct from old.account_owner_id then
        return new;
      end if;
    end if;
    owner := new.account_owner_id;
  else
    raise exception 'enforce_plan_limit: unsupported table %', tg_table_name;
  end if;

  cap := public.plan_limit(public.account_plan(owner), limit_key);
  if cap is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('plan_limit:' || limit_key || ':' || owner::text, 0));

  if tg_table_name = 'storefronts' then
    select count(*) into used from public.storefronts s where s.owner_id = owner;
  elsif tg_table_name = 'products' then
    -- Every product counts, whatever its status: a draft takes a place.
    select count(*) into used from public.products p where p.owner_id = owner;
  else
    select count(*) into used
      from public.team_members tm
     where tm.account_owner_id = owner
       and tm.status in ('invited', 'active');
  end if;

  if used >= cap then
    raise exception 'plan_limit_reached:%', limit_key using errcode = '23514';
  end if;
  return new;
end
$$;

revoke execute on function public.enforce_plan_limit() from public, anon, authenticated;

-- Insert, and any change of the owning account: a product moved from one
-- account into another is a new one for the account it lands in.
drop trigger if exists products_plan_limit on public.products;
create trigger products_plan_limit
  before insert or update of owner_id on public.products
  for each row execute function public.enforce_plan_limit('products');

-- ---- 3. The funnel's entry points ------------------------------------------------

alter table public.seller_funnel_events
  drop constraint if exists seller_funnel_events_source_check;

alter table public.seller_funnel_events
  add constraint seller_funnel_events_source_check
    check (source is null or source in ('sidebar', 'profile_menu', 'settings', 'storefront_limit',
                                        'team_limit', 'product_limit', 'order_nudge',
                                        'analytics_nudge', 'email', 'notification',
                                        'checkout_cancel', 'orders_export'));

notify pgrst, 'reload schema';
