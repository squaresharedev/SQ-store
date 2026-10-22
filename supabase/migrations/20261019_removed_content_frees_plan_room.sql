-- Products and storefronts that moderation has REMOVED stop counting against
-- the plan's cap.
--
-- WHY. A removal is final for the seller: the moderation gate
-- (20261012_auto_moderation, moderation_gate) leaves a removed row removed
-- whatever the seller saves, and only a trusted writer (staff deciding an
-- appeal) can put it back. Yet the cap counted it, so a Free seller with three
-- removed products had 17 places for 20, and nothing to do about it but delete
-- the evidence of a decision they might be appealing.
--
-- WHY THIS CANNOT BE GAMED.
--   - A seller cannot mark anything removed: every seller write to a
--     moderation_* column is refused by moderation_gate (errcode 42501), and an
--     INSERT has its moderation state reset to 'pending'.
--   - A removed row cannot come back by the seller's hand: editing it keeps it
--     removed (the gate returns early for 'removed').
--   - Only removal frees a place. A draft, a row still being checked, one
--     waiting for a person ('review') and a PAUSED one all still count: the
--     seller can bring a paused row back by changing it.
--   - If staff restore a row on appeal while the account is at its cap, the
--     account is over the cap until it deletes something: the count includes
--     the row again, so nothing new can be created meanwhile.
--
-- Same function as 20261002_product_limits, with the two counts changed; the
-- triggers that call it are unchanged. Mirrored in src/lib/billing/limits.ts
-- (countPlanUsage), which the app asks before writing.

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

  -- What moderation has removed for good takes no place (see the top of
  -- 20261019_removed_content_frees_plan_room). Everything else does, drafts
  -- and paused rows included.
  if tg_table_name = 'storefronts' then
    select count(*) into used from public.storefronts s
     where s.owner_id = owner and s.moderation_status is distinct from 'removed';
  elsif tg_table_name = 'products' then
    select count(*) into used from public.products p
     where p.owner_id = owner and p.moderation_status is distinct from 'removed';
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

-- Unchanged, and restated: a function's privileges are its own, and this one
-- is only ever run by its triggers.
revoke execute on function public.enforce_plan_limit() from public, anon, authenticated;

notify pgrst, 'reload schema';
