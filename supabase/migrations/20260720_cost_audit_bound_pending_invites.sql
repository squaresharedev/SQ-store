-- Bound the pending-invites RPC. A user realistically has a handful of pending
-- store invites; 50 is far above any real case while removing the unbounded
-- scan if one address is ever mass-invited. Body is otherwise byte-identical to
-- the previous definition (search_path, SECURITY DEFINER, and ordering kept).
--
-- Applied to the live project via MCP during the cost audit; recorded here so
-- the repo stays the source of truth.
create or replace function public.team_my_pending_invites()
 returns table(id uuid, account_owner_id uuid, role team_role, invited_at timestamp with time zone, store_name text)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select tm.id, tm.account_owner_id, tm.role, tm.invited_at,
         coalesce(p.display_name, 'A SquareShare store')
  from public.team_members tm
  left join public.profiles p on p.id = tm.account_owner_id
  where tm.status = 'invited'
    and lower(tm.invited_email) = (select public.team_jwt_email())
  order by tm.invited_at desc
  limit 50
$function$;
